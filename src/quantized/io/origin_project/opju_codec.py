"""The ``.opju`` (CPYUA) worksheet-column codec — canonical Burtscher FPC.

Format facts derived clean-room (no GPL liborigin) from known-content Rosetta
specimens generated with an Origin 2026b trial, then locked against Origin's
own exported ground truth (``tests/test_io_origin_ground_truth.py``): every
``XAS.opju`` column (243/243 values) and 193 ``Hc2 data`` columns decode
bit-exact, plus ``RockingCurve`` axes at 71 and 201 rows.

Each numeric column is an FPC-compressed float64 stream (Burtscher &
Ratanaworabhan, *FPC: A High-Speed Compressor for Double-Precision
Floating-Point Data*, IEEE TC 2009). Two predictors race for every value:

* **FCM** — a value predictor: ``pred = fcm[fh]``;
* **DFCM** — a stride predictor: ``pred = last + dfcm[dh]``.

The encoder XORs the true bits against the closer prediction and stores the
low ``k`` bytes little-endian (the dropped high bytes are the leading zeros).
Every value carries a 4-bit code; two codes pack into one control byte, low
nibble first:

* **bit 3** selects the predictor (0 = FCM, 1 = DFCM),
* **bits 0-2** give the residual byte-count: codes 0-3 store 0-3 bytes and
  codes 4-7 store 5-8 (a count of exactly 4 is unsupported, per the paper),
  so code 0 with either selector (``0x0``/``0x8``) means predictor-exact.

Both hash tables hold ``2**12`` entries and update the textbook FPC way::

    fh = ((fh << 6) ^ (value  >> 48)) & 0xFFF
    dh = ((dh << 2) ^ (stride >> 40)) & 0xFFF

Origin frames each column record as ``0a 05 <varint> ff ff <nrows:varint> 00
<segments>``. Segments open with a ZigZag varint: −m = "m FPC rows", with
``0x0c`` + the stream *inline* and a FRESH predictor state per stream (a
plain column is the single segment ``zigzag(−nrows)``); +k = "k rows of one
repeated value" whose value-spec follows (``0x50``+float64, ``0x1a``/``0x11``
+ the double's top 2/1 bytes, or bare ``0x64`` = 0.0). Segments interleave
freely — Origin run-length-compresses constant runs (total-reflection
plateaus, logger hold-steps) *outside* the FPC streams, and a fully constant
column has no stream at all. Empty numeric cells carry the
``ORIGIN_MISSING`` sentinel and map to NaN.
"""

from __future__ import annotations

import re
import struct

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.container import ORIGIN_MISSING

__all__ = ["CodecError", "decode_stream", "scan_columns"]

_MASK = 0xFFFFFFFFFFFFFFFF
_TABLE_MASK = (1 << 12) - 1  # 2**12-entry FCM/DFCM hash tables
_FCM_SHIFT, _FCM_DROP = 6, 48  # fh = ((fh << 6) ^ (value  >> 48)) & mask
_DFCM_SHIFT, _DFCM_DROP = 2, 40  # dh = ((dh << 2) ^ (stride >> 40)) & mask

# A length-prefixed dataset name "<Book>_<Col>" (CPYUA strings carry no NUL
# terminator, so the byte before the match must equal the name length).
_NAME = re.compile(rb"[A-Za-z][\w ]{0,40}_[A-Za-z0-9]{1,4}")


class CodecError(ValueError):
    """A column stream that doesn't parse under the FPC codec."""


def _width(nibble: int) -> int:
    """Residual byte-count for a 4-bit code — canonical FPC bcode semantics.

    The low 3 bits encode the count of *stored* residual bytes, except that a
    count of exactly 4 is unsupported (rare in practice, per the FPC paper) so
    codes 4-7 mean 5-8 bytes. Code 0 is the predictor-exact case (0 bytes) —
    for either predictor, so ``0x0`` (FCM exact) and ``0x8`` (DFCM exact) both
    carry no payload. An earlier width table ``(c & 7) + 1`` coincided with
    this one for c >= 4 — the only codes clean ramps ever exercise — which let
    hundreds of columns validate bit-exact while ultra-smooth data (codes 0-3)
    misparsed; that was the real cause of the "DFCM-collision" drop-outs.
    """
    c = nibble & 7
    return c if c < 4 else c + 1


def _decode(stream: bytes, nrows: int) -> tuple[NDArray[np.float64], int]:
    """Decode ``nrows`` float64s; return ``(values, bytes_consumed)``."""
    fcm: dict[int, int] = {}
    dfcm: dict[int, int] = {}
    fh = dh = 0
    last = 0
    out: list[int] = []
    pos = 0
    n = len(stream)
    while len(out) < nrows:
        if pos >= n:
            raise CodecError(f"stream exhausted at {len(out)}/{nrows} values")
        ctrl = stream[pos]
        pos += 1
        for nibble in (ctrl & 0xF, ctrl >> 4):
            width = _width(nibble)
            if pos + width > n:
                raise CodecError("residual overruns the buffer")
            resid = int.from_bytes(stream[pos : pos + width] + b"\x00" * (8 - width), "little")
            pos += width
            pred = (last + dfcm.get(dh, 0)) & _MASK if nibble & 8 else fcm.get(fh, 0)
            val = pred ^ resid
            out.append(val)
            stride = (val - last) & _MASK
            fcm[fh] = val
            dfcm[dh] = stride
            fh = ((fh << _FCM_SHIFT) ^ (val >> _FCM_DROP)) & _TABLE_MASK
            dh = ((dh << _DFCM_SHIFT) ^ (stride >> _DFCM_DROP)) & _TABLE_MASK
            last = val
            if len(out) >= nrows:
                break
    vals = np.frombuffer(np.asarray(out, dtype="<u8").tobytes(), dtype="<f8").copy()
    vals[vals == ORIGIN_MISSING] = np.nan  # empty cells → NaN
    return vals, pos


def decode_stream(stream: bytes, nrows: int) -> NDArray[np.float64]:
    """Decode ``nrows`` float64 values from one FPC control+residual stream."""
    return _decode(stream, nrows)[0]


def _read_varint(b: bytes, p: int) -> tuple[int, int]:
    """Read one LEB128 varint at ``p``; return ``(value, next_pos)``."""
    val = shift = 0
    while p < len(b):
        byte = b[p]
        p += 1
        val |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return val, p
    raise CodecError("varint ran off the buffer")


def _zigzag(v: int) -> int:
    """ZigZag-decode a varint (0,1,2,3,… → 0,−1,1,−2,…)."""
    return (v >> 1) ^ -(v & 1)


# Repeat-run value tags: tag byte → payload length. The payload holds the
# float64's TOP bytes (rest zero) — the compact forms cover round values.
_TAG_LEN = {0x50: 8, 0x1A: 2, 0x11: 1, 0x64: 0}


def _decode_record(b: bytes, ff: int) -> tuple[NDArray[np.float64], int] | None:
    """Parse *and* decode the column record whose ``ff ff`` sits at ``ff``.

    Grammar (validated against Origin's own CSV dumps): ``ff ff
    <nrows:varint> 00`` then a segment list. Each segment opens with a ZigZag
    varint:

    * **−m** — m FPC-coded rows; ``0x0c`` and the stream follow *inline*, and
      the predictor state starts FRESH for every stream (the plain column is
      the one-segment case — the old "2·nrows−1 size-ish field" was really
      ``zigzag(−nrows)``);
    * **+k** — k rows of one repeated value; a value-spec tag follows:
      ``0x50`` + float64, ``0x1a``/``0x11`` + the double's top 2/1 bytes
      (rest zero — round values like 1.0, 2.0, 5.0), or bare ``0x64`` = 0.0.

    Segments interleave freely (staircase logger columns alternate hold-runs
    and FPC bursts); a fully constant column is one repeat segment with no
    stream at all. Parsing and decoding fuse because an inline stream's byte
    length is only known by decoding it. Returns ``(values, end)`` with
    ``end`` just past the record's last byte, or None for anything that
    doesn't sum exactly to ``nrows`` — dropped, never guessed at.
    """
    try:
        nrows, p = _read_varint(b, ff + 2)
    except CodecError:
        return None
    if not 2 <= nrows <= 50_000_000:
        return None
    if p >= len(b) or b[p] != 0x00:
        return None
    p += 1
    parts: list[NDArray[np.float64]] = []
    total = 0
    while total < nrows:  # each iteration adds ≥1 row, so this terminates
        try:
            raw, p = _read_varint(b, p)
        except CodecError:
            return None
        count = _zigzag(raw)
        if count > 0:
            if total + count > nrows or p >= len(b):
                return None
            plen = _TAG_LEN.get(b[p])
            if plen is None or p + 1 + plen > len(b):
                return None
            value = struct.unpack("<d", b"\x00" * (8 - plen) + b[p + 1 : p + 1 + plen])[0]
            p += 1 + plen
            parts.append(np.full(count, value, dtype=float))
            total += count
        elif count < 0:
            m = -count
            if total + m > nrows or p >= len(b) or b[p] != 0x0C:
                return None
            try:
                vals, consumed = _decode(b[p + 1 : p + 1 + m * 9 + 16], m)
            except CodecError:
                return None
            parts.append(vals)
            p += 1 + consumed
            total += m
        else:
            return None
    return np.concatenate(parts), p


def _records(b: bytes) -> list[int]:
    """Candidate record markers (``ff ff`` positions), in file order.

    ``0xff 0xff`` also occurs *inside* FPC residual data, so this over-reports;
    :func:`scan_columns` walks the list with a cursor that jumps past each
    decoded record, so the false in-stream markers are skipped.
    """
    out: list[int] = []
    ff = b.find(b"\xff\xff")
    while ff >= 0:
        # the header opens with `0a 05 <varint>` (1-2 byte varint) before ff ff
        if any(ff - k >= 0 and b[ff - k] == 0x0A and b[ff - k + 1] == 0x05 for k in (3, 4)):
            out.append(ff)
        ff = b.find(b"\xff\xff", ff + 1)
    return out


def _plausible(vals: NDArray[np.float64]) -> bool:
    """Reject any column that shows a decode desync.

    A wrong predictor shatters the float exponent field, so a mis-located or
    diverged stream produces subnormals (|v| ≲ 1e-300) and absurd magnitudes
    (|v| ≳ 1e290) that real instrument data never contains. We reject the
    *whole* column on the first such value — a partially-diverged column can't
    be trusted past the divergence, and silent garbage is worse than a gap.
    """
    finite = vals[np.isfinite(vals)]
    if finite.size == 0:
        return False
    mag = np.abs(finite)
    wrecked = ((mag < 1e-290) & (finite != 0.0)) | (mag > 1e290)
    return not bool(np.any(wrecked))


def scan_columns(b: bytes) -> list[tuple[str, NDArray[np.float64]]]:
    """Decode every ``<Book>_<Col>`` numeric column in a CPYUA ``.opju`` file.

    Records are walked in file order with a cursor: each decoded stream advances
    the cursor past its own bytes, so the false ``ff ff`` markers buried in long
    residual streams are skipped. Every real record is labelled by the nearest
    preceding length-prefixed dataset name (validated on the local corpus: the
    owning ``<Book>_<Col>`` name always leads its record). Streams that fail the
    codec or decode to garbage are dropped — never emitted.
    """
    names = [
        (m.start(), m.group(0).decode("latin1"))
        for m in _NAME.finditer(b)
        if m.start() > 0 and b[m.start() - 1] == len(m.group(0))
    ]
    out: list[tuple[str, NDArray[np.float64]]] = []
    cursor = 0
    for marker in _records(b):
        if marker < cursor:  # a false marker inside an already-decoded record
            continue
        got = _decode_record(b, marker)
        if got is None:
            continue
        vals, end = got
        if not _plausible(vals):
            continue
        prev = [name for pos, name in names if pos < marker]
        if prev:
            out.append((prev[-1], vals))
        cursor = end
    return out
