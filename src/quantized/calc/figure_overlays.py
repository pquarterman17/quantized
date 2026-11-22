"""Scatter overlays: a line of fit (optionally with a CI or prediction band), a
LOWESS smoother and a density ellipse, for ANY plotted series (gap audit 8, SCAT).

The one computation behind the live plot (``POST /api/plot/overlays``) and the
vector export (``calc.figure_overlays_draw``), so the screen and the exported
figure draw the same curves and say the same words in their legends.

Spec (a plain dict, the wire form of the frontend's ``PlotView.overlays``)::

    {"line":     {"band": "none"|"confidence"|"prediction", "level": 0.95},
     "smoother": {"span": 0.5},
     "ellipse":  {"level": 0.95}}

An absent key is an overlay that is OFF. Each series is computed on its finite
``(x, y)`` pairs. A blank cell (NaN or null) is a missing value and is dropped:
rows excluded from the analysis or dropped by the data filter arrive blank, so
they never enter a fit. ``+-inf`` is not a missing value, it is bad data, and
refuses every overlay for that series. An overlay that cannot be drawn honestly
is REFUSED with a plain reason (too few points, constant X, collinear points,
too many points for the smoother) and nothing is drawn for it: a number is
never invented. A refusal is reported, not raised, so one thin series does not
hide the others' overlays. Pure: arrays in, plain dicts out.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.signal_filters import lowess
from quantized.calc.stats_band import polynomial_confidence_band

__all__ = [
    "BANDS",
    "ELLIPSE_MIN_POINTS",
    "GRID_POINTS",
    "LINE_MIN_POINTS",
    "SMOOTHER_MAX_POINTS",
    "SMOOTHER_MIN_POINTS",
    "OverlayRefused",
    "compute_overlays",
    "overlay_specs_label",
    "validate_overlay_spec",
]

#: Fewest finite points each overlay needs (a line's CI needs a residual dof).
LINE_MIN_POINTS = 3
SMOOTHER_MIN_POINTS = 8
ELLIPSE_MIN_POINTS = 5
#: LOWESS is O(n^2) in Python (~1 s at 5000 points); past this the smoother is
#: refused, not slow. The cap is per REQUEST: the curves of one plot share it.
SMOOTHER_MAX_POINTS = 5000
#: Points the fitted line and its band are evaluated at, across the data's X range.
GRID_POINTS = 60
#: Points of the ellipse outline.
ELLIPSE_POINTS = 120
BANDS = ("none", "confidence", "prediction")
_KINDS = ("line", "smoother", "ellipse")
_DEFAULT_LEVEL = 0.95
_DEFAULT_SPAN = 0.5
_LOWESS_ROBUST_PASSES = 2


class OverlayRefused(ValueError):
    """An overlay that cannot be drawn honestly; the message is the reason."""


def _level(raw: Any, what: str) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not 0.0 < float(raw) < 1.0:
        raise ValueError(f"{what} level must be a number between 0 and 1 (exclusive)")
    return float(raw)


def validate_overlay_spec(spec: Any) -> dict[str, dict[str, Any]]:
    """The normalised spec (defaults filled in, unknown keys dropped), or a
    ``ValueError`` for a malformed one. ``None``/empty = no overlays."""
    if spec is None:
        return {}
    if not isinstance(spec, Mapping):
        raise ValueError("overlays must be an object with line / smoother / ellipse entries")
    out: dict[str, dict[str, Any]] = {}
    for kind in _KINDS:
        raw = spec.get(kind)
        if raw is None or raw is False:
            continue
        if raw is True:
            raw = {}
        if not isinstance(raw, Mapping):
            raise ValueError(f"overlays.{kind} must be an object")
        if kind == "line":
            band = raw.get("band", "none")
            if band not in BANDS:
                raise ValueError(f"line band must be one of {list(BANDS)}")
            out[kind] = {"band": band, "level": _level(raw.get("level", _DEFAULT_LEVEL), "line")}
        elif kind == "smoother":
            span = raw.get("span", _DEFAULT_SPAN)
            if (
                isinstance(span, bool)
                or not isinstance(span, (int, float))
                or not 0.05 <= float(span) <= 1.0
            ):
                raise ValueError("smoother span must be a number from 0.05 to 1")
            out[kind] = {"span": float(span)}
        else:
            out[kind] = {"level": _level(raw.get("level", _DEFAULT_LEVEL), "ellipse")}
    return out


def _num(v: float) -> str:
    return f"{v:.4g}"


def _pct(level: float) -> str:
    return f"{level * 100:g}%"


def _line_equation(slope: float, intercept: float) -> str:
    sign = "-" if intercept < 0 else "+"
    return f"y = {_num(slope)}x {sign} {_num(abs(intercept))}"


def _pairs(x: Any, y: Any) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """The finite pairs of ``x``/``y``. Blank (NaN/None) cells are dropped; an
    infinity refuses the series."""
    xv = np.asarray(
        [np.nan if v is None else v for v in np.asarray(x, dtype=object).ravel()], dtype=float
    )
    yv = np.asarray(
        [np.nan if v is None else v for v in np.asarray(y, dtype=object).ravel()], dtype=float
    )
    if xv.size != yv.size:
        raise OverlayRefused("x and y have different lengths")
    if np.isinf(xv).any() or np.isinf(yv).any():
        raise OverlayRefused(
            "the data contains infinite values (not a missing value), so nothing is fitted"
        )
    ok = np.isfinite(xv) & np.isfinite(yv)
    return xv[ok], yv[ok]


def _need(n: int, least: int, what: str) -> None:
    if n < least:
        raise OverlayRefused(
            f"{what} needs at least {least} points with a value in both X and Y (this has {n})"
        )


def _line(
    x: NDArray[np.float64], y: NDArray[np.float64], spec: Mapping[str, Any]
) -> dict[str, Any]:
    n = int(x.size)
    _need(n, LINE_MIN_POINTS, "a line of fit")
    if float(np.ptp(x)) <= 0.0:
        raise OverlayRefused("a line of fit needs X values that are not all equal")
    grid = np.linspace(float(x.min()), float(x.max()), GRID_POINTS)
    band = str(spec["band"])
    level = float(spec["level"])
    interval = "prediction" if band == "prediction" else "confidence"
    res = polynomial_confidence_band(x, y, grid, order=1, alpha=1.0 - level, interval=interval)
    y_fit = np.asarray(res["yFit"], dtype=float)
    mx, my = float(x.mean()), float(y.mean())
    sxx = float(((x - mx) ** 2).sum())
    slope = float(((x - mx) * (y - my)).sum() / sxx)
    intercept = my - slope * mx
    ss_tot = float(((y - my) ** 2).sum())
    ss_res = float(((y - (intercept + slope * x)) ** 2).sum())
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0
    out: dict[str, Any] = {
        "x": grid.tolist(),
        "y": y_fit.tolist(),
        "slope": slope,
        "intercept": intercept,
        "r2": r2,
        "n": n,
        "label": f"Line of fit: {_line_equation(slope, intercept)} (R² = {_num(r2)}, n = {n})",
        "band": None,
    }
    if band != "none":
        out["band"] = {
            "kind": band,
            "level": level,
            "lo": np.asarray(res["ciLo"], dtype=float).tolist(),
            "hi": np.asarray(res["ciHi"], dtype=float).tolist(),
            "label": f"{_pct(level)} {band} band",
        }
    return out


def _smoother(
    x: NDArray[np.float64], y: NDArray[np.float64], spec: Mapping[str, Any]
) -> dict[str, Any]:
    n = int(x.size)
    _need(n, SMOOTHER_MIN_POINTS, "a smoother")
    if n > SMOOTHER_MAX_POINTS:
        raise OverlayRefused(
            f"a smoother is limited to {SMOOTHER_MAX_POINTS} points (this has {n}); "
            "thin or bin the data first"
        )
    if float(np.ptp(x)) <= 0.0:
        raise OverlayRefused("a smoother needs X values that are not all equal")
    span = float(spec["span"])
    order = np.argsort(x, kind="stable")
    xs, ys = x[order], y[order]
    fit = lowess(xs, ys, frac=span, iterations=_LOWESS_ROBUST_PASSES)
    # One curve point per distinct X (ties give identical fits in the local line).
    keep = np.concatenate(([True], np.diff(xs) > 0))
    return {
        "x": xs[keep].tolist(),
        "y": fit[keep].tolist(),
        "span": span,
        "n": n,
        "label": f"LOWESS smoother (span {span:g}, n = {n})",
    }


def _ellipse(
    x: NDArray[np.float64], y: NDArray[np.float64], spec: Mapping[str, Any]
) -> dict[str, Any]:
    n = int(x.size)
    _need(n, ELLIPSE_MIN_POINTS, "a density ellipse")
    level = float(spec["level"])
    cov = np.cov(np.vstack([x, y]))
    vals, vecs = np.linalg.eigh(cov)
    scale = float(max(abs(cov[0, 0]), abs(cov[1, 1])))
    if scale <= 0.0 or float(vals[0]) <= 1e-12 * scale:
        raise OverlayRefused("a density ellipse needs points that are not on a straight line")
    # Bivariate normal contour: the squared Mahalanobis radius is chi-square with
    # 2 degrees of freedom, whose quantile is -2 ln(1 - level) in closed form.
    radius = math.sqrt(-2.0 * math.log(1.0 - level))
    t = np.linspace(0.0, 2.0 * math.pi, ELLIPSE_POINTS + 1)
    circle = np.vstack([np.cos(t), np.sin(t)]) * (radius * np.sqrt(vals))[:, None]
    pts = vecs @ circle + np.array([[float(x.mean())], [float(y.mean())]])
    return {
        "x": pts[0].tolist(),
        "y": pts[1].tolist(),
        "level": level,
        "n": n,
        "label": f"{_pct(level)} density ellipse (n = {n})",
    }


_DRAW = {"line": _line, "smoother": _smoother, "ellipse": _ellipse}


def compute_overlays(
    x: Any,
    y: Any,
    spec: Mapping[str, Mapping[str, Any]],
    smoother_room: int = SMOOTHER_MAX_POINTS,
) -> dict[str, Any]:
    """Every overlay in the (validated) ``spec`` for one series: ``{kind:
    result}`` for those drawn and ``refused: {kind: reason}`` for those not.
    ``smoother_room`` is what is left of the smoother's point cap after the
    plot's earlier curves (``series_overlays``)."""
    result: dict[str, Any] = {"refused": {}}
    if not spec:
        return result
    try:
        xv, yv = _pairs(x, y)
    except OverlayRefused as exc:
        result["refused"] = {kind: str(exc) for kind in spec}
        return result
    for kind in _KINDS:
        if kind not in spec:
            continue
        if (
            kind == "smoother"
            and SMOOTHER_MIN_POINTS <= xv.size > smoother_room < SMOOTHER_MAX_POINTS
        ):
            result["refused"][kind] = (
                f"the smoothers of one plot are limited to {SMOOTHER_MAX_POINTS} points in "
                f"total ({max(smoother_room, 0)} left for this curve, which has {xv.size}); "
                "thin or bin the data first"
            )
            continue
        try:
            result[kind] = _DRAW[kind](xv, yv, spec[kind])
        except (OverlayRefused, np.linalg.LinAlgError, ValueError) as exc:
            result["refused"][kind] = str(exc)
    return result


def overlay_specs_label(label: str, text: str, several: bool) -> str:
    """A legend line: prefixed with the series name when more than one series
    is overlaid, so the lines say which curve they belong to."""
    return f"{label}: {text}" if several and label else text


def series_overlays(
    series: Sequence[tuple[str, Any]], x: Any, spec: Mapping[str, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """``compute_overlays`` for each ``(label, y)`` against the shared ``x``. The
    smoother's point cap is shared by the curves, so one request (a live redraw
    or an export) never runs more than one capped LOWESS's worth of work."""
    out: list[dict[str, Any]] = []
    room = SMOOTHER_MAX_POINTS
    for label, y in series:
        res = compute_overlays(x, y, spec, smoother_room=room)
        if "smoother" in res:
            room -= int(res["smoother"]["n"])
        out.append({"label": label, **res})
    return out
