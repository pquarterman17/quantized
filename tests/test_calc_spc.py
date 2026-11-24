"""SPC control charts + capability (GAP_AUDIT_9 J14): published constants, NIST worked
examples, hand-computed fixtures and rule behaviour."""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy import integrate, stats

from quantized.calc import spc_constants as K
from quantized.calc.spc_capability import process_capability
from quantized.calc.spc_charts import control_chart
from quantized.calc.spc_rules import check_rules

# York University "Factors useful in the construction of control charts"
# (columns A2 A3 c4 B3 B4 d2 d3 D3 D4),
# transcribed from controlfactors.pdf for spot rows; NIST 6.3.2.1 prints A2/D3/D4 for n = 2..10.
YORK = {  # n: A2, A3, c4, B3, B4, d2, d3, D3, D4
    2: (1.880, 2.659, 0.7979, 0, 3.267, 1.128, 0.852, 0, 3.266),
    3: (1.023, 1.954, 0.8862, 0, 2.568, 1.693, 0.888, 0, 2.574),
    4: (0.729, 1.628, 0.9213, 0, 2.266, 2.059, 0.879, 0, 2.281),
    5: (0.577, 1.427, 0.9400, 0, 2.089, 2.326, 0.864, 0, 2.114),
    6: (0.483, 1.287, 0.9515, 0.030, 1.970, 2.534, 0.848, 0, 2.003),
    7: (0.419, 1.182, 0.9594, 0.118, 1.882, 2.704, 0.833, 0.076, 1.924),
    8: (0.373, 1.099, 0.9650, 0.185, 1.815, 2.847, 0.819, 0.137, 1.863),
    9: (0.337, 1.032, 0.9693, 0.239, 1.761, 2.970, 0.807, 0.184, 1.816),
    10: (0.308, 0.975, 0.9727, 0.284, 1.716, 3.078, 0.797, 0.223, 1.777),
    15: (0.223, 0.789, 0.9823, 0.428, 1.572, 3.472, 0.756, 0.347, 1.653),
    20: (0.180, 0.680, 0.9869, 0.510, 1.490, 3.735, 0.728, 0.415, 1.585),
    25: (0.153, 0.606, 0.9896, 0.565, 1.435, 3.931, 0.708, 0.460, 1.540),
}
NIST_321 = {  # n: A2, D3, D4 (NIST 6.3.2.1)
    2: (1.880, 0, 3.267),
    3: (1.023, 0, 2.575),
    4: (0.729, 0, 2.282),
    5: (0.577, 0, 2.115),
    6: (0.483, 0, 2.004),
    7: (0.419, 0.076, 1.924),
    8: (0.373, 0.136, 1.864),
    9: (0.337, 0.184, 1.816),
    10: (0.308, 0.223, 1.777),
}


@pytest.mark.parametrize("n", sorted(YORK))
def test_constants_match_published_table(n: int) -> None:
    got = (
        K.a2(n),
        K.a3(n),
        K.c4(n),
        K.b3(n),
        K.b4(n),
        K.d2(n),
        K.d3(n),
        K.d3_lower(n),
        K.d4_upper(n),
    )
    for g, want in zip(got, YORK[n], strict=True):
        assert g == pytest.approx(want, abs=2.5e-3), (n, g, want)


@pytest.mark.parametrize("n", sorted(NIST_321))
def test_constants_match_nist_6_3_2_1(n: int) -> None:
    a2, d3, d4 = NIST_321[n]
    assert K.a2(n) == pytest.approx(a2, abs=1.5e-3)
    assert K.d3_lower(n) == pytest.approx(d3, abs=1.5e-3)
    assert K.d4_upper(n) == pytest.approx(d4, abs=1.5e-3)


@pytest.mark.parametrize("n", [2, 3, 5, 10, 25])
def test_tabulated_constants_agree_with_exact_theory(n: int) -> None:
    # d2 = E[range of n std normals], d3 = SD of that range; c4 = E[s]/sigma (exact gamma form).
    def cdf_range(r: float) -> float:
        f = lambda x: n * stats.norm.pdf(x) * (stats.norm.cdf(x + r) - stats.norm.cdf(x)) ** (n - 1)  # noqa: E731
        return float(integrate.quad(f, -10, 10)[0])

    mean_r = float(integrate.quad(lambda r: 1 - cdf_range(r), 0, 12)[0])
    second = float(integrate.quad(lambda r: 2 * r * (1 - cdf_range(r)), 0, 12)[0])
    assert K.d2(n) == pytest.approx(mean_r, abs=6e-4)
    assert K.d3(n) == pytest.approx(math.sqrt(second - mean_r**2), abs=1e-3)
    exact_c4 = math.sqrt(2 / (n - 1)) * math.gamma(n / 2) / math.gamma((n - 1) / 2)
    assert K.c4(n) == pytest.approx(exact_c4, abs=1e-4)


def test_out_of_range_subgroup_size_refused() -> None:
    with pytest.raises(ValueError, match="outside the published"):
        K.d2(26)
    with pytest.raises(ValueError, match="outside the published"):
        K.d2(1)


def test_imr_nist_6_3_2_2_worked_example() -> None:
    x = [49.6, 47.6, 49.9, 51.3, 47.8, 51.2, 52.6, 52.4, 53.6, 52.1]
    r = control_chart("imr", values=x)
    ind, mr = r["panels"]
    assert ind["center"] == pytest.approx(50.81)
    assert mr["center"] == pytest.approx(1.8778, abs=5e-5)
    assert ind["ucl"][0] == pytest.approx(55.8041, abs=1e-3)
    assert ind["lcl"][0] == pytest.approx(45.8159, abs=1e-3)
    assert ind["beyond_limits"] == []
    assert mr["ucl"][0] == pytest.approx(3.267 * 1.8778, abs=5e-3)  # derived D4 3.266 vs NIST 3.267
    assert mr["lcl"][0] == 0.0
    assert r["sigma_within"] == pytest.approx(1.8778 / 1.128, abs=1e-4)


def test_xbar_r_hand_computed() -> None:
    sg = [[1.0, 2.0, 3.0], [2.0, 4.0, 6.0], [3.0, 3.0, 3.0], [1.0, 5.0, 6.0]]
    r = control_chart("xbar-r", subgroups=sg)
    xb, rg = r["panels"]
    means = [2.0, 4.0, 3.0, 4.0]
    ranges = [2.0, 4.0, 0.0, 5.0]
    assert xb["values"] == means and rg["values"] == ranges
    grand, rbar = 3.25, 2.75
    a2 = 3 / (1.693 * math.sqrt(3))
    assert xb["center"] == grand and rg["center"] == rbar
    assert xb["ucl"][0] == pytest.approx(grand + a2 * rbar)
    assert xb["lcl"][0] == pytest.approx(grand - a2 * rbar)
    assert rg["ucl"][0] == pytest.approx((1 + 3 * 0.888 / 1.693) * rbar)
    assert rg["lcl"][0] == 0.0
    assert r["sigma_within"] == pytest.approx(rbar / 1.693)


def test_xbar_s_hand_computed() -> None:
    sg = [[1.0, 2.0, 3.0, 4.0], [2.0, 2.0, 4.0, 4.0], [5.0, 6.0, 7.0, 9.0]]
    r = control_chart("xbar-s", subgroups=sg)
    xb, sp = r["panels"]
    s = [np.std(g, ddof=1) for g in sg]
    sbar = float(np.mean(s))
    assert sp["values"] == pytest.approx(s)
    assert xb["ucl"][0] - xb["center"] == pytest.approx(3 / (0.9213 * 2) * sbar)
    assert sp["ucl"][0] == pytest.approx(sp["center"] * (1 + 3 * math.sqrt(1 - 0.9213**2) / 0.9213))
    assert r["sigma_within"] == pytest.approx(sbar / 0.9213)


def test_unequal_subgroups_refused() -> None:
    with pytest.raises(ValueError, match="unequal sizes"):
        control_chart("xbar-r", subgroups=[[1.0, 2.0], [1.0, 2.0, 3.0]])
    with pytest.raises(ValueError, match="at least 2"):
        control_chart("xbar-r", subgroups=[[1.0], [2.0]])
    with pytest.raises(ValueError, match="outside the published"):
        control_chart("xbar-r", subgroups=[[0.0] * 26, [1.0] * 26])


def test_attribute_charts_hand_computed() -> None:
    c = control_chart("c", counts=[3, 5, 4, 12, 4, 3, 5, 4])
    cbar = 5.0
    assert c["panels"][0]["center"] == cbar
    assert c["panels"][0]["ucl"][0] == pytest.approx(5 + 3 * math.sqrt(5))
    assert c["panels"][0]["lcl"][0] == 0.0  # 5 - 6.708 < 0 clamps
    assert c["panels"][0]["beyond_limits"] == [3]

    p = control_chart("p", counts=[4, 6, 5, 20], sizes=[100, 100, 100, 100])
    pbar = 35 / 400
    assert p["panels"][0]["center"] == pytest.approx(pbar)
    assert p["panels"][0]["ucl"][0] == pytest.approx(pbar + 3 * math.sqrt(pbar * (1 - pbar) / 100))
    assert p["panels"][0]["beyond_limits"] == [3]

    np_ = control_chart("np", counts=[4, 6, 5, 5], sizes=[50, 50, 50, 50])
    assert np_["panels"][0]["center"] == pytest.approx(50 * 20 / 200)
    u = control_chart("u", counts=[2, 4, 6], sizes=[1, 2, 3])
    assert u["panels"][0]["center"] == pytest.approx(12 / 6)
    assert u["panels"][0]["ucl"][2] == pytest.approx(2 + 3 * math.sqrt(2 / 3))  # varying limits
    assert u["panels"][0]["ucl"][0] > u["panels"][0]["ucl"][2]


def test_attribute_refusals() -> None:
    with pytest.raises(ValueError, match="exceeds"):
        control_chart("p", counts=[11, 2], sizes=[10, 10])
    with pytest.raises(ValueError, match="constant sample size"):
        control_chart("np", counts=[1, 2], sizes=[10, 11])
    with pytest.raises(ValueError, match="needs the sample sizes"):
        control_chart("p", counts=[1, 2])
    with pytest.raises(ValueError, match="all counts are 0"):
        control_chart("c", counts=[0, 0, 0])
    with pytest.raises(ValueError, match="finite"):
        control_chart("imr", values=[1.0, float("nan"), 2.0])
    with pytest.raises(ValueError, match="at least 3"):
        control_chart("imr", values=[1.0, 2.0])


def test_rules_each_pattern_and_options() -> None:
    sig = np.ones(20)
    base = np.zeros(20)
    v = base.copy()
    v[7] = 3.5
    assert check_rules(v, 0.0, sig, ["we1"])[0]["indices"] == [7]
    v = base.copy()
    v[4], v[6] = 2.5, 2.2  # 2 of 3 beyond 2 sigma, same side
    assert check_rules(v, 0.0, sig, ["we2"])[0]["indices"] == [6]
    v = base.copy()
    v[4], v[5], v[7], v[8] = 1.5, 1.2, 1.1, 1.4
    assert check_rules(v, 0.0, sig, ["we3"])[0]["indices"] == [8]
    v = base.copy()
    v[4], v[6] = 2.5, -2.2  # opposite sides: no rule 2
    assert check_rules(v, 0.0, sig, ["we2"])[0]["indices"] == []
    run = np.array([0.3] * 7 + [-0.1] + [0.2] * 8 + [0.4])
    assert check_rules(run, 0.0, np.ones(17), ["we4"])[0]["indices"] == [15, 16]
    assert check_rules(run, 0.0, np.ones(17), ["we4"], run_length=9)[0]["indices"] == [16]
    assert check_rules(run, 0.0, np.ones(17), []) == []
    with pytest.raises(ValueError, match="unknown rule"):
        check_rules(run, 0.0, np.ones(17), ["nelson9"])


def test_rules_are_opt_in_in_chart() -> None:
    x = [10.0] * 9 + [10.4] + [10.1, 9.9] * 3
    plain = control_chart("imr", values=x)
    assert plain["panels"][0]["violations"] == []
    ruled = control_chart("imr", values=x, rules=["we1", "we2", "we3", "we4"])
    assert {v["rule"] for v in ruled["panels"][0]["violations"]} == {"we1", "we2", "we3", "we4"}
    # dispersion panels get rule 1 only
    assert [v["rule"] for v in ruled["panels"][1]["violations"]] == ["we1"]


def _standardised(n: int, mean: float, sd: float, seed: int = 3) -> list[float]:
    z = np.random.default_rng(seed).standard_normal(n)
    z = (z - z.mean()) / z.std(ddof=1)
    return (mean + sd * z).tolist()


def test_capability_nist_6_1_6_example() -> None:
    x = _standardised(200, 16.0, 2.0)
    r = process_capability(x, lsl=8.0, usl=20.0)
    assert r["overall"]["pp"] == pytest.approx(1.0)
    assert r["overall"]["ppk"] == pytest.approx(0.6667, abs=1e-4)
    assert r["overall"]["ppu"] == pytest.approx(0.6667, abs=1e-4)
    assert r["overall"]["ppl"] == pytest.approx(1.3333, abs=1e-4)
    r = process_capability(x, lsl=8.0, usl=20.0, target=14.0)
    assert r["cpm"] == pytest.approx(12 / (6 * math.sqrt(4 + 4)), abs=1e-9)


def test_capability_within_vs_overall_and_ci() -> None:
    sg = [
        [9.9, 10.1, 10.0],
        [10.2, 10.0, 9.8],
        [10.3, 10.1, 10.2],
        [9.7, 9.9, 9.8],
        [10.0, 10.1, 9.9],
    ]
    r = process_capability(
        [], lsl=9.0, usl=11.0, subgroups=sg
    )  # values ignored when subgroups given
    rbar = np.mean([max(g) - min(g) for g in sg])
    sw = rbar / 1.693
    assert r["within"]["sigma"] == pytest.approx(sw)
    assert r["within"]["cp"] == pytest.approx(2.0 / (6 * sw))
    flat = np.array(sg).ravel()
    assert r["overall"]["sigma"] == pytest.approx(flat.std(ddof=1))
    n = 15
    ppk = r["overall"]["ppk"]
    se = math.sqrt(1 / (9 * n) + ppk**2 / (2 * (n - 1)))
    lo, hi = r["overall"]["ci"]["ppk"]
    assert (lo, hi) == pytest.approx((ppk - 1.959964 * se, ppk + 1.959964 * se), abs=1e-5)
    pp = r["overall"]["pp"]
    lo, hi = r["overall"]["ci"]["pp"]
    assert lo == pytest.approx(pp * math.sqrt(stats.chi2.ppf(0.025, n - 1) / (n - 1)))
    assert lo < pp < hi


def test_capability_individuals_uses_moving_range_and_sd_option() -> None:
    x = [49.6, 47.6, 49.9, 51.3, 47.8, 51.2, 52.6, 52.4, 53.6, 52.1]
    r = process_capability(x, lsl=40.0, usl=60.0)
    assert r["within"]["sigma"] == pytest.approx(1.87778 / 1.128, abs=1e-4)
    sg = [[1.0, 2.0, 4.0], [2.0, 2.5, 3.0], [1.0, 3.0, 5.0]]
    a = process_capability([], lsl=-5.0, usl=9.0, subgroups=sg, sigma_method="sd")
    assert a["within"]["sigma"] == pytest.approx(np.mean([np.std(g, ddof=1) for g in sg]) / 0.8862)


def test_capability_one_sided_and_ppm() -> None:
    x = _standardised(100, 10.0, 1.0)
    r = process_capability(x, lsl=None, usl=13.0)
    assert r["overall"]["pp"] is None and r["overall"]["ppk"] == pytest.approx(1.0)
    assert r["ppm_overall"]["above"] == pytest.approx(stats.norm.sf(3) * 1e6)
    assert r["ppm_overall"]["below"] is None
    assert sum(r["histogram"]["counts"]) == 100


def test_capability_refusals() -> None:
    x = _standardised(30, 0.0, 1.0)
    with pytest.raises(ValueError, match="no default"):
        process_capability(x, lsl=None, usl=None)
    with pytest.raises(ValueError, match="LSL must be less"):
        process_capability(x, lsl=2.0, usl=1.0)
    with pytest.raises(ValueError, match="target"):
        process_capability(x, lsl=-3.0, usl=3.0, target=9.0)
    with pytest.raises(ValueError, match="at least"):
        process_capability([1.0, 2.0], lsl=0.0, usl=3.0)
    with pytest.raises(ValueError, match="no variation"):
        process_capability([1.0] * 8, lsl=0.0, usl=3.0)
    with pytest.raises(ValueError, match="finite"):
        process_capability([1.0, float("inf")] * 4, lsl=0.0, usl=3.0)
