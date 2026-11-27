"""Confidence intervals for one sample (calc.stats_ci and POST /api/stats/confidence-intervals).

Every number is checked against an independent computation: scipy's t / chi2 intervals,
binomtest (and quantile_test) for the order statistics, scipy.stats.bootstrap with the
same seed for the bootstrap, and textbook table values.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import stats as sps

from quantized.app import create_app
from quantized.calc.stats_ci import (
    BOOTSTRAP_MAX_N,
    BOOTSTRAP_RESAMPLES,
    BOOTSTRAP_SEED,
    confidence_intervals,
    median_interval,
)

X10 = [2.1, 3.4, 1.9, 5.6, 4.4, 3.8, 2.7, 6.1, 4.9, 3.3]


def by(res: dict, statistic: str, method: str | None = None) -> dict:
    for r in res["rows"]:
        if r["statistic"] == statistic and (method is None or r["method"] == method):
            return r
    raise AssertionError(statistic)


@pytest.mark.parametrize("level", [0.8, 0.9, 0.95, 0.99])
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_mean_sd_variance_against_scipy(level: float, seed: int) -> None:
    x = np.random.default_rng(seed).normal(5, 2, 17 + seed)
    res = confidence_intervals(x, level=level)
    n = x.size
    lo, hi = sps.t.interval(level, n - 1, loc=x.mean(), scale=sps.sem(x))
    m = by(res, "mean")
    np.testing.assert_allclose([m["low"], m["high"], m["estimate"]], [lo, hi, x.mean()], rtol=1e-12)
    a = 1 - level
    s2 = x.var(ddof=1)
    v_lo = (n - 1) * s2 / sps.chi2.ppf(1 - a / 2, n - 1)
    v_hi = (n - 1) * s2 / sps.chi2.ppf(a / 2, n - 1)
    v = by(res, "variance")
    np.testing.assert_allclose([v["low"], v["high"]], [v_lo, v_hi], rtol=1e-12)
    sd = by(res, "standard deviation")
    np.testing.assert_allclose([sd["low"], sd["high"], sd["estimate"]],
                               [math.sqrt(v_lo), math.sqrt(v_hi), x.std(ddof=1)], rtol=1e-12)


def test_textbook_one_to_five() -> None:
    # t(0.975, 4) = 2.776 and chi2(0.975, 4) = 11.143, chi2(0.025, 4) = 0.484 (table values).
    res = confidence_intervals([1, 2, 3, 4, 5])
    m = by(res, "mean")
    half = 2.7764451 * math.sqrt(2.5) / math.sqrt(5)
    np.testing.assert_allclose([m["low"], m["high"]], [3 - half, 3 + half], rtol=1e-7)
    np.testing.assert_allclose([m["low"], m["high"]], [1.0368, 4.9632], atol=1e-4)
    v = by(res, "variance")
    np.testing.assert_allclose([v["low"], v["high"]], [10 / 11.143287, 10 / 0.484419], rtol=1e-6)
    np.testing.assert_allclose([v["low"], v["high"]], [0.8974, 20.643], rtol=1e-4)


def test_median_n10_is_x2_to_x9_with_exact_coverage() -> None:
    # Conover / Hahn & Meeker: n = 10 at 95% gives x(2) to x(9), coverage 1 - 2*11/1024 = 97.85%.
    res = confidence_intervals(X10, level=0.95)
    r = by(res, "median")
    srt = sorted(X10)
    assert (r["rank_low"], r["rank_high"]) == (2, 9)
    assert (r["low"], r["high"]) == (srt[1], srt[8])
    assert r["level"] == pytest.approx(1 - 2 * 11 / 1024, abs=1e-12)
    assert "97.85%" in r["note"]


@pytest.mark.parametrize("n", [6, 7, 10, 11, 20, 25, 40, 101])
@pytest.mark.parametrize("level", [0.8, 0.9, 0.95, 0.99])
def test_median_coverage_matches_binomtest_and_quantile_test(n: int, level: float) -> None:
    mi = median_interval(n, level)
    if mi["lower"] is None:
        assert 1 - 2.0 ** (1 - n) < level
        assert 1 - 2.0 ** (1 - mi["needed_n"]) >= level - 1e-12 > 1 - 2.0 ** (1 - (mi["needed_n"] - 1))
        return
    lo = mi["lower"]
    # Independent: P(B <= l-1) from binomtest's one-sided p-value.
    tail = sps.binomtest(lo - 1, n, 0.5, alternative="less").pvalue
    assert mi["coverage"] == pytest.approx(1 - 2 * tail, abs=1e-12)
    assert mi["coverage"] >= level - 1e-12
    # The next rank in would fall below the level (it is the narrowest that reaches it).
    nxt = 1 - 2 * sps.binomtest(lo, n, 0.5, alternative="less").pvalue
    assert nxt < level - 1e-12 or lo + 1 > n + 1 - (lo + 1)
    assert mi["upper"] == n + 1 - lo


@pytest.mark.parametrize("level", [0.9, 0.95])
def test_median_interval_equals_scipy_quantile_test(level: float) -> None:
    x = np.random.default_rng(7).normal(size=31)
    ci = sps.quantile_test(x, q=0, p=0.5).confidence_interval(level)
    r = by(confidence_intervals(x, level=level), "median")
    np.testing.assert_allclose([r["low"], r["high"]], [ci.low, ci.high])


def test_median_withheld_when_too_few_values() -> None:
    r = by(confidence_intervals([1.0, 2.0, 3.0, 4.0, 5.0]), "median")
    assert r["low"] is None and r["high"] is None
    assert "at least 6 values" in r["note"]  # 1 - 2^(1-6) = 96.9% >= 95%
    assert "93.8%" in r["note"]  # 1 - 2^-4 for n = 5


def test_median_with_ties_still_valid() -> None:
    r = by(confidence_intervals([1, 1, 1, 2, 2, 3, 3, 3, 3, 4, 4]), "median")
    assert r["low"] <= r["estimate"] <= r["high"]


def test_bootstrap_matches_scipy_with_the_same_seed() -> None:
    x = np.random.default_rng(11).gamma(2.0, 3.0, 40)
    res = confidence_intervals(x, level=0.9, bootstrap=True)
    assert res["bootstrap"] == {"seed": BOOTSTRAP_SEED, "resamples": BOOTSTRAP_RESAMPLES}
    for name, fn in (("mean", np.mean), ("median", np.median)):
        ref = sps.bootstrap(
            (x,), lambda s, axis=-1, fn=fn: fn(s, axis=axis), vectorized=True, method="percentile",
            n_resamples=BOOTSTRAP_RESAMPLES, confidence_level=0.9,
            rng=np.random.default_rng(BOOTSTRAP_SEED),
        )
        r = by(res, name, "bootstrap percentile")
        np.testing.assert_allclose([r["low"], r["high"]], [ref.confidence_interval.low, ref.confidence_interval.high],
                                   rtol=1e-12)


def test_bootstrap_is_deterministic_and_off_by_default() -> None:
    x = np.random.default_rng(3).normal(size=25)
    assert confidence_intervals(x)["bootstrap"] is None
    assert len(confidence_intervals(x)["rows"]) == 4
    a = confidence_intervals(x, bootstrap=True)
    b = confidence_intervals(x, bootstrap=True)
    assert a == b and len(a["rows"]) == 6


def test_non_finite_dropped_and_refusals() -> None:
    res = confidence_intervals([1.0, float("nan"), 2.0, 3.0, float("inf")])
    assert res["n"] == 3 and res["n_dropped"] == 2
    with pytest.raises(ValueError, match="at least 2"):
        confidence_intervals([1.0])
    with pytest.raises(ValueError, match="level"):
        confidence_intervals(X10, level=1.0)
    with pytest.raises(ValueError, match="level"):
        confidence_intervals(X10, level=0.2)
    with pytest.raises(ValueError, match="bootstrap is limited"):
        confidence_intervals(np.zeros(BOOTSTRAP_MAX_N + 1), bootstrap=True)


def test_route() -> None:
    client = TestClient(create_app())
    r = client.post("/api/stats/confidence-intervals", json={"x": X10 + [None], "level": 0.9, "bootstrap": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n"] == 10 and body["n_dropped"] == 1 and len(body["rows"]) == 6
    expected = confidence_intervals(X10, level=0.9, bootstrap=True)
    np.testing.assert_allclose(by(body, "mean")["low"], by(expected, "mean")["low"], rtol=1e-12)
    bad = client.post("/api/stats/confidence-intervals", json={"x": [1.0], "level": 0.95})
    assert bad.status_code == 422
