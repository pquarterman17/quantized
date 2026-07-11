"""Optional bumps fit engine adapter (GOTO #10).

Pure calc layer. `bumps <https://github.com/bumps/bumps>`_ (BSD-3) is an
OPTIONAL dependency, imported inside functions and guarded — the MATLAB-parity
fitter (``calc.fitting.curve_fit``, golden-locked) stays the default engine
everywhere; bumps adds ``amoeba`` / ``lm`` / ``de`` (synchronous, Hessian
uncertainties) and ``dream`` (posterior sampling — long-running, driven
through the poll-model job runner ``quantized.jobs`` by the route layer).

There is deliberately NO golden parity here: bumps has no ``quantized_matlab``
counterpart, so its tests are reference-value / invariant tests, never
``@pytest.mark.golden`` (see ``tests/test_calc_fit_bumps.py``).

A registry model name (``calc.fit_models.FIT_MODELS`` — which also holds
equation-builder custom models once registered) or a raw ``f(x, p)`` callable
is wrapped into a ``bumps.curve.Curve`` via a synthesized keyword signature
(bumps introspects parameter names; internal names are ``p1..pn`` to avoid
collisions with ``Curve`` attributes, and results map back positionally).
"""

from __future__ import annotations

import inspect
import math
from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .fit_models import FIT_MODELS, evaluate

__all__ = ["BUMPS_ENGINES", "bumps_available", "fit_bumps"]

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]
ProgressFn = Callable[[float], None]
AbortFn = Callable[[], bool]

#: Supported bumps engine ids (bumps.fitters FITTERS ids).
BUMPS_ENGINES = ("amoeba", "lm", "de", "dream")

_INSTALL_HINT = (
    "bumps is not installed - the optional fit engine needs "
    "'pip install quantized[bumps]' (or: uv sync --extra bumps)"
)


def bumps_available() -> bool:
    """True when the optional bumps dependency is importable."""
    try:
        import bumps  # noqa: F401
    except ImportError:
        return False
    return True


def _import_bumps() -> tuple[Any, Any, Any, Any]:
    """Guarded import -> (Curve, FitProblem, FITTERS, FitDriver)."""
    try:
        from bumps.curve import Curve
        from bumps.fitproblem import FitProblem
        from bumps.fitters import FITTERS, FitDriver
    except ImportError as exc:
        raise ValueError(_INSTALL_HINT) from exc
    return Curve, FitProblem, FITTERS, FitDriver


def _wrap_model(model_fcn: ModelFn, n_params: int) -> tuple[Callable[..., Any], list[str]]:
    """Wrap ``f(x, p_array)`` for bumps' signature introspection.

    bumps ``Curve`` reads parameter names from the function signature and
    calls ``fn(x, **params)``; the wrapper carries a synthesized signature
    with safe internal names ``p1..pn`` (guaranteed not to collide with
    ``Curve`` attributes such as ``x``/``y``/``name``/``state``).
    """
    names = [f"p{i + 1}" for i in range(n_params)]

    def fn(x: Any, **kw: float) -> Any:
        p = np.array([kw[nm] for nm in names], dtype=float)
        return model_fcn(np.asarray(x, dtype=float), p)

    pos = inspect.Parameter.POSITIONAL_OR_KEYWORD
    sig = inspect.Signature(
        [inspect.Parameter("x", pos)] + [inspect.Parameter(nm, pos) for nm in names]
    )
    setattr(fn, "__signature__", sig)  # noqa: B010 — plain attr assign confuses mypy
    return fn, names


class _ProgressMonitor:
    """bumps Monitor -> plain ``progress_callback(fraction)`` bridge.

    ``total_steps`` is the predicted generation count (burn + draw
    generations); the reported fraction is clamped below 1.0 — the caller
    (job runner) owns the terminal 100%.
    """

    def __init__(self, total_steps: int, callback: ProgressFn) -> None:
        self._total = max(1, total_steps)
        self._callback = callback

    def config_history(self, history: Any) -> None:
        history.requires(step=1)

    def __call__(self, history: Any) -> None:
        step = int(history.step[0])
        self._callback(min(0.99, step / self._total))


def _resolve_model(
    model: str | ModelFn, param_names: list[str] | None, n_params: int
) -> tuple[ModelFn, list[str]]:
    """Registry name or callable -> (f(x, p) callable, display param names)."""
    if callable(model):
        names = list(param_names) if param_names else [f"p{i + 1}" for i in range(n_params)]
        return model, names

    if model not in FIT_MODELS:
        raise ValueError(f"unknown fit model: {model}")
    spec = FIT_MODELS[model]
    if n_params != int(spec["nParams"]):
        raise ValueError(
            f"model '{model}' takes {spec['nParams']} parameters, got {n_params} initial values"
        )

    def fcn(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
        return evaluate(model, x, p)

    names = list(param_names) if param_names else list(spec["paramNames"])
    return fcn, names


def fit_bumps(
    x: ArrayLike,
    y: ArrayLike,
    dy: ArrayLike | None = None,
    *,
    model: str | ModelFn,
    p0: list[float],
    lower: list[float] | None = None,
    upper: list[float] | None = None,
    param_names: list[str] | None = None,
    engine: str = "amoeba",
    samples: int = 10_000,
    burn: int = 100,
    pop: int = 10,
    return_samples: bool = False,
    progress_callback: ProgressFn | None = None,
    abort_check: AbortFn | None = None,
) -> dict[str, Any]:
    """Fit (x, y[, dy]) with a bumps engine; returns a plain result dict.

    ``model`` is a ``calc.fit_models`` registry name (covers built-in AND
    saved equation-builder models) or a raw ``f(x, p)`` callable. ``engine``
    is one of ``BUMPS_ENGINES``: amoeba / lm / de report Hessian-derived
    uncertainties (``uncertainty_kind='hessian'``); dream samples the
    posterior (``uncertainty_kind='posterior'``) and additionally returns
    per-parameter medians and central 68% intervals (plus the raw draw
    matrix when ``return_samples`` — corner-plot food).

    ``samples`` / ``burn`` / ``pop`` tune dream only. ``progress_callback``
    (fraction in [0, 1)) and ``abort_check`` (True -> stop sampling early)
    let the job runner drive progress and cancellation; an exception raised
    by ``progress_callback`` (e.g. ``jobs.JobCancelled``) propagates out.

    Raises ``ValueError`` for a missing bumps install, unknown model/engine,
    or malformed inputs — the route layer maps that to HTTP 422.
    """
    Curve, FitProblem, FITTERS, FitDriver = _import_bumps()

    if engine not in BUMPS_ENGINES:
        raise ValueError(f"unknown bumps engine: {engine} (choose from {', '.join(BUMPS_ENGINES)})")
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError(f"x and y must have equal length (got {xv.size} and {yv.size})")
    n_params = len(p0)
    if n_params == 0:
        raise ValueError("p0 must contain at least one initial parameter value")
    if xv.size <= n_params:
        raise ValueError(f"need more points ({xv.size}) than parameters ({n_params})")
    if not all(math.isfinite(v) for v in p0):
        raise ValueError("p0 values must be finite")
    dyv: NDArray[np.float64] | None = None
    if dy is not None:
        dyv = np.asarray(dy, dtype=float).ravel()
        if dyv.size != yv.size:
            raise ValueError(f"dy must match y length (got {dyv.size} and {yv.size})")
        if not np.all(dyv > 0):
            raise ValueError("dy values must all be positive")
    lb = list(lower) if lower is not None else [-math.inf] * n_params
    ub = list(upper) if upper is not None else [math.inf] * n_params
    if len(lb) != n_params or len(ub) != n_params:
        raise ValueError("lower/upper bounds must match the number of parameters")

    model_fcn, display_names = _resolve_model(model, param_names, n_params)
    fn, internal = _wrap_model(model_fcn, n_params)

    init = dict(zip(internal, [float(v) for v in p0], strict=True))
    curve = Curve(fn, xv, yv, dyv, name="", **init)
    for nm, lo, hi in zip(internal, lb, ub, strict=True):
        curve.pars[nm].range(float(lo), float(hi))
    problem = FitProblem(curve)

    fitclass = next(f for f in FITTERS if f.id == engine)
    options: dict[str, Any] = {}
    monitors: list[Any] = []
    if engine == "dream":
        options = {"samples": int(samples), "burn": int(burn), "pop": int(pop)}
        if progress_callback is not None:
            pop_size = int(math.ceil(pop * n_params))
            total = int(burn) + -(-int(samples) // max(1, pop_size))
            monitors.append(_ProgressMonitor(total, progress_callback))
    driver = FitDriver(
        fitclass=fitclass, problem=problem, monitors=monitors, abort_test=abort_check, **options
    )
    driver.clip()  # start inside the bounds
    x_best, _fx = driver.fit()
    if x_best is None:  # aborted before the first iteration completed
        x_best = problem.getp()
    problem.setp(x_best)

    # Map fitted values back to input parameter order via problem labels.
    labels = [str(s) for s in problem.labels()]
    order = [labels.index(nm) for nm in internal]
    xb = np.asarray(x_best, dtype=float)
    popt = [float(xb[i]) for i in order]
    try:
        dx = np.asarray(driver.stderr(), dtype=float)
        uncertainties = [float(dx[i]) for i in order]
    except Exception:  # noqa: BLE001 — e.g. aborted dream with a near-empty state
        uncertainties = [float("nan")] * n_params

    y_fit = np.asarray(model_fcn(xv, np.asarray(popt, dtype=float)), dtype=float)
    result: dict[str, Any] = {
        "engine": engine,
        "popt": popt,
        "uncertainties": uncertainties,
        "chisq": float(problem.chisq()),
        "uncertainty_kind": "posterior" if engine == "dream" else "hessian",
        "paramNames": display_names,
        "yFit": y_fit,
    }

    if engine == "dream":
        draw = driver.fitter.state.draw()
        pts = np.asarray(draw.points, dtype=float)[:, order]
        lo68, med, hi68 = (
            np.asarray(np.percentile(pts, q, axis=0), dtype=float) for q in (16.0, 50.0, 84.0)
        )
        result["posterior"] = {
            "medians": [float(v) for v in med],
            "interval68": [[float(a), float(b)] for a, b in zip(lo68, hi68, strict=True)],
            "n_draws": int(pts.shape[0]),
        }
        if return_samples:
            result["samples"] = pts
    return result
