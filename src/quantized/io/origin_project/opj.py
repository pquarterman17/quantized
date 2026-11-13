"""Read Origin ``.opj`` (CPYA) projects: worksheet data + column names/units.

Each worksheet column is a dataset named ``"<Book>_<Col>[@sheet]"``; a
matrix sheet is one dataset named after its window. Since 2026-11 the
reader is **header-driven**: every dataset header states its cell type, row
width and used-row range (``opj_datasets``), ``opj_scan`` walks the
datasets section and sorts each dataset into a worksheet column, a matrix
(``opj_matrix``) or a not-imported diagnostic, and this module groups the
result into books and attaches the windows-section metadata (long names,
units, comments, X/Y designations — ``windows``).

What lands where:

* numeric cells -> ``.values`` (blank cells NaN; float32 / integer / the
  real part of a complex column widen to float64; rows past the used-row
  end are allocation and are not returned);
* text cells -> ``metadata["origin_text_columns"]: {short: [str per row]}``,
  never ``.values`` (the data contract is numeric). A Text & Numeric column
  holding BOTH gets its numbers in ``.values`` (text cells NaN) and its
  full text view in the sidecar;
* Origin's FitLinear/NLFit report-sheet reference columns
  (``"cell://Parameters.Slope.Value"``) -> ``metadata["origin_report_sheets"]``;
* a complex column's imaginary part -> ``metadata["origin_complex_imaginary"]``;
* a matrix sheet -> its own map DataStruct (X, Y, Z point cloud);
* anything not decoded -> ``metadata["origin_data_diagnostics"]``, which the
  import route merges into the project's fidelity manifest.

A project with no parseable dataset header (the synthetic fixtures older
tests build) takes the LEGACY walk, :func:`_columns` — every data block read
as 10-byte ``<mask><float64>`` records and content-sniffed for text
(``container.decode_inline_text`` / ``decode_report_strings``). It is kept
unchanged and is never used for a file the header-driven path recognises.

Column long names/units/comments and book display titles are Origin
LabTalk *label* fields — the exact same rich-text escape syntax as graph
axis titles (`figures.py`/`origin_richtext.py`), since Origin lets a user
type ``\\+(...)``/``\\g(...)``/etc. into a column's Long Name or Unit row
just as freely as into an axis title. Confirmed live in the corpus
(`MnN_Diffusion_PNR.opj`'s "Nuclear SLD" books carry a Unit of
``10\\+(-6) A\\+(-2)``): every such field is decoded through
`clean_richtext` at the one `_build_book` (``opj_books``) shared by both
`.opj` and `.opju` — the single chokepoint that also feeds every frontend
consumer of `.labels`/`.units`/`x_column_unit`/`origin_book_long`.
"""

from __future__ import annotations

import dataclasses
from collections import OrderedDict
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import (
    NAME_RE,
    decode_doubles,
    decode_inline_text,
    decode_report_strings,
    fallback,
    plausible_column,
    salvage_column,
    walk_blocks,
)
from quantized.io.origin_project.opj_books import Columns as Columns
from quantized.io.origin_project.opj_books import TextColumns as TextColumns
from quantized.io.origin_project.opj_books import _book_long_name as _book_long_name
from quantized.io.origin_project.opj_books import _build_book as _build_book
from quantized.io.origin_project.opj_books import _group as _group
from quantized.io.origin_project.opj_books import _group_named as _group_named
from quantized.io.origin_project.opj_books import _inventory as _inventory
from quantized.io.origin_project.opj_books import _label_for as _label_for
from quantized.io.origin_project.opj_matrix import matrix_books, matrix_sheets
from quantized.io.origin_project.opj_scan import (
    DatasetScan,
    Problem,
    scan_datasets,
    summarize_problems,
)
from quantized.io.origin_project.opj_sheets import (
    WindowSheet,
    bind_worksheets,
    book_key,
    sole_sheet_books,
    window_sheets,
)
from quantized.io.origin_project.windows import BookMeta, ColumnMeta, window_metadata

__all__ = [
    "build_opj_books",
    "build_opj_primary",
    "parse_opj",
    "read_opj",
    "read_opj_books",
]


def _columns(
    b: bytes,
) -> tuple[
    list[tuple[str, NDArray[np.float64]]], list[tuple[str, list[str]]], list[tuple[str, list[str]]]
]:
    """Walk the datasets section, pairing each named header block with its data.

    Returns ``(numeric_columns, text_columns, report_columns)``. A data block
    that isn't a plausible double column (see `plausible_column`/
    `_looks_textual`) is tried as short inline text (`decode_inline_text`),
    then — if that overflows — as a wider report-sheet record
    (`decode_report_strings`, plan item 4's FitLinear/NLFit residue);
    anything matching none of the three shapes is dropped exactly as before
    (honest-absent, never garbage).
    """
    numeric: list[tuple[str, NDArray[np.float64]]] = []
    text: list[tuple[str, list[str]]] = []
    report: list[tuple[str, list[str]]] = []
    pending: str | None = None
    for size, payload in walk_blocks(b):
        if size == 0:
            continue
        if size % 10 != 0:  # a column-header block (never a multiple of 10)
            m = NAME_RE.search(payload)
            pending = m.group(1).decode("latin1") if m else pending
        elif pending is not None and size >= 10:  # the paired data block
            vals = decode_doubles(payload)
            # Non-double columns (text/int — plan item 4) reinterpret as float64
            # garbage; drop them rather than emit nonsense. Two tells: absurd
            # magnitudes (int/float32 payloads) and a printable-ASCII payload
            # (text — real float64 arrays run ~35-40% printable bytes, text
            # >90%). All-NaN stays (empty columns are real).
            if plausible_column(vals, allow_all_nan=True) and not _looks_textual(payload):
                numeric.append((pending, vals))
            elif (rows := decode_inline_text(payload)) is not None:
                text.append((pending, rows))
            elif (rows := decode_report_strings(payload)) is not None:
                report.append((pending, rows))
            elif (salvaged := salvage_column(vals)) is not None:
                # Last resort, ORDER MATTERS: only after the text/report
                # decoders pass — a real double column with a couple of stray
                # junk cells (XRD Book6_A) is salvaged with those cells NaN'd;
                # the report-sheet family must never be stolen into numeric.
                numeric.append((pending, salvaged))
            pending = None
    return numeric, text, report


_PRINTABLE = frozenset(range(0x20, 0x7F)) | {0x09, 0x0A, 0x0D}


def _looks_textual(payload: bytes) -> bool:
    """True when a data block's bytes read as text, not float64 records.

    Two signals must agree: the *non-zero* bytes are across-the-board
    printable (text; float64 mantissa/exponent bytes run well under half —
    but a short column of round values like 10.0 → ``24 40`` can also be
    all-printable), AND the 10-byte record structure is absent — numeric
    records open with a ``00 00`` mask word, text blocks put letters there.
    """
    sample = payload[:400]
    nonzero = [c for c in sample if c != 0]
    if len(nonzero) < 8:
        return False
    if sum(c in _PRINTABLE for c in nonzero) < 0.9 * len(nonzero):
        return False
    n_rec = len(sample) // 10
    masked = sum(1 for k in range(n_rec) if sample[10 * k] == 0 and sample[10 * k + 1] == 0)
    return masked < 0.5 * n_rec


@dataclass
class _ParseResult:
    """One parsed project: column groups per book, window metadata, the
    book inventory, and (header-driven files only) matrices + diagnostics."""

    books: OrderedDict[str, Columns]
    text_books: OrderedDict[str, TextColumns]
    report_books: OrderedDict[str, TextColumns]
    books_meta: dict[str, BookMeta]
    inventory: list[dict[str, object]]
    imag_books: OrderedDict[str, Columns] = field(default_factory=OrderedDict)
    matrices: list[DataStruct] = field(default_factory=list)
    diagnostics: dict[str, object] | None = None
    # True when the datasets were decoded from their headers; False on the
    # legacy content-sniffing walk (which keeps its old book assembly too).
    header_driven: bool = False
    # Header-driven only: each book key's column metadata (its bound
    # sheet's), the book keys with a column that could not be decoded, and
    # whether a dataset was lost with no name to say whose it was.
    sheet_columns: dict[str, dict[str, ColumnMeta]] = field(default_factory=dict)
    lost_books: set[str] = field(default_factory=set)
    unowned_loss: bool = False
    # Book key -> the sheet id its datasets carry, for a one-sheet book
    # named as the book (`opj_sheets.sole_sheet_books`), so the `@N` is not lost.
    sheet_ids: dict[str, str] = field(default_factory=dict)


_LEGACY_NOTICE = (
    "this file's datasets have no readable headers: columns were recovered by "
    "inspecting their bytes, so values and column types may be unreliable"
)


_T = TypeVar("_T")


def _rekey(d: Mapping[str, _T], names: dict[str, str]) -> OrderedDict[str, _T]:
    return OrderedDict((names.get(k, k), v) for k, v in d.items())


def _sheet_columns(
    scan: DatasetScan, sheets: dict[str, list[WindowSheet]]
) -> tuple[dict[str, dict[str, ColumnMeta]], set[str]]:
    """``(book key -> its sheet's column metadata, book keys whose first
    column was lost)`` for a header-driven project.

    Each book key (``Book`` / ``Book@N``) takes the columns of the sheet
    its id is bound to (``opj_sheets``); one that cannot be bound gets none
    and is reported. Metadata for a column that names no dataset is
    forgotten (:func:`_drop_unbacked_columns` says why) — unless a dataset
    was lost without a name, when the missing dataset may be that one.

    A book key is in the second result when a column that could not be
    decoded comes BEFORE its first decoded numeric column: with no
    designation to go by, "the first column is X" would then promote a
    column that is not the first.
    """
    bound, unbound = bind_worksheets(scan.headers, sheets)
    columns: dict[str, dict[str, ColumnMeta]] = {key: {} for key in unbound}
    for key in unbound:
        scan.problems.append(
            Problem("sheet", key, "its sheet could not be identified among its window's sheets")
        )
    for key, sheet in bound.items():
        book, at, sheet_no = key.partition("@")
        columns[key] = {
            c: m
            for c, m in sheet.columns.items()
            if scan.unowned_losses or f"{book}_{c}{at}{sheet_no}" in scan.names
        }
    position = {name: k for k, name in reversed(list(enumerate(scan.order)))}
    first_decoded: dict[str, int] = {}
    for name, _values in scan.numeric:
        if (parsed := book_key(name)) is not None:
            first_decoded.setdefault(parsed[1], position.get(name, 0))
    lost = {
        parsed[1]
        for p in scan.problems
        if p.category == "column"
        and (parsed := book_key(p.dataset)) is not None
        and position.get(p.dataset, 0) < first_decoded.get(parsed[1], len(scan.order))
    }
    return columns, lost


def _drop_unbacked_columns(books_meta: dict[str, BookMeta], names: set[str]) -> None:
    """Forget window metadata for a column that names no dataset in the file.

    Column ``S`` of book ``B`` is the dataset ``"B_S"`` (``windows`` module
    docstring). Where no such dataset exists the join has failed — Origin
    truncates a property block's short name to 11 characters while the
    dataset keeps a disambiguating suffix (liborigin's
    ``column-dataid-collision`` specimen: two columns, one truncated name) —
    and metadata that joins nothing must not act: left in, a designated-X
    entry would read as "the X column failed to decode" and replace the
    book's real X with a row index. A column whose dataset exists but could
    NOT be decoded stays (its name is in ``names``): that is the case the
    row-index fallback is for.
    """
    for book, meta in books_meta.items():
        meta.columns = {c: m for c, m in meta.columns.items() if f"{book}_{c}" in names}


def _parse(path: Path, *, raw: bytes | None = None) -> _ParseResult:
    """Decode the project once: numeric/text/report column groups + window
    metadata. ``raw`` lets a caller that already has the file's bytes (e.g.
    :func:`parse_opj`'s callers in ``origin_project/__init__.py``) skip a
    second disk read; ``None`` (the default) reads ``path`` itself, unchanged
    from before."""
    b = path.read_bytes() if raw is None else raw
    if not b.startswith(b"CPYA"):
        raise fallback(path, f"'{path.name}' does not look like a CPYA .opj (bad header).")
    blocks = list(walk_blocks(b))
    sheets = matrix_sheets(blocks)
    scan = scan_datasets(blocks, sheets.keys())
    header_driven = scan.n_headers > 0
    sheet_columns: dict[str, dict[str, ColumnMeta]] = {}
    lost_books: set[str] = set()
    sole: dict[str, str] = {}
    if header_driven:
        columns, text_columns, report_columns = scan.numeric, scan.text, scan.report
        worksheets = window_sheets(blocks)
        sheet_columns, lost_books = _sheet_columns(scan, worksheets)
        sole = sole_sheet_books(scan.names, worksheets)
    else:
        # No dataset header parsed: the legacy walk guesses each column's
        # type from its bytes. Say so wherever the data goes.
        scan.problems.append(Problem("notice", "", _LEGACY_NOTICE))
        columns, text_columns, report_columns = _columns(b)
        if not columns:
            raise fallback(path, f"no worksheet columns could be decoded from '{path.name}'.")
    del blocks
    books = _group(columns)
    text_books = _group_named(text_columns)
    report_books = _group_named(report_columns)
    imag_books = _group(scan.imag)
    if header_driven and sole:
        books, text_books = _rekey(books, sole), _rekey(text_books, sole)
        report_books, imag_books = _rekey(report_books, sole), _rekey(imag_books, sole)
        sheet_columns = dict(_rekey(sheet_columns, sole))
        lost_books = {sole.get(k, k) for k in lost_books}
    books_meta = window_metadata(b)
    if header_driven:
        _drop_unbacked_columns(books_meta, scan.names)
    inventory = _inventory(books, books_meta, report_books)
    if header_driven:  # a book whose columns are all text is a book too
        inventory += [
            {"name": k, "long_name": _book_long_name(k, books_meta), "ncols": len(v),
             "nrows": max((len(rows) for _, rows in v), default=0)}
            for k, v in text_books.items()
            if k not in books and k not in report_books
        ]  # fmt: skip
    matrices = matrix_books(scan, sheets, books_meta, inventory)
    diagnostics = summarize_problems(scan.problems)
    if not (books or text_books or report_books or matrices):
        lost = "; ".join(diagnostics["omissions"]) if diagnostics else ""  # type: ignore[arg-type]
        raise fallback(
            path,
            f"no worksheet or matrix data could be decoded from '{path.name}'"
            + (f" ({lost})." if lost else "."),
        )
    return _ParseResult(
        books, text_books, report_books, books_meta, inventory,
        imag_books, matrices, diagnostics, header_driven,
        sheet_columns, lost_books, scan.unowned_losses > 0,
        {book: key.partition("@")[2] for key, book in sole.items()},
    )  # fmt: skip


def _primary_key(books: OrderedDict[str, Columns]) -> str:
    """The book :func:`read_opj`/:func:`build_opj_primary` treat as *the*
    primary dataset: the largest workbook by total (pre-padding) column
    length, never a sheet pseudo-book (``Book@N``) unless every book is one.

    Extracted from ``read_opj`` so a single :func:`_parse`/:func:`parse_opj`
    result can serve both the primary DataStruct and the full per-book list
    (:func:`build_opj_books`) without parsing the project twice — the routes
    import path (``read_origin_project_all``) needs both.
    """
    primary_pool = [k for k in books if "@" not in k] or list(books)
    return max(primary_pool, key=lambda k: sum(len(v) for _, v in books[k]))


def parse_opj(path: Path, *, raw: bytes | None = None) -> _ParseResult:
    """Public single-parse entry point: the same intermediate :func:`_parse`
    produces, exposed so a caller that needs BOTH the primary book
    (:func:`build_opj_primary`) and every book (:func:`build_opj_books`) —
    the routes import path — can parse the project once and build each
    independently, instead of each of :func:`read_opj`/:func:`read_opj_books`
    parsing it on their own."""
    return _parse(path, raw=raw)


def _has_numbers(columns: Columns) -> bool:
    return any(bool(np.isfinite(v).any()) for _, v in columns)


def _book(parsed: _ParseResult, key: str) -> DataStruct:
    """One worksheet book of a parsed project."""
    book = _build_book(
        key,
        parsed.books.get(key, []),
        parsed.books_meta,
        parsed.inventory,
        text_cols=parsed.text_books.get(key),
        report_cols=parsed.report_books.get(key),
        row_aligned_text=parsed.header_driven,
        imag_cols=parsed.imag_books.get(key),
        sheet_columns=parsed.sheet_columns.get(key, {}) if parsed.header_driven else None,
        lost_columns=parsed.unowned_loss or key in parsed.lost_books,
    )
    if parsed.header_driven:
        if key in parsed.sheet_ids:
            book = dataclasses.replace(
                book, metadata={**book.metadata, "origin_sheet_id": parsed.sheet_ids[key]}
            )
        return book
    # The legacy walk: every book it yields carries the caveat.
    return dataclasses.replace(
        book, metadata={**book.metadata, "origin_decode": "content_sniffing"}
    )


def _with_diagnostics(ds: DataStruct, parsed: _ParseResult) -> DataStruct:
    """Attach the project's data diagnostics. They are project-global, so
    (like the results log) they ride the primary DataStruct and the first
    book of the list, not every book."""
    if parsed.diagnostics is None:
        return ds
    meta = {**ds.metadata, "origin_data_diagnostics": parsed.diagnostics}
    return dataclasses.replace(ds, metadata=meta)


def build_opj_primary(parsed: _ParseResult) -> DataStruct:
    """Build the primary (largest) book's DataStruct from an already-
    :func:`parse_opj`'d project — the same selection :func:`read_opj`
    performs, factored out so it can share a parse with
    :func:`build_opj_books`.

    The largest book can be one that holds no number at all — rows are the
    USED rows now, so Origin's untouched default ``Book1`` is zero rows
    long, where the whole-allocation reader made it 30 rows of blanks. A
    header-driven project therefore prefers, in order: the largest
    worksheet book that has numbers (sheet-1 books first, as ever), the
    largest matrix, then the first book of any kind."""
    key = _primary_key(parsed.books) if parsed.books else None
    if key is not None and parsed.header_driven and not _has_numbers(parsed.books[key]):
        populated = OrderedDict((k, v) for k, v in parsed.books.items() if _has_numbers(v))
        if populated:
            key = _primary_key(populated)
        elif parsed.matrices:
            key = None
    if key is not None:
        return _with_diagnostics(_book(parsed, key), parsed)
    if parsed.matrices:
        return _with_diagnostics(max(parsed.matrices, key=lambda m: m.n_points), parsed)
    return _with_diagnostics(
        _book(parsed, next(iter([*parsed.text_books, *parsed.report_books]))), parsed
    )


def build_opj_books(parsed: _ParseResult) -> list[DataStruct]:
    """Build every book's DataStruct from an already-:func:`parse_opj`'d
    project — identical construction (and order) to :func:`read_opj_books`,
    factored out so it can share a parse with :func:`build_opj_primary`.

    A sheet made entirely of report-sheet columns (plan item 4 — e.g. a fit's
    "FitNL1" report) has no plausible-numeric columns at all, so it never
    appears as a key in ``books``; the union with ``report_books`` (and
    ``text_books``, for the analogous inline-text case) below still surfaces
    it as its own pseudo-book rather than dropping the whole sheet. Matrix
    books follow the worksheet books.
    """
    books, text_books, report_books = parsed.books, parsed.text_books, parsed.report_books
    keys = list(books)
    keys += [k for k in text_books if k not in books and k not in keys]
    keys += [k for k in report_books if k not in books and k not in keys]
    out = [
        _book(parsed, k)
        for k in keys
        if books.get(k) or text_books.get(k) or report_books.get(k)
    ]
    out += parsed.matrices
    if out:
        out[0] = _with_diagnostics(out[0], parsed)
    return out


def read_opj(path: Path) -> DataStruct:
    """The single-DataStruct contract: the largest workbook (inventory in metadata).

    Extra-sheet pseudo-books (``Book@N`` — often fit tables/curves) never win
    the primary slot over measured sheet-1 data, however large they are.
    """
    return build_opj_primary(_parse(path))


def read_opj_books(path: Path) -> list[DataStruct]:
    """Every workbook in the project as its own DataStruct (plan item 3).

    A sheet made entirely of report-sheet columns (plan item 4 — e.g. a fit's
    "FitNL1" report) has no plausible-numeric columns at all, so it never
    appears as a key in ``books``; the union with ``report_books`` (and
    ``text_books``, for the analogous inline-text case) below still surfaces
    it as its own pseudo-book rather than dropping the whole sheet.
    """
    return build_opj_books(_parse(path))
