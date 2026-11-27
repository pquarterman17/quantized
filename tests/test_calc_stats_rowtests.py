"""Row-wise t-tests: pooled and Welch against scipy, hand values, missing cells."""

from __future__ import annotations

import numpy as np
import pytest
from scipy import stats

from quantized.calc.stats import t_test
from quantized.calc.stats_rowtests import MAX_ROWS, row_t_tests


def _blocks(seed: int = 3) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    return rng.normal(5.0, 1.0, (8, 3)), rng.normal(5.5, 2.0, (8, 4))


def _col(res: dict, key: str) -> np.ndarray:
    return np.array([np.nan if r[key] is None else r[key] for r in res["rows"]], dtype=float)


def test_pooled_matches_scipy_student_per_row() -> None:
    a, b = _blocks()
    res = row_t_tests(a, b, variance="pooled")
    ref = stats.ttest_ind(a, b, axis=1)
    np.testing.assert_allclose(_col(res, "t"), ref.statistic, rtol=1e-12)
    np.testing.assert_allclose(_col(res, "p"), ref.pvalue, rtol=1e-10)
    np.testing.assert_allclose(_col(res, "df"), 3 + 4 - 2)
    ci = ref.confidence_interval(0.95)
    np.testing.assert_allclose(_col(res, "ci_low"), ci.low, rtol=1e-10)
    np.testing.assert_allclose(_col(res, "ci_high"), ci.high, rtol=1e-10)
    np.testing.assert_allclose(_col(res, "diff"), a.mean(1) - b.mean(1), rtol=1e-12)
    assert "pooled" in res["method"]


def test_welch_matches_scipy_and_existing_t_test() -> None:
    a, b = _blocks()
    res = row_t_tests(a, b, variance="welch")
    ref = stats.ttest_ind(a, b, axis=1, equal_var=False)
    np.testing.assert_allclose(_col(res, "t"), ref.statistic, rtol=1e-12)
    np.testing.assert_allclose(_col(res, "p"), ref.pvalue, rtol=1e-10)
    np.testing.assert_allclose(_col(res, "df"), ref.df, rtol=1e-10)
    for i in range(a.shape[0]):
        old = t_test(a[i], b[i])
        np.testing.assert_allclose(res["rows"][i]["p"], old["pValue"], rtol=1e-8)
        np.testing.assert_allclose(res["rows"][i]["ci_low"], old["ci"][0], rtol=1e-8)


def test_default_variance_model_is_welch_like_the_single_t_test() -> None:
    a, b = _blocks()
    assert row_t_tests(a, b)["variance"] == "welch"
    welch = row_t_tests(a, b, variance="welch")
    np.testing.assert_allclose(_col(row_t_tests(a, b), "p"), _col(welch, "p"))


def test_pooled_and_welch_genuinely_differ() -> None:
    a, b = _blocks()
    pooled = _col(row_t_tests(a, b, variance="pooled"), "p")
    welch = _col(row_t_tests(a, b, variance="welch"), "p")
    assert np.abs(pooled - welch).max() > 1e-3


def test_hand_computed_pooled_row() -> None:
    # A = 1,2,3 (mean 2, var 1); B = 4,5,6,7 (mean 5.5, var 1.6667):
    # sp2 = (2*1 + 3*5/3)/5 = 7/5, se = sqrt(1.4*(1/3+1/4)) = 0.903696,
    # t = -3.5/0.903696 = -3.872983, df = 5.
    res = row_t_tests([[1, 2, 3]], [[4, 5, 6, 7]], variance="pooled")
    r = res["rows"][0]
    assert r["df"] == 5.0
    assert r["se"] == pytest.approx(np.sqrt(1.4 * 7.0 / 12.0))
    assert r["t"] == pytest.approx(-3.5 / np.sqrt(1.4 * 7.0 / 12.0))
    assert r["diff"] == pytest.approx(-3.5)
    assert r["p"] == pytest.approx(2 * stats.t.sf(abs(r["t"]), 5))


def test_one_sample_and_mu() -> None:
    a = np.array([[1.0, 2.0, 4.0, 5.0], [10.0, 11.0, 12.0, 15.0]])
    res = row_t_tests(a, design="one-sample", mu=3.0)
    ref = stats.ttest_1samp(a, 3.0, axis=1)
    np.testing.assert_allclose(_col(res, "t"), ref.statistic, rtol=1e-12)
    np.testing.assert_allclose(_col(res, "p"), ref.pvalue, rtol=1e-10)
    np.testing.assert_allclose(_col(res, "diff"), a.mean(1))
    assert res["variance"] is None


def test_paired_matches_ttest_rel_and_drops_incomplete_pairs() -> None:
    a, _ = _blocks()
    b = a + np.random.default_rng(1).normal(0.3, 0.5, a.shape)
    res = row_t_tests(a, b, design="paired")
    ref = stats.ttest_rel(a, b, axis=1)
    np.testing.assert_allclose(_col(res, "t"), ref.statistic, rtol=1e-12)
    np.testing.assert_allclose(_col(res, "p"), ref.pvalue, rtol=1e-10)
    a2, b2 = a.copy(), b.copy()
    a2[0, 0] = np.nan  # pair 0 of row 0 is incomplete
    r0 = row_t_tests(a2, b2, design="paired")["rows"][0]
    assert r0["n1"] == 2
    d = (a - b)[0, 1:]
    assert r0["t"] == pytest.approx(stats.ttest_1samp(d, 0.0).statistic)


def test_one_sided_p_values() -> None:
    a, b = _blocks()
    for alt in ("less", "greater"):
        res = row_t_tests(a, b, variance="pooled", alternative=alt)
        ref = stats.ttest_ind(a, b, axis=1, alternative=alt)
        np.testing.assert_allclose(_col(res, "p"), ref.pvalue, rtol=1e-10)


def test_missing_cells_dropped_within_row_and_untestable_rows_reported() -> None:
    a = [[1.0, 2.0, None, 4.0], [1.0, None, None, None], [3.0, 3.0, 3.0, 3.0]]
    b = [[2.0, 3.0, 9.0], [5.0, 6.0, 7.0], [3.0, 3.0, 3.0]]
    res = row_t_tests(a, b, variance="pooled")
    assert len(res["rows"]) == 3
    r0 = res["rows"][0]
    assert (r0["n1"], r0["n2"]) == (3, 3)
    assert r0["t"] == pytest.approx(stats.ttest_ind([1, 2, 4], [2, 3, 9]).statistic)
    # one value vs three: pooled still testable (df 2); Welch is not
    assert res["rows"][1]["status"] == "ok"
    assert row_t_tests(a, b, variance="welch")["rows"][1]["status"].startswith("too few")
    # zero variance everywhere in row 2: not tested, reason given, nothing invented
    r2 = res["rows"][2]
    assert r2["p"] is None and "zero variance" in r2["status"]
    assert res["n_tested"] == 2


def test_validation() -> None:
    a, b = _blocks()
    with pytest.raises(ValueError, match="second group"):
        row_t_tests(a)
    with pytest.raises(ValueError, match="same number of rows"):
        row_t_tests(a, b[:3])
    with pytest.raises(ValueError, match="same number of columns"):
        row_t_tests(a, b, design="paired")
    with pytest.raises(ValueError, match="design"):
        row_t_tests(a, b, design="x")
    with pytest.raises(ValueError, match="variance"):
        row_t_tests(a, b, variance="x")
    with pytest.raises(ValueError, match="alpha"):
        row_t_tests(a, b, alpha=1.5)
    with pytest.raises(ValueError, match="at least one row"):
        row_t_tests([1.0, 2.0], [1.0, 2.0])
    assert MAX_ROWS > 1000
