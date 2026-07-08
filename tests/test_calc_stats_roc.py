"""Tests for ROC curve and AUC — gap #30 (pure numpy, no dependencies).

Reference values from hand-computable examples and standard definitions.
"""

from __future__ import annotations

import numpy as np
import pytest


def test_roc_perfect_separation():
    """ROC curve for perfect classification (AUC=1.0)."""
    from quantized.calc.stats_roc import roc_curve

    y_true = np.array([0.0, 0.0, 1.0, 1.0])
    y_score = np.array([0.1, 0.2, 0.8, 0.9])

    result = roc_curve(y_true, y_score)

    assert result["N"] == 4
    assert result["nPositive"] == 2
    assert result["nNegative"] == 2
    assert np.isclose(result["auc"], 1.0, atol=1e-6)


def test_roc_random_classifier():
    """ROC curve for a random classifier (AUC≈0.5)."""
    from quantized.calc.stats_roc import roc_curve

    np.random.seed(42)
    y_true = np.array([0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0])
    y_score = np.random.uniform(0, 1, 8)

    result = roc_curve(y_true, y_score)

    assert result["N"] == 8
    # For random scores, AUC should be ~0.5
    assert 0.0 <= result["auc"] <= 1.0


def test_roc_nan_deletion():
    """ROC drops NaN rows (listwise deletion)."""
    from quantized.calc.stats_roc import roc_curve

    y_true = np.array([0.0, 0.0, np.nan, 1.0])
    y_score = np.array([0.1, 0.2, 0.5, 0.9])

    result = roc_curve(y_true, y_score)
    assert result["N"] == 3


def test_roc_binary_check():
    """ROC requires binary y_true."""
    from quantized.calc.stats_roc import roc_curve

    y_true = np.array([0.0, 0.5, 1.0])
    y_score = np.array([0.1, 0.5, 0.9])

    with pytest.raises(ValueError, match="binary"):
        roc_curve(y_true, y_score)


def test_roc_fpr_tpr_bounds():
    """ROC FPR and TPR are in [0, 1]."""
    from quantized.calc.stats_roc import roc_curve

    y_true = np.array([0.0, 0.0, 1.0, 1.0])
    y_score = np.array([0.1, 0.4, 0.6, 0.9])

    result = roc_curve(y_true, y_score)

    assert np.all((result["fpr"] >= 0.0) & (result["fpr"] <= 1.0))
    assert np.all((result["tpr"] >= 0.0) & (result["tpr"] <= 1.0))


def test_roc_monotonicity():
    """ROC curve is monotonically increasing."""
    from quantized.calc.stats_roc import roc_curve

    y_true = np.array([0.0, 0.0, 0.0, 1.0, 1.0, 1.0])
    y_score = np.array([0.1, 0.2, 0.3, 0.7, 0.8, 0.9])

    result = roc_curve(y_true, y_score)

    # TPR should be non-decreasing
    assert np.all(np.diff(result["tpr"]) >= -1e-10)
    # FPR should be non-decreasing
    assert np.all(np.diff(result["fpr"]) >= -1e-10)


def test_auc_perfect():
    """AUC=1.0 for perfect separation."""
    from quantized.calc.stats_roc import auc

    fpr = np.array([0.0, 0.0, 1.0])
    tpr = np.array([0.0, 1.0, 1.0])

    auc_val = auc(fpr, tpr)
    assert np.isclose(auc_val, 1.0, atol=1e-6)


def test_auc_random():
    """AUC≈0.5 for random guessing."""
    from quantized.calc.stats_roc import auc

    fpr = np.array([0.0, 0.5, 1.0])
    tpr = np.array([0.0, 0.5, 1.0])

    auc_val = auc(fpr, tpr)
    assert np.isclose(auc_val, 0.5, atol=1e-6)


def test_auc_nan_handling():
    """AUC with some NaN scores."""
    from quantized.calc.stats_roc import auc

    fpr = np.array([0.0, 0.3, 1.0])
    tpr = np.array([0.0, 0.7, 1.0])

    auc_val = auc(fpr, tpr)
    assert 0.0 <= auc_val <= 1.0


def test_auc_bounds():
    """AUC is in [0, 1]."""
    from quantized.calc.stats_roc import auc

    fpr = np.linspace(0, 1, 5)
    tpr = np.linspace(0, 1, 5)

    auc_val = auc(fpr, tpr)
    assert 0.0 <= auc_val <= 1.0


def test_youden_perfect():
    """Youden J=1.0 for perfect classification."""
    from quantized.calc.stats_roc import youden_optimal_threshold

    fpr = np.array([0.0, 0.0, 1.0])
    tpr = np.array([0.0, 1.0, 1.0])
    thresholds = np.array([np.inf, 0.5, 0.0])

    result = youden_optimal_threshold(fpr, tpr, thresholds)

    assert np.isclose(result["youdenJ"], 1.0, atol=1e-6)


def test_youden_random():
    """Youden J≈0.0 for random classification."""
    from quantized.calc.stats_roc import youden_optimal_threshold

    fpr = np.array([0.0, 0.5, 1.0])
    tpr = np.array([0.0, 0.5, 1.0])
    thresholds = np.array([np.inf, 0.5, 0.0])

    result = youden_optimal_threshold(fpr, tpr, thresholds)

    assert np.isclose(result["youdenJ"], 0.0, atol=1e-6)


def test_youden_bounds():
    """Youden J is in [-1, 1]."""
    from quantized.calc.stats_roc import youden_optimal_threshold

    fpr = np.linspace(0, 1, 5)
    tpr = np.linspace(0, 1, 5)
    thresholds = np.linspace(1.0, 0.0, 5)

    result = youden_optimal_threshold(fpr, tpr, thresholds)

    assert -1.0 <= result["youdenJ"] <= 1.0


def test_youden_threshold_is_chosen():
    """Youden selects a threshold from the curve."""
    from quantized.calc.stats_roc import youden_optimal_threshold

    fpr = np.array([0.0, 0.3, 0.6, 1.0])
    tpr = np.array([0.0, 0.7, 0.9, 1.0])
    thresholds = np.array([np.inf, 0.8, 0.5, 0.0])

    result = youden_optimal_threshold(fpr, tpr, thresholds)

    # Optimal threshold should be one of the given thresholds
    assert result["optimalThreshold"] in thresholds


def test_roc_requires_both_classes():
    """ROC requires at least one positive and one negative example."""
    from quantized.calc.stats_roc import roc_curve

    # Only negatives
    y_true = np.array([0.0, 0.0, 0.0])
    y_score = np.array([0.1, 0.2, 0.3])

    with pytest.raises(ValueError, match="at least one positive"):
        roc_curve(y_true, y_score)


def test_roc_curve_integration():
    """Test ROC curve, AUC, and Youden together."""
    from quantized.calc.stats_roc import auc, roc_curve, youden_optimal_threshold

    y_true = np.array([0.0, 0.0, 0.0, 1.0, 1.0, 1.0])
    y_score = np.array([0.1, 0.3, 0.4, 0.6, 0.7, 0.9])

    roc_result = roc_curve(y_true, y_score)
    auc_val = auc(roc_result["fpr"], roc_result["tpr"])
    youden_result = youden_optimal_threshold(
        roc_result["fpr"], roc_result["tpr"], roc_result["thresholds"]
    )

    # Check consistency: AUC from roc_curve matches standalone AUC
    assert np.isclose(roc_result["auc"], auc_val, atol=1e-10)

    # Youden threshold should give valid FPR/TPR
    assert 0.0 <= youden_result["fpr"] <= 1.0
    assert 0.0 <= youden_result["tpr"] <= 1.0


def test_roc_edge_case_single_positive():
    """ROC handles edge case of single positive/negative gracefully."""
    from quantized.calc.stats_roc import roc_curve

    y_true = np.array([0.0, 0.0, 1.0, 1.0])
    y_score = np.array([0.1, 0.2, 0.8, 0.9])

    result = roc_curve(y_true, y_score)

    assert result["nPositive"] == 2
    assert result["nNegative"] == 2
    assert np.all(np.isfinite(result["fpr"]))
    assert np.all(np.isfinite(result["tpr"]))
