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

from pydantic import BaseModel, Field, model_validator

from quantized.calc.encoding_text import append_text_factors
from quantized.calc.figure_excluded import excluded_mask, with_excluded_rows
from quantized.calc.plotting import resolve_style_channels
from quantized.calc.plotting_encoded import (
    build_encoded_series,
    encoded_series_styles,
    gradient_spec,
)
from quantized.datastruct import DataStruct
from quantized.routes.export_figures_labels import derived_axis_label, series_legends
from quantized.routes.export_figures_schema import _ResolvedFigure

__all__ = ["ExcludedRowsFields", "FigureEncoding", "resolve_encoded_figure"]


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
    gradient_col: int | None = Field(
        default=None,
        description="Continuous column whose value colours each point (a gradient; no split).",
    )
    text_columns: list[str] | None = Field(
        default=None,
        description=(
            "Text columns (metadata `text_columns`/`origin_text_columns`, by short name) "
            "appended as categorical channels n, n+1, ... before the split."
        ),
    )

    def active(self) -> bool:
        cols = (self.color_col, self.symbol_col, self.label_col, self.gradient_col)
        return any(c is not None for c in cols)


class ExcludedRowsFields(BaseModel):
    """``FigureRequest``'s per-row mask for excluded rows (F4.2c (a)). Only an
    ENCODED request takes it: the backend splits that one, so it needs the
    full rows to take the window's levels. Every other request already sends
    the pruned rows plus any greyed companions as ordinary channels
    (``lib/excludedRowsExport.ts``), so the field there is refused (422)."""

    excluded_rows: list[int] | None = Field(
        default=None,
        description=(
            "Rows of `dataset` the plot window does not draw as data (excluded, or dropped "
            "by the Data Filter). With `encoding` only: the split takes its levels over "
            "every row, then these rows are blanked in each series."
        ),
    )
    grey_excluded: bool = Field(
        default=False,
        description=(
            "With `excluded_rows`: also draw those rows as one grey, line-free "
            "'(excluded)' marker series per series, after all the series."
        ),
    )

    @model_validator(mode="after")
    def _mask_needs_an_encoding(self) -> ExcludedRowsFields:
        encoding = getattr(self, "encoding", None)
        if self.excluded_rows and not (isinstance(encoding, FigureEncoding) and encoding.active()):
            raise ValueError(
                "excluded_rows needs an active encoding; other figures send the pruned rows"
            )
        return self


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
    excluded: ExcludedRowsFields | None = None,
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
    label-source legend verbatim, else ``"label (unit)"`` -- BUG-014's rule.

    ``excluded`` (F4.2c (a)) carries the window's excluded rows. The split
    and the label-source text still take every row, as the window does. The
    rows are then blanked (and, greyed, drawn as companions) by
    ``calc.figure_excluded.with_excluded_rows``, and a gradient's range covers
    only the kept rows (the window's ``stageGradient``)."""
    if y2_keys:
        raise ValueError(
            "encoding cannot be combined with y2_keys -- every encoded series is "
            "drawn on the primary axis"
        )
    keys = list(y_keys) if y_keys is not None else list(range(ds.n_channels))
    ds = append_text_factors(ds, enc.text_columns or [])
    mask = excluded_mask(ds.values.shape[0], excluded.excluded_rows if excluded else None)
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
        gradient=None if enc.gradient_col is None else gradient_spec(ds, enc.gradient_col, mask),
    )
    split = group_col is not None or enc.color_col is not None or enc.symbol_col is not None
    spans = None if split else error_spans
    if mask is not None:
        series, styles, spans = with_excluded_rows(
            series, styles, spans, mask, grey=bool(excluded and excluded.grey_excluded)
        )
    return _ResolvedFigure(
        plot.x,
        series,
        derived_axis_label(x_label, plot.x_label, plot.x_unit),
        y_label if y_label is not None else "",
        styles,
        [False] * len(series),
        "",
        spans,
    )
