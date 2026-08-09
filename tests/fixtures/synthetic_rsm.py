"""Synthetic 2-D RSM DataStructs with a KNOWN, ground-truth Q-space peak.

Not a data file — a generator (RSM_CUTS_PLAN item 1), used by
``test_calc_sectorcut.py`` (and extended by item 2's line-cut regression).
Per the project's "fixtures derive from production" rule, the Q-space
columns are built by calling ``calc.qspace.compute_qspace`` — the EXACT
function ``io/xrdml.py::_build_2d`` calls to compute Qx/Qz for a real
PANalytical mesh scan — never a transcribed copy of the wavelength formula.
If that formula ever changes, this fixture changes with it instead of
silently testing a stale convention.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from quantized.calc.qspace import compute_qspace
from quantized.datastruct import DataStruct

__all__ = ["PlantedPeak", "make_synthetic_rsm"]


@dataclass(frozen=True)
class PlantedPeak:
    """Ground truth for one planted 2-D Gaussian, in reciprocal space.

    Read these back off ``make_synthetic_rsm``'s return value in tests —
    never re-hardcode the numbers you passed in as separate expected
    literals (fixtures-derive-from-production: the whole point of
    returning the truth is that a test asserts against IT, not a second
    copy of it).
    """

    qx: float
    qz: float
    amplitude: float
    sigma: float  # isotropic Gaussian width in Q-space, Ang^-1


def make_synthetic_rsm(
    n: int = 64,
    m: int = 96,
    *,
    tt_range: tuple[float, float] = (58.0, 64.0),
    omega_range: tuple[float, float] = (28.0, 32.0),
    wavelength_a: float = 1.5406,
    peaks: Sequence[tuple[float, float, float, float]] | None = None,
    background: float = 5.0,
    curvilinear: bool = True,
) -> tuple[DataStruct, tuple[PlantedPeak, ...]]:
    """A regular (2Theta, Omega) mesh RSM with a planted Q-space Gaussian.

    Builds the SAME layout ``io/xrdml.py::_build_2d`` produces for a real
    PANalytical mesh scan (``mesh_kind="mesh"``, labels
    ``[2Theta, Omega, Intensity, Qx, Qz]``, ``metadata.is2D`` / `map_shape`
    / `axis1_name` set identically) so calc functions written against real
    RSM data work unmodified against this fixture.

    Intensity is one or more ISOTROPIC 2-D Gaussians planted DIRECTLY in
    Q-space (``amp * exp(-((Qx-qx0)^2 + (Qz-qz0)^2) / (2*sigma^2))``) plus a
    flat ``background``, evaluated at each grid point's actual (Qx, Qz).
    Because a regular ANGULAR mesh maps to a curved fan in reciprocal space
    (``curvilinear=True``, the default -- and the case every real RSM in
    the corpus is), a Q-space-isotropic blob is NOT isotropic in
    (2Theta, Omega). That is deliberate: it makes recovering the peak via
    ``sector_profile``/``chi_profile`` (which work in Q-space) a meaningful
    test of Q-aware code, not an angular-space test wearing a Q-space
    label. ``curvilinear=False`` narrows ``omega_range`` to a sliver
    relative to ``tt_range`` so the curvature is negligible across the
    map -- a near-rectilinear baseline for isolating "is this behaviour
    curvature-specific" (needed by item 2's line-cut regression, which
    compares the old whole-row cut against the new band-mask cut).

    Args:
        n: number of Omega frames (rows).
        m: number of 2Theta pixels per frame (columns).
        tt_range: ``(start, end)`` 2Theta range, degrees.
        omega_range: ``(start, end)`` Omega range, degrees (see
            ``curvilinear`` -- narrowed automatically when False).
        wavelength_a: X-ray wavelength, Angstrom (Cu K-alpha1 default).
        peaks: ``[(qx0, qz0, amplitude, sigma), ...]``, reciprocal-space
            Ang^-1. ``None`` (default) plants exactly one peak at the
            mesh's own Q-space centroid, sized relative to its Q-space
            extent -- so even the default peak is DERIVED from the mesh
            geometry, not a hardcoded literal.
        background: flat intensity offset added everywhere.
        curvilinear: see above.

    Returns:
        ``(ds, peaks)`` -- ``ds`` is the DataStruct; ``peaks`` is the
        planted ground truth, one ``PlantedPeak`` per entry in ``peaks``
        (or the single auto-placed default).
    """
    if n < 2 or m < 2:
        raise ValueError("n and m must both be >= 2")

    om_lo, om_hi = omega_range
    if not curvilinear:
        om_mid = (om_lo + om_hi) / 2.0
        # ~1% of the 2Theta span -> Omega barely moves across the map, so
        # the (2Theta, Omega) -> (Qx, Qz) curvature is negligible.
        sliver = (tt_range[1] - tt_range[0]) * 0.01
        om_lo, om_hi = om_mid - sliver / 2.0, om_mid + sliver / 2.0

    two_theta_vec = np.linspace(tt_range[0], tt_range[1], m)
    omega_vec = np.linspace(om_lo, om_hi, n)
    # indexing="xy" (meshgrid's default) puts 2Theta along columns (axis 1,
    # length m) and Omega along rows (axis 0, length n) -- matching
    # io/xrdml.py's map_shape = [n_frames, n_pixels] convention exactly.
    tt_grid, om_grid = np.meshgrid(two_theta_vec, omega_vec)
    qx_grid, qz_grid = compute_qspace(tt_grid, om_grid, wavelength_a)

    if peaks is None:
        qx_c = float(np.mean(qx_grid))
        qz_c = float(np.mean(qz_grid))
        q_span = float(np.hypot(np.ptp(qx_grid), np.ptp(qz_grid)))
        peaks = [(qx_c, qz_c, 1000.0, max(q_span * 0.08, 1e-3))]

    truth = tuple(
        PlantedPeak(qx=float(qx0), qz=float(qz0), amplitude=float(amp), sigma=float(sigma))
        for qx0, qz0, amp, sigma in peaks
    )

    intensity: NDArray[np.float64] = np.full((n, m), float(background), dtype=float)
    for pk in truth:
        arg = ((qx_grid - pk.qx) ** 2 + (qz_grid - pk.qz) ** 2) / (2.0 * pk.sigma**2)
        intensity = np.asarray(intensity + pk.amplitude * np.exp(-arg), dtype=float)

    values = np.column_stack(
        [tt_grid.ravel(), om_grid.ravel(), intensity.ravel(), qx_grid.ravel(), qz_grid.ravel()]
    )
    metadata = {
        "source": "tests/fixtures/synthetic_rsm.py::make_synthetic_rsm",
        "parser_name": "make_synthetic_rsm",
        "x_column_name": "2-Theta",
        "x_column_unit": "deg",
        "num_points": int(values.shape[0]),
        "is2D": True,
        "mesh_kind": "mesh",
        "map_shape": [int(n), int(m)],
        "axis1_name": "Omega",
        "axis2_name": "2Theta",
        "wavelength_a": float(wavelength_a),
        "planted_peaks": [
            {"qx": pk.qx, "qz": pk.qz, "amplitude": pk.amplitude, "sigma": pk.sigma}
            for pk in truth
        ],
    }
    ds = DataStruct.create(
        np.arange(values.shape[0], dtype=float),
        values,
        labels=["2Theta", "Omega", "Intensity", "Qx", "Qz"],
        units=["deg", "deg", "counts", "Ang^-1", "Ang^-1"],
        metadata=metadata,
    )
    return ds, truth
