"""Request models for the marginal / ridgeline options of
``POST /api/export/statplot-figure`` (split from ``export_statplots.py``, which
sits near its 500-line ceiling)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

__all__ = ["MarginalOptions", "RidgelineOptions"]


class MarginalOptions(BaseModel):
    """``kind="marginal"``: what is drawn on the top and right strips
    (``calc.statplots_marginal``). The bin rule rides the request's ``bins``.

    The opt-in encodings are parallel to ``data[0]`` / ``data[1]`` (one value per
    complete row, as ``/api/statplots/marginal`` returned them): ``group`` ids (colour
    ``g`` = palette entry ``g``) with ``group_labels``, a ``color`` column, a ``size``
    column; ``color_label`` / ``size_label`` title their keys. A group split and a colour
    column are mutually exclusive (refused by the calc)."""

    kind: Literal["histogram", "box", "rug"] = "histogram"
    group: list[int] | None = Field(default=None, max_length=1_000_000)
    group_labels: list[str] | None = Field(default=None, max_length=64)
    color: list[float] | None = Field(default=None, max_length=1_000_000)
    color_label: str = Field(default="", max_length=200)
    size: list[float] | None = Field(default=None, max_length=1_000_000)
    size_label: str = Field(default="", max_length=200)

    def n_groups(self) -> int:
        """How many palette colours the group split needs (0: no split)."""
        if self.group is None:
            return 0
        return len(self.group_labels) if self.group_labels else max(self.group, default=-1) + 1


class RidgelineOptions(BaseModel):
    """``kind="ridgeline"``: row overlap (the tallest peak, in row spacings) and
    the KDE bandwidth (``calc.statplots_ridgeline``); ranges are enforced there."""

    overlap: float = Field(default=1.0, allow_inf_nan=False)
    bw: Literal["scott", "silverman"] | float = "scott"
    each: bool = False  # scale every ridge to its own peak (default: one shared scale)
