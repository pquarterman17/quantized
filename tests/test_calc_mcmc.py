"""mcmc_sample: random-walk Metropolis MCMC (calc/mcmc.py).

Invariant-tested, not golden — the sampler is RNG-driven and NumPy's generator
differs from MATLAB's, so values can't be frozen. These mirror the invariants in
``tests/fitting/test_mcmcSample.m``: posterior-mean recovery, an acceptance rate
in the target band, correct output fields/shapes, plus seeded reproducibility and
ESS sanity that the MATLAB scaffold test leaves as TODO.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.mcmc import mcmc_sample


def test_recovers_gaussian_posterior_mean() -> None:
    rng = np.random.default_rng(42)
    mu_true, sig_true = 2.5, 1.2
    x = mu_true + sig_true * rng.standard_normal(500)

    def log_post(p: np.ndarray) -> float:
        return float(
            -0.5 * np.sum((x - p[0]) ** 2) / p[1] ** 2
            - 500 * np.log(max(p[1], 1e-6))
            - 0.5 * p[0] ** 2 / 100**2
            - 2 * np.log(max(p[1], 1e-6))
        )

    r = mcmc_sample(log_post, [0.0, 1.0], num_steps=8000, burn_in=2000, step_size=0.1, seed=1)
    assert r["samples"][:, 0].mean() == pytest.approx(mu_true, abs=0.25)
    assert r["samples"][:, 1].mean() == pytest.approx(sig_true, abs=0.25)


def test_acceptance_rate_in_band() -> None:
    # Standard normal target, tuned step → acceptance in a sane range.
    r = mcmc_sample(
        lambda p: float(-0.5 * np.sum(p**2)),
        [0.0, 0.0],
        num_steps=5000,
        burn_in=500,
        step_size=1.0,
        seed=2,
    )
    assert 0.15 < r["accept_rate"] < 0.75


def test_output_fields_present() -> None:
    r = mcmc_sample(lambda p: float(-0.5 * p[0] ** 2), 0.0, num_steps=500, burn_in=50, seed=3)
    assert set(r) == {"samples", "log_posterior", "accept_rate", "diagnostic"}
    diag = r["diagnostic"]
    assert set(diag) >= {"n_steps", "n_accepted", "ess", "r_hat", "sampler"}
    assert diag["sampler"] == "random-walk-metropolis"
    assert diag["n_steps"] == 500


def test_scalar_init_gives_column_shape() -> None:
    r = mcmc_sample(
        lambda p: float(-0.5 * p[0] ** 2), 0.0, num_steps=500, burn_in=50, thin=1, seed=3
    )
    assert r["samples"].shape == (450, 1)
    assert r["log_posterior"].shape == (450,)


def test_burn_in_and_thinning_counts() -> None:
    r = mcmc_sample(
        lambda p: float(-0.5 * np.sum(p**2)),
        [0.0, 0.0, 0.0],
        num_steps=1000,
        burn_in=200,
        thin=5,
        seed=7,
    )
    # kept indices are 200, 205, …, 995 → 160 samples of dimension 3
    assert r["samples"].shape == (len(range(200, 1000, 5)), 3)


def test_seeded_reproducibility() -> None:
    kw = dict(num_steps=600, burn_in=50, step_size=0.3, seed=11)
    a = mcmc_sample(lambda p: float(-0.5 * np.sum(p**2)), [0.5, -0.5], **kw)
    b = mcmc_sample(lambda p: float(-0.5 * np.sum(p**2)), [0.5, -0.5], **kw)
    np.testing.assert_array_equal(a["samples"], b["samples"])
    assert a["accept_rate"] == b["accept_rate"]


def test_ess_positive_and_bounded() -> None:
    r = mcmc_sample(
        lambda p: float(-0.5 * np.sum(p**2)),
        [0.0, 0.0],
        num_steps=4000,
        burn_in=1000,
        seed=5,
    )
    n_kept = r["samples"].shape[0]
    ess = r["diagnostic"]["ess"]
    assert ess.shape == (2,)
    assert np.all(ess > 0)
    assert np.all(ess <= n_kept + 1e-9)


def test_constant_chain_ess_equals_n() -> None:
    # log-posterior forcing rejection (−inf everywhere off the start) → chain
    # never moves → each dimension's ESS is exactly the kept-sample count.
    r = mcmc_sample(
        lambda p: 0.0 if np.all(p == 0.0) else -np.inf,
        [0.0, 0.0],
        num_steps=300,
        burn_in=50,
        seed=9,
    )
    n_kept = r["samples"].shape[0]
    assert np.allclose(r["diagnostic"]["ess"], n_kept)
    assert r["accept_rate"] == 0.0


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"num_steps": 0}, "num_steps"),
        ({"burn_in": -1}, "burn_in"),
        ({"thin": 0}, "thin"),
        ({"step_size": 0.0}, "step_size"),
    ],
)
def test_invalid_options_raise(kwargs: dict, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        mcmc_sample(lambda p: 0.0, [0.0], **kwargs)
