"""X-ray & Neutron calculators (calc.xray) -- golden parity vs quantized_matlab.

DIRACULATOR_AUDIT P1 evidence. Golden fixtures are STAGED: run
tools/matlab/freeze_diraculator_values.m against ../quantized_matlab, then
these tests exercise for real; until then they SKIP via load_golden.

Classification (see calc/xray.py module docstring for the full provenance):
  class (a) -- MATLAB counterpart exists, golden-tested below:
    bragg_d_spacing  <-> calc.crystal.dFromTwoTheta
    bragg_two_theta  <-> calc.crystal.twoThetaFromD
    bragg_theta      <-> calc.xrayNeutron.braggLaw(...).theta
    q_from_two_theta <-> calc.xrayNeutron.twoThetaToQ
    two_theta_from_q <-> calc.xrayNeutron.qToTwoTheta
    q_from_d_spacing <-> calc.xrayNeutron.braggLaw(...).Q (wavelength cancels)
  class (c) -- Python-only extension, NOT golden-tested (no MATLAB source):
    bragg_d_from_theta, d_spacing_from_q, energy_from_wavelength_a,
    wavelength_from_energy_kev, neutron_calc. xray_calc is a dispatcher over
    the class-(a) modes above, not a distinct formula -- not separately
    tested here.
  class (c)/documented divergence -- NOT golden-tested:
    sld_formula.sld_from_formula wraps `periodictable` (Sears + Henke/CXRO
    tables, the NIST NCNR engine), not MATLAB's own calc.elementData
    bCoherent/dispersionFactors tables. Different underlying atomic-data
    tables make a MATLAB-golden comparison meaningless; parity against
    published NIST NCNR reference values is already asserted in
    tests/test_sld_formula.py (that file's own docstring: "these are
    reference-value tests ... not MATLAB golden tests -- there is no MATLAB
    source for this feature").
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc.xray import (
    bragg_d_spacing,
    bragg_theta,
    bragg_two_theta,
    q_from_d_spacing,
    q_from_two_theta,
    two_theta_from_q,
)

LAMBDA_A = 1.5406  # Cu Kalpha1 (Angstrom)
TWO_THETA_DEG = 28.44
D_A = 3.1356  # Si(111)


@pytest.mark.golden
def test_bragg_d_spacing_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.crystal.dFromTwoTheta(28.44, lambda=1.5406) -> d."""
    g = load_golden("calc_dira_xray_d_from_2theta.json")
    d = bragg_d_spacing(LAMBDA_A, TWO_THETA_DEG, 1)
    compare_calc(d, g["output"]["d"])


@pytest.mark.golden
def test_bragg_two_theta_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.crystal.twoThetaFromD(3.1356, lambda=1.5406) -> twoTheta."""
    g = load_golden("calc_dira_xray_2theta_from_d.json")
    two_theta = bragg_two_theta(LAMBDA_A, D_A, 1)
    compare_calc(two_theta, g["output"]["twoTheta"])


@pytest.mark.golden
def test_bragg_theta_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.xrayNeutron.braggLaw(3.1356, Lambda=1.5406).theta -> theta.

    braggLaw.m is not a 1:1 name match for bragg_theta, but its .theta field
    uses the identical formula (theta = asind(lambda/(2d))), so it is a
    valid golden source.
    """
    g = load_golden("calc_dira_xray_theta_from_d.json")
    theta = bragg_theta(LAMBDA_A, D_A, 1)
    compare_calc(theta, g["output"]["theta"])


@pytest.mark.golden
def test_q_from_two_theta_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.xrayNeutron.twoThetaToQ(28.44, Lambda=1.5406) -> Q."""
    g = load_golden("calc_dira_xray_q_from_2theta.json")
    q = q_from_two_theta(LAMBDA_A, TWO_THETA_DEG)
    compare_calc(q, g["output"]["Q"])


@pytest.mark.golden
def test_two_theta_from_q_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.xrayNeutron.qToTwoTheta(2.0038223329441213, Lambda=1.5406) -> twoTheta."""
    g = load_golden("calc_dira_xray_2theta_from_q.json")
    q_val = 2.0038223329441213
    two_theta = two_theta_from_q(LAMBDA_A, q_val)
    compare_calc(two_theta, g["output"]["twoTheta"])


@pytest.mark.golden
def test_q_from_d_spacing_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.xrayNeutron.braggLaw(3.1356, Lambda=1.5406).Q -> Q.

    Q = 4*pi*sin(theta)/lambda algebraically reduces to 2*pi/d, so it is
    wavelength-independent -- braggLaw's Q field (computed alongside theta,
    which does need an admissible lambda) is a valid golden source for the
    wavelength-free q_from_d_spacing.
    """
    g = load_golden("calc_dira_xray_q_from_d.json")
    q = q_from_d_spacing(D_A, 1)
    compare_calc(q, g["output"]["Q"])
