"""Reciprocal-space coordinates for XRD reciprocal-space maps (RSM).

Port of the coplanar Q-space formula documented in MATLAB
``parser.importXRDML`` (angular area-detector data -> reciprocal space):

    theta = 2theta / 2
    Qx = (4*pi/lambda) * sin(theta) * sin(omega - theta)      [Ang^-1]
    Qz = (4*pi/lambda) * sin(theta) * cos(omega - theta)      [Ang^-1]

where ``2theta`` is the detector angle, ``omega`` the incident (sample-tilt)
angle, and ``lambda`` the X-ray wavelength (Angstrom). Standard coplanar
geometry: Qx is the in-plane, Qz the out-of-plane reciprocal-lattice
coordinate. At the symmetric condition ``omega == theta`` the in-plane term
``sin(omega - theta)`` vanishes, so ``Qx == 0`` (the scan runs straight up the
specular Qz axis) — a useful sanity check.

Pure calc layer (ndarray in -> ndarray out); no fastapi/pydantic.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["compute_qspace"]


def compute_qspace(
    two_theta_deg: ArrayLike,
    omega_deg: ArrayLike,
    wavelength_a: float,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Angular ``(2theta, omega)`` in degrees -> reciprocal-space ``(Qx, Qz)``.

    Inputs broadcast together (numpy rules), so the common RSM-grid call passes
    ``two_theta`` as a row ``(1, M)`` and ``omega`` as a column ``(N, 1)`` to get
    ``(N, M)`` grids; equal-shaped arrays are handled element-wise. ``Qx``/``Qz``
    are returned in ``Ang^-1``.
    """
    if not (np.isfinite(wavelength_a) and wavelength_a > 0):
        raise ValueError(f"wavelength_a must be positive and finite, got {wavelength_a!r}")
    theta = np.deg2rad(np.asarray(two_theta_deg, dtype=float)) / 2.0
    omega = np.deg2rad(np.asarray(omega_deg, dtype=float))
    k = 4.0 * np.pi / wavelength_a
    sin_theta = np.sin(theta)
    qx = np.asarray(k * sin_theta * np.sin(omega - theta), dtype=float)
    qz = np.asarray(k * sin_theta * np.cos(omega - theta), dtype=float)
    return qx, qz
