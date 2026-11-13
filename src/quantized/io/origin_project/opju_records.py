"""CPYUA (``.opju``) dataset *records*: the structural worksheet-column decode.

Where ``opju_codec.scan_columns`` historically found a column by scanning for
one byte signature (``0a 05 <rows> ff ff``) and so saw only all-numeric
Text&Numeric columns, this module starts from the column's own storage header
(``opju_blocks.find_headers``) and decodes the record that header describes,
whatever its storage class. Every rule below was read off byte evidence and
confirmed against an independent value oracle — the third-party paired
``.opj``/``.opju`` test projects and their published expected values
(``docs/origin_project_format.md`` §3.5 lists which specimen proves which
rule). Nothing here is copied from another reader's source.

Record framing (after the header's token stream)::

    [18 | u64 24 | u64 body_len | u64 checksum]   # absent before build 4.33
    <0a | 00> <mode: 04 | 05> <rows:varint> <body>

``body_len`` counts from the mode byte to the body's last byte, which makes a
decode *provable*: a body that does not end exactly there is rejected. The
block is filled with ``0x22`` for the storage classes that carry no length
(fixed-width integers, float32, Text); builds before 4.33 have no block at
all, so their records are accepted on grammar alone and reported as
``grammar_only`` confidence.

Bodies, by storage class (header byte 0x17 + element width):

* **Text&Numeric** (width 10) — a stream of cells until ``rows`` are
  consumed, then the terminator ``ce fa``. A cell opens with a u16:
  ``00 00`` one numeric value-spec; ``01 00`` one text reference (varint);
  ``ff ff <n:varint> <kind>`` a run of n cells — kind ``00`` a float64
  segment list (``opju_values.read_segments``), kind ``01`` a text-reference
  segment list (ZigZag varint: −m = m varint references, +k = k copies of
  one). A reference is 1 + the string's byte offset in the column's string
  heap; 0 is an empty cell.
* **double** (width 8) — one float64 segment list, no cell framing.
* **complex** (width 16) — the same with two doubles per row.
* **float32 / int8 / int16 / uint8 / uint16** — ZigZag-counted segments of
  raw little-endian elements: −m = m elements, +k = k copies of one.
* **int32 / uint32** — the same counts, each element a varint (ZigZag-coded
  when signed).
* **Text** (any other width) — ``rows`` length-prefixed byte strings.

The *used-row extent* comes from the header, not the body: Origin allocates
rows ahead of the data (a 3-row column is stored as 32), so the decoded cells
are cut at ``used_rows`` and an unfilled tail never becomes data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.container import plausible_column
from quantized.io.origin_project.opju_blocks import DatasetHeader, find_headers, lz4_block
from quantized.io.origin_project.opju_codec import (
    CodecError,
    DecodeBudget,
    _read_varint,
    _zigzag,
)
from quantized.io.origin_project.opju_values import read_segments, read_value

__all__ = ["BUDGET_REASON", "DatasetRecord", "decode_record", "orphan_records", "scan_records"]

BUDGET_REASON = "exceeds the import's decode budget"

Confidence = Literal["length_checked", "grammar_only"]

_B18 = b"\x18\x18" + b"\x00" * 7  # block length 24, then u64 24
_NO_LEN = b"\x22" * 8
_TERMINATOR = b"\xce\xfa"
_HEAP_NAME = b"#_MSER_STRINGS_PSET"
_HEAP_MAGIC = b"\x77\x11\x11\x11"
_MAX_ROWS = 50_000_000
# A string heap is an LZ4 block, which cannot expand more than 255-fold (one
# match byte per 255 of output); a declared size past that, or past this
# absolute cap, is not a heap this reader materializes.
_LZ4_MAX_RATIO = 255
_MAX_HEAP = 1 << 26


@dataclass(frozen=True)
class DatasetRecord:
    """The outcome of decoding one dataset header's record.

    ``form`` names the storage class that was recognized; ``reason`` is set
    (and ``values``/``text`` are None) when the record was NOT decoded —
    undecoded records are reported, never guessed at.
    """

    header: DatasetHeader
    form: str
    end: int
    values: NDArray[np.float64] | None = None
    text: list[str] | None = None
    confidence: Confidence = "grammar_only"
    reason: str | None = None
    extra: dict[str, object] = field(default_factory=dict)

    @property
    def decoded(self) -> bool:
        return self.reason is None


class _Reject(Exception):
    """A record that does not parse under its header's grammar."""


def _varint(b: bytes, p: int) -> tuple[int, int]:
    try:
        return _read_varint(b, p)
    except CodecError as exc:
        raise _Reject("varint ran off the buffer") from exc


def _form_of(h: DatasetHeader) -> str:
    """The storage class a header declares (see the module docstring)."""
    kb, sz = h.kind_bits & 0x0B, h.value_size
    if kb & 0x01:
        return "text_numeric" if sz == 10 else "report"
    if kb & 0x02:
        return "complex" if sz == 16 else "unknown"
    if kb & 0x08:
        return "integer" if sz in (1, 2, 4) else "unknown"
    if sz == 8:
        return "double"
    if sz == 4:
        return "float32"
    return "text" if sz else "unknown"


def _text_refs(b: bytes, p: int, n: int) -> tuple[list[int], int]:
    """A text-reference segment list covering exactly ``n`` cells."""
    refs: list[int] = []
    while len(refs) < n:
        raw, p = _varint(b, p)
        count = _zigzag(raw)
        if count == 0 or len(refs) + abs(count) > n:
            raise _Reject("text-reference run overruns its cell count")
        if count > 0:
            ref, p = _varint(b, p)
            refs.extend([ref] * count)
        else:
            for _ in range(-count):
                ref, p = _varint(b, p)
                refs.append(ref)
    return refs, p


def _cells(
    b: bytes, p: int, rows: int
) -> tuple[NDArray[np.float64], NDArray[np.int64], NDArray[np.bool_], int]:
    """Decode a Text&Numeric cell stream; return ``(values, refs, is_text, end)``.

    ``values`` is NaN wherever the cell is text or empty; ``refs`` holds the
    string-heap reference of each text cell (0 elsewhere).
    """
    values = np.full(rows, np.nan)
    refs = np.zeros(rows, dtype=np.int64)
    is_text = np.zeros(rows, dtype=bool)
    i = 0
    while i < rows:
        if p + 2 > len(b):
            raise _Reject("cell stream ran off the buffer")
        kind = b[p] | (b[p + 1] << 8)
        p += 2
        if kind == 0x0000:
            got = read_value(b, p)
            if got is None:
                raise _Reject(f"unknown value tag 0x{b[p]:02x}" if p < len(b) else "truncated")
            values[i], p = got
            i += 1
        elif kind == 0x0001:
            refs[i], p = _varint(b, p)
            is_text[i] = True
            i += 1
        elif kind == 0xFFFF:
            n, p = _varint(b, p)
            if n == 0 or i + n > rows or p >= len(b):
                raise _Reject("cell run overruns the row count")
            run_kind = b[p]
            p += 1
            if run_kind == 0x00:
                seg = read_segments(b, p, n)
                if seg is None:
                    raise _Reject("numeric run does not parse")
                values[i : i + n], p = seg
            elif run_kind == 0x01:
                refs[i : i + n], p = _text_refs(b, p, n)
                is_text[i : i + n] = True
            else:
                raise _Reject(f"unknown cell-run kind 0x{run_kind:02x}")
            i += n
        else:
            raise _Reject(f"unknown cell kind 0x{kind:04x}")
    if b[p : p + 2] != _TERMINATOR:
        raise _Reject("cell stream is not closed by ce fa")
    return values, refs, is_text, p + 2


def _fixed(b: bytes, p: int, rows: int, h: DatasetHeader) -> tuple[NDArray[np.float64], int]:
    """float32 / integer columns: ZigZag-counted raw (or varint) elements."""
    integer = bool(h.kind_bits & 0x08)
    size = h.value_size
    varint_coded = integer and size == 4
    if integer:
        dtype = np.dtype(f"<{'u' if h.unsigned else 'i'}{size}")
    else:
        dtype = np.dtype("<f4")

    def element(q: int) -> tuple[float, int]:
        if varint_coded:
            raw, q = _varint(b, q)
            return float(raw if h.unsigned else _zigzag(raw)), q
        if q + size > len(b):
            raise _Reject("element ran off the buffer")
        return float(np.frombuffer(b, dtype=dtype, count=1, offset=q)[0]), q + size

    out = np.empty(rows)
    i = 0
    while i < rows:
        raw, p = _varint(b, p)
        count = _zigzag(raw)
        if count == 0 or i + abs(count) > rows:
            raise _Reject("element run overruns the row count")
        if count > 0:
            out[i : i + count], p = element(p)
        elif varint_coded:
            for k in range(-count):
                out[i + k], p = element(p)
        else:
            nbytes = -count * size
            if p + nbytes > len(b):
                raise _Reject("element block ran off the buffer")
            out[i : i - count] = np.frombuffer(b, dtype=dtype, count=-count, offset=p)
            p += nbytes
        i += abs(count)
    return out, p


def _text_rows(b: bytes, p: int, rows: int, width: int) -> tuple[list[str], int]:
    """A Text column: ``rows`` length-prefixed strings (0 = empty cell)."""
    out: list[str] = []
    for _ in range(rows):
        n, p = _varint(b, p)
        if n >= width or p + n > len(b):
            raise _Reject("text cell longer than the column width")
        raw = b[p : p + n]
        # Text is the one class with no length field and no terminator, so
        # its cells carry the validation: a control byte (NUL included) means
        # this is not a Text record.
        if any(c < 0x20 and c not in (0x09, 0x0A, 0x0D) for c in raw):
            raise _Reject("control byte inside a text cell")
        out.append(_decode_text(raw))
        p += n
    return out, p


def _decode_text(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin1")


def _string_heap(b: bytes, p: int) -> bytes | None:
    """The column's string heap, from the attachment block that follows a
    mode-``04`` record, or None when it is absent/malformed.

    The attachment is ``<length:varint> <entries>``; a column can carry
    several named entries (``SYSTEM``, ``_Storage_Cell_Ref_Data_`` …), so the
    heap entry is located by its name *within the declared length*, never
    beyond it. Entry layout: ``#_MSER_STRINGS_PSET 05 01 <n:varint> 00 <u32
    size>`` then an ``n − 4``-byte LZ4 block expanding to ``size`` bytes: magic
    ``77 11 11 11``, 20 header bytes (the u32 at +16 is the heap's byte
    length), then the NUL-terminated strings a cell reference indexes
    (reference − 1 = byte offset).
    """
    try:
        length, start = _read_varint(b, p)
    except CodecError:
        return None
    stop = min(len(b), start + length)
    at = b.find(_HEAP_NAME + b"\x05\x01", start, stop)
    if at < 0:
        return None
    try:
        n, q = _read_varint(b, at + len(_HEAP_NAME) + 2)
    except CodecError:
        return None
    if n < 5 or q + 1 + n > stop or b[q] != 0x00:
        return None
    size = int.from_bytes(b[q + 1 : q + 5], "little")
    if size > min(_MAX_HEAP, _LZ4_MAX_RATIO * (n - 4)):
        return None
    raw = lz4_block(b[q + 5 : q + 1 + n], size)
    if raw is None or len(raw) < 24 or raw[:4] != _HEAP_MAGIC:
        return None
    heap_len = int.from_bytes(raw[16:20], "little")
    if 24 + heap_len > len(raw):
        return None
    return raw[24 : 24 + heap_len]


def _resolve(
    refs: NDArray[np.int64], is_text: NDArray[np.bool_], heap: bytes | None
) -> list[str] | None:
    """Text for every cell (``""`` for numeric/empty), or None if any
    reference cannot be resolved against the heap."""
    out: list[str] = []
    seen: dict[int, str] = {}  # a repeated reference shares one string
    for ref, text in zip(refs.tolist(), is_text.tolist(), strict=True):
        if not text or ref == 0:
            out.append("")
            continue
        got = seen.get(ref)
        if got is None:
            if heap is None or ref > len(heap):
                return None
            nul = heap.find(b"\x00", ref - 1)
            if nul < 0:
                return None
            got = seen[ref] = _decode_text(heap[ref - 1 : nul])
        out.append(got)
    return out


def decode_record(b: bytes, h: DatasetHeader, budget: DecodeBudget | None = None) -> DatasetRecord:
    """Decode the record that follows header ``h`` (never raises).

    With a ``budget``, a record whose declared cells do not fit what is left
    of it is refused (reported, with that reason) before anything is
    allocated; a record that is then rejected gives its cells back."""
    form = _form_of(h)
    p = h.end
    declared_end: int | None = None
    has_block = b[p : p + 9] == _B18
    if has_block:
        if b[p + 9 : p + 17] != _NO_LEN:
            declared_end = p + 26 + int.from_bytes(b[p + 9 : p + 17], "little")
        p += 25
    if p + 3 > len(b) or b[p] not in ((0x0A,) if has_block else (0x00, 0x0A)):
        return DatasetRecord(h, form, h.end, reason="no record lead after the header")
    mode = b[p + 1]
    if mode not in (0x04, 0x05):
        return DatasetRecord(h, form, h.end, reason=f"unknown record mode 0x{mode:02x}")
    try:
        rows, q = _varint(b, p + 2)
        if rows == 1 and h.total_rows > 1:
            # A function plot (`F1`: its record is the formula text) or a
            # virtual-matrix series (`VM…`): the header declares a length the
            # record does not store. Not worksheet cells.
            raise _Reject("virtual or function dataset: no stored cells")
        if rows != h.total_rows or rows > _MAX_ROWS:
            raise _Reject(f"record rows {rows} != header rows {h.total_rows}")
    except _Reject as exc:
        return DatasetRecord(h, form, h.end, reason=str(exc))
    cells = rows * (2 if form == "complex" else 1)
    if budget is not None and not budget.charge(cells):
        return DatasetRecord(h, form, h.end, reason=BUDGET_REASON)
    try:
        return _decode_body(b, h, form, q, rows, declared_end)
    except _Reject as exc:
        if budget is not None:
            budget.refund(cells)
        return DatasetRecord(h, form, h.end, reason=str(exc))


def _kept(a: NDArray[np.float64], used: int) -> NDArray[np.float64]:
    """The used extent of ``a`` — a copy when it is shorter, so the unused
    allocated tail is not kept alive by a view."""
    return a if used >= len(a) else a[:used].copy()


def _decode_body(
    b: bytes, h: DatasetHeader, form: str, q: int, rows: int, declared_end: int | None
) -> DatasetRecord:
    used = min(h.used_rows, rows)
    values: NDArray[np.float64] | None = None
    text: list[str] | None = None
    extra: dict[str, object] = {}
    stale = 0  # filled cells BEYOND the used-row extent (never emitted)
    if form == "text_numeric":
        cells, refs, is_text, end = _cells(b, q, rows)
        values = _kept(cells, used)
        stale = int(np.count_nonzero(np.nan_to_num(cells[used:]))) + int(
            np.count_nonzero(refs[used:])
        )
        if refs[:used].any():
            text = _resolve(refs[:used], is_text[:used], _string_heap(b, end))
            if text is None:
                extra["text_unresolved"] = int(np.count_nonzero(refs[:used]))
    elif form in ("double", "complex"):
        width = 2 if form == "complex" else 1
        seg = read_segments(b, q, rows, width)
        if seg is None:
            raise _Reject("float64 segment list does not parse")
        flat, end = seg
        stale = int(np.count_nonzero(np.nan_to_num(flat[used * width :])))
        if width == 2:
            pairs = flat.reshape(rows, 2)
            values = pairs[:used, 0].copy()
            extra["imaginary"] = pairs[:used, 1].copy()
        else:
            values = _kept(flat, used)
    elif form in ("float32", "integer"):
        flat, end = _fixed(b, q, rows, h)
        stale = int(np.count_nonzero(flat[used:]))
        values = _kept(flat, used)
    elif form == "text":
        rows_text, end = _text_rows(b, q, rows, h.value_size)
        stale = sum(1 for t in rows_text[used:] if t)
        text = rows_text[:used]
    else:
        raise _Reject(f"storage class not decoded ({form}, width {h.value_size})")
    if stale:
        extra["stale_cells"] = stale
    if declared_end is not None and end != declared_end:
        raise _Reject("body does not end at its declared length")
    # A length-checked body is proven by its own framing; the magnitude gate
    # exists for the builds with no length field, where a desynchronized
    # parse could otherwise pass on grammar alone. (It must NOT run on a
    # length-checked column: real data does reach below 1e-290, measured in
    # the public corpus.)
    if (
        declared_end is None
        and values is not None
        and not plausible_column(values, allow_all_nan=True)
    ):
        raise _Reject("decoded values are not plausible doubles")
    return DatasetRecord(
        h,
        form,
        end,
        values=values,
        text=text,
        confidence="length_checked" if declared_end is not None else "grammar_only",
        extra=extra,
    )


def scan_records(b: bytes, unread: list[tuple[str, int]] | None = None) -> list[DatasetRecord]:
    """Decode every dataset record in ``b``, in file order, within one
    :class:`~quantized.io.origin_project.opju_codec.DecodeBudget`.
    ``unread`` collects the headers ``find_headers`` saw but does not read."""
    budget = DecodeBudget()
    return [decode_record(b, h, budget) for h in find_headers(b, unread)]


def orphan_records(b: bytes, header_ends: set[int]) -> int:
    """How many dataset records (a 4.33+ length block, then the ``0a 04|05``
    record lead) do NOT follow any header in ``header_ends`` — records whose
    header was not recognized at all (a damaged file), which would otherwise
    vanish without a trace. In every intact project of the public corpus,
    each such block follows a header (read or reported)."""
    count = 0
    p = b.find(_B18)
    while p >= 0:
        if p not in header_ends and b[p + 25 : p + 26] == b"\x0a" and b[p + 26 : p + 27] in (
            b"\x04",
            b"\x05",
        ):
            count += 1
        p = b.find(_B18, p + 1)
    return count
