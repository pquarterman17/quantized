"""``FigureRequest.encoding`` -- the Graph Builder Color-by / Symbol-by /
legend-label source on the export wire (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4).

A thin adapter, split out of ``routes.export_figures`` (500-line ceiling): the
wire model plus the one resolve step ``_figure_series`` delegates to when an
encoding is present. The split, the encoding rule and the legend text are
pure calc (:mod:`quantized.calc.plotting_encoded`, the faithful port of the
frontend's ``lib/plotEncoding.ts``); nothing here re-derives them.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, Field

from quantized.calc.plotting import resolve_style_channels
from quantized.calc.plotting_encoded import build_encoded_series, encoded_series_styles
from quantized.datastruct import DataStruct
from quantized.routes.export_figures_labels import derived_axis_label, series_legends
from quantized.routes.export_figures_schema import _ResolvedFigure

__all__ = ["FigureEncoding", "resolve_encoded_figure"]


class FigureEncoding(BaseModel):
    """Per-level encodings for an xy figure. Present (with any column set) it
    switches ``_figure_series`` to the encoded split, which ALSO takes
    ``group_col`` as a split factor; absent, every request renders exactly as
    it did before the field existed."""

    color_col: int | None = Field(
        default=None, description="Categorical factor whose LEVEL picks each series' colour."
    )
    symbol_col: int | None = Field(
        default=None, description="Categorical factor whose LEVEL picks each series' marker glyph."
    )
    label_col: int | None = Field(
        default=None,
        description="Column whose value(s) on a series' rows become its legend text, verbatim.",
    )
    palette: list[str] | None = Field(
        default=None,
        description=(
            "The colour cycle, resolved to hex by the client (the screen's SERIES_VARS). "
            "Indexed by colour LEVEL with `color_col`, else by display position."
        ),
    )
    markers: list[str] | None = Field(
        default=None,
        description="The glyph cycle (`MarkerShape` names), indexed by symbol LEVEL.",
    )

    def active(self) -> bool:
        cols = (self.color_col, self.symbol_col, self.label_col)
        return any(c is not None for c in cols)


def resolve_encoded_figure(
    ds: DataStruct,
    enc: FigureEncoding,
    *,
    x_key: int | str | None,
    y_keys: Sequence[int | str] | None,
    group_col: int | None,
    y2_keys: Sequence[int | str] | None,
    series_styles: Sequence[Mapping[str, Any] | None] | None,
    error_spans: Sequence[Mapping[str, Any] | None] | None,
    x_label: str | None,
    y_label: str | None,
) -> _ResolvedFigure:
    """The encoded branch of ``routes.export_figures._figure_series``.

    Like the ``group_col`` branch: every series stays on the primary axis, so
    ``y2_keys`` is refused (``ValueError`` -> 422), and ``waterfall_offsets``/
    ``log_offsets`` are not applied (the client never sends them for an encoded
    figure). ``error_spans`` (``y_keys``-aligned) ride only when no factor
    splits the series -- a legend-source-only encoding keeps one series per
    channel, as the Graph Builder preview does; once a factor splits them a
    channel's span cannot be divided among its levels, so they are dropped,
    the group split's own rule. ``series_styles`` is
    ``y_keys``-aligned and expanded per channel before the encoding is laid on
    top (``calc.plotting_encoded.encoded_series_styles``); a series name is its
    label-source legend verbatim, else ``"label (unit)"`` -- BUG-014's rule."""
    if y2_keys:
        raise ValueError(
            "encoding cannot be combined with y2_keys -- every encoded series is "
            "drawn on the primary axis"
        )
    keys = list(y_keys) if y_keys is not None else list(range(ds.n_channels))
    encoded = build_encoded_series(
        ds,
        x_key,
        keys,
        group_col=group_col,
        color_col=enc.color_col,
        symbol_col=enc.symbol_col,
        label_col=enc.label_col,
        y_legends=series_legends(series_styles, len(keys)),
    )
    plot = encoded.plot
    series: list[tuple[str, Any]] = [
        (
            legend if legend is not None else (f"{s.label} ({s.unit})" if s.unit else s.label),
            s.values,
        )
        for s, legend in zip(plot.series, encoded.legends, strict=True)
    ]
    styles = encoded_series_styles(
        encoded,
        resolve_style_channels(ds, keys, series_styles),
        len(keys),
        palette=enc.palette,
        markers=enc.markers,
        color_by_level=enc.color_col is not None,
    )
    split = group_col is not None or enc.color_col is not None or enc.symbol_col is not None
    return _ResolvedFigure(
        plot.x,
        series,
        derived_axis_label(x_label, plot.x_label, plot.x_unit),
        y_label if y_label is not None else "",
        styles,
        [False] * len(series),
        "",
        None if split else error_spans,
    )
