"""Read Origin ``.opju`` (CPYUA, 2018+) projects: worksheet data → DataStruct.

Worksheet data is read structurally (``opju_worksheet.scan_worksheet``): each
column's own storage header says what its record holds — Text&Numeric cells,
plain doubles (FPC streams, ``opju_codec.py``), float32/integer elements,
complex pairs or Text rows — and how many rows are actually in use. Books
are grouped and assembled exactly like the ``.opj`` reader (shared ``_group``
/ ``_build_book`` / ``_inventory``). Column long-names/units/comments come
from the CPYUA windows section (``windows_opju.py``, plan item 10) the same
way `.opj`'s windows-section metadata feeds ``_build_book`` — designation-X
becomes the x axis, real labels/units/comments attach where a book's window
section can be structurally confirmed, and book display titles recover from
the embedded import filename where available. Columns/books that can't be
confirmed keep the Origin short-designation fallback (A, B, C…) rather than
being guessed at.

Text cells never enter ``.values`` (the data contract is numeric): a Text
column, and the text cells of a mixed Text&Numeric column, ride
``metadata["origin_text_columns"]`` — the same key the ``.opj`` reader uses.

Whatever was not read is reported, not dropped silently: every book carries
its own ``metadata["origin_worksheet_losses"]`` (which of ITS columns were
not read, or read only in part — ``opju_book_checks``), the primary book
carries the project's ``metadata["origin_worksheet_fidelity"]`` (see
``opju_worksheet``), and a project with no decodable column raises with a
census of the record forms that were found instead of a bare "no worksheet
columns".

Plan item 4's report-sheet residue (``opju_reports.py``) is folded in the
same way ``.opj``'s ``text_cols``/``report_cols`` are: a book made entirely
of report-sheet columns (e.g. a fit's "FitNL1" sheet, with zero
plausible-numeric columns of its own) still gets its own pseudo-book via
``_build_book``'s empty-``cols`` branch, rather than being silently dropped
for having nothing in ``books``.
"""

from __future__ import annotations

import dataclasses
from collections import OrderedDict
from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import fallback
from quantized.io.origin_project.opj import (
    Columns,
    TextColumns,
    _build_book,
    _group,
    _group_named,
    _inventory,
)
from quantized.io.origin_project.opj_matrix import MatrixSheet, build_matrix_book
from quantized.io.origin_project.opju_book_checks import (
    book_losses,
    pad_to_text,
    text_x_reason,
    x_unconfirmed,
)
from quantized.io.origin_project.opju_codec import scan_marked_columns, shared_fpc_decodes
from quantized.io.origin_project.opju_reports import scan_marked_report_columns
from quantized.io.origin_project.opju_worksheet import MatrixBook, scan_worksheet
from quantized.io.origin_project.windows import BookMeta
from quantized.io.origin_project.windows_opju import opju_window_metadata

__all__ = [
    "build_opju_books",
    "build_opju_primary",
    "parse_opju",
    "read_opju",
    "read_opju_books",
]


@dataclasses.dataclass(frozen=True)
class _ParseResult:
    """One decoded project: numeric books, text books, report books, the
    windows metadata, the book inventory, and the worksheet fidelity summary."""

    books: OrderedDict[str, Columns]
    text_books: OrderedDict[str, TextColumns]
    report_books: OrderedDict[str, TextColumns]
    books_meta: dict[str, BookMeta]
    inventory: list[dict[str, object]]
    fidelity: dict[str, object]
    matrices: list[MatrixBook] = dataclasses.field(default_factory=list)
    column_status: dict[str, list[tuple[str, str]]] = dataclasses.field(default_factory=dict)
    losses: dict[str, dict[str, list[str]]] = dataclasses.field(default_factory=dict)


def _undecoded_census(fidelity: dict[str, object]) -> str:
    """One sentence naming the record forms found but not read — the
    diagnosis a failed import owes the user."""
    parts: list[str] = []
    undecoded = fidelity.get("undecoded")
    if isinstance(undecoded, list):
        for entry in undecoded:
            parts.append(f"{entry['count']} x {entry['form']} ({entry['reason']})")
    matrices = fidelity.get("matrix_datasets")
    if isinstance(matrices, list) and matrices:
        parts.append(f"{len(matrices)} matrix object(s) whose shape could not be located")
    if fidelity.get("report_columns"):
        parts.append(f"{fidelity['report_columns']} report-sheet column(s)")
    empty = fidelity.get("empty_books_omitted")
    if isinstance(empty, list) and empty:
        parts.append(f"{len(empty)} empty workbook(s)")
    if not parts:
        return "no dataset records were found"
    return "found " + "; ".join(parts)


def _window_metadata(
    b: bytes, legacy: Columns, columns_by_book: dict[str, list[str]]
) -> dict[str, BookMeta]:
    """Column long-names / units / designations for the decoded books.

    ``opju_window_metadata`` associates a book's label records with its
    columns positionally, and its answer depends on WHICH columns it is asked
    about — a longer list can make it settle on a different marker run. It
    was validated with the list the marker scan produces (``legacy``: the
    frozen ``scan_columns`` result), so that lookup is kept exactly as it was
    and wins wherever it resolves a book: no label that used to be right may
    change because more columns now decode.

    The full-list lookup then only ADDS: metadata for books the old lookup
    never resolved, and — when it agrees with the old lookup on every column
    they share, which shows both read the same marker run — the columns the
    marker scan never saw (text columns included: a Text column that is the
    book's designated X must be KNOWN as the X, so ``_build_book`` reports
    the axis as unrecovered instead of promoting a Y column to it). Each book
    is anchored independently, so the full lookup is asked only about the
    books where it can add something: those the old lookup did not resolve
    and those with columns the marker scan did not decode.
    """
    legacy_columns = {k: [c for c, _ in v] for k, v in _group(legacy).items()}
    anchors: dict[str, tuple[int, bytes | None] | None] = {}  # shared by both lookups
    validated = opju_window_metadata(b, legacy_columns, anchors)
    wider = {
        book: cols
        for book, cols in columns_by_book.items()
        if book not in validated or set(cols) - set(legacy_columns.get(book, ()))
    }
    full = opju_window_metadata(b, wider, anchors) if wider else {}
    merged: dict[str, BookMeta] = {}
    for book in columns_by_book:
        base, wide = validated.get(book), full.get(book)
        if base is None:
            if wide is not None:
                merged[book] = wide
            continue
        columns = dict(base.columns)
        if wide is not None and all(wide.columns.get(c) == m for c, m in base.columns.items()):
            columns = {**wide.columns, **base.columns}
        merged[book] = BookMeta(base.short, base.long_name, columns)
    return merged


def _parse(path: Path, *, raw: bytes | None = None) -> _ParseResult:
    """Decode the project once. ``raw`` lets a caller that already has the
    file's bytes (e.g. :func:`parse_opju`'s callers in
    ``origin_project/__init__.py``) skip a second disk read; ``None`` (the
    default) reads ``path`` itself, unchanged from before.

    The frozen marker scan runs ONCE and serves the worksheet scan's safety
    net, the validated label lookup and ``tail_start``; its FPC decodes are
    shared with the structural record reader (``shared_fpc_decodes``)."""
    b = path.read_bytes() if raw is None else raw
    if not b.startswith(b"CPYUA"):
        raise fallback(path, f"'{path.name}' does not look like a CPYUA .opju (bad header).")
    reports = scan_marked_report_columns(b)
    with shared_fpc_decodes(b):
        marked = scan_marked_columns(b)
        scan = scan_worksheet(b, marked, [m for m, _, _ in reports])
    report_books = _group_named([(name, rows) for _, name, rows in reports])
    if not scan.columns and not scan.text_columns and not report_books and not scan.matrices:
        raise fallback(
            path,
            f"no worksheet columns could be decoded from '{path.name}' "
            f"({_undecoded_census(scan.fidelity)}).",
        )
    books = _group(scan.columns)
    text_books = _group_named(scan.text_columns)
    columns_by_book = {k: [c for c, _ in v] for k, v in books.items()}
    for k, tcols in text_books.items():
        known = columns_by_book.setdefault(k, [])
        known += [c for c, _ in tcols if c not in known]
    books_meta = _window_metadata(b, [(n, v) for _, n, v in marked], columns_by_book)
    text_only = OrderedDict((k, v) for k, v in text_books.items() if k not in books)
    side_books = OrderedDict(report_books)
    for k, v in text_only.items():
        side_books.setdefault(k, v)
    inventory = _inventory(books, books_meta, side_books)
    inventory += [
        {
            "name": m.name,
            "long_name": m.name,
            "ncols": m.geometry.cols,
            "nrows": m.geometry.rows,
            "matrix": True,
        }
        for m in scan.matrices
    ]
    return _ParseResult(
        books=books,
        text_books=text_books,
        report_books=report_books,
        books_meta=books_meta,
        inventory=inventory,
        fidelity=scan.fidelity,
        matrices=scan.matrices,
        column_status=scan.column_status,
        losses=scan.losses,
    )


def _primary_key(books: OrderedDict[str, Columns]) -> str:
    """The book :func:`read_opju`/:func:`build_opju_primary` treat as *the*
    primary dataset: the largest first-sheet book — see ``opj._primary_key``
    — with one refinement. A book with a single numeric column has an X and
    no value series (every import contract requires at least one), so it is
    primary only when no book with a value column exists. (Measured on the
    public corpus: a book holding a lone tick-position column beside its text
    labels was the "largest" book of ten projects whose data books hold one
    row each.)"""
    first_sheet = [k for k in books if "@" not in k]
    plottable = [k for k in books if len(books[k]) >= 2]
    pool = [k for k in first_sheet if k in plottable] or plottable or first_sheet or list(books)
    return max(pool, key=lambda k: sum(len(v) for _, v in books[k]))


def parse_opju(path: Path, *, raw: bytes | None = None) -> _ParseResult:
    """Public single-parse entry point — see ``opj.parse_opj``. Lets a caller
    that needs both the primary book (:func:`build_opju_primary`) and every
    book (:func:`build_opju_books`) parse the project once."""
    return _parse(path, raw=raw)


def _book(parsed: _ParseResult, key: str, *, primary: bool = False) -> DataStruct:
    """One book's DataStruct with its own worksheet losses; the primary book
    also carries the project's worksheet fidelity summary (once per project,
    not copied into every book — the import route folds it into
    ``origin_fidelity``)."""
    text_cols = parsed.text_books.get(key)
    cols = pad_to_text(parsed.books.get(key, []), text_cols)
    ds = _build_book(
        key,
        cols,
        parsed.books_meta,
        parsed.inventory,
        source_format="origin_opju",
        text_cols=text_cols,
        report_cols=parsed.report_books.get(key),
        x_unconfirmed=x_unconfirmed(
            key, cols, parsed.books_meta, parsed.column_status.get(key, [])
        ),
    )
    extra: dict[str, object] = {"origin_worksheet_losses": book_losses(parsed.losses.get(key))}
    meta = ds.metadata
    if meta.get("x_column_recovered") is False and "x_column_unrecovered_reason" not in meta:
        reason = text_x_reason(key, parsed.books_meta, text_cols)
        if reason is not None:
            extra["x_column_unrecovered_reason"] = reason
    if primary:
        extra["origin_worksheet_fidelity"] = parsed.fidelity
    if key not in parsed.books and key in parsed.text_books:
        # `_build_book`'s empty-`cols` branch (a book with no numeric column)
        # carries only report metadata; a text-only book's content goes here.
        extra["origin_text_columns"] = dict(parsed.text_books[key])
    return dataclasses.replace(ds, metadata={**ds.metadata, **extra})


def _matrix_book(parsed: _ParseResult, m: MatrixBook, *, primary: bool = False) -> DataStruct:
    """A matrix object as the same map DataStruct an ``.opj`` matrix becomes
    (``opj_matrix.build_matrix_book``): ``.values`` are X, Y, Z[, Z
    imaginary] per cell, ``metadata["is2D"]``/``map_shape`` make it open as
    a map, and ``metadata["origin_matrix"]`` carries the shape and whether
    Origin's X1/X2/Y1/Y2 coordinates were recovered (1-based cell indices
    otherwise)."""
    geo = m.geometry
    x1, x2 = geo.x_range if geo.x_range else (None, None)
    y1, y2 = geo.y_range if geo.y_range else (None, None)
    sheet = MatrixSheet(m.name, geo.rows, geo.cols, x1, x2, y1, y2)
    imag = m.imag.reshape(-1) if m.imag is not None else None
    ds = build_matrix_book(
        m.name, m.name, sheet, m.values.reshape(-1), imag, parsed.inventory
    )
    losses = dict(parsed.losses.get(m.name, {}))
    if not ds.metadata["origin_matrix"]["coordinates_recovered"]:
        # Its X/Y are 1-based cell indices, not Origin's coordinates: say so.
        losses["matrix_coordinates"] = [m.name]
    extra: dict[str, object] = {
        "source_format": "origin_opju",
        "origin_worksheet_losses": book_losses(losses),
    }
    if primary:  # a project of matrices only: its first matrix is the primary
        extra["origin_worksheet_fidelity"] = parsed.fidelity
    return dataclasses.replace(ds, metadata={**ds.metadata, **extra})


def _book_keys(parsed: _ParseResult) -> list[str]:
    """Every book with something to show: numeric books first (file order),
    then text-only and report-only pseudo-books."""
    keys = list(parsed.books)
    for side in (parsed.text_books, parsed.report_books):
        keys += [k for k in side if k not in keys]
    return keys


def build_opju_primary(parsed: _ParseResult) -> DataStruct:
    """Build the primary book's DataStruct from an already-:func:`parse_opju`'d
    project — see ``opj.build_opj_primary``. A project with no numeric book at
    all (text-only / report-only) yields its first book."""
    if parsed.books:
        return _book(parsed, _primary_key(parsed.books), primary=True)
    keys = _book_keys(parsed)
    if keys:
        return _book(parsed, keys[0], primary=True)
    return _matrix_book(parsed, parsed.matrices[0], primary=True)


def build_opju_books(parsed: _ParseResult) -> list[DataStruct]:
    """Build every book's DataStruct from an already-:func:`parse_opju`'d
    project — see ``opj.build_opj_books``.

    A sheet made entirely of report-sheet columns (plan item 4) or of Text
    columns has no numeric columns, so it never appears in ``books`` — it is
    still surfaced as its own pseudo-book (see ``_build_book``'s
    empty-``cols`` branch).
    """
    keys = _book_keys(parsed)
    first = _primary_key(parsed.books) if parsed.books else (keys[0] if keys else None)
    return [_book(parsed, k, primary=k == first) for k in keys] + [
        _matrix_book(parsed, m, primary=first is None and i == 0)
        for i, m in enumerate(parsed.matrices)
    ]


def read_opju(path: Path) -> DataStruct:
    """The single-DataStruct contract: the largest workbook (inventory in metadata)."""
    return build_opju_primary(_parse(path))


def read_opju_books(path: Path) -> list[DataStruct]:
    """Every workbook in the project as its own DataStruct (plan item 3/16).

    A sheet made entirely of report-sheet columns (plan item 4) has no
    plausible-numeric columns, so it never appears in ``books`` — the union
    with ``report_books`` below still surfaces it as its own pseudo-book
    (see ``_build_book``'s empty-``cols`` branch).
    """
    return build_opju_books(_parse(path))
