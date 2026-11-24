"""Fit Model (GAP_AUDIT_9 G1): calc.stats_linear_model against oracles.

Oracles:
* statsmodels OLS + ``anova_lm(typ=3)`` with ``C(x, Sum)`` contrasts (BSD,
  a dev dependency) for parameter estimates, SEs, the whole-model table and
  the Type III effect tests;
* NIST StRD linear least-squares certified values (Longley, Pontius;
  https://www.itl.nist.gov/div898/strd/lls/lls.shtml, public-domain US
  government data, copied verbatim into ``tests/fixtures/nist_strd``);
* the definition of a least-squares mean, recomputed independently through
  :func:`predict` (the average of the model's cell predictions).

Tolerances are measured: NIST agreement is ~1e-11 relative (Longley's x1
estimate is the worst at 1.4e-11) and statsmodels agreement ~1e-12, so the
asserts use 1e-9 (NIST) and 1e-8 (statsmodels).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.calc.stats_linear_model import fit_linear_model, predict

sm = pytest.importorskip("statsmodels.formula.api")
anova = pytest.importorskip("statsmodels.stats.anova")
pd = pytest.importorskip("pandas")

NIST = Path(__file__).parent / "fixtures" / "nist_strd"


def _nist(name: str) -> np.ndarray:
    lines = (NIST / f"{name}.dat").read_text().splitlines()
    start = [k for k, ln in enumerate(lines) if ln.strip().startswith("Data:") and " y " in ln][-1]
    return np.array([[float(v) for v in ln.split()] for ln in lines[start + 1 :] if ln.strip()])


def _cont(name: str, values: np.ndarray) -> dict[str, object]:
    return {"name": name, "kind": "continuous", "values": values.tolist()}


def _nom(name: str, values: list[str]) -> dict[str, object]:
    return {"name": name, "kind": "nominal", "values": values}


# ---------------------------------------------------------------- NIST StRD


def test_nist_longley_certified_values() -> None:
    d = _nist("Longley")
    factors = [_cont(f"x{j}", d[:, j]) for j in range(1, 7)]
    res = fit_linear_model(d[:, 0].tolist(), factors, [[f"x{j}"] for j in range(1, 7)])
    est = [-3482258.63459582, 15.0618722713733, -0.358191792925910e-01, -2.02022980381683,
           -1.03322686717359, -0.511041056535807e-01, 1829.15146461355]
    sd = [890420.383607373, 84.9149257747669, 0.334910077722432e-01, 0.488399681651699,
          0.214274163161675, 0.226073200069370, 455.478499142212]
    for row, e, s in zip(res["parameter_estimates"], est, sd, strict=True):
        assert row["estimate"] == pytest.approx(e, rel=1e-9)
        assert row["se"] == pytest.approx(s, rel=1e-9)
    assert res["summary"]["rmse"] == pytest.approx(304.854073561965, rel=1e-9)
    assert res["summary"]["r2"] == pytest.approx(0.995479004577296, rel=1e-12)
    model, err = res["anova"][0], res["anova"][1]
    assert model["ss"] == pytest.approx(184172401.944494, rel=1e-9)
    assert err["ss"] == pytest.approx(836424.055505915, rel=1e-9)
    assert model["f"] == pytest.approx(330.285339234588, rel=1e-9)


def test_nist_pontius_quadratic_uncentered() -> None:
    d = _nist("Pontius")
    res = fit_linear_model(d[:, 0].tolist(), [_cont("x", d[:, 1])], [["x"], ["x", "x"]],
                           center_polynomials=False)
    est = [0.673565789473684e-03, 0.732059160401003e-06, -0.316081871345029e-14]
    sd = [0.107938612033077e-03, 0.157817399981659e-09, 0.486652849992036e-16]
    names = [r["term"] for r in res["parameter_estimates"]]
    assert names == ["Intercept", "x", "x*x"]
    for row, e, s in zip(res["parameter_estimates"], est, sd, strict=True):
        assert row["estimate"] == pytest.approx(e, rel=1e-9)
        assert row["se"] == pytest.approx(s, rel=1e-9)
    assert res["summary"]["rmse"] == pytest.approx(0.205177424076185e-03, rel=1e-9)
    assert res["anova"][0]["ss"] == pytest.approx(15.6040343244198, rel=1e-9)


def test_pontius_centering_changes_parameters_not_fit() -> None:
    d = _nist("Pontius")
    args = (d[:, 0].tolist(), [_cont("x", d[:, 1])], [["x"], ["x", "x"]])
    raw = fit_linear_model(*args, center_polynomials=False)
    cen = fit_linear_model(*args)
    assert cen["parameter_estimates"][2]["term"].startswith("(x-")
    np.testing.assert_allclose(cen["predicted"], raw["predicted"], rtol=1e-9)
    assert cen["summary"]["r2"] == pytest.approx(raw["summary"]["r2"], rel=1e-12)
    # the quadratic coefficient is the same either way; the linear one moves
    assert cen["parameter_estimates"][2]["estimate"] == pytest.approx(
        raw["parameter_estimates"][2]["estimate"], rel=1e-8)


# ------------------------------------------------------- statsmodels oracle


def _unbalanced_two_way() -> tuple[pd.DataFrame, list[dict[str, object]]]:
    rng = np.random.default_rng(20261124)
    a_levels, b_levels = ["a1", "a2", "a3"], ["b1", "b2"]
    counts = {("a1", "b1"): 3, ("a1", "b2"): 5, ("a2", "b1"): 2, ("a2", "b2"): 4,
              ("a3", "b1"): 6, ("a3", "b2"): 3}
    eff_a = {"a1": 0.0, "a2": 1.5, "a3": -0.7}
    eff_b = {"b1": 0.0, "b2": 0.9}
    inter = {("a2", "b2"): 1.2, ("a3", "b1"): -0.8}
    rows = []
    for a in a_levels:
        for b in b_levels:
            for _ in range(counts[(a, b)]):
                y = 10 + eff_a[a] + eff_b[b] + inter.get((a, b), 0.0) + rng.normal(0, 0.5)
                rows.append((a, b, y))
    df = pd.DataFrame(rows, columns=["A", "B", "y"])
    return df, [_nom("A", df.A.tolist()), _nom("B", df.B.tolist())]


def _compare(res: dict, fit, table: pd.DataFrame, effect_rows: dict[str, str],
             skip_intercept: bool = False) -> None:
    """``skip_intercept``: the oracle formula centres a main effect too (patsy
    cannot express "raw main effect, centred inside a crossed term" without
    re-coding the nominal factor full-rank), which shifts only the intercept."""
    k = 1 if skip_intercept else 0
    ests = res["parameter_estimates"][k:]
    np.testing.assert_allclose([r["estimate"] for r in ests], fit.params.to_numpy()[k:],
                               rtol=1e-8, atol=1e-10)
    np.testing.assert_allclose([r["se"] for r in ests], fit.bse.to_numpy()[k:], rtol=1e-8)
    np.testing.assert_allclose([r["p"] for r in ests], fit.pvalues.to_numpy()[k:],
                               rtol=1e-6, atol=1e-14)
    assert res["summary"]["r2"] == pytest.approx(fit.rsquared, rel=1e-10)
    assert res["summary"]["adj_r2"] == pytest.approx(fit.rsquared_adj, rel=1e-10)
    assert res["summary"]["rmse"] == pytest.approx(np.sqrt(fit.mse_resid), rel=1e-10)
    assert res["anova"][0]["f"] == pytest.approx(fit.fvalue, rel=1e-9)
    assert res["anova"][0]["p"] == pytest.approx(fit.f_pvalue, rel=1e-6, abs=1e-14)
    got = {e["effect"]: e for e in res["effect_tests"]}
    for ours, theirs in effect_rows.items():
        row = table.loc[theirs]
        assert got[ours]["ss"] == pytest.approx(row["sum_sq"], rel=1e-8)
        assert got[ours]["df"] == int(row["df"])
        assert got[ours]["f"] == pytest.approx(row["F"], rel=1e-8)
        assert got[ours]["p"] == pytest.approx(row["PR(>F)"], rel=1e-6, abs=1e-14)


def test_unbalanced_two_factor_interaction_matches_statsmodels_type3() -> None:
    df, factors = _unbalanced_two_way()
    res = fit_linear_model(df.y.tolist(), factors, [["A"], ["B"], ["A", "B"]])
    fit = sm.ols("y ~ C(A, Sum) * C(B, Sum)", data=df).fit()
    table = anova.anova_lm(fit, typ=3)
    _compare(res, fit, table, {"A": "C(A, Sum)", "B": "C(B, Sum)", "A*B": "C(A, Sum):C(B, Sum)"})
    assert [r["term"] for r in res["parameter_estimates"]] == [
        "Intercept", "A[a1]", "A[a2]", "B[b1]", "A[a1]*B[b1]", "A[a2]*B[b1]"]
    # unbalanced: Type III differs from the sequential (Type I) SS for A
    seq = anova.anova_lm(fit, typ=1)
    assert abs(seq.loc["C(A, Sum)", "sum_sq"] - res["effect_tests"][0]["ss"]) > 1e-3


def test_ancova_with_centered_interaction_matches_statsmodels() -> None:
    rng = np.random.default_rng(7)
    n = 23
    a = rng.choice(["s1", "s2", "s3"], size=n).tolist()
    x = rng.uniform(300, 700, size=n)
    shift = np.array([{"s1": 0, "s2": 1, "s3": -1}[v] for v in a])
    y = 2 + 0.01 * x + shift + rng.normal(0, 0.3, n)
    df = pd.DataFrame({"A": a, "x": x, "y": y})
    df["xc"] = df.x - df.x.mean()
    res = fit_linear_model(y.tolist(), [_nom("A", a), _cont("x", x)], [["A"], ["x"], ["A", "x"]])
    fit = sm.ols("y ~ C(A, Sum) * xc", data=df).fit()
    table = anova.anova_lm(fit, typ=3)
    _compare(res, fit, table, {"A": "C(A, Sum)", "x": "xc", "A*x": "C(A, Sum):xc"},
             skip_intercept=True)
    raw = fit_linear_model(y.tolist(), [_nom("A", a), _cont("x", x)], [["A"], ["x"], ["A", "x"]],
                           center_polynomials=False)
    fit_raw = sm.ols("y ~ C(A, Sum) * x", data=df).fit()
    _compare(raw, fit_raw, anova.anova_lm(fit_raw, typ=3),
             {"A": "C(A, Sum)", "x": "x", "A*x": "C(A, Sum):x"})


def test_three_factor_with_quadratic_matches_statsmodels() -> None:
    rng = np.random.default_rng(11)
    n = 40
    sub = rng.choice(["Si", "MgO", "STO"], size=n).tolist()
    temp = rng.uniform(500, 800, size=n)
    pres = rng.uniform(1, 10, size=n)
    y = 3.9 + 1e-4 * temp - 2e-7 * (temp - 650) ** 2 + 0.002 * pres + rng.normal(0, 0.002, n)
    df = pd.DataFrame({"S": sub, "temp": temp, "pres": pres, "y": y})
    df["Tc"] = df.temp - df.temp.mean()
    df["Pc"] = df.pres - df.pres.mean()
    terms = [["S"], ["T"], ["P"], ["T", "T"], ["T", "P"]]
    res = fit_linear_model(y.tolist(), [_nom("S", sub), _cont("T", temp), _cont("P", pres)], terms)
    fit = sm.ols("y ~ C(S, Sum) + Tc + Pc + I(Tc**2) + Tc:Pc", data=df).fit()
    _compare(res, fit, anova.anova_lm(fit, typ=3),
             {"S": "C(S, Sum)", "T": "Tc", "P": "Pc", "T*T": "I(Tc ** 2)", "T*P": "Tc:Pc"},
             skip_intercept=True)


# ------------------------------------------------------------- LS means


def test_ls_means_are_average_cell_predictions() -> None:
    df, factors = _unbalanced_two_way()
    res = fit_linear_model(df.y.tolist(), factors, [["A"], ["B"], ["A", "B"]])
    by_effect = {t["effect"]: t for t in res["ls_means"]}
    assert set(by_effect) == {"A", "B", "A*B"}
    cells = predict(res["model"], {"A": ["a1", "a1", "a2", "a2", "a3", "a3"],
                                   "B": ["b1", "b2"] * 3})["predicted"]
    for i, row in enumerate(by_effect["A"]["rows"]):
        assert row["ls_mean"] == pytest.approx((cells[2 * i] + cells[2 * i + 1]) / 2, rel=1e-12)
    # saturated cell model: the A*B LS means are the raw cell means
    for row in by_effect["A*B"]["rows"]:
        assert row["ls_mean"] == pytest.approx(row["mean"], rel=1e-10)
        assert row["se"] == pytest.approx(res["summary"]["rmse"] / np.sqrt(row["n"]), rel=1e-10)
    # and the unbalanced design makes the A LS means differ from the raw means
    assert any(abs(r["ls_mean"] - r["mean"]) > 1e-3 for r in by_effect["A"]["rows"])


def test_ls_means_hold_covariate_at_its_mean() -> None:
    a = ["p", "p", "p", "q", "q", "q", "q"]
    x = np.array([1.0, 2, 3, 4, 5, 6, 7])
    y = np.array([1.0, 2.1, 2.9, 5.2, 6.1, 6.8, 8.1])
    res = fit_linear_model(y.tolist(), [_nom("A", a), _cont("x", x)], [["A"], ["x"]])
    lsm = res["ls_means"][0]["rows"]
    expect = predict(res["model"], {"A": ["p", "q"], "x": [x.mean(), x.mean()]})
    assert [r["ls_mean"] for r in lsm] == pytest.approx(expect["predicted"], rel=1e-12)
    assert [r["se"] for r in lsm] == pytest.approx(expect["se_mean"], rel=1e-12)


# ---------------------------------------------------- data handling + predict


def test_missing_rows_dropped_listwise_and_aligned() -> None:
    df, factors = _unbalanced_two_way()
    y = df.y.tolist()
    y[0] = None
    factors[1]["values"][4] = None
    res = fit_linear_model(y, factors, [["A"], ["B"]])
    assert res["n"] == len(y) - 2 and res["n_dropped_missing"] == 2
    assert res["predicted"][0] is None and res["residual"][4] is None
    resid = [r for r in res["residual"] if r is not None]
    assert sum(r * r for r in resid) == pytest.approx(res["anova"][1]["ss"], rel=1e-10)


def test_level_order_controls_the_minus_one_level() -> None:
    df, factors = _unbalanced_two_way()
    factors[0]["levels"] = ["a3", "a2", "a1"]
    res = fit_linear_model(df.y.tolist(), factors, [["A"], ["B"]])
    assert [r["term"] for r in res["parameter_estimates"]][1:3] == ["A[a3]", "A[a2]"]


def test_predict_round_trips_fitted_values_and_refuses_unknown_level() -> None:
    df, factors = _unbalanced_two_way()
    res = fit_linear_model(df.y.tolist(), factors, [["A"], ["B"], ["A", "B"]])
    out = predict(res["model"], {"A": df.A.tolist(), "B": df.B.tolist()})
    np.testing.assert_allclose(out["predicted"], res["predicted"], rtol=1e-12)
    assert out["df_error"] == len(df) - 6
    with pytest.raises(ValueError, match="not a fitted level"):
        predict(res["model"], {"A": ["zz"], "B": ["b1"]})
    with pytest.raises(ValueError, match="missing"):
        predict(res["model"], {"A": ["a1"]})


# ------------------------------------------------------------- refusals


def test_refuses_rank_deficiency_naming_the_term() -> None:
    a = ["a1", "a1", "a2", "a2", "a1", "a2"]
    b = ["b1", "b2", "b1", "b1", "b1", "b1"]  # cell a2/b2 empty
    y = [1.0, 2, 3, 4, 5, 6]
    with pytest.raises(ValueError, match="rank deficient: term 'A\\*B'"):
        fit_linear_model(y, [_nom("A", a), _nom("B", b)], [["A"], ["B"], ["A", "B"]])
    x = np.arange(6.0)
    with pytest.raises(ValueError, match="rank deficient: term 'z'"):
        fit_linear_model(y, [_cont("x", x), _cont("z", 2 * x + 1)], [["x"], ["z"]])


def test_refuses_single_level_factor() -> None:
    with pytest.raises(ValueError, match="1 level\\(s\\).*at least 2"):
        fit_linear_model([1.0, 2, 3], [_nom("A", ["a", "a", "a"])], [["A"]])
    # a second level that only occurs on a missing-response row does not count
    with pytest.raises(ValueError, match="at least 2"):
        fit_linear_model([1.0, 2, None], [_nom("A", ["a", "a", "b"])], [["A"]])


def test_refuses_zero_residual_df() -> None:
    with pytest.raises(ValueError, match="0 residual degrees of freedom"):
        fit_linear_model([1.0, 2, 4], [_cont("x", np.array([0.0, 1, 2]))], [["x"], ["x", "x"]])


def test_refuses_malformed_models() -> None:
    a = _nom("A", ["a", "b", "a", "b"])
    y = [1.0, 2, 3, 4]
    with pytest.raises(ValueError, match="repeats the nominal factor"):
        fit_linear_model(y, [a], [["A", "A"]])
    with pytest.raises(ValueError, match="appears twice"):
        fit_linear_model(y, [a, _cont("x", np.arange(4.0))], [["A", "x"], ["x", "A"]])
    with pytest.raises(ValueError, match="no effects"):
        fit_linear_model(y, [a], [])
    with pytest.raises(ValueError, match="unknown factor"):
        fit_linear_model(y, [a], [["B"]])
