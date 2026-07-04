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
* **bits 0-2** give the residual byte-count as ``(code & 7) + 1``,
* the single code ``0x8`` is the exact case (0 residual bytes).

Both hash tables hold ``2**11`` entries and update the textbook FPC way::

    fh = ((fh << 6) ^ (value  >> 48)) & 0x7FF
    dh = ((dh << 2) ^ (stride >> 40)) & 0x7FF

Origin frames each column record with LEB128 varints as
``0a 05 <varint> ff ff <nrows:varint> 00 <varint> 0c <stream>``; the next
record (or trailing ``ff ff``) bounds the stream. Empty numeric cells carry
the ``ORIGIN_MISSING`` sentinel and map to NaN.
"""

from __future__ import annotations

import re

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
    """Residual byte-count for a 4-bit code (``0x8`` = exact = 0 bytes)."""
    return 0 if nibble == 8 else (nibble & 7) + 1


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


def _record_at(b: bytes, ff: int) -> tuple[int, int] | None:
    """Parse the column-record header whose ``ff ff`` sits at ``ff``.

    Returns ``(nrows, stream_start)`` for the numeric-stream form
    ``ff ff <nrows:varint> 00 <varint> 0c``, else None (graph/preview and
    other record shapes fail one of the fixed bytes and are skipped).
    """
    try:
        nrows, p = _read_varint(b, ff + 2)
    except CodecError:
        return None
    if not 2 <= nrows <= 50_000_000:
        return None
    if p >= len(b) or b[p] != 0x00:
        return None
    try:
        _, p = _read_varint(b, p + 1)  # a size-ish field (~2·nrows−1)
    except CodecError:
        return None
    if p >= len(b) or b[p] != 0x0C:
        return None
    return nrows, p + 1


def _records(b: bytes) -> list[tuple[int, int, int]]:
    """Candidate numeric records ``(marker, nrows, start)``, in file order.

    ``0xff 0xff`` also occurs *inside* FPC residual data, so this over-reports;
    :func:`scan_columns` walks the list with a cursor that jumps past each
    decoded stream, so the false in-stream markers are skipped.
    """
    out: list[tuple[int, int, int]] = []
    ff = b.find(b"\xff\xff")
    while ff >= 0:
        # the header opens with `0a 05 <varint>` (1-2 byte varint) before ff ff
        if any(ff - k >= 0 and b[ff - k] == 0x0A and b[ff - k + 1] == 0x05 for k in (3, 4)):
            rec = _record_at(b, ff)
            if rec is not None:
                out.append((ff, rec[0], rec[1]))
        ff = b.find(b"\xff\xff", ff + 1)
    return out


def _plausible(vals: NDArray[np.float64]) -> bool:
    """Reject any column that shows a decode desync.

    A wrong predictor shatters the float exponent field, so a mis-located or
    diverged stream produces subnormals (|v| ≲ 1e-300) and absurd magnitudes
    (|v| ≳ 1e290) that real instrument data never contains. We reject the
    *whole* column on the first such value — a partially-diverged column can't
    be trusted past the divergence, and silent garbage is worse than a gap.
    (The known residual gap: long near-constant-stride axis columns diverge on
    an exact DFCM hash-collision detail — see ``docs/origin_re``.)
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
    for marker, nrows, start in _records(b):
        if marker < cursor:  # a false marker inside an already-decoded stream
            continue
        try:  # ≤ 8 residual bytes + a shared control nibble per value
            vals, consumed = _decode(b[start : start + nrows * 9 + 16], nrows)
        except CodecError:
            continue
        if not _plausible(vals):
            continue
        prev = [name for pos, name in names if pos < marker]
        if prev:
            out.append((prev[-1], vals))
        cursor = start + consumed
    return out
