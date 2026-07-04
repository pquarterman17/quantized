"""The ``.opju`` (CPYUA) worksheet-column codec — clean-room, validated vs oracles.

Format facts from ``docs/origin_re/opju_container.md`` (derived with
known-content Rosetta specimens, no GPL code): columns are stored as a
nibble-coded XOR-delta float stream, not compressed. Each column record ends
with::

    … 0a 05 20 | ff ff | <nrows u16 LE> | <mk> | 0x0c | <ctrl stream> | ff ff

where the ctrl stream is control bytes carrying two 4-bit item codes each
(low nibble first): ``7`` = 8-byte literal float64 LE · ``E`` = 7-byte XOR
residual (LE bytes 0–6, top byte 0) · ``F`` = 8-byte XOR residual · ``8`` =
0 bytes (predictor exact). Values reconstruct as ``u_i = P_i XOR r_i`` with
``P`` either PREV (``u[i-1]``) or PRED (``2·u[i-1] − u[i-2]``, u64 wrap,
missing terms 0). Alternate record forms: a constant column stores one
``0x1a``-tagged truncated literal (top 2 bytes); tiny columns store per-value
``00 00 1a <2B>`` records.

Which predictor an ``E``/``F`` item uses is a per-column schedule Origin
doesn't spell out; every real-data specimen used all-PREV, while clean
integer sequences alternated. We decode under a small family of candidate
schedules and keep the most physically plausible result — and the
ground-truth oracle suite (tests/test_io_origin_ground_truth.py) holds the
decoder to Origin's own exported values on the local corpus.
"""

from __future__ import annotations

import re
import struct
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.container import ORIGIN_MISSING

__all__ = ["CodecError", "scan_columns"]

_MASK = 0xFFFFFFFFFFFFFFFF
# .opju strings are length-prefixed (no NUL): validate the byte before the
# match equals the name length.
_NAME = re.compile(rb"[A-Za-z][\w ]{0,40}_[A-Za-z0-9]{1,4}")
_STREAM_LEN = {0x7: 8, 0x8: 0, 0xE: 7, 0xF: 8}


class CodecError(ValueError):
    """A column stream that doesn't parse under the documented codec."""


@dataclass(frozen=True)
class _Item:
    nibble: int
    payload: bytes


def _parse_items(b: bytes, pos: int, nrows: int) -> list[_Item]:
    """Parse ctrl-byte items until the ``ff ff`` terminator (or nrows items)."""
    items: list[_Item] = []
    n = len(b)
    while len(items) < nrows:
        if pos >= n:
            raise CodecError("stream ran off the end")
        ctrl = b[pos]
        if ctrl == 0xFF:
            break
        lo, hi = ctrl & 0xF, ctrl >> 4
        if lo not in _STREAM_LEN or hi not in _STREAM_LEN:
            raise CodecError(f"unknown ctrl nibble in {ctrl:02x}")
        pos += 1
        for nib in (lo, hi):
            width = _STREAM_LEN[nib]
            if pos + width > n:
                raise CodecError("item overruns buffer")
            items.append(_Item(nib, b[pos : pos + width]))
            pos += width
            if len(items) >= nrows:
                break
    if len(items) != nrows:
        raise CodecError(f"{len(items)} items for {nrows} rows")
    return items


def _residual(payload: bytes) -> int:
    """7-byte residuals are LE bytes 0–6 (top byte 0); 8-byte are full u64."""
    return int.from_bytes(payload + b"\x00" * (8 - len(payload)), "little")


Schedule = Callable[[int, int], str]  # (value_index, e_item_ordinal) -> "prev"|"pred"


def _schedules() -> list[Schedule]:
    """Candidate predictor schedules, most-likely-first (see module docstring)."""

    def all_prev(_i: int, _k: int) -> str:
        return "prev"

    def all_pred(_i: int, _k: int) -> str:
        return "pred"

    def alt_pred_first(_i: int, k: int) -> str:
        return "pred" if k % 2 == 0 else "prev"

    def alt_prev_first(_i: int, k: int) -> str:
        return "prev" if k % 2 == 0 else "pred"

    return [all_prev, alt_pred_first, alt_prev_first, all_pred]


def _decode_with(items: list[_Item], schedule: Schedule) -> NDArray[np.float64]:
    us: list[int] = []
    e_ordinal = 0
    for i, item in enumerate(items):
        prev = us[i - 1] if i >= 1 else 0
        prev2 = us[i - 2] if i >= 2 else 0
        pred = (2 * prev - prev2) & _MASK
        if item.nibble == 0x7:
            us.append(int.from_bytes(item.payload, "little"))
        elif item.nibble == 0x8:
            us.append(pred)
        else:  # E / F: XOR residual against the scheduled predictor
            base = prev if schedule(i, e_ordinal) == "prev" else pred
            us.append(base ^ _residual(item.payload))
            e_ordinal += 1
    out = np.frombuffer(np.asarray(us, dtype="<u8").tobytes(), dtype="<f8").copy()
    out[out == ORIGIN_MISSING] = np.nan
    return out


def _implausibility(vals: NDArray[np.float64]) -> int:
    """Wrong-predictor decodes shatter the exponent field; count the wreckage."""
    u = vals.view(np.uint64)
    exp = ((u >> 52) & 0x7FF).astype(np.int64)
    bad = int(np.sum((exp == 0x7FF) | ((exp == 0) & (u != 0))))  # inf/nan/denormal
    live = exp[(exp != 0) & (exp != 0x7FF)]
    if live.size > 1:
        bad += int(np.sum(np.abs(np.diff(live)) > 24))  # wild exponent jumps
    return bad


def _rank_key(vals: NDArray[np.float64]) -> tuple[float, int, float]:
    """Order candidate decodes: fewest wrecked floats, then strictly monotonic
    beats not (axes/indices), then least total variation. Schedule order breaks
    exact ties (all-PREV first — every real-data specimen used it)."""
    finite = vals[np.isfinite(vals)]
    if finite.size < 2:
        return (_implausibility(vals), 0, 0.0)
    d = np.diff(finite)
    monotonic = bool(np.all(d > 0) or np.all(d < 0))
    return (_implausibility(vals), 0 if monotonic else 1, float(np.sum(np.abs(d))))


def _decode_stream(b: bytes, pos: int, nrows: int) -> NDArray[np.float64]:
    items = _parse_items(b, pos, nrows)
    ranked = sorted((_decode_with(items, s) for s in _schedules()), key=_rank_key)
    return ranked[0]


def _truncated_literal(payload: bytes) -> float:
    """``0x1a`` items store the double's TOP bytes (LE order), rest zero."""
    u = int.from_bytes(payload, "little") << (8 - len(payload)) * 8
    return float(struct.unpack("<d", struct.pack("<Q", u))[0])


def _decode_record(b: bytes, at: int) -> tuple[int, NDArray[np.float64]] | None:
    """Decode one column record whose ``0a 05 20`` marker starts at ``at``.

    Returns ``(end_pos, values)`` or None if the bytes after the marker don't
    form a known record shape.
    """
    pos = at + 3
    tag = b[pos : pos + 2]
    if tag == b"\xff\xff":
        nrows = int.from_bytes(b[pos + 2 : pos + 4], "little")
        if not 1 <= nrows <= 50_000_000:
            return None
        fmt = b[pos + 5]  # b[pos + 4] is a size-ish field (2·nrows−1 for streams)
        if fmt == 0x0C:
            vals = _decode_stream(b, pos + 6, nrows)
            return pos + 6, vals
        if fmt == 0x1A:  # constant column: mk then one truncated literal
            width = 2
            val = _truncated_literal(b[pos + 5 + 1 : pos + 5 + 1 + width])
            return pos + 5, np.full(nrows, val)
        return None
    if tag == b"\x00\x00":  # tiny form: per-value 00 00 1a <2B> records
        tiny: list[float] = []
        while b[pos : pos + 2] == b"\x00\x00" and b[pos + 2] == 0x1A:
            tiny.append(_truncated_literal(b[pos + 3 : pos + 5]))
            pos += 5
        if tiny and b[pos : pos + 2] == b"\xff\xff":
            return pos, np.asarray(tiny)
    return None


def scan_columns(b: bytes) -> list[tuple[str, NDArray[np.float64]]]:
    """Find and decode every ``<Book>_<Col>`` column record in a CPYUA file.

    The outer type-tagged framing is not formally parsed (open RE item);
    records are located by pairing each dataset-name string with the next
    ``0a 05 20`` data marker before the following name. Columns whose stream
    fails the codec are skipped (never emitted as garbage).
    """
    names = [
        (m.start(), m.group(0).decode("latin1"))
        for m in _NAME.finditer(b)
        if m.start() > 0 and b[m.start() - 1] == len(m.group(0))  # length-prefixed
    ]
    out: list[tuple[str, NDArray[np.float64]]] = []
    seen: set[str] = set()
    for idx, (start, name) in enumerate(names):
        if name in seen:
            continue
        limit = names[idx + 1][0] if idx + 1 < len(names) else len(b)
        at = b.find(b"\x0a\x05\x20", start, min(limit + 64, len(b)))
        if at < 0:
            continue
        try:
            decoded = _decode_record(b, at)
        except CodecError:
            continue
        if decoded is not None:
            out.append((name, decoded[1]))
            seen.add(name)
    return out
