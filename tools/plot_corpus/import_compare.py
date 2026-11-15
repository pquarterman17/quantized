"""Pure comparison logic for the import scorer (``score_import.py``).

Plan item 2 of ``plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md``. Everything here
takes plain dicts (an ``oracle.json`` graph, the import's figure dicts, the
imported books' metadata) and returns plain JSON-able verdicts, so it is unit
tested on tiny synthetic fixtures with no corpus and no Origin.

Every verdict carries a ``status``:

* ``match``   -- quantized has the value and it equals Origin's;
* ``wrong``   -- quantized HAS a value and it differs (the finding that
  matters most: a wrong value is worse than a missing one);
* ``phantom`` -- quantized shows something Origin does not (a curve Origin
  never plotted, a sheet Origin deleted);
* ``omitted`` -- quantized has no value; ``reason`` says why.

Tables quantized itself decides (Origin's colour list, symbol gallery) are
imported from quantized, never restated (fixtures rule).
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from typing import Any

from quantized.io.origin_project.curve_style_color import _SYMBOL_SHAPES, ocolor_to_rgb

__all__ = [
    "EXPECTED_KIND",
    "ERROR_BAR_CODES",
    "classify_curves",
    "compare_axes",
    "compare_styles",
    "drawn_kind",
    "oracle_curves",
    "pair_figures",
    "parse_ref",
    "parse_x_dataset",
    "score_plot_type",
    "verdict",
]

# Origin plot codes of the error-bar companions (plot_types.ERROR_BAR_TYPES):
# 231 Y-error, 233 X-error. They are not curves of their own; quantized draws
# them from the column designation.
ERROR_BAR_CODES = {231: "Y-error", 233: "X-error"}

# What quantized should draw for each corpus plot type (the corpus id is the
# directory name, plot_types.PLOT_TYPES). The vocabulary is drawn_kind's.
EXPECTED_KIND: dict[str, str] = {
    "line": "line",
    "scatter": "scatter",
    "line_symbol": "line_symbol",
    "step_horizontal": "step",
    "area": "area",
    "stacked_area": "stacked_area",
    "double_y": "line_symbol",
    "y_error": "scatter",
    "stacked_lines_offset": "waterfall",
    "polar": "polar",
    "column": "column",
    "stacked_column": "stacked_column",
    "bar": "bar",
    "stacked_bar": "stacked_bar",
    "floating_column": "floating_column",
    "box": "box",
    "violin": "violin",
    "strip": "strip",
    "histogram": "histogram",
    "bubble": "bubble",
    "color_mapped": "color_mapped",
    "contour_xyz": "contour",
    "contour_matrix": "contour",
    "heatmap_matrix": "heatmap",
    "ternary": "ternary",
}

_REF_RE = re.compile(r'^\[(?P<book>[^\]]+)\](?P<sheet>[^!]+)!(?P<col>[^"]+)(?:"(?P<long>.*)")?$')
_REL_TOL = 1e-9


def verdict(status: str, **detail: Any) -> dict[str, Any]:
    """One check's result: ``{"status": ..., **detail}``."""
    return {"status": status, **detail}


def parse_ref(ref: str) -> dict[str, str] | None:
    """``[Book]Sheet!B"long"`` -> ``{"book", "sheet", "col", "long"}``."""
    m = _REF_RE.match(ref or "")
    if not m:
        return None
    return {k: (v or "") for k, v in m.groupdict().items()}


def parse_x_dataset(name: str | None) -> str | None:
    """Origin X dataset name -> its column letter. ``"Clean_A"`` -> ``"A"``;
    ``"_A"`` (Origin's "no X column": row index) -> ``None``."""
    if not name or name.startswith("_"):
        return None
    col = name.rsplit("_", 1)[-1]
    return col.split("@", 1)[0] or None


def oracle_curves(graph: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every plot Origin reports, flattened: layer, index, binding, type, style."""
    out: list[dict[str, Any]] = []
    for layer in graph.get("layers", []):
        for plot in layer.get("plots", []):
            ref = parse_ref(str(plot.get("ref", ""))) or {}
            out.append(
                {
                    "layer": int(layer.get("index", 0)),
                    "index": int(plot.get("index", 0)),
                    "book": ref.get("book", ""),
                    "sheet": ref.get("sheet", ""),
                    "y": ref.get("col", ""),
                    "x": parse_x_dataset(plot.get("x_dataset")),
                    "plot_type": int(plot.get("plot_type", -1)),
                    "error_bar": ERROR_BAR_CODES.get(int(plot.get("plot_type", -1))),
                    "plot": dict(plot),
                }
            )
    return out


def _close(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=_REL_TOL, abs_tol=1e-12)


def pair_figures(
    figures: Sequence[Mapping[str, Any]], graph: Mapping[str, Any]
) -> tuple[list[tuple[int, int | None, str]], list[int]]:
    """Pair each oracle layer with an imported figure dict.

    Returns ``([(layer index, figure index or None, how)], unpaired figure
    indices)``. A figure carrying the oracle's page name pairs by
    ``(name, layer)``; figures with no name (the decoder could not attribute
    the page) pair by order, and ``how`` says so.
    """
    page = str(graph.get("page", ""))
    layers = [int(layer.get("index", 0)) for layer in graph.get("layers", [])]
    named = {
        (str(f.get("name", "")), int(f.get("layer", 1))): i for i, f in enumerate(figures)
    }
    pairs: list[tuple[int, int | None, str]] = []
    used: set[int] = set()
    unnamed = [i for i, f in enumerate(figures) if not f.get("name")]
    for li in layers:
        fi = named.get((page, li + 1))
        if fi is not None:
            pairs.append((li, fi, "name"))
            used.add(fi)
            continue
        free = [i for i in unnamed if i not in used]
        if free:
            pairs.append((li, free[0], "order"))
            used.add(free[0])
        else:
            pairs.append((li, None, "missing"))
    return pairs, [i for i in range(len(figures)) if i not in used]


def compare_axes(
    oracle_axes: Mapping[str, Any], fig: Mapping[str, Any] | None, why_missing: str
) -> dict[str, dict[str, Any]]:
    """Per axis field (x/y from/to/log) verdicts for one layer."""
    out: dict[str, dict[str, Any]] = {}
    for ax in ("x", "y"):
        o = oracle_axes.get(ax) or {}
        for field in ("from", "to"):
            key = f"{ax}_{field}"
            want = o.get(field)
            got = None if fig is None else fig.get(key)
            if want is None:
                continue
            if got is None:
                out[key] = verdict("omitted", origin=want, reason=why_missing)
            elif _close(float(got), float(want)):
                out[key] = verdict("match", origin=want, quantized=got)
            else:
                out[key] = verdict("wrong", origin=want, quantized=got)
        if o.get("type") is not None:
            want_log = int(o["type"]) == 2
            got_log = None if fig is None else fig.get(f"{ax}_log")
            key = f"{ax}_log"
            if got_log is None:
                out[key] = verdict("omitted", origin=want_log, reason=why_missing)
            else:
                out[key] = verdict(
                    "match" if bool(got_log) == want_log else "wrong",
                    origin=want_log,
                    quantized=bool(got_log),
                )
    return out


def classify_curves(
    oracle: Sequence[Mapping[str, Any]],
    decoded: Sequence[Mapping[str, Any]],
    sheet_ids: Mapping[tuple[str, str], str],
    why_missing: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Classify one layer's oracle curves against the import's decoded ones.

    ``sheet_ids`` maps Origin ``(book, sheet)`` to the dataset id quantized
    gave that sheet (``"Book"``, ``"Book@2"`` ...). Error-bar plots are left
    to the designation check and skipped here. Returns ``(per oracle curve
    verdicts, phantom decoded curves)``. A decoded curve on the right Y but
    another X, or sitting at an oracle curve's position bound to another
    column, is ``wrong``; one matching no oracle curve is a ``phantom``.
    """
    curves = [c for c in oracle if not c.get("error_bar")]
    used: set[int] = set()
    results: list[dict[str, Any]] = []
    pending: list[tuple[int, Mapping[str, Any], str]] = []
    for pos, c in enumerate(curves):
        want_book = sheet_ids.get((c["book"], c["sheet"]), c["book"])
        want = {"book": want_book, "x": c["x"], "y": c["y"]}
        hit = next(
            (
                i
                for i, d in enumerate(decoded)
                if i not in used and d.get("book") == want_book and d.get("y") == c["y"]
            ),
            None,
        )
        if hit is None:
            pending.append((pos, c, want_book))
            results.append({})
            continue
        used.add(hit)
        d = decoded[hit]
        # No X in Origin (box/histogram: row index) -> any decoded X is moot.
        if c["x"] is None or d.get("x") == c["x"]:
            results.append(verdict("match", origin=want, quantized=_bind(d), decoded_index=hit))
        else:
            results.append(
                verdict("wrong", origin=want, quantized=_bind(d), decoded_index=hit, field="x")
            )
    for pos, c, want_book in pending:
        want = {"book": want_book, "x": c["x"], "y": c["y"]}
        if pos < len(decoded) and pos not in used:
            used.add(pos)
            results[pos] = verdict(
                "wrong", origin=want, quantized=_bind(decoded[pos]), decoded_index=pos, field="y"
            )
        else:
            results[pos] = verdict("omitted", origin=want, reason=why_missing)
    phantoms = [
        verdict("phantom", quantized=_bind(d), decoded_index=i)
        for i, d in enumerate(decoded)
        if i not in used
    ]
    return results, phantoms


def _bind(d: Mapping[str, Any]) -> dict[str, Any]:
    return {"book": d.get("book"), "x": d.get("x"), "y": d.get("y")}


def compare_styles(
    plot: Mapping[str, Any],
    requested: Mapping[str, Any] | None,
    decoded: Mapping[str, Any] | None,
    why_missing: str,
) -> dict[str, dict[str, Any]]:
    """The styles the corpus planted on this curve (``requested_styles``:
    ``c`` colour, ``w`` line width, ``d`` dash, ``k`` symbol, ``z`` symbol
    size) against the decoded curve's ``color``/``lineWidth``/``symbol``/
    ``symbolSize``. Only planted fields are scored: an unplanted style is
    Origin's default, not a known answer."""
    out: dict[str, dict[str, Any]] = {}
    req = requested or {}
    fields: list[tuple[str, str, Any, str | None]] = []
    if "c" in req:
        fields.append(("color", "c", ocolor_to_rgb(int(plot.get("get_color") or 0)), "color"))
    if "w" in req:
        fields.append(("line_width", "w", plot.get("line_width"), "lineWidth"))
    if "d" in req:
        # OriginCurve has no dash field: quantized never imports it.
        fields.append(("dash", "d", plot.get("get_dash"), None))
    if "k" in req:
        kind = int(plot.get("symbol_kind") or 0)
        fields.append(("symbol", "k", _SYMBOL_SHAPES.get(kind, f"kind {kind}"), "symbol"))
    if "z" in req:
        fields.append(("symbol_size", "z", plot.get("symbol_size"), "symbolSize"))
    for name, _code, want, key in fields:
        if key is None:
            out[name] = verdict("omitted", origin=want, reason="no_field_in_OriginCurve")
            continue
        got = None if decoded is None else decoded.get(key)
        if got is None:
            out[name] = verdict(
                "omitted", origin=want, reason=why_missing if decoded is None else "not_decoded"
            )
        elif isinstance(want, (int, float)) and isinstance(got, (int, float)):
            out[name] = verdict(
                "match" if _close(float(got), float(want)) else "wrong", origin=want, quantized=got
            )
        else:
            same = str(got).lower() == str(want).lower()
            out[name] = verdict("match" if same else "wrong", origin=want, quantized=got)
    return out


def drawn_kind(curves: Sequence[Mapping[str, Any]]) -> str:
    """What the frontend draws for a figure's decoded curves
    (``lib/originFigureSelection.ts`` + ``lib/originCurveText.ts``):
    ``histogram`` when every curve is an Origin histogram (``figureStatState``),
    ``column``/``bar`` for bar plot types (``originCurveSeriesStyle``), else the
    decoded line style; ``default`` = no decoded curve or style (the dataset's
    default line view); ``mixed`` when curves disagree."""
    if not curves:
        return "default"
    if all(c.get("plotType") == "histogram" for c in curves):
        return "histogram"
    kinds = {
        str(c.get("plotType"))
        if c.get("plotType") in ("column", "bar")
        else str(c.get("style") or "default")
        for c in curves
    }
    return kinds.pop() if len(kinds) == 1 else "mixed"


def score_plot_type(corpus_type: str, origin_codes: Sequence[int], kind: str) -> dict[str, Any]:
    """Plot-type verdict: the kind quantized draws vs the corpus type's expected
    kind. ``default`` drawn for a line plot coincides with Origin (``match``,
    ``by_default``); for anything else it is ``omitted`` (no type decoded)."""
    want = EXPECTED_KIND.get(corpus_type, corpus_type)
    codes = sorted({c for c in origin_codes if c not in ERROR_BAR_CODES})
    if kind == "none":
        return verdict("omitted", origin=want, origin_codes=codes, quantized=kind,
                       reason="figure_not_drawn")
    if kind == "default":
        if want == "line":
            return verdict(
                "match", origin=want, origin_codes=codes, quantized=kind, by_default=True
            )
        return verdict(
            "omitted",
            origin=want,
            origin_codes=codes,
            quantized=kind,
            reason="no_plot_type_decoded_default_line_view",
        )
    return verdict(
        "match" if kind == want else "wrong", origin=want, origin_codes=codes, quantized=kind
    )
