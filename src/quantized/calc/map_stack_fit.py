"""Per-pixel fit through a stack of maps (Origin's "fit a series of matrices").

A *stack* is a list of maps on ONE grid, each with a value of an independent
variable (a temperature, a time, a field...). The curve at a pixel is that
pixel's value in every layer against those values. One registry model is fitted
to every pixel's curve through the ordinary fit core (``calc.fitting.curve_fit``:
the same engine, bounds and held parameters as Curve Fit); this module only
arranges the pixels and gathers the results into maps. There is no second
fitter.

**Grid rule (fail closed).** Every layer must sit on the same grid (equal shape,
axis coordinates within 1e-6 of a pixel pitch) with the same axis labels and
units and the same value unit. A mismatch is refused with both extents in the
message; nothing is resampled.

**Starts.** A pixel starts from the caller's start values; an entry left open
(``None``) comes from the model's ``auto_guess`` on THAT pixel's curve (so an
amplitude that varies across the map is followed), falling back to the
catalogue start. A fit that did not converge is retried from the last pixel that
did, then from the catalogue start; the first converged fit is kept, otherwise
the lowest residual. A held (fixed) parameter needs a start value.

**Failures.** A pixel with no finite layer is "no data" (NaN, counted apart: a
masked region is not a failure). A pixel whose fit raises, comes back
non-finite, or did not converge is a failure: NaN in EVERY output map, counted
and summarised by reason, and it never stops the run. ``keep_unconverged=True``
(an explicit choice) keeps the values of a fit that did not converge, flagged 0
in the converged map; the default drops them, so no unconverged value reaches a
map unmarked. Non-finite layers of a pixel are left out of that pixel's curve.

**Outputs.** For each FREE parameter a value map and a standard-error map
(Origin / scipy convention, ``calc.fitting``'s ``jtj`` errors scaled by the
reduced chi-square), plus a reduced chi-square map and a converged map
(1 converged, 0 kept-unconverged, NaN failed or no data). A pixel with exactly
as many layers as free parameters has no degrees of freedom: its errors and
reduced chi-square are NaN.

Cancellation is cooperative: ``abort_check`` is polled before every pixel and a
``True`` raises :class:`StackFitCancelled` out of the run, so nothing partial is
returned. Pure layer: no fastapi / pydantic / job store.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_holds import check_held_starts
from quantized.calc.fit_models import FIT_MODELS, evaluate, with_domain_bounds
from quantized.calc.fitting import curve_fit
from quantized.calc.map_ops import MapGrid
from quantized.datastruct import DataStruct
from quantized.io._array_books import grid_map_datastruct

__all__ = [
    "StackFitCancelled",
    "StackFitResult",
    "check_stack",
    "fit_map_stack",
    "result_maps",
]

ProgressFn = Callable[[float, str], None]
AbortFn = Callable[[], bool]
_MAX_REASONS = 6
_DROP_META = ("is2D", "map_shape", "map_grid", "axis1_name", "axis2_name", "x_channel", "map_op")


class StackFitCancelled(Exception):
    """The run was cancelled; no result exists."""


@dataclass(frozen=True)
class StackFitResult:
    """The fitted maps (all ``(ny, nx)``) and a summary of what happened."""

    grid: MapGrid
    model: str
    param_names: list[str]
    free: list[int]
    params: NDArray[np.float64]  # (k_free, ny, nx)
    errors: NDArray[np.float64]  # (k_free, ny, nx)
    chisq_red: NDArray[np.float64]
    converged: NDArray[np.float64]
    summary: dict[str, Any]


def _same_axis(a: NDArray[np.float64], b: NDArray[np.float64]) -> bool:
    if a.shape != b.shape:
        return False
    pitch = float(np.median(np.diff(a)))
    return bool(np.all(np.abs(a - b) <= 1e-6 * abs(pitch)))


def _extent(g: MapGrid) -> str:
    return (
        f"{g.x_label} {g.x[0]:g}..{g.x[-1]:g} ({len(g.x)}) x "
        f"{g.y_label} {g.y[0]:g}..{g.y[-1]:g} ({len(g.y)})"
    )


def check_stack(grids: Sequence[MapGrid], x_values: Sequence[float]) -> NDArray[np.float64]:
    if len(grids) < 3:
        raise ValueError(f"a stack needs at least 3 maps for a per-pixel curve; got {len(grids)}")
    xv = np.asarray(x_values, dtype=float).ravel()
    if xv.size != len(grids):
        raise ValueError(f"{len(grids)} maps need {len(grids)} values; got {xv.size}")
    if not bool(np.all(np.isfinite(xv))):
        raise ValueError("every layer needs a finite value of the independent variable")
    if float(np.ptp(xv)) == 0.0:
        raise ValueError("the layers all have the same value; a curve needs them to differ")
    first = grids[0]
    for k, g in enumerate(grids[1:], start=2):
        if (g.x_unit, g.y_unit, g.z_unit) != (first.x_unit, first.y_unit, first.z_unit) or (
            g.x_label.lower(), g.y_label.lower()
        ) != (first.x_label.lower(), first.y_label.lower()):
            raise ValueError(
                f"layer {k} has different axes or value unit than layer 1 "
                f"({g.x_label} [{g.x_unit}], {g.y_label} [{g.y_unit}], value [{g.z_unit}] "
                f"against {first.x_label} [{first.x_unit}], {first.y_label} [{first.y_unit}], "
                f"value [{first.z_unit}])"
            )
        if not (_same_axis(g.x, first.x) and _same_axis(g.y, first.y)):
            raise ValueError(
                f"layer {k} is on a different grid and was not combined. "
                f"Layer 1: {_extent(first)}; layer {k}: {_extent(g)}. "
                "Crop or regrid the maps to one grid first"
            )
    return xv


def _starts(
    model: str, p0: Sequence[float | None] | None, n: int, fixed: Sequence[bool]
) -> list[float | None]:
    given: list[float | None] = (
        [None] * n if p0 is None else [None if v is None else float(v) for v in p0]
    )
    if len(given) != n:
        raise ValueError(f"{model} has {n} parameters; got {len(given)} start values")
    for k, held in enumerate(fixed):
        if held and given[k] is None:
            name = FIT_MODELS[model]["paramNames"][k]
            raise ValueError(f"parameter {name!r} is held, so it needs a start value")
    return given


def _fill(given: Sequence[float | None], base: Sequence[float]) -> list[float]:
    return [float(b) if v is None else v for v, b in zip(given, base, strict=True)]


def _short(exc: BaseException) -> str:
    text = " ".join(str(exc).split()) or type(exc).__name__
    return text if len(text) <= 120 else text[:117] + "..."


def fit_map_stack(
    grids: Sequence[MapGrid],
    x_values: Sequence[float],
    model: str,
    *,
    p0: Sequence[float | None] | None = None,
    lower: Sequence[float | None] | None = None,
    upper: Sequence[float | None] | None = None,
    fixed: Sequence[bool] | None = None,
    keep_unconverged: bool = False,
    progress: ProgressFn | None = None,
    abort_check: AbortFn | None = None,
) -> StackFitResult:
    """Fit ``model`` to the curve ``(x_values, layer values)`` at every pixel."""
    spec = FIT_MODELS.get(model)
    if spec is None:
        raise ValueError(f"unknown model: {model}")
    xv = check_stack(grids, x_values)
    n_par = int(spec["nParams"])
    names = [str(s) for s in spec["paramNames"]]
    held = [False] * n_par if fixed is None else [bool(v) for v in fixed]
    if len(held) != n_par:
        raise ValueError(f"{model} has {n_par} parameters; got {len(held)} held flags")
    free = [k for k in range(n_par) if not held[k]]
    if not free:
        raise ValueError("every parameter is held; nothing to fit")
    given = _starts(model, p0, n_par, held)
    lo, hi = with_domain_bounds(model, lower, upper)
    catalogue = [float(v) for v in spec["p0"]]
    check_held_starts(names, _fill(given, catalogue), held, lo, hi)

    g0 = grids[0]
    stack = np.stack([np.asarray(g.z, dtype=float) for g in grids])  # (L, ny, nx)
    n_layers, ny, nx = stack.shape
    out_p = np.full((len(free), ny, nx), np.nan)
    out_e = np.full((len(free), ny, nx), np.nan)
    out_c = np.full((ny, nx), np.nan)
    out_ok = np.full((ny, nx), np.nan)

    def model_fcn(xx: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(evaluate(model, xx, pp), dtype=float)

    def run(
        xs: NDArray[np.float64], ys: NDArray[np.float64], start: Sequence[float]
    ) -> dict[str, Any]:
        return curve_fit(xs, ys, model_fcn, start, lower=lo, upper=hi, fixed=held)

    n_total = ny * nx
    n_fit = n_none = n_bad = n_open = 0
    reasons: Counter[str] = Counter()
    where: dict[str, list[int]] = {}
    prev: list[float] | None = None

    def fail(why: str, j: int, i: int) -> None:
        nonlocal n_bad
        n_bad += 1
        reasons[why] += 1
        where.setdefault(why, [j, i])

    done = 0
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        for j in range(ny):
            for i in range(nx):
                if abort_check is not None and abort_check():
                    raise StackFitCancelled("stack fit cancelled")
                done += 1
                col = stack[:, j, i]
                ok = np.isfinite(col)
                if not bool(ok.any()):
                    n_none += 1
                    continue
                xs, ys = xv[ok], col[ok]
                try:
                    try:
                        auto = auto_guess(model, xs, ys)
                    except Exception:  # odd data can defeat the heuristic; catalogue start
                        auto = catalogue
                    tries = [_fill(given, auto)]
                    if prev is not None:
                        tries.append(_fill(given, prev))
                    tries.append(_fill(given, catalogue))
                    best: dict[str, Any] | None = None
                    for start in tries:
                        res = run(xs, ys, start)
                        finite = bool(np.all(np.isfinite(res["params"])))
                        if finite and int(res["exitFlag"]) == 1:
                            best = res
                            break
                        if finite and (
                            best is None or float(res["SSR"]) < float(best["SSR"])
                        ):
                            best = res
                    assert best is not None  # tries is never empty
                except Exception as exc:  # per-pixel containment: one bad pixel never stops the run
                    fail(_short(exc), j, i)
                    continue
                converged = int(best["exitFlag"]) == 1
                p_all = np.asarray(best["params"], dtype=float)
                if not bool(np.all(np.isfinite(p_all))):
                    fail("the fit returned non-finite parameters", j, i)
                    continue
                if not converged:
                    if not keep_unconverged:
                        fail("the fit did not converge", j, i)
                        continue
                    n_open += 1
                else:
                    prev = [float(v) for v in p_all]
                out_p[:, j, i] = p_all[free]
                out_e[:, j, i] = np.asarray(best["errors"], dtype=float)[free]
                out_c[j, i] = float(best["chiSqRed"])
                out_ok[j, i] = 1.0 if converged else 0.0
                n_fit += 1
            if progress is not None:
                progress(done / n_total, f"Fitting row {j + 1}/{ny}")
    summary: dict[str, Any] = {
        "n_pixels": n_total,
        "n_layers": n_layers,
        "n_fitted": n_fit,
        "n_failed": n_bad,
        "n_no_data": n_none,
        "n_unconverged_kept": n_open,
        "failures": [
            {"reason": why, "count": cnt,
             "first_pixel": {"row": where[why][0], "col": where[why][1]}}
            for why, cnt in reasons.most_common(_MAX_REASONS)
        ],
    }
    return StackFitResult(g0, model, names, free, out_p, out_e, out_c, out_ok, summary)


def result_maps(
    res: StackFitResult, layer_names: Sequence[str], x_values: Sequence[float], x_label: str
) -> list[tuple[str, str, DataStruct]]:
    """``(name, kind, map)`` for every output: per free parameter its value and
    standard-error map, then the reduced chi-square and converged maps."""
    g = res.grid
    meta = {
        k: v for k, v in g.metadata.items()
        if k not in _DROP_META
    }

    def build(z: NDArray[np.float64], what: str, unit: str) -> DataStruct:
        info = {
            "op": "stack_fit", "model": res.model, "output": what, "layers": list(layer_names),
            "x_values": [float(v) for v in x_values], "x_label": x_label, **res.summary,
        }
        return grid_map_datastruct(
            z, g.x, g.y, x_label=g.x_label, x_unit=g.x_unit, y_label=g.y_label, y_unit=g.y_unit,
            z_unit=unit, metadata={**meta, "map_op": info},
        )

    maps: list[tuple[str, str, DataStruct]] = []
    for row, k in enumerate(res.free):
        name = res.param_names[k]
        maps.append((name, "parameter", build(res.params[row], name, "")))
        err = build(res.errors[row], f"{name} std. error", "")
        maps.append((f"{name} (std. error)", "error", err))
    maps.append(("reduced chi-sq", "chisq", build(res.chisq_red, "reduced chi-sq", "")))
    maps.append(("converged", "converged", build(res.converged, "converged", "")))
    return maps

