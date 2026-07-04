"""Read Origin ``.opj`` (CPYA) projects: worksheet data + column names/units.

M1 recovered the numeric columns (datasets named ``"<Book>_<Col>"``, 10-byte
``<mask><float64>`` records); this adds the windows-section metadata (plan
item 2): real column long names, units, comments, and X/Y designations. The
largest book returns as the :class:`~quantized.datastruct.DataStruct` (every
book's inventory stays in metadata; per-book selection is plan item 3/16).
"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import (
    NAME_RE,
    decode_doubles,
    fallback,
    plausible_column,
    walk_blocks,
)
from quantized.io.origin_project.windows import BookMeta, ColumnMeta, window_metadata

__all__ = ["read_opj", "read_opj_books"]


def _columns(b: bytes) -> list[tuple[str, NDArray[np.float64]]]:
    """Walk the datasets section, pairing each named header block with its data."""
    out: list[tuple[str, NDArray[np.float64]]] = []
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
                out.append((pending, vals))
            pending = None
    return out


_PRINTABLE = frozenset(range(0x20, 0x7F)) | {0x09, 0x0A, 0x0D}


def _looks_textual(payload: bytes) -> bool:
    """True when a data block's bytes read as text, not float64 records.

    Judged over the *non-zero* bytes (both text cells and round-value doubles
    are heavily NUL-padded): text is across-the-board printable, while float64
    mantissa/exponent bytes run well under half printable.
    """
    nonzero = [c for c in payload[:400] if c != 0]
    if len(nonzero) < 8:
        return False
    printable = sum(c in _PRINTABLE for c in nonzero)
    return printable >= 0.9 * len(nonzero)


def _label_for(col: str, meta: ColumnMeta | None) -> str:
    return meta.long_name if meta is not None and meta.long_name else col


Columns = list[tuple[str, NDArray[np.float64]]]


def _group(columns: Columns) -> OrderedDict[str, Columns]:
    books: OrderedDict[str, Columns] = OrderedDict()
    for name, vals in columns:
        book, _, col = name.rpartition("_")
        col, _, sheet = (col or "A").partition("@")
        if sheet:  # sheet N>1 becomes its own pseudo-book "<Book>@N"
            book = f"{book or 'Book'}@{sheet}"
        books.setdefault(book or "Book", []).append((col or "A", vals))
    return books


def _inventory(
    books: OrderedDict[str, Columns], books_meta: dict[str, BookMeta]
) -> list[dict[str, object]]:
    return [
        {
            "name": k,
            "long_name": books_meta[k].long_name if k in books_meta else k,
            "ncols": len(v),
            "nrows": max((len(a) for _, a in v), default=0),
        }
        for k, v in books.items()
    ]


def _build_book(
    book: str,
    cols: Columns,
    books_meta: dict[str, BookMeta],
    inventory: list[dict[str, object]],
    source_format: str = "origin_opj",
) -> DataStruct:
    """Assemble one workbook into a DataStruct.

    Ragged columns are padded to the book's max length with NaN. The X column
    is the first designation-X column when the windows metadata knows one,
    else the first column; the rest become value columns labelled by their
    long name (falling back to the Origin short designation A, B, …).
    """
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
        "origin_book_long": (
            f"{books_meta[base_book].long_name} (sheet {sheet_no})"
            if sheet_no and base_book in books_meta
            else books_meta[book].long_name
            if book in books_meta
            else book
        ),
        "origin_books": inventory,
        "x_column_name": ordered[0][0] if ordered else "A",
        "x_column_long": _label_for(ordered[0][0], x_meta) if ordered else "",
        "x_unit": x_meta.unit if x_meta is not None else "",
        "column_designations": {c: m.designation for c, m in col_meta.items()},
        "column_comments": {c: m.comment for c, m in col_meta.items() if m.comment},
    }
    return DataStruct(
        time=time,
        values=values,
        labels=tuple(_label_for(c, col_meta.get(c)) for c in value_cols),
        units=tuple(col_meta[c].unit if c in col_meta else "" for c in value_cols),
        metadata=meta,
    )


def _parse(
    path: Path,
) -> tuple[OrderedDict[str, Columns], dict[str, BookMeta], list[dict[str, object]]]:
    b = path.read_bytes()
    if not b.startswith(b"CPYA"):
        raise fallback(path, f"'{path.name}' does not look like a CPYA .opj (bad header).")
    columns = _columns(b)
    if not columns:
        raise fallback(path, f"no worksheet columns could be decoded from '{path.name}'.")
    books = _group(columns)
    books_meta = window_metadata(b)
    return books, books_meta, _inventory(books, books_meta)


def read_opj(path: Path) -> DataStruct:
    """The single-DataStruct contract: the largest workbook (inventory in metadata).

    Extra-sheet pseudo-books (``Book@N`` — often fit tables/curves) never win
    the primary slot over measured sheet-1 data, however large they are.
    """
    books, books_meta, inventory = _parse(path)
    primary_pool = [k for k in books if "@" not in k] or list(books)
    primary = max(primary_pool, key=lambda k: sum(len(v) for _, v in books[k]))
    return _build_book(primary, books[primary], books_meta, inventory)


def read_opj_books(path: Path) -> list[DataStruct]:
    """Every workbook in the project as its own DataStruct (plan item 3)."""
    books, books_meta, inventory = _parse(path)
    return [_build_book(k, v, books_meta, inventory) for k, v in books.items() if v]
