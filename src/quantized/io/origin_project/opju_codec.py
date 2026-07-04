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
<segment list> [0c <stream>]``. The segment list is ZigZag varints: −m = "m
FPC rows" (a plain column is the single segment ``zigzag(−nrows)``), +k = "k
rows of one repeated value" whose value-spec follows (``0x50``+float64,
``0x1a``+top-2-bytes, or bare ``0x64`` = 0.0) — Origin run-length-compresses
constant runs like total-reflection plateaus *outside* the FPC stream, and a
fully constant column has no stream at all. Empty numeric cells carry the
``ORIGIN_MISSING`` sentinel and map to NaN.
"""

from __future__ import annotations

import re
import struct
from typing import NamedTuple

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.container import ORIGIN_MISSING

__all__ = ["CodecError", "decode_stream", "scan_columns", "tail_start"]

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


class _Record(NamedTuple):
    """One parsed column record: run-length segments + an FPC stream."""

    nrows: int
    segments: list[tuple[str, int, float]]  # ("rep", count, value) | ("fpc", count, 0)
    stream_start: int  # position after 0x0C; -1 when the record has no stream


def _record_at(b: bytes, ff: int) -> _Record | None:
    """Parse the column-record header whose ``ff ff`` sits at ``ff``.

    Grammar (all validated against Origin's own CSV dumps): ``ff ff
    <nrows:varint> 00`` then a segment list, then usually ``0c <FPC stream>``.
    Each segment starts with a ZigZag varint: a *negative* value −m means "m
    FPC-coded rows" (the plain columns are the one-segment case — the old
    "2·nrows−1 size-ish field" was really ``zigzag(−nrows)``); a *positive*
    value k means "k rows of one repeated value", whose value-spec follows:

    * ``0x50`` + little-endian float64 — the full repeated value,
    * ``0x1a`` + 2 bytes — the float64's top two bytes (rest zero), the
      compact form for round values like 1.0 or 5.0,
    * ``0x64`` — no payload, value 0.0.

    Constant columns are a single repeat segment with no stream at all.
    Records whose segments don't sum to ``nrows`` (e.g. the chunked
    multi-stream staircase form some logger columns use) return None here —
    dropped, never guessed at.
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
    segments: list[tuple[str, int, float]] = []
    pending: int | None = None  # a positive (repeat) count awaiting its value
    total = 0
    for _ in range(8):  # field-region guard: real headers are short
        if total >= nrows:
            break
        if p >= len(b):
            return None
        tag = b[p]
        if pending is not None:  # value-spec for the pending repeat run
            if tag == 0x50 and p + 9 <= len(b):
                value = struct.unpack("<d", b[p + 1 : p + 9])[0]
                p += 9
            elif tag == 0x1A and p + 3 <= len(b):
                value = struct.unpack("<d", b"\x00" * 6 + b[p + 1 : p + 3])[0]
                p += 3
            elif tag == 0x64:
                value = 0.0
                p += 1
            else:
                return None
            segments.append(("rep", pending, value))
            total += pending
            pending = None
            continue
        try:
            raw, p = _read_varint(b, p)
        except CodecError:
            return None
        count = _zigzag(raw)
        if count < 0:
            segments.append(("fpc", -count, 0.0))
            total += -count
        elif count > 0:
            pending = count
        else:
            return None
    if pending is not None or total != nrows:
        return None
    n_fpc = sum(1 for kind, _, _ in segments if kind == "fpc")
    if n_fpc > 1:
        # the chunked staircase form runs one continuous predictor state
        # across interleaved streams — not yet pinned; drop, never guess
        return None
    if n_fpc:
        if p >= len(b) or b[p] != 0x0C:
            return None
        return _Record(nrows, segments, p + 1)
    return _Record(nrows, segments, -1)


def _records(b: bytes) -> list[tuple[int, _Record]]:
    """Candidate numeric records ``(marker, record)``, in file order.

    ``0xff 0xff`` also occurs *inside* FPC residual data, so this over-reports;
    :func:`scan_columns` walks the list with a cursor that jumps past each
    decoded stream, so the false in-stream markers are skipped.
    """
    out: list[tuple[int, _Record]] = []
    ff = b.find(b"\xff\xff")
    while ff >= 0:
        # the header opens with `0a 05 <varint>` (1-2 byte varint) before ff ff
        if any(ff - k >= 0 and b[ff - k] == 0x0A and b[ff - k + 1] == 0x05 for k in (3, 4)):
            rec = _record_at(b, ff)
            if rec is not None:
                out.append((ff, rec))
        ff = b.find(b"\xff\xff", ff + 1)
    return out


def _reconstruct(b: bytes, rec: _Record) -> tuple[NDArray[np.float64], int]:
    """Rebuild a full column from a record's segments.

    Returns ``(values, stream_end)`` where ``stream_end`` is the position just
    past the record's FPC stream (its start for stream-less records).
    """
    parts: list[NDArray[np.float64]] = []
    pos = max(rec.stream_start, 0)
    for kind, count, value in rec.segments:
        if kind == "rep":
            parts.append(np.full(count, value, dtype=float))
        else:
            vals, consumed = _decode(b[pos : pos + count * 9 + 16], count)
            parts.append(vals)
            pos += consumed
    return np.concatenate(parts), pos


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
    for marker, rec in _records(b):
        if marker < cursor:  # a false marker inside an already-decoded stream
            continue
        try:
            vals, stream_end = _reconstruct(b, rec)
        except CodecError:
            continue
        if not _plausible(vals):
            continue
        prev = [name for pos, name in names if pos < marker]
        if prev:
            out.append((prev[-1], vals))
        if rec.stream_start >= 0:
            cursor = stream_end
    return out


def tail_start(b: bytes) -> int:
    """Byte offset just past the last decoded worksheet-data record.

    Everything before this point is the datasets section (FPC streams, whose
    residual bytes routinely contain byte pairs that coincidentally match the
    windows-section designation markers). ``windows_opju`` uses this to bound
    its marker search to the tail region, avoiding those false positives.
    """
    end = 0
    for marker, rec in _records(b):
        try:
            _, stream_end = _reconstruct(b, rec)
        except CodecError:
            continue
        end = max(end, stream_end, marker)
    return end
