"""Header-driven decode of ``.opj`` (CPYA) datasets — typed cells, used rows.

The datasets section is ``[header][data][NULL]`` per dataset. The header
(115 B at CPYA 4.2656, 123 B at 4.2673, 140 B at 4.2878-4.2946 — the
Origin 7 and Origin 8 eras — and 147 B from 4.3116 on) states how to read
its data block, at offsets that are the SAME in all four sizes:

======  ====================================================================
0x16    type flags — ``0x20`` set on string-capable columns, ``0x02`` on the
        "half width" numerics (float32, int16)
0x17    high nibble = plot designation, LOW nibble = value kind:
        ``0`` real (or Text when 0x16 has ``0x20``), ``1`` Text & Numeric,
        ``2`` complex, ``8`` integer
0x19    u32 allocated rows
0x1D    u32 first used row
0x21    u32 used-row END (index one past the last used row)
0x3D    u8 bytes per row (1/2/4/8/10/16, wider for Text and long T&N)
0x3F    ``0x08`` = unsigned integer
0x58    NUL-terminated dataset name (``<Book>_<Col>[@sheet]``; a matrix is
        just ``<Book>[@sheet]``)
======  ====================================================================

``len(data) == allocated_rows * bytes_per_row`` holds for every worksheet
and matrix dataset in the 49-file public specimen corpus (1338 of 1358
headers; the rest are empty slots and function datasets) and is the
positive control this module decodes on: a header that parses but
whose data block is a different size (Origin's *function* datasets) is
never decoded.

Cell shapes: float64/float32/int8-16-32 little-endian; complex = two
float64; Text = NUL-terminated string; Text & Numeric = ``<u16 tag>`` then
either a float64 (tag 0) or a NUL-terminated string (tag 1) in the rest of
the row. A blank cell is the ``ORIGIN_MISSING`` double, or an empty tag-1
string (integers and float32 have no blank). Rows at or past the used-row
end are allocation, not data, and are not returned — unless one of them
holds a value, in which case the header is wrong and the value wins
(:func:`_row_range`).

Clean-room: byte layout from specimen bytes, expected VALUES from the
Altaxo / liborigin / LabPlot test suites (no GPL code consulted) — evidence
and corpus counts in ``docs/origin_project_format.md`` §3.1.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.container import ORIGIN_MISSING, salvage_column

__all__ = [
    "DatasetHeader",
    "DecodedDataset",
    "decode_dataset",
    "format_number",
    "parse_dataset_header",
]

Kind = Literal["float64", "float32", "int", "complex", "text", "text_numeric"]

_NAME_OFFSET = 0x58
_PRINTABLE = frozenset(range(0x20, 0x7F)) | frozenset(range(0xA0, 0x100))
_INLINE_PRINTABLE = frozenset(range(0x20, 0x7F))
_INT_DTYPES = {
    (1, False): "i1", (2, False): "<i2", (4, False): "<i4",
    (1, True): "u1", (2, True): "<u2", (4, True): "<u4",
}  # fmt: skip


@dataclass(frozen=True)
class DatasetHeader:
    """The fields of a dataset header this reader acts on (module docstring)."""

    name: str
    type_flags: int
    kind_flags: int
    total_rows: int
    first_row: int
    used_rows: int
    elem_size: int
    unsigned: bool

    @property
    def data_size(self) -> int:
        return self.total_rows * self.elem_size

    @property
    def kind(self) -> Kind | None:
        """The value kind, or None for a combination no oracle covers."""
        low, size = self.kind_flags & 0x0F, self.elem_size
        if low == 0x01:
            return "text_numeric" if size >= 10 else None
        if low == 0x08:
            return "int" if size in (1, 2, 4) else None
        if low == 0x02:
            return "complex" if size == 16 else None
        if low != 0x00:
            return None
        if self.type_flags & 0x20:
            return "text"
        if size == 8:
            return "float64"
        return "float32" if size == 4 else None


def parse_dataset_header(payload: bytes) -> DatasetHeader | None:
    """``payload`` as a dataset header, or None when it is not one.

    Recognition is structural, not by block size, so a future header length
    still parses: the name sits at 0x58, and the bytes that are zero in all
    1358 corpus headers (0x00-0x01, 0x12-0x13, 0x40-0x47, 0x54-0x57) are
    zero. The synthetic fixtures older tests build (a name 40 bytes in, no
    fields) fail this on length and keep the legacy content-sniffing path.

    The row counts are NOT validated here: a header whose used range does
    not fit its allocation is still a header (the walk must not lose its
    place on one); :func:`_row_range` decides what such a claim is worth.
    """
    if len(payload) < _NAME_OFFSET + 2 or payload[0] or payload[1]:
        return None
    if payload[0x12] or payload[0x13] or any(payload[0x40:0x48]) or any(payload[0x54:0x58]):
        return None
    end = payload.find(b"\x00", _NAME_OFFSET)
    if end <= _NAME_OFFSET:
        return None
    raw_name = payload[_NAME_OFFSET:end]
    if not all(c in _PRINTABLE for c in raw_name):
        return None
    total, first, used = struct.unpack_from("<III", payload, 0x19)
    elem = payload[0x3D]
    if elem == 0:
        return None
    return DatasetHeader(
        name=raw_name.decode("latin1"),
        type_flags=payload[0x16],
        kind_flags=payload[0x17],
        total_rows=total,
        first_row=first,
        used_rows=used,
        elem_size=elem,
        unsigned=bool(payload[0x3F] & 0x08),
    )


@dataclass
class DecodedDataset:
    """One dataset's cells over rows ``[0, end)`` (:func:`_row_range`).

    ``numeric`` is float64 with NaN for a blank or a text cell; ``text`` is
    one string per row (a numeric cell of a mixed column rendered by
    :func:`format_number`); ``report`` is the report-sheet bucket (see
    :func:`_decode_text_numeric`); ``imag`` the imaginary part of a complex
    column. ``problem`` set means nothing was decoded, and why.
    """

    numeric: NDArray[np.float64] | None = None
    text: list[str] | None = None
    report: list[str] | None = None
    imag: NDArray[np.float64] | None = None
    problem: str | None = None
    notes: list[str] = field(default_factory=list)


def format_number(value: float) -> str:
    """A numeric cell as text, for the text view of a mixed column: the
    shortest 15-significant-digit form (1.1 -> "1.1"), blank for NaN."""
    return "" if value != value else f"{value:.15g}"


def _cstr(row: bytes) -> str:
    return row.split(b"\x00", 1)[0].decode("latin1")


def _row_range(h: DatasetHeader, blank: NDArray[np.bool_]) -> tuple[int, int]:
    """The rows to return, as ``(first, end)``.

    The header's used range is a CLAIM, and it is only ever allowed to
    remove blank cells: ``end`` is the header's used-row end (clamped to the
    allocation), pushed out to cover the last non-blank cell if that lies
    past it; ``first`` is the header's first used row, pulled in likewise.

    In every specimen Origin wrote the claim is exact (no non-blank cell
    past a used-row end anywhere in the public corpus), so this changes
    nothing there. It matters for a header that is wrong: until 2026-11
    quantized's own ``.opj`` writer filled the allocated-row field and left
    0x21 at a template constant, so the files it wrote claim 161 used rows
    whatever they hold — and real Origin loads them in full.
    Trusting the field would truncate those; never trusting it would bring
    the allocation padding back. A value is never dropped either way.
    """
    end = min(h.used_rows, h.total_rows)
    first = min(h.first_row, end)
    filled = np.flatnonzero(~blank)
    if filled.size:
        end = max(end, int(filled[-1]) + 1)
        first = min(first, int(filled[0]))
    return first, end


def _legacy_inline_text(value: bytes) -> str | None:
    """A tag-0 cell holding text instead of a float64 — the shape
    ``container.decode_inline_text`` was pinned on (``hc2convert.opj``'s 58
    literal ``"NaN"`` columns: ``4e 61 4e 00 01 00 00 00``). No public
    specimen has it, so it is kept exactly as that decoder defined it and
    only consulted for a cell whose float64 reading is implausible."""
    nul = value.find(b"\x00")
    if nul <= 0:
        return None
    prefix, tail = value[:nul], value[nul + 1 :]
    if not all(c in _INLINE_PRINTABLE for c in prefix):
        return None
    if tail and not (tail[0] in (0x00, 0x01) and not any(tail[1:])):
        return None
    return prefix.decode("latin1")


def _wrecked(values: NDArray[np.float64]) -> NDArray[np.bool_]:
    mag = np.abs(values)
    with np.errstate(invalid="ignore"):
        out = np.isfinite(values) & (((mag < 1e-290) & (values != 0.0)) | (mag > 1e290))
    return np.asarray(out, dtype=bool)


def _checked_doubles(values: NDArray[np.float64], out: DecodedDataset) -> bool:
    """Apply the reader's standing float64 plausibility rule in place: a few
    stray denormals are blanked (``container.salvage_column``'s measured
    bound), more than that rejects the column rather than emit garbage."""
    bad = _wrecked(values)
    n_bad = int(bad.sum())
    if n_bad == 0:
        return True
    if salvage_column(values) is None:
        out.problem = f"{n_bad} implausible float64 cell(s)"
        return False
    values[bad] = np.nan
    out.notes.append(f"{n_bad} implausible float64 cell(s) blanked")
    return True


def _decode_text_numeric(h: DatasetHeader, data: bytes, out: DecodedDataset) -> None:
    """Text & Numeric: per-row ``<u16 tag>`` + float64 (0) or string (1).

    Where the cells go: no text at all -> ``numeric``; any text -> ``text``
    (plus ``numeric`` when numbers are present too, text cells NaN). The one
    exception is the pre-existing report-sheet bucket: a column WIDER than
    10 bytes whose every allocated row is a string (Origin's FitLinear/NLFit
    ``cell://...`` reference columns) stays in ``report``, as before.
    """
    size = h.elem_size
    rec = np.frombuffer(data, dtype=np.uint8).reshape(h.total_rows, size)
    tags = rec[:, 0].astype(np.uint16) | (rec[:, 1].astype(np.uint16) << 8)
    if bool(np.any(tags > 1)):
        out.problem = "unknown Text & Numeric cell tag"
        return
    is_text = tags == 1
    all_text = bool(np.all(is_text))
    values = np.ascontiguousarray(rec[:, 2:10]).view("<f8").reshape(h.total_rows).copy()
    missing = ~is_text & (values == ORIGIN_MISSING)
    _first, end = _row_range(h, np.where(is_text, rec[:, 2] == 0, missing))
    values[is_text | missing] = np.nan
    values = values[:end]
    strings: dict[int, str] = {}
    for k in np.flatnonzero(is_text & (rec[:, 2] != 0)):
        strings[int(k)] = _cstr(rec[k, 2:].tobytes())
    for k in np.flatnonzero(_wrecked(values)):
        legacy = _legacy_inline_text(rec[k, 2:10].tobytes())
        if legacy is not None:
            strings[int(k)] = legacy
            values[k] = np.nan
    if size > 10 and all_text:
        out.report = [strings.get(k, "") for k in range(end)]
        return
    if not _checked_doubles(values, out):
        return
    has_numbers = bool(np.any(np.isfinite(values)))
    if strings:
        out.text = [strings.get(k) or format_number(float(values[k])) for k in range(end)]
    if has_numbers or not strings:
        out.numeric = values


def decode_dataset(h: DatasetHeader, data: bytes) -> DecodedDataset:
    """Decode ``data`` as ``h`` describes. Never guesses: an unsupported
    kind or a size mismatch returns a :class:`DecodedDataset` whose
    ``problem`` says why and whose value fields are all None."""
    out = DecodedDataset()
    kind = h.kind
    if len(data) != h.data_size:
        out.problem = f"data block is {len(data)} B, header says {h.data_size} B"
        return out
    if kind is None:
        out.problem = (
            f"unsupported value type (flags {h.type_flags:#04x}/{h.kind_flags:#04x}, "
            f"{h.elem_size} B per row)"
        )
        return out
    total = h.total_rows
    if kind == "text_numeric":
        _decode_text_numeric(h, data, out)
    elif kind == "text":
        heads = np.frombuffer(data, dtype=np.uint8).reshape(total, h.elem_size)[:, 0]
        _first, end = _row_range(h, heads == 0)
        out.text = [_cstr(data[k * h.elem_size : (k + 1) * h.elem_size]) for k in range(end)]
    elif kind == "complex":
        pairs = np.frombuffer(data, dtype="<f8", count=2 * total).reshape(total, 2).copy()
        missing = pairs == ORIGIN_MISSING
        blank = missing[:, 0] & (missing[:, 1] | (pairs[:, 1] == 0.0))
        _first, end = _row_range(h, blank)
        pairs[missing] = np.nan
        real = np.ascontiguousarray(pairs[:end, 0])
        imag = np.ascontiguousarray(pairs[:end, 1])
        if _checked_doubles(real, out) and _checked_doubles(imag, out):
            out.numeric, out.imag = real, imag
    elif kind == "float64":
        vals = np.frombuffer(data, dtype="<f8", count=total).copy()
        missing = vals == ORIGIN_MISSING
        _first, end = _row_range(h, missing)
        vals[missing] = np.nan
        vals = vals[:end]
        if _checked_doubles(vals, out):
            out.numeric = vals
    else:
        # float32 and the integers have no blank cell: an unused row reads 0.
        # So 0 is what the row range may trim, and what a row before the
        # first used row is turned to NaN from.
        dtype = "<f4" if kind == "float32" else _INT_DTYPES[(h.elem_size, h.unsigned)]
        vals = np.frombuffer(data, dtype=dtype, count=total).astype(np.float64)
        first, end = _row_range(h, vals == 0.0)
        vals = vals[:end]
        vals[:first] = np.nan
        out.numeric = vals
    return out
