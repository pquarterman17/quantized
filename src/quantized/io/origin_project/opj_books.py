"""Assemble decoded Origin worksheet columns into per-book DataStructs.

Shared by the ``.opj`` reader (``opj.py``) and the ``.opju`` reader
(``opju.py``): grouping ``<Book>_<Col>[@sheet]`` datasets into books, the
book inventory, and :func:`_build_book` — the one place column long
names / units / comments (Origin rich-text label fields, decoded through
``clean_richtext``) and the X designation turn into a
:class:`~quantized.datastruct.DataStruct`. Split out of ``opj.py`` to keep
both modules under the 500-line ceiling; ``opj.py`` re-exports every name
here, so existing imports are unchanged.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import TypeVar

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io.origin_project.origin_richtext import clean_richtext
from quantized.io.origin_project.windows import BookMeta, ColumnMeta

__all__ = ["ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH", "Columns", "TextColumns", "column_format_hint"]

# Origin stores a date as a "Julian day number" that starts its days at
# MIDNIGHT: the astronomical Julian date minus 0.5. 1970-01-01 00:00 is
# therefore day number 2440587.0 (astronomical JD 2440587.5), and
#     unix_seconds = (value - 2440587.0) * 86400.
# Oracle: Altaxo's DateTimeColumns / WksDifferentColumnTypes /
# WksThreeGroups / WksDifferentDiagramAssoc tests state the calendar
# date-time of stored values (seven distinct instants, 1999-2033, to the
# minute); this epoch reproduces every one, and the astronomical epoch is
# 12 h off on every one. tests/test_io_origin_opj_corpus.py replays the
# three that sit in straight-line test code; the four inside loops were
# checked by hand.
ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH = 2440587.0


def column_format_hint(value_format: str) -> dict[str, object] | None:
    """How to READ a calendar-formatted column's numbers, or None.

    The cells stay float64 — this is a hint for whoever renders them:

    * ``date``: an instant, as Origin's midnight-based Julian day number
      (``unix_epoch_day`` is the value of 1970-01-01 00:00). Whether Origin
      displayed it as a date, or a date and time, is a display setting the
      reader does not decode — the fractional day is always there;
    * ``time``: a time of day (or a duration), in days — 0.5 is 12:00;
    * ``month``: a month number, 1-12;
    * ``day_of_week``: a weekday number (which weekday is 1 is not
      established — no oracle pins it).
    """
    if value_format == "date":
        return {
            "kind": "datetime",
            "unit": "origin_day_number",
            "unix_epoch_day": ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH,
        }
    if value_format == "time":
        return {"kind": "time", "unit": "days"}
    if value_format in ("month", "day_of_week"):
        return {"kind": value_format}
    return None

_V = TypeVar("_V")


def _label_for(col: str, meta: ColumnMeta | None) -> str:
    """The display label for a value column: its decoded Long Name (Origin
    rich-text escapes translated — see the module docstring) when the windows
    section resolved one, else the bare Origin short designation (A, B, …)."""
    return clean_richtext(meta.long_name) if meta is not None and meta.long_name else col


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
            "long_name": clean_richtext(books_meta[k].long_name) if k in books_meta else k,
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
                "long_name": clean_richtext(books_meta[k].long_name) if k in books_meta else k,
                "ncols": len(v),
                "nrows": max((len(rows) for _, rows in v), default=0),
            }
        )
    return out


def _book_long_name(book: str, books_meta: dict[str, BookMeta]) -> str:
    """The book's display title (Origin rich-text escapes translated — see
    the module docstring), with a "(sheet N)" suffix for an extra-sheet
    pseudo-book (``Book@N``)."""
    base_book, _, sheet_no = book.partition("@")
    if sheet_no and base_book in books_meta:
        return f"{clean_richtext(books_meta[base_book].long_name)} (sheet {sheet_no})"
    return clean_richtext(books_meta[book].long_name) if book in books_meta else book


def _build_book(
    book: str,
    cols: Columns,
    books_meta: dict[str, BookMeta],
    inventory: list[dict[str, object]],
    source_format: str = "origin_opj",
    text_cols: TextColumns | None = None,
    report_cols: TextColumns | None = None,
    *,
    row_aligned_text: bool = False,
    imag_cols: Columns | None = None,
    sheet_columns: dict[str, ColumnMeta] | None = None,
    lost_columns: bool = False,
    x_unconfirmed: str | None = None,
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

    ``row_aligned_text`` (opt-in; the header-driven ``.opj`` reader passes
    it) makes the text columns a first-class part of the row space: the
    book's row count is the longest numeric OR text column, each text list
    is padded with ``""`` to it, and a book whose columns are ALL text still
    gets its rows, labels, units and comments (``.time`` is then a row
    index and ``x_column_recovered`` is False) instead of the empty shell
    the legacy branch returns — which dropped the text cells along with it
    (the all-text second book of Altaxo's ``TwoWorksheets`` specimen). Off,
    the behaviour is byte-for-byte what it was (``.opju`` relies on that).

    ``sheet_columns`` (opt-in; the header-driven ``.opj`` reader passes it)
    is this book's column metadata, already bound to the right sheet
    (``opj_sheets``) — for a sheet pseudo-book ``Book@N`` as much as for
    the first sheet. Left None, only a first-sheet book looks its columns
    up in ``books_meta`` and a ``Book@N`` gets none, as before.

    ``lost_columns`` (opt-in, same caller) says a column of this book
    exists in the file but could not be decoded. Then "no designated X, so
    the first column is X" is not safe — the first column may be the one
    that was lost — and unless the metadata names a decoded X the axis is
    the row index, flagged like any other unrecovered X.

    ``x_unconfirmed`` (the ``.opju`` reader's X check, ``opju._x_unconfirmed``)
    is the reason the first decoded column cannot be taken as the X when no
    column is designated X; the book then gets the row-index axis, exactly
    like a designated X that failed to decode, with the reason in
    ``metadata["x_column_unrecovered_reason"]``.

    ``imag_cols`` are the imaginary parts of this book's complex columns
    (same short names and row order as their real parts in ``cols``),
    attached under ``metadata["origin_complex_imaginary"]`` — the numeric
    contract is real-valued, so the real part is the channel.
    """
    text_rows = max((len(rows) for _, rows in text_cols or []), default=0)
    if not cols and not (row_aligned_text and text_rows):
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
    if sheet_columns is not None:
        col_meta = sheet_columns
    else:
        col_meta = (
            books_meta[base_book].columns if base_book in books_meta and not sheet_no else {}
        )
    maxlen = max((len(v) for _, v in cols), default=0)
    if row_aligned_text:
        maxlen = max(maxlen, text_rows)
        text_cols = [(c, rows + [""] * (maxlen - len(rows))) for c, rows in text_cols or []]

    # Locate the independent (X) axis among the DECODED columns. When a book's
    # windows metadata *declares* an X column but that column failed every decode
    # path (so it is absent from ``cols``), do NOT fall back to promoting the
    # first value column to the x-axis: that silently relabels a Y measurement as
    # the independent variable and drops the real X without a trace (Moke.opj
    # Book3; the hc2convert.opj "A6221Lockin*" TDI family — 34 of 74 books). Use
    # a synthetic row-index axis instead, keep every decoded column as a value
    # series, and flag the loss in metadata (``x_column_recovered``).
    decoded_x = next(
        (j for j, (c, _) in enumerate(cols) if (m := col_meta.get(c)) and m.designation == "X"),
        None,
    )
    declared_x = next((c for c, m in col_meta.items() if m.designation == "X"), None)
    # No numeric column at all (an all-text book): nothing can be the axis.
    x_unrecovered = (
        decoded_x is None
        and (declared_x is not None or lost_columns or x_unconfirmed is not None)
    ) or not cols

    if x_unrecovered:
        ordered = list(cols)
    else:
        x_idx = decoded_x if decoded_x is not None else 0
        ordered = [cols[x_idx]] + [cv for j, cv in enumerate(cols) if j != x_idx]

    def _pad(a: NDArray[np.float64]) -> NDArray[np.float64]:
        return a if len(a) == maxlen else np.concatenate([a, np.full(maxlen - len(a), np.nan)])

    padded = [_pad(v) for _, v in ordered]
    if x_unrecovered:
        # The designated X column is unrecoverable → synthetic 0..N-1 row index
        # as `.time`; every decoded column stays a value series (none consumed).
        time = np.arange(maxlen, dtype=np.float64)
        values = np.column_stack(padded) if padded else np.empty((maxlen, 0))
        value_cols = [c for c, _ in ordered]
        x_meta = None
    else:
        time = padded[0] if padded else np.empty(0)
        values = np.column_stack(padded[1:]) if len(padded) > 1 else np.empty((maxlen, 0))
        value_cols = [c for c, _ in ordered[1:]]
        x_meta = col_meta.get(ordered[0][0]) if ordered else None
    meta = {
        "source_format": source_format,
        "origin_book": book,
        "origin_book_long": _book_long_name(book, books_meta),
        "origin_books": inventory,
        "x_column_name": "" if x_unrecovered else (ordered[0][0] if ordered else "A"),
        "x_column_long": (
            "Row" if x_unrecovered else (_label_for(ordered[0][0], x_meta) if ordered else "")
        ),
        # `x_unit` is the Origin-subsystem key (writer/COM read it); also emit
        # the canonical `x_column_unit` every other parser uses so the plot +
        # .ogs export layers (which read `x_column_unit`) show the x-axis unit.
        # Both translated (rich-text escapes — see module docstring): a Unit
        # row is exactly as free-form as a Long Name.
        "x_unit": clean_richtext(x_meta.unit) if x_meta is not None else "",
        "x_column_unit": clean_richtext(x_meta.unit) if x_meta is not None else "",
        # False when `.time` is a synthetic row index substituted because the
        # designated X column could not be decoded (its long name, when known,
        # is in ``x_column_unrecovered``); True when `.time` is the real X.
        "x_column_recovered": not x_unrecovered,
        # Origin short names of the value columns, in channel order — lets a
        # figure's curve->column binding (opju_curves) map onto `.values`.
        "origin_column_names": value_cols,
        "column_designations": {c: m.designation for c, m in col_meta.items()},
        "column_comments": {
            c: clean_richtext(m.comment) for c, m in col_meta.items() if m.comment
        },
        "origin_text_columns": {c: rows for c, rows in (text_cols or [])},
        "origin_report_sheets": {c: rows for c, rows in (report_cols or [])},
    }
    formats = {
        c: hint
        for c, m in col_meta.items()
        if (hint := column_format_hint(m.value_format)) is not None
    }
    if formats:
        # Date / Time / Month / Day-of-week columns: the numbers are in
        # `.values` as Origin stored them; this says how to read them.
        meta["origin_column_formats"] = formats
    if imag_cols:
        # Blank cells as None, not NaN: metadata is serialized as strict JSON.
        meta["origin_complex_imaginary"] = {
            c: [None if x != x else x for x in _pad(v).tolist()] for c, v in imag_cols
        }
    if text_cols:
        # A text column is not a channel, so its Long Name / Unit have no
        # slot in `.labels` / `.units`; keep them beside the cells.
        meta["origin_text_column_labels"] = {
            c: {"long_name": clean_richtext(m.long_name), "unit": clean_richtext(m.unit)}
            for c, _ in text_cols
            if (m := col_meta.get(c)) is not None and (m.long_name or m.unit)
        }
    if x_unrecovered and declared_x is not None:
        # The declared X's long name, so the Inspector can say *which* column
        # was lost (e.g. "Temperature") rather than just that the axis is a row
        # index.
        meta["x_column_unrecovered"] = _label_for(declared_x, col_meta.get(declared_x))
    elif x_unrecovered and x_unconfirmed is not None:
        meta["x_column_unrecovered_reason"] = x_unconfirmed
    return DataStruct(
        time=time,
        values=values,
        labels=tuple(_label_for(c, col_meta.get(c)) for c in value_cols),
        units=tuple(
            clean_richtext(col_meta[c].unit) if c in col_meta else "" for c in value_cols
        ),
        metadata=meta,
    )


