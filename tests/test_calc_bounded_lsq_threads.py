"""The bounded solver runs with BLAS pinned to one thread (calc/_bounded_lsq.py
module doc: oversubscribed OpenBLAS threads made a 20-peak fit miss its
deadline on a loaded machine), and releases the pin afterwards."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from threadpoolctl import threadpool_info

from quantized.calc._bounded_lsq import solve_bounded


def _blas_threads() -> list[int]:
    return [int(p["num_threads"]) for p in threadpool_info() if p["user_api"] == "blas"]


def test_solve_runs_single_threaded_blas_and_restores_it() -> None:
    before = _blas_threads()
    assert before, "numpy/scipy load a BLAS pool"
    seen: list[list[int]] = []
    x = np.linspace(0.0, 1.0, 50)
    y = 2.0 * x + 1.0

    def residuals(p: NDArray[np.float64]) -> NDArray[np.float64]:
        seen.append(_blas_threads())
        return np.asarray(p[0] * x + p[1] - y, dtype=float)

    x0 = np.array([1.0, 0.0])
    fit = solve_bounded(residuals, x0, (-10.0, 10.0), max_nfev=100, deadline_s=None)
    assert fit.success
    np.testing.assert_allclose(fit.x, [2.0, 1.0], atol=1e-8)
    assert seen and all(all(n == 1 for n in threads) for threads in seen)
    assert _blas_threads() == before
