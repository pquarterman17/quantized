"""t-test + one-way ANOVA: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.stats import anova1, t_test


@pytest.mark.golden
def test_ttest_one_sample_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_ttest_onesample.json")
    out = t_test(np.asarray(g["input"]["x"], dtype=float), mu=float(g["params"]["mu"]))
    compare_calc(out, g["output"])


@pytest.mark.golden
def test_ttest_two_sample_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_ttest_twosample.json")
    out = t_test(
        np.asarray(g["input"]["x"], dtype=float),
        np.asarray(g["input"]["y"], dtype=float),
    )
    compare_calc(out, g["output"])


@pytest.mark.golden
def test_anova1_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_anova1.json")
    groups = [np.asarray(col, dtype=float) for col in g["input"]]
    out = anova1(groups)
    compare_calc(out, g["output"])


def test_ttest_paired_zero_difference() -> None:
    # Identical vectors -> mean diff 0, p-value 1, no rejection.
    x = np.array([1.0, 2.0, 3.0, 4.0])
    r = t_test(x, x, paired=True)
    assert r["testType"] == "paired"
    assert r["meanDiff"] == pytest.approx(0.0)
    assert r["pValue"] == pytest.approx(1.0)
    assert r["reject"] is False


def test_ttest_paired_length_mismatch() -> None:
    with pytest.raises(ValueError, match="equal-length"):
        t_test(np.array([1.0, 2.0, 3.0]), np.array([1.0, 2.0]), paired=True)


def test_anova1_requires_two_groups() -> None:
    with pytest.raises(ValueError, match="at least 2"):
        anova1([np.array([1.0, 2.0, 3.0])])


def test_anova1_identical_groups_no_effect() -> None:
    g = [np.array([1.0, 2.0, 3.0]), np.array([1.0, 2.0, 3.0]), np.array([1.0, 2.0, 3.0])]
    r = anova1(g)
    assert r["fStat"] == pytest.approx(0.0)
    assert r["pValue"] == pytest.approx(1.0)
    assert r["reject"] is False


# ── insufficient-sample guards (were ZeroDivisionError) ──────────────────────


def test_ttest_one_sample_too_few_raises() -> None:
    with pytest.raises(ValueError, match="at least 2"):
        t_test(np.array([5.0]))


def test_ttest_all_nan_drops_to_zero_and_raises() -> None:
    with pytest.raises(ValueError, match="at least 2"):
        t_test(np.array([float("nan")] * 5))


def test_ttest_two_sample_singleton_group_raises() -> None:
    with pytest.raises(ValueError, match="2 observations per group"):
        t_test(np.array([5.0]), np.array([1.0, 2.0, 3.0]))
