"""XRR and PNR curves (journey 4), computed with the real Parratt engine.

Uses ``quantized.calc.reflectivity.parratt_refl`` (pure calc layer, no I/O)
so the fixtures are physically plausible bilayer reflectivity curves with
Kiessig fringes, not hand-waved shapes. Noise is modeled as counting
statistics (Poisson counts at a fixed "monitor" rate plus a small background
count rate) rather than additive Gaussian noise on R directly — that keeps
every point non-negative and lets the curve flatten at a realistic
background floor at high Q instead of a hard clip. Emitted in the two
formats the existing corpus fixtures already exercise:

- XRR -> NCNR reductus ``.refl`` (``# "columns": [...]`` header), matching
  ``tests/fixtures/ncnr_j395.refl``.
- PNR -> NCNR polarized ``.pnr`` (2 tab-delimited header rows), matching
  ``tests/fixtures/ncnr_s11_nsf.pnr``.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from common import fmt_sci, write_text

from quantized.calc.reflectivity import parratt_refl

__all__ = ["write_pnr_pair", "write_xrr_refl"]

# [thickness A, SLD_real, SLD_imag, roughness A]; layer 0 = incident medium.
_BILAYER = np.array(
    [
        [0.0, 0.0, 0.0, 0.0],  # air
        [300.0, 3.0e-6, 0.05e-6, 6.0],  # film 1
        [150.0, 5.5e-6, 0.08e-6, 4.0],  # film 2
        [0.0, 2.07e-6, 0.02e-6, 3.0],  # Si substrate
    ]
)


def _apply_counting_noise(
    r: np.ndarray, rng: np.random.Generator, *, monitor: float, background_counts: float
) -> tuple[np.ndarray, np.ndarray]:
    """Poisson-count noise: ``R_noisy = counts / monitor`` (always >= 0), with a
    small background count rate so the curve settles at a noise floor at high
    Q instead of decaying to a physically implausible near-zero clip."""
    expected_counts = r * monitor + background_counts
    counts = rng.poisson(expected_counts).astype(float)
    r_noisy = counts / monitor
    dr = np.maximum(np.sqrt(counts), 1.0) / monitor
    return r_noisy, dr


def write_xrr_refl(path: Path, *, seed: int, n_points: int = 500) -> None:
    """Simulated bilayer reflectivity R(Q) over >=4 decades, with dR and dQ."""
    rng = np.random.default_rng(seed)
    q = np.linspace(0.006, 0.30, n_points)
    dq = 0.02 * q  # constant dQ/Q resolution, a typical reflectometer contract

    r = parratt_refl(q, _BILAYER)
    r_noisy, dr = _apply_counting_noise(r, rng, monitor=2.0e7, background_counts=5.0)

    header = [
        '# "name": "baseline_xrr_bilayer"',
        '# "polarization": ""',
        '# "columns": ["Qz", "Intensity", "uncertainty", "resolution"]',
        '# "units": ["1/Ang", "arb. units", "arb. units", "1/Ang"]',
    ]
    lines = list(header)
    for i in range(n_points):
        lines.append(
            f"{fmt_sci(q[i])} {fmt_sci(r_noisy[i])} {fmt_sci(dr[i])} {fmt_sci(dq[i])}"
        )
    write_text(path, "\n".join(lines) + "\n")


def write_pnr_pair(path: Path, *, seed: int, n_points: int = 220) -> None:
    """Spin-up/spin-down (R++/R--) reflectivity pair with a magnetic splitting."""
    rng = np.random.default_rng(seed)
    q = np.geomspace(0.005, 0.25, n_points)

    magnetic_split = 0.45e-6
    layers_up = _BILAYER.copy()
    layers_up[2, 1] += magnetic_split
    layers_dn = _BILAYER.copy()
    layers_dn[2, 1] -= magnetic_split

    r_up = parratt_refl(q, layers_up)
    r_dn = parratt_refl(q, layers_dn)
    r_up_noisy, dr_up = _apply_counting_noise(r_up, rng, monitor=1.0e7, background_counts=4.0)
    r_dn_noisy, dr_dn = _apply_counting_noise(r_dn, rng, monitor=1.0e7, background_counts=4.0)
    dq = 0.02 * q

    col_names = ["Q", "dQ", "R++", "dR++", "R--", "dR--"]
    units = ["A-1", "A-1", "arb. units", "arb. units", "arb. units", "arb. units"]
    lines = ["\t".join(col_names), "\t".join(units)]
    for i in range(n_points):
        row = [q[i], dq[i], r_up_noisy[i], dr_up[i], r_dn_noisy[i], dr_dn[i]]
        lines.append("\t".join(fmt_sci(v) for v in row))
    write_text(path, "\n".join(lines) + "\n")
