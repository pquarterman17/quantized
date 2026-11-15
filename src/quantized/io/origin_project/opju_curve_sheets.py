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
``curve_sheet_unresolved``, and the layer stays in the import even when
every curve is omitted. ``unbound_rebinds`` adds the import-time check the
byte decoder cannot make: a re-bound curve whose pseudo-book or column the
importer did not produce is omitted the same way rather than silently
skipped by the frontend.

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
from collections.abc import Collection, Iterable, Mapping, Sequence
from typing import Any, TypeVar

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opju_blocks import find_headers

__all__ = [
    "curve_sheet",
    "dataset_sheet_order",
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
    for h in find_headers(b):
        if not h.is_column:
            continue
        base, _, sheet = h.name.partition("@")
        book, _, col = base.rpartition("_")
        if not book:
            continue
        sheets = out.setdefault((book, col), [])
        if sheet not in sheets:
            sheets.append(sheet)
    return out


def off_sheet_ids(b: bytes, ids: Mapping[int, tuple[str, str]]) -> dict[int, str]:
    """Column id -> the sheet it is recorded on, for every id NOT provably
    on its book's unsuffixed sheet: ``"Book@N"`` when the rank alignment
    (module docstring) names the sheet, ``""`` when it cannot.

    An id absent from the result is plain: its binding to ``book`` is the
    sheet the importer models as ``book``.
    """
    by_name: dict[tuple[str, str], list[int]] = {}
    for cid, key in ids.items():
        by_name.setdefault(key, []).append(cid)
    order = dataset_sheet_order(b)
    out: dict[int, str] = {}
    for (book, col), cids in by_name.items():
        sheets = order.get((book, col), [])
        if len(cids) == 1 and sheets in ([], [""]):
            continue  # one column of that name, no other sheet has it
        if len(sheets) != len(cids):
            out.update(dict.fromkeys(cids, ""))  # can't align: no sheet is proven
            continue
        for cid, sheet in zip(sorted(cids), sheets, strict=True):
            if sheet:
                out[cid] = f"{book}@{sheet}"
    return out


def curve_sheet(
    cid: int, book: str, partner: int | None, off_sheet: Mapping[int, str]
) -> tuple[str, str]:
    """``(book key the curve binds to, omit reason)`` for the curve plotting
    column ``cid`` of ``book`` whose X partner (same book) is ``partner``.

    The key is ``book`` for a sheet-1 column and ``"Book@N"`` for sheet N.
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
    if y not in values or (x and x != x_name and x not in values):
        return "column_not_imported"
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
