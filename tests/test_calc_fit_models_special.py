"""Parity + accuracy tests for the vectorized Debye integral in
``fit_models_special`` (PR: vectorize the per-x-point ``scipy.integrate.quad``
loop in ``_debye``/``_debye_einstein`` into a single Gauss-Legendre
quadrature over the whole array).

The old per-point implementation is reproduced HERE, scalar-and-quad exactly
as it used to live in ``fit_models_special.py``, so this test is a
self-contained oracle: it does not depend on the old code still existing in
the source tree.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from numpy.testing import assert_allclose
from scipy.integrate import quad

from quantized.calc.fit_models import evaluate
from quantized.calc.fit_models_special import _debye_d3

_EPS = float(np.finfo(float).eps)
_R = 8.314
_DEBYE_LIMIT = 4 * math.pi**4 / 15


def _old_debye_integrand(t: float) -> float:
    et = math.exp(t)
    return t**4 * et / max((et - 1) ** 2, _EPS)


def _old_debye_integral(u: float) -> float:
    """The original scalar-and-quad ``_debye_integral`` (pre-vectorization)."""
    if u > 30:
        return _DEBYE_LIMIT
    if u < 1e-4:
        return u**3 / 3
    val, _ = quad(_old_debye_integrand, 0.0, u, epsrel=1e-6, epsabs=1e-10)
    return float(val)


def _old_einstein_lattice(theta: float, tk: float) -> float:
    u = theta / tk
    eu = math.exp(min(u, 500))
    return 3 * _R * u**2 * eu / max((eu - 1) ** 2, _EPS)


def _old_debye(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    """The original per-x-point loop + quad ``_debye`` model."""
    gamma, theta, n = float(p[0]), max(float(p[1]), 1.0), max(float(p[2]), 0.0)
    t = np.asarray(x, dtype=float).ravel()
    out = np.empty(t.size)
    for k in range(t.size):
        tk = max(float(t[k]), 0.01)
        u = theta / tk
        c_lat = 9 * _R * (1 / u) ** 3 * _old_debye_integral(u)
        out[k] = gamma * tk + n * c_lat * 1000
    return out


def _old_debye_einstein(x: np.ndarray, p: np.ndarray) -> np.ndarray:
    """The original per-x-point loop + quad ``_debye_einstein`` model."""
    gamma = float(p[0])
    theta_d, n_d = max(float(p[1]), 1.0), max(float(p[2]), 0.0)
    theta_e, n_e = max(float(p[3]), 1.0), max(float(p[4]), 0.0)
    t = np.asarray(x, dtype=float).ravel()
    out = np.empty(t.size)
    for k in range(t.size):
        tk = max(float(t[k]), 0.01)
        c_d = 9 * _R * (1 / (theta_d / tk)) ** 3 * _old_debye_integral(theta_d / tk)
        c_e = _old_einstein_lattice(theta_e, tk)
        out[k] = gamma * tk + (n_d * c_d + n_e * c_e) * 1000
    return out


# 200 log-spaced temperatures spanning a very wide range so that, for the
# theta values used below, u = theta/T sweeps through all three branches of
# the Debye integral: the small-u series (u < 1e-4), the mid quadrature
# region, and the large-u closed-form saturation (u > 30).
_T = np.logspace(-6, 6, 200)


@pytest.mark.parametrize("theta", [1.0, 50.0, 200.0, 5000.0])
def test_debye_d3_matches_old_quad_integral(theta: float) -> None:
    u = theta / np.maximum(_T, 0.01)
    old = np.array([_old_debye_integral(float(uk)) for uk in u])
    new = _debye_d3(u)
    # Compare only where the old quad value is not vanishingly small —
    # near u -> 0 both branches agree on the u**3/3 series exactly, and
    # relative error on a ~1e-9-scale quantity is dominated by quad's own
    # noise floor rather than anything meaningful.
    mask = old > 1e-9
    assert_allclose(new[mask], old[mask], rtol=1e-9, atol=0.0)


@pytest.mark.parametrize("theta", [1.0, 50.0, 200.0, 5000.0])
@pytest.mark.parametrize("n", [0.1, 1.0, 20.0])
def test_debye_model_matches_old_per_point_quad_loop(theta: float, n: float) -> None:
    p = [5.0, theta, n]
    old = _old_debye(_T, np.asarray(p, dtype=float))
    new = evaluate("Debye", _T, p)
    assert_allclose(new, old, rtol=1e-9, atol=1e-12)


# A narrower, physically-realistic temperature range for the Debye+Einstein
# combination: unlike ``_debye`` (whose D_3 branch never calls exp above
# t=30, so it is safe over the full ``_T`` sweep above), the Einstein term's
# OLD scalar implementation (``_old_einstein_lattice``, reproduced verbatim
# above) genuinely overflows Python's float range whenever theta_E/T hits
# the pre-existing 500-cap on its exponent — a latent bug in the code being
# replaced, unrelated to this fix, so it is avoided here rather than
# "fixed" as a drive-by.
_T_DE = np.logspace(0, 5, 200)


@pytest.mark.parametrize("theta_d", [1.0, 50.0, 200.0, 5000.0])
def test_debye_einstein_model_matches_old_per_point_quad_loop(theta_d: float) -> None:
    p = [5.0, theta_d, 0.8, 150.0, 0.2]
    old = _old_debye_einstein(_T_DE, np.asarray(p, dtype=float))
    new = evaluate("Debye+Einstein", _T_DE, p)
    assert_allclose(new, old, rtol=1e-9, atol=1e-12)
