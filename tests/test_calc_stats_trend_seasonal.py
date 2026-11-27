"""Seasonal Mann-Kendall: hand case, exact permutation variance, pymannkendall numbers, refusals."""

from __future__ import annotations

import itertools
import math

import numpy as np
import pytest
from scipy import stats as sps

from quantized.calc.stats_trend_seasonal import seasonal_mann_kendall as smk

# pymannkendall 1.4.3 seasonal_test(Y, period=4) on this series (run offline, values frozen here).
Y20 = [3, 5, 2, 8, 4, 6, 2, 9, 4, 7, 3, 9, 6, 7, 5, 12, 5, 8, 4, 11]
PMK = {
    "S": 30,
    "var_S": 62.666666666666664,
    "Z": 3.6633608566393576,
    "p": 0.0002489274639532191,
    "sen_slope_per_year": 0.6666666666666666,
    "intercept": 3.916666666666667,
}


def test_hand_case_two_seasons() -> None:
    # season A rises (S=3), season B = 3,1,2 (signs -,-,+ so S=-1); each n=3 has var 3*2*11/18.
    y = [1, 3, 2, 1, 3, 2]
    r = smk(y, [0, 0, 1, 1, 2, 2], season=["A", "B"] * 3)
    assert (r["S"], r["n"], r["n_seasons"], r["n_pairs"]) == (2, 6, 2, 6)
    assert r["var_S"] == pytest.approx(2 * 66 / 18)
    z = (2 - 1) / math.sqrt(2 * 66 / 18)
    assert r["Z"] == pytest.approx(z, rel=1e-12)
    assert r["p"] == pytest.approx(2 * sps.norm.sf(z), rel=1e-12)
    # pooled slopes: A 1,1,1; B -2,-0.5,1 -> sorted -2,-.5,1,1,1,1 -> median 1
    assert r["sen_slope"] == pytest.approx(1.0)
    assert [(s["season"], s["S"]) for s in r["seasons"]] == [("A", 3), ("B", -1)]


def test_matches_pymannkendall_numbers() -> None:
    r = smk(Y20, period=4)
    assert r["S"] == PMK["S"]
    for ours, theirs in [
        ("var_S", "var_S"),
        ("Z", "Z"),
        ("p", "p"),
        ("sen_intercept", "intercept"),
    ]:
        assert r[ours] == pytest.approx(PMK[theirs], rel=1e-12)
    # period mode steps per observation; pymannkendall reports per year (4 steps)
    assert r["sen_slope"] * 4 == pytest.approx(PMK["sen_slope_per_year"], rel=1e-12)
    by_year = smk(Y20, [i // 4 for i in range(20)], season=[i % 4 for i in range(20)])
    assert by_year["sen_slope"] == pytest.approx(PMK["sen_slope_per_year"], rel=1e-12)
    assert by_year["S"] == 30 and by_year["var_S"] == pytest.approx(PMK["var_S"])


def _perm_stats(vals: list[float]) -> tuple[float, float]:
    """Mean and variance of S over every ordering of the observed values (the null)."""
    n = len(vals)
    ss = [
        sum(np.sign(p[j] - p[i]) for i in range(n) for j in range(i + 1, n))
        for p in itertools.permutations(vals)
    ]
    return float(np.mean(ss)), float(np.var(ss))


def test_variance_equals_exact_permutation_variance_with_ties() -> None:
    seasons = {"a": [2.0, 2.0, 5.0, 1.0, 5.0], "b": [4.0, 4.0, 4.0, 1.0], "c": [7.0, 3.0, 3.0, 9.0]}
    y = [v for vals in seasons.values() for v in vals]
    x = [i for vals in seasons.values() for i in range(len(vals))]
    lab = [k for k, vals in seasons.items() for _ in vals]
    r = smk(y, x, season=lab)
    exact = sum(_perm_stats(vals)[1] for vals in seasons.values())
    assert r["var_S"] == pytest.approx(exact, rel=1e-12)
    assert {s["season"]: s["tie_groups"] for s in r["seasons"]} == {"a": 2, "b": 1, "c": 1}
    # S per season from scipy's tau-b (x distinct, so n0 - n1 uses y ties only)
    for s in r["seasons"]:
        vals = seasons[s["season"]]
        tau = sps.kendalltau(range(len(vals)), vals).statistic
        n0 = len(vals) * (len(vals) - 1) / 2
        n1 = sum(c * (c - 1) / 2 for c in np.unique(vals, return_counts=True)[1])
        assert s["S"] == pytest.approx(tau * math.sqrt(n0 * (n0 - n1)), abs=1e-9)


def test_missing_season_and_thin_season_are_reported() -> None:
    # season "C" has a single observation, "A" misses year 1: A has n=2.
    y = [1, 2, 9, 4, 3, 5]
    x = [0, 2, 0, 0, 1, 2]
    lab = ["A", "A", "C", "B", "B", "B"]
    r = smk(y, x, season=lab)
    assert r["skipped_seasons"] == [
        {"season": "C", "n": 1, "reason": "fewer than 2 observations (needs at least 2 years)"}
    ]
    assert [s["season"] for s in r["seasons"]] == ["A", "B"] and r["n"] == 5


def test_nonfinite_dropped_and_string_labels_sorted() -> None:
    r = smk(
        [1, float("nan"), 3, 2, 5, 6], [0, 1, 2, 0, 1, 2], season=["b", "b", "b", "a", "a", "a"]
    )
    assert [s["season"] for s in r["seasons"]] == ["a", "b"] and r["n"] == 5


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"y": [1, 2, 3, 4], "x": [0, 1, 2, 3], "season": [1, 2, 3, 4]}, "at least 2 observations"),
        (
            {"y": [1, 2, 3, 4], "x": [0, 0, 1, 1], "season": [1, 1, 1, 1]},
            "repeated inside the season",
        ),
        ({"y": [5, 5, 5, 5], "x": [0, 1, 2, 3], "season": [1, 1, 2, 2]}, "every value is tied"),
        ({"y": [1, 2, 3, 4]}, "either as a column"),
        ({"y": [1, 2, 3, 4], "season": [1, 2, 1, 2], "period": 2}, "either as a column"),
        ({"y": [1, 2, 3, 4], "x": [0, 0.5, 1, 1.5], "period": 2}, "whole-number"),
        ({"y": [1, 2, 3, 4], "period": 1}, "whole number from 2"),
        ({"y": [1, 2, 3, 4], "season": [1, 2], "x": [0, 1, 2, 3]}, "same length"),
        ({"y": [1, 2, 3, 4], "period": 2, "alpha": 1.5}, "alpha"),
    ],
)
def test_refusals_say_why(kwargs: dict, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        smk(**kwargs)


def test_trend_label_and_direction() -> None:
    dec = smk([-v for v in Y20], period=4)
    assert (
        dec["trend"] == "decreasing"
        and dec["S"] == -30
        and dec["Z"] == pytest.approx(-3.6633608566393576)
    )
    assert smk(Y20, period=4)["trend"] == "increasing"


def test_period_mode_drops_non_finite_times_instead_of_refusing() -> None:
    x = [float(i) for i in range(20)]
    x[3] = float("nan")
    r = smk(Y20, x, period=4)
    assert r["n"] == 19 and r["n_seasons"] == 4
