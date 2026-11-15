r"""Mixed-shape peak model: named parameters, ties, validation, evaluation (P2.4).

Pure calc layer, used by :mod:`quantized.calc.peak_model_fit`. New capability
beside the golden-parity global fit in :mod:`quantized.calc.peak_multifit`
(which stays the MATLAB ``buildLinkedPacker`` port, one shape for every peak).

Conventions (stated once, relied on everywhere):

* Peak ``i`` (0-based, in the order given) owns parameters named
  ``p{i}.{field}``. Every shape is parameterised by its PEAK HEIGHT above the
  background (``height``, the value at ``center``); the integrated area is a
  derived quantity. The fields, FWHM and area of every shape are tabled in
  :mod:`quantized.calc.peak_model_shapes` (:data:`SHAPES`): gaussian,
  lorentzian, pseudo_voigt, voigt, split_gaussian, split_lorentzian,
  split_pseudo_voigt, pearson_vii, fano, doniach_sunjic.
* The background is a polynomial in ``(x - x_ref)``: ``bg.c0 + bg.c1*(x -
  x_ref) + bg.c2*(x - x_ref)**2`` for ``background`` ``"none"`` (no terms),
  ``"constant"``, ``"linear"`` or ``"quadratic"`` (``peak_multifit``'s
  ``bg_degree`` 0/1/2 plus "none"). ``x_ref`` defaults to the middle of the
  fitted x-range, which keeps the coefficients from being needlessly
  correlated when x sits far from 0 (a 2-theta window near 40 deg).
* Each parameter has ``value`` (the start), ``vary``, optional ``min``/``max``
  and an optional ``tie`` naming another parameter. ``tie_op`` says how the
  tied parameter follows its target ``t``; ``c`` is ``tie_coef``, fixed, or
  fitted as one extra free parameter named ``"<name>:coef"`` when
  ``tie_coef_vary`` is true:

  ============  ==============================  ================================
  tie_op        tied value                      applies to
  ============  ==============================  ================================
  equal         t                (the default)  any kind; tied and target alike
  offset        t + c            (c default 0)  centres (a doublet's splitting)
  ratio         c * t     (c > 0, default 1)    heights or widths, same kind
  area_ratio    the height whose area is c      a height tied to ANOTHER peak's
                times the target peak's area    height; both shapes need an area
  ============  ==============================  ================================

  An ``equal`` tie (shared FWHM is ``p1.fwhm`` tied to ``p0.fwhm``) must end
  on a VARYING parameter (tying to a fixed one is just a fixed value - say so
  with ``vary=false``); the other operations may follow a fixed target, as
  their coefficient may be fitted. A tied parameter's own value and bounds are
  ignored (and not validated). Ties resolve in dependency order (an
  ``area_ratio`` height reads every field of the target peak and its own
  peak's other fields). A cycle, an unknown target, a kind mismatch, an
  unknown ``tie_op`` and a coefficient without a tie are all refused.
* Physical bounds are always applied: widths are > 0 (default ``min`` is
  ``min(1e-6 * x-span, value/2)``; a width a tie resolves to must be > 0 as
  well), ``eta`` lies in [0, 1], Pearson VII ``m`` > 0.5 (default min 0.51),
  Doniach-Sunjic ``alpha`` in [0, 1) (default max 0.99), a ratio
  coefficient > 0, and an area-ratio height must be finite at the start.
  The one exception: a FIXED Voigt ``fwhm_g`` or ``fwhm_l`` may be exactly 0
  (the pure Lorentzian / Gaussian limit), never both.
  Nothing else has a default bound, so an unconstrained height may go
  negative (the fitter warns).
"""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.peak_model_shapes import (
    BACKGROUNDS,
    KIND_RULES,
    NO_AREA_SHAPES,
    SHAPES,
    WIDTHS,
    PeakModel,
    model_parameter_names,
    peak_area,
    peak_fwhm,
    shape_curve,
)

__all__ = [
    "BACKGROUNDS",
    "SHAPES",
    "TIE_OPS",
    "PeakModel",
    "PeakParams",
    "model_parameter_names",
    "peak_area",
    "peak_fwhm",
    "shape_curve",
]

TIE_OPS = ("equal", "offset", "ratio", "area_ratio")
_OP_KINDS: dict[str, tuple[str, ...]] = {
    "offset": ("center",), "ratio": ("height", "width"), "area_ratio": ("height",),
}
_OP_COEF_DEFAULT = {"offset": 0.0, "ratio": 1.0, "area_ratio": 1.0}

_PEAK_NAME = re.compile(r"^p(0|[1-9][0-9]*)\.([a-z_]+)$", re.ASCII)
_BG_NAME = re.compile(r"^bg\.c([0-9])$", re.ASCII)
_REL_STEP = 1e-6


def _kind(name: str) -> str:
    """Parameter kind: center, height, width, eta, m, alpha, inv_q or bg{k}."""
    m = _PEAK_NAME.match(name)
    if m:
        field = m.group(2)
        return "width" if field in WIDTHS else field
    b = _BG_NAME.match(name)
    return f"bg{b.group(1)}" if b else "?"


def _bound(spec: dict[str, Any], key: str, name: str) -> float | None:
    raw = spec.get(key)
    if raw is None:
        return None
    val = float(raw)
    if not math.isfinite(val):
        raise ValueError(f"{name}: {key} must be finite")
    return val


def _range_text(kind: str) -> str:
    lo, lo_in, hi, hi_in, _ = KIND_RULES[kind]
    hi_s = "inf" if math.isinf(hi) else f"{hi:g}"
    return f"{'[' if lo_in else '('}{lo:g}, {hi_s}{']' if hi_in else ')'}"


def _in_range(kind: str, v: float) -> bool:
    lo, lo_in, hi, hi_in, _ = KIND_RULES[kind]
    return (v >= lo if lo_in else v > lo) and (v <= hi if hi_in else v < hi)


def _parse_op(spec: dict[str, Any], n: str, tie: str | None) -> str | None:
    raw = spec.get("tie_op")
    coef_given = spec.get("tie_coef") is not None or bool(spec.get("tie_coef_vary"))
    if tie is None:
        if raw not in (None, "", "equal") or coef_given:
            raise ValueError(f"{n}: tie_op / tie_coef need a tie target")
        return None
    op = "equal" if raw in (None, "") else str(raw)
    if op not in TIE_OPS:
        raise ValueError(f"{n}: unknown tie_op '{op}' (one of {', '.join(TIE_OPS)})")
    if op == "equal" and coef_given:
        raise ValueError(f"{n}: an equal tie takes no tie_coef")
    return op


class PeakParams:
    """Validated parameter set: values, free indices, bounds, scales and ties.

    Free parameters are optimised as ``x = p / scale`` with a per-kind scale
    (x-span for centres, widths and offset coefficients, y-scale for heights,
    1 for eta / m / alpha / inv_q / ratio coefficients, y-scale/(x-span/2)^k
    for ``bg.c{k}``), so finite-difference steps are relative to the
    parameter's natural size; bounds (possibly infinite) transform the same
    way. The free indices point into the EXTENDED list ``ext_names``: the
    model's parameters, then one ``"<name>:coef"`` per non-equal tie.
    """

    def __init__(self, specs: list[dict[str, Any]], expected: list[str],
                 xspan: float, yscale: float, shapes: list[str] | None = None) -> None:
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
        self.n = len(expected)
        self.shapes = shapes
        self.index = {n: i for i, n in enumerate(expected)}
        self.kinds = [_kind(n) for n in expected]
        self.values = np.array([float(s["value"]) for s in specs], dtype=float)
        for n, v in zip(self.names, self.values, strict=True):
            if not math.isfinite(float(v)):
                raise ValueError(f"{n}: value must be finite")
        self.tie: list[str | None] = [
            (str(s["tie"]) if s.get("tie") not in (None, "") else None) for s in specs
        ]
        self.op = [_parse_op(s, n, t) for s, n, t in zip(specs, self.names, self.tie,
                                                         strict=True)]
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
        self.fields = ([] if shapes is None else
                       [[self.index[f"p{k}.{f}"] for f in SHAPES[s]] for k, s in enumerate(shapes)])
        self._check_ties()
        self.deps = [self._deps(i) for i in range(self.n)]
        self.order = self._topo_order()
        self.root = [self._equal_root(i) for i in range(self.n)]
        for i in range(self.n):
            r = self.root[i]
            if self.op[i] == "equal" and self.tie[r] is None and not self.vary[r]:
                raise ValueError(
                    f"{self.names[i]} is tied to {self.tie[i]}, which is fixed (vary=false); "
                    "tie only to a varying parameter, or fix both"
                )
        self._coefs(specs)
        self._check_physical(user_lo, user_hi)
        self.free = [k for k in range(len(self.ext_names)) if self.ext_vary[k]]
        lo_l, hi_l, sc_l = [], [], []
        for k in self.free:
            if k < self.n:
                lo, hi = self._effective_bounds(k, user_lo[k], user_hi[k], xspan)
            else:
                lo = 0.0 if self.ext_kinds[k] == "coef_ratio" else -math.inf
                hi = math.inf
            n, v = self.ext_names[k], float(self.ext_values[k])
            if not lo < hi:
                raise ValueError(f"{n}: min equals max; fix it with vary=false instead")
            if not lo <= v <= hi:
                raise ValueError(f"{n}: start value {v:g} is outside [{lo:g}, {hi:g}]")
            lo_l.append(lo)
            hi_l.append(hi)
            sc_l.append(self._scale(self.ext_kinds[k], xspan, yscale))
        self.lo = np.array(lo_l, dtype=float)
        self.hi = np.array(hi_l, dtype=float)
        self.scale = np.array(sc_l, dtype=float)

    # ── ties ────────────────────────────────────────────────────────────────

    def _peak(self, i: int) -> int:
        m = _PEAK_NAME.match(self.names[i])
        return int(m.group(1)) if m else -1

    def _check_ties(self) -> None:
        for i, t in enumerate(self.tie):
            n = self.names[i]
            if t is None:
                continue
            if t not in self.index:
                raise ValueError(f"{n} is tied to unknown parameter {t}")
            if t == n:
                raise ValueError(f"{n} is tied to itself")
            op, tk = str(self.op[i]), self.kinds[self.index[t]]
            if op != "equal" and self.kinds[i] not in _OP_KINDS[op]:
                raise ValueError(f"{n}: an {op} tie applies only to "
                                 + " / ".join(_OP_KINDS[op]) + " parameters")
            if tk != self.kinds[i]:
                raise ValueError(
                    f"{n} ({self.kinds[i]}) cannot be tied to {t} "
                    f"({tk}); ties join parameters of one kind"
                )
            if op == "area_ratio":
                if self.shapes is None:
                    raise ValueError(f"{n}: an area_ratio tie needs the peak shapes")
                for k in (self._peak(i), self._peak(self.index[t])):
                    if self.shapes[k] in NO_AREA_SHAPES:
                        raise ValueError(f"{n}: an area_ratio tie needs both peaks to have "
                                         f"an area; a {self.shapes[k]} peak (p{k}) has none")

    def _deps(self, i: int) -> list[int]:
        t = self.tie[i]
        if t is None:
            return []
        j = self.index[t]
        if self.op[i] != "area_ratio":
            return [j]
        return self.fields[self._peak(j)] + [q for q in self.fields[self._peak(i)] if q != i]

    def _topo_order(self) -> list[int]:
        """Tied parameters in evaluation order (each after everything it reads)."""
        state = [0] * self.n  # 0 new, 1 on the current path, 2 done
        order: list[int] = []

        def visit(i: int, path: list[int]) -> None:
            if state[i] == 2:
                return
            if state[i] == 1:
                raise ValueError("parameter ties form a cycle: " + ", ".join(
                    self.names[j] for j in sorted(path[path.index(i):])))
            state[i] = 1
            for d in self.deps[i]:
                visit(d, [*path, i])
            state[i] = 2
            if self.tie[i] is not None:
                order.append(i)

        for i in range(self.n):
            visit(i, [])
        return order

    def _equal_root(self, i: int) -> int:
        while self.tie[i] is not None and self.op[i] == "equal":
            i = self.index[str(self.tie[i])]
        return i

    def _coefs(self, specs: list[dict[str, Any]]) -> None:
        self.ext_names = list(self.names)
        self.ext_kinds = list(self.kinds)
        ext_v = [float(v) for v in self.values]
        self.ext_vary = list(self.vary)
        self.coef_pos: dict[int, int] = {}
        for i, (s, op) in enumerate(zip(specs, self.op, strict=True)):
            if op is None or op == "equal":
                continue
            n, raw = self.names[i], s.get("tie_coef")
            c = _OP_COEF_DEFAULT[op] if raw is None else float(raw)
            if not math.isfinite(c):
                raise ValueError(f"{n}: tie_coef must be finite")
            if op != "offset" and c <= 0:
                raise ValueError(f"{n}: a {op} tie's tie_coef must be positive (got {c:g})")
            self.coef_pos[i] = len(self.ext_names)
            self.ext_names.append(f"{n}:coef")
            self.ext_kinds.append("coef_offset" if op == "offset" else "coef_ratio")
            ext_v.append(c)
            self.ext_vary.append(bool(s.get("tie_coef_vary", False)))
        self.ext_values = np.array(ext_v, dtype=float)

    def _area_tie(self, i: int, out: NDArray[np.float64], c: float) -> float:
        """The height of peak(i) whose area is ``c`` times the target peak's."""
        assert self.shapes is not None  # _check_ties refuses area_ratio without
        j = self.index[str(self.tie[i])]
        kj, ki = self._peak(j), self._peak(i)
        aj = peak_area(self.shapes[kj], [float(out[q]) for q in self.fields[kj]])
        ai = peak_area(self.shapes[ki], [1.0 if q == i else float(out[q])
                                         for q in self.fields[ki]])
        return c * aj / ai if aj is not None and ai else math.nan

    def _evaluate(self, ext: NDArray[np.float64], areas: bool = True) -> NDArray[np.float64]:
        out = ext[: self.n].copy()
        for i in self.order:
            t, op = self.index[str(self.tie[i])], self.op[i]
            if op == "area_ratio" and not areas:
                continue
            if op == "equal":
                out[i] = out[t]
                continue
            c = float(ext[self.coef_pos[i]])
            if op == "offset":
                out[i] = out[t] + c
            elif op == "ratio":
                out[i] = c * out[t]
            else:
                out[i] = self._area_tie(i, out, c)
        return np.asarray(out, dtype=float)

    # ── physical rules, bounds, scales ──────────────────────────────────────

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
            elif kind in KIND_RULES:
                rng = _range_text(kind)
                if not _in_range(kind, v):
                    raise ValueError(f"{n}: {kind} must lie in {rng} (got {v:g})")
                for b in (user_lo[i], user_hi[i]):
                    if self.vary[i] and b is not None and not _in_range(kind, b):
                        raise ValueError(f"{n}: {kind} bounds must lie in {rng}")
        # Widths never depend on an area-ratio height, so resolving the other
        # ties is enough to see each Voigt's starting widths.
        init = self._evaluate(self.ext_values, areas=False)
        for i in self.order:
            n = self.names[i]
            if self.kinds[i] == "width" and not n.endswith((".fwhm_g", ".fwhm_l")) \
                    and not init[i] > 0:
                raise ValueError(f"{n}: its tie to {self.tie[i]} gives a width of "
                                 f"{float(init[i]):g}; a width must be positive")
        if "area_ratio" in self.op:
            full = self._evaluate(self.ext_values)
            for i in self.order:
                if self.op[i] == "area_ratio" and not math.isfinite(float(full[i])):
                    raise ValueError(
                        f"{self.names[i]}: the area ratio to {self.tie[i]} is not finite at "
                        "the start values (a peak whose area is infinite or zero there)")
        for n in self.names:
            if n.endswith(".fwhm_g"):
                g, lw = self.index[n], self.index[n[:-1] + "l"]
                if init[g] == 0 and init[lw] == 0:
                    raise ValueError(f"{n[:-7]}: a Voigt needs fwhm_g or fwhm_l above 0, "
                                     "not both 0")

    def _effective_bounds(self, i: int, lo: float | None, hi: float | None,
                          xspan: float) -> tuple[float, float]:
        kind, v = self.kinds[i], float(self.values[i])
        if kind == "width" and lo is None:
            lo = min(1e-6 * xspan, 0.5 * v)
        if kind in KIND_RULES:
            d_lo, d_hi = KIND_RULES[kind][4]
            lo = d_lo if lo is None else lo
            hi = d_hi if hi is None else hi
        return (-math.inf if lo is None else lo, math.inf if hi is None else hi)

    @staticmethod
    def _scale(kind: str, xspan: float, yscale: float) -> float:
        if kind in ("center", "width", "coef_offset"):
            return xspan
        if kind == "height":
            return yscale
        if not kind.startswith("bg"):
            return 1.0
        return yscale / (0.5 * xspan) ** int(kind[2:])

    # ── the optimiser's view ────────────────────────────────────────────────

    def x0(self) -> NDArray[np.float64]:
        return np.asarray(self.ext_values[self.free] / self.scale, dtype=float)

    def x_bounds(self) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        return (np.asarray(self.lo / self.scale, dtype=float),
                np.asarray(self.hi / self.scale, dtype=float))

    def ext(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """The extended vector (model parameters, then tie coefficients) for
        scaled free vector ``x``; its model entries are NOT tie-resolved."""
        e = self.ext_values.copy()
        if self.free:
            e[self.free] = x * self.scale
        return np.asarray(e, dtype=float)

    def full(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """All model parameter values for scaled free vector ``x`` (ties applied)."""
        return self._evaluate(self.ext(x))

    def at_bound(self, e: NDArray[np.float64]) -> list[bool]:
        """Per free parameter of extended vector ``e``: within 1e-6 (of its
        span, or scale) of a bound."""
        out = []
        for k, i in enumerate(self.free):
            lo, hi = float(self.lo[k]), float(self.hi[k])
            span = hi - lo
            tol = 1e-6 * (span if math.isfinite(span) else float(self.scale[k]))
            out.append(float(e[i]) - lo <= tol or hi - float(e[i]) <= tol)
        return out

    def jacobian(self, e: NDArray[np.float64]) -> NDArray[np.float64]:
        """d(model parameter)/d(free parameter, in its own units) at ``e``: a
        unit row for a free parameter and anything equal-tied to it, zeros for
        a fixed one, the chain rule through offset / ratio / area-ratio ties
        (the area ratio's partials by central differences, step 1e-6 relative)."""
        col = {i: k for k, i in enumerate(self.free)}
        d = np.zeros((self.n, len(self.free)))
        for i, k in col.items():
            if i < self.n:
                d[i, k] = 1.0
        out = self._evaluate(e)
        for i in self.order:
            t, op = self.index[str(self.tie[i])], self.op[i]
            if op == "equal":
                d[i] = d[t]
                continue
            c = float(e[self.coef_pos[i]])
            if op == "offset":
                d[i], dc = d[t], 1.0
            elif op == "ratio":
                d[i], dc = c * d[t], float(out[t])
            else:
                row = np.zeros(len(self.free))
                for q in self.deps[i]:
                    h = _REL_STEP * (abs(float(out[q])) or 1.0)
                    up, dn = out.copy(), out.copy()
                    up[q] += h
                    dn[q] -= h
                    g = (self._area_tie(i, up, c) - self._area_tie(i, dn, c)) / (2.0 * h)
                    row = row + g * d[q]
                d[i], dc = row, self._area_tie(i, out, 1.0)
            kc = col.get(self.coef_pos[i])
            if kc is not None:
                d[i, kc] += dc
        return d
