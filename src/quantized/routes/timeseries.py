"""Thin time-series routes (GAP_AUDIT_9 G13). Wraps ``calc.ts_*``.

Every route takes the series ``y`` and, optionally, its time axis ``x``
(``calc.ts_common.clean_series``: non-finite values and, unless
``allow_irregular``, an unevenly spaced axis are refused with a 422).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from quantized.calc.ts_acf import correlogram
from quantized.calc.ts_arima import fit_arima
from quantized.calc.ts_changepoint import detect
from quantized.calc.ts_common import Series, clean_series
from quantized.calc.ts_decompose import decompose
from quantized.calc.ts_stationarity import stationarity
from quantized.routes._errors import call_calc
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/timeseries", tags=["timeseries"])


class SeriesRequest(BaseModel):
    y: list[float]
    x: list[float] | None = None
    allow_irregular: bool = False


class CorrelogramRequest(SeriesRequest):
    nlags: int | None = Field(default=None, ge=1)
    alpha: float = 0.05


class StationarityRequest(SeriesRequest):
    tests: str = "both"
    regression: str = "c"
    alpha: float = 0.05


class DecomposeRequest(SeriesRequest):
    period: int
    model: str = "additive"


class ChangepointRequest(SeriesRequest):
    method: str = "pelt"
    cost: str = "mean"
    penalty: str = "mbic"
    penalty_value: float | None = None
    min_size: int = 2
    max_changes: int | None = None
    sigma: float | None = None


class ArimaRequest(SeriesRequest):
    p: int = 1
    d: int = 0
    q: int = 0
    trend: str = "auto"
    steps: int = 10
    alpha: float = 0.05


def _series(req: SeriesRequest, min_n: int = 8) -> Series:
    return clean_series(req.y, req.x, min_n=min_n, allow_irregular=req.allow_irregular)


def _run(fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """Run a calc closure: a missing optional statsmodels is a 501, bad input a 422."""
    try:
        return to_jsonable(call_calc(fn))  # type: ignore[no-any-return]
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc


def _meta(s: Series) -> dict[str, Any]:
    return {"dt": s.dt, "irregular": s.irregular}


@router.post("/correlogram")
def correlogram_route(req: CorrelogramRequest) -> dict[str, Any]:
    """ACF and PACF with confidence bands, plus Ljung-Box."""

    def run() -> dict[str, Any]:
        s = _series(req, min_n=10)
        nlags = req.nlags or int(min(10 * np.log10(s.y.size), s.y.size // 2 - 1))
        return {**correlogram(s.y, nlags, req.alpha), **_meta(s)}

    return _run(run)


@router.post("/stationarity")
def stationarity_route(req: StationarityRequest) -> dict[str, Any]:
    """ADF and/or KPSS, read together."""

    def run() -> dict[str, Any]:
        s = _series(req, min_n=20)
        return {**stationarity(s.y, req.tests, req.regression, req.alpha), **_meta(s)}

    return _run(run)


@router.post("/decompose")
def decompose_route(req: DecomposeRequest) -> dict[str, Any]:
    """Classical seasonal decomposition (additive or multiplicative)."""

    def run() -> dict[str, Any]:
        s = _series(req, min_n=4)
        return {**decompose(s.y, req.period, req.model), **_meta(s)}

    return _run(run)


@router.post("/changepoint")
def changepoint_route(req: ChangepointRequest) -> dict[str, Any]:
    """PELT / binary-segmentation change points in mean and/or variance."""

    def run() -> dict[str, Any]:
        s = _series(req, min_n=8)
        out = detect(
            s.y,
            req.method,
            req.cost,
            req.penalty,
            req.penalty_value,
            req.min_size,
            req.max_changes,
            req.sigma,
        )
        return {**out, **_meta(s)}

    return _run(run)


@router.post("/arima")
def arima_route(req: ArimaRequest) -> dict[str, Any]:
    """ARIMA(p, d, q) fit and forecast."""

    def run() -> dict[str, Any]:
        s = _series(req, min_n=20)
        out = fit_arima(s.y, (req.p, req.d, req.q), req.trend, req.steps, req.alpha)
        return {**out, **_meta(s)}

    return _run(run)
