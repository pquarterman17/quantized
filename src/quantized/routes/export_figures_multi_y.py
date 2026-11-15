"""``FigureRequest``'s Y3+ axes (gap audit 4 G11), mixed in like
``AxisTitleFields``: the wire half of ``frontend/src/lib/multiY.ts``.

``y_axes`` lists the extra Y axes in play, Y3 first, each naming its plotted
channels (a SUBSET of ``y_keys``, disjoint from ``y2_keys`` and from every
other extra axis -- else 422) and its own range / scale / number format /
step / title / colour. :func:`extra_y_kwargs` turns them into the renderer's
``extra_y`` masks (``calc.figure_y2.render_with_secondary_axis``).

Refused (422) rather than silently dropped, because the screen draws none of
them with Y3+ axes either (``lib/multiY.ts``'s module doc): a group split
(``group_col``), an encoding, facets, a polar figure, and a figure-page
panel. Split out of ``export_figures.py`` for its 500-line ceiling.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from pydantic import BaseModel, Field, field_validator

from quantized.calc.plotting import PlotData
from quantized.routes.export_figures_schema import TickFormatSpec, _tick_fmt

__all__ = ["ExtraYAxisSpec", "MultiYFields", "extra_y_kwargs", "refuse_multi_y", "tag_extra_axes"]

_MAX_EXTRA_Y = 6  # Y3..Y8, lib/multiY.ts MAX_EXTRA_Y


class ExtraYAxisSpec(BaseModel):
    """One extra Y axis: its channels and how it draws."""

    keys: list[int | str] = Field(
        min_length=1, description="Its plotted channels, a subset of `y_keys`."
    )
    label: str | None = Field(default=None, max_length=500)
    scale: str | None = Field(default=None, pattern="^(linear|log|reciprocal)$")
    fmt: TickFormatSpec | None = None
    step: float | None = Field(default=None, gt=0)
    lim: tuple[float, float] | None = None
    color: str | None = Field(default=None, pattern="^#[0-9a-fA-F]{6}$")

    @field_validator("lim")
    @classmethod
    def _ascending(cls, v: tuple[float, float] | None) -> tuple[float, float] | None:
        if v is not None and not v[0] < v[1]:
            raise ValueError("lim must be [low, high] with low < high")
        return v


class MultiYFields(BaseModel):
    """The ``y_axes`` field, mixed into ``FigureRequest``."""

    y_axes: list[ExtraYAxisSpec] | None = Field(
        default=None,
        max_length=_MAX_EXTRA_Y,
        description=(
            "Y3, Y4, ... on the right, each pushed one 60 pt slot further out "
            "(Origin's multiple Y axes); null/empty = none."
        ),
    )


def refuse_multi_y(req: Any, where: str | None = None) -> None:
    """422 (``ValueError``) when ``req`` carries Y3+ axes into ``where``, or
    (``where`` None) into one of the request's own views that draws none:
    facets, a group split, an encoding."""
    if not req.y_axes:
        return
    if where is None:
        enc = req.encoding is not None and req.encoding.active()
        where = (
            "facets"
            if req.facets
            else "group_col"
            if req.group_col is not None
            else "an encoding"
            if enc
            else None
        )
    if where:
        raise ValueError(f"y_axes (Y3+ axes) cannot be combined with {where}")


def tag_extra_axes(plot: PlotData, req: Any) -> PlotData:
    """``plot`` with each Y3+ series' ``axis`` set to 2, 3, ... (an extra
    axis wins over Y2), so the Y1 / Y2 masks and the derived Y1 / Y2 titles
    count only their own series -- as the canvas titles them."""
    if not req.y_axes or req.y_keys is None or len(req.y_keys) != len(plot.series):
        return plot
    of = {k: 2 + i for i, axis in enumerate(req.y_axes) for k in axis.keys}
    series = tuple(
        replace(s, axis=of.get(k, s.axis)) for k, s in zip(req.y_keys, plot.series, strict=True)
    )
    return replace(plot, series=series)


def extra_y_kwargs(req: Any, n_series: int) -> list[dict[str, Any]]:
    """The renderer's ``extra_y``: per axis its ``mask`` over the resolved
    series (parallel to ``y_keys``) plus its drawing fields."""
    if not req.y_axes:
        return []
    if req.y_keys is None or len(req.y_keys) != n_series:
        raise ValueError("y_axes needs an explicit y_keys list")
    y_keys = list(req.y_keys)
    taken = set(req.y2_keys or [])
    out: list[dict[str, Any]] = []
    for i, axis in enumerate(req.y_axes):
        keys = set(axis.keys)
        if not keys <= set(y_keys):
            raise ValueError(f"y_axes[{i}].keys must be a subset of y_keys")
        if keys & taken:
            raise ValueError(f"y_axes[{i}].keys overlap y2_keys or another Y axis")
        taken |= keys
        out.append(
            {
                "mask": [k in keys for k in y_keys],
                "label": axis.label or "",
                "scale": axis.scale,
                "fmt": _tick_fmt(axis.fmt),
                "step": axis.step,
                "lim": axis.lim,
                "color": axis.color,
            }
        )
    return out
