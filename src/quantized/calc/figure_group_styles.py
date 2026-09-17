"""Per-series styles for a GROUPED figure export (BUG-016).

``routes.export_figures``' ``group_col`` branch expands every plotted channel
into one synthetic series per group level
(:func:`quantized.calc.plotting.build_grouped_series`), so the request's
``series_styles`` -- which is aligned 1:1 with ``y_keys`` -- no longer lines up
with the series the renderer draws. Until BUG-016 the branch dropped the list
outright and every exported curve came back solid, default-width and default-
coloured, while the canvas drew each level with its channel's style. This
module is the mapping that closes that gap, kept pure (plain mappings in,
plain mappings out) so ``routes/`` stays a thin adapter.

THE RULE, measured off the canvas rather than invented (2026-09-17, against
``frontend/src/lib/regressionMatrixFixtures.testkit.ts``' ``group`` fixture):
``Stage/usePlotPayload.ts`` builds its style list as
``seriesStyles[plotted[i]]`` over ``plotGroupSplit.groupSplitChannelMap``'s
per-DISPLAY-series channel map, so EVERY level of a channel is handed that
channel's ONE style object, and ``lib/uplotOpts.buildOpts`` applies it
verbatim. Measured: a channel styled ``{width: 2, line: "dashed"}`` split over
three levels draws three curves, each ``width: 2`` with ``dash: [8, 4]``.

COLOUR follows the same style object through
``lib/seriesStyleCycle.seriesColor``, whose rule has two halves:

* an EXPLICIT ``style.color`` wins at every display position, so all three
  levels of a channel styled ``#ffe066`` draw ``#ffe066`` (measured). Expanding
  the channel's ``color`` onto every level is therefore exactly what the canvas
  does -- and it is what this module does.
* with NO explicit colour the canvas falls back to the palette token at the
  level's OWN display position, so unstyled levels cycle (measured:
  ``#7fb3ff``/``#ffb37f``/``#8fe08f`` for three levels). A channel-aligned wire
  field cannot carry three colours, so the client
  (``lib/exportStyles.buildExportStyles``) omits ``color`` entirely for a
  grouped request instead of sending the channel's own palette slot -- which
  would paint every level one hue, a NEW divergence. With no ``color`` key,
  matplotlib's own property cycle colours the levels, which is the pre-BUG-016
  rendering, unchanged. Screen and export therefore agree that the levels
  cycle; the two palettes still differ, which is recorded as out of scope in
  ``plans/BUGS_AND_ISSUES.md`` BUG-016.

Two keys are NOT expanded verbatim, because the canvas does not apply them to
a grouped render the way a flat one does:

* ``color_by``/``colormap`` (MAIN #14's colour-mapped scatter) are DROPPED:
  ``Stage/usePlotPayload.ts`` builds its ``colorByColumns`` map only when
  ``groupCol === null``, so a grouped canvas draws an ordinary styled line for
  such a channel. Keeping the key would make the export draw a point cloud and
  a colourbar the screen never showed.
* ``fill: {"vs": <position>}`` is RE-INDEXED. ``resolve_style_channels`` has
  already mapped ``vs`` to a display position among the plotted CHANNELS; the
  renderer indexes the expanded series list, and the canvas'
  ``uplotFill.resolveFillBands`` resolves the same reference with
  ``plotted.indexOf(vs)`` over the expanded channel map -- i.e. the FIRST level
  of that channel. ``position * n_levels`` is that index.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

__all__ = ["expand_grouped_series_styles"]


def _level_style(spec: Mapping[str, Any], n_levels: int) -> dict[str, Any]:
    """One channel style, rewritten for the synthetic per-level series."""
    out: dict[str, Any] = dict(spec)  # shallow copy -- never mutate the caller's
    out.pop("color_by", None)
    out.pop("colormap", None)
    # `legend` is the BUG-014 rename; it is consumed at the route layer by
    # `series_legends` (it names the channel half of the level label template)
    # and no renderer reads it, so an expanded STYLE entry must not carry it.
    out.pop("legend", None)
    fill = out.get("fill")
    if isinstance(fill, Mapping) and isinstance(fill.get("vs"), int):
        out["fill"] = {"vs": int(fill["vs"]) * n_levels}
    return out


def expand_grouped_series_styles(
    styles: Sequence[Mapping[str, Any] | None] | None,
    n_channels: int,
    n_series: int,
) -> list[dict[str, Any] | None] | None:
    """Expand a ``y_keys``-aligned style list onto a grouped figure's series.

    ``styles`` is ``calc.plotting.resolve_style_channels``' output (channel
    references already resolved); ``n_channels`` is ``len(y_keys)`` and
    ``n_series`` the number of series
    :func:`quantized.calc.plotting.build_grouped_series` produced. That
    function nests channel-major/level-minor, so series ``i`` belongs to
    channel ``i // n_levels``.

    Returns one entry per synthetic series, or ``None`` when there is nothing
    to honour (``styles is None``) or the two lists cannot be reconciled --
    ``n_channels`` of zero, or a series count that is not a whole multiple of
    it. Returning ``None`` there degrades to the pre-BUG-016 rendering rather
    than mis-assigning a style, the same "an export must never 500 on a bad
    style hint" contract ``resolve_style_channels`` follows.
    """
    if styles is None or n_channels <= 0 or n_series <= 0 or n_series % n_channels:
        return None
    n_levels = n_series // n_channels
    out: list[dict[str, Any] | None] = []
    for channel in range(n_channels):
        spec = styles[channel] if channel < len(styles) else None
        expanded = _level_style(spec, n_levels) if spec else None
        # One entry per level, each its OWN dict: the renderer may hold on to
        # them and a shared mapping would make an edit to one level's style
        # silently edit every other level of the same channel.
        out.extend(dict(expanded) if expanded is not None else None for _ in range(n_levels))
    return out
