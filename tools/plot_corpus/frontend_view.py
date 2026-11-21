"""What the frontend DRAWS for an imported Origin figure (Python mirror).

Plan item 2 of ``plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md``. A decoded curve is
only half the import: the frontend decides what reaches the plot. This mirrors
the four frontend rules involved, line for line:

* ``lib/originFigureEntries.ts::resolveFigureDataset`` -- which imported
  dataset a figure opens on;
* ``lib/originOverlayFigure.ts::buildOverlayDataset`` -- the apply's FIRST
  branch: curves on >= 2 (book, X column) blocks (cross-book, or one book's
  X,Y,X,Y multi-X sheet) draw as an overlay, each Y against its own X;
* ``lib/originFigureSelection.ts::figureChannelSelection`` -- decoded curves
  -> ``xKey``/``yKeys`` (``null`` when nothing maps);
* ``lib/originFigureSelection.ts::figureStatState`` -- an all-histogram /
  all-box / all-violin / all-strip figure opens the Stat stage (a histogram of
  the first curve; one box / violin / strip per plotted channel);
* the dataset DEFAULT view the apply falls back to when the selection is
  ``null`` (``figureSelectionState``): ``lib/errorbars.ts::
  bookDefaultHiddenChannels`` (non-Y/Z designations hidden) plus
  ``lib/ownXSeries.ts::ownXSeries`` (each Y against its nearest-preceding X).

A mirror can drift, so the cases in
``tests/fixtures/plot_corpus/frontend_view_cases.json`` are asserted on BOTH
sides: by pytest against these functions and by vitest
(``frontend/src/lib/plotCorpusFrontendView.test.ts``) against the real ones.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from import_compare import drawn_kind

__all__ = [
    "bar_chart_kind",
    "channel_selection",
    "overlay_curves",
    "default_view",
    "drawn_curves",
    "has_curve_evidence",
    "resolve_dataset",
    "stat_histogram_value",
    "stat_view",
]

# lib/columnmeta.ts DESIGNATIONS: anything else reads as undefined.
_DESIGNATIONS = {"X", "Y", "Z", "Y-error", "X-error", "label", "disregard"}


def _letters(meta: Mapping[str, Any]) -> list[str] | None:
    names = meta.get("origin_column_names")
    return [str(n) for n in names] if isinstance(names, list) else None


def _finite_col(values: Sequence[Sequence[float]], c: int) -> bool:
    return any(c < len(row) and math.isfinite(row[c]) for row in values)


def resolve_dataset(
    figure: Mapping[str, Any], candidates: Sequence[Mapping[str, Any]]
) -> int | None:
    """Index of the candidate the figure opens on (``resolveFigureDataset``).
    Each candidate is ``{"name", "metadata"}``."""
    if len(candidates) == 1:
        return 0
    if not candidates:
        return None
    for curve in figure.get("curves") or []:
        for i, c in enumerate(candidates):
            if str(c["metadata"].get("origin_book") or "") == curve.get("book"):
                return i
    hint = str(figure.get("source_hint") or "").strip().lower()
    if not hint:
        return None
    for i, c in enumerate(candidates):
        meta = c["metadata"]
        short = str(meta.get("origin_book") or "").strip().lower()
        long = str(meta.get("origin_book_long") or "").strip().lower()
        if short and (hint == short or short in hint or hint in short):
            return i
        if long and (hint == long or long in hint or hint in long):
            return i
        if hint in str(c.get("name") or "").lower():
            return i
    return None


def _channel_of(meta: Mapping[str, Any], letter: str) -> int:
    """``channelOf``: the designated-X letter -> -2 (``.time``), else the
    value-channel index, or -1."""
    if letter and letter == str(meta.get("x_column_name") or ""):
        return -2
    letters = _letters(meta) or []
    return letters.index(letter) if letter in letters else -1


def overlay_curves(
    figure: Mapping[str, Any], candidates: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]] | None:
    """The curves ``buildOverlayDataset`` binds (``[{book, x, y, curve}]``,
    in curve order), or ``None`` when the figure is not an overlay: fewer
    than 2 bound curves or fewer than 2 distinct (book, X channel) blocks
    (``assembleOverlay``)."""
    bound: list[dict[str, Any]] = []
    for curve in figure.get("curves") or []:
        ds = next(
            (c for c in candidates
             if str(c["metadata"].get("origin_book") or "") == curve.get("book")),
            None,
        )
        if ds is None:
            continue
        meta = ds["metadata"]
        y = str(curve.get("y") or "")
        if _channel_of(meta, y) == -1:
            continue
        cx = str(curve.get("x") or "")
        x_ch = _channel_of(meta, cx) if cx else -2
        if cx and x_ch == -1:
            continue
        x = str(meta.get("x_column_name") or "") if x_ch == -2 else (_letters(meta) or [])[x_ch]
        bound.append({"book": str(meta.get("origin_book") or ""), "x": x, "y": y,
                      "block": (id(ds), x_ch), "curve": curve})
    if len(bound) < 2 or len({b["block"] for b in bound}) < 2:
        return None
    return bound


def channel_selection(figure: Mapping[str, Any], ds: Mapping[str, Any]) -> dict[str, Any] | None:
    """``{"xKey", "yKeys"}`` (``figureChannelSelection``, materialized data)."""
    meta = ds["metadata"]
    letters = _letters(meta)
    if letters is None:
        return None
    book = str(meta.get("origin_book") or "")
    mine = [c for c in figure.get("curves") or [] if c.get("book") == book]
    if not mine:
        return None
    x_letter = str(meta.get("x_column_name") or "")
    time, values = ds["time"], ds["values"]
    y_keys: list[int] = []
    x_key: int | None = None
    for curve in mine:
        y = curve.get("y")
        if y not in letters:
            continue
        y_idx = letters.index(y)
        cells = any(y_idx < len(row) for row in values)
        if cells and not _finite_col(values, y_idx):
            continue
        cx = curve.get("x")
        requested = letters.index(cx) if cx and cx != x_letter and cx in letters else -1
        if cx and cx != x_letter and requested < 0:
            continue
        x_cells = requested < 0 or any(requested < len(row) for row in values)
        x_data = (
            _finite_col(values, requested) if requested >= 0
            else any(math.isfinite(t) for t in time)
        )
        if x_cells and not x_data:
            continue
        if y_idx not in y_keys:
            y_keys.append(y_idx)
        if cx and cx != x_letter and requested >= 0:
            x_key = requested
    return {"xKey": x_key, "yKeys": y_keys} if y_keys else None


_STAT_MODES = ("histogram", "box", "violin", "strip")

# What the Stat Stage bar chart (``figureBarState``) draws, in drawn_kind's
# vocabulary: UPRIGHT columns, side by side (``barStack`` off), stacked
# (``barStack``) or stacked to 100 % (``barPercent``). Never ``"bar"``: in that
# vocabulary ``"bar"`` is Origin's sideways bar (215, ``bars: "horizontal"``),
# and naming the upright chart ``"bar"`` scored all 18 grouped / stacked column
# specimens ``wrong`` (#787; DECODE_LEDGER R-34).
_BAR_CHART_KINDS = {
    "grouped": "column",
    "stacked": "stacked_column",
    "percent": "stacked_column_percent",
}


def bar_chart_kind(layout: Any) -> str:
    """drawn_kind name of a ``bar_layout`` figure's Stat Stage bar chart
    (``_BAR_CHART_KINDS``); an unknown layout is ``"stat_bar"``, which no
    corpus type expects."""
    return _BAR_CHART_KINDS.get(str(layout), "stat_bar")


def stat_view(figure: Mapping[str, Any], ds: Mapping[str, Any]) -> tuple[str, int] | None:
    """``(mode, value channel)`` of the Stat stage ``figureStatState`` opens
    (``-1`` = the X column), or ``None`` when the figure stays on the XY
    stage: every curve one of ``_STAT_MODES``, all the same, or a
    ``bar_layout`` figure of column curves (mode ``"bar"``)."""
    curves = figure.get("curves") or []
    mode = curves[0].get("plotType") if curves else None
    if figure.get("bar_layout") and mode == "column":
        mode = "bar"  # the grouped / stacked bar chart (``figureBarState``)
    elif mode not in _STAT_MODES:
        return None
    if any(c.get("plotType") != curves[0].get("plotType") for c in curves):
        return None
    meta = ds["metadata"]
    letters = _letters(meta) or []
    y = curves[0].get("y")
    xname = str(meta.get("x_column_name") or "")
    if y == xname:
        return str(mode), -1
    return (str(mode), letters.index(y)) if y in letters else None


def stat_histogram_value(figure: Mapping[str, Any], ds: Mapping[str, Any]) -> int | None:
    """The histogram value channel ``figureStatState`` opens (``-1`` = the X
    column), or ``None`` when the figure is not an all-histogram figure."""
    got = stat_view(figure, ds)
    return got[1] if got is not None and got[0] == "histogram" else None


def has_curve_evidence(figure: Mapping[str, Any]) -> bool:
    """``figureHasCurveEvidence``: the layer records curves (decoded, or LEFT
    OUT with a reason in ``curve_sheet_omitted``), so when none maps the apply
    draws an EMPTY plot, never the dataset default view (DECODE_LEDGER B-04).
    A map / ternary layer opens its own stage and is never such a case."""
    if figure.get("map") or figure.get("ternary"):
        return False
    return bool(figure.get("curves")) or bool(figure.get("curve_sheet_omitted"))


def default_view(ds: Mapping[str, Any]) -> dict[str, Any]:
    """``{"hidden": [...], "ownX": {channel: x channel}}`` -- the dataset
    default view (``bookDefaultHiddenChannels`` + ``ownXSeries``)."""
    meta = ds["metadata"]
    letters = _letters(meta) or []
    desig_map = meta.get("column_designations") or {}
    desig = [
        d if isinstance(d, str) and d in _DESIGNATIONS else None
        for d in (desig_map.get(letter) for letter in letters)
    ]
    hidden = [i for i, d in enumerate(desig) if d and d not in ("Y", "Z")]
    own: dict[int, int] = {}
    last_x = -1
    for c, d in enumerate(desig):
        if d == "X":
            last_x = c
        elif last_x >= 0 and d in ("Y", None):
            own[c] = last_x
    return {"hidden": hidden, "ownX": own}


def _marker_kind(
    figure: Mapping[str, Any], mapped: Sequence[Mapping[str, Any]], letters: Sequence[str]
) -> str:
    """What a selection-path figure draws: ``polar`` (``figurePolarState``),
    ``bubble`` / ``color_mapped`` when every mapped curve's ``sizeBy`` /
    ``colorBy`` column is a channel (``originFigureSelection.withMarkerColumns``),
    else ``import_compare.drawn_kind``."""
    if figure.get("coordinates") == "polar" and figure.get("curves"):
        return "polar"
    if mapped and all(c.get("sizeBy") in letters for c in mapped):
        return "bubble"
    if mapped and all(c.get("colorBy") in letters for c in mapped):
        return "color_mapped"
    return drawn_kind(mapped)


def drawn_curves(
    figure: Mapping[str, Any], candidates: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    """``{"dataset", "via", "kind", "curves": [{book, x, y}]}`` for one figure.

    ``via``: ``overlay`` (curves on >= 2 (book, X) blocks, each Y against
    its own X), ``selection`` (decoded curves mapped), ``stat`` (Stat stage),
    ``default`` (no decoded curve mapped and none recorded: the dataset
    default view), ``empty`` (curves recorded but none mapped: the apply's
    fail-closed empty plot, ``has_curve_evidence``) or ``none`` (no dataset
    resolved: nothing drawn). ``kind`` is what that view
    draws (``import_compare.drawn_kind`` of the curves the selection mapped;
    ``default`` for the default view, ``none`` when nothing is drawn).
    """
    i = resolve_dataset(figure, candidates)
    overlay = overlay_curves(figure, candidates)
    if i is not None and overlay is not None:
        return {"dataset": overlay[0]["book"], "via": "overlay",
                "kind": drawn_kind([b["curve"] for b in overlay]),
                "curves": [{"book": b["book"], "x": b["x"], "y": b["y"]} for b in overlay]}
    if i is None:
        return {"dataset": None, "via": "none", "kind": "none", "curves": []}
    ds = candidates[i]
    meta = ds["metadata"]
    book = str(meta.get("origin_book") or "")
    letters = _letters(meta) or []
    x_letter = str(meta.get("x_column_name") or "")
    sv = stat_view(figure, ds)
    sel = channel_selection(figure, ds)
    if sv is not None:
        mode, hv = sv
        if mode == "histogram":  # a histogram of the first curve's column
            ys = [x_letter if hv < 0 else letters[hv]]
        else:  # one box / violin / strip (or bar series) per plotted channel
            ys = [letters[k] for k in sel["yKeys"]] if sel is not None else []
        x = str((figure.get("curves") or [{}])[0].get("x")) if mode == "bar" else None
        kind = bar_chart_kind(figure.get("bar_layout")) if mode == "bar" else mode
        return {"dataset": book, "via": "stat", "kind": kind,
                "curves": [{"book": book, "x": x, "y": y} for y in ys]}
    if sel is not None:
        x = letters[sel["xKey"]] if sel["xKey"] is not None else x_letter
        curves = [{"book": book, "x": x, "y": letters[k]} for k in sel["yKeys"]]
        mapped = [c for c in figure.get("curves") or []
                  if c.get("book") == book and c.get("y") in [letters[k] for k in sel["yKeys"]]]
        return {"dataset": book, "via": "selection", "kind": _marker_kind(figure, mapped, letters),
                "curves": curves}
    if has_curve_evidence(figure):  # figureSelectionState fails closed: an empty plot
        return {"dataset": book, "via": "empty", "kind": "none", "curves": []}
    view = default_view(ds)
    curves = [
        {"book": book, "x": letters[view["ownX"][c]] if c in view["ownX"] else x_letter, "y": y}
        for c, y in enumerate(letters)
        if c not in view["hidden"]
    ]
    return {"dataset": book, "via": "default", "kind": "default", "curves": curves}
