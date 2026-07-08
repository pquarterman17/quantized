"""Thin routes: designed-experiment ANOVA + post-hoc + the test chooser + GLM/survival/ROC.

Split from routes/stats.py (500-line module ceiling); same /api/stats prefix.
GAP_PLAN #30 adds GLM (logistic/Poisson), survival (KM/log-rank/Cox), and ROC methods.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.stats_anova2 import adjust_pvalues, anova2, dunnett_test, tukey_hsd
from quantized.calc.stats_anova_ext import anova2_unbalanced, repeated_measures_anova
from quantized.calc.stats_glm import logistic_regression, poisson_regression
from quantized.calc.stats_roc import auc, roc_curve, youden_optimal_threshold
from quantized.calc.stats_survival import cox_proportional_hazards, kaplan_meier, logrank_test
from quantized.calc.stats_tests import recommend_test
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _wrap(result: dict[str, Any]) -> dict[str, Any]:
    return to_jsonable(result)  # type: ignore[no-any-return]


class Anova2Request(BaseModel):
    cells: list[list[list[float]]]  # [A-level][B-level][replicates], balanced
    alpha: float = 0.05


@router.post("/anova2")
def anova2_route(req: Anova2Request) -> dict[str, Any]:
    """Balanced two-way factorial ANOVA with interaction."""
    try:
        return _wrap(anova2(req.cells, alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class Anova2UnbalancedRequest(BaseModel):
    values: list[float]
    factor_a: list[str]
    factor_b: list[str]
    ss_type: int = 3  # 2 or 3
    alpha: float = 0.05


@router.post("/anova2-unbalanced")
def anova2_unbalanced_route(req: Anova2UnbalancedRequest) -> dict[str, Any]:
    """Unbalanced two-way ANOVA (Type II/III SS) from long-format columns."""
    try:
        return _wrap(
            anova2_unbalanced(
                np.asarray(req.values, dtype=float),
                req.factor_a, req.factor_b,
                ss_type=req.ss_type, alpha=req.alpha,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class RepeatedMeasuresRequest(BaseModel):
    data: list[list[float]]  # rows = subjects, columns = conditions
    alpha: float = 0.05


@router.post("/anova-rm")
def anova_rm_route(req: RepeatedMeasuresRequest) -> dict[str, Any]:
    """One-way repeated-measures (within-subjects) ANOVA + sphericity."""
    try:
        return _wrap(repeated_measures_anova(req.data, alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class PostHocRequest(BaseModel):
    groups: list[list[float]]
    alpha: float = 0.05
    control: int = 0  # dunnett only
    alternative: str = "two-sided"  # dunnett only


@router.post("/tukey")
def tukey_route(req: PostHocRequest) -> dict[str, Any]:
    """Tukey HSD all-pairs post-hoc."""
    try:
        return _wrap(tukey_hsd([np.asarray(g, dtype=float) for g in req.groups], alpha=req.alpha))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/dunnett")
def dunnett_route(req: PostHocRequest) -> dict[str, Any]:
    """Dunnett many-to-one post-hoc vs a control group."""
    try:
        return _wrap(
            dunnett_test(
                [np.asarray(g, dtype=float) for g in req.groups],
                control=req.control, alpha=req.alpha, alternative=req.alternative,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class RecommendRequest(BaseModel):
    groups: list[list[float]]
    paired: bool = False
    alpha: float = 0.05


@router.post("/recommend")
def recommend_route(req: RecommendRequest) -> dict[str, Any]:
    """The 'which test?' chooser: assumption checks -> recommended test."""
    try:
        return _wrap(
            recommend_test(
                [np.asarray(g, dtype=float) for g in req.groups],
                paired=req.paired, alpha=req.alpha,
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class AdjustPRequest(BaseModel):
    p_values: list[float]
    method: str = "holm"


@router.post("/adjust-p")
def adjust_p_route(req: AdjustPRequest) -> dict[str, Any]:
    """Bonferroni / Holm / Benjamini-Hochberg p-value adjustment."""
    try:
        return _wrap(adjust_pvalues(req.p_values, method=req.method))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ── GLM (Logistic & Poisson) ──────────────────────────────────────────────


class GlmRequest(BaseModel):
    """Request for logistic or Poisson GLM.

    ``predictors`` is a list of *k predictor columns* (each a same-length
    array of n observations) — ``[[x1_1..x1_n], [x2_1..x2_n], ...]`` — not a
    list of n row records. Same convention as ``calc.stats_glm``/
    ``calc.stats_multivar``; the intercept is added automatically.
    """
    predictors: list[list[float]]
    y: list[float]
    alpha: float = 0.05


@router.post("/glm-logistic")
def glm_logistic_route(req: GlmRequest) -> dict[str, Any]:
    """Logistic regression with coefficients, SEs, z-stats, p-values, AIC."""
    try:
        predictors = [np.asarray(c, dtype=float) for c in req.predictors]
        y = np.asarray(req.y, dtype=float)
        return _wrap(logistic_regression(predictors, y, alpha=req.alpha))
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/glm-poisson")
def glm_poisson_route(req: GlmRequest) -> dict[str, Any]:
    """Poisson regression with coefficients, SEs, z-stats, p-values, AIC."""
    try:
        predictors = [np.asarray(c, dtype=float) for c in req.predictors]
        y = np.asarray(req.y, dtype=float)
        return _wrap(poisson_regression(predictors, y, alpha=req.alpha))
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ── Survival Analysis ─────────────────────────────────────────────────────


class SurvivalRequest(BaseModel):
    """Request for Kaplan-Meier or log-rank test."""
    time: list[float]
    event: list[float]


class KaplanMeierRequest(SurvivalRequest):
    """Kaplan-Meier curve request."""
    pass


class LogRankRequest(BaseModel):
    """Request for log-rank test between two groups."""
    time1: list[float]
    event1: list[float]
    time2: list[float]
    event2: list[float]


class CoxRequest(BaseModel):
    """Request for Cox proportional-hazards model.

    ``predictors`` is a list of *k predictor columns* (each length n),
    same convention as ``GlmRequest.predictors`` — not a list of row
    records.
    """
    time: list[float]
    event: list[float]
    predictors: list[list[float]]


@router.post("/kaplan-meier")
def kaplan_meier_route(req: KaplanMeierRequest) -> dict[str, Any]:
    """Kaplan-Meier survival curve with Greenwood CIs."""
    try:
        time = np.asarray(req.time, dtype=float)
        event = np.asarray(req.event, dtype=float)
        return _wrap(kaplan_meier(time, event))
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/logrank")
def logrank_route(req: LogRankRequest) -> dict[str, Any]:
    """Log-rank test comparing two survival curves."""
    try:
        return _wrap(
            logrank_test(
                np.asarray(req.time1, dtype=float), np.asarray(req.event1, dtype=float),
                np.asarray(req.time2, dtype=float), np.asarray(req.event2, dtype=float),
            )
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/cox-ph")
def cox_ph_route(req: CoxRequest) -> dict[str, Any]:
    """Cox proportional-hazards model."""
    try:
        predictors = [np.asarray(c, dtype=float) for c in req.predictors]
        return _wrap(
            cox_proportional_hazards(
                np.asarray(req.time, dtype=float), np.asarray(req.event, dtype=float),
                predictors,
            )
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ── ROC & AUC ─────────────────────────────────────────────────────────────


class RocRequest(BaseModel):
    """Request for ROC curve."""
    y_true: list[float]
    y_score: list[float]


class AucRequest(BaseModel):
    """Request for AUC computation."""
    fpr: list[float]
    tpr: list[float]


class YoudenRequest(BaseModel):
    """Request for Youden optimal threshold."""
    fpr: list[float]
    tpr: list[float]
    thresholds: list[float]


@router.post("/roc-curve")
def roc_curve_route(req: RocRequest) -> dict[str, Any]:
    """ROC curve points (FPR, TPR) at all thresholds."""
    try:
        y_true = np.asarray(req.y_true, dtype=float)
        y_score = np.asarray(req.y_score, dtype=float)
        return _wrap(roc_curve(y_true, y_score))
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/auc")
def auc_route(req: AucRequest) -> dict[str, Any]:
    """Area Under the ROC Curve (trapezoidal rule)."""
    try:
        auc_val = auc(np.asarray(req.fpr, dtype=float), np.asarray(req.tpr, dtype=float))
        return _wrap({"auc": auc_val})
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/youden-threshold")
def youden_route(req: YoudenRequest) -> dict[str, Any]:
    """Youden J-statistic optimal threshold selection."""
    try:
        return _wrap(
            youden_optimal_threshold(
                np.asarray(req.fpr, dtype=float), np.asarray(req.tpr, dtype=float),
                np.asarray(req.thresholds, dtype=float),
            )
        )
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
