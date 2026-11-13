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
import threading
from bisect import bisect_left
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.container import ORIGIN_MISSING, plausible_column
from quantized.io.origin_project.opju_budget import DECODE_BUDGET_CELLS, DecodeBudget
from quantized.io.origin_project.opju_curve_style import curve_plot_style

__all__ = [
    "DECODE_BUDGET_CELLS",
    "CodecError",
    "DecodeBudget",
    "curve_plot_style",
    "decode_stream",
    "decode_at",
    "scan_columns",
    "scan_marked_columns",
    "shared_fpc_decodes",
    "tail_start",
]

_MASK = 0xFFFFFFFFFFFFFFFF
_TABLE_MASK = (1 << 12) - 1  # 2**12-entry FCM/DFCM hash tables
_FCM_SHIFT, _FCM_DROP = 6, 48  # fh = ((fh << 6) ^ (value  >> 48)) & mask
_DFCM_SHIFT, _DFCM_DROP = 2, 40  # dh = ((dh << 2) ^ (stride >> 40)) & mask

# A length-prefixed dataset name "<Book>_<Col>[@sheet]" (CPYUA strings carry
# no NUL terminator, so the byte before the match must equal the name
# length). The optional "@<N>" suffix marks a column of sheet N>1 in a
# multi-sheet book (same convention `.opj`'s container.NAME_RE uses) — added
# alongside plan item 4's report-sheet decode, whose fitreport2.opju oracle
# was the first `.opju` specimen with more than one sheet in a book and
# exposed that every extra-sheet column was previously mis-anchored to the
# nearest SHEET-1 name instead (e.g. every FitNL1/FitNLCurve1 column
# collapsing onto "FitBook_B"): the un-suffixed pattern still matched an
# "@2"-suffixed name as a prefix, but the length-prefix byte then disagreed
# with the (shorter) matched length, so it should have failed the anchoring
# check below -- except sheet-1's own un-suffixed names sit right before the
# extra-sheet block and satisfied it instead, silently swallowing every
# later column into whichever sheet-1 name came last.
# Bounds deliberately wider than any corpus maximum (book 62 / column 16 /
# sheet 999 — the old 40/4/99 caps were corpus-shaped and silently dropped a
# column whose name exceeded them; 2026-07-06 genericity audit). The
# length-prefix byte check at the match site is the actual validity gate.
_NAME = re.compile(rb"[A-Za-z][\w ]{0,62}_[A-Za-z0-9]{1,16}(?:@\d{1,3})?")


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


# One import decodes each FPC stream up to twice: once through the structural
# record reader (``opju_values.read_segments``) and once through the frozen
# marker scan below, which sees the same ``0x0c`` streams at the same offsets.
# Inside :func:`shared_fpc_decodes` the second request for a stream is served
# from the first decode. The answer is a pure function of the stream's bytes
# (``b[p : p + 9m + 16]`` and ``m``), so sharing it cannot change any result;
# an entry is dropped once served, so at most one extra copy of a column lives
# for the length of the block.
_Decoded = tuple[NDArray[np.float64], int]
_FPC_MEMO: ContextVar[tuple[bytes, dict[tuple[int, int], _Decoded | CodecError]] | None] = (
    ContextVar("_FPC_MEMO", default=None)
)


@contextmanager
def shared_fpc_decodes(b: bytes) -> Iterator[None]:
    """Within the block, :func:`decode_at` on ``b`` decodes each stream once."""
    token = _FPC_MEMO.set((b, {}))
    try:
        yield
    finally:
        _FPC_MEMO.reset(token)


def decode_at(b: bytes, p: int, nrows: int) -> tuple[NDArray[np.float64], int]:
    """:func:`_decode` of the stream starting at ``b[p]`` (just past its
    ``0x0c``) — ``(values, bytes_consumed)``; raises :class:`CodecError`.
    The returned array may be shared with another caller: never mutate it."""
    memo = _FPC_MEMO.get()
    if memo is None or memo[0] is not b:
        return _decode(b[p : p + nrows * 9 + 16], nrows)
    cache = memo[1]
    key = (p, nrows)
    got = cache.pop(key, None)
    if got is None:
        try:
            got = _decode(b[p : p + nrows * 9 + 16], nrows)
        except CodecError as exc:
            got = exc
        cache[key] = got
    if isinstance(got, CodecError):
        raise got
    return got


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


# ── the marker-anchored scan (FROZEN) ─────────────────────────────────────────
#
# Everything from here to ``tail_start`` is the original marker-anchored
# column scan, and it decodes exactly what it decoded when it shipped (the
# only changes: ``scan_marked_columns`` also reports each marker's offset and
# settles ``tail_start`` in the same pass, FPC streams go through the shared
# ``decode_at``, and each walk stops materializing cells at its
# ``DecodeBudget`` — far above any real project, see that constant). It is
# deliberately NOT widened with the value tags and record forms
# ``opju_values`` / ``opju_records`` now understand, because two validated
# consumers are defined in terms of exactly the set of columns
# THIS scan decodes:
#
# * ``opju_curves``' curve->column binding counts its ``y_ord`` ordinal over
#   "the columns ``scan_columns`` decoded, in book-appearance order". Decoding
#   more columns here would silently renumber every later column and rebind
#   curves — a graph-semantics change that needs its own oracle and its own
#   handoff (CLAUDE.md "Origin graph-recovery safety").
# * ``windows_opju`` bounds its designation-marker search with ``tail_start``.
#
# Worksheet DATA no longer comes from this scan: ``opju.py`` reads it through
# ``opju_worksheet.scan_worksheet`` (the structural path), which falls back to
# this scan only for a record the structural path could not decode.

# Repeat-run value tags: tag byte → payload length. The payload holds the
# float64's TOP bytes (rest zero) — the compact forms cover round values.
_TAG_LEN = {0x50: 8, 0x1A: 2, 0x11: 1, 0x64: 0}


def _decode_record(
    b: bytes, ff: int, budget: DecodeBudget | None = None
) -> tuple[NDArray[np.float64], int] | None:
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
    if budget is not None and not budget.charge(nrows):
        return None
    got = _segments(b, p + 1, nrows)
    if got is None and budget is not None:
        budget.refund(nrows)  # nothing is kept
    return got


def _segments(b: bytes, p: int, nrows: int) -> tuple[NDArray[np.float64], int] | None:
    """The segment list of :func:`_decode_record` (its body, unchanged)."""
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
                vals, consumed = decode_at(b, p + 1, m)
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
        # The header opens with `0a 05 <varint>` before ff ff. The varint is
        # LEB128-shaped and GROWS with the record (a 120k-row column stores
        # `c0 a9 07` = 120000, three bytes — the old fixed 1-2-byte gate
        # silently rejected every large column's record; 2026-07-06 audit
        # item #16, confirmed by the bigcolumn.opju specimen). Accept any
        # 1..5-byte span that is a WELL-FORMED varint (continuation bytes
        # have the high bit set, the final byte does not) — a structural
        # check, not a size cap.
        for k in (3, 4, 5, 6, 7):
            if ff - k < 0 or b[ff - k] != 0x0A or b[ff - k + 1] != 0x05:
                continue
            varint = b[ff - k + 2 : ff]
            if varint and all(v & 0x80 for v in varint[:-1]) and not varint[-1] & 0x80:
                out.append(ff)
                break
        ff = b.find(b"\xff\xff", ff + 1)
    return out


def _plausible(vals: NDArray[np.float64]) -> bool:
    """Reject any column that shows a decode desync.

    A wrong predictor shatters the float exponent field the same way a
    non-double payload does, so the shared gate applies; all-NaN additionally
    rejects here because a mis-located ``.opju`` record never legitimately
    decodes to nothing but sentinels.
    """
    return plausible_column(vals, allow_all_nan=False)


def scan_marked_columns(b: bytes) -> list[tuple[int, str, NDArray[np.float64]]]:
    """:func:`scan_columns` with each column's ``ff ff`` marker offset —
    ``(marker, name, values)`` in file order. The offset lets
    ``opju_worksheet`` tell which dataset record a marker-decoded column
    belongs to (see the FROZEN note above: this is the same walk, not a
    second decoder).

    The same pass also settles :func:`tail_start` for ``b`` (its walk visits
    the same markers with its own cursor — it advances past implausible
    records too — and each marker is decoded once for both), so a later
    ``tail_start(b)`` costs nothing."""
    columns, tail = _marker_walk(b)
    _remember_tail(b, tail)
    return columns


def _marker_walk(b: bytes) -> tuple[list[tuple[int, str, NDArray[np.float64]]], int]:
    """The column walk and the tail walk in one loop, each with its own
    cursor exactly as the two walks had when they ran separately."""
    names = [
        (m.start(), m.group(0).decode("latin1"))
        for m in _NAME.finditer(b)
        if m.start() > 0 and b[m.start() - 1] == len(m.group(0))
    ]
    name_pos = [pos for pos, _ in names]
    out: list[tuple[int, str, NDArray[np.float64]]] = []
    cursor = tail_cursor = tail = 0
    budget = DecodeBudget()
    for marker in _records(b):
        columns_walk = marker >= cursor  # else a false marker inside a decoded record
        tail_walk = marker >= tail_cursor
        if not (columns_walk or tail_walk):
            continue
        got = _decode_record(b, marker, budget)
        if got is None:
            continue
        vals, end = got
        if tail_walk:
            tail_cursor = end
            tail = max(tail, end, marker)
        k = bisect_left(name_pos, marker)  # names strictly before the marker
        if columns_walk and _plausible(vals):
            cursor = end
            if k:
                out.append((marker, names[k - 1][1], vals))
                continue
        budget.refund(len(vals))  # not kept
    return out, tail


def scan_columns(b: bytes) -> list[tuple[str, NDArray[np.float64]]]:
    """Decode every ``<Book>_<Col>`` numeric column in a CPYUA ``.opju`` file.

    Records are walked in file order with a cursor: each decoded stream advances
    the cursor past its own bytes, so the false ``ff ff`` markers buried in long
    residual streams are skipped. Every real record is labelled by the nearest
    preceding length-prefixed dataset name (validated on the local corpus: the
    owning ``<Book>_<Col>`` name always leads its record). Streams that fail the
    codec or decode to garbage are dropped — never emitted.
    """
    return [(name, vals) for _, name, vals in scan_marked_columns(b)]


# One import asks for the same file's tail start several times (the worksheet
# reader's metadata lookups, then the figure reader's), and each answer costs
# a full decode pass. Remembered per file by ``(length, hash)`` — an int per
# entry, and no reference to the file's bytes is kept.
_TAIL_START_MEMO: dict[tuple[int, int], int] = {}
_TAIL_START_MEMO_MAX = 8
_TAIL_START_LOCK = threading.Lock()


def tail_start(b: bytes) -> int:
    """Byte offset just past the last decoded worksheet-data record.

    Everything before this point is the datasets section (FPC streams, whose
    residual bytes routinely contain byte pairs that coincidentally match the
    windows-section designation markers). ``windows_opju`` uses this to bound
    its marker search to the tail region, avoiding those false positives.
    """
    cached = _TAIL_START_MEMO.get((len(b), hash(b)))
    if cached is None:
        cached = _tail_start(b)
        _remember_tail(b, cached)
    return cached


def _remember_tail(b: bytes, tail: int) -> None:
    key = (len(b), hash(b))
    with _TAIL_START_LOCK:  # imports run on a thread pool
        _TAIL_START_MEMO.pop(key, None)
        while len(_TAIL_START_MEMO) >= _TAIL_START_MEMO_MAX:
            _TAIL_START_MEMO.pop(next(iter(_TAIL_START_MEMO)))
        _TAIL_START_MEMO[key] = tail


def _tail_start(b: bytes) -> int:
    end = 0
    cursor = 0
    budget = DecodeBudget()
    for marker in _records(b):
        if marker < cursor:  # a false marker inside an already-decoded record
            continue
        got = _decode_record(b, marker, budget)
        if got is None:
            continue
        cursor = got[1]
        end = max(end, cursor, marker)
    return end
