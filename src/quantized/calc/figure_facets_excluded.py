"""Excluded rows on an xy facet grid: blank them, or draw them as grey companions.

FIGURE_AUTHORING_WORKFLOW_PLAN F4.2c (a), the facet form of
:mod:`quantized.calc.figure_excluded`. With the "Excluded rows" mode on
"greyed", the Stage's facet grid draws each panel's excluded / filter-dropped
rows as muted "(excluded)" companions of its series (``lib/facetExcluded.ts``).
A greyed facet request carries each panel's FULL level rows, the dataset row
behind each ``x`` entry (``rows``), and the request's mask; this module turns
those panels into the plain panels ``calc.figure_facets.draw_facet_grid``
draws: the masked rows blanked in every series and, greyed, one companion per
series appended after the panel's series (the screen's order), styled
:data:`~quantized.calc.figure_excluded.EXCLUDED_GHOST_STYLE`. A panel with no
masked row is passed through unchanged (less its ``rows``). Pure: plain panel
dicts in, plain panel dicts out. Pinned to the screen by the shared wire fixture
``tests/fixtures/wire/facet_excluded.json``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_excluded import EXCLUDED_GHOST_STYLE, EXCLUDED_SUFFIX, with_excluded_rows
from quantized.datastruct import DataStruct

__all__ = ["channel_companions", "facet_panels_with_excluded"]


def channel_companions(
    ds: DataStruct,
    y_keys: Sequence[int],
    rows: NDArray[np.intp],
    dropped: NDArray[np.bool_],
) -> list[dict[str, Any]]:
    """A SPLIT facet panel's greyed rows (``calc.plotting_encoded_facets``):
    ONE companion per Y channel holding the panel's ``dropped`` rows of every
    level, named as the screen names it (``"<label> (excluded) (<unit>)"``,
    ``lib/facetEncodedExcluded.ts``) and styled
    :data:`~quantized.calc.figure_excluded.EXCLUDED_GHOST_STYLE` -- never a
    level's colour. ``rows[j]`` is the dataset row behind panel position j."""
    out: list[dict[str, Any]] = []
    for ch in y_keys:
        name = f"{ds.labels[ch]}{EXCLUDED_SUFFIX}"
        unit = ds.units[ch]
        out.append({
            "label": f"{name} ({unit})" if unit else name,
            "y": np.where(dropped, ds.values[rows, ch], np.nan).tolist(),
            "style": dict(EXCLUDED_GHOST_STYLE),
        })
    return out


def _plain(panel: Mapping[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in panel.items() if k not in ("rows", "channels")}


def facet_panels_with_excluded(
    panels: Sequence[Mapping[str, Any]],
    excluded_rows: Sequence[int],
    *,
    grey: bool,
) -> list[dict[str, Any]]:
    """Blank each panel's ``excluded_rows`` (matched through its ``rows``) in
    every series; with ``grey``, also append one ``"<label> (excluded)"``
    companion per series that draws only those rows. A series keeps its
    ``style``. Raises ``ValueError`` (the route's 422) for a panel whose
    ``rows`` are missing or do not line up with its ``x``."""
    excluded = np.asarray(list(excluded_rows), dtype=np.intp)
    out: list[dict[str, Any]] = []
    for panel in panels:
        rows = panel.get("rows")
        x = panel.get("x") or []
        if rows is None or len(rows) != len(x):
            raise ValueError(
                f"facet {panel.get('label')!r}: excluded_rows needs the panel's rows, "
                "one per x value"
            )
        mask = np.isin(np.asarray(rows, dtype=np.intp), excluded)
        if not mask.any():
            out.append(_plain(panel))
            continue
        series = list(panel.get("series") or [])
        named = [(str(s.get("label", f"s{i}")), s.get("y") or []) for i, s in enumerate(series)]
        styles = [s.get("style") for s in series]
        drawn, drawn_styles, _ = with_excluded_rows(named, styles, None, mask, grey=grey)
        out.append({
            **_plain(panel),
            "series": [
                {"label": name, "y": values, **({"style": st} if st else {})}
                for (name, values), st in zip(drawn, drawn_styles, strict=True)
            ],
        })
    return out
