"""Color-by / Symbol-by / legend-label source on an xy FACET grid -- the export
half (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4 residual 3).

The port of the frontend's ``lib/plotEncodingFacets.ts`` ``encodedFacetPanels``,
pinned to it by the shared wire fixture
``tests/fixtures/wire/graph_encoding_facets.json``. Pure (arrays in, plain
panel dicts out).

THE RULE, on both sides. The encoded split is taken ONCE over every row of the
dataset (:func:`quantized.calc.plotting_encoded.build_encoded_series`, the
window's own levels and combinations), so one level has one colour and one
glyph in every panel. Each facet panel then keeps, in the split's order, the
series whose level combination has at least one row in that panel, restricted
to those rows. A label-source legend is taken over the panel's rows of the
combination. Colour is the colour factor's level, else the series' position
in the WHOLE grid's split (so a series keeps one colour across panels); the
glyph is the symbol factor's level
(:func:`~quantized.calc.plotting_encoded.encoded_series_styles`). Per-channel
styles never reach a facet panel, on screen or here (BUGS_AND_ISSUES
FEATURE-001).

The client ships each panel's rows (``rows``: the dataset row behind each
``x`` entry) and the channels it plots, so nothing here re-slices by the facet
column -- the panel partition stays the screen's.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from quantized.calc.figure_greyscale import GREY_SLOT_KEY
from quantized.calc.plotting_encoded import (
    build_encoded_series,
    encoded_series_styles,
    legend_source_text,
)
from quantized.datastruct import DataStruct

__all__ = ["encoded_facet_panels"]


def _panel_rows(panel: Mapping[str, Any], n_rows: int) -> np.ndarray:
    rows = np.asarray(panel.get("rows") or [], dtype=np.intp)
    if rows.shape[0] != len(panel.get("x") or []):
        raise ValueError(f"facet {panel.get('label')!r}: rows must have one entry per x value")
    if rows.size and (rows.min() < 0 or rows.max() >= n_rows):
        raise ValueError(f"facet {panel.get('label')!r}: a row is out of range")
    return rows


def encoded_facet_panels(
    ds: DataStruct,
    x_key: int | str | None,
    panels: Sequence[Mapping[str, Any]],
    *,
    group_col: int | None,
    color_col: int | None,
    symbol_col: int | None,
    label_col: int | None,
    palette: Sequence[str] | None,
    markers: Sequence[str] | None,
) -> list[dict[str, Any]]:
    """``calc.figure_facets``' panel dicts for an encoded facet grid (see the
    module doc). Each wire panel carries ``label``, ``x``, ``rows`` and
    ``channels`` (the same Y channels in every panel), and each of its series a
    ``legend`` -- the channel's rename (BUG-014), or ``None``. Raises
    ``ValueError`` (the route's 422) for panels that disagree on their
    channels or rows that do not line up with ``x``."""
    if not panels:
        return []
    y_keys = [int(c) for c in panels[0].get("channels") or []]
    if not y_keys or any([int(c) for c in p.get("channels") or []] != y_keys for p in panels):
        raise ValueError("an encoded facet grid needs the same Y channels in every panel")
    first = panels[0].get("series") or []
    renames = [s.get("legend") if isinstance(s.get("legend"), str) else None for s in first]
    y_legends = renames if len(renames) == len(y_keys) else None
    encoded = build_encoded_series(
        ds, x_key, y_keys, group_col=group_col, color_col=color_col,
        symbol_col=symbol_col, label_col=label_col, y_legends=y_legends,
    )
    n_combos = len(encoded.plot.series) // len(y_keys)
    # One style per series of the WHOLE grid, so a series keeps its colour
    # (level, else its position in the grid's split) in every panel.
    styles = encoded_series_styles(
        encoded, None, len(y_keys), palette=palette, markers=markers,
        color_by_level=color_col is not None,
    )
    multi = len(y_keys) > 1
    out: list[dict[str, Any]] = []
    for p in panels:
        rows = _panel_rows(p, ds.values.shape[0])
        series: list[dict[str, Any]] = []
        for i, (combo, s) in enumerate(zip(encoded.rows, encoded.plot.series, strict=True)):
            mine = combo[np.isin(combo, rows)]
            if mine.size == 0:
                continue
            text = None if label_col is None else legend_source_text(ds, label_col, mine)
            c = i // n_combos
            rename = y_legends[c] if y_legends else None
            y_label = rename if rename is not None else ds.labels[y_keys[c]]
            legend = None if text is None else f"{y_label} ({text})" if multi else text
            default = f"{s.label} ({s.unit})" if s.unit else s.label
            style = {k: v for k, v in (styles[i] or {}).items() if k != GREY_SLOT_KEY}  # never grey
            series.append({
                "label": legend if legend is not None else default,
                "y": s.values[rows].tolist(),
                "style": style or None,
            })
        out.append({"label": p.get("label", ""), "x": p.get("x"), "series": series})
    return out
