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

from quantized.calc.figure_labels import series_display_name, shared_axis_title
from quantized.calc.plot_log_offsets import log_offset_decades, log_offset_suffix
from quantized.calc.plotting import PlotSeries

__all__ = [
    "derived_axis_label",
    "legend_unit_on_axis",
    "series_legends",
    "series_names",
    "solo_axis_label",
]


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


def legend_unit_on_axis(
    metadata: Mapping[str, Any] | None, series: Sequence[PlotSeries]
) -> bool:
    """UX8-C: the dataset's display-only flag that its legend omits the unit.

    The frontend's linked-graph assembly (``lib/linkedCurves.ts``) sets
    ``metadata["legend_unit_on_axis"] = True`` when every curve shares one
    unit; the on-screen legend then reads "MH_010K", not "MH_010K (emu)"
    (``lib/legendUnitOnAxis.ts``), because the Y title carries the unit. The
    data's units are untouched. Only a literal ``True`` counts, and only while
    every exported ``series`` really shares one non-empty unit: the flag can
    outlive its curves (a duplicated graph keeps the metadata, then gains a
    column in another unit), exactly the re-check the screen makes."""
    if metadata is None or metadata.get("legend_unit_on_axis") is not True:
        return False
    units = {s.unit for s in series}
    return len(units) == 1 and next(iter(units)) != ""


def series_names(
    series: Sequence[PlotSeries],
    legends: Sequence[str | None],
    *,
    unit_on_axis: bool = False,
) -> list[str]:
    """The legend text for every resolved series, in display order.

    ``unit_on_axis`` (``legend_unit_on_axis``) drops the unit from an
    UN-renamed series' derived name; a rename is still used verbatim."""
    return [
        series_display_name(
            s.label, "" if unit_on_axis else s.unit, legends[i] if i < len(legends) else None
        )
        for i, s in enumerate(series)
    ]


def apply_offset_disclosure_to_renames(
    names: Sequence[str],
    legends: Sequence[str | None],
    log_offsets: Sequence[object] | None,
) -> list[str]:
    """P2.3 review finding 6: ``series_display_name`` uses a RENAMED legend
    verbatim, so the log-offset disclosure ``calc.plot_log_offsets.
    apply_log_offsets`` already appended to the auto-derived label (before
    ``series_names`` resolved it) never reaches a series a user renamed --
    the export would hide the very offset it drew. Append the SAME suffix
    to a renamed series' resolved name too; an un-renamed series already
    carries it via its label, so this touches only the ones
    ``series_display_name`` used verbatim."""
    if not log_offsets:
        return list(names)
    return [
        name + log_offset_suffix(log_offset_decades(log_offsets[i]))
        if i < len(legends) and legends[i] is not None and i < len(log_offsets)
        else name
        for i, name in enumerate(names)
    ]


def derived_axis_label(explicit: str | None, label: str, unit: str) -> str:
    """An explicit caller override wins; otherwise derive "label (unit)"."""
    return explicit if explicit is not None else series_display_name(label, unit)


def solo_axis_label(
    explicit: str | None,
    names: Sequence[str],
    series: Sequence[PlotSeries],
    axis: int,
    overlays: Sequence[bool] | None = None,
) -> str:
    """A Y axis' title: the caller's override, else the ONE series on that
    axis named exactly as the legend names it, else what its series share
    (``calc.figure_labels.shared_axis_title``; blank when nothing is shared).

    Reading the name out of ``names`` rather than recomposing it from the
    channel is what keeps a renamed solo series' axis title equal to its
    legend text -- the same rule ``uplotOpts.buildOpts``'s ``soloLabel``
    applies on screen, where the axis title is literally ``labels[idx]``.

    ``overlays`` (``FigureRequest.analysis_overlays``, aligned to ``series``)
    marks the client's fit / band / baseline / peak series: they never count,
    as on the canvas, whose title comes from the plotted channels alone.
    """
    if explicit is not None:
        return explicit
    flags = list(overlays or [])
    idxs = [
        i for i, s in enumerate(series)
        if s.axis == axis and not (i < len(flags) and flags[i])
    ]
    if len(idxs) == 1:
        return names[idxs[0]]
    return shared_axis_title([series[i] for i in idxs])
