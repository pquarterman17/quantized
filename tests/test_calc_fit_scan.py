"""Unit tests for calc.fit_scan (GOTO #6 AICc model quick-scan).

Covers: AICc arithmetic against hand values (+ the n-k-1 <= 0 guard), the
default candidate cut (nParams < n/3), model ranking on synthetic Gaussian
data (Gaussian beats Linear by delta-AICc >> 2), per-candidate failure
containment (an error entry, never an abort), Akaike-weight normalization,
and dy/input validation.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.fit_models import FIT_MODELS
from quantized.calc.fit_scan import aicc_from_aic, default_candidates, scan_models


def _gaussian_data() -> tuple[np.ndarray, np.ndarray]:
    """A clean Gaussian bump + tiny deterministic ripple (no RNG)."""
    x = np.linspace(-5.0, 5.0, 81)
    y = 2.0 * np.exp(-((x - 0.5) ** 2) / (2 * 0.8**2)) + 0.01 * np.sin(7.0 * x)
    return x, y


# ── aicc_from_aic ────────────────────────────────────────────────────────────


def test_aicc_hand_value() -> None:
    # AICc = AIC + 2k(k+1)/(n-k-1) = 10 + 2*3*4/(20-3-1) = 10 + 24/16 = 11.5
    assert aicc_from_aic(10.0, 3, 20) == pytest.approx(11.5)


def test_aicc_two_param_hand_value() -> None:
    # -4 + 2*2*3/(10-2-1) = -4 + 12/7
    assert aicc_from_aic(-4.0, 2, 10) == pytest.approx(-4.0 + 12.0 / 7.0)


def test_aicc_guard_dof_zero_and_negative() -> None:
    assert aicc_from_aic(10.0, 3, 4) == math.inf  # n-k-1 == 0
    assert aicc_from_aic(10.0, 5, 4) == math.inf  # n-k-1 < 0


def test_aicc_perfect_fit_stays_minus_inf() -> None:
    # curve_fit reports AIC -inf for a zero-residual fit; the finite
    # correction must not disturb it.
    assert aicc_from_aic(-math.inf, 2, 10) == -math.inf


# ── default_candidates ───────────────────────────────────────────────────────


def test_default_candidates_applies_n_over_3_cut() -> None:
    names = default_candidates(9)  # nParams < 3 -> 2-parameter models only
    assert names
    assert all(FIT_MODELS[m]["nParams"] <= 2 for m in names)
    assert "Linear" in names
    assert "Gaussian" not in names  # 3 params, 3 < 3 is false


def test_default_candidates_large_n_includes_everything() -> None:
    max_k = max(spec["nParams"] for spec in FIT_MODELS.values())
    names = default_candidates(3 * max_k + 3)
    assert set(names) == set(FIT_MODELS)


# ── scan_models ranking ──────────────────────────────────────────────────────


def test_gaussian_ranks_far_above_linear() -> None:
    x, y = _gaussian_data()
    out = scan_models(x, y, models=["Linear", "Gaussian"])
    results = out["results"]
    assert [e["error"] for e in results] == [None, None]
    assert results[0]["name"] == "Gaussian"
    assert results[0]["deltaAICc"] == pytest.approx(0.0)
    # "Substantial support" ends at delta ~ 2 (Burnham & Anderson); a straight
    # line through a Gaussian bump must lose by far more than that.
    assert results[1]["name"] == "Linear"
    assert results[1]["deltaAICc"] > 100
    assert results[0]["weight"] == pytest.approx(1.0, abs=1e-9)


def test_entry_aicc_matches_aic_plus_correction() -> None:
    x, y = _gaussian_data()
    out = scan_models(x, y, models=["Gaussian"])
    e = out["results"][0]
    n, k = out["n"], e["k"]
    assert e["AICc"] == pytest.approx(e["AIC"] + 2 * k * (k + 1) / (n - k - 1))


def test_weights_sum_to_one_over_successes() -> None:
    x, y = _gaussian_data()
    out = scan_models(x, y, models=["Linear", "Quadratic", "Gaussian", "Lorentzian"])
    ok = [e for e in out["results"] if e["error"] is None]
    assert sum(e["weight"] for e in ok) == pytest.approx(1.0)
    # Ascending AICc order.
    aiccs = [e["AICc"] for e in ok]
    assert aiccs == sorted(aiccs)


def test_default_set_is_used_when_models_omitted() -> None:
    x, y = _gaussian_data()
    out = scan_models(x, y)
    expected = set(default_candidates(len(x)))
    assert {e["name"] for e in out["results"]} == expected
    assert out["nCandidates"] == len(expected)


def test_equation_candidates_join_the_ranking() -> None:
    x, y = _gaussian_data()
    out = scan_models(
        x,
        y,
        models=["Linear"],
        equations=[{"name": "MyGauss", "equation": "a*exp(-(x-m)^2/(2*s^2))",
                    "guesses": [1.5, 0.0, 1.0]}],
    )
    results = out["results"]
    assert results[0]["name"] == "MyGauss"
    assert results[0]["kind"] == "equation"
    assert results[0]["paramNames"] == ["a", "m", "s"]
    assert results[1]["name"] == "Linear"
    assert results[1]["deltaAICc"] > 100


# ── failure containment ──────────────────────────────────────────────────────


def test_failing_candidate_is_an_error_entry_not_an_abort() -> None:
    x, y = _gaussian_data()
    out = scan_models(
        x,
        y,
        models=["Gaussian", "No Such Model"],
        equations=[{"name": "bad", "equation": "a*(x"}],  # mismatched paren
    )
    results = out["results"]
    ok = [e for e in results if e["error"] is None]
    failed = [e for e in results if e["error"] is not None]
    assert [e["name"] for e in ok] == ["Gaussian"]
    assert {e["name"] for e in failed} == {"No Such Model", "bad"}
    # Failures sort after all successes and carry null metrics.
    assert results[: len(ok)] == ok
    for e in failed:
        assert e["AICc"] is None and e["weight"] is None and e["k"] is None
        assert isinstance(e["error"], str) and e["error"]


def test_all_candidates_failing_still_returns() -> None:
    x, y = _gaussian_data()
    out = scan_models(x, y, models=["Nope"], equations=[{"name": "b", "equation": "+"}])
    assert all(e["error"] for e in out["results"])
    assert out["nCandidates"] == 2


# ── input validation ─────────────────────────────────────────────────────────


def test_length_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="same length"):
        scan_models([1, 2, 3], [1, 2])


def test_too_few_points_raises() -> None:
    with pytest.raises(ValueError, match="at least 3"):
        scan_models([1, 2], [1, 2])


def test_bad_dy_raises() -> None:
    x, y = _gaussian_data()
    with pytest.raises(ValueError, match="finite and > 0"):
        scan_models(x, y, dy=np.zeros_like(x), models=["Linear"])
    with pytest.raises(ValueError, match="same length"):
        scan_models(x, y, dy=[1.0, 2.0], models=["Linear"])


def test_dy_weights_change_the_fit_inputs_but_not_the_winner() -> None:
    x, y = _gaussian_data()
    dy = np.full_like(x, 0.05)
    out = scan_models(x, y, dy=dy, models=["Linear", "Gaussian"])
    assert out["results"][0]["name"] == "Gaussian"
    assert out["results"][0]["error"] is None
