"""Legend/axis label resolution for the figure-export routes (BUG-014).

Split out of ``routes.export_figures`` along its own seam, to stay under the
500-line god-module ceiling and because this is a self-contained question:
given the resolved series and the request's presentation fields, what text
does each series -- and each solo axis -- carry?

Route layer, deliberately: the only thing here that is not pure string work
is reading ``FigureRequest.series_styles``, which is a list of LOOSE dicts
(see that field's own doc: an unrecognized value must degrade, never 422 the
whole export), i.e. raw wire shape. The actual composition rule lives one
layer down in ``calc.figure_labels.series_display_name``, so the renderer
and every route share one definition of "label (unit), unless the user
renamed it".

BUG-014 in one line: a legend rename used to ride the wire as a rewritten
``dataset.labels[ch]``, and the backend appended the channel's unit to it a
second time ("Loop 1" -> "Loop 1 (au)"). The rename now rides its own
per-series presentation field, ``series_styles[i].legend``, and the wire's
``dataset`` keeps the DATA's labels and units -- a rename is a presentation
choice, not a data edit.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from quantized.calc.figure_labels import series_display_name
from quantized.calc.plotting import PlotSeries

__all__ = ["derived_axis_label", "series_legends", "series_names", "solo_axis_label"]


def series_legends(
    series_styles: Sequence[Mapping[str, Any] | None] | None,
    count: int,
) -> list[str | None]:
    """Each plotted series' legend override, aligned 1:1 with ``y_keys``.

    ``series_styles`` is the request's per-series presentation list (the same
    list ``color``/``width``/``line``/``marker`` ride). ``None`` for a series
    with no override -- which is every series of every request that predates
    BUG-014, so the derived "label (unit)" stays the default.

    A non-string ``legend`` is dropped rather than raising, matching the
    degrade-gracefully contract the rest of that dict already follows
    (``calc.plotting.resolve_style_channels``: "an export must never 500 on a
    bad style hint").
    """
    out: list[str | None] = [None] * count
    if not series_styles:
        return out
    for i, spec in enumerate(series_styles[:count]):
        if not spec:
            continue
        legend = spec.get("legend")
        if isinstance(legend, str):
            out[i] = legend
    return out


def series_names(
    series: Sequence[PlotSeries],
    legends: Sequence[str | None],
) -> list[str]:
    """The legend text for every resolved series, in display order."""
    return [
        series_display_name(s.label, s.unit, legends[i] if i < len(legends) else None)
        for i, s in enumerate(series)
    ]


def derived_axis_label(explicit: str | None, label: str, unit: str) -> str:
    """An explicit caller override wins; otherwise derive "label (unit)"."""
    return explicit if explicit is not None else series_display_name(label, unit)


def solo_axis_label(
    explicit: str | None,
    names: Sequence[str],
    series: Sequence[PlotSeries],
    axis: int,
) -> str:
    """A Y axis' title: the caller's override, else the ONE series on that
    axis named exactly as the legend names it, else blank (the legend names
    them instead).

    Reading the name out of ``names`` rather than recomposing it from the
    channel is what keeps a renamed solo series' axis title equal to its
    legend text -- the same rule ``uplotOpts.buildOpts``'s ``soloLabel``
    applies on screen, where the axis title is literally ``labels[idx]``.
    """
    if explicit is not None:
        return explicit
    idxs = [i for i, s in enumerate(series) if s.axis == axis]
    return names[idxs[0]] if len(idxs) == 1 else ""
