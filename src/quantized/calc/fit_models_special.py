"""Helper-based fitting models (magnetic + heat-capacity). Extends fit_models.

Imported for its registration side effects (see the import at the bottom of
fit_models.py). Models: Langevin, Brillouin, Stoner-Wohlfarth, Debye, Einstein,
Debye+Einstein. Port of the local helpers in fitting/models.m.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray
from scipy.integrate import quad

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


def _debye_integrand(t: float) -> float:
    et = math.exp(t)
    return t**4 * et / max((et - 1) ** 2, _EPS)


def _debye_integral(u: float) -> float:
    if u > 30:
        return _DEBYE_LIMIT
    if u < 1e-4:
        return u**3 / 3
    val, _ = quad(_debye_integrand, 0.0, u, epsrel=1e-6, epsabs=1e-10)
    return float(val)


def _debye(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    gamma, theta, n = float(p[0]), max(float(p[1]), 1.0), max(float(p[2]), 0.0)
    t = np.asarray(x, dtype=float).ravel()
    out = np.empty(t.size)
    for k in range(t.size):
        tk = max(float(t[k]), 0.01)
        u = theta / tk
        c_lat = 9 * _R * (1 / u) ** 3 * _debye_integral(u)
        out[k] = gamma * tk + n * c_lat * 1000
    return out


def _einstein_lattice(theta: float, tk: float) -> float:
    u = theta / tk
    eu = math.exp(min(u, 500))
    return 3 * _R * u**2 * eu / max((eu - 1) ** 2, _EPS)


def _einstein(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    gamma, theta, n = float(p[0]), max(float(p[1]), 1.0), max(float(p[2]), 0.0)
    t = np.asarray(x, dtype=float).ravel()
    out = np.empty(t.size)
    for k in range(t.size):
        tk = max(float(t[k]), 0.01)
        out[k] = gamma * tk + n * _einstein_lattice(theta, tk) * 1000
    return out


def _debye_einstein(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    gamma = float(p[0])
    theta_d, n_d = max(float(p[1]), 1.0), max(float(p[2]), 0.0)
    theta_e, n_e = max(float(p[3]), 1.0), max(float(p[4]), 0.0)
    t = np.asarray(x, dtype=float).ravel()
    out = np.empty(t.size)
    for k in range(t.size):
        tk = max(float(t[k]), 0.01)
        c_d = 9 * _R * (1 / (theta_d / tk)) ** 3 * _debye_integral(theta_d / tk)
        c_e = _einstein_lattice(theta_e, tk)
        out[k] = gamma * tk + (n_d * c_d + n_e * c_e) * 1000
    return out


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
