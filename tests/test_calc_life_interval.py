"""Interval / left censoring, Turnbull and likelihood-ratio intervals (GAP_AUDIT_9 G8).

Oracles (nothing here is a value remembered from a paper):

- ``lifelines`` (MIT, dev/test only): ``fit_interval_censoring`` for the Weibull /
  lognormal / log-logistic / exponential fits (estimates, SE, log-likelihood) and
  ``KaplanMeierFitter.fit_interval_censoring`` (its Turnbull NPMLE, run at
  ``tol=1e-13``) on mixed exact / left / interval / right rows.
  MEASURED worst disagreement over 6 mixed samples (n = 80): estimates 4.6e-7
  relative (loglogistic 6e-7; lognormal 2.5e-5, lifelines' optimiser tolerance); SE
  5.1e-6; log-likelihood 1.1e-11 absolute (lognormal 2.3e-8); Turnbull survival 8.4e-9 over
  5 samples. Each bound below is at least 4x the measured worst.
- ``life_core.fit_ml`` (right-censored engine, itself validated against lifelines and
  the NIST/SEMATECH 8.4.1.3 example): the interval log-likelihood must reduce to it.
- Independent profile-likelihood check: a brute-force dense (mu, ln sigma) grid with
  the chi-square(1) cutoff, no root finder and no scalar optimiser.
- Turnbull: Kaplan-Meier for exact / right-censored rows; a hand-built example
  maximised by SLSQP; the Kuhn-Tucker conditions.
"""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
import pytest
from lifelines import (
    ExponentialFitter,
    KaplanMeierFitter,
    LogLogisticFitter,
    LogNormalFitter,
    WeibullFitter,
)
from scipy import optimize
from scipy import stats as sps

from quantized.calc import life_core as lc
from quantized.calc.life_interval import check_interval_data, fit_interval, interval_loglik
from quantized.calc.life_nonpar import kaplan_meier_censored
from quantized.calc.life_profile import lr_parameter_intervals, lr_quantile_interval
from quantized.calc.life_turnbull import turnbull
from quantized.calc.stats_life import fit_life
from quantized.calc.stats_life_interval import fit_life_interval

NIST_T = [54, 187, 216, 240, 244, 335, 361, 373, 375, 386] + [500] * 10
NIST_C = [0] * 10 + [1] * 10


def _mixed(seed: int, n: int = 80) -> tuple[np.ndarray, np.ndarray]:
    """Exact, left-censored, interval-censored and right-censored rows of a Weibull sample."""
    rng = np.random.default_rng(seed)
    t = np.exp(5 + 0.6 * np.log(-np.log(rng.uniform(size=n))))
    kind = rng.integers(0, 4, size=n)
    lo, up = np.empty(n), np.empty(n)
    for i, (ti, k) in enumerate(zip(t, kind, strict=True)):
        if k == 0:
            lo[i] = up[i] = ti
        elif k == 1:
            lo[i], up[i] = 0.0, ti * rng.uniform(1.0, 1.5)
        elif k == 2:
            lo[i], up[i] = ti * rng.uniform(0.6, 1.0), ti * rng.uniform(1.0, 1.5)
        else:
            lo[i], up[i] = ti * 0.8, np.inf
    return lo, up


def _param(r: dict[str, Any], prefix: str) -> dict[str, Any]:
    return next(p for p in r["parameters"] if p["name"].startswith(prefix))


# ------------------------------------------------------------ lifelines oracle


@pytest.mark.parametrize("seed", range(4))
def test_parametric_interval_fits_match_lifelines(seed: int) -> None:
    lo, up = _mixed(seed)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = WeibullFitter().fit_interval_censoring(lo, up)
        ln = LogNormalFitter().fit_interval_censoring(lo, up)
        ll = LogLogisticFitter().fit_interval_censoring(lo, up)
        ex = ExponentialFitter().fit_interval_censoring(lo, up)
        wb_se = wb._compute_standard_errors().loc["se"]
    r = fit_life_interval(lo, up, distribution="weibull")
    assert _param(r, "eta")["estimate"] == pytest.approx(wb.lambda_, rel=5e-6)
    assert _param(r, "beta")["estimate"] == pytest.approx(wb.rho_, rel=5e-6)
    assert _param(r, "eta")["se"] == pytest.approx(wb_se["lambda_"], rel=5e-5)
    assert _param(r, "beta")["se"] == pytest.approx(wb_se["rho_"], rel=5e-5)
    assert r["loglik"] == pytest.approx(wb.log_likelihood_, abs=1e-6)
    assert (r["n_exact"], r["n"]) == (int(np.sum(lo == up)), 80)
    assert r["n_left"] + r["n_interval"] + r["n_exact"] + r["n_right"] == 80
    r = fit_life_interval(lo, up, distribution="lognormal")
    assert _param(r, "mu")["estimate"] == pytest.approx(ln.mu_, rel=1e-4)
    assert _param(r, "sigma")["estimate"] == pytest.approx(ln.sigma_, rel=1e-4)
    assert r["loglik"] == pytest.approx(ln.log_likelihood_, abs=1e-6)
    r = fit_life_interval(lo, up, distribution="loglogistic")
    assert _param(r, "median")["estimate"] == pytest.approx(ll.alpha_, rel=5e-6)
    assert 1.0 / _param(r, "sigma")["estimate"] == pytest.approx(ll.beta_, rel=5e-6)
    assert r["loglik"] == pytest.approx(ll.log_likelihood_, abs=1e-6)
    r = fit_life_interval(lo, up, distribution="exponential")
    assert _param(r, "theta")["estimate"] == pytest.approx(ex.lambda_, rel=5e-6)
    assert r["loglik"] == pytest.approx(ex.log_likelihood_, abs=1e-6)


def test_interval_likelihood_reduces_to_right_censored_engine() -> None:
    """Exact + right rows: same log-likelihood and fit as ``fit_ml`` (NIST 8.4.1.3 data)."""
    t, c = np.asarray(NIST_T, float), np.asarray(NIST_C, float)
    up = np.where(c == 0, t, np.inf)
    for dist in lc.LIFE_DISTS:
        log_time = lc.DISTRIBUTIONS[dist][1]
        base = lc.fit_ml(lc.check_life_data(t, c, log_time=log_time), dist)
        ours = fit_interval(check_interval_data(t, up, log_time=log_time), dist)
        assert ours.loglik == pytest.approx(base.loglik, abs=1e-6), dist
        assert ours.beta[0] == pytest.approx(base.beta[0], rel=1e-5, abs=1e-6)
        assert ours.sigma == pytest.approx(base.sigma, rel=1e-4)
    w = fit_interval(check_interval_data(t, up), "weibull")
    assert w.loglik == pytest.approx(-75.135, abs=5e-4)  # NIST prints -75.135


def test_left_censoring_is_lower_zero_cdf() -> None:
    """A left-censored row contributes ln F(upper): check against scipy's Weibull cdf."""
    lo, up = np.array([0.0, 10.0, 20.0, 30.0]), np.array([15.0, 10.0, 20.0, 30.0])
    d = check_interval_data(lo, up)
    eta, beta = 25.0, 2.0
    ll = interval_loglik(d, "weibull", float(np.log(eta)), float(np.log(1 / beta)))
    w = sps.weibull_min(beta, scale=eta)
    want = w.logcdf(15.0) + w.logpdf([10.0, 20.0, 30.0]).sum()
    assert ll == pytest.approx(want, abs=1e-10)


# ------------------------------------------------------------------- Turnbull


@pytest.mark.parametrize("seed", range(3))
def test_turnbull_matches_lifelines_npmle(seed: int) -> None:
    lo, up = _mixed(seed)
    tb = turnbull(check_interval_data(lo, up))
    assert tb["converged"]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        k = KaplanMeierFitter().fit_interval_censoring(
            np.where(lo < up, lo + 1e-9, lo), up, tol=1e-13
        )
    sf = k.survival_function_.iloc[:, 0]
    for u, s in zip(tb["upper"], tb["survival"], strict=True):
        if np.isfinite(u):
            assert sf[sf.index > u + 1e-7].iloc[0] == pytest.approx(s, abs=1e-6)


def test_turnbull_reduces_to_kaplan_meier() -> None:
    rng = np.random.default_rng(3)
    t = np.round(rng.weibull(1.5, 60) * 100) + 1  # ties on purpose
    cens = np.round(rng.uniform(40, 200, 60))
    time, failed = np.minimum(t, cens), t <= cens
    km = kaplan_meier_censored(lc.LifeData(time, failed))
    tb = turnbull(check_interval_data(time, np.where(failed, time, np.inf)))
    pts = [
        (lo, s)
        for lo, hi, s in zip(tb["lower"], tb["upper"], tb["survival"], strict=True)
        if lo == hi
    ]
    assert [p[0] for p in pts] == km["times"]
    assert [p[1] for p in pts] == pytest.approx(km["survival"], abs=1e-9)


def test_turnbull_hand_example_against_slsqp() -> None:
    """Six rows with overlapping intervals; maximise the NPMLE likelihood independently."""
    lo = np.array([1.0, 2.0, 3.0, 6.0, 7.0, 4.5])
    up = np.array([3.5, 4.0, 5.0, 8.0, 9.0, 6.5])
    tb = turnbull(check_interval_data(lo, up))
    # Independent construction: candidate mass points = every right endpoint (the NPMLE
    # always has an optimum with mass on right endpoints); maximise sum ln(mass in (l, u]).
    pts = np.sort(np.unique(up))
    member = ((pts[None, :] > lo[:, None]) & (pts[None, :] <= up[:, None])).astype(float)

    def neg(p: np.ndarray) -> float:
        return -float(np.sum(np.log(np.maximum(member @ p, 1e-300))))

    res = optimize.minimize(
        neg,
        np.full(pts.size, 1 / pts.size),
        method="SLSQP",
        bounds=[(0, 1)] * pts.size,
        constraints={"type": "eq", "fun": lambda p: p.sum() - 1},
        options={"ftol": 1e-14, "maxiter": 1000},
    )
    # Likelihood of the Turnbull masses, evaluated on the same candidate points.
    mass = np.zeros(pts.size)
    for u, m in zip(tb["upper"], tb["mass"], strict=True):
        mass[int(np.argmin(np.abs(pts - u)))] += m
    assert neg(mass) == pytest.approx(res.fun, abs=1e-7)
    assert sum(tb["mass"]) == pytest.approx(1.0, abs=1e-12)
    assert tb["converged"]


# ---------------------------------------------------------- likelihood ratio


def _ll_grid(ll: Any, mu: np.ndarray, s: np.ndarray) -> np.ndarray:
    return np.array([[ll(m, v) for v in s] for m in mu])


def _grid_edges(vals: np.ndarray, prof: np.ndarray, cut: float) -> tuple[float, float]:
    """Outermost crossings of ``2 (max - prof) = cut`` (linear interpolation between nodes)."""
    g = 2.0 * (prof.max() - prof) - cut
    i = int(np.argmax(prof))
    lo_i = max(j for j in range(i) if g[j] > 0)
    hi_i = min(j for j in range(i, g.size) if g[j] > 0)
    lo = vals[lo_i] + (vals[lo_i + 1] - vals[lo_i]) * g[lo_i] / (g[lo_i] - g[lo_i + 1])
    hi = vals[hi_i - 1] + (vals[hi_i] - vals[hi_i - 1]) * g[hi_i - 1] / (g[hi_i - 1] - g[hi_i])
    return float(lo), float(hi)


def _check_against_grid(dist: str, idata: Any, step: int = 1) -> None:
    """``step`` > 1 thins the grids (tolerances scale with it) for the slower interval data."""
    fit = fit_interval(idata, dist)

    def ll(m: float, s: float) -> float:
        return interval_loglik(idata, dist, m, s)

    cut = (sps.norm.ppf(0.975)) ** 2  # chi2_1(0.95) = z_{0.975}^2, derived independently
    assert cut == pytest.approx(sps.chi2.ppf(0.95, 1), rel=1e-12)
    mu = np.linspace(fit.beta[0] - 1.0, fit.beta[0] + 1.0, 200 // step + 1)
    s = np.linspace(fit.log_sigma - 1.0, fit.log_sigma + 1.2, 220 // step + 1)
    g = _ll_grid(ll, mu, s)
    got = lr_parameter_intervals(ll, fit, 0.05)
    lo, hi = _grid_edges(mu, g.max(axis=1), cut)
    assert got["mu"][0] == pytest.approx(lo, abs=2e-3 * step)
    assert got["mu"][1] == pytest.approx(hi, abs=2e-3 * step)
    lo, hi = _grid_edges(s, g.max(axis=0), cut)
    assert got["log_sigma"][0] == pytest.approx(lo, abs=3e-3 * step)
    assert got["log_sigma"][1] == pytest.approx(hi, abs=3e-3 * step)
    # B10 life: profile over y_p = mu + sigma w_p on a (y, ln sigma) grid.
    w = float(lc.std_quantile(lc.DISTRIBUTIONS[dist][0], 0.1))
    y0 = fit.beta[0] + fit.sigma * w
    y = np.linspace(y0 - 1.2, y0 + 1.2, 240 // step + 1)
    sq = np.linspace(fit.log_sigma - 0.9, fit.log_sigma + 1.1, 200 // step + 1)
    prof = np.array([max(ll(yy - np.exp(v) * w, v) for v in sq) for yy in y])
    lo, hi = _grid_edges(y, prof, cut)
    q = lr_quantile_interval(ll, fit, 0.1, 0.05)
    assert q[0] == pytest.approx(lo, abs=4e-3 * step)
    assert q[1] == pytest.approx(hi, abs=4e-3 * step)


def test_lr_intervals_match_brute_force_grid_right_censored() -> None:
    t, c = np.asarray(NIST_T, float), np.asarray(NIST_C, float)
    _check_against_grid("weibull", check_interval_data(t, np.where(c == 0, t, np.inf)))


def test_lr_intervals_match_brute_force_grid_interval_censored() -> None:
    lo, up = _mixed(5, n=40)
    _check_against_grid("lognormal", check_interval_data(lo, up), step=3)


def test_lr_exponential_has_no_sigma_and_matches_closed_form() -> None:
    """Complete exponential sample: the LR limits solve a one-parameter equation (no oracle needed
    beyond scipy's brentq on the closed-form profile ll(theta) = -n ln theta - sum t / theta)."""
    t = np.array([12.0, 30.0, 41.0, 77.0, 120.0, 150.0, 260.0])
    d = check_interval_data(t, t)
    fit = fit_interval(d, "exponential")
    out = fit_life(t, np.zeros(t.size), distribution="exponential", ci_method="likelihood-ratio")
    th = out["parameters"][0]
    assert th["name"].startswith("theta")
    that, n = t.mean(), t.size

    def f(theta: float) -> float:
        prof = lambda x: -n * np.log(x) - t.sum() / x  # noqa: E731
        return 2.0 * (prof(that) - prof(theta)) - sps.chi2.ppf(0.95, 1)

    lo = optimize.brentq(f, that * 0.05, that)
    hi = optimize.brentq(f, that, that * 20)
    assert th["ci_low"] == pytest.approx(lo, rel=1e-6)
    assert th["ci_high"] == pytest.approx(hi, rel=1e-6)
    assert fit.n_params == 1
    assert not any(p["name"].startswith("sigma") for p in out["parameters"])


def test_fit_life_ci_method_default_wald_and_lr_option() -> None:
    base = fit_life(NIST_T, NIST_C)
    again = fit_life(NIST_T, NIST_C, ci_method="wald")
    assert base["parameters"] == again["parameters"] and base["quantiles"] == again["quantiles"]
    assert base["ci_method"].startswith("Wald")
    lr = fit_life(NIST_T, NIST_C, ci_method="likelihood-ratio")
    assert lr["ci_method"].startswith("Likelihood ratio")
    # Estimates, SE and fit statistics are untouched; only the limits move (and are asymmetric).
    for a, b in zip(base["parameters"], lr["parameters"], strict=True):
        assert a["estimate"] == b["estimate"] and a["se"] == b["se"]
    eta_w, eta_l = _param(base, "eta"), _param(lr, "eta")
    assert eta_l["ci_low"] < eta_l["estimate"] < eta_l["ci_high"]
    assert (eta_l["ci_low"], eta_l["ci_high"]) != (eta_w["ci_low"], eta_w["ci_high"])
    b1 = lr["quantiles"][0]
    assert b1["ci_low"] < b1["time"] < b1["ci_high"]
    beta_l = _param(lr, "beta")
    mu_l, sig_l = _param(lr, "mu"), _param(lr, "sigma")
    assert beta_l["ci_low"] == pytest.approx(1.0 / sig_l["ci_high"], rel=1e-12)
    assert eta_l["ci_low"] == pytest.approx(np.exp(mu_l["ci_low"]), rel=1e-12)


# ------------------------------------------------------------------- refusals


@pytest.mark.parametrize(
    ("lower", "upper", "msg"),
    [
        ([1, 5, 3], [2, 4, 6], "lower > upper in row 2"),
        ([1, 2, 3], [None, None, None], "every row is right-censored"),
        ([1, 2, 3], [None, float("nan"), None], "every row is right-censored"),
        ([1, 0, 3], [2, None, 6], "lower = 0 and no upper"),
        ([1, 2], [2], "length"),
        ([-1, 2, 3], [2, 3, 4], "non-negative"),
        ([1, 2, 3], [2, None, None], "at least 2 rows"),
        ([0, 2, 3], [0, 3, 4], "greater than 0"),
        ([float("inf"), 2, 3], [None, 3, 4], "finite"),
    ],
)
def test_interval_refusals(lower: list[Any], upper: list[Any], msg: str) -> None:
    with pytest.raises(ValueError, match=msg):
        fit_life_interval(lower, upper)


def test_existing_refusals_kept_and_bad_method_refused() -> None:
    with pytest.raises(ValueError, match="at least 2 failures"):
        fit_life([1, 2, 3], [0, 1, 1])
    with pytest.raises(ValueError, match="ci_method"):
        fit_life(NIST_T, NIST_C, ci_method="bootstrap")
    with pytest.raises(ValueError, match="ci_method"):
        fit_life_interval([1, 2, 3], [2, 3, 4], ci_method="profile")


def test_interval_result_shape_and_compare() -> None:
    lo, up = _mixed(1, n=50)
    r = fit_life_interval(lo, up, compare=True, eval_times=[100.0], ci_method="likelihood-ratio")
    assert {c["distribution"] for c in r["comparison"]} == set(lc.LIFE_DISTS)
    assert r["plot"]["method"] == "turnbull" and r["plot"]["points"]
    assert r["turnbull"]["converged"] and r["probabilities"][0]["time"] == 100.0


def test_life_probability_figure_renders_and_refuses() -> None:
    from quantized.calc.figure_lifeplot import render_life_probability_figure

    plot = fit_life(NIST_T, NIST_C)["plot"]
    assert render_life_probability_figure(plot, fmt="pdf")[:4] == b"%PDF"
    assert b"<svg" in render_life_probability_figure(plot, fmt="svg")[:600]
    iv = fit_life_interval(*_mixed(2, n=40), distribution="lognormal")["plot"]
    assert render_life_probability_figure(iv, fmt="png")[:4] == b"\x89PNG"
    with pytest.raises(ValueError, match="fmt"):
        render_life_probability_figure(plot, fmt="gif")
    with pytest.raises(ValueError, match="plot needs"):
        render_life_probability_figure({"points": []})
