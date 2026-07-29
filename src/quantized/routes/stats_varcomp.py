"""Thin routes: nested ANOVA + variance components (JMP_GAP_PLAN J8).

Same ``/api/stats`` prefix as ``routes/stats.py``; split into its own
module per the 500-line god-module ceiling (mirrors ``routes/
stats_outliers.py`` / ``routes/stats_design.py``).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.stats_varcomp import (
    nested_anova,
    variability_summary,
    variance_components_nested,
)
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _wrap(result: dict[str, Any]) -> dict[str, Any]:
    return to_jsonable(result)  # type: ignore[no-any-return]


class NestedGroupsRequest(BaseModel):
    """Shared payload: ``groups[i][j]`` = replicate observations for factor-A
    level i, factor-B (nested-in-A) level j. See ``calc.stats_varcomp`` for
    the full data contract."""

    groups: list[list[list[float]]]


class NestedAnovaRequest(NestedGroupsRequest):
    alpha: float = 0.05


@router.post("/nested-anova")
def nested_anova_route(req: NestedAnovaRequest) -> dict[str, Any]:
    """Fully nested (hierarchical) two-level ANOVA: A tested against B(A);
    B(A) tested against Error."""
    try:
        return _wrap(nested_anova(req.groups, alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/variance-components")
def variance_components_route(req: NestedGroupsRequest) -> dict[str, Any]:
    """ANOVA/EMS-method variance-component estimates for a 2-level nested design."""
    try:
        return _wrap(variance_components_nested(req.groups))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/variability-summary")
def variability_summary_route(req: NestedGroupsRequest) -> dict[str, Any]:
    """Per-cell / per-A-group / grand summary stats for the variability chart."""
    try:
        return _wrap(variability_summary(req.groups))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
