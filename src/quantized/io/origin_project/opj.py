"""Read Origin ``.opj`` (CPYA) projects: worksheet data + column names/units.

M1 recovered the numeric columns (datasets named ``"<Book>_<Col>"``, 10-byte
``<mask><float64>`` records); this adds the windows-section metadata (plan
item 2): real column long names, units, comments, and X/Y designations. The
largest book returns as the :class:`~quantized.datastruct.DataStruct` (every
book's inventory stays in metadata; per-book selection is plan item 3/16).

Plan item 4 (non-double column value types) adds inline-text column decode:
a "Text & Numeric" column reuses the same 10-byte record as a double column,
but its 8-byte value area holds a short NUL-terminated string instead of a
raw float64 (`container.decode_inline_text`). Decoded text columns never
enter `.values` (the data contract is numeric); they attach to metadata as
`origin_text_columns: {short_name: [str, ...]}`. A column that overflows
`decode_inline_text`'s 8-byte value area (Origin's FitLinear/NLFit
auto-generated report-sheet columns, e.g. `"cell://Parameters.Slope.Value"`)
gets a second try via `container.decode_report_strings` — a wider,
column-specific record width — attaching to
`origin_report_sheets: {short_name: [str, ...]}`. Whatever fits neither
shape keeps the honest drop.
"""

from __future__ import annotations

from collections import OrderedDict
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
    walk_blocks,
)
from quantized.io.origin_project.windows import BookMeta, ColumnMeta, window_metadata

__all__ = ["read_opj", "read_opj_books"]

_V = TypeVar("_V")


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


def _label_for(col: str, meta: ColumnMeta | None) -> str:
    return meta.long_name if meta is not None and meta.long_name else col


Columns = list[tuple[str, NDArray[np.float64]]]
TextColumns = list[tuple[str, list[str]]]


def _group_named(pairs: list[tuple[str, _V]]) -> OrderedDict[str, list[tuple[str, _V]]]:
    """Group ``<Book>_<Col>[@sheet]`` names into per-book column lists.

    Shared by numeric column grouping (`_group`) and text column grouping —
    the naming/sheet rule doesn't care what a column's values look like.
    """
    books: OrderedDict[str, list[tuple[str, _V]]] = OrderedDict()
    for name, vals in pairs:
        book, _, col = name.rpartition("_")
        col, _, sheet = (col or "A").partition("@")
        if sheet:  # sheet N>1 becomes its own pseudo-book "<Book>@N"
            book = f"{book or 'Book'}@{sheet}"
        books.setdefault(book or "Book", []).append((col or "A", vals))
    return books


def _group(columns: Columns) -> OrderedDict[str, Columns]:
    return _group_named(columns)


def _inventory(
    books: OrderedDict[str, Columns],
    books_meta: dict[str, BookMeta],
    report_only: OrderedDict[str, TextColumns] | None = None,
) -> list[dict[str, object]]:
    """Book inventory for metadata. ``report_only`` (plan item 4) lists any
    pseudo-book whose columns are entirely Origin's auto-generated
    report-sheet family (e.g. a fit's "FitNL1" sheet with zero plausible
    numeric columns) — without it, such a sheet would be silently absent from
    the inventory despite getting its own DataStruct (see ``_build_book``).
    """
    out = [
        {
            "name": k,
            "long_name": books_meta[k].long_name if k in books_meta else k,
            "ncols": len(v),
            "nrows": max((len(a) for _, a in v), default=0),
        }
        for k, v in books.items()
    ]
    for k, v in (report_only or {}).items():
        if k in books:
            continue
        out.append(
            {
                "name": k,
                "long_name": books_meta[k].long_name if k in books_meta else k,
                "ncols": len(v),
                "nrows": max((len(rows) for _, rows in v), default=0),
            }
        )
    return out


def _book_long_name(book: str, books_meta: dict[str, BookMeta]) -> str:
    base_book, _, sheet_no = book.partition("@")
    if sheet_no and base_book in books_meta:
        return f"{books_meta[base_book].long_name} (sheet {sheet_no})"
    return books_meta[book].long_name if book in books_meta else book


def _build_book(
    book: str,
    cols: Columns,
    books_meta: dict[str, BookMeta],
    inventory: list[dict[str, object]],
    source_format: str = "origin_opj",
    text_cols: TextColumns | None = None,
    report_cols: TextColumns | None = None,
) -> DataStruct:
    """Assemble one workbook into a DataStruct.

    Ragged columns are padded to the book's max length with NaN. The X column
    is the first designation-X column when the windows metadata knows one,
    else the first column; the rest become value columns labelled by their
    long name (falling back to the Origin short designation A, B, …).

    ``text_cols`` (plan item 4) are this book's inline-text columns — never
    part of `.values` (the data contract is numeric); they attach under
    ``metadata["origin_text_columns"]`` keyed by Origin short name (A, B, …).
    ``report_cols`` (plan item 4, report-sheet residue) are this book's
    report-sheet reference-string columns (Notes/Summary/Parameters/RegStats/
    ANOVA "cell://" columns), attached the same way under
    ``metadata["origin_report_sheets"]``.

    A sheet made *entirely* of report-sheet columns (e.g. a fit's "FitNL1"
    report, which typically has zero plausible-numeric columns of its own —
    ``cols`` empty) still gets its own pseudo-book: an empty-data DataStruct
    carrying only the report metadata, rather than being silently omitted.
    """
    if not cols:
        book_long = _book_long_name(book, books_meta)
        meta_empty: dict[str, object] = {
            "source_format": source_format,
            "origin_book": book,
            "origin_book_long": book_long,
            "origin_books": inventory,
            "origin_report_sheets": {c: rows for c, rows in (report_cols or [])},
        }
        return DataStruct(time=np.empty(0), values=np.empty((0, 0)), metadata=meta_empty)

    base_book, _, sheet_no = book.partition("@")
    col_meta = books_meta[base_book].columns if base_book in books_meta and not sheet_no else {}
    maxlen = max((len(v) for _, v in cols), default=0)

    x_idx = next(
        (j for j, (c, _) in enumerate(cols) if (m := col_meta.get(c)) and m.designation == "X"),
        0,
    )
    ordered = [cols[x_idx]] + [cv for j, cv in enumerate(cols) if j != x_idx]

    def _pad(a: NDArray[np.float64]) -> NDArray[np.float64]:
        return a if len(a) == maxlen else np.concatenate([a, np.full(maxlen - len(a), np.nan)])

    padded = [_pad(v) for _, v in ordered]
    time = padded[0] if padded else np.empty(0)
    values = np.column_stack(padded[1:]) if len(padded) > 1 else np.empty((maxlen, 0))
    value_cols = [c for c, _ in ordered[1:]]
    x_meta = col_meta.get(ordered[0][0]) if ordered else None
    meta = {
        "source_format": source_format,
        "origin_book": book,
        "origin_book_long": _book_long_name(book, books_meta),
        "origin_books": inventory,
        "x_column_name": ordered[0][0] if ordered else "A",
        "x_column_long": _label_for(ordered[0][0], x_meta) if ordered else "",
        "x_unit": x_meta.unit if x_meta is not None else "",
        # Origin short names of the value columns, in channel order — lets a
        # figure's curve->column binding (opju_curves) map onto `.values`.
        "origin_column_names": value_cols,
        "column_designations": {c: m.designation for c, m in col_meta.items()},
        "column_comments": {c: m.comment for c, m in col_meta.items() if m.comment},
        "origin_text_columns": {c: rows for c, rows in (text_cols or [])},
        "origin_report_sheets": {c: rows for c, rows in (report_cols or [])},
    }
    return DataStruct(
        time=time,
        values=values,
        labels=tuple(_label_for(c, col_meta.get(c)) for c in value_cols),
        units=tuple(col_meta[c].unit if c in col_meta else "" for c in value_cols),
        metadata=meta,
    )


_ParseResult = tuple[
    OrderedDict[str, Columns],
    OrderedDict[str, TextColumns],
    OrderedDict[str, TextColumns],
    dict[str, BookMeta],
    list[dict[str, object]],
]


def _parse(path: Path) -> _ParseResult:
    b = path.read_bytes()
    if not b.startswith(b"CPYA"):
        raise fallback(path, f"'{path.name}' does not look like a CPYA .opj (bad header).")
    columns, text_columns, report_columns = _columns(b)
    if not columns:
        raise fallback(path, f"no worksheet columns could be decoded from '{path.name}'.")
    books = _group(columns)
    text_books = _group_named(text_columns)
    report_books = _group_named(report_columns)
    books_meta = window_metadata(b)
    return books, text_books, report_books, books_meta, _inventory(books, books_meta, report_books)


def read_opj(path: Path) -> DataStruct:
    """The single-DataStruct contract: the largest workbook (inventory in metadata).

    Extra-sheet pseudo-books (``Book@N`` — often fit tables/curves) never win
    the primary slot over measured sheet-1 data, however large they are.
    """
    books, text_books, report_books, books_meta, inventory = _parse(path)
    primary_pool = [k for k in books if "@" not in k] or list(books)
    primary = max(primary_pool, key=lambda k: sum(len(v) for _, v in books[k]))
    return _build_book(
        primary,
        books[primary],
        books_meta,
        inventory,
        text_cols=text_books.get(primary),
        report_cols=report_books.get(primary),
    )


def read_opj_books(path: Path) -> list[DataStruct]:
    """Every workbook in the project as its own DataStruct (plan item 3).

    A sheet made entirely of report-sheet columns (plan item 4 — e.g. a fit's
    "FitNL1" report) has no plausible-numeric columns at all, so it never
    appears as a key in ``books``; the union with ``report_books`` (and
    ``text_books``, for the analogous inline-text case) below still surfaces
    it as its own pseudo-book rather than dropping the whole sheet.
    """
    books, text_books, report_books, books_meta, inventory = _parse(path)
    keys = list(books)
    keys += [k for k in text_books if k not in books and k not in keys]
    keys += [k for k in report_books if k not in books and k not in keys]
    return [
        _build_book(
            k,
            books.get(k, []),
            books_meta,
            inventory,
            text_cols=text_books.get(k),
            report_cols=report_books.get(k),
        )
        for k in keys
        if books.get(k) or text_books.get(k) or report_books.get(k)
    ]
