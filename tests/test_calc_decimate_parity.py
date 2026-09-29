"""Property test: the vectorized ``decimate_row_indices`` is INDEX-IDENTICAL
to the original per-bucket Python loop it replaced.

The loop below is that original algorithm, kept verbatim as a TEST-ONLY
reference (it made ~11k-27k numpy calls per request, which is why it was
replaced). Every case compares the full index array, not just its size, over
random data shaped to hit the edges the vectorized version handles with
masks instead of branches: NaN/inf sprinkles, long gaps, all-NaN buckets,
constant runs (min == max -> one pick), ties (first occurrence wins), and
fewer rows than buckets (identity).
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pytest
from numpy.typing import NDArray

from quantized.calc.decimate import decimate_row_indices


def _reference_series(y: NDArray[np.float64], bucket_count: int) -> list[int]:
    n = y.shape[0]
    out: list[int] = []
    bucket_size = n / bucket_count
    for b in range(bucket_count):
        start = int(b * bucket_size)
        end = n if b == bucket_count - 1 else int((b + 1) * bucket_size)
        if end <= start:
            continue
        chunk = y[start:end]
        finite = np.isfinite(chunk)
        if not finite.any():
            continue
        masked = np.where(finite, chunk, np.nan)
        min_idx = start + int(np.nanargmin(masked))
        max_idx = start + int(np.nanargmax(masked))
        if min_idx == max_idx:
            out.append(min_idx)
        else:
            out.append(min_idx)
            out.append(max_idx)
    return out


def _reference(series: Sequence[NDArray[np.float64]], buckets: int) -> NDArray[np.intp]:
    if not series:
        return np.array([], dtype=np.intp)
    n = series[0].shape[0]
    if n <= 0:
        return np.array([], dtype=np.intp)
    bucket_count = max(1, min(buckets, n))
    if n <= bucket_count:
        return np.arange(n, dtype=np.intp)
    picked: set[int] = set()
    for y in series:
        picked.update(_reference_series(y, bucket_count))
    return np.array(sorted(picked), dtype=np.intp)


def _random_series(rng: np.random.Generator, n: int) -> NDArray[np.float64]:
    kind = rng.integers(0, 5)
    if kind == 0:  # constant -> min == max in every bucket
        y = np.full(n, float(rng.normal()))
    elif kind == 1:  # heavy ties: a handful of discrete levels
        y = rng.integers(-2, 3, size=n).astype(float)
    elif kind == 2:  # random walk
        y = np.cumsum(rng.normal(size=n))
    else:
        y = rng.normal(size=n)
    if n and rng.random() < 0.7:  # NaN / inf sprinkle
        y[rng.random(n) < rng.uniform(0.01, 0.3)] = np.nan
        y[rng.random(n) < 0.01] = np.inf
        y[rng.random(n) < 0.01] = -np.inf
    if n > 10 and rng.random() < 0.5:  # a long gap -> all-NaN buckets
        a = int(rng.integers(0, n - 1))
        y[a : a + int(rng.integers(1, max(2, n // 3)))] = np.nan
    return y


@pytest.mark.parametrize("seed", range(300))
def test_vectorized_matches_the_loop_reference(seed: int) -> None:
    rng = np.random.default_rng(seed)
    n = int(rng.choice([0, 1, 2, 5, 17, 100, 1000, 4097, int(rng.integers(1, 20_000))]))
    buckets = int(rng.choice([-3, 0, 1, 2, 3, 7, 64, 1600, n, n + 5, max(1, n - 1)]))
    series = [_random_series(rng, n) for _ in range(int(rng.integers(1, 5)))]
    got = decimate_row_indices(series, buckets)
    want = _reference(series, buckets)
    assert got.dtype == want.dtype
    np.testing.assert_array_equal(got, want)


@pytest.mark.parametrize(
    ("n", "buckets"),
    [(3, 100), (10, 10), (11, 10), (1000, 999), (1000, 1), (7, 3), (100_003, 1600)],
)
def test_edge_shapes_match_the_loop_reference(n: int, buckets: int) -> None:
    rng = np.random.default_rng(n + buckets)
    y = rng.normal(size=n)
    y[::5] = np.nan
    all_nan = np.full(n, np.nan)
    const = np.full(n, 2.5)
    for series in ([y], [all_nan], [const], [y, all_nan, const]):
        np.testing.assert_array_equal(
            decimate_row_indices(series, buckets), _reference(series, buckets)
        )


def test_first_occurrence_wins_on_a_tied_extremum() -> None:
    # Two equal maxima (and two equal minima) in one bucket: the FIRST of
    # each is the pick, matching nanargmin/nanargmax and the frontend's
    # strict-`<`/`>` scan.
    y = np.array([0.0, 5.0, -1.0, 5.0, -1.0, 0.0, 0.0, 0.0])
    np.testing.assert_array_equal(decimate_row_indices([y], 2), [1, 2, 4, 5])
    np.testing.assert_array_equal(decimate_row_indices([y], 2), _reference([y], 2))


def test_signed_zero_tie_picks_the_first_zero() -> None:
    y = np.array([0.0, -0.0, 0.0, -0.0, 1.0, 1.0])
    np.testing.assert_array_equal(decimate_row_indices([y], 2), _reference([y], 2))
