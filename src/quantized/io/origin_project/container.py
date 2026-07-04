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
    "fallback",
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
