"""Read Origin project files (``.opj`` / ``.opju``) — clean-room, no GPL liborigin.

Origin's project formats are proprietary binary. The older ``.opj`` (Origin 2017
and earlier) and the newer ``.opju`` (2018+) share the same ``CPY`` container —
``CPYA`` is the ANSI variant, ``CPYUA`` the Unicode sibling — so one decoder
serves both (the delta is mostly string encoding). This repo is Apache-2.0 with an
enforced no-GPL rule (see ``architecture-guards`` #3), so it does **not** bundle
the GPL ``liborigin``; we roll our own. Format layout is documented in
``docs/origin_project_format.md``.

Milestone M1 (here): recover worksheet DATA. The container is a stream of
``<uint32 size LE><0x0A><payload><0x0A>`` blocks (``size==0`` = section spacer);
the datasets section alternates a column-header block (carrying ``"<Book>_<Col>"``)
and a data block of ``<uint16 mask><float64>`` records. We group columns by
workbook and return the largest book as a :class:`~quantized.datastruct.DataStruct`
(every book's inventory is recorded in metadata so nothing is hidden; per-book
selection + figures are later milestones). ``.opju`` currently still raises the
guidance error until M2 adapts the Unicode string reads.
"""

from __future__ import annotations

import re
import struct
from collections import OrderedDict
from collections.abc import Iterator
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["OriginProjectError", "read_origin_project"]

_VIEWER = "the free Origin Viewer (https://www.originlab.com/viewer/)"

# Origin's "missing value" sentinel for an empty numeric cell (-1.23456789e-300);
# stored in the data, not flagged by the mask, so we map it to NaN on decode.
_ORIGIN_MISSING = struct.unpack("<d", b"\x0e\x2c\x13\x1c\xfe\x74\xaa\x81")[0]

# A dataset name inside a column-header block: "<book>_<col-designation>\0".
_NAME_RE = re.compile(rb"([A-Za-z][\w ]{0,40}_[A-Za-z0-9]{1,4})\x00")


class OriginProjectError(ValueError):
    """An Origin project can't (yet) be read directly; the message explains why
    and how to recover the data (subclasses ValueError so the import route maps
    it to a 422 with the message intact)."""


def _fallback(path: Path, detail: str) -> OriginProjectError:
    return OriginProjectError(
        f"{detail} For now, open '{path.name}' in {_VIEWER} and export the "
        f"worksheet(s) to CSV or ASCII, then import that file here."
    )


def _walk_blocks(b: bytes) -> Iterator[tuple[int, bytes]]:
    """Yield ``(size, payload)`` for each CPY block after the header line.

    A block is ``<uint32 size LE><0x0A><payload (size bytes)><0x0A>``; a
    ``size==0`` block is a section spacer yielded as ``(0, b"")`` with no payload.
    Iteration stops at the first framing break — which is the end of the datasets
    section (the graphs/windows section that follows is framed differently).
    """
    nl = b.find(b"\n")
    if nl < 0:
        return
    pos = nl + 1
    n = len(b)
    while pos + 5 <= n:
        size = int.from_bytes(b[pos : pos + 4], "little")
        if b[pos + 4] != 0x0A:  # expected delimiter missing → framing ended
            return
        pos += 5
        if size == 0:
            yield 0, b""
            continue
        if pos + size >= n or b[pos + size] != 0x0A:
            return
        yield size, b[pos : pos + size]
        pos += size + 1


def _decode_doubles(data: bytes) -> NDArray[np.float64]:
    """Decode a data block of 10-byte ``<uint16 mask><float64>`` records → values.

    Byte-offset explicit (slice cols 2:10 of each record and view as float64) so
    it is independent of numpy structured-dtype alignment.
    """
    n = len(data) // 10
    rows = np.frombuffer(data, dtype=np.uint8, count=n * 10).reshape(n, 10)
    vals = np.ascontiguousarray(rows[:, 2:]).view("<f8").reshape(n).copy()
    vals[vals == _ORIGIN_MISSING] = np.nan  # empty cells → NaN, not a bogus -1e-300
    return vals


def _columns(b: bytes) -> list[tuple[str, NDArray[np.float64]]]:
    """Walk the datasets section, pairing each named header block with its data."""
    out: list[tuple[str, NDArray[np.float64]]] = []
    pending: str | None = None
    for size, payload in _walk_blocks(b):
        if size == 0:
            continue
        if size % 10 != 0:  # a column-header block (never a multiple of 10)
            m = _NAME_RE.search(payload)
            pending = m.group(1).decode("latin1") if m else pending
        elif pending is not None and size >= 10:  # the paired data block
            out.append((pending, _decode_doubles(payload)))
            pending = None
    return out


def _assemble(path: Path, columns: list[tuple[str, NDArray[np.float64]]]) -> DataStruct:
    """Group columns by workbook, return the largest book as a DataStruct.

    Ragged columns (Origin allows different row counts per column) are padded to
    the book's max length with NaN. The first column is the X (``time``); the rest
    become value columns labelled by their Origin designation (A, B, …).
    """
    books: OrderedDict[str, list[tuple[str, NDArray[np.float64]]]] = OrderedDict()
    for name, vals in columns:
        book, _, col = name.rpartition("_")
        books.setdefault(book or "Book", []).append((col or "A", vals))

    inventory = [
        {"name": k, "ncols": len(v), "nrows": max((len(a) for _, a in v), default=0)}
        for k, v in books.items()
    ]
    primary = max(books, key=lambda k: sum(len(v) for _, v in books[k]))
    cols = books[primary]
    maxlen = max((len(v) for _, v in cols), default=0)

    def _pad(a: NDArray[np.float64]) -> NDArray[np.float64]:
        return a if len(a) == maxlen else np.concatenate([a, np.full(maxlen - len(a), np.nan)])

    padded = [_pad(v) for _, v in cols]
    labels = [c for c, _ in cols]
    time = padded[0] if padded else np.empty(0)
    values = np.column_stack(padded[1:]) if len(padded) > 1 else np.empty((maxlen, 0))
    meta = {
        "source_format": "origin_opj",
        "origin_book": primary,
        "origin_books": inventory,
        "x_column_name": labels[0] if labels else "A",
    }
    return DataStruct(
        time=time,
        values=values,
        labels=tuple(labels[1:]),
        units=tuple("" for _ in labels[1:]),
        metadata=meta,
    )


def _read_opj(path: Path) -> DataStruct:
    b = path.read_bytes()
    if not b.startswith(b"CPYA"):
        raise _fallback(path, f"'{path.name}' does not look like a CPYA .opj (bad header).")
    columns = _columns(b)
    if not columns:
        raise _fallback(path, f"no worksheet columns could be decoded from '{path.name}'.")
    return _assemble(path, columns)


def _read_opju(path: Path) -> DataStruct:
    # TODO(M2): .opju (CPYUA) shares the CPY framing but stores Unicode strings —
    # adapt _columns' name reads before enabling. Until then, guide the user.
    raise _fallback(
        path,
        f"'{path.name}' is an Origin .opju (2018+) project; "
        f"the reader for it is still in progress.",
    )


def read_origin_project(path: Path) -> DataStruct:
    """Dispatch by extension to the clean-room ``.opj`` / ``.opju`` decoder.

    Origin projects are proprietary binary files; quantized decodes them itself
    (it will not bundle the GPL liborigin). ``.opj`` worksheet data is recovered
    now (M1); ``.opju`` still raises :class:`OriginProjectError` with the
    export-via-Origin-Viewer fallback until M2.
    """
    return (_read_opju if path.suffix.lower() == ".opju" else _read_opj)(path)
