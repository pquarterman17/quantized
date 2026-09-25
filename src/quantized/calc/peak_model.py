r"""Mixed-shape peak model: named parameters, validation, evaluation (P2.4).

Pure calc layer, used by :mod:`quantized.calc.peak_model_fit`. New capability
beside the golden-parity global fit in :mod:`quantized.calc.peak_multifit`
(which stays the MATLAB ``buildLinkedPacker`` port, one shape for every peak).

Conventions (stated once, relied on everywhere):

* Peak ``i`` (0-based, in the order given) owns parameters named
  ``p{i}.{field}``. Every shape is parameterised by its PEAK HEIGHT above the
  background (``height``, the value at ``center``), the convention of
  :mod:`quantized.calc.peakshapes` and ``peak_multifit``; the integrated area
  is a derived quantity. Fields per shape (:data:`SHAPES`):

  ============  ==========================================
  gaussian      center, height, fwhm
  lorentzian    center, height, fwhm
  pseudo_voigt  center, height, fwhm, eta  (eta = Lorentzian fraction)
  voigt         center, height, fwhm_g, fwhm_l
  ============  ==========================================

* The background is a polynomial in ``(x - x_ref)``: ``bg.c0 + bg.c1*(x -
  x_ref) + bg.c2*(x - x_ref)**2`` for ``background`` ``"none"`` (no terms),
  ``"constant"``, ``"linear"`` or ``"quadratic"`` (``peak_multifit``'s
  ``bg_degree`` 0/1/2 plus "none"). ``x_ref`` defaults to the middle of the
  fitted x-range, which keeps the coefficients from being needlessly
  correlated when x sits far from 0 (a 2-theta window near 40 deg).
* Each parameter has ``value`` (the start), ``vary``, optional ``min``/``max``
  and an optional ``tie`` naming another parameter of the same kind whose
  value it copies (identity tie: shared FWHM is ``p1.fwhm`` tied to
  ``p0.fwhm``). A tie must resolve to a VARYING parameter (tying to a fixed
  one is just a fixed value - say so with ``vary=false``); a tied parameter's
  own value and bounds are ignored (and not validated).
* Physical bounds are always applied: widths are > 0 (default ``min`` is
  ``min(1e-6 * x-span, value/2)``), ``eta`` lies in [0, 1]. The one exception:
  a FIXED Voigt ``fwhm_g`` or ``fwhm_l`` may be exactly 0 (the pure
  Lorentzian / Gaussian limit), never both. Nothing else has a
  default bound, so an unconstrained height may go negative (the fitter warns).
"""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.peakshapes import (
    gaussian,
    lorentzian,
    pseudo_voigt,
    pseudo_voigt_area,
    voigt,
    voigt_area,
)

__all__ = [
    "BACKGROUNDS",
    "SHAPES",
    "PeakModel",
    "PeakParams",
    "model_parameter_names",
]

SHAPES: dict[str, tuple[str, ...]] = {
    "gaussian": ("center", "height", "fwhm"),
    "lorentzian": ("center", "height", "fwhm"),
    "pseudo_voigt": ("center", "height", "fwhm", "eta"),
    "voigt": ("center", "height", "fwhm_g", "fwhm_l"),
}
BACKGROUNDS: dict[str, int] = {"none": 0, "constant": 1, "linear": 2, "quadratic": 3}

_WIDTHS = ("fwhm", "fwhm_g", "fwhm_l")
_PEAK_NAME = re.compile(r"^p(0|[1-9][0-9]*)\.([a-z_]+)$", re.ASCII)
_BG_NAME = re.compile(r"^bg\.c([0-9])$", re.ASCII)


def _kind(name: str) -> str:
    """Parameter kind: center, height, width, eta or bg{k} (ties need equal kinds)."""
    m = _PEAK_NAME.match(name)
    if m:
        field = m.group(2)
        return "width" if field in _WIDTHS else field
    b = _BG_NAME.match(name)
    return f"bg{b.group(1)}" if b else "?"


def model_parameter_names(shapes: list[str], background: str) -> list[str]:
    """Every parameter name the model reads, in canonical order."""
    if background not in BACKGROUNDS:
        raise ValueError(f"background must be one of {tuple(BACKGROUNDS)}")
    if not shapes:
        raise ValueError("the model needs at least one peak")
    names: list[str] = []
    for i, shape in enumerate(shapes):
        if shape not in SHAPES:
            raise ValueError(f"peak {i}: unknown shape '{shape}' (one of {tuple(SHAPES)})")
        names += [f"p{i}.{f}" for f in SHAPES[shape]]
    names += [f"bg.c{k}" for k in range(BACKGROUNDS[background])]
    return names


def _bound(spec: dict[str, Any], key: str, name: str) -> float | None:
    raw = spec.get(key)
    if raw is None:
        return None
    val = float(raw)
    if not math.isfinite(val):
        raise ValueError(f"{name}: {key} must be finite")
    return val


class PeakParams:
    """Validated parameter set: values, free indices, bounds, scales and tie chains.

    Free parameters are optimised as ``x = p / scale`` with a per-kind scale
    (x-span for centres and widths, y-scale for heights, 1 for eta,
    y-scale/(x-span/2)^k for ``bg.c{k}``), so finite-difference steps are
    relative to the parameter's natural size; bounds (possibly infinite)
    transform the same way.
    """

    def __init__(self, specs: list[dict[str, Any]], expected: list[str],
                 xspan: float, yscale: float) -> None:
        names = [str(s.get("name", "")) for s in specs]
        if len(set(names)) != len(names):
            raise ValueError("parameter names must be unique")
        unknown = [n for n in names if n not in expected]
        if unknown:
            raise ValueError(
                f"unknown parameter {unknown[0]}: this model has only " + ", ".join(expected)
            )
        missing = [n for n in expected if n not in names]
        if missing:
            raise ValueError("missing parameters: " + ", ".join(missing))
        by_name = {str(s["name"]): s for s in specs}
        specs = [by_name[n] for n in expected]  # canonical order
        self.names = expected
        self.index = {n: i for i, n in enumerate(expected)}
        self.kinds = [_kind(n) for n in expected]
        self.values = np.array([float(s["value"]) for s in specs], dtype=float)
        for n, v in zip(self.names, self.values, strict=True):
            if not math.isfinite(float(v)):
                raise ValueError(f"{n}: value must be finite")
        self.tie: list[str | None] = [
            (str(s["tie"]) if s.get("tie") not in (None, "") else None) for s in specs
        ]
        self.vary = [bool(s.get("vary", False)) and t is None
                     for s, t in zip(specs, self.tie, strict=True)]
        # A tied parameter's own bounds (and value) are ignored, so not validated.
        user_lo = [None if t else _bound(s, "min", n)
                   for s, n, t in zip(specs, self.names, self.tie, strict=True)]
        user_hi = [None if t else _bound(s, "max", n)
                   for s, n, t in zip(specs, self.names, self.tie, strict=True)]
        for n, lo, hi in zip(self.names, user_lo, user_hi, strict=True):
            if lo is not None and hi is not None and lo > hi:
                raise ValueError(f"{n}: min ({lo:g}) is greater than max ({hi:g})")
        self._check_ties()
        self.root = [self._resolve(i) for i in range(len(expected))]
        for i in range(len(expected)):
            if self.tie[i] is not None and not self.vary[self.root[i]]:
                raise ValueError(
                    f"{self.names[i]} is tied to {self.tie[i]}, which is fixed (vary=false); "
                    "tie only to a varying parameter, or fix both"
                )
        self._check_physical(user_lo, user_hi)
        self.free = [i for i in range(len(expected)) if self.vary[i]]
        lo_l, hi_l, sc_l = [], [], []
        for i in self.free:
            lo, hi = self._effective_bounds(i, user_lo[i], user_hi[i], xspan)
            n, v = self.names[i], float(self.values[i])
            if not lo < hi:
                raise ValueError(f"{n}: min equals max; fix it with vary=false instead")
            if not lo <= v <= hi:
                raise ValueError(f"{n}: start value {v:g} is outside [{lo:g}, {hi:g}]")
            lo_l.append(lo)
            hi_l.append(hi)
            sc_l.append(self._scale(i, xspan, yscale))
        self.lo = np.array(lo_l, dtype=float)
        self.hi = np.array(hi_l, dtype=float)
        self.scale = np.array(sc_l, dtype=float)

    def _check_ties(self) -> None:
        for i, t in enumerate(self.tie):
            n = self.names[i]
            if t is None:
                continue
            if t not in self.index:
                raise ValueError(f"{n} is tied to unknown parameter {t}")
            if t == n:
                raise ValueError(f"{n} is tied to itself")
            if self.kinds[self.index[t]] != self.kinds[i]:
                raise ValueError(
                    f"{n} ({self.kinds[i]}) cannot be tied to {t} "
                    f"({self.kinds[self.index[t]]}); ties join parameters of one kind"
                )

    def _resolve(self, i: int) -> int:
        seen = {i}
        while self.tie[i] is not None:
            i = self.index[str(self.tie[i])]
            if i in seen:
                raise ValueError("parameter ties form a cycle: " + ", ".join(
                    self.names[j] for j in sorted(seen)))
            seen.add(i)
        return i

    def _check_physical(self, user_lo: list[float | None], user_hi: list[float | None]) -> None:
        for i, n in enumerate(self.names):
            v, kind, lo = float(self.values[i]), self.kinds[i], user_lo[i]
            if self.tie[i] is not None:
                continue  # its value is the target's, checked there
            if kind == "width":
                # A FIXED Voigt component width may be exactly 0 (the pure
                # Lorentzian / Gaussian limit); a varying width must stay > 0.
                zero_ok = n.endswith((".fwhm_g", ".fwhm_l")) and not self.vary[i]
                if v < 0 or (v == 0 and not zero_ok):
                    raise ValueError(f"{n}: a width must be positive (got {v:g})")
                if self.vary[i] and lo is not None and lo <= 0:
                    raise ValueError(f"{n}: min must be positive for a width")
            elif kind == "eta":
                if not 0.0 <= v <= 1.0:
                    raise ValueError(f"{n}: eta must lie in [0, 1] (got {v:g})")
                for b in (user_lo[i], user_hi[i]):
                    if self.vary[i] and b is not None and not 0.0 <= b <= 1.0:
                        raise ValueError(f"{n}: eta bounds must lie in [0, 1]")
        for n in self.names:
            if n.endswith(".fwhm_g"):
                g, lw = self.index[n], self.index[n[:-1] + "l"]
                if self.values[self.root[g]] == 0 and self.values[self.root[lw]] == 0:
                    raise ValueError(f"{n[:-7]}: a Voigt needs fwhm_g or fwhm_l above 0, "
                                     "not both 0")

    def _effective_bounds(self, i: int, lo: float | None, hi: float | None,
                          xspan: float) -> tuple[float, float]:
        kind, v = self.kinds[i], float(self.values[i])
        if kind == "width" and lo is None:
            lo = min(1e-6 * xspan, 0.5 * v)
        if kind == "eta":
            lo = 0.0 if lo is None else lo
            hi = 1.0 if hi is None else hi
        return (-math.inf if lo is None else lo, math.inf if hi is None else hi)

    def _scale(self, i: int, xspan: float, yscale: float) -> float:
        kind = self.kinds[i]
        if kind in ("center", "width"):
            return xspan
        if kind == "height":
            return yscale
        if kind == "eta":
            return 1.0
        return yscale / (0.5 * xspan) ** int(kind[2:])

    def x0(self) -> NDArray[np.float64]:
        return np.asarray(self.values[self.free] / self.scale, dtype=float)

    def x_bounds(self) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        return (np.asarray(self.lo / self.scale, dtype=float),
                np.asarray(self.hi / self.scale, dtype=float))

    def full(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """All parameter values for scaled free vector ``x`` (ties applied)."""
        v = self.values.copy()
        if self.free:
            v[self.free] = x * self.scale
        return np.asarray(v[self.root], dtype=float)

    def at_bound(self, v: NDArray[np.float64]) -> list[bool]:
        """Per free parameter: within 1e-6 (of its span, or scale) of a bound."""
        out = []
        for k, i in enumerate(self.free):
            lo, hi = float(self.lo[k]), float(self.hi[k])
            span = hi - lo
            tol = 1e-6 * (span if math.isfinite(span) else float(self.scale[k]))
            out.append(float(v[i]) - lo <= tol or hi - float(v[i]) <= tol)
        return out


class PeakModel:
    """Peak shapes + background over named parameters (see module header)."""

    def __init__(self, shapes: list[str], background: str, x_ref: float) -> None:
        self.names = model_parameter_names(shapes, background)
        self.shapes = list(shapes)
        self.x_ref = float(x_ref)
        idx = {n: i for i, n in enumerate(self.names)}
        self.fields = [[idx[f"p{i}.{f}"] for f in SHAPES[s]] for i, s in enumerate(shapes)]
        self.bg_idx = [idx[f"bg.c{k}"] for k in range(BACKGROUNDS[background])]

    def background(self, x: NDArray[np.float64], v: NDArray[np.float64]) -> NDArray[np.float64]:
        t = x - self.x_ref
        out = np.zeros_like(x)
        for k, i in enumerate(self.bg_idx):
            out = out + float(v[i]) * t**k
        return np.asarray(out, dtype=float)

    def component(self, k: int, x: NDArray[np.float64],
                  v: NDArray[np.float64]) -> NDArray[np.float64]:
        """Peak ``k`` alone (no background)."""
        return shape_curve(self.shapes[k], x, [float(v[i]) for i in self.fields[k]])

    def evaluate(self, x: NDArray[np.float64], v: NDArray[np.float64]) -> NDArray[np.float64]:
        y = self.background(x, v)
        for k in range(len(self.shapes)):
            y = y + self.component(k, x, v)
        return np.asarray(y, dtype=float)


def shape_curve(shape: str, x: NDArray[np.float64], p: list[float]) -> NDArray[np.float64]:
    """One peak from its field values in :data:`SHAPES` order."""
    if shape == "gaussian":
        return gaussian(x, p[0], p[2], p[1])
    if shape == "lorentzian":
        return lorentzian(x, p[0], p[2], p[1])
    if shape == "voigt":
        return voigt(x, p[0], p[2], p[3], p[1])
    return pseudo_voigt(x, p[0], p[2], p[1], p[3])


def peak_fwhm(shape: str, p: list[float]) -> float:
    """Full width at half maximum. Exact for G/L/pV (both pV parts share ``fwhm``);
    for Voigt, Olivero & Longbothum (1977): 0.5346 fL + sqrt(0.2166 fL^2 + fG^2),
    accurate to ~0.02 % (exact in the fL = 0 limit)."""
    if shape == "voigt":
        fg, fl = p[2], p[3]
        return 0.5346 * fl + math.sqrt(0.2166 * fl**2 + fg**2)
    return p[2]


def peak_area(shape: str, p: list[float]) -> float:
    """Integrated area; the closed forms live in :mod:`quantized.calc.peakshapes`
    (H = height, w = fwhm, AREA_G = sqrt(pi/ln 2)/2, AREA_L = pi/2):

    * gaussian      H*w*AREA_G
    * lorentzian    H*w*AREA_L
    * pseudo_voigt  H*w*(eta*AREA_L + (1-eta)*AREA_G)
    * voigt         H / V(0; sigma, gamma)  (V area-normalised, peak scaled to H)
    """
    if shape == "voigt":
        return voigt_area(p[1], p[2], p[3])
    eta = {"gaussian": 0.0, "lorentzian": 1.0}.get(shape, p[3] if len(p) > 3 else 0.0)
    return pseudo_voigt_area(p[1], p[2], eta)
