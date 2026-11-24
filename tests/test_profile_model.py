"""Prediction / contour profiler math (GAP_AUDIT_9 G7, calc/profile_model.py).

Oracle: statsmodels ``OLSResults.get_prediction(...).summary_frame(alpha)``
mean CI (the CI of the mean response, what the profiler draws) on the same OLS
model, plus pointwise equality with ``predict()`` and the desirability maths.
Predictions are invariant to the coding (effect coding, centred polynomials)
as long as the column space matches, so the oracle uses a raw-x formula.
Measured agreement is ~1e-12; the asserts use 1e-9.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.profile_desirability import desirability, maximize_desirability
from quantized.calc.profile_model import contour_grid, profile_model
from quantized.calc.stats_linear_model import fit_linear_model, predict

smf = pytest.importorskip("statsmodels.formula.api")
pd = pytest.importorskip("pandas")


def _data() -> pd.DataFrame:
    rng = np.random.default_rng(20261124)
    n = 36
    t = rng.uniform(300, 900, n)
    p = rng.uniform(1, 5, n)
    g = rng.choice(["a", "b", "c"], n)
    eff = {"a": 0.0, "b": 2.0, "c": -1.0}
    y = 5 + 0.01 * t - 4e-6 * t**2 + 1.5 * p + np.array([eff[v] for v in g]) + rng.normal(0, 0.3, n)
    return pd.DataFrame({"t": t, "p": p, "g": g, "y": y})


def _fit(df: pd.DataFrame) -> dict:
    factors = [
        {"name": "t", "kind": "continuous", "values": df.t.tolist()},
        {"name": "p", "kind": "continuous", "values": df.p.tolist()},
        {"name": "g", "kind": "nominal", "values": df.g.tolist()},
    ]
    terms = [["t"], ["t", "t"], ["p"], ["g"]]
    return fit_linear_model(df.y.tolist(), factors, terms, response_name="y")


def test_profile_equals_predict_pointwise_and_ci_matches_statsmodels() -> None:
    df = _data()
    res = _fit(df)
    model = res["model"]
    cur = {"t": 612.5, "p": 2.2, "g": "b"}
    prof = profile_model(model, cur, n_points=25, alpha=0.1)
    ols = smf.ols("y ~ t + I(t**2) + p + C(g, Sum)", df).fit()

    def oracle(t, p, g):
        frame = pd.DataFrame({"t": t, "p": p, "g": g})
        return ols.get_prediction(frame).summary_frame(alpha=0.1)

    for fac in prof["factors"]:
        n = len(fac["predicted"])
        if fac["kind"] == "continuous":
            xs = np.asarray(fac["x"])
            col = df[fac["name"]]
            assert xs[0] == pytest.approx(col.min()) and xs[-1] == pytest.approx(col.max())
            cols = {"t": [cur["t"]] * n, "p": [cur["p"]] * n, "g": [cur["g"]] * n}
            cols[fac["name"]] = xs.tolist()
        else:
            cols = {"t": [cur["t"]] * n, "p": [cur["p"]] * n, "g": fac["levels"]}
        want = predict(model, cols)
        np.testing.assert_allclose(fac["predicted"], want["predicted"], rtol=1e-14)
        np.testing.assert_allclose(fac["se"], want["se_mean"], rtol=1e-12)
        sf = oracle(cols["t"], cols["p"], cols["g"])
        np.testing.assert_allclose(fac["predicted"], sf["mean"], rtol=1e-9)
        np.testing.assert_allclose(fac["se"], sf["mean_se"], rtol=1e-9)
        np.testing.assert_allclose(fac["lower"], sf["mean_ci_lower"], rtol=1e-9)
        np.testing.assert_allclose(fac["upper"], sf["mean_ci_upper"], rtol=1e-9)
    c = prof["current"]
    sf = oracle([cur["t"]], [cur["p"]], [cur["g"]])
    assert c["predicted"] == pytest.approx(sf["mean"][0], rel=1e-9)
    assert c["lower"] == pytest.approx(sf["mean_ci_lower"][0], rel=1e-9)
    assert c["upper"] == pytest.approx(sf["mean_ci_upper"][0], rel=1e-9)
    assert prof["df_error"] == ols.df_resid


def test_default_current_is_mean_and_averaged_level() -> None:
    model = _fit(_data())["model"]
    prof = profile_model(model)
    cur = prof["current"]["settings"]
    assert cur["g"] is None
    assert cur["t"] == pytest.approx([f["mean"] for f in model["factors"] if f["name"] == "t"][0])
    want = predict(model, {"t": [cur["t"]], "p": [cur["p"]], "g": [None]})
    # 1 ulp apart: BLAS rounding depends on the batch size
    assert prof["current"]["predicted"] == pytest.approx(want["predicted"][0], rel=1e-14)


def test_contour_grid_matches_predict() -> None:
    model = _fit(_data())["model"]
    g = contour_grid(model, "t", "p", {"g": "c"}, n_x=7, n_y=5)
    assert np.shape(g["z"]) == (5, 7)
    for j in (0, 2, 4):
        for i in (0, 3, 6):
            want = predict(model, {"t": [g["x"][i]], "p": [g["y"][j]], "g": ["c"]})
            assert g["z"][j][i] == pytest.approx(want["predicted"][0], rel=1e-14)
            assert g["se"][j][i] == pytest.approx(want["se_mean"][0], rel=1e-12)


def test_refusals() -> None:
    model = _fit(_data())["model"]
    with pytest.raises(ValueError, match="nominal"):
        contour_grid(model, "t", "g")
    with pytest.raises(ValueError, match="different"):
        contour_grid(model, "t", "t")
    with pytest.raises(ValueError, match="not a fitted level"):
        profile_model(model, {"g": "zzz"})
    with pytest.raises(ValueError, match="alpha"):
        profile_model(model, alpha=1.5)
    old = {k: v for k, v in model.items() if k != "ranges"}
    with pytest.raises(ValueError, match="refit"):
        profile_model(old)
    assert profile_model(old, ranges={"t": (1, 2), "p": (0, 1)})["factors"][0]["range"] == [1, 2]


def test_desirability_shapes() -> None:
    y = [0.0, 5.0, 10.0, 15.0, 20.0]
    np.testing.assert_allclose(desirability(y, "maximize", 5, 15), [0, 0, 0.5, 1, 1])
    np.testing.assert_allclose(desirability(y, "minimize", 5, 15), [1, 1, 0.5, 0, 0])
    np.testing.assert_allclose(desirability(y, "target", 0, 20, 10), [0, 0.5, 1, 0.5, 0])
    with pytest.raises(ValueError):
        desirability(y, "target", 0, 20, 25)
    with pytest.raises(ValueError):
        desirability(y, "maximize", 5, 5)


def test_maximize_desirability_finds_grid_optimum() -> None:
    model = _fit(_data())["model"]
    best = maximize_desirability(model, {"t": (302.0, 897.0), "p": (1.0, 5.0)}, "maximize", 5, 40)
    # Response rises with p and level b has the largest effect; t is concave.
    assert best["settings"]["g"] == "b" and best["settings"]["p"] == pytest.approx(5.0)
    got = predict(model, {k: [v] for k, v in best["settings"].items()})["predicted"][0]
    assert got == pytest.approx(best["predicted"])
    # No grid point beats it.
    tt = np.linspace(302.0, 897.0, 41)
    allp = predict(model, {"t": tt.tolist(), "p": [5.0] * 41, "g": ["b"] * 41})["predicted"]
    assert best["predicted"] >= max(allp) - 1e-9
    rg = {"t": (302.0, 897.0), "p": (1.0, 5.0)}
    tgt = maximize_desirability(model, rg, "target", 0, 40, 20.0)
    assert abs(tgt["predicted"] - 20.0) < 1.0


def test_profile_with_goal_adds_desirability() -> None:
    model = _fit(_data())["model"]
    prof = profile_model(model, goal={"goal": "maximize", "lower": 5, "upper": 40})
    want = desirability(prof["factors"][0]["predicted"], "maximize", 5, 40)
    np.testing.assert_allclose(prof["factors"][0]["desirability"], want)
    assert 0 <= prof["current"]["desirability"] <= 1
