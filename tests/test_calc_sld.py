"""SLD profile helpers + presets: golden parity vs MATLAB +fitting."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.sld import profile_to_layers, refl_sld_presets, sld_profile, spline_sld


@pytest.mark.golden
def test_sld_profile_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_sldprofile.json")
    z, sld = sld_profile(np.asarray(g["input"], dtype=float))
    compare_calc({"z": z, "sld": sld}, g["output"])


@pytest.mark.golden
def test_spline_sld_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_splinesld.json")
    z, sld = spline_sld(
        np.asarray(g["input"]["zKnots"], dtype=float),
        np.asarray(g["input"]["sldKnots"], dtype=float),
    )
    compare_calc({"z": z, "sld": sld}, g["output"])


@pytest.mark.golden
def test_profile_to_layers_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_profiletolayers.json")
    layers = profile_to_layers(
        np.asarray(g["input"]["z"], dtype=float),
        np.asarray(g["input"]["sld"], dtype=float),
    )
    compare_calc(layers, g["output"])


def test_refl_sld_presets_loaded() -> None:
    presets = refl_sld_presets()
    assert len(presets) >= 25
    by_name = {p["name"]: p for p in presets}
    si = by_name["Silicon"]
    assert si["formula"] == "Si"
    assert si["sldX"] == pytest.approx(20.07e-6)
    assert si["sldN"] == pytest.approx(2.073e-6)
    assert by_name["Gold"]["sldImag"] == pytest.approx(0.442e-6)


def test_profile_to_layers_structure() -> None:
    z = np.linspace(0.0, 100.0, 11)
    sld = np.linspace(1e-6, 5e-6, 11)
    layers = profile_to_layers(z, sld)
    assert layers.shape == (12, 4)  # ambient + 10 slabs + substrate
    assert layers[0, 0] == 0.0  # ambient thickness
    assert layers[-1, 0] == 0.0  # substrate thickness
    assert_allclose(layers[1:-1, 0], np.diff(z))  # slab thicknesses


def test_sld_profile_endpoints() -> None:
    layers = np.array([[0, 0, 0, 0], [200, 4e-6, 0, 5], [0, 2.07e-6, 0, 3]])
    z, sld = sld_profile(layers, n_points=300)
    assert sld[0] == pytest.approx(0.0, abs=1e-9)  # ambient SLD at the top
    assert sld[-1] == pytest.approx(2.07e-6, abs=1e-8)  # substrate SLD at the bottom
