"""Request models for the half / split violin, paired, lollipop and stacked
histogram options of ``POST /api/export/statplot-figure`` (split from
``export_statplots.py``, which sits at its 500-line ceiling)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

__all__ = ["LISTED_KINDS", "Dist3Options", "check_dist_options"]


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


class PairedOptions(BaseModel):
    """``kind="paired"`` (``data = [before, after]``): ``ci`` adds each side's mean and 95 % CI;
    ``direction`` colours each subject's line up / down / same, with ``direction_colors`` (one
    per direction, the client's theme tokens as hex) and a legend row each."""

    type: Literal["paired"]
    ci: bool = False
    direction: bool = False
    direction_colors: list[str] = Field(default_factory=list, max_length=3)


class LollipopOptions(BaseModel):
    """``kind="lollipop"``: the statistic per group, the display order and whether the
    categories run down the Y axis (a dot chart)."""

    type: Literal["lollipop"]
    stat: Literal["mean", "median"] = "mean"
    sort: Literal["none", "asc", "desc"] = "none"
    horizontal: bool = False


class StackOptions(BaseModel):
    """``kind="histogram"`` of several columns: stack the series on the shared bins."""

    type: Literal["stack"]
    stack: bool = True


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
    facets: object,
    marginal: object,
    ridgeline: object,
    dist3: SideViolinOptions | PairedOptions | LollipopOptions | StackOptions | None,
) -> str | None:
    """The 422 detail when the options contradict the kind or the layout, else None."""
    if (marginal or ridgeline or dist3) and facets:
        return "marginal, ridgeline and the other item 20 plots are not faceted"
    if (marginal and kind != "marginal") or (ridgeline and kind != "ridgeline"):
        return "options do not match the plot kind"
    if dist3 is not None and _KIND[dist3.type] != kind:
        return "options do not match the plot kind"
    return None
