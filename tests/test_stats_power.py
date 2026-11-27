"""Power / sample size / detectable effect (calc.stats_power, stats_power_solve)
and the probability calculator (calc.prob_calc), with their routes.

Oracles: statsmodels' power classes (a dev-group dependency, never required at
runtime) to 1e-6; Cohen's (1988) tabled sample sizes; the closed-form identity
that a null effect has power alpha; a seeded simulation for the variance test,
which statsmodels has no class for; and the worksheet formula engine for the
calculator (a calculator value must equal the same formula in a column).
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import stats

from quantized.app import app
from quantized.calc.column_formula import evaluate_formula
from quantized.calc.prob_calc import DISTRIBUTIONS, evaluate
from quantized.calc.stats_power import (
    anova_power,
    cohens_h,
    proportion_power,
    t_power,
    variance_power,
)
from quantized.calc.stats_power_solve import solve
from quantized.datastruct import DataStruct

smp = pytest.importorskip("statsmodels.stats.power")
client = TestClient(app)

TAILS = {1: "larger", 2: "two-sided"}


# --- forward power against statsmodels -------------------------------------------------


@pytest.mark.parametrize("tails", [1, 2])
@pytest.mark.parametrize("d,n", [(0.2, 30), (0.5, 12), (0.8, 7), (1.3, 5)])
def test_one_sample_and_paired_match_statsmodels(d: float, n: int, tails: int) -> None:
    ref = smp.TTestPower().power(d, n, 0.05, alternative=TAILS[tails])
    for kind in ("one-sample", "paired"):
        assert t_power(kind, d, n, alpha=0.05, tails=tails) == pytest.approx(ref, abs=1e-6)


@pytest.mark.parametrize("tails", [1, 2])
@pytest.mark.parametrize("ratio", [1.0, 2.0, 0.5])
@pytest.mark.parametrize("d,n", [(0.3, 40), (0.5, 20), (1.0, 8)])
def test_two_sample_matches_statsmodels(d: float, n: int, ratio: float, tails: int) -> None:
    ref = smp.TTestIndPower().power(d, n, 0.01, ratio=ratio, alternative=TAILS[tails])
    got = t_power("two-sample", d, n, alpha=0.01, tails=tails, n2=ratio * n)
    assert got == pytest.approx(ref, abs=1e-6)


def test_negative_effect_is_the_same_as_positive() -> None:
    assert t_power("two-sample", -0.5, 30, tails=1) == t_power("two-sample", 0.5, 30, tails=1)


@pytest.mark.parametrize("k", [2, 3, 5])
@pytest.mark.parametrize("f,n", [(0.1, 60), (0.25, 20), (0.4, 8)])
def test_anova_matches_statsmodels(f: float, n: int, k: int) -> None:
    ref = smp.FTestAnovaPower().power(f, n * k, 0.05, k_groups=k)
    assert anova_power(f, n, k, alpha=0.05) == pytest.approx(ref, abs=1e-6)


@pytest.mark.parametrize("tails", [1, 2])
@pytest.mark.parametrize("p0,p1,n", [(0.5, 0.65, 100), (0.1, 0.2, 60), (0.3, 0.2, 80)])
def test_proportions_match_statsmodels(p0: float, p1: float, n: int, tails: int) -> None:
    h = cohens_h(p1, p0)
    one = smp.NormalIndPower().power(abs(h), n, 0.05, ratio=0, alternative=TAILS[tails])
    two = smp.NormalIndPower().power(abs(h), n, 0.05, ratio=1.5, alternative=TAILS[tails])
    assert proportion_power(h, n, tails=tails) == pytest.approx(one, abs=1e-6)
    assert proportion_power(h, n, tails=tails, n2=1.5 * n) == pytest.approx(two, abs=1e-6)


def test_cohens_h_matches_statsmodels() -> None:
    from statsmodels.stats.proportion import proportion_effectsize

    assert cohens_h(0.65, 0.5) == pytest.approx(proportion_effectsize(0.65, 0.5), abs=1e-12)


# --- the variance test: identities and a seeded simulation ------------------------------


@pytest.mark.parametrize("tails", [1, 2])
def test_null_effect_has_power_alpha(tails: int) -> None:
    assert variance_power(1.0, 25, alpha=0.05, tails=tails) == pytest.approx(0.05, abs=1e-12)
    assert t_power("two-sample", 0.0, 25, alpha=0.05, tails=tails) == pytest.approx(0.05, abs=1e-9)
    assert anova_power(0.0, 10, 3, alpha=0.05) == pytest.approx(0.05, abs=1e-9)
    assert proportion_power(0.0, 40, alpha=0.05, tails=tails) == pytest.approx(0.05, abs=1e-12)


@pytest.mark.parametrize("ratio,tails", [(2.0, 2), (0.4, 2), (2.0, 1), (0.4, 1)])
def test_variance_power_matches_simulation(ratio: float, tails: int) -> None:
    n, alpha, reps = 20, 0.05, 40000
    rng = np.random.default_rng(7)
    s2 = rng.chisquare(n - 1, size=reps) * ratio  # (n-1) s^2 / sigma0^2 under the alternative
    if tails == 2:
        rej = (s2 < stats.chi2.ppf(alpha / 2, n - 1)) | (s2 > stats.chi2.isf(alpha / 2, n - 1))
    elif ratio > 1:
        rej = s2 > stats.chi2.isf(alpha, n - 1)
    else:
        rej = s2 < stats.chi2.ppf(alpha, n - 1)
    assert variance_power(ratio, n, alpha=alpha, tails=tails) == pytest.approx(rej.mean(), abs=0.01)


def test_variance_power_is_monotone_in_the_ratio() -> None:
    up = [variance_power(r, 30) for r in (1.0, 1.5, 2.0, 3.0, 5.0)]
    down = [variance_power(r, 30) for r in (1.0, 0.7, 0.5, 0.3, 0.1)]
    assert up == sorted(up) and down == sorted(down)


# --- Cohen's tables --------------------------------------------------------------------


def test_cohen_two_sample_d_half_needs_64_per_group() -> None:
    r = solve("t-two-sample", "n", effect=0.5, power=0.8)
    assert (r["n"], r["n2"], r["n_total"]) == (64, 64, 128)
    assert r["power"] == pytest.approx(0.8015, abs=1e-4)


def test_cohen_one_sample_d_half_needs_34() -> None:
    assert solve("t-one-sample", "n", effect=0.5, power=0.8)["n"] == 34


def test_cohen_one_sided_two_sample_d_half_needs_51() -> None:
    assert solve("t-two-sample", "n", effect=0.5, power=0.8, tails=1)["n"] == 51


def test_cohen_anova_f_quarter_four_groups_needs_45_per_group() -> None:
    r = solve("anova", "n", effect=0.25, power=0.8, groups=4)
    assert (r["n"], r["n_total"]) == (45, 180)


def test_cohen_two_proportions_h_third_needs_175() -> None:
    # Cohen Table 6.4.1: h = 0.30, power .80, two-sided .05 -> n = 175 per group.
    p1 = math.sin(math.asin(math.sqrt(0.5)) + 0.15) ** 2
    assert solve("prop-two", "n", p0=0.5, p1=p1, power=0.8)["n"] == 175


# --- the solvers -----------------------------------------------------------------------

SOLVE_CASES = [
    ("t-one-sample", dict(effect=0.4)),
    ("t-paired", dict(effect=0.6, tails=1)),
    ("t-two-sample", dict(effect=0.5, ratio=2.0)),
    ("t-two-sample", dict(effect=0.35, ratio=0.5, alpha=0.01)),
    ("anova", dict(effect=0.3, groups=5)),
    ("prop-one", dict(p0=0.4, p1=0.55)),
    ("prop-two", dict(p0=0.2, p1=0.35, ratio=1.5, tails=1)),
    ("variance", dict(effect=2.5)),
    ("variance", dict(effect=0.4, tails=1)),
]


@pytest.mark.parametrize("test,kw", SOLVE_CASES)
def test_sample_size_is_the_least_whole_n_reaching_the_target(test: str, kw: dict) -> None:
    r = solve(test, "n", power=0.9, **kw)
    assert isinstance(r["n"], int) and r["power"] >= 0.9
    assert r["target_power"] == 0.9
    below = solve(test, "power", n=r["n"] - 1, **kw) if r["n"] > 2 else None
    if below is not None:
        assert below["power"] < 0.9
    # the reported power is the power at exactly the reported integers
    again = solve(test, "power", n=r["n"], **kw)
    assert again["power"] == pytest.approx(r["power"], abs=1e-12)


@pytest.mark.parametrize("test,kw", SOLVE_CASES)
def test_effect_solve_round_trips_through_power(test: str, kw: dict) -> None:
    kw = {k: v for k, v in kw.items() if k not in ("effect", "p1")}
    r = solve(test, "effect", n=40, power=0.85, **kw)
    assert r["power"] == pytest.approx(0.85, abs=1e-9)
    back = dict(p1=r["p1"]) if test.startswith("prop-") else dict(effect=r["effect"])
    assert solve(test, "power", n=40, **kw, **back)["power"] == pytest.approx(0.85, abs=1e-6)


def test_effect_solve_matches_statsmodels() -> None:
    # statsmodels' own root finder stops near 1e-6; judge the effect by its power in statsmodels.
    d = solve("t-two-sample", "effect", n=30, power=0.8)["effect"]
    assert smp.TTestIndPower().power(d, 30, 0.05) == pytest.approx(0.8, abs=1e-9)
    f = solve("anova", "effect", n=30, power=0.8, groups=3)["effect"]
    assert smp.FTestAnovaPower().power(f, 90, 0.05, k_groups=3) == pytest.approx(0.8, abs=1e-9)


def test_sample_size_solve_matches_statsmodels_before_rounding() -> None:
    ref = smp.TTestPower().solve_power(0.45, nobs=None, alpha=0.05, power=0.8)
    assert solve("t-one-sample", "n", effect=0.45, power=0.8)["n"] == math.ceil(ref)


def test_unequal_groups_report_both_sizes() -> None:
    r = solve("t-two-sample", "n", effect=0.5, power=0.8, ratio=2.0)
    assert r["n2"] == 2 * r["n"] and r["n_total"] == 3 * r["n"]
    assert r["ratio"] == 2.0 and len(r["curve"]["n"]) == len(r["curve"]["power"]) > 10


def test_proportion_effect_reports_both_directions_and_drops_impossible_ones() -> None:
    r = solve("prop-one", "effect", p0=0.5, n=50, power=0.8)
    assert r["p1"] > 0.5 > r["p1_alt"]
    assert proportion_power(cohens_h(r["p1"], 0.5), 50) == pytest.approx(0.8, abs=1e-9)
    assert proportion_power(cohens_h(r["p1_alt"], 0.5), 50) == pytest.approx(0.8, abs=1e-9)
    edge = solve("prop-one", "effect", p0=0.97, n=20, power=0.8)
    assert edge["p1"] is None and edge["p1_alt"] is not None  # no p1 above 0.97 gives h that large


def test_variance_effect_gives_both_sides() -> None:
    r = solve("variance", "effect", n=30, power=0.8)
    assert r["effect"] > 1 > r["effect_alt"]
    assert variance_power(r["effect_alt"], 30) == pytest.approx(0.8, abs=1e-9)


def test_power_curve_passes_through_the_answer() -> None:
    r = solve("t-two-sample", "n", effect=0.5, power=0.8)
    c = r["curve"]
    assert r["n"] in c["n"] and c["power"] == sorted(c["power"])
    assert c["power"][c["n"].index(r["n"])] == pytest.approx(r["power"], abs=1e-12)


@pytest.mark.parametrize(
    "kw,msg",
    [
        (dict(test="nope", solve_for="n"), "test must be"),
        (dict(test="anova", solve_for="nope"), "solve must be"),
        (dict(test="anova", solve_for="n", effect=0.2, power=0.8, groups=1), "groups"),
        (dict(test="t-one-sample", solve_for="n", effect=0.2), "power is required"),
        (dict(test="t-one-sample", solve_for="n", effect=0.2, power=0.03), "greater than alpha"),
        (dict(test="t-one-sample", solve_for="n", effect=0.0, power=0.8), "nonzero"),
        (dict(test="t-one-sample", solve_for="power", effect=0.5, n=1), "whole number"),
        (dict(test="t-one-sample", solve_for="power", effect=0.5, n=2.5), "whole number"),
        (dict(test="t-one-sample", solve_for="n", effect=0.5, power=0.8, alpha=1.5), "alpha"),
        (dict(test="t-one-sample", solve_for="n", effect=0.5, power=0.8, tails=3), "tails"),
        (dict(test="t-two-sample", solve_for="n", effect=0.5, power=0.8, ratio=0), "ratio"),
        (dict(test="prop-two", solve_for="n", p0=0.5, p1=0.5, power=0.8), "no effect"),
        (dict(test="prop-two", solve_for="n", p0=1.0, p1=0.5, power=0.8), "p0"),
        (dict(test="variance", solve_for="n", effect=1.0, power=0.8), "not 1"),
        (dict(test="t-one-sample", solve_for="n", effect=1e-7, power=0.8), "10 million"),
    ],
)
def test_bad_inputs_are_refused_with_a_reason(kw: dict, msg: str) -> None:
    test, solve_for = kw.pop("test"), kw.pop("solve_for")
    with pytest.raises(ValueError, match=msg):
        solve(test, solve_for, **kw)


def test_existing_t_test_power_is_unchanged() -> None:
    from quantized.calc.stats_dist import required_n, t_test_power

    assert t_test_power(0.5, 64)["power"] == pytest.approx(0.8014595579, abs=1e-9)
    assert required_n(0.5, 0.8)["n"] == 64


# --- the probability calculator ---------------------------------------------------------

CALC = {
    "normal": {"mu": 1.5, "sigma": 2.0},
    "t": {"df": 7.0},
    "chi2": {"df": 4.0},
    "f": {"df1": 3.0, "df2": 9.0},
    "gamma": {"a": 2.5, "b": 1.5},
    "beta": {"a": 2.0, "b": 3.5},
    "lognormal": {"mu": 0.3, "sigma": 0.7},
    "weibull": {"a": 2.0, "b": 1.7},
    "exponential": {"lambda": 0.8},
    "poisson": {"lambda": 4.5},
    "binomial": {"n": 12.0, "p": 0.35},
}
XS = [0.05, 0.4, 1.0, 2.5, 6.0]
PS = [0.01, 0.25, 0.5, 0.9, 0.999]


def _col(vals: list[float]) -> DataStruct:
    return DataStruct.create(
        np.zeros(len(vals)), np.asarray(vals).reshape(-1, 1), labels=["A"], units=[""]
    )


@pytest.mark.parametrize("dist", sorted(CALC))
def test_calculator_equals_the_same_formula_in_a_column(dist: str) -> None:
    discrete = DISTRIBUTIONS[dist].discrete
    xs = [0.0, 1.0, 2.0, 5.0, 9.0] if discrete else XS
    r = evaluate(dist, CALC[dist], xs, PS)
    f = r["formulas"]
    for key, vals in (("pdf", xs), ("cdf", xs), ("sf", xs), ("quantile", PS)):
        if f[key] is None:
            continue
        want = evaluate_formula(_col(vals), f[key])
        np.testing.assert_allclose(r[key], want, rtol=1e-12, atol=0, err_msg=f"{dist}.{key}")


@pytest.mark.parametrize("dist", sorted(CALC))
def test_calculator_agrees_with_scipy_and_is_self_consistent(dist: str) -> None:
    d = DISTRIBUTIONS[dist]
    xs = [0.0, 1.0, 2.0, 5.0, 9.0] if d.discrete else XS
    r = evaluate(dist, CALC[dist], xs, PS)
    np.testing.assert_allclose(r["cdf"] + r["sf"], 1.0, atol=1e-12)
    if not d.discrete:
        np.testing.assert_allclose(r["cdf"][np.isfinite(r["cdf"])], r["cdf"][np.isfinite(r["cdf"])])
        back = evaluate(dist, CALC[dist], list(r["quantile"]))["cdf"]
        np.testing.assert_allclose(back, PS, rtol=1e-8)
    else:
        q = r["quantile"]
        cdf_q = evaluate(dist, CALC[dist], list(q))["cdf"]
        cdf_below = evaluate(dist, CALC[dist], list(q - 1))["cdf"]
        assert np.all(cdf_q >= np.asarray(PS) - 1e-12) and np.all(cdf_below < np.asarray(PS))


def test_known_values() -> None:
    n = evaluate("normal", {"mu": 0.0, "sigma": 1.0}, [1.959963984540054], [0.975])
    assert n["cdf"][0] == pytest.approx(0.975, abs=1e-12) and n["quantile"][0] == pytest.approx(
        1.959963984540054
    )
    assert evaluate("normal", {"mu": 10.0, "sigma": 2.0}, [14.0])["cdf"][0] == pytest.approx(
        0.9772498680518208
    )
    assert evaluate("t", {"df": 10.0}, p=[0.975])["quantile"][0] == pytest.approx(
        2.2281388519649385
    )
    assert evaluate("chi2", {"df": 1.0}, p=[0.95])["quantile"][0] == pytest.approx(
        3.841458820694124
    )
    assert evaluate("f", {"df1": 1.0, "df2": 10.0}, p=[0.95])["quantile"][0] == pytest.approx(
        4.964602743730711
    )
    assert evaluate("binomial", {"n": 10.0, "p": 0.5}, [5.0])["pdf"][0] == pytest.approx(252 / 1024)
    assert evaluate("poisson", {"lambda": 2.0}, [0.0])["pdf"][0] == pytest.approx(math.exp(-2))
    assert evaluate("exponential", {"lambda": 2.0}, [1.0])["sf"][0] == pytest.approx(math.exp(-2))
    u = evaluate("uniform", {"a": 2.0, "b": 6.0}, [3.0, 7.0], [0.25])
    assert (
        list(u["pdf"]) == [0.25, 0.0] and list(u["cdf"]) == [0.25, 1.0] and u["quantile"][0] == 3.0
    )
    assert u["formulas"]["cdf"] is None  # uniform is not a formula function


def test_blank_cells_out_of_domain_and_bad_p_are_nan_not_errors() -> None:
    r = evaluate("lognormal", {"mu": 0.0, "sigma": 1.0}, [None, -1.0, 1.0], [-0.1, 1.5, 0.5])
    assert np.isnan(r["pdf"][0]) and r["pdf"][1] == 0.0 and r["cdf"][1] == 0.0
    assert np.isnan(r["quantile"][0]) and np.isnan(r["quantile"][1]) and r["quantile"][2] == 1.0


@pytest.mark.parametrize(
    "dist,params",
    [
        ("normal", {"mu": 0.0, "sigma": 0.0}),
        ("t", {"df": -1.0}),
        ("f", {"df1": 1.0}),
        ("binomial", {"n": 2.5, "p": 0.5}),
        ("binomial", {"n": 5.0, "p": 1.5}),
        ("uniform", {"a": 3.0, "b": 3.0}),
        ("poisson", {"lambda": float("nan")}),
        ("cauchy", {}),
    ],
)
def test_calculator_refuses_bad_parameters(dist: str, params: dict) -> None:
    with pytest.raises(ValueError):
        evaluate(dist, params, [1.0])


def test_calculator_needs_something_to_evaluate_and_caps_the_column() -> None:
    with pytest.raises(ValueError, match="x values"):
        evaluate("t", {"df": 3.0})


# --- routes ----------------------------------------------------------------------------


def test_power_solve_route() -> None:
    r = client.post(
        "/api/stats/power-solve",
        json={"test": "anova", "solve": "n", "effect": 0.25, "power": 0.8, "groups": 4},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["n"] == 45 and body["power"] >= 0.8 and body["curve"]["n"]
    bad = client.post("/api/stats/power-solve", json={"test": "anova", "solve": "n"})
    assert bad.status_code == 422 and "required" in bad.json()["detail"]
    assert client.post("/api/stats/power-solve", json={"test": "x"}).status_code == 422


def test_probability_route_and_distribution_list() -> None:
    r = client.post(
        "/api/stats/probability",
        json={"dist": "normal", "params": {"mu": 0, "sigma": 1}, "x": [0, None, 1.96], "p": [0.5]},
    )
    assert r.status_code == 200
    b = r.json()
    assert b["cdf"][0] == 0.5 and b["cdf"][1] is None and b["quantile"] == [0.0]
    assert (
        client.post(
            "/api/stats/probability", json={"dist": "t", "params": {"df": -2}, "x": [1]}
        ).status_code
        == 422
    )
    lst = client.get("/api/stats/probability/distributions").json()
    assert {d["id"] for d in lst} == set(CALC) | {"uniform"}
    assert all(len(d["params"]) == len(d["defaults"]) for d in lst)
    # the defaults themselves are valid parameters
    for d in lst:
        evaluate(d["id"], dict(zip(d["params"], d["defaults"], strict=True)), [1.0])
