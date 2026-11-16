"""``/api/parsers/import``'s LIVE mode: the source watch's re-read of a file
that may still be being written (gap audit 5 lane J, item 10).

The watcher (``frontend/src/lib/sourceWatch.ts``) decides WHEN to re-read; this
module makes the read itself safe to take while an instrument appends:

* **One snapshot of the bytes.** A line-oriented text file (the registry's
  :func:`~quantized.io.registry.is_line_text`) is read ONCE into memory and
  parsed from a private temp copy of exactly those bytes, so nothing the
  writer does after the read can reach the parse.
* **No half rows.** With ``hold_partial`` the snapshot is cut back to its last
  complete line (:func:`~quantized.io.live_text.complete_lines`: BOM/UTF-16,
  ``\\n``, ``\\r\\n`` and bare ``\\r`` aware) -- decided on the bytes actually
  read, never on an earlier peek a writer can outrun. ``X-Live-Held: 1`` says a
  tail was held, so the watcher can read it in full once the file has stopped
  changing (a file whose last line simply has no newline is not starved).
  Binary formats are never cut.
* **Stamp checked after the read.** The file is stat'ed before and after;
  any change in between (mtime, size, inode, ctime) answers 409 and the
  watcher retries, so a read torn by a rewrite never becomes data. For a
  binary format the window covers the whole parse (it reads the live file).
* **The baseline the relink/pack verdicts compare.** ``X-Source-Mtime`` is
  ``repr(st.st_mtime)`` -- the very float the desktop probe
  (``desktop_source_probe.probe_source_path``) reports, so an unchanged file
  compares equal -- with ``X-Source-Size`` and ``X-Source-Checksum`` (the
  probe's ``sha256:<hex>`` form) of the same snapshot. ``X-Source-Stamp`` is
  the stat route's change stamp (:func:`source_stamp`) of what was read.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from fastapi.responses import Response

from quantized.desktop_source_probe import _sha256_file
from quantized.io.live_text import complete_lines
from quantized.io.registry import is_line_text
from quantized.routes._errors import CALC_ERRORS_IO
from quantized.routes._payload import DataStructResponse

__all__ = ["live_import_response", "source_stamp"]

Parse = Callable[..., tuple[dict[str, Any], str | None]]
#: What ``complete_lines`` keeps of a buffer with no complete line (a UTF-16 one keeps its BOM).
_NOTHING_KEPT = (b"", b"\xff\xfe", b"\xfe\xff")


def source_stamp(st: os.stat_result) -> str:
    """The change stamp the watcher compares: mtime, size and identity (inode +
    ctime), so a same-size, same-mtime replacement still reads as changed."""
    return f"{st.st_mtime_ns}:{st.st_size}:{st.st_ino}:{st.st_ctime_ns}"


def _changed() -> HTTPException:
    return HTTPException(status_code=409, detail="the file changed while it was being read")


def _parse(parse: Parse, path: Path, upload_name: str | None) -> tuple[dict[str, Any], str | None]:
    try:
        return parse(path, upload_name=upload_name)
    except CALC_ERRORS_IO as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _read(
    path: Path, *, hold_partial: bool, parse: Parse
) -> tuple[dict[str, Any], str | None, os.stat_result, str, bool]:
    before = os.stat(path)
    try:
        text = is_line_text(path)  # resolves the parser: "no parser" is a 422, as in /import
    except CALC_ERRORS_IO as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if text:
        raw = path.read_bytes()
        if source_stamp(os.stat(path)) != source_stamp(before):
            raise _changed()
        checksum = hashlib.sha256(raw).hexdigest()
        kept, held = complete_lines(raw) if hold_partial else (raw, False)
        if held and kept in _NOTHING_KEPT:
            raise HTTPException(status_code=409, detail="the file has no complete line yet")
        with tempfile.TemporaryDirectory(prefix="qz-live-") as tmp:
            copy = Path(tmp) / path.name
            copy.write_bytes(kept)
            # The copy's temp path never reaches the payload's metadata['source'].
            payload, handle = _parse(parse, copy, str(path))
        return payload, handle, before, checksum, held
    checksum = _sha256_file(str(path))
    payload, handle = _parse(parse, path, None)
    if source_stamp(os.stat(path)) != source_stamp(before):
        raise _changed()
    return payload, handle, before, checksum, False


def live_import_response(path: Path, *, hold_partial: bool, parse: Parse) -> Response:
    """Parse ``path`` (already confined by the caller) as one consistent
    snapshot; ``parse`` is the route's ``(path, upload_name=)`` importer."""
    try:
        payload, handle, st, checksum, held = _read(path, hold_partial=hold_partial, parse=parse)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="file not found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="permission denied") from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail=f"the file could not be read: {exc}") from exc
    headers = {
        "X-Source-Stamp": source_stamp(st),
        "X-Source-Mtime": repr(st.st_mtime),
        "X-Source-Size": str(st.st_size),
        "X-Source-Checksum": f"sha256:{checksum}",
        "X-Live-Held": "1" if held else "0",
    }
    if handle:
        headers["X-Dataset-Handle"] = handle
    return DataStructResponse(payload, headers=headers)
