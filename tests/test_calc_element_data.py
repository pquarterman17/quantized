"""calc.elementData: golden parity vs MATLAB +calc/elementData."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.element_data import by_symbol, by_z, element_data, get_property


@pytest.mark.golden
def test_element_by_symbol_fe_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_element_fe.json")
    compare_calc(by_symbol("Fe"), g["output"])


@pytest.mark.golden
def test_element_by_z_oxygen_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_element_o.json")
    compare_calc(by_z(8), g["output"])


@pytest.mark.golden
def test_element_properties_match_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_element_props.json")
    compare_calc(
        {"mass": get_property("mass"), "symbols": get_property("symbol")},
        g["output"],
    )


def test_element_table_has_118() -> None:
    els = element_data()
    assert len(els) == 118
    assert els[0]["symbol"] == "H"
    assert els[-1]["Z"] == 118


def test_element_by_symbol_and_z_agree() -> None:
    fe = by_symbol("Fe")
    assert fe["Z"] == 26
    assert by_z(26)["symbol"] == "Fe"


def test_element_get_property_types() -> None:
    masses = get_property("mass")
    assert isinstance(masses, np.ndarray)
    assert masses.shape == (118,)
    assert masses[0] == pytest.approx(1.008)
    symbols = get_property("symbol")
    assert isinstance(symbols, list)
    assert symbols[5] == "C"  # carbon, Z=6


def test_element_lookup_validation() -> None:
    with pytest.raises(ValueError, match="not found"):
        by_symbol("Xx")
    with pytest.raises(ValueError, match="between 1 and 118"):
        by_z(0)
