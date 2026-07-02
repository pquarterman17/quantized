"""Distribution fitting + power analysis (calc.stats_dist) and stepwise
selection (calc.stats_multivar).

Oracles: published power values (Cohen's tables / G*Power — two-sample
d=0.5, alpha=.05, two-sided: n=64/group gives power ~0.8015), closed-form
normal MLE identities, and exact-recovery stepwise cases.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.stats_dist import (
    fit_distribution,
    fit_distributions,
    required_n,
    t_test_power,
)
from quantized.calc.stats_multivar import stepwise_regression

# deterministic standard-normal-ish quantile sample (no RNG)
_Z = np.asarray(
    [-1.95996398, -1.43953147, -1.15034938, -0.93458929, -0.75541503,
     -0.59776013, -0.45376219, -0.31863936, -0.18911843, -0.06270678,
     0.06270678, 0.18911843, 0.31863936, 0.45376219, 0.59776013,
     0.75541503, 0.93458929, 1.15034938, 1.43953147, 1.95996398]
)


def test_normal_fit_matches_mle_closed_form() -> None:
    x = 3.0 + 1.5 * _Z
    out = fit_distribution(x, "normal")
    assert math.isclose(out["params"]["mu"], float(np.mean(x)), rel_tol=1e-9)
    assert math.isclose(out["params"]["sigma"], float(np.std(x)), rel_tol=1e-6)  # MLE ddof=0
    assert out["ks_p_approximate"] is True
    assert out["ks_p"] > 0.2


def test_lognormal_fit_recovers_log_params() -> None:
    x = np.exp(1.0 + 0.8 * _Z)  # ln x ~ N(1, 0.8)
    out = fit_distribution(x, "lognormal")
    assert math.isclose(out["params"]["mu"], float(np.mean(np.log(x))), rel_tol=1e-6)
    assert 0.6 < out["params"]["sigma"] < 1.0
    assert out["params"]["loc"] == 0.0  # 2-parameter convention


def test_ranking_prefers_the_true_family() -> None:
    x = np.exp(1.0 + 0.8 * _Z)  # strongly right-skewed
    out = fit_distributions(x)
    fits = {f["dist"]: f["aic"] for f in out["fits"]}
    assert fits["lognormal"] < fits["normal"]
    assert out["best"] == out["fits"][0]["dist"]
    assert out["skipped"] == []


def test_negative_data_skips_positive_families() -> None:
    out = fit_distributions(_Z)  # contains negatives
    skipped = {s["dist"] for s in out["skipped"]}
    assert {"lognormal", "weibull", "gamma", "exponential"} <= skipped
    assert out["best"] == "normal"


def test_power_matches_published_cohen_value() -> None:
    # Two-sample, d=0.5, alpha=.05 two-sided, n=64/group -> ~0.8015 (G*Power)
    out = t_test_power(0.5, 64)
    assert abs(out["power"] - 0.8015) < 0.002


def test_required_n_matches_published_tables() -> None:
    # Cohen: two-sample d=0.5, power .80 -> n=64/group
    out = required_n(0.5, 0.8)
    assert out["n"] == 64
    assert out["achieved_power"] >= 0.8
    # one-sample d=0.5, power .80 -> n=34 (G*Power)
    assert required_n(0.5, 0.8, kind="one-sample")["n"] == 34


def test_power_one_sided_exceeds_two_sided() -> None:
    two = t_test_power(0.4, 30, tails=2)["power"]
    one = t_test_power(0.4, 30, tails=1)["power"]
    assert one > two


def test_stepwise_forward_selects_true_predictors() -> None:
    n = 60
    t = np.linspace(0, 5, n)
    x0, x1 = t, np.cos(3.1 * t)
    x2, x3 = t**2 / 5.0, np.sin(1.7 * t)
    noise = 0.01 * np.cos(23.7 * t + 1.0)
    y = 2.0 * x0 - 1.5 * x2 + noise
    out = stepwise_regression([x0, x1, x2, x3], y)
    assert out["selected"] == [0, 2]
    assert out["history"][0]["action"] == "start"
    assert out["model"] is not None
    np.testing.assert_allclose(out["model"]["coeffs"][1:], [2.0, -1.5], atol=0.02)


def test_stepwise_backward_and_bic_agree_here() -> None:
    n = 60
    t = np.linspace(0, 5, n)
    cols = [t, np.cos(3.1 * t), t**2 / 5.0, np.sin(1.7 * t)]
    y = 2.0 * cols[0] - 1.5 * cols[2] + 0.01 * np.cos(23.7 * t + 1.0)
    assert stepwise_regression(cols, y, direction="backward")["selected"] == [0, 2]
    assert stepwise_regression(cols, y, criterion="bic", direction="both")["selected"] == [0, 2]


def test_stepwise_no_signal_selects_nothing() -> None:
    n = 40
    t = np.linspace(0, 1, n)
    y = np.full(n, 5.0) + 0.001 * np.cos(31.0 * t)  # essentially constant
    out = stepwise_regression([np.cos(3.0 * t)], y, criterion="bic")
    assert out["selected"] == []
    assert out["model"] is None


def test_errors() -> None:
    with pytest.raises(ValueError, match="dist must be"):
        fit_distribution(_Z, "cauchy")
    with pytest.raises(ValueError, match="strictly positive"):
        fit_distribution(_Z, "weibull")
    with pytest.raises(ValueError, match="tails"):
        t_test_power(0.5, 10, tails=3)
    with pytest.raises(ValueError, match="nonzero"):
        required_n(0.0)
    with pytest.raises(ValueError, match="criterion"):
        stepwise_regression([_Z], _Z, criterion="cp")
