"""XRD theta-2theta pattern (journey 3): two phases on a decaying background.

Modeled on ``tests/fixtures/csv_xrd.csv`` (a ``#``-preamble + single
``2-Theta (deg),Intensity (cps)`` header row), routed by the generic CSV
importer's fallback branch (no SIMS/Lake Shore vendor markers).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from common import fmt_sig, write_text

__all__ = ["write_xrd_pattern"]

# (center deg, height cps, fwhm deg) — two synthetic "phases".
_PHASE_A_PEAKS = (
    (24.3, 480.0, 0.18),
    (31.7, 900.0, 0.15),
    (45.4, 260.0, 0.20),
    (52.9, 340.0, 0.17),
    (66.1, 150.0, 0.22),
)
_PHASE_B_PEAKS = (
    (28.6, 220.0, 0.16),
    (38.9, 150.0, 0.19),
    (58.2, 300.0, 0.18),
    (73.5, 110.0, 0.24),
)


def _gaussian(two_theta: np.ndarray, center: float, height: float, fwhm: float) -> np.ndarray:
    sigma = fwhm / 2.3548200450309493  # FWHM -> sigma
    return height * np.exp(-0.5 * ((two_theta - center) / sigma) ** 2)


def write_xrd_pattern(path: Path, *, seed: int, n_points: int = 4000) -> None:
    rng = np.random.default_rng(seed)
    two_theta = np.linspace(10.0, 90.0, n_points)

    background = 40.0 * np.exp(-(two_theta - 10.0) / 45.0) + 6.0
    intensity = background.copy()
    for center, height, fwhm in _PHASE_A_PEAKS:
        intensity += _gaussian(two_theta, center, height, fwhm)
    for center, height, fwhm in _PHASE_B_PEAKS:
        intensity += _gaussian(two_theta, center, height, fwhm)

    # Poisson-like counting noise, deterministic under the seed.
    counting_time = 1.0
    counts_mean = np.maximum(intensity * counting_time, 0.0)
    noisy_counts = rng.poisson(counts_mean).astype(float)
    cps = noisy_counts / counting_time

    preamble = [
        "XRD Batch Export (synthetic P0.3 baseline fixture)",
        "Sample: baseline-two-phase-pattern",
        "Anode: Cu (45.0 kV / 40.0 mA)",
        f"2-theta range: {two_theta[0]:.4f} - {two_theta[-1]:.4f} deg",
        "Phases: phase-A (5 peaks), phase-B (4 peaks)",
    ]
    lines = [f"# {line}" for line in preamble]
    lines.append("2-Theta (deg),Intensity (cps)")
    for i in range(n_points):
        lines.append(f"{fmt_sig(two_theta[i], 8)},{fmt_sig(cps[i])}")
    write_text(path, "\n".join(lines) + "\n")
