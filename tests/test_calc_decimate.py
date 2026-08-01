"""Unit tests for the pure min/max-bucket decimation module (calc/decimate.py).

Mirrors the frontend's plotDecimate.ts test coverage where the semantics
overlap (short-series identity, per-bucket min/max, union across series) plus
the numpy-specific edge cases (NaN handling, empty input, ascending check).
"""

from __future__ import annotations

import numpy as np

from quantized.calc.decimate import decimate_columns, decimate_row_indices, is_ascending


def test_short_series_returns_every_index_unchanged() -> None:
    y = np.array([3.0, 1.0, 2.0])
    rows = decimate_row_indices([y], buckets=100)
    assert rows.tolist() == [0, 1, 2]


def test_exact_bucket_count_boundary_is_identity() -> None:
    # n == buckets: still "n <= bucket_count", so identity, not bucketed.
    y = np.arange(10, dtype=float)
    rows = decimate_row_indices([y], buckets=10)
    assert rows.tolist() == list(range(10))


def test_constant_series_picks_one_point_per_bucket() -> None:
    # Every value identical -> min index == max index in every bucket, so
    # each bucket contributes exactly ONE row, not two.
    y = np.full(1000, 5.0)
    rows = decimate_row_indices([y], buckets=10)
    assert len(rows) == 10  # one pick per bucket, no duplicate min/max pair


def test_narrow_spike_survives_decimation() -> None:
    # A single-sample spike buried in an otherwise flat 10,000-row series,
    # bucketed down to 100 buckets (100 rows/bucket) -- the spike's bucket
    # must report the spike's own index as its max.
    y = np.zeros(10_000)
    spike_idx = 4_321
    y[spike_idx] = 999.0
    rows = decimate_row_indices([y], buckets=100)
    assert spike_idx in rows.tolist()


def test_nan_rows_are_never_picked_when_finite_alternatives_exist() -> None:
    y = np.array([np.nan, 1.0, np.nan, 5.0, np.nan])
    rows = decimate_row_indices([y], buckets=1)
    assert set(rows.tolist()) == {1, 3}  # min=1.0 at row1, max=5.0 at row3


def test_all_nan_bucket_contributes_nothing() -> None:
    y = np.array([np.nan, np.nan, np.nan, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    # 3 buckets of 3 rows each: bucket 0 is all-NaN.
    rows = decimate_row_indices([y], buckets=3)
    assert 0 not in rows.tolist()
    assert 1 not in rows.tolist()
    assert 2 not in rows.tolist()


def test_union_across_series_keeps_each_series_own_extrema() -> None:
    # Two series whose extrema fall on DIFFERENT rows within the same single
    # bucket -- both must survive (a shared pick would flatten one of them).
    a = np.array([0.0, 0.0, 10.0, 0.0])  # max at row 2
    b = np.array([0.0, -10.0, 0.0, 0.0])  # min at row 1
    rows = decimate_row_indices([a, b], buckets=1)
    assert 1 in rows.tolist()
    assert 2 in rows.tolist()


def test_empty_series_list_returns_empty_indices() -> None:
    rows = decimate_row_indices([], buckets=10)
    assert rows.tolist() == []


def test_zero_length_series_returns_empty_indices() -> None:
    rows = decimate_row_indices([np.array([])], buckets=10)
    assert rows.tolist() == []


def test_indices_are_ascending_and_deduped() -> None:
    a = np.sin(np.linspace(0, 20, 5000))
    b = np.cos(np.linspace(0, 20, 5000))
    rows = decimate_row_indices([a, b], buckets=50).tolist()
    assert rows == sorted(set(rows))


def test_decimate_columns_gathers_x_and_series_by_the_same_row_set() -> None:
    x = np.arange(100, dtype=float)
    y = np.zeros(100)
    y[7] = 5.0
    y[93] = -5.0
    new_x, new_series = decimate_columns(x, [y], buckets=10)
    assert len(new_x) == len(new_series[0])
    # x is gathered by the same rows y was picked from, so they stay paired.
    for xi, yi in zip(new_x.tolist(), new_series[0].tolist(), strict=True):
        assert y[int(xi)] == yi


def test_decimate_columns_with_no_series_returns_x_unchanged() -> None:
    x = np.arange(50, dtype=float)
    new_x, new_series = decimate_columns(x, [], buckets=5)
    assert new_x is x
    assert new_series == []


def test_reduces_row_count_for_a_large_dense_series() -> None:
    n = 100_000
    y = np.sin(np.linspace(0, 200, n))
    rows = decimate_row_indices([y], buckets=200)
    assert len(rows) < n / 10  # a real, large reduction


# ── is_ascending ────────────────────────────────────────────────────────────


def test_is_ascending_true_for_sorted_x() -> None:
    assert is_ascending(np.array([1.0, 2.0, 2.0, 5.0]))


def test_is_ascending_false_for_a_hysteresis_style_sweep() -> None:
    assert not is_ascending(np.array([0.0, 1.0, 2.0, 1.0, 0.0]))


def test_is_ascending_skips_non_finite_gaps() -> None:
    assert is_ascending(np.array([1.0, np.nan, 2.0, np.inf, 3.0]))


def test_is_ascending_true_for_short_or_empty_input() -> None:
    assert is_ascending(np.array([]))
    assert is_ascending(np.array([1.0]))
