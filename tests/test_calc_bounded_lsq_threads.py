"""The bounded solver runs with BLAS pinned to one thread
(calc/_bounded_lsq.py module doc), and the pin survives overlapping fits
(calc/_blas_pin.py): it holds while ANY fit is inside, and the last one out --
from whichever thread -- restores the original count."""

from __future__ import annotations

import threading

import numpy as np
import pytest
import scipy.linalg  # noqa: F401  -- load scipy's BLAS (where it has its own) before threadpool_info
from numpy.typing import NDArray
from threadpoolctl import threadpool_info

from quantized.calc._blas_pin import single_thread_blas
from quantized.calc._bounded_lsq import solve_bounded


def _blas_threads() -> list[int]:
    return [int(p["num_threads"]) for p in threadpool_info() if p["user_api"] == "blas"]


# macOS wheels link Apple Accelerate, which threadpoolctl cannot see or limit:
# there the pin is a documented no-op, so these checks have nothing to measure.
_CONTROLLABLE = bool(_blas_threads())
needs_blas_pool = pytest.mark.skipif(
    not _CONTROLLABLE, reason="no threadpoolctl-controllable BLAS pool (e.g. macOS Accelerate)"
)


def test_solve_runs_single_threaded_blas_and_restores_it() -> None:
    before = _blas_threads()
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
    if not _CONTROLLABLE:  # the solve above still has to work where the pin is a no-op
        assert before == [] and all(t == [] for t in seen)


@needs_blas_pool
def test_overlapping_fits_keep_the_pin_and_the_last_one_out_restores() -> None:
    """A enters, B enters, A leaves while B still runs, B leaves (another
    thread): threadpoolctl's own `limit()` left B unpinned and the process
    pinned for good here."""
    before = _blas_threads()
    assert before and max(before) > 1, "needs a multi-threaded BLAS pool to mean anything"
    a_in, b_in, a_out = threading.Event(), threading.Event(), threading.Event()
    seen: dict[str, list[int]] = {}
    errors: list[BaseException] = []

    def run(fn: object) -> threading.Thread:
        def wrapped() -> None:
            try:
                fn()  # type: ignore[operator]
            except BaseException as e:  # surfaced below
                errors.append(e)
                a_in.set(), b_in.set(), a_out.set()

        return threading.Thread(target=wrapped)

    def fit_a() -> None:
        with single_thread_blas():
            seen["a"] = _blas_threads()
            a_in.set()
            assert b_in.wait(10)
        a_out.set()

    def fit_b() -> None:
        assert a_in.wait(10)
        with single_thread_blas():
            b_in.set()
            assert a_out.wait(10)
            seen["b_after_a"] = _blas_threads()

    ta, tb = run(fit_a), run(fit_b)
    ta.start(), tb.start()
    ta.join(20), tb.join(20)
    assert not errors, errors
    assert all(n == 1 for n in seen["a"])
    assert all(n == 1 for n in seen["b_after_a"])  # still pinned after A left
    assert _blas_threads() == before  # restored by B, from B's thread
    with single_thread_blas():  # and the pin still works afterwards
        assert all(n == 1 for n in _blas_threads())
    assert _blas_threads() == before
