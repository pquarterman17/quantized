r"""Fit a specular-reflectivity layer model to measured data (audit P2.2).

Pure calc layer. Builds on :func:`quantized.calc.reflectivity.parratt_refl`
(golden vs MATLAB ``parrattRefl``); MATLAB has no reflectivity *fitter*, so
this module is new capability and is verified by invariants and by recovering
the known truth of synthetic data, never by golden parity.

Model
-----
A stack of layers ``0..M-1`` (0 = incident medium, M-1 = substrate). Every
layer field is a named parameter ``L{i}.{field}`` with field one of
``thickness`` (Å), ``sld`` (Å⁻²), ``isld`` (Å⁻², absorption), ``roughness``
(Å, of the interface ABOVE layer i) and ``msld`` (Å⁻², magnetic SLD, PNR
only). Global ``scale`` and ``background`` are parameters too, and a channel
may name its own (e.g. ``background_mm``) to fit per-cross-section
backgrounds.

Every parameter carries ``value``, ``vary``, ``min``/``max`` and an optional
``tie``: the name of another parameter it always equals (a tied parameter is
never varied itself). Varying parameters need finite bounds; they are fitted in
bound-normalised space ``x = (p - min)/(max - min)`` because SLDs (~1e-6) and
thicknesses (~1e2) differ by eight decades, which would otherwise wreck the
Jacobian's conditioning.

Channels
--------
One channel per measured curve: ``q``, ``r``, optional ``dr`` and ``dq``, a
``spin`` of ``None`` (X-ray or unpolarised), ``"+"`` or ``"-"``, and an
optional Q window. A spin channel sees ``sld + s·msld`` with ``s = ±1``, so a
PNR ``++``/``--`` pair fitted together shares every nuclear parameter and
splits only by the magnetic one. ``dq`` is a per-point 1σ resolution (the
refl1d/reductus convention); ``dq_is_fwhm`` converts an FWHM column.

Objective and uncertainty
-------------------------
``weighting="dr"`` minimises Σ((R_model − R)/dR)² and needs finite positive
dR; ``"log"`` minimises Σ(log10 R_model − log10 R)², the usual choice for
XRR data with no error column. The optimiser is scipy's bounded
trust-region-reflective ``least_squares`` — a LOCAL method: a reflectivity
fit started far from the truth can settle in a neighbouring fringe minimum,
so starting values matter (a Kiessig FFT gives thickness starts). Standard
errors come from the Jacobian covariance scaled by the reduced χ² (so they
reflect the actual scatter even when dR is mis-scaled); a parameter that ends
on a bound is flagged and its error reported as ``None``.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares

from quantized.calc.reflectivity import parratt_refl
from quantized.calc.sld import sld_profile

__all__ = ["LAYER_FIELDS", "fit_reflectivity", "layer_param_name", "model_curves"]

LAYER_FIELDS = ("thickness", "sld", "isld", "roughness", "msld")
_FWHM_TO_SIGMA = 1.0 / (2.0 * math.sqrt(2.0 * math.log(2.0)))
_WEIGHTINGS = ("dr", "log")
_TINY = 1e-300


def layer_param_name(layer: int, field: str) -> str:
    """The canonical parameter name for a layer field, e.g. ``L1.thickness``."""
    return f"L{layer}.{field}"


# ── parameters ───────────────────────────────────────────────────────────────


class _Params:
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
        self.lo: list[float] = []
        self.hi: list[float] = []
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
            self.lo.append(lo)
            self.hi.append(hi)
        self.lo_a = np.array(self.lo, dtype=float)
        self.span = np.array(self.hi, dtype=float) - self.lo_a

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
        return np.asarray((self.values[self.free] - self.lo_a) / self.span, dtype=float)

    def full(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """All parameter values for normalised free vector ``x`` (ties applied)."""
        v = self.values.copy()
        if self.free:
            v[self.free] = self.lo_a + x * self.span
        return np.asarray(v[self.root], dtype=float)

    def get(self, v: NDArray[np.float64], name: str, default: float | None = None) -> float:
        if name not in self.index:
            if default is None:
                raise ValueError(f"model needs parameter {name}")
            return default
        return float(v[self.index[name]])


# ── model ────────────────────────────────────────────────────────────────────


def _stack(
    params: _Params, v: NDArray[np.float64], n_layers: int, spin: int
) -> NDArray[np.float64]:
    """(M, 4) Parratt layer array for one spin state (0 = none, ±1)."""
    rows = []
    for i in range(n_layers):
        sld = params.get(v, layer_param_name(i, "sld"))
        if spin:
            sld += spin * params.get(v, layer_param_name(i, "msld"), 0.0)
        rows.append([
            params.get(v, layer_param_name(i, "thickness"), 0.0),
            sld,
            params.get(v, layer_param_name(i, "isld"), 0.0),
            params.get(v, layer_param_name(i, "roughness"), 0.0),
        ])
    return np.asarray(rows, dtype=float)


class _Channel:
    def __init__(self, spec: dict[str, Any], index: int) -> None:
        q = np.asarray(spec["q"], dtype=float).ravel()
        r = np.asarray(spec["r"], dtype=float).ravel()
        if q.size != r.size:
            raise ValueError(f"channel {index}: q and r must have the same length")
        dr = spec.get("dr")
        dq = spec.get("dq")
        self.dr = None if dr is None else np.asarray(dr, dtype=float).ravel()
        self.dq = None if dq is None else np.asarray(dq, dtype=float).ravel()
        for arr, name in ((self.dr, "dr"), (self.dq, "dq")):
            if arr is not None and arr.size != q.size:
                raise ValueError(f"channel {index}: {name} must match q in length")
        if self.dq is not None and spec.get("dq_is_fwhm"):
            self.dq = self.dq * _FWHM_TO_SIGMA
        spin_map: dict[str | None, int] = {None: 0, "": 0, "+": 1, "-": -1}
        spin = spec.get("spin")
        if spin not in spin_map:
            raise ValueError(f"channel {index}: spin must be null, '+' or '-'")
        self.spin: int = spin_map[spin]
        self.resolution = spec.get("resolution")
        self.scale_name = str(spec.get("scale", "scale"))
        self.background_name = str(spec.get("background", "background"))
        self.label = str(spec.get("label") or f"channel {index}")
        q_min = float(spec.get("q_min", -math.inf))
        q_max = float(spec.get("q_max", math.inf))
        mask = np.isfinite(q) & np.isfinite(r) & (q > 0) & (q >= q_min) & (q <= q_max)
        if self.dq is not None:
            mask &= np.isfinite(self.dq) & (self.dq >= 0)
        self.q_all, self.r_all = q, r
        self.mask = mask

    def points(self, weighting: str) -> NDArray[np.bool_]:
        m = self.mask.copy()
        if weighting == "dr":
            if self.dr is None:
                raise ValueError(f"{self.label}: weighting 'dr' needs a dR column")
            m &= np.isfinite(self.dr) & (self.dr > 0)
        else:
            m &= self.r_all > 0
        return np.asarray(m, dtype=bool)

    def model(self, params: _Params, v: NDArray[np.float64], n_layers: int,
              q: NDArray[np.float64], dq: NDArray[np.float64] | None) -> NDArray[np.float64]:
        res: Any = dq if dq is not None else self.resolution
        return parratt_refl(
            q,
            _stack(params, v, n_layers, self.spin),
            scale=params.get(v, self.scale_name, 1.0),
            background=params.get(v, self.background_name, 0.0),
            resolution=res,
        )


def _n_layers(specs: list[dict[str, Any]]) -> int:
    idx = set()
    for s in specs:
        name = str(s["name"])
        if name.startswith("L") and "." in name:
            head, field = name[1:].split(".", 1)
            if head.isdigit() and field in LAYER_FIELDS:
                idx.add(int(head))
    if not idx:
        raise ValueError("the model has no layer parameters")
    n = max(idx) + 1
    if n < 2:
        raise ValueError("need at least 2 layers (incident medium + substrate)")
    return n


# ── fit ──────────────────────────────────────────────────────────────────────


def fit_reflectivity(
    parameters: list[dict[str, Any]],
    channels: list[dict[str, Any]],
    *,
    weighting: str = "dr",
    max_nfev: int = 2000,
    sld_points: int = 400,
) -> dict[str, Any]:
    """Fit a layer model to one or more reflectivity curves.

    Returns ``parameters`` (value, stderr or None, vary, tie, at_bound),
    ``chi2``/``reduced_chi2``/``n_points``/``n_free``, ``success``/``message``/
    ``nfev``, per-channel ``curves`` (q, r, dr, model, residual on the fitted
    points), ``sld_profiles`` (one per spin state present), ``correlation``
    among free parameters, and ``warnings``.
    """
    if weighting not in _WEIGHTINGS:
        raise ValueError(f"weighting must be one of {_WEIGHTINGS}")
    if not channels:
        raise ValueError("need at least one data channel")
    params = _Params(parameters)
    n_layers = _n_layers(parameters)
    chans = [_Channel(c, i) for i, c in enumerate(channels)]
    masks = [c.points(weighting) for c in chans]
    n_points = int(sum(int(m.sum()) for m in masks))
    n_free = len(params.free)
    if n_points <= n_free:
        raise ValueError(f"{n_points} usable points cannot constrain {n_free} free parameters")

    def residuals(x: NDArray[np.float64]) -> NDArray[np.float64]:
        v = params.full(x)
        parts = []
        for c, m in zip(chans, masks, strict=True):
            dq = None if c.dq is None else c.dq[m]
            model = c.model(params, v, n_layers, c.q_all[m], dq)
            if weighting == "dr":
                assert c.dr is not None
                parts.append((model - c.r_all[m]) / c.dr[m])
            else:
                parts.append(np.log10(np.maximum(model, _TINY)) - np.log10(c.r_all[m]))
        return np.concatenate(parts)

    warnings: list[str] = []
    x0 = params.x0()
    if n_free:
        sol = least_squares(residuals, x0, bounds=(0.0, 1.0), method="trf",
                            x_scale="jac", max_nfev=max_nfev)
        x, success, message, nfev = sol.x, bool(sol.success), str(sol.message), int(sol.nfev)
        jac = sol.jac
        if not success or sol.status == 0:
            warnings.append(f"the optimiser stopped without converging: {message}")
    else:
        x, success, message, nfev, jac = x0, True, "no free parameters", 0, None
    resid = residuals(x)
    chi2 = float(np.sum(resid**2))
    dof = n_points - n_free
    red = chi2 / dof

    v = params.full(x)
    errs = np.full(len(params.names), np.nan)
    corr: list[list[float | None]] = []
    at_bound = np.zeros(len(params.names), dtype=bool)
    if n_free and jac is not None:
        for k, i in enumerate(params.free):
            at_bound[i] = x[k] < 1e-6 or x[k] > 1 - 1e-6
        try:
            cov_x = np.linalg.pinv(jac.T @ jac) * red
            cov = cov_x * np.outer(params.span, params.span)
            sd = np.sqrt(np.clip(np.diag(cov), 0.0, None))
            for k, i in enumerate(params.free):
                errs[i] = sd[k]
            with np.errstate(invalid="ignore", divide="ignore"):
                c = cov / np.outer(sd, sd)
            corr = [[_finite(val) for val in row] for row in c]
        except np.linalg.LinAlgError:
            warnings.append("the covariance matrix could not be computed")
        if np.any(at_bound):
            names = [params.names[i] for i in params.free if at_bound[i]]
            warnings.append(
                "parameters ended on a bound (errors not reported): " + ", ".join(names)
            )

    out_params = []
    for i, n in enumerate(params.names):
        free = i in params.free
        out_params.append({
            "name": n,
            "value": float(v[i]),
            "stderr": _finite(errs[i]) if free and not at_bound[i] else None,
            "vary": free,
            "tie": params.tie[i],
            "at_bound": bool(at_bound[i]),
        })

    curves = []
    for c, m in zip(chans, masks, strict=True):
        q = c.q_all[m]
        model = c.model(params, v, n_layers, q, None if c.dq is None else c.dq[m])
        r = c.r_all[m]
        if weighting == "dr":
            assert c.dr is not None
            res_c = (model - r) / c.dr[m]
        else:
            res_c = np.log10(np.maximum(model, _TINY)) - np.log10(r)
        curves.append({
            "label": c.label,
            "spin": {0: None, 1: "+", -1: "-"}[c.spin],
            "q": q.tolist(),
            "r": r.tolist(),
            "dr": None if c.dr is None else c.dr[m].tolist(),
            "model": model.tolist(),
            "residual": res_c.tolist(),
        })

    profiles = []
    for spin in sorted({c.spin for c in chans}):
        z, sld = sld_profile(_stack(params, v, n_layers, spin), n_points=sld_points)
        profiles.append({"spin": {0: None, 1: "+", -1: "-"}[spin],
                         "z": np.asarray(z).tolist(), "sld": np.asarray(sld).tolist()})

    return {
        "parameters": out_params,
        "free": [params.names[i] for i in params.free],
        "correlation": corr,
        "chi2": chi2,
        "reduced_chi2": red,
        "n_points": n_points,
        "n_free": n_free,
        "success": success,
        "message": message,
        "nfev": nfev,
        "weighting": weighting,
        "curves": curves,
        "sld_profiles": profiles,
        "warnings": warnings,
    }


def model_curves(
    parameters: list[dict[str, Any]], q: list[float], spins: list[str | None],
    *, resolution: float | None = None,
) -> list[NDArray[np.float64]]:
    """Evaluate the model (no fitting) on a Q grid for each spin state."""
    params = _Params([{**p, "vary": False} for p in parameters])
    n_layers = _n_layers(parameters)
    v = params.full(np.zeros(0))
    qa = np.asarray(q, dtype=float)
    out = []
    for s in spins:
        ch = _Channel({"q": qa, "r": np.ones_like(qa), "spin": s, "resolution": resolution}, 0)
        out.append(ch.model(params, v, n_layers, qa, None))
    return out


def _finite(x: float) -> float | None:
    return float(x) if math.isfinite(float(x)) else None
