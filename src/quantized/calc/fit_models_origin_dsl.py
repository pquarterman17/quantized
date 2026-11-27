"""Table-driven registration for the bulk of Origin's built-in fit functions.

Pure calc layer. The Exponential, Growth/Sigmoidal, Power, Hyperbola,
Logarithm, Rational, Polynomial, Peak and Waveform families outside the
hand-written ``fit_models_origin_*`` modules are declared with :func:`define`:
Origin's function name, its parameter names in Origin's order, the formula as
a plain numpy function, and the bounds Origin enables by default.

Alongside the evaluator, :func:`define` records which parameters enter the
model *linearly* (offsets, amplitudes, asymptotes) and what kind of quantity
each remaining one is (a position, a width, a rate, an exponent, ...). The
generic automatic initial guess in ``fit_guess_origin_generic`` scans only the
nonlinear parameters over candidate values chosen from that kind and solves the
linear ones exactly (variable projection), so a new function needs no
per-function guess code.

Formulas and parameter names only; no text from Origin's definition files is
reproduced here.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from .fit_models import register_model

FloatArray = NDArray[np.float64]
Formula = Callable[..., FloatArray]

_INF = float("inf")

__all__ = ["NEW_ORIGIN_MODELS", "SPECS", "Spec", "define"]


@dataclass(frozen=True)
class Spec:
    """One declared function: what the registry and the guess both need."""

    name: str
    category: str
    params: tuple[str, ...]
    fn: Formula
    lin: tuple[str, ...]
    kinds: dict[str, str]
    lb: tuple[float, ...]
    ub: tuple[float, ...]
    positive_x: bool


SPECS: dict[str, Spec] = {}
# Every name declared through define(), in declaration order. Tests that pin
# the pre-existing Origin library exclude these; the default model scan lists
# them as "not in the default scan".
NEW_ORIGIN_MODELS: list[str] = []


def _pairs(spec: str) -> dict[str, str]:
    """``"a=w b=k"`` -> {"a": "w", "b": "k"}."""
    return dict(item.split("=", 1) for item in spec.split())


def define(
    name: str, category: str, params: str, fn: Formula, *,
    lin: str = "", kinds: str = "", lb: dict[str, float] | None = None,
    ub: dict[str, float] | None = None, p0: dict[str, float] | None = None,
    positive_x: bool = False,
) -> None:
    """Declare and register one Origin function.

    ``params``  comma-separated names in Origin's order.
    ``fn``      ``fn(x, *p) -> y`` over a float array ``x`` and scalar parameters.
    ``lin``     comma-separated parameters the model is affine in.
    ``kinds``   ``"name=kind ..."`` for the other parameters (see the guess module).
    ``lb/ub``   Origin's default bounds that are switched on (sparse by name).
    ``p0``      registry default start values (sparse by name; 1.0 otherwise).
    ``positive_x``  the guess uses only the x > 0 points.
    """
    names = tuple(s.strip() for s in params.split(","))
    lin_names = tuple(s.strip() for s in lin.split(",") if s.strip())
    kind_map = _pairs(kinds)
    unknown = (set(lin_names) | set(kind_map)) - set(names)
    missing = set(names) - set(lin_names) - set(kind_map)
    if unknown or missing or (set(lin_names) & set(kind_map)):
        raise ValueError(f"{name}: parameter roles inconsistent ({unknown or missing})")
    lo = tuple((lb or {}).get(n, -_INF) for n in names)
    hi = tuple((ub or {}).get(n, _INF) for n in names)
    start = [float((p0 or {}).get(n, 1.0)) for n in names]

    def fcn(x: FloatArray, p: FloatArray) -> FloatArray:
        with np.errstate(all="ignore"):
            out = np.asarray(fn(x, *(np.float64(v) for v in p[: len(names)])), dtype=float)
        if out.shape != x.shape:
            out = np.broadcast_to(out, x.shape).astype(float)
        return out

    fcn.__doc__ = f"Origin ``{name}``: parameters ({', '.join(names)})."
    register_model(name, category, fcn, list(names), start, list(lo), list(hi))
    SPECS[name] = Spec(name, category, names, fn, lin_names, kind_map, lo, hi, positive_x)
    NEW_ORIGIN_MODELS.append(name)
