"""CPY container primitives shared by the Origin ``.opj``/``.opju`` readers.

The ``.opj`` (CPYA) container is a stream of
``<uint32 size LE><0x0A><payload><0x0A>`` blocks (``size==0`` = 5-byte spacer);
worksheet columns, window definitions, and graph windows all live in that one
walkable stream (see ``docs/origin_re/``). Format facts derived clean-room from
local specimens — no GPL code consulted (``docs/origin_project_format.md``).
"""

from __future__ import annotations

import re
import struct
from collections.abc import Iterator
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

__all__ = [
    "ORIGIN_MISSING",
    "NAME_RE",
    "OriginProjectError",
    "decode_doubles",
    "decode_inline_text",
    "fallback",
    "plausible_column",
    "walk_blocks",
]

_VIEWER = "the free Origin Viewer (https://www.originlab.com/viewer/)"

# Origin's "missing value" sentinel for an empty numeric cell (-1.23456789e-300);
# stored in the data, not flagged by the mask, so we map it to NaN on decode.
ORIGIN_MISSING = struct.unpack("<d", b"\x0e\x2c\x13\x1c\xfe\x74\xaa\x81")[0]

# A dataset name inside a column-header block: "<book>_<col>[@sheet]\0"
# (the @N suffix marks columns of sheet N>1 in multi-sheet workbooks).
NAME_RE = re.compile(rb"([A-Za-z][\w ]{0,40}_[A-Za-z0-9]{1,4}(?:@\d{1,2})?)\x00")


class OriginProjectError(ValueError):
    """An Origin project can't (yet) be read directly; the message explains why
    and how to recover the data (subclasses ValueError so the import route maps
    it to a 422 with the message intact)."""


def fallback(path: Path, detail: str) -> OriginProjectError:
    return OriginProjectError(
        f"{detail} For now, open '{path.name}' in {_VIEWER} and export the "
        f"worksheet(s) to CSV or ASCII, then import that file here."
    )


def walk_blocks(b: bytes) -> Iterator[tuple[int, bytes]]:
    """Yield ``(size, payload)`` for each CPY block after the header line.

    A ``size==0`` block is a section spacer yielded as ``(0, b"")``. Iteration
    stops at the first framing break — the start of the trailing global-storage
    / analysis-log area (which is framed differently).
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


def decode_doubles(data: bytes) -> NDArray[np.float64]:
    """Decode a data block of 10-byte ``<uint16 mask><float64>`` records → values.

    Byte-offset explicit (slice cols 2:10 of each record and view as float64) so
    it is independent of numpy structured-dtype alignment.
    """
    n = len(data) // 10
    rows = np.frombuffer(data, dtype=np.uint8, count=n * 10).reshape(n, 10)
    vals = np.ascontiguousarray(rows[:, 2:]).view("<f8").reshape(n).copy()
    vals[vals == ORIGIN_MISSING] = np.nan  # empty cells → NaN, not a bogus -1e-300
    return vals


_INLINE_TEXT_PRINTABLE = frozenset(range(0x20, 0x7F))


def decode_inline_text(data: bytes) -> list[str] | None:
    """Decode a data block as one short inline-text string per 10-byte record,
    or ``None`` if it doesn't fit that shape (plan item 4 — the non-double
    "text" column case).

    A double column's record is ``<u16 mask><f8 value>``; a **Text & Numeric**
    column reuses the exact same 10-byte record, but the 8-byte value area
    holds a NUL-terminated ASCII/latin-1 string (up to 7 chars) followed by a
    single ``0x00``/``0x01`` tag byte and zero padding out to 8 bytes, instead
    of a raw float64. Pinned against ``hc2convert.opj``: every one of its 58
    dropped "text" columns is exactly this shape, ``prefix="NaN"`` (Origin's
    literal text sentinel for a fit that produced no critical-field value),
    tag byte at value-offset 3 — 112,887 matching records, zero
    counter-examples in a 6-file real-corpus scan. No header type-field byte
    was found that reliably discriminates this from a double column (every
    offset in the 147-byte column-storage header matches between the two);
    this is a content-shape detector, same spirit as ``plausible_column`` and
    the existing ``_looks_textual`` gate.

    A record with no NUL in its 8-byte value area (a string longer than 7
    chars, overflowing into the next record — seen in Origin's FitLinear/
    NLFit auto-generated "Notes"/"Summary" report-sheet columns) makes the
    WHOLE column unsafe to decode this way: return ``None`` rather than emit
    misaligned rows. That family stays an honest drop (plan item 4 still
    open for it — a materially harder, variable-length RE problem).
    """
    if not data or len(data) % 10 != 0:
        return None
    n = len(data) // 10
    rows: list[str] = []
    for k in range(n):
        value = data[10 * k + 2 : 10 * k + 10]
        nul = value.find(b"\x00")
        if nul < 0:
            return None
        prefix = value[:nul]
        if prefix and not all(c in _INLINE_TEXT_PRINTABLE for c in prefix):
            return None
        tail = value[nul + 1 :]
        if tail and not (tail[0] in (0x00, 0x01) and all(c == 0 for c in tail[1:])):
            return None
        rows.append(prefix.decode("latin1"))
    return rows


def plausible_column(vals: NDArray[np.float64], *, allow_all_nan: bool = False) -> bool:
    """Reject a decoded column whose values betray a non-double payload.

    Text / integer / float32 columns (the 147-byte column header carries a
    type field the readers don't decode yet — plan item 4) reinterpret as
    float64 garbage: subnormals (|v| ≲ 1e-300) and absurd magnitudes
    (|v| ≳ 1e290) that real instrument data never contains. Dropping the whole
    column on the first such value is honest-absent; silent garbage is worse
    than a gap. ``allow_all_nan`` keeps genuinely empty columns (the ``.opj``
    reader pads ragged books with them).
    """
    finite = vals[np.isfinite(vals)]
    if finite.size == 0:
        return allow_all_nan
    mag = np.abs(finite)
    wrecked = ((mag < 1e-290) & (finite != 0.0)) | (mag > 1e290)
    return not bool(np.any(wrecked))
