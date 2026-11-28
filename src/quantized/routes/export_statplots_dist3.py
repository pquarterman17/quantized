"""Request models for the half / split violin, paired, lollipop and stacked
histogram options of ``POST /api/export/statplot-figure`` (split from
``export_statplots.py``, which sits at its 500-line ceiling)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from quantized.heavy_import import heavy_imports

__all__ = ["FACET_KINDS", "LISTED_KINDS", "Dist3Options", "check_dist_options", "render_facets"]


class SideViolinOptions(BaseModel):
    """``kind="sideviolin"``: per group its axis position (``slots``) and side;
    ``slot_labels`` name the positions and ``levels`` the left / right level of a
    split (``calc.statplots_sideviolin``); ``marks`` adds each violin's median and / or
    quartile segments (``calc.statplots_vmarks``)."""

    type: Literal["sideviolin"]
    style: Literal["half", "split"] = "half"
    slots: list[int] = Field(max_length=512)
    sides: list[Literal["left", "right"]] = Field(max_length=512)
    slot_labels: list[str] = Field(default_factory=list, max_length=512)
    levels: list[str] = Field(default_factory=list, max_length=2)
    bw: Literal["scott", "silverman"] | float = "scott"
    marks: Literal["none", "median", "quartiles", "both"] = "none"
    mean: bool = False  # a mean marker on each violin
    rain: bool = False  # the raw points beside a half violin (a raincloud)

    @model_validator(mode="after")
    def _rain_needs_a_half(self) -> SideViolinOptions:
        if self.rain and self.style != "half":
            raise ValueError("rain points are drawn beside a half violin, not a split one")
        return self


class PairedOptions(BaseModel):
    """``kind="paired"`` (``data = [before, after]``): ``ci`` adds each side's mean and 95 % CI;
    ``direction`` colours each subject's line up / down / same, with ``direction_colors`` (one
    per direction, the client's theme tokens as hex) and a legend row each."""

    type: Literal["paired"]
    ci: bool = False
    direction: bool = False
    direction_colors: list[str] = Field(default_factory=list, max_length=3)
    # Absolute "no change" tolerance of the direction (0 = exact equality).
    tol: float = Field(default=0.0, ge=0.0, allow_inf_nan=False)


class LollipopOptions(BaseModel):
    """``kind="lollipop"``: the statistic per group, the display order and whether the
    categories run down the Y axis (a dot chart)."""

    type: Literal["lollipop"]
    stat: Literal["mean", "median"] = "mean"
    sort: Literal["none", "asc", "desc"] = "none"
    horizontal: bool = False
    whisker: Literal["none", "sd", "sem", "ci"] = "none"  # spread of the mean (mean only)

    @model_validator(mode="after")
    def _whisker_needs_the_mean(self) -> LollipopOptions:
        if self.whisker != "none" and self.stat != "mean":
            raise ValueError("whiskers are drawn for the mean only")
        return self


class StackOptions(BaseModel):
    """``kind="histogram"`` of several columns: stack the series on the shared bins."""

    type: Literal["stack"]
    stack: bool = True
    percent: bool = False  # normalise each bin to 100 %

    @model_validator(mode="after")
    def _percent_needs_the_stack(self) -> StackOptions:
        if self.percent and not self.stack:
            raise ValueError("a 100 % histogram is a stacked one")
        return self


Dist3Options = Annotated[
    SideViolinOptions | PairedOptions | LollipopOptions | StackOptions, Field(discriminator="type")
]

_KIND = {"sideviolin": "sideviolin", "paired": "paired", "lollipop": "lollipop",
         "stack": "histogram"}
# Kinds whose ``data`` is a list of lists (one per group / column).
LISTED_KINDS = ("box", "violin", "strip", "cdf", "marginal", "ridgeline", "sideviolin", "paired",
                "lollipop")


def check_dist_options(
    kind: str,
    facets: Sequence[Any] | None,
    marginal: object,
    ridgeline: object,
    dist3: SideViolinOptions | PairedOptions | LollipopOptions | StackOptions | None,
) -> str | None:
    """The 422 detail when the options contradict the kind or the layout, else None.

    The marginal and ridgeline are one panel. The item 20 variants facet: the options of each
    panel ride on that panel (``StatplotFacet.dist3``), not on the request."""
    if (marginal or ridgeline) and facets:
        return "marginal and ridgeline plots are not faceted"
    if dist3 is not None and facets:
        return "the options of a faceted plot ride on each panel"
    if (marginal and kind != "marginal") or (ridgeline and kind != "ridgeline"):
        return "options do not match the plot kind"
    if dist3 is not None and _KIND[dist3.type] != kind:
        return "options do not match the plot kind"
    for f in facets or ():
        if f.dist3 is not None and _KIND[f.dist3.type] != kind:
            return f"the options of panel {f.label!r} do not match the plot kind"
    return None


# The kinds a faceted request draws here (``calc.figure_facets_dist3``).
FACET_KINDS = ("sideviolin", "paired", "lollipop", "histogram")


def render_facets(
    kind: str,
    facets: Sequence[Any],
    *,
    palette: list[str] | None,
    bins: str | int,
    title: str,
    x_label: str,
    y_label: str,
    fmt: str,
    style: str,
    dpi: int | None,
    svg_text_as_paths: bool,
) -> bytes:
    """The faceted figure of an item 20 variant: each panel's own groups and options."""
    with heavy_imports("quantized.calc.figure_facets_dist3", "quantized.calc.figure_stat_colors"):
        from quantized.calc.figure_facets_dist3 import render_dist3_facets_figure
        from quantized.calc.figure_stat_colors import position_colors

    def count(f: Any) -> int:  # a split violin colours by side, so it always has two
        return max(len(f.data), 2) if kind == "sideviolin" else len(f.data)

    panels = [
        {
            "label": f.label, "data": f.data, "labels": f.labels,
            "options": f.dist3.model_dump() if f.dist3 else None,
            "colors": position_colors(f.color_levels, palette, count(f)),
        }
        for f in facets
    ]
    return render_dist3_facets_figure(
        panels, kind=kind, bins=bins, title=title, x_label=x_label, y_label=y_label, fmt=fmt,
        style=style, dpi=dpi, svg_text_as_paths=svg_text_as_paths,
    )
