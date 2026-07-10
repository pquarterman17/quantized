"""Unit tests for io/origin_project/preview.decimate_datastruct — the row-
decimated preview behind the lazy per-book import transport
(ORIGIN_FILE_DECODE_PLAN #38)."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.origin_project.preview import decimate_datastruct


def _ds(n: int, m: int = 2) -> DataStruct:
    time = np.arange(n, dtype=float)
    values = np.column_stack([np.sin(time / 7.0 + k) * (k + 1) for k in range(m)])
    return DataStruct(time=time, values=values, labels=[f"ch{k}" for k in range(m)])


def test_short_series_passes_through_unchanged() -> None:
    ds = _ds(50)
    out = decimate_datastruct(ds, target_points=200)
    assert out is ds


def test_empty_channels_pass_through_unchanged() -> None:
    ds = DataStruct(time=np.arange(500, dtype=float), values=np.empty((500, 0)))
    out = decimate_datastruct(ds, target_points=200)
    assert out is ds


def test_decimates_to_about_target_points() -> None:
    ds = _ds(10_000)
    out = decimate_datastruct(ds, target_points=200)
    assert out.n_points <= 200
    # bucketing keeps min+max per bucket, so it should land reasonably close
    # to the target, not collapse to a handful of rows.
    assert out.n_points > 150


def test_preserves_labels_units_metadata() -> None:
    ds = DataStruct(
        time=np.arange(1000, dtype=float),
        values=np.random.default_rng(0).normal(size=(1000, 3)),
        labels=("A", "B", "C"),
        units=("V", "A", "W"),
        metadata={"origin_book": "Book1"},
    )
    out = decimate_datastruct(ds, target_points=100)
    assert out.labels == ds.labels
    assert out.units == ds.units
    assert dict(out.metadata) == dict(ds.metadata)
    assert out.n_points < ds.n_points


def test_preserves_spike_a_stride_sample_would_miss() -> None:
    n = 5000
    y = np.zeros(n)
    spike_idx = 2500
    y[spike_idx] = 1000.0  # a single-sample spike between any plain stride
    ds = DataStruct(time=np.arange(n, dtype=float), values=y.reshape(-1, 1))
    out = decimate_datastruct(ds, target_points=100)
    assert float(np.max(out.values[:, 0])) == 1000.0


def test_all_nan_channel_does_not_crash() -> None:
    n = 1000
    values = np.column_stack([np.full(n, np.nan), np.arange(n, dtype=float)])
    ds = DataStruct(time=np.arange(n, dtype=float), values=values)
    out = decimate_datastruct(ds, target_points=100)
    assert out.n_points > 0
    assert out.n_points <= 100


def test_rows_kept_stay_time_sorted() -> None:
    ds = _ds(3000)
    out = decimate_datastruct(ds, target_points=150)
    assert np.all(np.diff(out.time) >= 0)


def test_bucket_with_no_finite_values_keeps_a_placeholder_row() -> None:
    """A gap in the densest channel spanning an entire bucket must not crash
    or shrink the output below what the other buckets contribute."""
    n = 2000
    y = np.arange(n, dtype=float)
    y[900:1100] = np.nan  # a NaN gap roughly one bucket wide (100 buckets @ n=2000)
    ds = DataStruct(time=np.arange(n, dtype=float), values=y.reshape(-1, 1))
    out = decimate_datastruct(ds, target_points=100)
    assert out.n_points > 0
    assert out.n_points <= 100


# Trailing-padding pruning (Library thumbnail-mismatch fix, PNR Book15): Origin
# over-allocated worksheet storage leaves rows at the END of a book that are
# either non-finite everywhere or an exact simultaneous 0.0 across time+every
# channel. Verified byte-for-byte against PNR.opj Book15 (180 rows, 19
# trailing all-zero -- Q collapses back to 0.0, breaking x-ascending and
# dragging the sparkline toward the origin instead of tracing the real curve).


def test_prunes_trailing_all_zero_rows_before_decimating() -> None:
    n = 180
    time = np.linspace(0.005, 0.14, 161)
    time = np.concatenate([time, np.zeros(n - 161)])
    values = np.column_stack(
        [
            np.linspace(0.0009, 0.0013, 161),  # dQ-like: never touches 0 in real data
            np.linspace(1.0, 0.5, 161),  # R++-like
        ]
    )
    values = np.concatenate([values, np.zeros((n - 161, 2))])
    ds = DataStruct(time=time, values=values, labels=("dQ", "R++"))
    out = decimate_datastruct(ds, target_points=200)  # 180 <= 200: passthrough path
    assert out.n_points == 161
    assert float(out.time.min()) > 0.0
    assert float(out.time.max()) == pytest.approx(0.14)
    assert np.all(np.diff(out.time) >= 0)


def test_prunes_trailing_padding_then_decimates_when_still_over_target() -> None:
    n = 10_000
    real_n = 9_500
    real_time = np.linspace(0, 100, real_n)
    real_values = (real_time + 1.0).reshape(-1, 1)  # always >= 1, never touches 0
    time = np.concatenate([real_time, np.zeros(n - real_n)])
    values = np.concatenate([real_values, np.zeros((n - real_n, 1))])
    ds = DataStruct(time=time, values=values, labels=("y",))
    out = decimate_datastruct(ds, target_points=200)
    assert out.n_points <= 200
    assert float(out.time.max()) <= 100.0 + 1e-9
    assert float(np.min(out.values)) >= 1.0  # no zero-padding row survived decimation


def test_prunes_trailing_all_nan_rows() -> None:
    time = np.concatenate([np.arange(80, dtype=float), np.full(20, np.nan)])
    values = np.concatenate([np.arange(80, dtype=float), np.full(20, np.nan)]).reshape(-1, 1)
    ds = DataStruct(time=time, values=values, labels=("y",))
    out = decimate_datastruct(ds, target_points=200)
    assert out.n_points == 80


def test_leaves_interior_all_zero_row_in_place() -> None:
    n = 50
    time = np.arange(n, dtype=float)
    values = np.arange(n, dtype=float).reshape(-1, 1)
    time[25] = 0.0
    values[25, 0] = 0.0
    ds = DataStruct(time=time, values=values, labels=("y",))
    out = decimate_datastruct(ds, target_points=200)
    assert out.n_points == n  # interior zero row is not the trailing tail


def test_no_trailing_padding_returns_identity() -> None:
    ds = _ds(50)
    out = decimate_datastruct(ds, target_points=200)
    assert out is ds


def test_does_not_prune_a_genuine_zero_only_x_column() -> None:
    # No value channels at all -- an all-zero `.time` alone is real data, not
    # padding (mirrors the frontend's x-only-payload carve-out).
    ds = DataStruct(time=np.zeros(50), values=np.empty((50, 0)))
    out = decimate_datastruct(ds, target_points=200)
    assert out.n_points == 50
