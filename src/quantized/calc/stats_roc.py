"""ROC curves and AUC (pure numpy, no external dependencies).

GAP_PLAN #30 — Receiver Operating Characteristic analysis, optimal threshold
selection via Youden index, and Area Under the Curve via trapezoidal rule.
All computed directly from numpy; equivalent to sklearn.metrics but
license-agnostic (public domain).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["roc_curve", "auc", "youden_optimal_threshold"]

_EPS = float(np.finfo(float).eps)


def roc_curve(
    y_true: NDArray[np.float64],
    y_score: NDArray[np.float64],
) -> dict[str, Any]:
    """ROC curve: false-positive rate vs true-positive rate at all thresholds.

    ``y_true`` is binary (0/1). ``y_score`` is a continuous prediction score
    (e.g., predicted probability). Returns x (FPR), y (TPR), threshold values,
    and the AUC. Rows with any non-finite values are dropped (listwise
    deletion).

    Reference: Standard ROC curve definition, trapezoidal AUC.
    """
    yt = np.asarray(y_true, dtype=float).ravel()
    ys = np.asarray(y_score, dtype=float).ravel()

    if yt.size != ys.size:
        raise ValueError(f"y_true length {yt.size} != y_score length {ys.size}")

    # Listwise NaN deletion
    keep = np.isfinite(yt) & np.isfinite(ys)
    yt, ys = yt[keep], ys[keep]
    n = yt.size

    if n < 2:
        raise ValueError("need at least 2 complete rows")

    # Check binary
    unique_y = np.unique(yt)
    if not (np.array_equal(unique_y, [0.0, 1.0]) or np.array_equal(unique_y, [0.0]) or
            np.array_equal(unique_y, [1.0])):
        raise ValueError("y_true must be binary (0/1)")

    n_pos = float(np.sum(yt))
    n_neg = float(n - n_pos)

    if n_pos < 1 or n_neg < 1:
        raise ValueError("need at least one positive and one negative example")

    # Sort by score, descending (process thresholds from high to low)
    order = np.argsort(-ys)
    yt_sorted = yt[order]

    # Cumulative true positives and false positives
    tp = np.cumsum(yt_sorted)
    fp = np.cumsum(1.0 - yt_sorted)

    # Add origin (0, 0)
    tp = np.concatenate([[0.0], tp])
    fp = np.concatenate([[0.0], fp])

    # Normalize to rates
    tpr = tp / max(n_pos, _EPS)
    fpr = fp / max(n_neg, _EPS)

    # Threshold values (take from sorted scores, with +inf for the first point)
    thresholds = np.concatenate([[np.inf], ys[order]])

    # AUC via trapezoidal rule
    auc_val = float(np.trapz(tpr, fpr))

    return {
        "fpr": fpr,
        "tpr": tpr,
        "thresholds": thresholds,
        "auc": auc_val,
        "N": n,
        "nPositive": int(n_pos),
        "nNegative": int(n_neg),
    }


def auc(
    fpr: NDArray[np.float64],
    tpr: NDArray[np.float64],
) -> float:
    """Area under the ROC curve (trapezoidal rule).

    ``fpr`` and ``tpr`` are typically the outputs from ``roc_curve()``.
    Equivalent to Mann-Whitney U statistic (probability that a randomly
    chosen positive scores higher than a randomly chosen negative).

    Reference: trapezoidal integration.
    """
    fpr_v = np.asarray(fpr, dtype=float).ravel()
    tpr_v = np.asarray(tpr, dtype=float).ravel()

    if fpr_v.size != tpr_v.size:
        raise ValueError(f"fpr length {fpr_v.size} != tpr length {tpr_v.size}")

    if fpr_v.size < 2:
        raise ValueError("need at least 2 points to compute AUC")

    return float(np.trapz(tpr_v, fpr_v))


def youden_optimal_threshold(
    fpr: NDArray[np.float64],
    tpr: NDArray[np.float64],
    thresholds: NDArray[np.float64],
) -> dict[str, Any]:
    """Youden J statistic to find the optimal classification threshold.

    Youden J = TPR - FPR (maximize true positive detection while minimizing
    false positives). Returns the optimal threshold, the J value, and the
    corresponding FPR/TPR.

    Reference: Youden index (Youden, W.J. 1950).
    """
    fpr_v = np.asarray(fpr, dtype=float).ravel()
    tpr_v = np.asarray(tpr, dtype=float).ravel()
    thresh_v = np.asarray(thresholds, dtype=float).ravel()

    if not (fpr_v.size == tpr_v.size == thresh_v.size):
        raise ValueError("fpr, tpr, and thresholds must have the same length")

    if fpr_v.size < 2:
        raise ValueError("need at least 2 points")

    # Compute Youden J
    j = tpr_v - fpr_v

    # Best threshold: maximum J (ties broken by smallest threshold, i.e., closest to 0)
    j_max = np.max(j)
    candidates = np.where(np.isclose(j, j_max, atol=_EPS * 10))[0]
    best_idx = candidates[np.argmin(thresh_v[candidates])]

    optimal_threshold = float(thresh_v[best_idx])
    optimal_fpr = float(fpr_v[best_idx])
    optimal_tpr = float(tpr_v[best_idx])

    return {
        "optimalThreshold": optimal_threshold,
        "youdenJ": float(j_max),
        "fpr": optimal_fpr,
        "tpr": optimal_tpr,
    }
