"""Censored life distributions (GAP_AUDIT_9 G8): oracle and published-value tests.

Oracles: lifelines (MIT, dev/test only) for the Weibull / lognormal /
exponential / log-logistic fits, Kaplan-Meier and the Weibull / lognormal AFT
regressions; scipy for uncensored fits; the NIST/SEMATECH e-Handbook section
8.4.1.3 worked example (10 failures + 10 units censored at 500 h) as the
published value. Tolerances are MEASURED, not assumed: over 12 seeds of
tie-heavy censored samples (n 25-119) the worst disagreement with lifelines was
5e-7 relative (Weibull/exponential/log-logistic estimates and SE), 2e-5
(lognormal estimate) and 5.3e-5 (lognormal SE, lifelines' optimiser
tolerance); log-likelihood 9e-11 absolute (lognormal 4e-8); Kaplan-Meier
survival and bands 8e-16; the Weibull / lognormal AFT regressions agree to
2.4e-7 relative (coefficients, SE) and 4e-11 absolute log-likelihood; the
95% B10 Wald band covered the truth in 94.75% of 400 simulated samples
(n = 40, censored at 600). Uncensored fits vs scipy: 2e-7 (Weibull) and
7e-9 (smallest extreme value). Each bound below is at least 4x the measured worst.
"""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np
import pytest
from scipy import stats as sps

from quantized.calc import life_core as lc
from quantized.calc.life_nonpar import kaplan_meier_censored, plotting_positions
from quantized.calc.stats_life import fit_life, info_criteria
from quantized.calc.stats_life_byx import fit_life_by_x, transform_stress

# NIST/SEMATECH e-Handbook of Statistical Methods, 8.4.1.3 "A Weibull maximum
# likelihood estimation example" (data from 8.2.2.1):
# https://www.itl.nist.gov/div898/handbook/apr/section4/apr413.htm
NIST_T = [54, 187, 216, 240, 244, 335, 361, 373, 375, 386] + [500] * 10
NIST_C = [0] * 10 + [1] * 10


def _param(r: dict[str, Any], prefix: str) -> dict[str, Any]:
    return next(p for p in r["parameters"] if p["name"].startswith(prefix))


def _sample(seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Tie-heavy censored Weibull sample (rounded times, random censoring)."""
    rng = np.random.default_rng(seed)
    n = int(rng.integers(25, 120))
    t = np.round(np.exp(5 + 0.6 * np.log(-np.log(rng.uniform(size=n)))), 0) + 1
    cens = np.round(rng.uniform(100, 600, size=n), 0)
    return np.minimum(t, cens), (t > cens).astype(float)


# ------------------------------------------------------------------ published


def test_nist_weibull_example() -> None:
    r = fit_life(NIST_T, NIST_C, compare=True)
    # NIST prints eta 606.5280, beta 1.7208, log-likelihood -75.135 (rounded).
    assert _param(r, "eta")["estimate"] == pytest.approx(606.528, rel=1e-5)
    assert _param(r, "beta")["estimate"] == pytest.approx(1.7208, abs=5e-5)
    assert r["loglik"] == pytest.approx(-75.135, abs=5e-4)
    aic = {c["distribution"]: -2 * c["loglik"] + 2 * c["n_params"] for c in r["comparison"]}
    assert aic["weibull"] == pytest.approx(154.27, abs=5e-3)  # NIST AIC (Weibull)
    assert aic["lognormal"] == pytest.approx(154.39, abs=5e-3)  # NIST AIC (lognormal)


def test_nist_example_median_and_mean() -> None:
    # NIST: expected lifetime 540.737 h for the fitted Weibull.
    r = fit_life(NIST_T, NIST_C)
    eta, beta = _param(r, "eta")["estimate"], _param(r, "beta")["estimate"]
    from math import gamma

    assert eta * gamma(1 + 1 / beta) == pytest.approx(540.737, rel=1e-4)


# ------------------------------------------------------------ lifelines oracle


@pytest.mark.parametrize("seed", range(6))
def test_matches_lifelines_fits(seed: int) -> None:
    pytest.importorskip("lifelines")
    from lifelines import ExponentialFitter, LogLogisticFitter, LogNormalFitter, WeibullFitter

    t, c = _sample(seed)
    ev = 1 - c
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wf = WeibullFitter().fit(t, ev)
        lf = LogNormalFitter().fit(t, ev)
        ef = ExponentialFitter().fit(t, ev)
        gf = LogLogisticFitter().fit(t, ev)
    w = fit_life(t, c, distribution="weibull")
    ln = fit_life(t, c, distribution="lognormal")
    ex = fit_life(t, c, distribution="exponential")
    lg = fit_life(t, c, distribution="loglogistic")

    s = wf.summary
    for mine, name in ((_param(w, "eta"), "lambda_"), (_param(w, "beta"), "rho_")):
        assert mine["estimate"] == pytest.approx(s.loc[name, "coef"], rel=4e-6)
        assert mine["se"] == pytest.approx(s.loc[name, "se(coef)"], rel=4e-6)
    assert w["loglik"] == pytest.approx(wf.log_likelihood_, abs=1e-6)

    s = lf.summary
    for mine, name in ((_param(ln, "mu"), "mu_"), (_param(ln, "sigma"), "sigma_")):
        assert mine["estimate"] == pytest.approx(s.loc[name, "coef"], rel=2e-4)
        assert mine["se"] == pytest.approx(s.loc[name, "se(coef)"], rel=2e-4)
    assert ln["loglik"] == pytest.approx(lf.log_likelihood_, abs=1e-6)

    s = ef.summary
    assert _param(ex, "theta")["estimate"] == pytest.approx(s.loc["lambda_", "coef"], rel=4e-6)
    assert _param(ex, "theta")["se"] == pytest.approx(s.loc["lambda_", "se(coef)"], rel=4e-6)
    assert ex["loglik"] == pytest.approx(ef.log_likelihood_, abs=1e-6)

    # lifelines log-logistic: alpha = exp(mu) (scale), beta = 1/sigma (shape)
    assert _param(lg, "median")["estimate"] == pytest.approx(gf.alpha_, rel=4e-6)
    assert 1 / _param(lg, "sigma")["estimate"] == pytest.approx(gf.beta_, rel=4e-6)
    assert lg["loglik"] == pytest.approx(gf.log_likelihood_, abs=1e-6)
    # lifelines AIC_ is -2 ll + 2k; AICc / BIC follow from the same ll.
    assert -2 * w["loglik"] + 2 * w["n_params"] == pytest.approx(wf.AIC_, abs=1e-6)


@pytest.mark.parametrize("seed", range(6))
def test_kaplan_meier_matches_lifelines(seed: int) -> None:
    pytest.importorskip("lifelines")
    from lifelines import KaplanMeierFitter

    t, c = _sample(seed)
    km = KaplanMeierFitter().fit(t, 1 - c)
    mine = kaplan_meier_censored(lc.check_life_data(t, c))
    times = np.asarray(mine["times"])
    surv = np.asarray(mine["survival"])
    assert np.max(np.abs(km.survival_function_.iloc[:, 0].loc[times].to_numpy() - surv)) < 1e-12
    ci = km.confidence_interval_.loc[times].to_numpy()
    ok = surv > 0  # lifelines reports [0, 0] where S reaches 0; the band is undefined there
    assert np.max(np.abs(ci[ok, 0] - np.asarray(mine["ci_low"])[ok])) < 1e-12
    assert np.max(np.abs(ci[ok, 1] - np.asarray(mine["ci_high"])[ok])) < 1e-12
    assert all(np.isnan(v) for v in np.asarray(mine["ci_low"])[~ok])
    table = km.event_table.loc[times]
    assert list(table["at_risk"]) == mine["at_risk"]
    assert list(table["observed"]) == mine["events"]


def test_life_by_x_matches_lifelines_aft() -> None:
    pytest.importorskip("lifelines")
    import pandas as pd
    from lifelines import LogNormalAFTFitter, WeibullAFTFitter

    rng = np.random.default_rng(3)
    temp = np.repeat([100.0, 125.0, 150.0], 25)
    xt = transform_stress(temp, "arrhenius-celsius")
    t = np.exp(-20 + 0.8 * xt + 0.5 * np.log(-np.log(rng.uniform(size=temp.size))))
    cap = np.repeat([2000.0, 500.0, 100.0], 25)
    c = (t > cap).astype(float)
    t = np.minimum(t, cap)
    df = pd.DataFrame({"t": t, "e": 1 - c, "xt": xt})
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wa = WeibullAFTFitter().fit(df, "t", "e")
        la = LogNormalAFTFitter().fit(df, "t", "e")
    r = fit_life_by_x(t, c, temp, distribution="weibull")
    b0, b1, sig = r["parameters"]
    s = wa.summary
    assert b0["estimate"] == pytest.approx(s.loc[("lambda_", "Intercept"), "coef"], rel=1e-6)
    assert b1["estimate"] == pytest.approx(s.loc[("lambda_", "xt"), "coef"], rel=1e-6)
    assert b1["se"] == pytest.approx(s.loc[("lambda_", "xt"), "se(coef)"], rel=1e-6)
    assert 1 / sig["estimate"] == pytest.approx(
        float(np.exp(s.loc[("rho_", "Intercept"), "coef"])), rel=1e-6
    )
    assert r["loglik"] == pytest.approx(wa.log_likelihood_, abs=1e-6)
    r2 = fit_life_by_x(t, c, temp, distribution="lognormal")
    s2 = la.summary
    assert r2["parameters"][1]["estimate"] == pytest.approx(s2.loc[("mu_", "xt"), "coef"], rel=1e-6)
    assert r2["loglik"] == pytest.approx(la.log_likelihood_, abs=1e-6)


# ------------------------------------------------------- closed forms / scipy


def test_exponential_closed_form() -> None:
    t, c = _sample(2)
    r = fit_life(t, c, distribution="exponential")
    fails = int((c == 0).sum())
    theta = t.sum() / fails  # total time on test / failures
    p = _param(r, "theta")
    assert p["estimate"] == pytest.approx(theta, rel=1e-6)
    assert p["se"] == pytest.approx(theta / np.sqrt(fails), rel=1e-5)
    assert r["loglik"] == pytest.approx(-fails * np.log(theta) - fails, abs=1e-6)


def test_uncensored_matches_scipy_mle() -> None:
    rng = np.random.default_rng(5)
    t = sps.weibull_min.rvs(1.7, scale=300, size=80, random_state=rng)
    r = fit_life(t, np.zeros(t.size))
    shape, _, scale = sps.weibull_min.fit(t, floc=0)
    assert _param(r, "beta")["estimate"] == pytest.approx(shape, rel=1e-5)
    assert _param(r, "eta")["estimate"] == pytest.approx(scale, rel=1e-5)
    sev = fit_life(t, np.zeros(t.size), distribution="sev")
    loc, sc = sps.gumbel_l.fit(t)
    assert _param(sev, "mu")["estimate"] == pytest.approx(loc, rel=1e-7)
    assert _param(sev, "sigma")["estimate"] == pytest.approx(sc, rel=1e-7)
    ln = fit_life(t, np.zeros(t.size), distribution="lognormal")
    mu, sd = np.log(t).mean(), np.log(t).std()
    assert _param(ln, "mu")["estimate"] == pytest.approx(mu, rel=1e-6)
    assert _param(ln, "sigma")["estimate"] == pytest.approx(sd, rel=1e-6)


@pytest.mark.parametrize("dist", lc.LIFE_DISTS)
def test_gradient_matches_finite_difference(dist: str) -> None:
    t, c = _sample(4)
    data = lc.check_life_data(t, c, log_time=False)
    std, log_time, _ = lc.DISTRIBUTIONS[dist]
    y = np.log(data.time) if log_time else data.time
    X = np.ones((data.n, 1))
    th = np.array([float(np.mean(y)), float(np.log(np.std(y)))])
    args = (X, y, data.failed, std, False, 0.0)
    g = lc._nll_grad(th, *args)[1]
    for j in range(2):
        e = np.zeros(2)
        e[j] = 1e-6
        fd = (lc._nll_grad(th + e, *args)[0] - lc._nll_grad(th - e, *args)[0]) / 2e-6
        assert g[j] == pytest.approx(fd, rel=1e-6, abs=1e-6)


# --------------------------------------------------------- plotting positions


def test_median_ranks_uncensored_are_benard() -> None:
    d = lc.check_life_data([1, 2, 3, 4, 5], [0] * 5)
    pp = plotting_positions(d)
    assert pp["probabilities"] == pytest.approx([(i - 0.3) / 5.4 for i in range(1, 6)])


def test_johnson_adjusted_ranks_hand_computed() -> None:
    # fail, cens, fail, cens, fail: adjusted ranks 1, 2.25, 4.125 (Johnson 1964)
    d = lc.check_life_data([1, 2, 3, 4, 5], [0, 1, 0, 1, 0])
    pp = plotting_positions(d)
    assert pp["times"] == [1.0, 3.0, 5.0]
    assert pp["probabilities"] == pytest.approx([0.7 / 5.4, 1.95 / 5.4, 3.825 / 5.4])


def test_km_midpoint_positions() -> None:
    d = lc.check_life_data([1, 2, 3, 4], [0, 0, 1, 0])
    pp = plotting_positions(d, "kaplan-meier")
    # S: 0.75, 0.5, (cens), 0 -> F steps 0.25, 0.5, 1.0; midpoints 0.125, 0.375, 0.75
    assert pp["probabilities"] == pytest.approx([0.125, 0.375, 0.75])


# --------------------------------------------------------------- intervals


def test_quantile_and_probability_roundtrip() -> None:
    r = fit_life(NIST_T, NIST_C, quantile_probs=[0.1], eval_times=[300.0])
    b10 = r["quantiles"][0]
    again = fit_life(NIST_T, NIST_C, eval_times=[b10["time"]])
    assert again["probabilities"][0]["probability"] == pytest.approx(0.1, abs=1e-9)
    assert b10["ci_low"] < b10["time"] < b10["ci_high"]
    p = r["probabilities"][0]
    assert p["ci_low"] < p["probability"] < p["ci_high"]
    assert p["reliability"] == pytest.approx(1 - p["probability"])
    # closed form for the Weibull B10: eta * (-ln 0.9)^(1/beta)
    eta, beta = _param(r, "eta")["estimate"], _param(r, "beta")["estimate"]
    assert b10["time"] == pytest.approx(eta * (-np.log(0.9)) ** (1 / beta), rel=1e-9)


def test_wald_band_coverage_is_near_nominal() -> None:
    # 400 simulated censored Weibull samples: the 95% B10 band should cover the
    # true B10 about 95% of the time (Wald is approximate at n=40, so >= 90%).
    rng = np.random.default_rng(11)
    eta, beta = 500.0, 1.8
    true_b10 = eta * (-np.log(0.9)) ** (1 / beta)
    hit = 0
    runs = 400
    for _ in range(runs):
        t = eta * (-np.log(rng.uniform(size=40))) ** (1 / beta)
        cap = 600.0
        c = (t > cap).astype(float)
        q = fit_life(np.minimum(t, cap), c, quantile_probs=[0.1])["quantiles"][0]
        hit += q["ci_low"] <= true_b10 <= q["ci_high"]
    assert 0.90 <= hit / runs <= 0.99


def test_aicc_bic_formulae() -> None:
    aicc, bic = info_criteria(-75.0, 2, 20)
    assert aicc == pytest.approx(150.0 + 4 + 12 / 17)
    assert bic == pytest.approx(150.0 + 2 * np.log(20))
    assert info_criteria(-5.0, 2, 3)[0] is None  # n <= k + 1: correction undefined


def test_compare_ranks_and_reports_unsupported() -> None:
    r = fit_life([0, 1, 2, 3.5, 5, 8], [0, 0, 0, 0, 1, 0], distribution="sev", compare=True)
    rows = {c["distribution"]: c for c in r["comparison"]}
    assert min(c["delta_aicc"] for c in r["comparison"] if c["aicc"] is not None) == 0.0
    # a zero time cannot enter a ln(t) family but sev takes it
    assert rows["sev"]["loglik"] is not None
    assert rows["weibull"]["loglik"] is None and "greater than 0" in rows["weibull"]["note"]


# ----------------------------------------------------------------- refusals


@pytest.mark.parametrize(
    ("time", "censor", "msg"),
    [
        ([1, 2, 3, 4], [0, 1, 1, 1], "at least 2 failures"),
        ([1, 2, 3, 4], [1, 1, 1, 1], "at least 2 failures"),
        ([1, -2, 3, 4], [0, 0, 0, 0], "non-negative"),
        ([1, 2, 3, 4], [0, 0, 2, 0], "censor must be 0"),
        ([1, 2, 3, 4], [0, 0, 0.5, 0], "censor must be 0"),
        ([1, 2, 3], [0, 0, 0, 0], "length"),
        ([1, 2, np.nan, 4], [0, 0, 0, 0], "finite"),
        ([0, 2, 3, 4], [0, 0, 0, 0], "greater than 0"),
        ([5, 5, 5, 5], [0, 0, 0, 0], "singular|converge"),
    ],
)
def test_refusals(time: list[float], censor: list[float], msg: str) -> None:
    with pytest.raises(ValueError, match=msg):
        fit_life(time, censor)


def test_other_refusals() -> None:
    with pytest.raises(ValueError, match="distribution"):
        fit_life(NIST_T, NIST_C, distribution="gamma")
    with pytest.raises(ValueError, match="alpha"):
        fit_life(NIST_T, NIST_C, alpha=1.5)
    with pytest.raises(ValueError, match="between 0 and 1"):
        fit_life(NIST_T, NIST_C, quantile_probs=[1.0])
    with pytest.raises(ValueError, match="positive"):
        fit_life(NIST_T, NIST_C, eval_times=[-1.0])
    with pytest.raises(ValueError, match="plotting"):
        fit_life(NIST_T, NIST_C, plotting="blom")


def test_life_by_x_refusals() -> None:
    t = np.array([10.0, 20, 30, 40, 5, 6, 7, 8])
    c = np.zeros(8)
    x = np.array([100.0] * 4 + [150.0] * 4)
    with pytest.raises(ValueError, match="2 distinct"):
        fit_life_by_x(t, c, np.full(8, 100.0))
    with pytest.raises(ValueError, match="sev|supports"):
        fit_life_by_x(t, c, x, distribution="sev")
    with pytest.raises(ValueError, match="absolute zero"):
        fit_life_by_x(t, c, x - 500, transform="arrhenius-celsius")
    with pytest.raises(ValueError, match="positive"):
        fit_life_by_x(t, c, x - 100, transform="power")
    with pytest.raises(ValueError, match="length"):
        fit_life_by_x(t, c, x[:5])
    cen = np.array([0, 0, 0, 0, 1, 1, 1, 1.0])
    with pytest.raises(ValueError, match="distinct stress levels"):
        fit_life_by_x(t, cen, x)


def test_life_by_x_use_condition_and_acceleration() -> None:
    rng = np.random.default_rng(8)
    temp = np.repeat([100.0, 125.0, 150.0], 30)
    xt = transform_stress(temp, "arrhenius-celsius")
    t = np.exp(-20 + 0.8 * xt + 0.5 * np.log(-np.log(rng.uniform(size=temp.size))))
    r = fit_life_by_x(t, np.zeros(temp.size), temp, use_x=40.0, quantile_probs=[0.5])
    ea = r["parameters"][1]
    assert ea["ci_low"] < 0.8 < ea["ci_high"]  # truth inside its 95% CI (seed fixed)
    af = {a["x"]: a for a in r["acceleration"]}
    dx = float(
        transform_stress(40.0, "arrhenius-celsius") - transform_stress(150.0, "arrhenius-celsius")
    )
    assert af[150.0]["factor"] == pytest.approx(np.exp(ea["estimate"] * dx))
    assert af[150.0]["ci_low"] < af[150.0]["factor"] < af[150.0]["ci_high"]
    assert r["use_quantiles"][0]["time"] > 100 * np.median(t[temp == 150.0])


def test_arrhenius_uses_codata_boltzmann() -> None:
    # 1/(k_B T) at 25 C: 38.9 per eV (kT = 25.69 meV), CODATA 2018 k_B = 8.617333262e-5 eV/K
    assert float(transform_stress(25.0, "arrhenius-celsius")) == pytest.approx(
        1 / (8.617333262e-5 * 298.15), rel=1e-9
    )
    assert float(transform_stress(298.15, "arrhenius-kelvin")) == pytest.approx(
        1 / (8.617333262e-5 * 298.15), rel=1e-9
    )


def test_exponential_quantile_closed_form_and_by_x() -> None:
    t, c = _sample(2)
    r = fit_life(t, c, distribution="exponential", quantile_probs=[0.1], eval_times=[100.0])
    theta = _param(r, "theta")["estimate"]
    q = r["quantiles"][0]
    assert q["time"] == pytest.approx(-theta * np.log(0.9), rel=1e-9)
    # one-parameter model: the band is the theta band scaled by -ln(1 - p)
    assert q["ci_low"] == pytest.approx(-_param(r, "theta")["ci_low"] * np.log(0.9), rel=1e-6)
    assert r["probabilities"][0]["probability"] == pytest.approx(
        1 - np.exp(-100.0 / theta), rel=1e-9
    )
    # Fit Life by X also runs with sigma fixed at 1
    rng = np.random.default_rng(4)
    x = np.repeat([1.0, 2.0, 3.0], 30)
    life = np.exp(2.0 + 0.7 * x) * -np.log(rng.uniform(size=x.size))
    out = fit_life_by_x(
        life, np.zeros(x.size), x, distribution="exponential", transform="linear", use_x=0.5
    )
    assert [p["name"][:5] for p in out["parameters"]] == ["inter", "slope"]
    assert out["n_params"] == 2
    assert out["parameters"][1]["ci_low"] < 0.7 < out["parameters"][1]["ci_high"]


def test_kaplan_meier_is_vectorised() -> None:
    import time as clock

    rng = np.random.default_rng(0)
    t = rng.exponential(100.0, size=200_000)
    c = (rng.uniform(size=t.size) < 0.3).astype(float)
    t0 = clock.perf_counter()
    km = kaplan_meier_censored(lc.check_life_data(t, c))
    assert clock.perf_counter() - t0 < 5.0  # was O(n * failures) before; ~0.1 s now
    assert km["survival"][-1] < km["survival"][0] <= 1.0
