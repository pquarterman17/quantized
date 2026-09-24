r"""Posterior sampling (DREAM) for a reflectivity layer-model fit (audit P2.2).

Pure calc layer, the uncertainty step after :func:`quantized.calc.refl_fit.
fit_reflectivity`. A least-squares standard error assumes the model is locally
linear; reflectivity is not (fringe aliasing, thickness/roughness trade-offs),
so this samples the posterior instead and reports what the draws say.

Model and likelihood
--------------------
The SAME parameter and channel specs as ``fit_reflectivity`` (validated by
``refl_model.validate_model``) and the same objective: the likelihood is
``exp(-chi2/2)`` with ``chi2 = sum(((R_model - R)/dR)^2)``, UNSCALED — the
posterior takes dR at its word, where the least-squares error is scaled by the
reduced chi-square (the two agree when that is ~1). Log weighting is refused:
its sum of squared log residuals is not a chi-square, so ``exp(-S/2)`` would
be a likelihood of nothing. The prior is uniform inside each free parameter's
[min, max]; ties are honoured (a tied parameter reports its target's
posterior); fixed parameters are not sampled.

Sampler
-------
bumps' DREAM (``bumps.dream``; BSD, the optional engine ``calc.fit_bumps``
already drives), run on the bound-normalised free vector ``x in [0, 1]`` of
``ReflParams`` with reflecting bounds, bumps' DreamFit defaults otherwise (no
early stop, IQR outlier-chain replacement, DE noise 1e-6). The population is
``pop`` chains per free parameter (at least ``MIN_CHAINS``), started in a
Gaussian ball about ``centre`` (the fitted values) shaped by the local
Jacobian covariance, each direction's width clamped to [1e-6, 0.1] of the
span, with one chain exactly at the centre. ``burn`` generations are
discarded, then ``ceil(samples / chains)`` generations are kept, every
``thin``-th one. ``seed`` makes a run reproducible (``calc.dream_seed``).

Bounded work: the caller caps ``samples``/``burn``/``pop``; ``deadline_s``
stops sampling at a wall-clock budget and returns what was drawn, flagged
not converged — past burn-in when it got there, else the second half of what
it has, with a warning either way.

Output
------
Per free (or tied) parameter: median, central 68% and 95% credible intervals,
the best draw (MAP under the flat prior), Gelman-Rubin R-hat over the kept
draws (bumps' ``gelman``), flagged above ``RHAT_FLAG``, and whether the
bounds rather than the data limit the 95% interval. The correlation matrix of
the draws; the burn-in and thinning actually used and the draw counts; an R(Q)
credible band per channel and an SLD(z) band per spin state — the
2.5/16/50/84/97.5 percentiles over up to ``band_draws`` posterior draws, on
the fitted points (R) and on one common z grid (SLD, each draw's
``sld_profile`` interpolated onto it).
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.dream_seed import DreamCancelled, seed_reproducible, seeded_dream
from quantized.calc.refl_fit import channel_model, channel_residuals
from quantized.calc.refl_model import ReflChannel, ReflParams, layer_stack, validate_model
from quantized.calc.sld import sld_profile

__all__ = ["MIN_CHAINS", "PERCENTILES", "RHAT_FLAG", "plan_sampling", "sample_reflectivity"]

#: R-hat above which a parameter's chains count as not mixed.
RHAT_FLAG = 1.2
#: The band percentiles, low to high.
PERCENTILES = (2.5, 16.0, 50.0, 84.0, 97.5)
#: DREAM's DE step draws up to 3 pairs of OTHER chains per proposal, so it
#: needs at least 7; 10 leaves the pair choice some room.
MIN_CHAINS = 10
_BAND_KEYS = ("lo95", "lo68", "median", "hi68", "hi95")
_JAC_STEP = 1e-6
_BALL_SD = (1e-6, 0.1)
# When do the bounds, not the data, limit a 95% interval? When it ends within
# _NEAR of its own width of a bound (the posterior is cut off there; a Gaussian
# one is when the bound is within ~2.35 sigma of the median), or spans over
# _WIDE of the bounds (the data hardly confine it: a flat posterior spans
# 95%). Relative to the interval, not the span, so a well-determined value
# far from its bound in a wide range (a background of 2e-7 in [0, 1e-5]) is
# not flagged. Measured over seeds 1-10: a degenerate thickness pair spans
# 0.85-0.97 of its range, ending 0.002-0.07 of its width from a bound.
_NEAR = 0.1
_WIDE = 0.5
_INSTALL_HINT = (
    "bumps is not installed - DREAM sampling needs 'pip install quantized[bumps]' "
    "(or: uv sync --extra bumps)"
)

ProgressFn = Callable[[float], None]
AbortFn = Callable[[], bool]


class _Posterior:
    """The bumps.dream model protocol: ``labels``, ``bounds`` and ``map``."""

    def __init__(self, params: ReflParams, chans: list[ReflChannel],
                 masks: list[NDArray[np.bool_]], n_layers: int) -> None:
        self.params, self.chans, self.masks, self.n_layers = params, chans, masks, n_layers
        n = len(params.free)
        self.labels = [params.names[i] for i in params.free]
        self.bounds = np.array([np.zeros(n), np.ones(n)])
        self.n_evaluations = 0

    def residuals(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        self.n_evaluations += 1
        v = self.params.full(x)
        return np.concatenate([
            channel_residuals(c, channel_model(c, self.params, v, self.n_layers, m), m, "dr")
            for c, m in zip(self.chans, self.masks, strict=True)
        ])

    def map(self, pop: NDArray[np.float64]) -> NDArray[np.float64]:
        out = np.empty(len(pop))
        for k, x in enumerate(np.atleast_2d(pop)):
            chi2 = float(np.sum(self.residuals(np.asarray(x, dtype=float)) ** 2))
            out[k] = -0.5 * chi2 if math.isfinite(chi2) else -math.inf
        return out


def _start_ball(target: _Posterior, x0: NDArray[np.float64], n_chains: int,
                stream: np.random.RandomState) -> NDArray[np.float64]:
    """``n_chains`` starting points about ``x0``, shaped by the Jacobian there."""
    r0 = target.residuals(x0)
    jac = np.empty((r0.size, x0.size))
    for k in range(x0.size):
        h = _JAC_STEP if x0[k] + _JAC_STEP <= 1.0 else -_JAC_STEP
        x = x0.copy()
        x[k] += h
        jac[:, k] = (target.residuals(x) - r0) / h
    _, s, vt = np.linalg.svd(jac, full_matrices=False)
    with np.errstate(divide="ignore"):
        sd = np.clip(1.0 / s, *_BALL_SD)
    z = stream.standard_normal((n_chains, x0.size))
    pop = np.asarray(x0 + (z * sd) @ vt, dtype=float)
    pop = 1.0 - np.abs(1.0 - np.abs(pop))  # reflect once off each bound
    pop = np.asarray(np.clip(pop, 0.0, 1.0), dtype=float)
    pop[0] = x0
    return pop


def _finite(x: float) -> float | None:
    return float(x) if math.isfinite(float(x)) else None


def _interval(col: NDArray[np.float64], lo: float, hi: float) -> list[float]:
    a, b = np.percentile(col, [lo, hi])
    return [float(a), float(b)]


class _Setup:
    """A validated sampling problem: the model, the channels, the start and the size."""

    def __init__(self, parameters: list[dict[str, Any]], channels: list[dict[str, Any]],
                 centre: dict[str, float] | None, weighting: str, samples: int, burn: int,
                 pop: int, thin: int, band_draws: int) -> None:
        if weighting != "dr":
            raise ValueError(
                "DREAM needs dR weighting: the log-weighted objective is not a chi-square, "
                "so exp(-S/2) is not a likelihood. Fit with a dR column to estimate a posterior."
            )
        for name, val, least in (("samples", samples, 1), ("burn", burn, 0), ("pop", pop, 1),
                                 ("thin", thin, 1), ("band_draws", band_draws, 1)):
            if int(val) != val or val < least:
                raise ValueError(f"{name} must be an integer >= {least}")
        if not channels:
            raise ValueError("need at least one data channel")
        self.n_layers = validate_model(parameters, channels)
        self.params = params = ReflParams(parameters)
        self.chans = [ReflChannel(c, i) for i, c in enumerate(channels)]
        self.masks = [c.points("dr") for c in self.chans]
        self.n_free = len(params.free)
        if self.n_free == 0:
            raise ValueError("no free parameters to sample: vary at least one")
        self.n_points = int(sum(int(m.sum()) for m in self.masks))
        if self.n_points <= self.n_free:
            raise ValueError(
                f"{self.n_points} usable points cannot constrain {self.n_free} free parameters"
            )
        self.x0 = params.x0()
        for k, i in enumerate(params.free):
            c = (centre or {}).get(params.names[i])
            if c is None:
                continue
            c = float(c)
            lo, hi = params.lo[k], params.lo[k] + params.span[k]
            if not math.isfinite(c) or not lo <= c <= hi:
                raise ValueError(
                    f"the centre of {params.names[i]} ({c:g}) is outside [{lo:g}, {hi:g}]"
                )
            self.x0[k] = (c - lo) / params.span[k]
        self.n_chains = max(pop * self.n_free, MIN_CHAINS)
        self.steps = -(-samples // self.n_chains)
        # The start ball's Jacobian, the start population, every generation
        # (DREAM checks its budget once per 10-generation block, so it can
        # overrun by 9), and the band draws on every channel.
        self.n_evaluations = (self.n_free + 1 + (burn + self.steps + 10) * self.n_chains
                              + min(band_draws, self.steps * self.n_chains) * len(self.chans))


def plan_sampling(
    parameters: list[dict[str, Any]],
    channels: list[dict[str, Any]],
    *,
    centre: dict[str, float] | None = None,
    weighting: str = "dr",
    samples: int = 10_000,
    burn: int = 100,
    pop: int = 10,
    thin: int = 1,
    band_draws: int = 200,
) -> dict[str, int]:
    """Validate a sampling request without running it, and size it.

    Raises exactly what :func:`sample_reflectivity` would for these inputs
    (short of a missing bumps install), so a caller can refuse a bad request
    before queueing it. Returns the free-parameter, chain, generation and
    (upper-bound) model-evaluation counts the run would make.
    """
    s = _Setup(parameters, channels, centre, weighting, samples, burn, pop, thin, band_draws)
    return {"n_free": s.n_free, "n_chains": s.n_chains, "n_generations": burn + s.steps,
            "n_evaluations": s.n_evaluations}


def sample_reflectivity(
    parameters: list[dict[str, Any]],
    channels: list[dict[str, Any]],
    *,
    centre: dict[str, float] | None = None,
    weighting: str = "dr",
    samples: int = 10_000,
    burn: int = 100,
    pop: int = 10,
    thin: int = 1,
    seed: int | None = None,
    deadline_s: float | None = None,
    band_draws: int = 200,
    sld_points: int = 400,
    progress_callback: ProgressFn | None = None,
    abort_check: AbortFn | None = None,
) -> dict[str, Any]:
    """Sample the posterior of a layer-model fit with DREAM.

    ``centre`` maps parameter names to the fitted values the population starts
    about (free parameters only; others are ignored, and a free parameter it
    omits starts at its spec value). ``progress_callback`` gets a fraction in
    [0, 1) per generation and may raise to cancel (the job runner's
    ``JobCancelled`` propagates); ``abort_check`` returning True stops
    sampling like the deadline does. Raises ``ValueError`` for log weighting,
    a model ``fit_reflectivity`` would refuse, nothing free to sample, a
    centre outside the bounds, bad settings, or a missing bumps install.
    """
    try:
        from bumps.dream.core import Dream
        from bumps.dream.gelman import gelman
    except ImportError as exc:
        raise ValueError(_INSTALL_HINT) from exc
    s = _Setup(parameters, channels, centre, weighting, samples, burn, pop, thin, band_draws)
    params, chans, masks, n_layers = s.params, s.chans, s.masks, s.n_layers
    n_free, n_points, x0, n_chains, steps = s.n_free, s.n_points, s.x0, s.n_chains, s.steps
    total_gens = burn + steps
    target = _Posterior(params, chans, masks, n_layers)
    stopped = {"why": "completed"}
    clock: dict[str, float | None] = {"end": None}

    def stop() -> bool:
        end = clock["end"]
        if abort_check is not None and abort_check():
            stopped["why"] = "cancelled"
        elif end is not None and time.monotonic() > end:
            stopped["why"] = "deadline"
        return stopped["why"] != "completed"

    def monitor(state: Any, _pop: Any, _logp: Any) -> bool:
        # Sampling reports below 0.95 even through DREAM's overrun past
        # total_gens; 0.95-0.99 is the bands.
        if progress_callback is not None:
            progress_callback(min(0.94, 0.95 * state.generation / (total_gens + 1)))
        return True

    def waiting() -> None:
        # Queued behind another DREAM run: still cancellable.
        if progress_callback is not None:
            progress_callback(0.0)
        if abort_check is not None and abort_check():
            raise DreamCancelled("cancelled while waiting for another DREAM run")

    with seeded_dream(seed, while_waiting=waiting) as stream:
        # The budget starts once this run holds the sampler, not while it waits.
        clock["end"] = None if deadline_s is None else time.monotonic() + deadline_s
        start = _start_ball(target, x0, n_chains, stream)
        sampler = Dream(
            model=target, population=start[None, :, :], draws=steps * n_chains,
            burn=burn * n_chains, thinning=thin, monitor=monitor, alpha=0.0,
            outlier_test="iqr", DE_noise=1e-6,
        )
        state = sampler.sample(abort_test=stop)
    cum, chains_all, _ = state.chains()
    chains_all = np.asarray(chains_all, dtype=float)
    gen = np.asarray(cum, dtype=np.int64) // n_chains - 1  # the start population is generation 0
    warnings: list[str] = []
    keep = gen > burn
    burn_incomplete = not keep.any()
    if burn_incomplete:
        keep = np.zeros(gen.size, dtype=bool)
        keep[gen.size // 2:] = True
        warnings.append("sampling stopped during burn-in: the draws are the second half of "
                        "what was sampled and still carry the starting population")
    kept = chains_all[keep]
    n_gens_run = int(gen.max()) if gen.size else 0
    if stopped["why"] == "deadline":
        warnings.append(f"sampling stopped at the {deadline_s:g} s time limit after {n_gens_run} "
                        f"of {total_gens} generations; the intervals are provisional")
    elif stopped["why"] == "cancelled":
        warnings.append(f"sampling was cancelled after {n_gens_run} of {total_gens} generations")

    rhat_raw = np.asarray(gelman(kept, portion=1.0), dtype=float) if kept.shape[0] >= 2 \
        else np.full(n_free, np.nan)
    rhat = np.where(rhat_raw > 0, rhat_raw, np.nan)  # bumps writes -2 for "too short"
    flagged = [target.labels[k] for k in range(n_free) if rhat[k] > RHAT_FLAG]
    unmeasured = [target.labels[k] for k in range(n_free) if not np.isfinite(rhat[k])]
    if flagged:
        warnings.append(f"R-hat above {RHAT_FLAG} (the chains have not mixed) for: "
                        + ", ".join(flagged) + "; sample longer or constrain the model")
    if unmeasured:
        warnings.append("R-hat could not be computed (too few kept generations) for: "
                        + ", ".join(unmeasured) + "; sample longer")

    draws = params.lo + kept.reshape(-1, n_free) * params.span
    best_x, best_logp = state.best()
    best = params.lo + np.asarray(best_x, dtype=float) * params.span
    stats: dict[int, dict[str, Any]] = {}
    edge: list[str] = []
    for k, i in enumerate(params.free):
        col = draws[:, k]
        i95 = _interval(col, 2.5, 97.5)
        width = i95[1] - i95[0]
        gap = min(i95[0] - params.lo[k], params.lo[k] + params.span[k] - i95[1])
        reaches = gap <= _NEAR * width or width > _WIDE * params.span[k]
        if reaches:
            edge.append(params.names[i])
        stats[i] = {
            "median": float(np.median(col)), "interval68": _interval(col, 16.0, 84.0),
            "interval95": i95, "map": float(best[k]), "rhat": _finite(rhat[k]),
            "rhat_flag": params.names[i] in flagged or params.names[i] in unmeasured,
            "at_bound": reaches,
        }
    if edge:
        warnings.append("the bounds, not the data, limit the 95% interval (it ends at a "
                        "bound, or spans most of the range; widen the bound, or fix or tie "
                        "the parameter) for: " + ", ".join(edge))
    out_params = [{"name": n, "tie": params.tie[i], **stats[params.root[i]]}
                  for i, n in enumerate(params.names) if params.root[i] in stats]

    with np.errstate(invalid="ignore", divide="ignore"):
        corr = np.corrcoef(draws.T) if draws.shape[0] > 1 else np.full((n_free, n_free), np.nan)
    corr = np.atleast_2d(corr)
    correlation = [[_finite(val) for val in row] for row in corr]

    pool = kept.reshape(-1, n_free)
    pick = np.sort(np.random.default_rng(seed).choice(
        pool.shape[0], size=min(band_draws, pool.shape[0]), replace=False))
    r_bands, sld_bands = _bands(params, chans, masks, n_layers, pool[pick], sld_points,
                                progress_callback)

    completed = stopped["why"] == "completed"
    reproducible = seed is not None and seed_reproducible()
    if seed is not None and not reproducible:
        warnings.append("this bumps install runs DREAM under numba, which a seed cannot "
                        "control: the run is not reproducible")
    return {
        "parameters": out_params,
        "free": target.labels,
        "correlation": correlation,
        "map_chi2": _finite(-2.0 * float(best_logp)),
        "n_points": n_points,
        "convergence": {
            "converged": completed and not flagged and not unmeasured and not burn_incomplete,
            "rhat_threshold": RHAT_FLAG,
            "rhat_max": _finite(float(np.nanmax(rhat))) if np.isfinite(rhat).any() else None,
            "flagged": flagged,
            "unmeasured": unmeasured,
            "stopped": stopped["why"],
            "burn": int(gen[keep][0]) - 1 if keep.any() else 0,
            "burn_requested": burn,
            "thin": thin,
            "n_chains": n_chains,
            "n_generations": n_gens_run,
            "n_generations_requested": total_gens,
            "n_draws": int(pool.shape[0]),
            "n_band_draws": int(pick.size),
            "n_evaluations": target.n_evaluations,
            "seed": seed,
            "reproducible": reproducible,
        },
        "r_bands": r_bands,
        "sld_bands": sld_bands,
        "warnings": warnings,
    }


def _percentile_rows(stack: NDArray[np.float64]) -> dict[str, list[float]]:
    rows = np.percentile(stack, PERCENTILES, axis=0)
    return {key: np.asarray(row, dtype=float).tolist()
            for key, row in zip(_BAND_KEYS, rows, strict=True)}


def _bands(
    params: ReflParams, chans: list[ReflChannel], masks: list[NDArray[np.bool_]], n_layers: int,
    xs: NDArray[np.float64], sld_points: int, progress_callback: ProgressFn | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """R(Q) percentile bands per channel and SLD(z) bands per spin state."""
    models: list[list[NDArray[np.float64]]] = [[] for _ in chans]
    spins = sorted({c.spin for c in chans})
    Profile = tuple[NDArray[np.float64], NDArray[np.float64]]
    profiles: dict[int, list[Profile]] = {s: [] for s in spins}
    for j, x in enumerate(xs):
        if progress_callback is not None and j % 20 == 0:
            progress_callback(0.95 + 0.04 * j / max(1, len(xs)))
        v = params.full(x)
        for c, m, acc in zip(chans, masks, models, strict=True):
            acc.append(channel_model(c, params, v, n_layers, m))
        for s in spins:
            z, sld = sld_profile(layer_stack(params, v, n_layers, s), n_points=sld_points)
            profiles[s].append((np.asarray(z, dtype=float), np.asarray(sld, dtype=float)))
    r_bands = [{
        "label": c.label, "spin": c.spin_label,
        "q": c.q_all[m].tolist(), "r": c.r_all[m].tolist(),
        "dr": None if c.dr is None else c.dr[m].tolist(),
        **_percentile_rows(np.vstack(acc)),
    } for c, m, acc in zip(chans, masks, models, strict=True)]
    sld_bands = []
    for s in spins:
        lo = min(float(z[0]) for z, _ in profiles[s])
        hi = max(float(z[-1]) for z, _ in profiles[s])
        grid = np.linspace(lo, hi, sld_points)
        # Outside a draw's own range its profile is flat (ambient / substrate),
        # which is exactly what np.interp's end-value hold gives.
        stack = np.vstack([np.interp(grid, z, sld) for z, sld in profiles[s]])
        sld_bands.append({"spin": {0: None, 1: "+", -1: "-"}[s], "z": grid.tolist(),
                          **_percentile_rows(stack)})
    return r_bands, sld_bands
