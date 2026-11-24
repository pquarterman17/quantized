"""Batch evaluation of a fitted linear model for the prediction and contour
profilers (GAP_AUDIT_9 G7).

After JMP's Prediction Profiler and Contour Profiler
(https://www.jmp.com/support/help/en/18.0/jmp/profiler-2.shtml): one trace per
factor with the other factors held at their current settings, and a contour of
the predicted response over two continuous factors. Everything is evaluated by
:func:`quantized.calc.stats_linear_model.predict` (one vectorised call per
request), so a profile curve equals ``predict()`` pointwise by construction.

The interval is the confidence interval of the MEAN response (not a single new
observation): ``predicted +/- t(1 - alpha/2, df_error) * se_mean``, the same
quantity as statsmodels ``OLSResults.get_prediction(x).summary_frame(alpha)``
``mean_ci_lower`` / ``mean_ci_upper`` (checked in tests/test_profile_model.py).

Settings convention: a continuous factor takes a number (default: its fitted
mean), a nominal factor a fitted level label (default ``None`` = averaged over
its levels, the LS-means neutral value).
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

from quantized.calc.profile_desirability import desirability, validate_goal
from quantized.calc.stats_linear_model import predict
from quantized.calc.stats_lm_design import CONTINUOUS, ModelSpec, spec_from_dict

MAX_POINTS_PER_FACTOR = 401
MAX_CONTOUR_CELLS = 40000


def _used_factors(spec: ModelSpec) -> list[Any]:
    return [f for f in spec.factors if any(f.name in t for t in spec.terms)]


def factor_ranges(
    model: Mapping[str, Any], override: Mapping[str, tuple[float, float]] | None = None
) -> dict[str, tuple[float, float]]:
    """(lo, hi) per continuous factor: the override, else the fitted range stored
    in ``model["ranges"]``. Fails closed when neither is available."""
    spec = spec_from_dict(model)
    stored = model.get("ranges")
    out: dict[str, tuple[float, float]] = {}
    for f in _used_factors(spec):
        if f.kind != CONTINUOUS:
            continue
        pair: Any = (override or {}).get(f.name)
        if pair is None and isinstance(stored, Mapping):
            pair = stored.get(f.name)
        if pair is None or len(pair) != 2:
            raise ValueError(
                f"no range for factor {f.name!r}: refit the model (older saved results do not "
                "store the fitted range) or pass one"
            )
        lo, hi = float(pair[0]), float(pair[1])
        if not (math.isfinite(lo) and math.isfinite(hi)) or not lo < hi:
            raise ValueError(f"the range for factor {f.name!r} must be finite with lo < hi")
        out[f.name] = (lo, hi)
    return out


def current_settings(
    model: Mapping[str, Any], current: Mapping[str, float | str | None] | None
) -> dict[str, float | str | None]:
    """Fill defaults (continuous mean, nominal averaged) and validate."""
    spec = spec_from_dict(model)
    given = dict(current or {})
    out: dict[str, float | str | None] = {}
    for f in _used_factors(spec):
        v = given.get(f.name)
        if f.kind == CONTINUOUS:
            num = f.mean if v is None else v
            try:
                x = float(num)
            except (TypeError, ValueError):
                raise ValueError(f"the setting for {f.name!r} must be a number") from None
            if not math.isfinite(x):
                raise ValueError(f"the setting for {f.name!r} must be finite")
            out[f.name] = x
        else:
            if v is not None and str(v) not in f.levels:
                raise ValueError(f"{v!r} is not a fitted level of {f.name!r}")
            out[f.name] = None if v is None else str(v)
    return out


def t_critical(alpha: float, df_error: int) -> float:
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    return float(sps.t.ppf(1.0 - alpha / 2.0, df_error))


def _band(
    est: NDArray[np.float64], se: NDArray[np.float64], tcrit: float
) -> tuple[list[float], list[float]]:
    return (est - tcrit * se).tolist(), (est + tcrit * se).tolist()


def profile_model(
    model: Mapping[str, Any],
    current: Mapping[str, float | str | None] | None = None,
    *,
    ranges: Mapping[str, tuple[float, float]] | None = None,
    n_points: int = 41,
    alpha: float = 0.05,
    goal: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """One curve per factor (others at ``current``) and the current prediction.

    Continuous factors are sampled at ``n_points`` evenly spaced values over
    their range; nominal factors at every fitted level (a step plot). ``goal``
    (``{"goal","lower","upper","target"}``) adds desirability to every curve
    and to the current point.
    """
    if not 2 <= n_points <= MAX_POINTS_PER_FACTOR:
        raise ValueError(f"n_points must be between 2 and {MAX_POINTS_PER_FACTOR}")
    spec = spec_from_dict(model)
    used = _used_factors(spec)
    rng = factor_ranges(model, ranges)
    cur = current_settings(model, current)
    tcrit = t_critical(alpha, int(model["df_error"]))

    # One batch: row 0 is the current point, then each factor's curve in turn.
    xs: dict[str, list[Any]] = {}
    blocks: list[tuple[str, int, int]] = []
    rows: list[dict[str, float | str | None]] = [dict(cur)]
    for f in used:
        if f.kind == CONTINUOUS:
            vals: list[Any] = [float(v) for v in np.linspace(*rng[f.name], n_points)]
        else:
            vals = list(f.levels)
        xs[f.name] = vals
        blocks.append((f.name, len(rows), len(rows) + len(vals)))
        for v in vals:
            rows.append({**cur, f.name: v})
    out = predict(model, {f.name: [r[f.name] for r in rows] for f in used})
    est = np.asarray(out["predicted"], dtype=float)
    se = np.asarray(out["se_mean"], dtype=float)
    lo, hi = _band(est, se, tcrit)
    gparams = None
    d_all: NDArray[np.float64] | None = None
    if goal is not None:
        gparams = validate_goal(str(goal.get("goal")), float(goal["lower"]), float(goal["upper"]),
                                None if goal.get("target") is None else float(goal["target"]))
        d_all = desirability(est, *gparams)

    def point(i: int) -> dict[str, Any]:
        p: dict[str, Any] = {"predicted": float(est[i]), "se": float(se[i]),
                             "lower": lo[i], "upper": hi[i]}
        if d_all is not None:
            p["desirability"] = float(d_all[i])
        return p

    factors = []
    for f in used:
        a, b = next((s, e) for n, s, e in blocks if n == f.name)
        sl = slice(a, b)
        entry: dict[str, Any] = {
            "name": f.name, "kind": f.kind,
            ("x" if f.kind == CONTINUOUS else "levels"): xs[f.name],
            "predicted": est[sl].tolist(), "se": se[sl].tolist(),
            "lower": lo[sl], "upper": hi[sl],
        }
        if f.kind == CONTINUOUS:
            entry["range"] = list(rng[f.name])
        if d_all is not None:
            entry["desirability"] = d_all[sl].tolist()
        factors.append(entry)
    return {
        "response": model.get("response"), "alpha": alpha, "t_crit": tcrit,
        "df_error": int(model["df_error"]), "rmse": float(model["rmse"]),
        "current": {"settings": cur, **point(0)}, "factors": factors,
    }


def contour_grid(
    model: Mapping[str, Any],
    x_factor: str,
    y_factor: str,
    current: Mapping[str, float | str | None] | None = None,
    *,
    ranges: Mapping[str, tuple[float, float]] | None = None,
    n_x: int = 41,
    n_y: int = 41,
) -> dict[str, Any]:
    """Predicted response on an ``n_y`` x ``n_x`` grid over two continuous
    factors, the rest at ``current``. ``z[j][i]`` is at (``x[i]``, ``y[j]``)."""
    if x_factor == y_factor:
        raise ValueError("pick two different factors")
    if not (2 <= n_x and 2 <= n_y and n_x * n_y <= MAX_CONTOUR_CELLS):
        raise ValueError(f"grid must be at least 2 x 2 and at most {MAX_CONTOUR_CELLS} cells")
    spec = spec_from_dict(model)
    used = {f.name: f for f in _used_factors(spec)}
    for name in (x_factor, y_factor):
        f = used.get(name)
        if f is None:
            raise ValueError(f"{name!r} is not a factor of the model")
        if f.kind != CONTINUOUS:
            raise ValueError(f"the contour profiler needs continuous factors; {name!r} is nominal")
    rng = factor_ranges(model, ranges)
    cur = current_settings(model, current)
    xv = np.linspace(*rng[x_factor], n_x)
    yv = np.linspace(*rng[y_factor], n_y)
    gx, gy = np.meshgrid(xv, yv)  # shape (n_y, n_x)
    settings: dict[str, list[Any]] = {
        name: [cur[name]] * gx.size for name in used if name not in (x_factor, y_factor)
    }
    settings[x_factor] = gx.ravel().tolist()
    settings[y_factor] = gy.ravel().tolist()
    out = predict(model, settings)
    shape = (n_y, n_x)
    return {
        "x_factor": x_factor, "y_factor": y_factor, "x": xv.tolist(), "y": yv.tolist(),
        "z": np.asarray(out["predicted"], dtype=float).reshape(shape).tolist(),
        "se": np.asarray(out["se_mean"], dtype=float).reshape(shape).tolist(),
        "current": cur, "df_error": int(model["df_error"]), "rmse": float(model["rmse"]),
    }
