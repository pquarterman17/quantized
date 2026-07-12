"""bumps optional fit engine (GOTO #10) — calc adapter tests.

Deliberately NOT golden: bumps has no quantized_matlab counterpart (it is an
ADDITIONAL engine; the parity engine ``calc.fitting`` stays golden-locked), so
per the golden-tests rule these are reference-value tests on clean synthetic
data (deterministic engines) and seeded invariant tests (DREAM posterior:
medians near truth, intervals bracket, progress/abort plumbing) — never
frozen-value comparisons.
"""

from __future__ import annotations

import sys

import numpy as np
import pytest

from quantized.calc.fit_bumps import (
    BUMPS_ENGINES,
    RHAT_THRESHOLD,
    bumps_available,
    fit_bumps,
)

TRUE = [2.0, 0.5, 1.2]  # Gaussian A, mu, sigma
P0 = [1.0, 0.0, 1.0]
LB = [0.0, -5.0, 0.01]
UB = [10.0, 5.0, 10.0]


def _gaussian_data(noise: float = 0.0, n: int = 201) -> tuple[
    np.ndarray, np.ndarray, np.ndarray
]:
    x = np.linspace(-5.0, 5.0, n)
    y = TRUE[0] * np.exp(-((x - TRUE[1]) ** 2) / (2 * TRUE[2] ** 2))
    if noise > 0:
        rng = np.random.default_rng(7)
        y = y + rng.normal(0.0, noise, n)
    dy = np.full(n, max(noise, 0.02))
    return x, np.asarray(y, dtype=float), dy


def test_engine_tuple_and_availability() -> None:
    assert BUMPS_ENGINES == ("amoeba", "lm", "de", "dream")
    assert bumps_available()  # bumps ships in the dev dependency group


@pytest.mark.parametrize("engine", ["amoeba", "lm", "de"])
def test_fast_engines_recover_gaussian(engine: str) -> None:
    """Reference-value: clean synthetic Gaussian -> known parameters."""
    x, y, dy = _gaussian_data(noise=0.0)
    result = fit_bumps(
        x, y, dy, model="Gaussian", p0=P0, lower=LB, upper=UB, engine=engine
    )
    assert result["engine"] == engine
    assert result["uncertainty_kind"] == "hessian"
    assert result["paramNames"] == ["A", "μ", "σ"]  # registry names
    np.testing.assert_allclose(result["popt"], TRUE, rtol=1e-3)
    np.testing.assert_allclose(result["yFit"], y, atol=2e-3)
    assert result["chisq"] < 0.1  # essentially perfect fit
    assert len(result["uncertainties"]) == 3


def test_callable_model_and_default_names() -> None:
    """A raw f(x, p) callable works without the registry."""

    def line(x: np.ndarray, p: np.ndarray) -> np.ndarray:
        return np.asarray(p[0] * x + p[1], dtype=float)

    x = np.linspace(0.0, 10.0, 50)
    y = np.asarray(3.0 * x - 1.5, dtype=float)
    result = fit_bumps(x, y, model=line, p0=[1.0, 0.0], engine="amoeba")
    np.testing.assert_allclose(result["popt"], [3.0, -1.5], rtol=1e-3, atol=1e-6)
    assert result["paramNames"] == ["p1", "p2"]


def test_input_validation() -> None:
    x, y, dy = _gaussian_data()
    with pytest.raises(ValueError, match="unknown bumps engine"):
        fit_bumps(x, y, model="Gaussian", p0=P0, engine="newton")
    with pytest.raises(ValueError, match="unknown fit model"):
        fit_bumps(x, y, model="NoSuchModel", p0=P0)
    with pytest.raises(ValueError, match="equal length"):
        fit_bumps(x[:-1], y, model="Gaussian", p0=P0)
    with pytest.raises(ValueError, match="positive"):
        fit_bumps(x, y, np.zeros_like(y), model="Gaussian", p0=P0)
    with pytest.raises(ValueError, match="takes 3 parameters"):
        fit_bumps(x, y, model="Gaussian", p0=[1.0, 0.0])
    with pytest.raises(ValueError, match="more points"):
        fit_bumps([1.0, 2.0], [1.0, 2.0], model="Gaussian", p0=P0)


def test_dream_posterior_invariants() -> None:
    """Seeded DREAM run: medians near truth, 68% intervals bracket, progress
    monotonic. Invariants only — MCMC values are never frozen/golden."""
    np.random.seed(11)  # noqa: NPY002 — bumps.dream samples the legacy global RNG
    x, y, dy = _gaussian_data(noise=0.02)
    fractions: list[float] = []
    result = fit_bumps(
        x, y, dy,
        model="Gaussian", p0=P0, lower=LB, upper=UB,
        engine="dream", samples=900, burn=30, pop=6,
        return_samples=True,
        progress_callback=fractions.append,
    )
    assert result["engine"] == "dream"
    assert result["uncertainty_kind"] == "posterior"

    post = result["posterior"]
    med = np.asarray(post["medians"], dtype=float)
    np.testing.assert_allclose(med, TRUE, rtol=0.05)
    for (lo, hi), truth in zip(post["interval68"], TRUE, strict=True):
        width = hi - lo
        assert width > 0
        # 68% credible interval brackets the truth (with a half-width margin
        # so a marginal seed / platform float drift can't flake the test)
        assert lo - 0.5 * width <= truth <= hi + 0.5 * width

    # uncertainties come from the posterior draw and are positive
    assert all(u > 0 for u in result["uncertainties"])
    # draw matrix present and consistent (corner-plot food)
    samples = result["samples"]
    assert samples.shape[1] == 3
    assert samples.shape[0] == post["n_draws"] > 0

    # convergence diagnostics (audit P1 #2): per-parameter R-hat, its max, a
    # boolean verdict consistent with the threshold, and the chain count.
    rhat = post["rHat"]
    assert len(rhat) == 3 and all(r > 0 for r in rhat)
    assert post["rHatMax"] == max(rhat)
    assert post["converged"] is (post["rHatMax"] < RHAT_THRESHOLD)
    assert post["nChains"] > 0
    # a clean, well-fit Gaussian mixes reasonably (loose bound so a marginal
    # seed can't flake the test — the verdict-consistency check above is the
    # deterministic invariant).
    assert 1.0 <= post["rHatMax"] < 1.3

    # progress callback fired, in [0, 1), non-decreasing
    assert len(fractions) > 3
    assert all(0.0 <= f < 1.0 for f in fractions)
    assert fractions == sorted(fractions)


def test_dream_abort_stops_early() -> None:
    """abort_check() -> True mid-run stops sampling early but still returns."""
    np.random.seed(3)  # noqa: NPY002 — bumps.dream samples the legacy global RNG
    x, y, dy = _gaussian_data(noise=0.02)
    fractions: list[float] = []
    aborted = False

    def on_progress(f: float) -> None:
        nonlocal aborted
        fractions.append(f)
        if f > 0.2:
            aborted = True

    result = fit_bumps(
        x, y, dy,
        model="Gaussian", p0=P0, lower=LB, upper=UB,
        engine="dream", samples=2000, burn=0, pop=6,
        progress_callback=on_progress,
        abort_check=lambda: aborted,
    )
    assert len(result["popt"]) == 3
    assert max(fractions) < 0.9  # stopped well before the full budget


def test_progress_callback_exception_propagates() -> None:
    """The job runner cancels by raising from the progress callback — the
    exception must escape fit_bumps unswallowed."""

    class _Stop(Exception):
        pass

    def raise_soon(f: float) -> None:
        raise _Stop

    x, y, dy = _gaussian_data()
    with pytest.raises(_Stop):
        fit_bumps(
            x, y, dy,
            model="Gaussian", p0=P0, lower=LB, upper=UB,
            engine="dream", samples=400, burn=10, pop=6,
            progress_callback=raise_soon,
        )


def test_missing_bumps_raises_install_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without bumps installed the guarded import raises a clear ValueError."""
    for mod in ("bumps", "bumps.curve", "bumps.fitproblem", "bumps.fitters"):
        monkeypatch.setitem(sys.modules, mod, None)  # forces ImportError on import
    assert not bumps_available()
    x, y, dy = _gaussian_data()
    with pytest.raises(ValueError, match=r"quantized\[bumps\]"):
        fit_bumps(x, y, dy, model="Gaussian", p0=P0)
