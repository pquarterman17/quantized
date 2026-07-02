r"""MCMC posterior sampling for nonlinear-fit uncertainty (``fitting.mcmcSample``).

Pure calc layer. A single-chain random-walk Metropolis sampler with a Gaussian
proposal — the same scaffold as the MATLAB original (the production target is an
affine-invariant ensemble sampler; not yet implemented on either side).

The algorithm, per step ``k``:

.. math::

    p' = p_{k-1} + \sigma \odot \mathcal{N}(0, I), \qquad
    \text{accept if } \log u < \log P(p') - \log P(p_{k-1}), \; u \sim U(0,1)

where :math:`\sigma` is a uniform per-dimension proposal scale (``step_size``).
Post burn-in the chain is thinned, and an effective sample size is estimated from
the integrated autocorrelation time (Sokal 1997) via a single batched FFT.

Because the sampler is RNG-driven it is **not** golden-frozen against MATLAB
(NumPy and MATLAB use different generators); it is verified by invariants —
posterior-mean recovery, an acceptance rate in the target band, correct output
shapes, and seeded reproducibility (see ``tests/test_calc_mcmc.py``), mirroring
how ``tests/fitting/test_mcmcSample.m`` tests the MATLAB scaffold.

References
----------
Goodman, J. & Weare, J., *Ensemble samplers with affine invariance*,
Commun. Appl. Math. Comput. Sci. **5**, 65 (2010).
Foreman-Mackey, D. et al., *emcee: the MCMC Hammer*, PASP **125**, 306 (2013).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["mcmc_sample"]

LogPosterior = Callable[[NDArray[np.float64]], float]


def mcmc_sample(
    log_posterior: LogPosterior,
    initial_params: float | list[float] | NDArray[np.float64],
    *,
    num_steps: int = 10000,
    burn_in: int = 1000,
    thin: int = 1,
    step_size: float = 0.05,
    seed: int | None = None,
) -> dict[str, Any]:
    r"""Random-walk Metropolis MCMC over a log-posterior.

    Parameters
    ----------
    log_posterior
        Callable taking a 1-D parameter vector and returning a scalar
        log-posterior (log-likelihood + log-prior). Return ``-inf`` for
        out-of-prior parameters.
    initial_params
        Starting parameter vector (scalar or length-``P`` sequence).
    num_steps
        Total MCMC steps (``> 0``).
    burn_in
        Leading steps to discard (``>= 0``).
    thin
        Keep every ``thin``-th post-burn-in sample (``> 0``).
    step_size
        Gaussian proposal scale, uniform across dimensions (``> 0``).
    seed
        RNG seed for reproducibility; ``None`` for a fresh generator.

    Returns
    -------
    dict
        ``samples`` ``[N × P]`` post-burn-in thinned draws, ``log_posterior``
        ``[N]`` at each, ``accept_rate`` (target 0.2–0.5), and ``diagnostic``
        (``n_steps``, ``n_accepted``, ``ess`` per dimension, ``r_hat`` = NaN
        placeholder, ``sampler``).
    """
    if num_steps < 1:
        raise ValueError("num_steps must be a positive integer")
    if burn_in < 0:
        raise ValueError("burn_in must be non-negative")
    if thin < 1:
        raise ValueError("thin must be a positive integer")
    if not (step_size > 0):
        raise ValueError("step_size must be positive")

    rng = np.random.default_rng(seed)
    p0 = np.atleast_1d(np.asarray(initial_params, dtype=float)).ravel()
    if p0.size == 0:
        raise ValueError("initial_params must be non-empty")
    n_params = int(p0.size)
    n = int(num_steps)

    chain = np.zeros((n, n_params), dtype=float)
    log_post = np.zeros(n, dtype=float)
    chain[0] = p0
    log_post[0] = float(log_posterior(p0))

    # Uniform proposal scale in every dimension. A fraction-of-|p| rule would
    # collapse when any initial parameter is near zero (MATLAB note).
    prop_scale = step_size * np.ones(n_params, dtype=float)

    n_accepted = 0
    for kk in range(1, n):
        prop = chain[kk - 1] + rng.standard_normal(n_params) * prop_scale
        lp_prop = float(log_posterior(prop))
        log_ratio = lp_prop - log_post[kk - 1]
        if math.log(rng.random()) < log_ratio:
            chain[kk] = prop
            log_post[kk] = lp_prop
            n_accepted += 1
        else:
            chain[kk] = chain[kk - 1]
            log_post[kk] = log_post[kk - 1]

    # Burn-in + thinning. MATLAB (1-based) (BurnIn+1):Thin:N → 0-based
    # burn_in:thin:N.
    keep = np.arange(burn_in, n, thin)
    samples = chain[keep]
    lp_kept = log_post[keep]
    ess = _effective_sample_size(samples)

    accept_rate = n_accepted / (n - 1) if n > 1 else float("nan")
    return {
        "samples": samples,
        "log_posterior": lp_kept,
        "accept_rate": accept_rate,
        "diagnostic": {
            "n_steps": n,
            "n_accepted": n_accepted,
            "ess": ess,
            "r_hat": float("nan"),  # Gelman-Rubin needs multiple chains (TODO)
            "sampler": "random-walk-metropolis",
        },
    }


def _effective_sample_size(samples: NDArray[np.float64]) -> NDArray[np.float64]:
    r"""Per-dimension ESS from the integrated autocorrelation time (Sokal 1997).

    For each column the normalised autocorrelation is the inverse FFT of
    ``|FFT(z)|²`` (``z`` = mean-centred chain), zero-padded to avoid circular
    wrap. ``τ = 1 + 2·Σ ρ_lag`` over positive-lag autocorrelations above 0.05,
    and ``ESS = N / max(τ, 1)``. All-constant columns get ``ESS = N`` directly.
    """
    n_kept, n_params = samples.shape
    ess = np.zeros(n_params, dtype=float)
    z = samples - samples.mean(axis=0)  # mean-centred [n_kept × P]

    zero_mask = np.all(z == 0.0, axis=0)
    ess[zero_mask] = n_kept
    active = ~zero_mask
    if not np.any(active):
        return ess

    z_active = z[:, active]
    nfft = 1 << _nextpow2(2 * n_kept - 1)  # zero-pad past the wrap point
    freq = np.fft.fft(z_active, n=nfft, axis=0)
    ac = np.real(np.fft.ifft(freq * np.conj(freq), axis=0))
    ac = np.asarray(ac / ac[0], dtype=float)  # normalise each column by lag-0
    ac_pos = ac[1:n_kept]  # positive lags 1 … n_kept-1
    tau = 1.0 + 2.0 * np.sum(ac_pos * (ac_pos > 0.05), axis=0)
    ess[active] = n_kept / np.maximum(tau, 1.0)
    return ess


def _nextpow2(value: int) -> int:
    """Smallest integer ``p`` with ``2**p >= value`` (MATLAB ``nextpow2``)."""
    if value <= 1:
        return 0
    return int(math.ceil(math.log2(value)))
