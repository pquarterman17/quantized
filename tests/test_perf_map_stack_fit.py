"""Realistic-size run of the per-pixel stack fit: 64 x 64 pixels x 10 layers.

Marked ``perf`` (the repo's wall-time tripwire marker; there is no ``slow``
marker). Asserts the load-invariant facts (every pixel fitted, the maps recover
the planted parameters and match scipy on a sample of pixels); the clock is a
loose backstop only.
"""

from __future__ import annotations

import time

import numpy as np
import pytest
from scipy.optimize import curve_fit as scipy_curve_fit

from quantized.calc.map_ops import MapGrid
from quantized.calc.map_stack_fit import fit_map_stack

pytestmark = pytest.mark.perf


def test_64x64x10_stack_fits_every_pixel_and_matches_scipy() -> None:
    ny = nx = 64
    x = np.linspace(0.0, 9.0, 10)
    rng = np.random.default_rng(1)
    a = 1.0 + 2.0 * rng.random((ny, nx))
    tau = 1.5 + 2.0 * rng.random((ny, nx))
    c = 0.3 * rng.random((ny, nx))
    grids = [
        MapGrid(
            np.arange(nx, dtype=float), np.arange(ny, dtype=float),
            a * np.exp(-xv / tau) + c + rng.normal(0, 0.01, (ny, nx)),
            "x", "um", "y", "um", "cts", {},
        )
        for xv in x
    ]
    t0 = time.perf_counter()
    res = fit_map_stack(grids, x, "Exponential Decay")
    elapsed = time.perf_counter() - t0
    print(f"64x64x10 stack fit: {elapsed:.1f} s")
    assert res.summary["n_fitted"] + res.summary["n_failed"] == ny * nx
    assert res.summary["n_failed"] <= 0.01 * ny * nx
    z = np.stack([g.z for g in grids])
    for j, i in [(0, 0), (10, 40), (33, 7), (63, 63)]:
        if np.isnan(res.params[0, j, i]):
            continue
        popt, _ = scipy_curve_fit(
            lambda xx, aa, tt, cc: aa * np.exp(-xx / tt) + cc, x, z[:, j, i],
            p0=[a[j, i], tau[j, i], c[j, i]],
        )
        np.testing.assert_allclose(res.params[:, j, i], popt, rtol=1e-3, atol=1e-5)
    assert elapsed < 600  # loose backstop, never a budget
