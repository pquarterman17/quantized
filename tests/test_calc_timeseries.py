"""Time-series calc (GAP_AUDIT_9 G13): oracles are closed-form hand values,
statsmodels (test-only; the dev group installs it), a brute-force exact
dynamic-programming segmentation, and the Nile series' published 1898 break."""

from __future__ import annotations

import sys
import warnings

import numpy as np
import pytest

from quantized.calc.ts_acf import acf, correlogram, pacf
from quantized.calc.ts_arima import fit_arima
from quantized.calc.ts_changepoint import detect, segment_cost_fn
from quantized.calc.ts_common import clean_series
from quantized.calc.ts_decompose import decompose
from quantized.calc.ts_stationarity import adf_test, kpss_test, stationarity

pytest.importorskip("statsmodels")


def _walk(seed: int, n: int = 300) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return np.cumsum(rng.normal(size=n)) * 0.1 + rng.normal(size=n)


# ---- input contract ----------------------------------------------------------


def test_clean_series_refuses_bad_input() -> None:
    with pytest.raises(ValueError, match="non-finite"):
        clean_series([1, 2, float("nan")] + [1.0] * 10)
    with pytest.raises(ValueError, match="at least"):
        clean_series([1.0, 2.0])
    y = np.arange(12.0)
    with pytest.raises(ValueError, match="not evenly spaced"):
        clean_series(y, np.r_[np.arange(11.0), 20.0])
    s = clean_series(y, np.r_[np.arange(11.0), 20.0], allow_irregular=True)
    assert s.irregular and s.dt == 1.0
    with pytest.raises(ValueError, match="strictly increasing"):
        clean_series(y, y[::-1])
    assert clean_series(y, np.arange(12) * 0.5).dt == 0.5


# ---- ACF / PACF --------------------------------------------------------------


def test_acf_hand_value() -> None:
    # d = (-4,-2,0,2,4): r1 = (8 + 0 + 0 + 8) / 40, r2 = (0 - 4 + 0) / 40
    np.testing.assert_allclose(acf(np.array([2.0, 4, 6, 8, 10]), 2), [1.0, 0.4, -0.1], atol=1e-15)


def test_acf_pacf_match_statsmodels() -> None:
    from statsmodels.tsa.stattools import acf as sm_acf
    from statsmodels.tsa.stattools import pacf as sm_pacf

    y = _walk(1)
    np.testing.assert_allclose(
        acf(y, 30), sm_acf(y, nlags=30, fft=True, result_object=False), atol=1e-12
    )
    np.testing.assert_allclose(
        pacf(y, 30), sm_pacf(y, nlags=30, method="ywm", result_object=False), atol=1e-12
    )


def test_pacf_of_ar1_cuts_off() -> None:
    rng = np.random.default_rng(7)
    e = rng.normal(size=4000)
    y = np.zeros(4000)
    for t in range(1, 4000):
        y[t] = 0.6 * y[t - 1] + e[t]
    p = pacf(y, 5)
    assert abs(p[1] - 0.6) < 0.05 and np.all(np.abs(p[2:]) < 0.06)


def test_correlogram_bands_and_ljung_box_match_statsmodels() -> None:
    from statsmodels.stats.diagnostic import acorr_ljungbox
    from statsmodels.tsa.stattools import acf as sm_acf

    y = _walk(2)
    c = correlogram(y, 30, 0.05)
    a, ci = sm_acf(y, nlags=30, alpha=0.05, result_object=False)
    np.testing.assert_allclose(c["acf_bartlett_band"], ci[:, 1] - a, atol=1e-12)
    assert c["white_noise_band"] == pytest.approx(1.959963984540054 / np.sqrt(300))
    lb = acorr_ljungbox(y, lags=[10, 30])
    rows = {r["lag"]: r for r in c["ljung_box"]}
    np.testing.assert_allclose([rows[10]["q"], rows[30]["q"]], lb["lb_stat"].to_numpy(), rtol=1e-10)
    np.testing.assert_allclose(
        [rows[10]["p"], rows[30]["p"]], lb["lb_pvalue"].to_numpy(), rtol=1e-6, atol=1e-300
    )


def test_acf_refusals() -> None:
    with pytest.raises(ValueError, match="constant"):
        acf(np.ones(20), 3)
    with pytest.raises(ValueError, match="too large"):
        acf(np.arange(10.0), 10)
    with pytest.raises(ValueError, match="too large"):
        pacf(np.arange(10.0) ** 2, 5)
    with pytest.raises(ValueError, match="alpha"):
        correlogram(_walk(1), 5, 1.5)
    with pytest.raises(ValueError, match="limit"):
        acf(np.random.default_rng(0).normal(size=20_000), 6000)


# ---- stationarity ------------------------------------------------------------


@pytest.mark.parametrize("seed", [3, 4])
@pytest.mark.parametrize("reg", ["c", "ct"])
@pytest.mark.parametrize("nl", ["auto", "legacy", 5])
def test_kpss_matches_statsmodels(seed: int, reg: str, nl: object) -> None:
    from statsmodels.tsa.stattools import kpss

    rng = np.random.default_rng(seed)
    for y in (
        rng.normal(size=300),
        np.cumsum(rng.normal(size=300)),
        0.05 * np.arange(300) + rng.normal(size=300),
    ):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            stat, p, lags, _ = kpss(y, regression=reg, nlags=nl, result_object=False)
        k = kpss_test(y, reg, nl)  # type: ignore[arg-type]
        assert k["statistic"] == pytest.approx(stat, abs=1e-12)
        assert k["lags"] == lags
        assert k["p_value"] == pytest.approx(p, abs=1e-12)


def test_kpss_critical_values_are_the_1992_table() -> None:
    # Kwiatkowski, Phillips, Schmidt & Shin (1992), Table 1.
    lvl = kpss_test(_walk(1), "c")["critical_values"]
    trd = kpss_test(_walk(1), "ct")["critical_values"]
    assert lvl == {"10%": 0.347, "5%": 0.463, "2.5%": 0.574, "1%": 0.739}
    assert trd == {"10%": 0.119, "5%": 0.146, "2.5%": 0.176, "1%": 0.216}


def test_kpss_p_value_bounds() -> None:
    assert kpss_test(np.random.default_rng(0).normal(size=400))["p_bound"] == "greater"
    k = kpss_test(np.cumsum(np.random.default_rng(0).normal(size=400)))
    assert k["p_bound"] == "less" and k["p_value"] == 0.01


def test_adf_matches_statsmodels_and_verdicts() -> None:
    from statsmodels.tsa.stattools import adfuller

    rng = np.random.default_rng(3)
    noise, walk = rng.normal(size=300), np.cumsum(rng.normal(size=300))
    for y in (noise, walk):
        ref = adfuller(y, regression="c", autolag="AIC", result_object=False)
        a = adf_test(y)
        assert a["statistic"] == pytest.approx(ref[0], abs=1e-12) and a["p_value"] == pytest.approx(
            ref[1], abs=1e-12
        )
        assert a["lags"] == ref[2] and a["critical_values"]["5%"] == pytest.approx(ref[4]["5%"])
    assert stationarity(noise)["verdict"].startswith("stationary")
    assert stationarity(walk)["verdict"].startswith("non-stationary")
    assert "adf" not in stationarity(noise, "kpss") and "kpss" not in stationarity(noise, "adf")


def test_stationarity_refusals(monkeypatch: pytest.MonkeyPatch) -> None:
    for kw in ({"tests": "x"}, {"regression": "ctt"}, {"alpha": 0.0}):
        with pytest.raises(ValueError):
            stationarity(_walk(1), **kw)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        kpss_test(np.ones(30))
    monkeypatch.setitem(sys.modules, "statsmodels.tsa.stattools", None)
    with pytest.raises(RuntimeError, match=r"quantized-lab\[stats\]"):
        adf_test(_walk(1))


# ---- decomposition -----------------------------------------------------------


def test_decompose_hand_value() -> None:
    d = decompose(np.tile([1.0, 2.0, 3.0], 4), 3)
    np.testing.assert_allclose(d["seasonal_figure"], [-1, 0, 1], atol=1e-12)
    tr = np.array(d["trend"], dtype=float)
    assert np.isnan(tr[0]) and np.isnan(tr[-1]) and np.allclose(tr[1:-1], 2.0)
    assert d["seasonal_strength"] == pytest.approx(1.0)


@pytest.mark.parametrize("period", [4, 7, 12])
@pytest.mark.parametrize("model", ["additive", "multiplicative"])
def test_decompose_matches_statsmodels(period: int, model: str) -> None:
    from statsmodels.tsa.seasonal import seasonal_decompose

    rng = np.random.default_rng(period)
    t = np.arange(10 * period)
    y = 20 + 0.1 * t + 3 * np.sin(2 * np.pi * t / period) + rng.normal(0, 0.3, t.size)
    d = decompose(y, period, model)
    ref = seasonal_decompose(y, model=model, period=period)
    np.testing.assert_allclose(d["trend"], ref.trend, atol=1e-10, equal_nan=True)
    np.testing.assert_allclose(d["seasonal"], ref.seasonal, atol=1e-10)
    np.testing.assert_allclose(d["residual"], ref.resid, atol=1e-10, equal_nan=True)


def test_decompose_refusals() -> None:
    y = np.arange(1.0, 25.0)
    with pytest.raises(ValueError, match="two full periods"):
        decompose(y, 13)
    with pytest.raises(ValueError, match="period"):
        decompose(y, 1)
    with pytest.raises(ValueError, match="positive"):
        decompose(y - 5, 4, "multiplicative")
    with pytest.raises(ValueError, match="model"):
        decompose(y, 4, "x")


# ---- change points -----------------------------------------------------------


def _dp_segmentation(y: np.ndarray, cost: str, pen: float, ms: int, sigma2: float) -> list[int]:
    """Exact optimal partition by O(n^2) dynamic programming (the PELT oracle)."""
    n = y.size
    f = segment_cost_fn(y, cost, sigma2)
    best = [-pen] + [np.inf] * n
    prev = [0] * (n + 1)
    for t in range(ms, n + 1):
        for s in range(t - ms + 1):
            if np.isfinite(best[s]):
                v = best[s] + float(f(s, t)) + pen
                if v < best[t] - 1e-12:
                    best[t], prev[t] = v, s
    cps, t = [], n
    while t > 0:
        s = prev[t]
        if s > 0:
            cps.append(s)
        t = s
    return sorted(cps)


@pytest.mark.parametrize("cost", ["mean", "var", "meanvar"])
@pytest.mark.parametrize("min_size", [2, 3, 5])
def test_pelt_equals_exact_dp(cost: str, min_size: int) -> None:
    for seed in range(12):
        rng = np.random.default_rng(seed)
        n = int(rng.integers(30, 90))
        y = np.concatenate(
            [
                rng.normal(0, 1, n // 3),
                rng.normal(2.5, 1, n // 3),
                rng.normal(0, 2.5, n - 2 * (n // 3)),
            ]
        )
        r = detect(y, "pelt", cost, "bic", min_size=min_size)
        assert r["changepoints"] == _dp_segmentation(
            y, cost, r["penalty_used"], min_size, r["sigma2"] or 1.0
        )


def test_nile_break_1899() -> None:
    # Cobb (1978) and later work place the Nile flow break at 1898; the first
    # sample of the new regime is 1899.
    from statsmodels.datasets import nile

    d = nile.load_pandas().data
    for method in ("pelt", "binseg"):
        r = detect(d["volume"].to_numpy(), method, "mean", "mbic")
        assert [int(d["year"][c]) for c in r["changepoints"]] == [1899]


def test_changepoint_variance_and_binseg_options() -> None:
    rng = np.random.default_rng(0)
    y = np.concatenate([rng.normal(0, 1, 150), rng.normal(0, 4, 150)])
    assert abs(detect(y, cost="var")["changepoints"][0] - 150) <= 5
    steps = np.repeat([0.0, 4.0, 0.0, 4.0], 60) + rng.normal(0, 0.5, 240)
    assert len(detect(steps, "binseg")["changepoints"]) == 3
    assert len(detect(steps, "binseg", max_changes=1)["changepoints"]) == 1
    assert detect(steps, "pelt", penalty="value", penalty_value=1e9)["changepoints"] == []
    big = detect(steps, "pelt", penalty="aic")
    assert len(big["changepoints"]) >= 3 and big["segments"][0]["start"] == 0
    assert sum(s["n"] for s in big["segments"]) == 240


def test_changepoint_refusals() -> None:
    y = np.arange(30.0) ** 2
    for kw in (
        {"method": "x"},
        {"cost": "x"},
        {"min_size": 1},
        {"max_changes": 0},
        {"penalty": "x"},
        {"penalty": "value"},
        {"method": "pelt", "max_changes": 2},
        {"sigma": -1.0},
    ):
        with pytest.raises(ValueError):
            detect(y, **kw)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="constant"):
        detect(np.ones(30))
    with pytest.raises(ValueError, match="points"):
        detect(np.arange(6.0), min_size=4)
    with pytest.raises(ValueError, match="limited to"):
        detect(np.arange(50_001.0))


# ---- ARIMA -------------------------------------------------------------------


def test_arima_ar1_forecast_follows_the_ar_recursion() -> None:
    rng = np.random.default_rng(5)
    e = rng.normal(size=600)
    y = np.zeros(600)
    for t in range(1, 600):
        y[t] = 0.7 * y[t - 1] + e[t]
    y += 10.0
    r = fit_arima(y, (1, 0, 0), steps=4)
    mu, phi = r["params"][0]["estimate"], r["params"][1]["estimate"]
    # independent of statsmodels: the exact MLE of a long AR(1) is close to OLS, and the
    # h-step forecast is mu + phi^h (y_T - mu)
    ols = np.polyfit(y[:-1], y[1:], 1)[0]
    assert abs(phi - ols) < 0.02 and abs(phi - 0.7) < 0.08
    expect = [mu + phi**h * (y[-1] - mu) for h in range(1, 5)]
    np.testing.assert_allclose(r["forecast"]["mean"], expect, atol=1e-6)
    lo, hi = np.array(r["forecast"]["lower"]), np.array(r["forecast"]["upper"])
    assert (
        np.all(lo < np.array(expect))
        and np.all(hi > np.array(expect))
        and np.all(np.diff(hi - lo) > 0)
    )
    assert r["aic"] == pytest.approx(-2 * r["loglik"] + 2 * 3)


@pytest.mark.parametrize("factor", [1e-6, 1e4])
def test_arima_is_scale_equivariant(factor: float) -> None:
    # Change of variables: y -> c y multiplies const and the forecast by c and sigma2 by c^2,
    # leaves the AR/MA terms alone and moves the log-likelihood by -n_eff ln c (AIC by
    # +2 n_eff ln c). This also proves the internal rescaling is undone exactly, for a
    # 1e-6-sized pressure log as for kilo-units.
    rng = np.random.default_rng(11)
    e = rng.normal(size=400)
    y = np.zeros(400)
    for t in range(1, 400):
        y[t] = 0.6 * y[t - 1] + e[t]
    y += 3.0
    a = fit_arima(y, (1, 0, 0), steps=3)
    b = fit_arima(y * factor, (1, 0, 0), steps=3)
    pa = {q["name"]: q for q in a["params"]}
    pb = {q["name"]: q for q in b["params"]}
    assert pb["ar.L1"]["estimate"] == pytest.approx(pa["ar.L1"]["estimate"], abs=2e-3)
    assert pb["const"]["estimate"] == pytest.approx(pa["const"]["estimate"] * factor, rel=2e-3)
    assert pb["sigma2"]["estimate"] == pytest.approx(pa["sigma2"]["estimate"] * factor**2, rel=2e-3)
    assert pb["const"]["se"] == pytest.approx(pa["const"]["se"] * factor, rel=2e-3)
    np.testing.assert_allclose(
        b["forecast"]["mean"], np.array(a["forecast"]["mean"]) * factor, rtol=2e-3
    )
    assert b["aic"] - a["aic"] == pytest.approx(2 * 400 * np.log(factor), abs=0.05)
    assert b["loglik"] - a["loglik"] == pytest.approx(-400 * np.log(factor), abs=0.05)
    assert not b["notes"]


def test_arima_differenced_and_refusals(monkeypatch: pytest.MonkeyPatch) -> None:
    y = np.cumsum(np.random.default_rng(1).normal(size=200))
    r = fit_arima(y, (0, 1, 1), steps=3)
    assert r["trend"] == "n" and len(r["forecast"]["mean"]) == 3 and len(r["fitted"]) == 200
    assert (
        np.isnan(r["fitted"][0]) and np.isfinite(r["fitted"][1:]).all()
    )  # the diffuse start is not a prediction
    for order, kw in (
        ((6, 0, 0), {}),
        ((1, 3, 0), {}),
        ((1, 1, 0), {"trend": "c"}),
        ((1, 0, 0), {"trend": "x"}),
        ((1, 0, 0), {"alpha": 2.0}),
        ((1, 0, 0), {"steps": -1}),
    ):
        with pytest.raises(ValueError):
            fit_arima(y, order, **kw)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="constant"):
        fit_arima(np.full(40, 3.0), (1, 0, 0))
    with pytest.raises(ValueError, match="too few"):
        fit_arima(y[:10], (1, 0, 0))
    monkeypatch.setitem(sys.modules, "statsmodels.tsa.arima.model", None)
    with pytest.raises(RuntimeError, match=r"quantized-lab\[stats\]"):
        fit_arima(y, (1, 0, 0))
