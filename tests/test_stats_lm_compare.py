"""Fit Model LS-means comparisons (calc.stats_lm_compare) against statsmodels.

Oracles (statsmodels is BSD, a dev dependency):
* one-way: ``statsmodels.stats.multicomp.pairwise_tukeyhsd`` (Tukey-Kramer for
  unbalanced data) - adjusted p, mean differences and the HSD interval;
* multi-factor: ``OLS(...).t_test(contrast)`` on the same effect-coded fit,
  one contrast per pair (unadjusted t, p, SE, CI), and Bonferroni by
  multiplying those p values.
Measured agreement is ~1e-10 (studentized-range quadrature in scipy vs
statsmodels' own), so the asserts use 1e-6 on p and 1e-8 on the rest.
"""

from __future__ import annotations

import itertools

import numpy as np
import pytest

from quantized.calc.stats_linear_model import fit_linear_model
from quantized.calc.stats_lm_compare import compare_ls_means

sm = pytest.importorskip("statsmodels.formula.api")
multicomp = pytest.importorskip("statsmodels.stats.multicomp")
pd = pytest.importorskip("pandas")
patsy = pytest.importorskip("patsy")


def _oneway() -> tuple[list[float], list[str]]:
    rng = np.random.default_rng(7)
    sizes = {"a": 6, "b": 9, "c": 5, "d": 8}
    means = {"a": 10.0, "b": 12.0, "c": 11.0, "d": 15.0}
    y: list[float] = []
    g: list[str] = []
    for lv, n in sizes.items():
        y += (means[lv] + rng.normal(0, 1.5, n)).tolist()
        g += [lv] * n
    return y, g


def _two_way() -> tuple[list[float], list[str], list[str], list[float]]:
    rng = np.random.default_rng(11)
    a, b, x, y = [], [], [], []
    for i in range(48):
        ai, bi = ["p", "q", "r"][i % 3], ["u", "v"][(i // 3 + i // 7) % 2]
        xi = float(rng.uniform(0, 5))
        a.append(ai)
        b.append(bi)
        x.append(xi)
        effect = {"p": 0, "q": 1.2, "r": 2.5}[ai] + (0.8 if bi == "v" else 0)
        y.append(2 + effect + 0.7 * xi + rng.normal(0, 1))
    return y, a, b, x


def _fit_oneway():  # type: ignore[no-untyped-def]
    y, g = _oneway()
    res = fit_linear_model(y, [{"name": "G", "kind": "nominal", "values": g}], [["G"]])
    return y, g, res["model"]


@pytest.mark.parametrize("alpha", [0.05, 0.01])
def test_one_way_tukey_matches_pairwise_tukeyhsd(alpha: float) -> None:
    y, g, model = _fit_oneway()
    out = compare_ls_means(model, ["G"], method="tukey", alpha=alpha)
    tk = multicomp.pairwise_tukeyhsd(np.asarray(y), np.asarray(g), alpha=alpha)
    ref = {(str(r[0]), str(r[1])): r for r in tk._results_table.data[1:]}
    assert len(out["rows"]) == len(ref) == 6
    for row in out["rows"]:
        r = ref[(row["level_a"], row["level_b"])]
        # statsmodels reports group2 - group1; ours is level_a - level_b.
        assert -row["difference"] == pytest.approx(r[2], abs=1e-3)
    p_ref = {k: v for k, v in zip(ref, tk.pvalues, strict=True)}
    lo_ref = {k: v for k, v in zip(ref, tk.confint[:, 0], strict=True)}
    for row in out["rows"]:
        key = (row["level_a"], row["level_b"])
        assert row["p"] == pytest.approx(p_ref[key], abs=1e-6)
        assert -row["upper"] == pytest.approx(lo_ref[key], abs=1e-6)


def test_balanced_one_way_matches_classic_hsd() -> None:
    # Balanced layout: Tukey HSD = q_crit * sqrt(MSE / n); the CI half-width is that.
    rng = np.random.default_rng(3)
    g = [lv for lv in "abc" for _ in range(7)]
    y = (rng.normal(0, 1, 21) + np.repeat([0.0, 1.0, 3.0], 7)).tolist()
    res = fit_linear_model(y, [{"name": "G", "kind": "nominal", "values": g}], [["G"]])
    out = compare_ls_means(res["model"], ["G"], method="tukey")
    from scipy.stats import studentized_range

    hsd = studentized_range.ppf(0.95, 3, 18) * np.sqrt(res["anova"][1]["ms"] / 7)
    for row in out["rows"]:
        assert row["upper"] - row["difference"] == pytest.approx(hsd, rel=1e-9)


def test_multifactor_contrasts_match_ols_t_test() -> None:
    y, a, b, x = _two_way()
    factors = [
        {"name": "A", "kind": "nominal", "values": a, "levels": ["p", "q", "r"]},
        {"name": "B", "kind": "nominal", "values": b, "levels": ["u", "v"]},
        {"name": "X", "kind": "continuous", "values": x},
    ]
    res = fit_linear_model(y, factors, [["A"], ["B"], ["X"], ["A", "B"]])
    df = pd.DataFrame({"y": y, "A": a, "B": b, "X": x})
    fit = sm.ols("y ~ C(A, Sum) * C(B, Sum) + X", df).fit()
    # LS-mean of A at level l, B averaged, X at its mean: build the OLS contrast
    # from the statsmodels design at those settings.
    levels = ["p", "q", "r"]
    rows = []
    for lv in levels:
        cells = pd.DataFrame({"A": [lv, lv], "B": ["u", "v"], "X": [df.X.mean()] * 2})
        dm = patsy.dmatrix("C(A, Sum) * C(B, Sum) + X", df).design_info
        rows.append(np.asarray(patsy.build_design_matrices([dm], cells)[0]).mean(axis=0))
    unadj = compare_ls_means(res["model"], ["A"], method="student")
    tukey = compare_ls_means(res["model"], ["A"], method="tukey")
    bonf = compare_ls_means(res["model"], ["A"], method="bonferroni")
    assert unadj["pairs"] == 3
    for (i, j), ru, rt, rb in zip(
        itertools.combinations(range(3), 2), unadj["rows"], tukey["rows"], bonf["rows"], strict=True
    ):
        assert (ru["level_a"], ru["level_b"]) == (levels[i], levels[j])
        tt = fit.t_test(rows[i] - rows[j])
        assert ru["difference"] == pytest.approx(float(tt.effect[0]), rel=1e-8)
        assert ru["se"] == pytest.approx(float(tt.sd[0, 0]), rel=1e-8)
        assert ru["t"] == pytest.approx(float(tt.tvalue[0, 0]), rel=1e-8)
        assert ru["p"] == pytest.approx(float(tt.pvalue), rel=1e-8)
        assert ru["df"] == int(fit.df_resid)
        lo, hi = tt.conf_int(alpha=0.05)[0]
        assert ru["lower"] == pytest.approx(lo, rel=1e-8)
        assert ru["upper"] == pytest.approx(hi, rel=1e-8)
        assert rb["p"] == pytest.approx(min(1.0, 3 * float(tt.pvalue)), rel=1e-8)
        assert rt["p"] >= ru["p"] - 1e-12  # adjustment never lowers a p value
        assert rt["p"] <= rb["p"] + 1e-12  # Tukey is no more conservative than Bonferroni here


def test_interaction_effect_compares_every_cell() -> None:
    y, a, b, x = _two_way()
    res = fit_linear_model(
        y,
        [
            {"name": "A", "kind": "nominal", "values": a},
            {"name": "B", "kind": "nominal", "values": b},
        ],
        [["A"], ["B"], ["A", "B"]],
    )
    out = compare_ls_means(res["model"], ["B", "A"], method="tukey")  # order-free
    assert out["effect"] == "A*B" and out["cells"] == 6 and out["pairs"] == 15


def test_refusals() -> None:
    y, a, b, x = _two_way()
    res = fit_linear_model(
        y,
        [
            {"name": "A", "kind": "nominal", "values": a},
            {"name": "X", "kind": "continuous", "values": x},
        ],
        [["A"], ["X"]],
    )
    with pytest.raises(ValueError, match="not a term"):
        compare_ls_means(res["model"], ["B"])
    with pytest.raises(ValueError, match="continuous"):
        compare_ls_means(res["model"], ["X"])
    with pytest.raises(ValueError, match="method"):
        compare_ls_means(res["model"], ["A"], method="scheffe")
    with pytest.raises(ValueError, match="alpha"):
        compare_ls_means(res["model"], ["A"], alpha=1.5)
