"""PANalytical XRDML reciprocal-space-map mesh (journey 6: large 2-D maps).

Mirrors ``tests/fixtures/xrdml_rsm_synthetic.xrdml``'s structure: N ``<scan>``
blocks sharing one 2Theta range, each at a fixed Omega (``commonPosition``),
which ``io/xrdml.py``'s ``_is_2d`` classifies as a classic scanning-line RSM
mesh. The small committed fixture and the large (``--large``) P0.4-scale map
share this one generator, parameterized by grid size.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from common import write_text

__all__ = ["write_xrdml_rsm"]

_HEADER = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/2.1" status="Completed">
  <xrdMeasurement measurementType="Scan" sampleMode="Reflection">
    <usedWavelength intended="K-Alpha 1">
      <kAlpha1 unit="Angstrom">1.5405980</kAlpha1>
    </usedWavelength>
"""
_FOOTER = "  </xrdMeasurement>\n</xrdMeasurements>\n"


def _counts_row(
    two_theta: np.ndarray, omega: float, *, tt0: float, omega0: float, seed: int
) -> np.ndarray:
    """A single scan's counts: a 2-D Gaussian peak blob + flat background."""
    rng = np.random.default_rng(seed)
    sigma_tt, sigma_om = 0.35, 0.10
    peak = 4000.0 * np.exp(
        -0.5 * (((two_theta - tt0) / sigma_tt) ** 2 + ((omega - omega0) / sigma_om) ** 2)
    )
    background = 12.0
    mean_counts = np.maximum(peak + background, 0.0)
    return rng.poisson(mean_counts).astype(float)


def write_xrdml_rsm(
    path: Path,
    *,
    seed: int,
    n_omega: int = 12,
    n_tt: int = 41,
    tt_start: float = 40.0,
    tt_end: float = 42.0,
    omega_start: float = 20.7,
    omega_end: float = 21.1,
) -> None:
    two_theta = np.linspace(tt_start, tt_end, n_tt)
    omega_values = np.linspace(omega_start, omega_end, n_omega)
    tt0 = 0.5 * (tt_start + tt_end)
    omega0 = 0.5 * (omega_start + omega_end)

    parts = [_HEADER]
    for i, omega in enumerate(omega_values):
        counts = _counts_row(two_theta, float(omega), tt0=tt0, omega0=omega0, seed=seed + i)
        counts_text = " ".join(str(int(c)) for c in counts)
        parts.append(
            f'    <scan appendNumber="{i}" mode="Continuous" scanAxis="Omega" '
            'status="Completed">\n'
            "      <dataPoints>\n"
            '        <positions axis="2Theta" unit="deg">\n'
            f"          <startPosition>{tt_start:.6f}</startPosition>\n"
            f"          <endPosition>{tt_end:.6f}</endPosition>\n"
            "        </positions>\n"
            '        <positions axis="Omega" unit="deg">\n'
            f"          <commonPosition>{float(omega):.6f}</commonPosition>\n"
            "        </positions>\n"
            '        <commonCountingTime unit="seconds">1.000000</commonCountingTime>\n'
            f'        <counts unit="counts">{counts_text}</counts>\n'
            "      </dataPoints>\n"
            "    </scan>\n"
        )
    parts.append(_FOOTER)
    write_text(path, "".join(parts))
