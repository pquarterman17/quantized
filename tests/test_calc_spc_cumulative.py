"""EWMA, tabular CUSUM and Nelson-style rules 5-8 (GAP_AUDIT_9 J14).

Oracles: NIST/SEMATECH e-Handbook 6.3.2.3 (CUSUM) and 6.3.2.4 (EWMA) worked
examples (data and tables read from the pages on 2026-11-24; unverified until the
owner checks them) plus hand-computed fixtures.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.spc_charts import control_chart
from quantized.calc.spc_cumulative import cusum_chart, ewma_chart
from quantized.calc.spc_rules import check_rules

NIST_CUSUM_X = [
    324.925,
    324.675,
    324.725,
    324.350,
    325.350,
    325.225,
    324.125,
    324.525,
    325.225,
    324.600,
    324.625,
    325.150,
    328.325,
    327.250,
    327.825,
    328.500,
    326.675,
    327.775,
    326.875,
    328.350,
]
NIST_S_HI = [
    0,
    0,
    0,
    0,
    0.03,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    3.01,
    4.94,
    7.45,
    10.63,
    11.99,
    14.44,
    16.00,
    19.04,
]
NIST_S_LO = [0, 0.01, 0, 0.33, 0, 0, 0.56, 0.72, 0.17, 0.25, 0.31, 0, 0, 0, 0, 0, 0, 0, 0, 0]
NIST_EWMA_Y = [
    52.0,
    47.0,
    53.0,
    49.3,
    50.1,
    47.0,
    51.0,
    50.1,
    51.2,
    50.5,
    49.6,
    47.6,
    49.9,
    51.3,
    47.8,
    51.2,
    52.6,
    52.4,
    53.6,
    52.1,
]
NIST_EWMA = [
    50.60,
    49.52,
    50.56,
    50.18,
    50.16,
    49.21,
    49.75,
    49.85,
    50.26,
    50.33,
    50.11,
    49.36,
    49.52,
    50.05,
    49.38,
    49.92,
    50.73,
    51.23,
    51.94,
    51.99,
]


def test_cusum_nist_6_3_2_3() -> None:
    # NIST: target 325, sigma_xbar = 1.27/sqrt(4) = 0.635, k = 0.3175 (= 0.5 sigma), h = 4.1959.
    r = cusum_chart(NIST_CUSUM_X, k=0.5, h=4.1959 / 0.635, target=325.0, sigma=0.635)
    hi, lo = r["panels"]
    assert np.allclose(hi["values"], NIST_S_HI, atol=0.006)
    assert np.allclose(lo["values"], NIST_S_LO, atol=0.006)
    assert hi["ucl"][0] == pytest.approx(4.1959)
    assert hi["beyond_limits"] == list(range(13, 20))  # signal at group 14 onward (NIST)
    assert lo["beyond_limits"] == []
    sig = r["signals"][0]
    assert sig["side"] == "upper" and sig["first_signal"] == 13
    assert (
        sig["estimated_shift_start"] == 12
    )  # C+ was last 0 at group 12 -> shift began at group 13


def test_ewma_nist_6_3_2_4() -> None:
    # NIST: target 50, s = 2.0539, lambda 0.3, L = 3 (asymptotic limits 47.41 / 52.59).
    r = ewma_chart(NIST_EWMA_Y, lam=0.3, width=3.0, target=50.0, sigma=2.0539)
    p = r["panels"][0]
    assert np.allclose(p["values"], NIST_EWMA, atol=0.006)
    assert p["ucl"][-1] == pytest.approx(52.59, abs=0.005)
    assert p["lcl"][-1] == pytest.approx(47.41, abs=0.005)
    assert p["beyond_limits"] == []  # "in control" per NIST


def test_ewma_exact_limits_hand_fixture() -> None:
    lam, L, s = 0.2, 3.0, 2.0
    r = ewma_chart([10.0, 12.0, 11.0, 9.0], lam=lam, width=L, target=10.0, sigma=s)
    p = r["panels"][0]
    # i = 1: sigma_z = s*sqrt(lam/(2-lam)*(1-(1-lam)^2)) = s*lam  (variance of lam*x)
    assert p["ucl"][0] == pytest.approx(10 + L * s * lam)
    assert p["lcl"][0] == pytest.approx(10 - L * s * lam)
    # i = 2: (1 - 0.8^4) = 0.5904 -> 3*2*sqrt(0.2/1.8*0.5904)
    assert p["ucl"][1] == pytest.approx(10 + 6 * math.sqrt(0.2 / 1.8 * 0.5904))
    assert p["values"][:2] == pytest.approx([10.0, 10.4])
    # limits widen monotonically toward the asymptote
    assert np.all(np.diff(p["ucl"]) > 0)


def test_ewma_defaults_and_estimates() -> None:
    x = [10.0, 10.5, 9.5, 10.2, 9.8, 10.1, 15.0, 15.2, 15.1]
    r = ewma_chart(x)
    assert r["params"]["lambda"] == 0.2 and r["params"]["L"] == 3.0
    assert r["params"]["target"] == pytest.approx(np.mean(x))
    assert r["params"]["sigma"] == pytest.approx(np.abs(np.diff(x)).mean() / 1.128, rel=1e-3)
    assert "estimated" in r["params"]["target_source"]
    assert ewma_chart(x, target=10.0, sigma=0.5)["params"]["target_source"] == "set"


def test_cusum_hand_fixture_both_sides() -> None:
    # target 0, sigma 1, k = 0.5, h = 4 -> K = 0.5, H = 4
    x = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, -3.0, -3.0, -3.0]
    r = cusum_chart(x, k=0.5, h=4.0, target=0.0, sigma=1.0)
    hi, lo = r["panels"]
    assert hi["values"][:8] == pytest.approx(
        [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]
    )  # 4.0 not > H
    assert hi["beyond_limits"] == []
    assert hi["values"][8:] == [0.5, 0.0, 0.0]
    assert lo["values"][8:] == pytest.approx([2.5, 5.0, 7.5])
    assert lo["beyond_limits"] == [9, 10]
    assert r["signals"] == [{"side": "lower", "first_signal": 9, "estimated_shift_start": 8}]


def test_cusum_ewma_defaults_provisional_values() -> None:
    x = list(np.random.default_rng(0).normal(0, 1, 30))
    c = cusum_chart(x, target=0.0, sigma=1.0)
    assert c["params"]["k"] == 0.5 and c["params"]["h"] == 5.0


@pytest.mark.parametrize(
    "call",
    [
        lambda: ewma_chart([1, 2, 3], lam=0.0),
        lambda: ewma_chart([1, 2, 3], lam=1.5),
        lambda: ewma_chart([1, 2, 3], width=0.0),
        lambda: ewma_chart([1, 2]),
        lambda: ewma_chart([1.0, float("nan"), 3.0]),
        lambda: ewma_chart([5.0, 5.0, 5.0]),  # no spread: sigma cannot be estimated
        lambda: cusum_chart([1, 2, 3], k=-1),
        lambda: cusum_chart([1, 2, 3], h=0),
        lambda: cusum_chart([1, 2, 3], sigma=-1.0),
    ],
)
def test_cumulative_refusals(call) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError):
        call()


def test_control_chart_dispatch() -> None:
    assert control_chart("ewma", values=NIST_EWMA_Y, target=50, sigma=2.0539)["chart"] == "ewma"
    assert control_chart("cusum", values=NIST_CUSUM_X, target=325, sigma=0.635)["chart"] == "cusum"
    with pytest.raises(ValueError):
        control_chart("ewma")


def _flag(rule: str, x: list[float], center: float = 0.0, sigma: float = 1.0) -> list[int]:
    out = check_rules(np.asarray(x, float), center, np.full(len(x), sigma), [rule])
    return out[0]["indices"]


def test_nel5_trend_six_in_a_row() -> None:
    assert _flag("nel5", [0, 1, 2, 3, 4, 5, 4, 3]) == [
        5
    ]  # 6 steadily increasing completes at idx 5
    assert _flag("nel5", [0, 1, 2, 3, 4, 3, 4, 5]) == []
    assert _flag("nel5", [9, 8, 7, 6, 5, 4]) == [5]
    assert _flag("nel5", [0, 1, 2, 2, 3, 4, 5]) == []  # a tie breaks the trend


def test_nel6_alternating_fourteen() -> None:
    zig = [(-1.0) ** i for i in range(14)]
    assert _flag("nel6", zig) == [13]
    assert _flag("nel6", zig[:13]) == []
    assert _flag("nel6", zig[:7] + [5.0, 6.0] + zig[:5]) == []


def test_nel7_fifteen_within_one_sigma() -> None:
    assert _flag("nel7", [0.5, -0.5] * 7 + [0.2]) == [14]
    assert _flag("nel7", [0.5, -0.5] * 7 + [1.5, 0.2]) == []
    assert _flag("nel7", [0.5] * 14) == []


def test_nel8_eight_beyond_one_sigma_both_sides() -> None:
    assert _flag("nel8", [1.5, -1.5, 2.0, -1.2, 1.1, -1.1, 3.0, -2.0]) == [7]
    assert _flag("nel8", [1.5, -1.5, 2.0, 0.5, 1.1, -1.1, 3.0, -2.0]) == []


def test_new_rules_through_the_chart() -> None:
    x = [10.0, 10.2, 10.4, 10.6, 10.8, 11.0, 11.2, 10.1, 9.9, 10.0]
    r = control_chart("imr", values=x, rules=["nel5"])
    assert r["panels"][0]["violations"][0]["indices"] == [5, 6]
    assert "nel5" not in [v["rule"] for v in r["panels"][1]["violations"]]  # MR panel: rule 1 only
