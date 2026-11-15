"""Plan item 3: how a quantized user builds each corpus plot type FROM SCRATCH.

One row per corpus type (``plot_types.PLOT_TYPES``). A buildable row is a
list of UI steps the vitest recipe harness
(``frontend/src/test/plotCorpus/``) replays against the real store, in the
order a user clicks them:

* ``{"gallery": id}``      Plot > Plot type... tile (``lib/plotTypes.ts``,
                           committed by ``figureDialogActions.applyPlotType``)
* ``{"seriesMode": m}``    Series card trace mode (``lib/seriesMode.ts``)
* ``{"waterfall": f}``     Channels card waterfall offset (fraction of span)
* ``{"statMode": m}``      Stat Stage plot-type picker (no gallery tile)
* ``{"plotOnly": n}``      Channels card: plot only the first ``n`` Y columns
* ``{"sizeBy": k}`` / ``{"colorBy": k}``  Series card size-by / colour-by
                           the ``k``-th Y column (0-based among Y columns)
* ``{"contour": bool}``    Map toolbar contour toggle
* ``{"command": "ternary"}``  Plot > Ternary diagram... (opens the workshop)

An unbuildable row carries ``missing``: what quantized lacks, which is the
cloud item booked in ``plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md``. Nothing here
builds a plot type; the table only names the clicks that already exist.
"""

from __future__ import annotations

from typing import Any

__all__ = ["RECIPES", "QZ_KIND", "recipe_for"]

RECIPES: dict[str, dict[str, Any]] = {
    "line": {"steps": [{"gallery": "line"}]},
    "scatter": {"steps": [{"gallery": "scatter"}]},
    "line_symbol": {"steps": [{"gallery": "lineSymbol"}]},
    "area": {"steps": [{"gallery": "area"}]},
    "step_horizontal": {
        "steps": [{"gallery": "line"}, {"seriesMode": "step"}],
        "note": "no gallery tile; Series card trace mode Step (post)",
    },
    "double_y": {"steps": [{"gallery": "doubleY"}]},
    "y_error": {
        "steps": [{"gallery": "scatter"}],
        "note": "error columns set with worksheet Set As (prelude)",
    },
    "stacked_lines_offset": {
        "steps": [{"gallery": "line"}, {"waterfall": 0.5}],
        "note": "the gallery Waterfall tile opens the multi-DATASET waterfall "
        "workshop; a one-sheet Y offset is the Channels card waterfall slider",
    },
    "polar": {"steps": [{"gallery": "polar"}]},
    "column": {"steps": [{"gallery": "column"}]},
    "stacked_column": {"steps": [{"gallery": "stackedColumn"}]},
    "box": {"steps": [{"gallery": "box"}]},
    "violin": {"steps": [{"gallery": "violin"}]},
    "strip": {
        "steps": [{"gallery": "box"}, {"statMode": "strip"}],
        "note": "no gallery tile; Stat Stage plot-type picker Strip",
    },
    "histogram": {"steps": [{"gallery": "histogram"}]},
    "bubble": {
        "steps": [{"gallery": "scatter"}, {"plotOnly": 1}, {"sizeBy": 1}],
        "note": "no gallery tile; Series card size-by",
    },
    "color_mapped": {
        "steps": [{"gallery": "scatter"}, {"plotOnly": 1}, {"colorBy": 1}],
        "note": "no gallery tile; Series card colour-by",
    },
    "contour_xyz": {"steps": [{"gallery": "contour"}]},
    "contour_matrix": {
        "steps": [{"gallery": "contour"}],
        "note": "matrix imported as long-form X,Y,Z (no matrix-sheet import)",
    },
    "heatmap_matrix": {
        "steps": [{"gallery": "contour"}, {"contour": False}],
        "note": "Contour / Heatmap tile, then the map's contour toggle off",
    },
    "ternary": {
        "steps": [{"command": "ternary"}],
        "note": "Plot > Ternary diagram...: the gallery Ternary tile refuses an "
        "A,B,C sheet ('Needs three composition columns') because the first CSV "
        "column imports as the X axis, leaving two channels",
    },
    # -- not buildable from scratch (cloud items, see the plan) -------------
    "stacked_area": {
        "missing": "no stacked (cumulative) area: `fill` is under-zero or "
        "between two curves, never stacked on the previous series"
    },
    "bar": {
        "missing": 'no horizontal bar creation: `SeriesStyle.bars = "horizontal"` '
        "renders but only an Origin import sets it; no gallery tile, Series card "
        "control or Stat Stage orientation"
    },
    "stacked_bar": {
        "missing": "no horizontal stacked bar: the Stat Stage bar is "
        'vertical only and `bars: "horizontal"` has no stacking'
    },
    "floating_column": {
        "missing": "no floating column (bars spanning two Y columns, "
        "low to high): every bar starts at zero"
    },
}

# The quantized type name a built spec is scored as (the corpus name it must
# equal); map types share one name per kind, and y_error is Origin's scatter
# (its error bars are scored as part of the binding).
QZ_KIND = {
    "contour_xyz": "contour",
    "contour_matrix": "contour",
    "heatmap_matrix": "heatmap",
    "y_error": "scatter",
}


def recipe_for(ptype: str) -> dict[str, Any]:
    return RECIPES[ptype]
