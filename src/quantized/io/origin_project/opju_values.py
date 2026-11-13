"""CPYUA (``.opju``) float64 *value-specs* and *segment lists* — the two
primitives every numeric worksheet record is built from.

Clean-room, from byte evidence; each rule's oracle is recorded in
``docs/origin_project_format.md`` §3.5.
"""

from __future__ import annotations

import struct

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.container import ORIGIN_MISSING
from quantized.io.origin_project.opju_codec import CodecError, _read_varint, _zigzag, decode_at

__all__ = ["read_segments", "read_value"]

# Value-spec tags (one tag byte, then a payload). Two families:
#
# * ``8 + 9·n`` (n = 1..8 → 0x11, 0x1a, 0x23, 0x2c, 0x35, 0x3e, 0x47, 0x50) —
#   the float64's TOP n bytes follow, least-significant first; the dropped
#   low 8−n bytes are zero. Origin picks the smallest n that loses nothing,
#   so round values are short (2.0 = ``11 40``, 1.0 = ``1a f0 3f``) and a
#   full-precision value is ``50`` + all 8 bytes.
# * the two bare tags: ``0x64`` = 0.0 and ``0x65`` = the missing-value
#   sentinel (an empty cell → NaN).
#
# Evidence (docs/origin_project_format.md §3.5): n = 1, 2 and both bare tags
# are pinned cell-for-cell by the paired ``.opj``/``.opju`` oracle; n = 8 by
# Origin's own exports (§3.3). n = 3..7 are pinned by the record's own length
# field — 2,660 such values sit in length-checked records, where a wrong
# payload width would shift the body's end off its declared length — and by
# minimality: across the 103,110 tagged values with n > 1 not one payload
# starts with a zero byte (the byte a shorter tag would have dropped), where
# a wrong rule would show ~1 in 256.
#
# Any other tag byte is NOT a value-spec: the caller rejects the record.
_ZERO_TAG, _MISSING_TAG = 0x64, 0x65


def read_value(b: bytes, p: int) -> tuple[float, int] | None:
    """Read one value-spec at ``p``; return ``(value, next_pos)`` or None."""
    if p >= len(b):
        return None
    tag = b[p]
    if tag == _ZERO_TAG:
        return 0.0, p + 1
    if tag == _MISSING_TAG:
        return float("nan"), p + 1
    n, rem = divmod(tag - 8, 9)
    if rem or not 1 <= n <= 8 or p + 1 + n > len(b):
        return None
    value = float(struct.unpack("<d", b"\x00" * (8 - n) + b[p + 1 : p + 1 + n])[0])
    # A literal that spells the sentinel is still an empty cell.
    return (float("nan") if value == ORIGIN_MISSING else value), p + 1 + n


def read_segments(
    b: bytes, p: int, nrows: int, width: int = 1
) -> tuple[NDArray[np.float64], int] | None:
    """Decode a float64 segment list covering exactly ``nrows`` rows.

    Each segment opens with a ZigZag varint:

    * **−m** — m rows as one FPC stream: ``0x0c`` + the stream (``m·width``
      doubles, FRESH predictor state per stream);
    * **−1** followed by a value-spec tag instead of ``0x0c`` — ONE literal
      row (a lone value between two repeat runs). Seen only with a count
      of −1, so any other count without ``0x0c`` is rejected;
    * **+k** — k rows of one repeated row; ``width`` value-specs follow.

    ``width`` is the doubles-per-row count: 1 for a real column, 2 for a
    complex one (real, imaginary). Returns ``(values, end)`` — ``values``
    holds ``nrows·width`` doubles — or None for anything that does not sum
    exactly to ``nrows``: dropped, never guessed at.
    """
    parts: list[NDArray[np.float64]] = []
    total = 0
    while total < nrows:  # each iteration adds ≥1 row, so this terminates
        try:
            raw, p = _read_varint(b, p)
        except CodecError:
            return None
        count = _zigzag(raw)
        if count == 0 or total + abs(count) > nrows or p >= len(b):
            return None
        if count < -1 and b[p] != 0x0C:
            return None
        if count < 0 and b[p] == 0x0C:
            m = -count * width
            try:
                vals, consumed = decode_at(b, p + 1, m)
            except CodecError:
                return None
            parts.append(vals)
            p += 1 + consumed
        else:  # +k repeats of one row, or the single literal row (count −1)
            row: list[float] = []
            for _ in range(width):
                got = read_value(b, p)
                if got is None:
                    return None
                row.append(got[0])
                p = got[1]
            parts.append(np.tile(np.asarray(row, dtype=float), abs(count)))
        total += abs(count)
    return (np.concatenate(parts) if parts else np.empty(0)), p
