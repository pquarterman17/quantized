"""What the frontend DRAWS for an imported Origin figure (Python mirror).

Plan item 2 of ``plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md``. A decoded curve is
only half the import: the frontend decides what reaches the plot. This mirrors
the four frontend rules involved, line for line:

* ``lib/originFigureEntries.ts::resolveFigureDataset`` -- which imported
  dataset a figure opens on;
* ``lib/originFigureSelection.ts::figureChannelSelection`` -- decoded curves
  -> ``xKey``/``yKeys`` (``null`` when nothing maps);
* ``lib/originFigureSelection.ts::figureStatState`` -- an all-histogram
  figure opens the Stat stage;
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
    "channel_selection",
    "default_view",
    "drawn_curves",
    "resolve_dataset",
    "stat_histogram_value",
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


def stat_histogram_value(figure: Mapping[str, Any], ds: Mapping[str, Any]) -> int | None:
    """The histogram value channel ``figureStatState`` opens (``-1`` = the X
    column), or ``None`` when the figure stays on the XY stage."""
    curves = figure.get("curves") or []
    if not curves or any(c.get("plotType") != "histogram" for c in curves):
        return None
    meta = ds["metadata"]
    letters = _letters(meta) or []
    y = curves[0].get("y")
    xname = str(meta.get("x_column_name") or "")
    if y == xname:
        return -1
    return letters.index(y) if y in letters else None


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


def drawn_curves(
    figure: Mapping[str, Any], candidates: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    """``{"dataset", "via", "kind", "curves": [{book, x, y}]}`` for one figure.

    ``via``: ``selection`` (decoded curves mapped), ``stat`` (histogram stage),
    ``default`` (no decoded curve mapped: the dataset default view) or
    ``none`` (no dataset resolved: nothing drawn). ``kind`` is what that view
    draws (``import_compare.drawn_kind`` of the curves the selection mapped;
    ``default`` for the default view, ``none`` when nothing is drawn).
    """
    i = resolve_dataset(figure, candidates)
    if i is None:
        return {"dataset": None, "via": "none", "kind": "none", "curves": []}
    ds = candidates[i]
    meta = ds["metadata"]
    book = str(meta.get("origin_book") or "")
    letters = _letters(meta) or []
    x_letter = str(meta.get("x_column_name") or "")
    hv = stat_histogram_value(figure, ds)
    if hv is not None:
        y = x_letter if hv < 0 else letters[hv]
        return {"dataset": book, "via": "stat", "kind": "histogram",
                "curves": [{"book": book, "x": None, "y": y}]}
    sel = channel_selection(figure, ds)
    if sel is not None:
        x = letters[sel["xKey"]] if sel["xKey"] is not None else x_letter
        curves = [{"book": book, "x": x, "y": letters[k]} for k in sel["yKeys"]]
        mapped = [c for c in figure.get("curves") or []
                  if c.get("book") == book and c.get("y") in [letters[k] for k in sel["yKeys"]]]
        return {"dataset": book, "via": "selection", "kind": drawn_kind(mapped), "curves": curves}
    view = default_view(ds)
    curves = [
        {"book": book, "x": letters[view["ownX"][c]] if c in view["ownX"] else x_letter, "y": y}
        for c, y in enumerate(letters)
        if c not in view["hidden"]
    ]
    return {"dataset": book, "via": "default", "kind": "default", "curves": curves}
