"""``/api/parsers/import``'s LIVE mode: the source watch's re-read of a file
that may still be being written (gap audit 5 lane J, item 10).

The watcher (``frontend/src/lib/sourceWatch.ts``) decides WHEN to re-read; this
module makes the read itself safe to take while an instrument appends:

* **One snapshot of the bytes.** A line-oriented text file (the registry's
  :func:`~quantized.io.registry.is_line_text`) is read ONCE into memory and
  parsed from a private temp copy of exactly those bytes, so nothing the
  writer does after the read can reach the parse.
COST PER UPDATE. Every update re-reads the WHOLE file: a text file is held in
memory once (its size), hashed, and written to a temp copy of the same size on
the system temp disk for the parse, then the copy is removed; a binary file is
read twice (hashed, then parsed in place). A 100 MB log refreshed every few
seconds is therefore ~100 MB of memory and temp disk per refresh while it runs.

The byte snapshot, the cut and the stamp check live in ``io/live_text.py``;
this module adapts them to HTTP (409 changed during the read, 425 no complete
line yet, 422 unparseable, 404/403/503 unreachable).

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

import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from fastapi.responses import Response

from quantized.io.live_text import (
    FileChangedError,
    NoCompleteLineError,
    ensure_unchanged,
    sha256_file,
    snapshot_text,
    source_stamp,
)
from quantized.io.registry import is_line_text
from quantized.routes._errors import CALC_ERRORS_IO
from quantized.routes._payload import DataStructResponse

__all__ = ["live_import_response", "source_stamp"]

Parse = Callable[..., tuple[dict[str, Any], str | None]]


def _input_error(fn: Callable[[], Any]) -> Any:
    """``fn()`` with a parse/sniff failure as 422 -- but an OS error (the file vanished,
    was locked, or its share dropped mid-read) left to the 404/403/503 mapping below."""
    try:
        return fn()
    except OSError:
        raise
    except CALC_ERRORS_IO as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _read(
    path: Path, *, hold_partial: bool, parse: Parse
) -> tuple[dict[str, Any], str | None, os.stat_result, str, bool]:
    if _input_error(lambda: is_line_text(path)):
        snap = snapshot_text(path, hold_partial=hold_partial)
        with tempfile.TemporaryDirectory(prefix="qz-live-") as tmp:
            copy = Path(tmp) / path.name
            copy.write_bytes(snap.data)
            # The copy's temp path never reaches the payload's metadata['source'].
            payload, handle = _input_error(lambda: parse(copy, upload_name=str(path)))
        return payload, handle, snap.stat, snap.checksum, snap.held
    before = os.stat(path)
    checksum = sha256_file(path)
    payload, handle = _input_error(lambda: parse(path, upload_name=None))
    ensure_unchanged(path, before)
    return payload, handle, before, checksum, False


def live_import_response(path: Path, *, hold_partial: bool, parse: Parse) -> Response:
    """Parse ``path`` (already confined by the caller) as one consistent
    snapshot; ``parse`` is the route's ``(path, upload_name=)`` importer."""
    try:
        payload, handle, st, checksum, held = _read(path, hold_partial=hold_partial, parse=parse)
    except FileChangedError as exc:
        raise HTTPException(
            status_code=409, detail="the file changed while it was being read"
        ) from exc
    except NoCompleteLineError as exc:
        # 425 Too Early: not a failure and not a race -- read it again once it holds still.
        raise HTTPException(status_code=425, detail="the file has no complete line yet") from exc
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
        "X-Source-Checksum": checksum,
        "X-Live-Held": "1" if held else "0",
    }
    if handle:
        headers["X-Dataset-Handle"] = handle
    return DataStructResponse(payload, headers=headers)
