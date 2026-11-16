"""Box / violin / strip, histogram and column plots of a ``.opju`` graph (plan item 6).

**The plot type.** Byte 76 of a curve's record (``curve_style_color.
opju_style_record``) is Origin's plot type, the byte ``opju_plot_gates``
already reads for error bars. On the 231 built ``tools/plot_corpus``
specimens (25 plot types, Origin 2026b Student, 2026-11-15) it equals Origin C
``DataPlot::GetPlotType()`` on every plot, box / violin / strip (206) and
histogram (219) included.

**No X column.** Origin draws these against no X: its ``xof()`` of every such
plot is the row-index pseudo-dataset ``_A``, and the token's record X id is 0
(``opju_curve_token_x``: ``x_not_a_column``). quantized draws them on the Stat
Stage from the Y column alone, so such a curve is KEPT with ``x == ""`` and a
``plotType`` instead of being omitted. A 206 / 219 curve whose record names
an X column (Origin's indexed / grouped box chart) is not this shape and is
not touched here.

**Box vs violin vs strip.** All three read back 206; only the page's template
differs (``Box`` / ``Violin`` / ``ColumnScatter``, ``worksheet -p 206 <tpl>``),
and the page header names it (``opju_layer_kind.page_layer_kind``). The name
is a SUFFICIENT signal: a template naming none of the three (a merged graph,
``MergeGrap``), or more than one, leaves every such curve omitted
(``box_kind_not_decoded``). A layer whose curves are not ALL row-less curves
of one kind is not drawn on the Stat Stage, so its row-less curves are
omitted again (``x_not_a_column``), never drawn against the sheet's X, and
so are those of a page with more than one decoded layer (the frontend applies
such a page panel by panel on the XY stage): ``stat_layer_in_multi_layer_page``,
and of a layer plotting several books (applied as an XY overlay):
``stat_layer_of_several_books``.
**Column plots (203).** A curve whose record is Origin's column plot carries
``plotType`` ``"column"``: the frontend draws it as bars from zero at each X
(``originCurveSeriesStyle``), Origin's figure for ONE column series. Origin
draws several column series of a layer side by side; those bars would overlap
in quantized, so a layer with more than one keeps none (they draw as before,
by their line style). Stacked (213), horizontal (215 / 216) and floating (207)
columns are not decoded here.

**What a drawn figure still lacks** is noted on it, the way
``marker_encoding_not_decoded`` is (``fidelity``): a histogram carries
``histogram_bins_not_decoded`` (Origin's bin width / start are not decoded;
quantized bins with its own default rule, so bar heights can differ), and a
box / violin / strip carries ``box_marks_not_decoded`` (quantized draws its own
whisker rule and marks; Origin's box statistics, data-point / half-violin /
distribution overlays are not decoded). The overlays are NOT told from the
template: ``SOP_meas`` Graph78's template is plain ``BOX`` yet Origin draws a
distribution curve beside each box, so every box-family figure carries the
note.

A histogram layer of several columns is omitted too
(``histogram_of_several_columns``): the Stat Stage bins one column, Origin
bins each, so drawing the first alone would show a different figure.
"""

from __future__ import annotations

import re
from typing import Any

from quantized.io.origin_project.opju_curve_sheets import without_captions, without_positions
from quantized.io.origin_project.opju_figure_curves import opju_pages
from quantized.io.origin_project.opju_layer_kind import page_layer_kind
from quantized.io.origin_project.opju_plot_kinds import X_NOT_A_COLUMN as _X_NOT_A_COLUMN

__all__ = [
    "BOX_KIND_NOT_DECODED",
    "BOX_MARKS_NOT_DECODED",
    "HISTOGRAM_BINS_NOT_DECODED",
    "HISTOGRAM_OF_SEVERAL_COLUMNS",
    "STAT_LAYER_IN_PANELS",
    "STAT_LAYER_OF_SEVERAL_BOOKS",
    "apply_stat_kinds",
]

BOX_KIND_NOT_DECODED = "box_kind_not_decoded"
# Figure-level fidelity notes (the ``marker_encoding_not_decoded`` mechanism):
# the figure IS drawn, but not with Origin's own bins / box marks.
HISTOGRAM_BINS_NOT_DECODED = "histogram_bins_not_decoded"
BOX_MARKS_NOT_DECODED = "box_marks_not_decoded"
STAT_LAYER_IN_PANELS = "stat_layer_in_multi_layer_page"
HISTOGRAM_OF_SEVERAL_COLUMNS = "histogram_of_several_columns"
STAT_LAYER_OF_SEVERAL_BOOKS = "stat_layer_of_several_books"
_BOX_FAMILY = "box"  # provisional plotType of a 206 curve until the page names it
_BOX_KINDS = (
    (re.compile(rb"(?i)violin"), "violin"),
    (re.compile(rb"(?i)columnsca"), "strip"),
    (re.compile(rb"(?i)box"), "box"),
)
_STAT_KINDS = frozenset({"box", "violin", "strip", "histogram"})


def _rowless(c: Any) -> bool:
    return isinstance(c, dict) and c.get("x") == "" and c.get("plotType") in _STAT_KINDS


def apply_stat_kinds(figs: list[dict[str, Any]], b: bytes) -> list[dict[str, Any]]:
    """``figs`` with each layer's row-less stat curves resolved (box family
    by the page template) or omitted again (module docstring)."""
    layers: dict[str, int] = {}
    for f in figs:
        layers[str(f.get("name") or "")] = layers.get(str(f.get("name") or ""), 0) + 1
    kinds: dict[str, str | None] = {}
    pages: list[tuple[int, str]] | None = None
    out: list[dict[str, Any]] = []
    for fig in figs:
        fig = _single_column_only(fig)
        curves = list(fig.get("curves") or [])
        rowless = [i for i, c in enumerate(curves) if _rowless(c)]
        if not rowless:
            out.append(fig)
            continue
        found = {str(curves[i]["plotType"]) for i in rowless}
        kind: str | None = found.pop() if len(found) == 1 else None
        reason = _X_NOT_A_COLUMN
        name = str(fig.get("name") or "")
        if kind == _BOX_FAMILY and name:
            if name not in kinds:
                if pages is None:
                    pages = opju_pages(b)
                kinds[name] = _box_kind(b, pages, name)
            kind = kinds[name]
            reason = BOX_KIND_NOT_DECODED
        if not name or layers[name] > 1:
            # a multi-layer page is applied panel by panel on the XY stage
            # (unnamed: an embedded graph, not a page of its own)
            kind, reason = None, STAT_LAYER_IN_PANELS
        elif len(rowless) != len(curves):
            kind, reason = None, _X_NOT_A_COLUMN
        elif len({str(c.get("book")) for c in curves}) > 1:
            # curves of several books apply as an XY overlay, not a Stat Stage
            kind, reason = None, STAT_LAYER_OF_SEVERAL_BOOKS
        elif kind == "histogram" and len(curves) > 1:
            # the Stat Stage bins one column; Origin bins each (plan item 15)
            kind, reason = None, HISTOGRAM_OF_SEVERAL_COLUMNS
        if kind is not None:
            note = HISTOGRAM_BINS_NOT_DECODED if kind == "histogram" else BOX_MARKS_NOT_DECODED
            out.append({**fig, "curves": [{**c, "plotType": kind} for c in curves], note: kind})
            continue
        notes = list(fig.get("curve_sheet_omitted") or [])
        notes += [
            {
                "book": str(curves[i].get("book", "")).rpartition("@")[0]
                or str(curves[i].get("book", "")),
                "x": "",
                "y": str(curves[i].get("y", "")),
                "recorded": str(curves[i].get("book", "")),
                "reason": reason,
            }
            for i in rowless
        ]
        out.append(
            {
                **fig,
                "curves": without_positions(curves, rowless),
                "legend_labels": without_captions(fig.get("legend_labels") or [], rowless),
                "curve_sheet_omitted": notes,
            }
        )
    return out


def _single_column_only(fig: dict[str, Any]) -> dict[str, Any]:
    """``fig`` with its ``"column"`` plot types dropped when it has more than
    one: Origin draws a layer's column series side by side, quantized's bars
    from zero at each X would overlap them (module docstring)."""
    curves = fig.get("curves") or []
    if sum(1 for c in curves if c.get("plotType") == "column") <= 1:
        return fig
    return {
        **fig,
        "curves": [
            {k: v for k, v in c.items() if k != "plotType"} if c.get("plotType") == "column" else c
            for c in curves
        ],
    }


def _box_kind(b: bytes, pages: list[tuple[int, str]], name: str) -> str | None:
    """box / violin / strip from the page template, or ``None`` (unnamed,
    or a name matching more than one)."""
    if not name:
        return None
    for off, page in pages:
        if page == name:
            hits = {k for pat, k in _BOX_KINDS if page_layer_kind(b, off, name, ((pat, k),))}
            return hits.pop() if len(hits) == 1 else None
    return None
