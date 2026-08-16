"""Diffusion: golden parity vs MATLAB DiraCulator.m buildDiffusionTab.

STAGED (DIRACULATOR_AUDIT P1): these tests load ``calc_dira_diffusion_*.json``
golden fixtures that do not exist yet in this checkout -- ``load_golden``
skips cleanly until the owner runs MATLAB against
``tools/matlab/freeze_diraculator_values.m`` and commits the frozen JSON.

No ``+calc/+diffusion`` package exists in ``quantized_matlab`` -- all three
formulas are embedded directly in ``buildDiffusionTab``'s nested callbacks
(DiraCulator.m ~4698-4829), so each freeze case replicates the callback
formula inline (cited by line range in the freeze script and below) rather
than calling a ``+calc`` function.

NOTE (overlap, deliberately not re-frozen here): ``diffusion_length``'s
``L = sqrt(D*t)`` formula is identical to the separate
``+calc/+semiconductor/diffusionLength.m`` package function (its argument is
named ``tau`` there, ``t`` here). That package op belongs to the
Semiconductor domain's own audit and is frozen there as
``calc_dira_semiconductor_diffusion_length.json``
(see ``freeze_diraculator_values.m``); this file freezes the
GUI-embedded formula instead, since that is what ``quantized.calc.diffusion``'s
own module docstring documents itself against ("Ports the three inline
MATLAB diffusion formulas verbatim" from ``buildDiffusionTab``, not the
semiconductor package).

``c_profile`` (the constant-source erfc diffusion profile) is a Python-only
extension -- no ``+calc`` file and no DiraCulator.m callback implements it
anywhere in ``quantized_matlab`` (grepped the whole tree for "erfc"; the only
hits are ``+fitting/parseEquation.m`` and ``+fitting/residualDiagnostics.m``,
neither of which is a diffusion function) -- and is therefore not
golden-tested here.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from numpy.testing import assert_allclose

from quantized.calc import diffusion


@pytest.mark.golden
def test_arrhenius_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """DiraCulator.m ``doArrhenius``, lines 4732-4742."""
    g = load_golden("calc_dira_diffusion_arrhenius.json")
    result = diffusion.arrhenius(0.1, 1.0, 1000.0)
    assert_allclose(result["D"], g["output"]["D"], rtol=1e-9)


@pytest.mark.golden
def test_diffusion_length_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """DiraCulator.m ``doDiffLength``, lines 4768-4783."""
    g = load_golden("calc_dira_diffusion_diffusion_length.json")
    result = diffusion.diffusion_length(1e-12, 3600.0)
    assert_allclose(result["L"], g["output"]["L"], rtol=1e-9)
    assert_allclose(result["L_um"], g["output"]["L_um"], rtol=1e-9)
    assert_allclose(result["L_nm"], g["output"]["L_nm"], rtol=1e-9)


@pytest.mark.golden
def test_fick_flux_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """DiraCulator.m ``doFick``, lines 4813-4826."""
    g = load_golden("calc_dira_diffusion_fick_flux.json")
    result = diffusion.fick_flux(1e-12, 1e18, 1e-5)
    assert_allclose(result["J"], g["output"]["J"], rtol=1e-9)
