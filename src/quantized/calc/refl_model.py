r"""Layer-model parameters and data channels for reflectivity fitting (P2.2).

Pure calc layer, used by :mod:`quantized.calc.refl_fit`. See that module's
header for the model; this one owns the parts a fit and a plain model
evaluation share: the named parameter set (values, bounds, ties), the checks
that refuse a model which cannot mean what it says, the Parratt layer stack for
one spin state, and one measured curve (a channel).

Conventions (stated once, relied on everywhere):

* Layer 0 is the incident medium, layer ``M-1`` the substrate; their
  thicknesses mean nothing, and ``L{i}.roughness`` is the roughness of the
  interface ABOVE layer ``i`` (so ``L0.roughness`` means nothing either).
* ``isld`` is the imaginary SLD with POSITIVE = absorption, the convention of
  ``calc.sld_formula`` / periodictable / refl1d. The golden Parratt engine
  (``calc.reflectivity``, a port of MATLAB ``parrattRefl``) uses the opposite
  sign — a positive imaginary part there makes a film amplify the beam — so
  :func:`layer_stack` negates it at the boundary. See BUG-029.
* A spin channel sees ``sld + s·msld`` with ``s = +1`` for ``"+"`` and ``-1``
  for ``"-"`` (refl1d's convention: R++ sees ρ + ρM). An unpolarised channel
  ignores ``msld``; X-ray and neutron channels would need different SLDs, so a
  joint fit must not mix them.
"""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = [
    "FWHM_TO_SIGMA",
    "LAYER_FIELDS",
    "ReflChannel",
    "ReflParams",
    "layer_field",
    "layer_param_name",
    "layer_stack",
    "validate_model",
]

LAYER_FIELDS = ("thickness", "sld", "isld", "roughness", "msld")
FWHM_TO_SIGMA = 1.0 / (2.0 * math.sqrt(2.0 * math.log(2.0)))
# Canonical ASCII only: "L01.sld" or a non-ASCII digit would pass int() yet
# never match the canonical name layer_stack looks up.
_LAYER_NAME = re.compile(r"^L(0|[1-9][0-9]*)\.([a-z]+)$", re.ASCII)
_NON_NEGATIVE = ("thickness", "roughness")


def layer_param_name(layer: int, field: str) -> str:
    """The canonical parameter name for a layer field, e.g. ``L1.thickness``."""
    return f"L{layer}.{field}"


def layer_field(name: str) -> tuple[int, str] | None:
    """``(layer, field)`` for a canonical layer parameter name, else None."""
    m = _LAYER_NAME.match(name)
    return (int(m.group(1)), m.group(2)) if m else None


class ReflParams:
    """Resolved parameter set: values, free indices, bounds and tie chains."""

    def __init__(self, specs: list[dict[str, Any]]) -> None:
        self.names = [str(s["name"]) for s in specs]
        if len(set(self.names)) != len(self.names):
            raise ValueError("parameter names must be unique")
        self.index = {n: i for i, n in enumerate(self.names)}
        self.values = np.array([float(s["value"]) for s in specs], dtype=float)
        if not np.all(np.isfinite(self.values)):
            raise ValueError("every parameter value must be finite")
        self.tie: list[str | None] = [
            (str(s["tie"]) if s.get("tie") not in (None, "") else None) for s in specs
        ]
        for n, t in zip(self.names, self.tie, strict=True):
            if t is not None and t not in self.index:
                raise ValueError(f"parameter {n} is tied to unknown parameter {t}")
            if t == n:
                raise ValueError(f"parameter {n} is tied to itself")
        self.root = [self._resolve(i) for i in range(len(specs))]
        self.free: list[int] = []
        lo_l: list[float] = []
        hi_l: list[float] = []
        for i, s in enumerate(specs):
            if not bool(s.get("vary", False)) or self.tie[i] is not None:
                continue
            lo_raw, hi_raw = s.get("min"), s.get("max")
            lo = -math.inf if lo_raw is None else float(lo_raw)
            hi = math.inf if hi_raw is None else float(hi_raw)
            if not (math.isfinite(lo) and math.isfinite(hi)) or not lo < hi:
                raise ValueError(f"varying parameter {self.names[i]} needs finite min < max")
            if not lo <= self.values[i] <= hi:
                raise ValueError(f"parameter {self.names[i]} starts outside [{lo:g}, {hi:g}]")
            self.free.append(i)
            lo_l.append(lo)
            hi_l.append(hi)
        self.lo = np.array(lo_l, dtype=float)
        self.span = np.array(hi_l, dtype=float) - self.lo

    def _resolve(self, i: int) -> int:
        seen = {i}
        while self.tie[i] is not None:
            i = self.index[str(self.tie[i])]
            if i in seen:
                raise ValueError("parameter ties form a cycle")
            seen.add(i)
        return i

    def x0(self) -> NDArray[np.float64]:
        if not self.free:
            return np.zeros(0)
        return np.asarray((self.values[self.free] - self.lo) / self.span, dtype=float)

    def full(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """All parameter values for normalised free vector ``x`` (ties applied)."""
        v = self.values.copy()
        if self.free:
            v[self.free] = self.lo + x * self.span
        return np.asarray(v[self.root], dtype=float)

    def get(self, v: NDArray[np.float64], name: str, default: float) -> float:
        i = self.index.get(name)
        return default if i is None else float(v[i])


def validate_model(specs: list[dict[str, Any]], channels: list[dict[str, Any]]) -> int:
    """Refuse a model that cannot mean what it says; return the layer count.

    A misspelled name, or a varied parameter the model never reads, would
    otherwise be fitted as a flat direction and reported as perfectly
    determined. Every name must be a canonical layer field (``L1.sld``, not
    ``L01.sld``) or a scale/background some channel uses; every layer needs an
    SLD and every interior layer a thickness; the fields that mean nothing
    (incident-medium thickness, roughness and msld, substrate thickness) may
    not vary, and L0.msld must be 0; msld may vary only with a polarised
    channel; and
    thickness/roughness bounds must be non-negative (the engine treats
    values <= 0 as absent, a region with no gradient).
    """
    globals_used = {str(c.get("scale", "scale")) for c in channels}
    globals_used |= {str(c.get("background", "background")) for c in channels}
    layers: dict[int, set[str]] = {}
    for s in specs:
        name = str(s["name"])
        lf = layer_field(name)
        if lf:
            i, field = lf
            if field not in LAYER_FIELDS:
                raise ValueError(f"unknown layer field in parameter {name}")
            layers.setdefault(i, set()).add(field)
        elif name not in globals_used:
            raise ValueError(
                f"parameter {name} is not a layer field or a scale/background any channel uses"
            )
    if not layers:
        raise ValueError("the model has no layer parameters")
    n = max(layers) + 1
    if n < 2:
        raise ValueError("need at least 2 layers (incident medium + substrate)")
    for i in range(n):
        fields = layers.get(i, set())
        if "sld" not in fields:
            raise ValueError(f"layer {i} has no L{i}.sld parameter")
        if 0 < i < n - 1 and "thickness" not in fields:
            raise ValueError(f"interior layer {i} has no L{i}.thickness parameter")
    meaningless = {"L0.thickness", "L0.roughness", "L0.msld", f"L{n - 1}.thickness"}
    polarised = any(c.get("spin") in ("+", "-") for c in channels)
    for s in specs:
        name = str(s["name"])
        varies = bool(s.get("vary")) and s.get("tie") in (None, "")
        lf = layer_field(name)
        if name in meaningless and varies:
            raise ValueError(f"{name} has no effect on the model and cannot be fitted")
        if name == "L0.msld" and float(s["value"]) != 0:
            raise ValueError("L0.msld must be 0: the incident medium is not magnetic")
        if lf and lf[1] == "msld" and varies and not polarised:
            raise ValueError(f"{name} cannot be fitted without a polarised (+/-) channel")
        if lf and lf[1] in _NON_NEGATIVE:
            lo = s.get("min")
            if float(s["value"]) < 0 or (varies and lo is not None and float(lo) < 0):
                raise ValueError(f"{name} must be non-negative (value and min)")
    return n


def layer_stack(
    params: ReflParams, v: NDArray[np.float64], n_layers: int, spin: int
) -> NDArray[np.float64]:
    """(M, 4) Parratt layer array for one spin state (0 = none, ±1).

    Converts ``isld`` (positive = absorption) to the engine's sign."""
    rows = []
    for i in range(n_layers):
        sld = params.get(v, layer_param_name(i, "sld"), 0.0)
        if spin:
            sld += spin * params.get(v, layer_param_name(i, "msld"), 0.0)
        rows.append([
            params.get(v, layer_param_name(i, "thickness"), 0.0),
            sld,
            -params.get(v, layer_param_name(i, "isld"), 0.0),
            params.get(v, layer_param_name(i, "roughness"), 0.0),
        ])
    return np.asarray(rows, dtype=float)


class ReflChannel:
    """One measured curve: q, r, optional dr/dq, spin and Q window."""

    def __init__(self, spec: dict[str, Any], index: int) -> None:
        q = np.asarray(spec["q"], dtype=float).ravel()
        r = np.asarray(spec["r"], dtype=float).ravel()
        if q.size != r.size:
            raise ValueError(f"channel {index}: q and r must have the same length")
        dr, dq = spec.get("dr"), spec.get("dq")
        self.dr = None if dr is None else np.asarray(dr, dtype=float).ravel()
        self.dq = None if dq is None else np.asarray(dq, dtype=float).ravel()
        for arr, name in ((self.dr, "dr"), (self.dq, "dq")):
            if arr is not None and arr.size != q.size:
                raise ValueError(f"channel {index}: {name} must match q in length")
        if self.dq is not None and spec.get("dq_is_fwhm"):
            self.dq = self.dq * FWHM_TO_SIGMA
        self.resolution = spec.get("resolution")
        if self.dq is not None and self.resolution is not None:
            raise ValueError(f"channel {index}: give a dq column or a dQ/Q resolution, not both")
        spin_map: dict[str | None, int] = {None: 0, "": 0, "+": 1, "-": -1}
        spin = spec.get("spin")
        if spin not in spin_map:
            raise ValueError(f"channel {index}: spin must be null, '+' or '-'")
        self.spin: int = spin_map[spin]
        self.scale_name = str(spec.get("scale", "scale"))
        self.background_name = str(spec.get("background", "background"))
        self.label = str(spec.get("label") or f"channel {index}")
        q_min = spec.get("q_min")
        q_max = spec.get("q_max")
        mask = np.isfinite(q) & np.isfinite(r) & (q > 0)
        if q_min is not None:
            mask &= q >= float(q_min)
        if q_max is not None:
            mask &= q <= float(q_max)
        if self.dq is not None:
            mask &= np.isfinite(self.dq) & (self.dq >= 0)
        self.q_all, self.r_all, self.mask = q, r, mask

    @property
    def spin_label(self) -> str | None:
        return {0: None, 1: "+", -1: "-"}[self.spin]

    def points(self, weighting: str) -> NDArray[np.bool_]:
        m = self.mask.copy()
        if weighting == "dr":
            if self.dr is None:
                raise ValueError(f"{self.label}: weighting 'dr' needs a dR column")
            m &= np.isfinite(self.dr) & (self.dr > 0)
        else:
            m &= self.r_all > 0
        if not m.any():
            raise ValueError(f"{self.label}: no usable points in the Q window")
        return np.asarray(m, dtype=bool)
