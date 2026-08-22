"""Thermal properties: golden parity vs MATLAB DiraCulator.m buildThermalTab.

DIRACULATOR_AUDIT P1 fixtures were frozen on 2026-08-21 using
``tools/matlab/freeze_diraculator_values.m`` against
``quantized_matlab@aee70d12ddd13024a33ac8d29fafbd3245442c7e``.

No ``+calc/+thermal`` package exists in ``quantized_matlab`` -- all three
formulas are embedded directly in ``buildThermalTab``'s nested callbacks
(DiraCulator.m ~4568-4692), so each freeze case replicates the callback
formula inline (cited by line range in the freeze script and below) rather
than calling a ``+calc`` function. Each freeze JSON's ``output`` therefore
only carries the specific field(s) the callback actually computed (no GUI
``.latex``/display fields to strip, unlike the ``+calc``-backed domains).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from numpy.testing import assert_allclose

from quantized.calc import thermal


@pytest.mark.golden
def test_wiedemann_franz_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """DiraCulator.m ``doWiedemannFranz``, lines 4598-4608."""
    g = load_golden("calc_dira_thermal_wiedemann_franz.json")
    result = thermal.wiedemann_franz(sigma=6e5, temperature=300.0)
    assert_allclose(result["kappa"], g["output"]["kappa"], rtol=1e-9)


@pytest.mark.golden
def test_debye_temperature_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """DiraCulator.m ``doDebye``, lines 4634-4648."""
    g = load_golden("calc_dira_thermal_debye_temperature.json")
    result = thermal.debye_temperature(v_s=5000.0, n=5e28)
    assert_allclose(result["theta_D"], g["output"]["theta_D"], rtol=1e-9)


@pytest.mark.golden
def test_thermal_diffusivity_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """DiraCulator.m ``doThermalDiffusivity``, lines 4678-4689."""
    g = load_golden("calc_dira_thermal_thermal_diffusivity.json")
    result = thermal.thermal_diffusivity(kappa=150.0, rho=2329.0, cp=700.0)
    assert_allclose(result["alpha"], g["output"]["alpha"], rtol=1e-9)
    assert_allclose(result["alpha_mm2"], g["output"]["alpha_mm2"], rtol=1e-9)
