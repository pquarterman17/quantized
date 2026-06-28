"""Baseline estimation: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.baseline import baseline_als, estimate_background


@pytest.mark.golden
def test_baseline_als_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_baseline_als.json")
    out = baseline_als(np.asarray(g["input"], dtype=float))
    # ALS uses an iterative sparse solve; allow a slightly looser tolerance.
    compare_calc(out, g["output"], rtol=1e-6, atol=1e-6)


def test_baseline_als_tracks_lower_envelope(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_baseline_als.json")
    y = np.asarray(g["input"], dtype=float)
    bl = baseline_als(y)
    assert bl.shape == y.shape
    assert np.all(np.isfinite(bl))
    # Peaks pull the data well above the baseline, so on average bl < y.
    assert float(np.mean(bl)) < float(np.mean(y))


# ── non-finite-input robustness ──────────────────────────────────────────────


def test_baseline_als_nonfinite_returns_nan_like_matlab() -> None:
    """A NaN in y propagates to an all-NaN baseline (MATLAB backslash parity),
    returned directly to avoid a noisy MatrixRankWarning — not an exception."""
    y = np.sin(np.linspace(0, 10, 50))
    y[10] = np.nan
    out = baseline_als(y)
    assert out.shape == y.shape
    assert np.isnan(out).all()


def test_estimate_background_snip_nan_in_x_no_crash() -> None:
    """A NaN in x makes dx NaN; the SNIP guard must short-circuit, not raise
    'cannot convert float NaN to integer'."""
    x = np.linspace(0.0, 10.0, 40)
    x[5] = np.nan
    bg = estimate_background(x, np.abs(np.sin(x)), method="snip")
    assert bg.shape == x.shape
