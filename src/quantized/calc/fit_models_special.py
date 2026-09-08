"""Helper-based fitting models (magnetic + heat-capacity). Extends fit_models.

Imported for its registration side effects (see the import at the bottom of
fit_models.py). Models: Langevin, Brillouin, Stoner-Wohlfarth, Debye, Einstein,
Debye+Einstein. Port of the local helpers in fitting/models.m.

The ``Hysteresis``-category models (tanh loop, two-component F+P, linear
background, approach-to-saturation, Langevin+background) are a port of
``+fitting/hysteresisModels.m`` — the catalogue the magnetometry hysteresis
workshop offers for M-H loop fitting. They are empirical loop descriptors, not
full Stoner-Wohlfarth astroid solutions (see Cullity & Graham, "Introduction to
Magnetic Materials", 2nd ed., Ch. 7/9/11; Akulov, Z. Phys. 67, 794 (1931)).
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from .fit_models import register_model

_INF = float("inf")
_EPS = float(np.finfo(float).eps)
_R = 8.314  # molar gas constant J/(mol·K)
_DEBYE_LIMIT = 4 * math.pi**4 / 15  # integral_0^inf x^4 e^x/(e^x-1)^2 dx


def _langevin(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    a, b = float(p[0]), float(p[1])
    u = x / max(b, _EPS)
    out = np.empty_like(u, dtype=float)
    small = np.abs(u) < 1e-4
    out[small] = a * (u[small] / 3 - u[small] ** 3 / 45)
    us = u[~small]
    out[~small] = a * (1.0 / np.tanh(us) - 1.0 / us)
    return np.asarray(out, dtype=float)


def _brillouin_bj(j: float, y: NDArray[np.float64]) -> NDArray[np.float64]:
    if j == 0:
        return np.zeros_like(y, dtype=float)
    a = (2 * j + 1) / (2 * j)
    b = 1 / (2 * j)
    out = np.empty_like(y, dtype=float)
    small = np.abs(y) < 1e-6
    out[small] = (j + 1) / (3 * j) * y[small]
    yl = y[~small]
    out[~small] = a / np.tanh(a * yl) - b / np.tanh(b * yl)
    return out


def _brillouin(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    ms, j, g, t = float(p[0]), float(p[1]), float(p[2]), float(p[3])
    y = g * 5.7884e-5 * j * x / (8.617e-5 * t)
    return np.asarray(ms * _brillouin_bj(j, y), dtype=float)


def _stoner_wohlfarth(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    ms, hc = float(p[0]), float(p[1])
    hk = max(float(p[2]), _EPS)
    heff = x - np.sign(x) * hc
    return np.asarray(ms * np.tanh(heff / hk), dtype=float)


# Fixed-order Gauss-Legendre quadrature, computed once, used to vectorize
# D_3(u) = integral_0^u t^4 e^t/(e^t-1)^2 dt across a whole array of u at
# once. Replaces a scalar `scipy.integrate.quad` call issued once PER
# x-point (the fit-time bottleneck: quad's pure-Python integrand callback
# dominates a 10k-point curve_fit). Measured max relative error vs the old
# per-point quad implementation across a dense log-spaced u grid spanning
# [1e-6, 1e4] (see the "vs old quad implementation" parity test): N=16 ->
# ~2.8e-7 (the u=30 quad/closed-form seam is under-resolved), N=32 ->
# ~1.5e-12, N=64 -> ~1.5e-12 (no further gain — quadrature error is
# already below float64 noise). N=32 is chosen: three orders of magnitude
# inside the 1e-9 golden tolerance, at half the node count of N=64.
_GL_N = 32
_GL_NODES, _GL_WEIGHTS = np.polynomial.legendre.leggauss(_GL_N)


def _debye_d3(u: NDArray[np.float64]) -> NDArray[np.float64]:
    """Vectorized D_3(u) = integral_0^u t^4 e^t/(e^t-1)^2 dt for an array of u.

    Same three-branch definition as the old per-point ``scipy.integrate.quad``
    implementation it replaces (small-u series, large-u closed-form
    saturation at the u->inf limit 4*pi**4/15, fixed Gauss-Legendre
    quadrature in between) so results match it to <1e-9 relative — see
    ``tests/test_calc_fit_models_special.py``, which keeps the old scalar
    quad-based implementation as a self-contained reference oracle.
    """
    u = np.asarray(u, dtype=float)
    out = np.empty_like(u)
    small = u < 1e-4
    big = u > 30.0
    mid = ~small & ~big
    out[small] = u[small] ** 3 / 3.0
    out[big] = _DEBYE_LIMIT
    um = u[mid]
    # Affine-map the fixed [-1, 1] Gauss-Legendre nodes to [0, u] per point
    # (broadcast over an (n_mid, _GL_N) grid) rather than re-deriving nodes
    # per point — this is what turns the per-point quad calls into one
    # vectorized numpy evaluation.
    t = (um[:, None] / 2.0) * (_GL_NODES[None, :] + 1.0)
    w = (um[:, None] / 2.0) * _GL_WEIGHTS[None, :]
    et = np.exp(t)
    integrand = t**4 * et / np.maximum((et - 1.0) ** 2, _EPS)
    out[mid] = np.sum(integrand * w, axis=1)
    return out


def _debye_lattice(theta: float, tk: NDArray[np.float64]) -> NDArray[np.float64]:
    u = theta / tk
    c_lat = 9 * _R * (1 / u) ** 3 * _debye_d3(u)
    return np.asarray(c_lat, dtype=float)


def _debye(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    gamma, theta, n = float(p[0]), max(float(p[1]), 1.0), max(float(p[2]), 0.0)
    t = np.asarray(x, dtype=float).ravel()
    tk = np.maximum(t, 0.01)
    c_lat = _debye_lattice(theta, tk)
    return np.asarray(gamma * tk + n * c_lat * 1000, dtype=float)


def _einstein_lattice(theta: float, tk: NDArray[np.float64]) -> NDArray[np.float64]:
    # exp(-u) form: mathematically u**2 * eu / (eu - 1)**2 with eu = exp(u),
    # rewritten as u**2 * e^-u / (1 - e^-u)**2 so the exponential itself never
    # overflows (e^-u -> 0 as u -> inf, the correct u**2 e^-u -> 0 limit)
    # instead of relying on a `min(u, 500)` cap that still overflows on
    # squaring a ~1e217 `eu` in plain Python (see the old scalar
    # implementation kept as an oracle in the test file) and, in the
    # vectorized numpy form, raises `RuntimeWarning: overflow encountered in
    # square` on the fit hot path (`routes/fitting.py` calls `curve_fit`
    # with no `np.errstate` guard).
    u = theta / tk
    eu = np.exp(-u)
    return np.asarray(3 * _R * u**2 * eu / np.maximum((1 - eu) ** 2, _EPS), dtype=float)


def _einstein(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    gamma, theta, n = float(p[0]), max(float(p[1]), 1.0), max(float(p[2]), 0.0)
    t = np.asarray(x, dtype=float).ravel()
    tk = np.maximum(t, 0.01)
    return np.asarray(gamma * tk + n * _einstein_lattice(theta, tk) * 1000, dtype=float)


def _debye_einstein(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    gamma = float(p[0])
    theta_d, n_d = max(float(p[1]), 1.0), max(float(p[2]), 0.0)
    theta_e, n_e = max(float(p[3]), 1.0), max(float(p[4]), 0.0)
    t = np.asarray(x, dtype=float).ravel()
    tk = np.maximum(t, 0.01)
    c_d = _debye_lattice(theta_d, tk)
    c_e = _einstein_lattice(theta_e, tk)
    return np.asarray(gamma * tk + (n_d * c_d + n_e * c_e) * 1000, dtype=float)


# ── Hysteresis (magnetic M-H loop descriptors) ──────────────────────────
def _tanh_hysteresis(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    """M = Ms·tanh((H - Hc)/Hw). Soft-ferromagnet loop. p = [Ms, Hc, Hw]."""
    ms, hc, hw = float(p[0]), float(p[1]), max(abs(float(p[2])), _EPS)
    return np.asarray(ms * np.tanh((x - hc) / hw), dtype=float)


def _two_component(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    """M = Ms·tanh((H - Hc)/Hw) + χ·H. Ferromagnetic loop + linear (para) BG.

    p = [Ms, Hc, Hw, χ].
    """
    ms, hc, hw, chi = float(p[0]), float(p[1]), max(abs(float(p[2])), _EPS), float(p[3])
    return np.asarray(ms * np.tanh((x - hc) / hw) + chi * x, dtype=float)


def _linear_background(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    """M = χ·H + offset. Pure linear (dia/paramagnetic) background. p = [χ, offset]."""
    return np.asarray(float(p[0]) * x + float(p[1]), dtype=float)


def _approach_saturation(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    """M = Ms(1 - a/|H| - b/H²) + χ·H. High-field Akulov expansion. p = [Ms, a, b, χ]."""
    ms, a, b, chi = float(p[0]), float(p[1]), float(p[2]), float(p[3])
    xv = np.asarray(x, dtype=float)
    return np.asarray(
        ms * (1.0 - a / (np.abs(xv) + _EPS) - b / (xv**2 + _EPS)) + chi * xv, dtype=float
    )


def _langevin_bg(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    """M = Ms·L(αH) + χ·H, L(u) = coth(u) - 1/u. Superparamagnet + BG. p = [Ms, α, χ]."""
    ms, alpha, chi = float(p[0]), float(p[1]), float(p[2])
    u = alpha * np.asarray(x, dtype=float)
    out = np.empty_like(u, dtype=float)
    small = np.abs(u) < 1e-4
    out[small] = ms * (u[small] / 3.0 - u[small] ** 3 / 45.0)
    us = u[~small]
    out[~small] = ms * (1.0 / np.tanh(us) - 1.0 / us)
    return np.asarray(out + chi * np.asarray(x, dtype=float), dtype=float)


register_model("Tanh Hysteresis", "Hysteresis", _tanh_hysteresis, ["Ms", "Hc", "Hw"],
               [1e-3, 100, 200], [0, -_INF, 0], [_INF, _INF, _INF])
register_model("Two-Component (F+P)", "Hysteresis", _two_component, ["Ms", "Hc", "Hw", "χ"],
               [1e-3, 100, 200, 0], [0, -_INF, 0, -_INF], [_INF, _INF, _INF, _INF])
register_model("Linear Background", "Hysteresis", _linear_background, ["χ", "offset"],
               [1e-7, 0], [-_INF, -_INF], [_INF, _INF])
register_model("Approach to Saturation", "Hysteresis", _approach_saturation,
               ["Ms", "a", "b", "χ"], [1e-3, 1, 1, 0], [0, 0, 0, -_INF],
               [_INF, _INF, _INF, _INF])
register_model("Langevin + Background", "Hysteresis", _langevin_bg, ["Ms", "μ/kT", "χ"],
               [1e-3, 1e-3, 0], [0, 0, -_INF], [_INF, _INF, _INF])

register_model("Langevin", "Magnetic", _langevin, ["A", "B"], [1, 1], [0, 0], [_INF, _INF])
register_model("Brillouin", "Magnetic", _brillouin, ["Ms", "J", "g", "T"], [1, 0.5, 2, 300],
               [0, 0.5, 0, 0], [_INF, 7, 10, 1000])
register_model("Stoner-Wohlfarth", "Magnetic", _stoner_wohlfarth, ["Ms", "Hc", "Hk"],
               [1, 100, 500], [0, 0, 0], [_INF, _INF, _INF])
register_model("Debye", "Thermal", _debye, ["gamma", "thetaD", "n"], [5, 200, 1],
               [0, 1, 0.1], [_INF, _INF, 20])
register_model("Einstein", "Thermal", _einstein, ["gamma", "thetaE", "n"], [5, 150, 1],
               [0, 1, 0.1], [_INF, _INF, 20])
register_model("Debye+Einstein", "Thermal", _debye_einstein,
               ["gamma", "thetaD", "n_D", "thetaE", "n_E"], [5, 200, 0.8, 150, 0.2],
               [0, 1, 0, 1, 0], [_INF, _INF, 20, _INF, 20])
