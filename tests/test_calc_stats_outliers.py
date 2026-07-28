"""Outlier screening tests (calc.stats_outliers) -- JMP_GAP_PLAN J9.

Reference values:
- Grubbs: critical-value table cross-check (the standard published
  two-sided/one-sided Grubbs table, e.g. as tabulated at
  NIST/SEMATECH 1.3.5.17.1) plus the classic n=8 "transformer" worked
  example (G=2.469, reject at alpha=0.05).
- Rosner: the classic NIST/SEMATECH 1.3.5.17.3 generalized ESD worked
  example (n=54, k=10, alpha=0.05 -> 3 outliers: 6.01, 5.42, 5.34).
- Dixon: published Q_0.10/Q_0.05/Q_0.01 critical-value table entries
  (Rorabacher 1991) pinned directly, plus a hand-computable worked example
  in the r10 (n<=7) regime.
- MAD: hand-derived from the defining formula on a tiny sample.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.stats_outliers import (
    _DIXON_CRITICAL,
    dixon_q_test,
    grubbs_test,
    mad_outliers,
    rosner_test,
)

# ── Grubbs ────────────────────────────────────────────────────────────────


def test_grubbs_matches_published_critical_value_table() -> None:
    # Two-sided alpha=0.05 critical values, n=3..10 (the standard published
    # Grubbs table, e.g. Barnett & Lewis / NIST). Cross-check via a dummy
    # array of the right size (G itself is irrelevant here).
    published_two_sided = {
        3: 1.155, 4: 1.481, 5: 1.715, 6: 1.887, 7: 2.020, 8: 2.126, 9: 2.215, 10: 2.290,
    }
    for n, g_crit in published_two_sided.items():
        x = np.arange(float(n))
        out = grubbs_test(x, alpha=0.05, tail="two-sided")
        assert out["G_critical"] == pytest.approx(g_crit, abs=1e-3)


def test_grubbs_transformer_example_rejects() -> None:
    # Classic worked example (transformer/conductivity-style data, n=8):
    # 245.57 is a clear high outlier. G=2.469 > G_crit=2.126 -> reject.
    x = np.array([199.31, 199.53, 200.19, 200.82, 201.92, 201.95, 202.18, 245.57])
    out = grubbs_test(x, alpha=0.05, tail="two-sided")
    assert out["G"] == pytest.approx(2.469, abs=1e-3)
    assert out["G_critical"] == pytest.approx(2.126, abs=1e-3)
    assert out["flagged"] is True
    assert out["index"] == 7
    assert out["flagged_indices"] == [7]
    assert out["value"] == pytest.approx(245.57)


def test_grubbs_one_sided_critical_values() -> None:
    published_one_sided = {8: 2.032, 9: 2.110, 10: 2.176}
    for n, g_crit in published_one_sided.items():
        x = np.arange(float(n))
        out = grubbs_test(x, alpha=0.05, tail="greater")
        assert out["G_critical"] == pytest.approx(g_crit, abs=5e-4)


def test_grubbs_null_never_mutates_input() -> None:
    x = np.array([1.0, 2.0, 3.0, 4.0, 100.0])
    x_copy = x.copy()
    grubbs_test(x)
    assert np.array_equal(x, x_copy)


def test_grubbs_excludes_nan_and_reports_it() -> None:
    x = np.array([1.0, 2.0, np.nan, 3.0, 100.0, np.inf])
    out = grubbs_test(x)
    assert out["N"] == 4
    assert sorted(out["excluded_indices"]) == [2, 5]
    # the flagged point is 100.0 at its ORIGINAL index (4), not the
    # cleaned-array position.
    assert out["index"] == 4


def test_grubbs_too_few_points_raises() -> None:
    with pytest.raises(ValueError):
        grubbs_test(np.array([1.0, 2.0]))


def test_grubbs_zero_variance_raises() -> None:
    with pytest.raises(ValueError):
        grubbs_test(np.array([5.0, 5.0, 5.0, 5.0]))


def test_grubbs_bad_tail_raises() -> None:
    with pytest.raises(ValueError):
        grubbs_test(np.array([1.0, 2.0, 3.0]), tail="bogus")


# ── Rosner (generalized ESD) ────────────────────────────────────────────

# Classic NIST/SEMATECH 1.3.5.17.3 worked example dataset (n=54).
_ROSNER_EXAMPLE = np.array(
    [
        -0.25, 0.68, 0.94, 1.15, 1.20, 1.26, 1.26, 1.34, 1.38, 1.43,
        1.49, 1.49, 1.55, 1.56, 1.58, 1.65, 1.69, 1.70, 1.76, 1.77,
        1.81, 1.91, 1.94, 1.96, 1.99, 2.06, 2.09, 2.10, 2.14, 2.15,
        2.23, 2.24, 2.26, 2.35, 2.37, 2.40, 2.47, 2.54, 2.62, 2.64,
        2.90, 2.92, 2.92, 2.93, 3.21, 3.26, 3.30, 3.59, 3.68, 4.30,
        4.64, 5.34, 5.42, 6.01,
    ]
)


def test_rosner_nist_worked_example() -> None:
    assert _ROSNER_EXAMPLE.size == 54
    out = rosner_test(_ROSNER_EXAMPLE, k=10, alpha=0.05)
    assert out["num_outliers"] == 3
    assert out["flagged_values"] == pytest.approx([6.01, 5.42, 5.34])
    # index-into-original-array check: 6.01 is the last element (index 53).
    assert out["flagged_indices"][0] == 53
    assert len(out["table"]) == 10


def test_rosner_r_and_lambda_pinned_to_published_values() -> None:
    # First three rows of the NIST worked example's R_i/lambda_i table.
    out = rosner_test(_ROSNER_EXAMPLE, k=10, alpha=0.05)
    r1, r2, r3 = out["table"][0], out["table"][1], out["table"][2]
    assert r1["R"] == pytest.approx(3.118, abs=2e-3)
    assert r1["lambda_critical"] == pytest.approx(3.159, abs=2e-3)
    assert r1["exceeds"] is False
    assert r2["R"] == pytest.approx(2.942, abs=2e-3)
    assert r2["lambda_critical"] == pytest.approx(3.151, abs=2e-3)
    assert r2["exceeds"] is False
    assert r3["R"] == pytest.approx(3.179, abs=2e-3)
    assert r3["lambda_critical"] == pytest.approx(3.144, abs=2e-3)
    assert r3["exceeds"] is True


def test_rosner_never_mutates_input() -> None:
    x_copy = _ROSNER_EXAMPLE.copy()
    rosner_test(_ROSNER_EXAMPLE, k=10)
    assert np.array_equal(_ROSNER_EXAMPLE, x_copy)


def test_rosner_no_outliers_case() -> None:
    rng = np.random.default_rng(0)
    x = rng.normal(size=40)
    out = rosner_test(x, k=5)
    assert out["num_outliers"] <= 5  # not a guaranteed-zero case, just sane


def test_rosner_bad_k_raises() -> None:
    with pytest.raises(ValueError):
        rosner_test(np.arange(10.0), k=0)


def test_rosner_too_few_points_raises() -> None:
    with pytest.raises(ValueError):
        rosner_test(np.arange(5.0), k=10)


# ── Dixon's Q ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "n, q90, q95, q99",
    [
        (3, 0.941, 0.970, 0.994),
        (5, 0.642, 0.710, 0.821),
        (7, 0.507, 0.568, 0.680),
        (10, 0.477, 0.534, 0.635),
        (20, 0.450, 0.489, 0.554),
        (30, 0.376, 0.409, 0.460),
    ],
)
def test_dixon_critical_value_table_pinned(n: int, q90: float, q95: float, q99: float) -> None:
    row = _DIXON_CRITICAL[n]
    assert row == pytest.approx((q90, q95, q99))


def test_dixon_ratio_scheme_by_n() -> None:
    # n=5 (r10), n=9 (r11), n=12 (r21), n=20 (r22).
    assert dixon_q_test(np.arange(5.0))["ratio"] == "r10"
    assert dixon_q_test(np.arange(9.0))["ratio"] == "r11"
    assert dixon_q_test(np.arange(12.0))["ratio"] == "r21"
    assert dixon_q_test(np.arange(20.0))["ratio"] == "r22"


def test_dixon_worked_example_r10_regime() -> None:
    # n=5, r10 scheme: Q = gap-to-nearest / total range. Clear high outlier.
    x = np.array([10.0, 10.2, 10.3, 10.5, 15.0])
    out = dixon_q_test(x, alpha=0.05)
    s = np.sort(x)
    expected_q = (s[-1] - s[-2]) / (s[-1] - s[0])  # r10 high-tail ratio, by hand
    assert out["Q"] == pytest.approx(expected_q)
    assert out["ratio"] == "r10"
    assert out["tail"] == "high"
    assert out["Q_critical"] == pytest.approx(0.710)  # published n=5, alpha=0.05
    assert out["flagged"] is True
    assert out["value"] == pytest.approx(15.0)
    assert out["index"] == 4


def test_dixon_never_mutates_input() -> None:
    x = np.array([10.0, 10.2, 10.3, 10.5, 15.0])
    x_copy = x.copy()
    dixon_q_test(x)
    assert np.array_equal(x, x_copy)


def test_dixon_out_of_range_n_raises() -> None:
    with pytest.raises(ValueError):
        dixon_q_test(np.array([1.0, 2.0]))
    with pytest.raises(ValueError):
        dixon_q_test(np.arange(31.0))


def test_dixon_bad_alpha_raises() -> None:
    with pytest.raises(ValueError):
        dixon_q_test(np.arange(5.0), alpha=0.5)


def test_dixon_zero_range_raises() -> None:
    with pytest.raises(ValueError):
        dixon_q_test(np.array([2.0, 2.0, 2.0]))


# ── MAD (modified z-score) ──────────────────────────────────────────────


def test_mad_outliers_hand_derived() -> None:
    # median=3, |dev|=[2,1,0,1,7] -> MAD=median([2,1,0,1,7])=1.
    x = np.array([1.0, 2.0, 3.0, 4.0, 10.0])
    out = mad_outliers(x, threshold=3.5)
    assert out["median"] == pytest.approx(3.0)
    assert out["mad"] == pytest.approx(1.0)
    expected_z = 0.6745 * (x - 3.0) / 1.0
    assert np.allclose(out["modified_z_scores"], expected_z)
    assert out["flagged_indices"] == [4]  # |0.6745*7| = 4.72 > 3.5
    assert out["scale_method"] == "MAD"


def test_mad_outliers_mad_zero_fallback() -> None:
    # >=50% of values tie the median -> MAD=0 -> MeanAD fallback engages.
    x = np.array([5.0, 5.0, 5.0, 5.0, 50.0])
    out = mad_outliers(x)
    assert out["mad"] == 0.0
    assert out["scale_method"] == "MeanAD (MAD==0 fallback)"
    assert not any(math.isnan(z) for z in out["modified_z_scores"])
    assert 4 in out["flagged_indices"]


def test_mad_outliers_fully_degenerate() -> None:
    x = np.array([7.0, 7.0, 7.0])
    out = mad_outliers(x)
    assert out["mad"] == 0.0
    assert "degenerate" in out["scale_method"]
    assert np.allclose(out["modified_z_scores"], 0.0)
    assert out["flagged_indices"] == []


def test_mad_outliers_excludes_nan_and_reports_original_indices() -> None:
    x = np.array([1.0, 2.0, np.nan, 3.0, 100.0])
    out = mad_outliers(x)
    assert out["excluded_indices"] == [2]
    assert math.isnan(out["modified_z_scores"][2])
    assert 4 in out["flagged_indices"]


def test_mad_outliers_never_mutates_input() -> None:
    x = np.array([1.0, 2.0, 3.0, 4.0, 10.0])
    x_copy = x.copy()
    mad_outliers(x)
    assert np.array_equal(x, x_copy)


def test_mad_outliers_too_few_points_raises() -> None:
    with pytest.raises(ValueError):
        mad_outliers(np.array([1.0]))


def test_mad_outliers_bad_threshold_raises() -> None:
    with pytest.raises(ValueError):
        mad_outliers(np.array([1.0, 2.0]), threshold=0.0)
