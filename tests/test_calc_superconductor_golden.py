"""Golden parity vs MATLAB ``+calc/+superconductor`` (DiraCulator
``buildSuperconductorTab``).

Frozen by the DIRACULATOR_AUDIT P1 campaign on 2026-08-21 using
``tools/matlab/freeze_diraculator_values.m`` against
``quantized_matlab@aee70d12ddd13024a33ac8d29fafbd3245442c7e``.

``calc.superconductor`` output keys already match the MATLAB struct field
names verbatim (``lambda``, ``Hc1``, ``JdMA``, ...), so no key remapping is
needed here (contrast ``test_calc_thin_film_golden.py``).

``calc.superconductor.bcs_gap`` is a Python-only extension (weak-coupling
``Delta0 = 1.764*kB*Tc``) with no MATLAB counterpart used by DiraCulator --
``+calc/+superconductor/bcsGap.m`` is a different, array-based curve-fitting
routine (fits Delta0/Tc from measured data), deferred per
``calc/superconductor.py``'s own module docstring, and
``buildSuperconductorTab`` has no "BCS Gap" card at all. Not golden-tested
here.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc import superconductor


@pytest.mark.golden
def test_london_depth_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_superconductor_london_depth.json")
    result = superconductor.london_depth(39.0, 4.2, 9.25)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_coherence_length_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_superconductor_coherence_length.json")
    result = superconductor.coherence_length(38.0, 4.2, 9.25)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_gl_parameter_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_superconductor_gl_parameter.json")
    result = superconductor.gl_parameter(39.0, 38.0)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_critical_fields_manual_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """Card-4 GUI call site: Hc0/Tc/T given directly, no Material/lambda/xi.

    Resolves to Type I with Hc1/Hc2 = NaN even for Nb's own numbers, since
    the Type-II branch requires a preset Material or explicit lambda/xi/
    kappa -- the intended behavior of this exact (Hc0, Tc, T)-only call.
    """
    g = load_golden("calc_dira_superconductor_critical_fields_manual.json")
    result = superconductor.critical_fields(1980.0, 9.25, 4.2)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_critical_fields_material_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """Material-driven path: exercises the Type-II Hc1/Hc2 branch (Nb)."""
    g = load_golden("calc_dira_superconductor_critical_fields_material.json")
    result = superconductor.critical_fields(material="Nb", t=4.2)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_depairing_current_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_superconductor_depairing_current.json")
    result = superconductor.depairing_current(1980.0, 39.0, 9.25, 4.2)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_material_presets_nb_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """Single-material form -- matches Python's ``material_presets("Nb")``
    shape directly (the no-argument form wraps differently on each side:
    MATLAB nests under per-material struct fields, Python under a single
    ``{"materials": {...}}`` dict; freezing one material sidesteps that
    structural difference entirely)."""
    g = load_golden("calc_dira_superconductor_material_presets_nb.json")
    result = superconductor.material_presets("Nb")
    compare_calc(result, g["output"])
