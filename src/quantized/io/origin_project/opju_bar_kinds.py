"""Column, bar, stacked and pie plots of a ``.opju`` layer: drawn as Origin does, or left out.

**The plot type** is byte 76 of the curve record (``opju_plot_kinds``), equal
to Origin C ``DataPlot::GetPlotType()`` on every plot of the 231 built
``tools/plot_corpus`` specimens (Origin 2026b Student, 2026-11-15): 203
column, 213 stacked column, 214 stacked area, 215 horizontal bar; 205, 207,
208, 216, 218 and the pie family 225 are kinds quantized has no renderer for.
``opju_plot_kinds.apply_plot_kind`` marks each such curve with a provisional
``plotType``; this pass resolves it per LAYER, because what Origin draws
depends on the layer's other plots:

* **one series = no stacking.** A stack of one series is the series itself
  (Origin stacks each plot on the ones before it). So a layer's ONLY
  stacked-area plot is quantized's ``"area"`` (fill down to Y = 0, the 204
  look) and its only stacked-column plot is a ``"column"``. A layer's only
  horizontal bar plot keeps ``"bar"`` (the ``.opj`` reader's horizontal bar,
  ``lib/uplotOrient``) when it is the only curve of a one-layer page made
  from Origin's ``Bar`` template (the 215 plot of ``Graph_Template`` Graph1,
  a ``PAN2HORZ`` page, shows upright bars in its preview). A bar
  plot turns Origin's whole layer: a column (203) plot beside it is drawn
  sideways too (``LSA_fig6`` Graph6 / Graph8 previews: two horizontal bar
  series, one 215 and one 203), a grouped horizontal chart quantized does not
  draw, so both are left out.
* **several column series** (203, or 213 on a ``StackColumn`` page): Origin
  draws them side by side (203) or stacked (213) per X. That is the Stat
  Stage bar chart grouped by the X column with one bar per row, so the
  figure gets ``bar_layout`` ``"grouped"`` / ``"stacked"`` when every curve
  of a one-layer page is one, all on one sheet against one X, no curve has
  an error bar and that X (from the imported book) holds unique, evenly
  spaced values where it is finite -- the frontend then opens the Stat Stage
  (``originFigureSelection.figureBarState``; the stage offers X as a group
  only for that pick, ``statPicks.withPickedXGroup``). A category is one
  row, so its bar IS the row's value (n = 1: no error whisker). Otherwise several 203 series draw as
  before (by their line style, ``opju_stat_plots``).
* **anything else** -- several stacked areas or horizontal bars, a stacked
  column not on a ``StackColumn`` page (the 100 % stacked ``StackColP``
  template reads back 213 too, and quantized has no 100 % stack), a
  ``"not_drawn"`` kind -- is LEFT OUT (``plot_type_not_drawn``): drawn as
  lines these show values where Origin shows none (a pie's slices, the
  unstacked tops of a stack).

**The template signal** (``opju_layer_kind.page_layer_kind``): the page header
names the template the graph was made from, cut to 9 characters. Origin's
stacked-column template is ``StackColumn`` (``StackColu``) and its 100 %
stacked one is cut to ``StackColP``; both read back 213 (plan: "270 -> 213";
``fig_6_a`` Graph2's preview runs 0..100 % from raw counts). Real corpus
(``.opju`` of ``test-data/origin/public``): 3 pages ``StackColu``, 2
``StackColP``; every other 213 page names a user template and stays left out.

Evidence and the per-page gallery check against Origin's saved previews are in
``docs/origin_re/plot_kinds.md``.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

import numpy as np

from quantized.io.origin_project.opju_curve_sheets import without_captions, without_positions
from quantized.io.origin_project.opju_figure_curves import opju_pages
from quantized.io.origin_project.opju_layer_kind import page_layer_kind

__all__ = [
    "BAR_LAYOUT",
    "BAR_MARKS_NOT_DECODED",
    "PLOT_TYPE_NOT_DRAWN",
    "apply_bar_kinds",
    "book_column",
]

PLOT_TYPE_NOT_DRAWN = "plot_type_not_drawn"
BAR_LAYOUT = "bar_layout"  # "grouped" / "stacked": the Stat Stage bar chart
# drawn, but with quantized's own bar colours, width and gaps (Origin's not decoded)
BAR_MARKS_NOT_DECODED = "bar_marks_not_decoded"
_TEMPLATES = (
    (re.compile(rb"(?i)stackcolp"), "percent"),
    (re.compile(rb"(?i)stackcolu"), "stacked"),
    (re.compile(rb"(?<![A-Za-z])Bar(?![A-Za-z])"), "bar"),  # Origin's Bar template
)
_PROVISIONAL = frozenset({"stacked_column", "stacked_area", "bar", "not_drawn"})


def book_column(books: Sequence[Any], book: str, col: str) -> np.ndarray | None:
    """Column ``col`` of the imported book ``book`` as floats: its X (``.time``)
    when ``col`` is the book's X -- or a text X that never became numeric,
    whose ``.time`` is the row index -- else the named column; ``None`` when
    the book or column is not there."""
    for bk in books:
        meta = getattr(bk, "metadata", {}) or {}
        if str(meta.get("origin_book") or "") != book:
            continue
        names = [str(n) for n in meta.get("origin_column_names") or []]
        x_name = str(meta.get("x_column_name") or "")
        if col == x_name or (not x_name and col not in names):
            return np.asarray(bk.time, dtype=float)
        if col in names:
            return np.asarray(np.asarray(bk.values, dtype=float)[:, names.index(col)], dtype=float)
        return None
    return None


def _even_unique_x(books: Sequence[Any], book: str, col: str) -> bool:
    """``True`` when the X column's finite values are unique and evenly
    spaced: the Stat Stage's one category per X value then sits where Origin's
    bar does. A row with no X is drawn by neither."""
    x = book_column(books, book, col)
    if x is None:
        return False
    xs = np.sort(x[np.isfinite(x)])
    if xs.size == 0:
        return False
    if xs.size == 1:
        return True
    d = np.diff(xs)
    return bool(d[0] > 0 and np.allclose(d, d[0], rtol=1e-9, atol=0.0))


def _bar_layout(curves: list[dict[str, Any]], kind: str, layers: int, books: Sequence[Any]) -> bool:
    """The several-series column layer is Origin's grouped / stacked bar
    chart quantized's Stat Stage draws (module docstring)."""
    if layers != 1 or len(curves) < 2 or any(c.get("plotType") != kind for c in curves):
        return False
    if len({(str(c.get("book")), str(c.get("x"))) for c in curves}) != 1:
        return False
    if any(c.get("yErr") for c in curves):
        return False
    return _even_unique_x(books, str(curves[0].get("book")), str(curves[0].get("x")))


def _left_out(fig: dict[str, Any], positions: list[int]) -> dict[str, Any]:
    curves = list(fig.get("curves") or [])
    notes = list(fig.get("curve_sheet_omitted") or [])
    for i in positions:
        c = curves[i]
        book = str(c.get("book", ""))
        notes.append(
            {
                "book": book.rpartition("@")[0] or book,
                "x": str(c.get("x", "")),
                "y": str(c.get("y", "")),
                "recorded": book,
                "reason": PLOT_TYPE_NOT_DRAWN,
            }
        )
    return {
        **fig,
        "curves": without_positions(curves, positions),
        "legend_labels": without_captions(fig.get("legend_labels") or [], positions),
        "curve_sheet_omitted": notes,
    }


def _resolve(
    fig: dict[str, Any], layers: int, template: str | None, books: Sequence[Any]
) -> dict[str, Any]:
    curves: list[dict[str, Any]] = [dict(c) for c in fig.get("curves") or []]
    by_kind: dict[str, list[int]] = {}
    for i, c in enumerate(curves):
        by_kind.setdefault(str(c.get("plotType")), []).append(i)
    gone: list[int] = list(by_kind.get("not_drawn", []))
    out = dict(fig)
    area = by_kind.get("stacked_area", [])
    if len(area) == 1:
        curves[area[0]]["plotType"] = "area"  # a stack of one
    else:
        gone += area
    bar = by_kind.get("bar", [])
    if bar and not (len(curves) == 1 and layers == 1 and template == "bar"):
        # Origin turns the whole layer: its column plots run sideways too
        gone += bar + by_kind.get("column", [])
    stacked = by_kind.get("stacked_column", [])
    if len(stacked) == 1 and "column" not in by_kind:
        curves[stacked[0]]["plotType"] = "column"  # a stack of one
    elif stacked and template == "stacked" and _bar_layout(curves, "stacked_column", layers, books):
        for i in stacked:
            curves[i]["plotType"] = "column"
        out[BAR_LAYOUT] = "stacked"
        out[BAR_MARKS_NOT_DECODED] = True
    else:
        gone += stacked
    if not stacked and not bar and _bar_layout(curves, "column", layers, books):
        out[BAR_LAYOUT] = "grouped"
        out[BAR_MARKS_NOT_DECODED] = True
    out["curves"] = curves
    return _left_out(out, sorted(gone)) if gone else out


def apply_bar_kinds(
    figs: list[dict[str, Any]], b: bytes, books: Sequence[Any]
) -> list[dict[str, Any]]:
    """``figs`` with every layer's provisional bar / stack / pie plot types
    resolved (module docstring). Figures with none are returned as they are."""
    layers: dict[str, int] = {}
    for f in figs:
        layers[str(f.get("name") or "")] = layers.get(str(f.get("name") or ""), 0) + 1
    templates: dict[str, str | None] = {}
    pages: list[tuple[int, str]] | None = None
    out: list[dict[str, Any]] = []
    for fig in figs:
        kinds = {str(c.get("plotType")) for c in fig.get("curves") or []}
        if not kinds & (_PROVISIONAL | {"column"}):
            out.append(fig)
            continue
        name = str(fig.get("name") or "")
        if kinds & {"stacked_column", "bar"} and name and name not in templates:
            if pages is None:
                pages = opju_pages(b)
            templates[name] = _template_kind(b, pages, name)
        count = layers[name] if name else 2  # unnamed: an embedded graph
        out.append(_resolve(fig, count, templates.get(name), books))
    return out


def _template_kind(b: bytes, pages: list[tuple[int, str]], name: str) -> str | None:
    """``"stacked"`` / ``"percent"`` / ``"bar"`` from the page's template, else
    ``None``."""
    for off, page in pages:
        if page == name:
            return page_layer_kind(b, off, name, _TEMPLATES)
    return None
