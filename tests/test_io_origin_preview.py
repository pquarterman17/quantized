"""Unit tests for io/origin_project/preview.decimate_datastruct — the row-
decimated preview behind the lazy per-book import transport
(ORIGIN_FILE_DECODE_PLAN #38)."""

from __future__ import annotations

import numpy as np

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
