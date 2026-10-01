r"""Graded (spline) SLD layers as reflectivity fit parameters (S2).

Pure calc layer, used by :mod:`quantized.calc.refl_fit` and
:mod:`quantized.calc.refl_dream`. A graded film layer's SLD(z) runs through
``K >= 2`` knots and is cut into thin slabs exactly as the Model mode's
``/spline-sld`` route does it: ``calc.sld.spline_sld`` (golden vs MATLAB
``splineSLD``) over ``[0, t]``, then midpoint slabs (``profile_to_layers``'
rule, golden vs ``profileToLayers``). So a fitted model simulates the same in
the Model mode.

Parameterisation
----------------
The knots are ordinary named parameters, in the same bound-normalised vector
as the slab fields (``ReflParams``): ``L{i}.knot{j}.sld`` for ``j = 0..K-1``
(required), and optionally ``L{i}.knot{j}.isld`` — absorption knots, positive
= absorption like ``isld``, all K or none. Each has its own value, vary flag,
``min``/``max`` and tie. A graded layer is declared by a spec
``{"layer", "positions", "method", "slices"}``:

* ``positions`` — the knots' depths as FRACTIONS of the layer thickness
  (0 = top, 1 = bottom; strictly increasing, within [0, 1]; default evenly
  spaced), so a fitted ``L{i}.thickness`` stretches the profile;
* ``method`` — ``pchip`` (default), ``spline``, ``makima`` or ``linear``;
* ``slices`` — the slab count, FIXED for the whole fit so the objective stays
  continuous in thickness (default ~2 Å per slab at the starting thickness,
  4..200: the Model mode's ``gradedSlices`` rule).

``L{i}.roughness`` is the interface above the first slab; the slabs' own
interfaces are sharp (the profile is the grading). Without isld knots,
``L{i}.isld`` is a uniform absorption over the slabs, and ``L{i}.msld`` is
always a uniform magnetic SLD. ``L{i}.sld`` means nothing for a graded layer
and may not vary.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.refl_model import (
    ReflParams,
    knot_field,
    layer_param_name,
    layer_stack,
    validate_model,
)
from quantized.calc.sld import spline_sld

__all__ = ["MAX_KNOTS", "MAX_SLICES", "METHODS", "GradedLayer", "ReflStack", "default_slices",
           "model_stack"]

MAX_KNOTS = 64
MAX_SLICES = 400
METHODS = ("pchip", "spline", "makima", "linear")


def default_slices(thickness: float) -> int:
    """About 2 Å per slab, 4..200 (the Model mode's ``gradedSlices`` rule)."""
    t = float(thickness)
    return int(min(200, max(4, math.ceil(t / 2)))) if math.isfinite(t) else 4


@dataclass(frozen=True)
class GradedLayer:
    """One validated graded layer: knot parameter names and how to slice it."""

    layer: int
    positions: NDArray[np.float64]
    method: str
    slices: int
    sld: tuple[str, ...]
    isld: tuple[str, ...]  # empty: no absorption knots


class ReflStack:
    """The model's Parratt stack: slab rows, each graded layer cut into slabs."""

    def __init__(self, n_layers: int, graded: Iterable[GradedLayer] = ()) -> None:
        self.n_layers = n_layers
        self.graded = {g.layer: g for g in graded}

    @property
    def n_rows(self) -> int:
        """Rows the engine sees (a model evaluation's cost scales with it)."""
        return self.n_layers + sum(g.slices - 1 for g in self.graded.values())

    def build(self, params: ReflParams, v: NDArray[np.float64], spin: int) -> NDArray[np.float64]:
        """(M, 4) engine rows for one spin state (0 = none, ±1)."""
        base = layer_stack(params, v, self.n_layers, spin)
        if not self.graded:
            return base
        parts = [row[None, :] if (g := self.graded.get(i)) is None
                 else _slabs(g, params, v, row, spin) for i, row in enumerate(base)]
        return np.asarray(np.vstack(parts), dtype=float)


def _profile(g: GradedLayer, t: float, knots: list[float]) -> NDArray[np.float64]:
    """Midpoint slab values of the knots' interpolant over [0, t]."""
    _, s = spline_sld(g.positions * t, knots, z_range=(0.0, t), n_points=g.slices + 1,
                      method=g.method)
    return np.asarray(0.5 * (s[:-1] + s[1:]), dtype=float)


def _slabs(g: GradedLayer, params: ReflParams, v: NDArray[np.float64],
           row: NDArray[np.float64], spin: int) -> NDArray[np.float64]:
    t = float(row[0])
    knots = [float(v[params.index[n]]) for n in g.sld]
    shift = spin * params.get(v, layer_param_name(g.layer, "msld"), 0.0) if spin else 0.0
    if not t > 0:  # only a tie can get here; a zero-thickness layer is absent
        return np.array([[0.0, knots[0] + shift, row[2], row[3]]])
    out = np.zeros((g.slices, 4))
    out[:, 0] = t / g.slices
    out[:, 1] = _profile(g, t, knots) + shift
    # The engine's absorption sign is negative (layer_stack, BUG-029).
    out[:, 2] = (-_profile(g, t, [float(v[params.index[n]]) for n in g.isld]) if g.isld
                 else row[2])
    out[0, 3] = row[3]
    return out


def model_stack(
    parameters: list[dict[str, Any]],
    channels: list[dict[str, Any]],
    graded: list[dict[str, Any]] | None = None,
) -> ReflStack:
    """Validate the whole model (``validate_model`` plus the graded layers) and
    return its stack. Raises ``ValueError`` naming the first problem."""
    specs = list(graded or [])
    ids: list[int] = []
    for g in specs:
        layer = g.get("layer")
        if not isinstance(layer, int) or isinstance(layer, bool):
            raise ValueError("each graded layer needs an integer 'layer'")
        if layer in ids:
            raise ValueError(f"layer {layer} is declared graded more than once")
        ids.append(layer)
    by_name = {str(p["name"]): p for p in parameters}
    knots: dict[int, dict[str, list[int]]] = {}
    for name in by_name:
        kf = knot_field(name)
        if kf is None:
            continue
        if kf[0] not in ids:
            raise ValueError(f"parameter {name} belongs to no graded layer (declare layer "
                             f"{kf[0]} graded)")
        knots.setdefault(kf[0], {"sld": [], "isld": []})[kf[2]].append(kf[1])
    n = validate_model(parameters, channels, graded=ids)
    return ReflStack(n, [_graded(g, n, by_name, knots.get(g["layer"], {})) for g in specs])


def _varies(p: dict[str, Any] | None) -> bool:
    return p is not None and bool(p.get("vary")) and p.get("tie") in (None, "")


def _graded(g: dict[str, Any], n: int, by_name: dict[str, dict[str, Any]],
            knots: dict[str, list[int]]) -> GradedLayer:
    i = int(g["layer"])
    if not 0 < i < n - 1:
        raise ValueError(f"graded layer {i} must be a film layer (not the incident medium "
                         "or the substrate)")
    sld = sorted(knots.get("sld", []))
    k = len(sld)
    if k < 2:
        raise ValueError(f"graded layer {i} needs at least 2 knots (L{i}.knot0.sld, "
                         f"L{i}.knot1.sld, ...)")
    if k > MAX_KNOTS:
        raise ValueError(f"graded layer {i} has {k} knots (limit {MAX_KNOTS})")
    if sld != list(range(k)):
        raise ValueError(f"the knots of graded layer {i} must be numbered knot0..knot{k - 1} "
                         "without gaps")
    isld = sorted(knots.get("isld", []))
    if isld and isld != sld:
        raise ValueError(f"graded layer {i}: give an isld for every knot or for none")
    if isld and _varies(by_name.get(layer_param_name(i, "isld"))):
        raise ValueError(f"L{i}.isld has no effect when graded layer {i} has isld knots")
    names = [f"L{i}.knot{j}.{f}" for f in ("sld", "isld") for j in range(k)
             if f == "sld" or isld]
    for name in names:
        p = by_name[name]
        lo, hi = p.get("min"), p.get("max")
        if _varies(p) and not (lo is not None and hi is not None and math.isfinite(lo)
                               and math.isfinite(hi) and lo < hi):
            raise ValueError(f"varying parameter {name} needs finite min < max")
    raw = g.get("positions")
    pos = np.linspace(0.0, 1.0, k) if raw is None else np.asarray(raw, dtype=float).ravel()
    if pos.size != k:
        raise ValueError(f"graded layer {i} needs one position per knot ({k}), got {pos.size}")
    if not np.all(np.isfinite(pos)) or pos.min() < 0 or pos.max() > 1:
        raise ValueError(f"the knot positions of graded layer {i} must lie within [0, 1] "
                         "(fractions of its thickness)")
    if np.any(np.diff(pos) <= 0):
        raise ValueError(f"the knot positions of graded layer {i} must be strictly increasing")
    method = g.get("method") or "pchip"
    if method not in METHODS:
        raise ValueError(f"graded layer {i}: method must be one of {METHODS}")
    tp = by_name[layer_param_name(i, "thickness")]
    t_min = tp.get("min")
    if float(tp["value"]) <= 0 or (_varies(tp) and (t_min is None or float(t_min) <= 0)):
        raise ValueError(f"graded layer {i} needs a thickness above 0 (value and min)")
    slices = g.get("slices")
    slices = default_slices(float(tp["value"])) if slices is None else slices
    if not isinstance(slices, int) or isinstance(slices, bool) or not 1 <= slices <= MAX_SLICES:
        raise ValueError(f"graded layer {i}: slices must be an integer in 1..{MAX_SLICES}")
    return GradedLayer(i, pos, str(method), slices,
                       tuple(f"L{i}.knot{j}.sld" for j in range(k)),
                       tuple(f"L{i}.knot{j}.isld" for j in range(k)) if isld else ())
