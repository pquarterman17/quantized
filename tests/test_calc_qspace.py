"""compute_qspace: coplanar RSM reciprocal-space coordinates (calc/qspace.py)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.qspace import compute_qspace

LAMBDA = 1.5405980  # Cu K-alpha1, Angstrom


@pytest.mark.golden
def test_qspace_grid_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """Qx/Qz over an omega×2theta grid match parser.computeQSpace.

    The frozen Qx/Qz are N×M = [omega][2theta]; the RSM-mesh call passes
    2theta as a row (1, M) and omega as a column (N, 1) to broadcast to the
    same shape, so a silent axis swap (N != M here) would fail loudly.
    """
    g = load_golden("calc_qspace.json")
    omega = np.asarray(g["axis1"], dtype=float)  # (N,)
    two_theta = np.asarray(g["axis2"], dtype=float)  # (M,)
    lam = float(g["wavelength_A"])
    qx, qz = compute_qspace(two_theta[None, :], omega[:, None], lam)
    assert qx.shape == (omega.size, two_theta.size)
    assert_allclose(qx, np.asarray(g["Qx"], dtype=float), rtol=1e-12, atol=1e-12)
    assert_allclose(qz, np.asarray(g["Qz"], dtype=float), rtol=1e-12, atol=1e-12)


def test_symmetric_condition_has_zero_qx() -> None:
    # omega == theta == 2theta/2 -> sin(omega - theta) = 0 -> Qx = 0, Qz = specular.
    two_theta = np.array([40.0, 60.0, 80.0])
    omega = two_theta / 2.0
    qx, qz = compute_qspace(two_theta, omega, LAMBDA)
    np.testing.assert_allclose(qx, 0.0, atol=1e-12)
    # specular Qz = (4pi/lambda) sin(theta)
    expected_qz = (4 * np.pi / LAMBDA) * np.sin(np.deg2rad(two_theta) / 2.0)
    np.testing.assert_allclose(qz, expected_qz, rtol=1e-12)


def test_known_numeric_value() -> None:
    # Direct evaluation of the documented formula at one point.
    tt, om = 61.0, 30.5
    theta = np.deg2rad(tt) / 2.0
    omega = np.deg2rad(om)
    k = 4 * np.pi / LAMBDA
    qx, qz = compute_qspace(tt, om, LAMBDA)
    assert float(qx) == pytest.approx(k * np.sin(theta) * np.sin(omega - theta), rel=1e-12)
    assert float(qz) == pytest.approx(k * np.sin(theta) * np.cos(omega - theta), rel=1e-12)


def test_broadcasts_to_grid() -> None:
    # row 2theta (1, M) + column omega (N, 1) -> (N, M) grids (the RSM-mesh call).
    two_theta = np.linspace(60, 62, 10)[None, :]
    omega = np.linspace(30, 31, 5)[:, None]
    qx, qz = compute_qspace(two_theta, omega, LAMBDA)
    assert qx.shape == (5, 10)
    assert qz.shape == (5, 10)


def test_rejects_nonpositive_wavelength() -> None:
    with pytest.raises(ValueError, match="wavelength"):
        compute_qspace(60.0, 30.0, 0.0)
    with pytest.raises(ValueError, match="wavelength"):
        compute_qspace(60.0, 30.0, float("nan"))
