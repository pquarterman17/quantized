"""Fit Model leverage plots and per-row fit standard errors (calc.stats_lm_leverage).

Oracles: statsmodels OLS (BSD, dev dependency). For a one-column term the
added-variable residuals (``resid(x_t ~ rest)``, ``resid(y ~ rest)``) are the
partial regression plot; our abscissa is ``b_t`` times that, so the two must be
proportional with the full model's slope, and ``sum(x^2)`` must be the Type III
sum of squares of the effect test. ``se_fit`` is statsmodels'
``get_prediction().se_mean``. Agreement is ~1e-10; asserts use 1e-8.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.stats_linear_model import fit_linear_model

sm = pytest.importorskip("statsmodels.formula.api")
pd = pytest.importorskip("pandas")


def _data() -> tuple[list[float], list[str], list[float], list[float]]:
    rng = np.random.default_rng(5)
    n = 40
    g = [["a", "b", "c"][i % 3] for i in range(n)]
    x1 = rng.normal(0, 1, n).tolist()
    x2 = (0.5 * np.array(x1) + rng.normal(0, 1, n)).tolist()
    y = [
        1.0 + {"a": 0, "b": 1, "c": -0.5}[g[i]] + 0.8 * x1[i] - 0.4 * x2[i] + rng.normal(0, 0.5)
        for i in range(n)
    ]
    return y, g, x1, x2


def _fit() -> tuple[dict, pd.DataFrame]:  # type: ignore[type-arg]
    y, g, x1, x2 = _data()
    res = fit_linear_model(
        y,
        [
            {"name": "G", "kind": "nominal", "values": g},
            {"name": "X1", "kind": "continuous", "values": x1},
            {"name": "X2", "kind": "continuous", "values": x2},
        ],
        [["G"], ["X1"], ["X2"]],
    )
    return res, pd.DataFrame({"y": y, "G": g, "X1": x1, "X2": x2})


def test_one_column_term_matches_added_variable_residuals() -> None:
    res, df = _fit()
    plots = {p["effect"]: p for p in res["leverage_plots"]}
    est = {r["term"]: r["estimate"] for r in res["parameter_estimates"]}
    rest = "C(G, Sum) + X2"
    ey = sm.ols(f"y ~ {rest}", df).fit().resid
    ex = sm.ols(f"X1 ~ {rest}", df).fit().resid
    b = est["X1"]
    assert np.allclose(plots["X1"]["x"], b * ex, atol=1e-8)
    assert np.allclose(plots["X1"]["y"], ey, atol=1e-8)  # y-axis is M y exactly


def test_sum_of_squares_of_abscissa_is_effect_ss_for_every_term() -> None:
    res, _ = _fit()
    ss = {e["effect"]: e["ss"] for e in res["effect_tests"]}
    assert len(res["leverage_plots"]) == 3
    for p in res["leverage_plots"]:
        assert float(np.sum(np.square(p["x"]))) == pytest.approx(ss[p["effect"]], rel=1e-9)
        # every plot has one point per fitted row, and y - x is the model residual
        assert np.allclose(np.asarray(p["y"]) - np.asarray(p["x"]), res["residual"], atol=1e-10)


def test_se_fit_matches_statsmodels_and_is_row_aligned_with_missing() -> None:
    y, g, x1, x2 = _data()
    y_missing = list(y)
    y_missing[3] = None  # type: ignore[call-overload]
    res = fit_linear_model(
        y_missing,
        [
            {"name": "G", "kind": "nominal", "values": g},
            {"name": "X1", "kind": "continuous", "values": x1},
        ],
        [["G"], ["X1"]],
    )
    assert res["se_fit"][3] is None and res["n_dropped_missing"] == 1
    df = pd.DataFrame({"y": y_missing, "G": g, "X1": x1}).drop(index=3)
    fit = sm.ols("y ~ C(G, Sum) + X1", df).fit()
    ref = fit.get_prediction().se_mean
    got = [v for v in res["se_fit"] if v is not None]
    assert np.allclose(got, ref, rtol=1e-8)
    from scipy import stats

    assert res["t_crit"] == pytest.approx(stats.t.ppf(0.975, fit.df_resid), rel=1e-12)
