"""Which sheet an ``.opju`` curve's column is on, and binding it there.

A curve token names its column by a global column id
(``opju_figure_curves``), and the id table resolves that id to
``(book page, column short name)``. The id record carries **no sheet**:
every sheet's column records sit in the same book-page span, so a book
whose sheets 1 and 5 both have a column ``B`` maps both ids to
``(Book, "B")``. The importer, though, models each extra sheet as its own
pseudo-book ``Book@N`` (``opju_worksheet``), so a binding that says
``Book`` names sheet 1, whatever sheet the curve really plots.

**What does say the sheet.** The data section's dataset names do
(``Book_B@5``), and its records come in column-id (creation) order, not
sheet order: ``SOPvsHPPCA123``'s ``B@5``/``D@5``/``A@5``/``C@5`` sit in
the order of their ids 2363/2364/2365/2366, and ``Figure4.opju``'s
``Book1_D`` (id 37, created last) follows ``D@2`` … ``D@10``. So, per
``(book, column)``, the k-th smallest id is the k-th dataset of that name
in file order (``off_sheet_ids``). A column whose name occurs once in the
id table and has no suffixed dataset is plain. When the id and dataset
counts of a name differ, no sheet is proven for any of its ids.

**Re-binding (``curve_sheet``).** A curve whose column the alignment puts
on sheet N binds to ``Book@N``, the pseudo-book holding that sheet's data.
Its ``x`` is the Y column's stored X partner (by NAME; the frontend looks
it up in ``Book@N``), and that partner must be on the same sheet by the
same alignment; with no stored partner, sheet N's own first X-designated
column (``sheet_x_names``) stands in, as the book's first X does on sheet 1.
Captions of omitted curves leave the legend and the remaining ``%(n)``
references are renumbered (``without_captions``).
A curve stays OMITTED, never drawn from the wrong sheet, when its sheet is
unknown (``reason`` ``sheet_unknown``) or its partner's sheet is not the
curve's (``x_sheet_unproven``): the figure lists it in
``curve_sheet_omitted`` (``{book, x, y, recorded, reason}``, ``recorded`` =
``"Book@N"`` or ``""``), its legend caption goes with it, fidelity reports
``curve_sheet_unresolved`` (only for these two: an omission whose sheet IS
proven is reported as ``curves_left_out``, ``fidelity``), and the layer
stays in the import even when every curve is omitted. A proven sheet on
which no X column is found omits as ``sheet_x_not_found``
(``missing_x_reason``).
``unbound_rebinds`` adds the import-time check the byte decoder cannot
make: a re-bound curve whose pseudo-book, Y column (``column_not_imported``)
or X column (``x_not_imported``) the importer did not produce is omitted the
same way rather than silently skipped by the frontend.

**Evidence (Origin 2026b COM, 2026-11-15).** ``%Z`` per layer over 140
layers of 9 files: 533 of 533 alignment-named sheets were the sheet Origin
plots. Data check of the 498 re-bound curves quantized draws there:
Origin's plotted Y dataset (``%(i,@D)``) and X dataset (``%(iX,@D)``)
compared by value summary and by a paired (x, y) row fingerprint against
the importer's ``Book@N`` columns: 495 identical; the 3 differences are
not sheet errors (a plot drawn against row numbers, and two columns whose
first cell Origin holds as missing; ``ORIGIN_FILE_DECODE_PLAN`` item 70).
"""

from __future__ import annotations

import re
from bisect import bisect_left
from collections.abc import Collection, Iterable, Iterator, Mapping, Sequence
from typing import Any, TypeVar

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opju_blocks import find_headers

__all__ = [
    "curve_sheet",
    "dataset_sheet_order",
    "missing_x_reason",
    "off_sheet_ids",
    "sheet_x_names",
    "unbound_rebinds",
    "without_captions",
    "without_positions",
]

_T = TypeVar("_T")


def dataset_sheet_order(b: bytes) -> dict[tuple[str, str], list[str]]:
    """``{(book, column): [sheet suffix, ...]}`` in file order, ``""`` for
    the unsuffixed (sheet-1) dataset.

    Read from the structural dataset storage headers
    (``opju_blocks.find_headers``: every worksheet column, numeric or text,
    validated by its 147-byte header), not from a name scan, so a name-shaped
    byte run elsewhere in the file cannot reorder or lengthen the list.
    """
    out: dict[tuple[str, str], list[str]] = {}
    for book, col, sheet in _column_datasets(b):
        sheets = out.setdefault((book, col), [])
        if sheet not in sheets:
            sheets.append(sheet)
    return out


def _column_datasets(b: bytes) -> Iterator[tuple[str, str, str]]:
    """``(book, column, sheet suffix)`` of every worksheet column dataset."""
    for h in find_headers(b):
        if not h.is_column:
            continue
        base, _, sheet = h.name.partition("@")
        book, _, col = base.rpartition("_")
        if book:
            yield book, col, sheet


def _folded_sheet_order(b: bytes) -> dict[tuple[str, str], list[tuple[str, str]]]:
    """``{(casefolded book, column): [(book as the dataset spells it, sheet
    suffix), ...]}`` in file order: ``dataset_sheet_order`` with the book
    name compared the way Origin compares names (case-insensitively). A
    sheet suffix held under BOTH spellings stays twice (fail closed: the
    count then cannot align, rather than the first spelling winning)."""
    out: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for book, col, sheet in _column_datasets(b):
        entries = out.setdefault((book.casefold(), col), [])
        if (book, sheet) not in entries:
            entries.append((book, sheet))
    return out


def off_sheet_ids(b: bytes, ids: Mapping[int, tuple[str, str]]) -> dict[int, str]:
    """Column id -> the sheet it is recorded on, for every id NOT provably
    on its book's unsuffixed sheet as the id table spells the book:
    ``"Book@N"`` when the rank alignment (module docstring) names the sheet,
    ``""`` when it cannot.

    When the datasets spelled exactly as the id table spells the book do not
    align with its ids, book names compare case-insensitively, as Origin
    compares them: a book renamed by case only (``Cusch3vac`` ->
    ``CuSCH3vac``) keeps its old sheets' datasets under the old spelling and
    writes new sheets' under the new one, so its ids align only against both
    spellings together. The key then uses the DATASET's spelling, the name
    the importer gives that sheet (``Cusch3vac@2``, or ``Cusch3vac`` for
    sheet 1, which is then in the result too). Two id-table books whose
    names differ only by case (none in the corpus) are matched exactly.

    An id absent from the result is plain: its binding to ``book`` is the
    sheet the importer models as ``book``.
    """
    by_name: dict[tuple[str, str], list[int]] = {}
    for cid, key in ids.items():
        by_name.setdefault(key, []).append(cid)
    folds: dict[str, set[str]] = {}
    for book, _col in by_name:
        folds.setdefault(book.casefold(), set()).add(book)
    order = _folded_sheet_order(b)
    out: dict[int, str] = {}
    for (book, col), cids in by_name.items():
        entries = order.get((book.casefold(), col), [])
        exact = [e for e in entries if e[0] == book]
        if len(folds[book.casefold()]) > 1 or (exact and len(exact) == len(cids)):
            entries = exact  # the exact spelling aligns on its own: as before
        if len(cids) == 1 and all(sheet == "" and sp == book for sp, sheet in entries):
            continue  # one column of that name, no other sheet has it
        if len(entries) != len(cids):
            out.update(dict.fromkeys(cids, ""))  # can't align: no sheet is proven
            continue
        for cid, (spelling, sheet) in zip(sorted(cids), entries, strict=True):
            bound = f"{spelling}@{sheet}" if sheet else spelling
            if bound != book:
                out[cid] = bound
    return out


def curve_sheet(
    cid: int, book: str, partner: int | None, off_sheet: Mapping[int, str]
) -> tuple[str, str]:
    """``(book key the curve binds to, omit reason)`` for the curve plotting
    column ``cid`` of ``book`` whose X partner (same book) is ``partner``.

    The key is ``book`` for a sheet-1 column (its datasets' spelling when
    that differs by case: ``off_sheet_ids``) and ``"Book@N"`` for sheet N.
    The reason is ``""`` (keep), ``"sheet_unknown"`` (the key is then
    ``""``), or ``"x_sheet_unproven"``: a re-bound curve whose X partner is
    not proven on the same sheet, so its X column cannot be named in
    ``Book@N``. A sheet-1 curve is omitted only when its partner is proven
    on ANOTHER sheet (an X looked up by name in sheet 1 would then be the
    wrong column; 0 such ids in the corpus): a partner of unknown sheet
    keeps the binding shipped before sheets were inferred.
    """
    sheet = off_sheet.get(cid, book)
    if not sheet:
        return "", "sheet_unknown"
    if partner is not None:
        partner_sheet = off_sheet.get(partner, book)
        if partner_sheet != sheet and (sheet != book or partner_sheet):
            return sheet, "x_sheet_unproven"
    return sheet, ""


def sheet_x_names(
    ids: Mapping[int, tuple[str, str]], x_ids: Iterable[int], off_sheet: Mapping[int, str]
) -> dict[str, str]:
    """``{"Book@N": short name of sheet N's first X-designated column}`` --
    the X of a re-bound curve whose Y record stores no partner, proven on
    the curve's own sheet by the same alignment (instead of sheet 1's
    ``book_x`` name, which ``Book@N`` may not have, or have as a Y)."""
    out: dict[str, str] = {}
    for cid in x_ids:
        book, name = ids[cid]
        sheet = off_sheet.get(cid, book)
        if sheet and sheet != book:
            out.setdefault(sheet, name)
    return out


def missing_x_reason(
    book: str,
    ids: Mapping[int, tuple[str, str]],
    x_ids: Iterable[int],
    off_sheet: Mapping[int, str],
) -> str:
    """Why a re-bound curve with no stored X partner has no X on its sheet
    (``sheet_x_names`` names none): ``"x_sheet_unproven"`` when an
    X-designated column of ``book`` is of unknown sheet (it may be that
    sheet's X), else ``"sheet_x_not_found"``: every X column the id table
    holds for the book is proven on another sheet. The sheet then has no X,
    or one whose record the table does not read (a Text X: plan item 67).
    With none, Origin plots by row number or by column position (per-column
    charts: ``Degree of impact ...`` Graph4A draws ``Book1A@2``'s 12 columns,
    ids 448-459 with none missing, at X = 1..12 in its saved preview);
    neither is decoded."""
    for cid in x_ids:
        if ids[cid][0] == book and off_sheet.get(cid) == "":
            return "x_sheet_unproven"
    return "sheet_x_not_found"


def _book_columns(books: Iterable[DataStruct]) -> dict[str, tuple[str, frozenset[str]]]:
    """``origin_book`` -> (its X column name, its value column names)."""
    out: dict[str, tuple[str, frozenset[str]]] = {}
    for ds in books:
        key = str(ds.metadata.get("origin_book", ""))
        names = ds.metadata.get("origin_column_names")
        if key and isinstance(names, list):
            x_name = str(ds.metadata.get("x_column_name") or "")
            out[key] = (x_name, frozenset(str(n) for n in names))
    return out


def _unbound_reason(
    curve: Mapping[str, Any], columns: Mapping[str, tuple[str, frozenset[str]]]
) -> str:
    """Why the frontend could not draw this re-bound curve from its
    ``Book@N`` (``originFigureSelection.figureBindingFor``), or ``""``."""
    entry = columns.get(str(curve.get("book")))
    if entry is None:
        return "book_not_imported"
    x_name, values = entry
    y, x = str(curve.get("y", "")), str(curve.get("x", ""))
    if y == x_name and y not in values:
        return "y_is_sheet_x"  # the importer made the plotted Y the sheet's X
    if y not in values:
        return "column_not_imported"
    if x and x != x_name and x not in values:
        return "x_not_imported"  # the sheet's X (often a text column) is not imported
    return ""


def unbound_rebinds(
    figs: list[dict[str, Any]], books: Iterable[DataStruct]
) -> list[dict[str, Any]]:
    """``figs`` with every RE-BOUND curve (book ``Book@N``) that the imported
    ``books`` cannot draw moved to ``curve_sheet_omitted`` (``recorded`` =
    its ``Book@N``, ``reason`` from ``_unbound_reason``) and its legend
    caption dropped. ``legend_labels`` is dense over the kept curves (one per
    curve, plot order), so a curve's caption is at its own index. Sheet-1
    curves are left exactly as decoded."""
    columns = _book_columns(books)
    out: list[dict[str, Any]] = []
    for fig in figs:
        curves = fig.get("curves") or []
        drop: dict[int, str] = {}
        for i, c in enumerate(curves):
            if "@" in str(c.get("book", "")) and (why := _unbound_reason(c, columns)):
                drop[i] = why
        if not drop:
            out.append(fig)
            continue
        notes = list(fig.get("curve_sheet_omitted") or [])
        for i, why in drop.items():
            c = curves[i]
            base = str(c["book"]).rpartition("@")[0]
            notes.append(
                {
                    "book": base,
                    "x": str(c["x"]),
                    "y": str(c["y"]),
                    "recorded": str(c["book"]),
                    "reason": why,
                }
            )
        out.append(
            {
                **fig,
                "curves": without_positions(curves, drop),
                "legend_labels": without_captions(fig.get("legend_labels") or [], drop),
                "curve_sheet_omitted": notes,
            }
        )
    return out


def without_positions(items: Sequence[_T], positions: Collection[int]) -> list[_T]:
    """``items`` minus the entries at ``positions``."""
    return [x for i, x in enumerate(items) if i not in positions]


# A caption's reference to curve n: `%(n)`, `%(n,@LG)`, `\l(n)`.
_CURVE_REF = re.compile(r"(%\(|\\l\()(\d+)(?=[,)])")


def without_captions(labels: Sequence[str], positions: Collection[int]) -> list[str]:
    """A layer's dense ``legend_labels`` (one per curve, plot order) once the
    curves at 0-based ``positions`` are gone: their captions are removed, so
    no kept curve inherits an omitted one's, and every remaining curve
    reference is renumbered to the kept curves (``%(4)`` -> ``%(3)`` when
    one earlier curve went). A caption that names an omitted curve becomes
    ``""`` (no caption, the frontend's default) rather than another curve's
    name."""
    gone = sorted(positions)

    def renumber(text: str) -> str:
        def sub(m: re.Match[str]) -> str:
            n = int(m.group(2))
            if n - 1 in positions:
                raise LookupError
            return f"{m.group(1)}{n - bisect_left(gone, n - 1)}"

        try:
            return _CURVE_REF.sub(sub, text)
        except LookupError:
            return ""

    return [renumber(x) for x in without_positions(labels, positions)]
