"""Request models for the marginal / ridgeline options of
``POST /api/export/statplot-figure`` (split from ``export_statplots.py``, which
sits near its 500-line ceiling)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

__all__ = ["MarginalOptions", "RidgelineOptions"]


class MarginalOptions(BaseModel):
    """``kind="marginal"``: what is drawn on the top and right strips
    (``calc.statplots_marginal``). The bin rule rides the request's ``bins``."""

    kind: Literal["histogram", "box", "rug"] = "histogram"


class RidgelineOptions(BaseModel):
    """``kind="ridgeline"``: row overlap (the tallest peak, in row spacings) and
    the KDE bandwidth (``calc.statplots_ridgeline``); ranges are enforced there."""

    overlap: float = Field(default=1.0, allow_inf_nan=False)
    bw: Literal["scott", "silverman"] | float = "scott"
