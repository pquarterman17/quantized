"""Request models for the CDF / rug options of ``POST /api/export/statplot-figure``
(split from ``export_statplots.py``, which sits near its 500-line ceiling)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

__all__ = ["CdfOptions", "RugOptions", "dump"]


class CdfOptions(BaseModel):
    """``kind="cdf"``: Y as a proportion or a count, and the DKW band
    (``calc.statplots_cdf``). A fitted CDF rides the request's own ``fit``."""

    y: Literal["proportion", "count"] = "proportion"
    band: bool = False


class RugOptions(BaseModel):
    """Rug ticks (``histogram`` / ``cdf``): row height as a fraction of the
    axes and opacity; ranges are enforced by ``calc.figure_rug.resolve_rug``."""

    length: float = Field(default=0.04, allow_inf_nan=False)
    opacity: float = Field(default=0.5, allow_inf_nan=False)


def dump(m: BaseModel | None) -> dict[str, Any] | None:
    return m.model_dump() if m is not None else None
