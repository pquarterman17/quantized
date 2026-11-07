"""Explicit-basis sample normalization (MAIN_PLAN #42): mixed-unit geometry,
every output family, the dimensional factors, and per-field refusal.

All inputs are synthetic. Hand calculations are written beside each expected
number so the physics can be audited without running anything.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.calc.magnetometry import convert_mag_units
from quantized.calc.magnetometry_normalization import (
    BASIS_OUTPUT_UNITS,
    OUTPUT_PER_EMU,
    moment_normalization_factor,
    normalize_mag_moment,
)
from quantized.calc.sample_geometry import (
    SampleGeometryError,
    canonical_value,
    resolve_divisor,
)


def q(value: float | None, unit: str) -> dict[str, Any]:
    return {"value": value, "unit": unit}


FILM_5x5x30 = {"width": q(5, "cm"), "length": q(5, "cm"), "film_thickness": q(30, "nm")}


def test_owner_workflow_5cm_x_5cm_x_30nm_to_emu_cm3_and_a_per_m() -> None:
    # Hand calculation:
    #   A = 5 cm × 5 cm = 25 cm²
    #   t_film = 30 nm = 30e-7 cm = 3e-6 cm
    #   V = 25 cm² × 3e-6 cm = 7.5e-5 cm³
    #   m = 1.5e-3 emu  ->  M = 1.5e-3 / 7.5e-5 = 20 emu/cm³
    #   1 emu/cm³ = 1e-3 A·m² / 1e-6 m³ = 1000 A/m  ->  M = 20 000 A/m = 20 kA/m
    out = normalize_mag_moment(
        [1000.0], [1.5e-3], from_field="Oe", to_field="Oe", from_moment="emu",
        basis="volume", to_moment="emu/cm³", profile=FILM_5x5x30, geometry="rectangle",
    )
    assert out["volume_cm3"] == pytest.approx(7.5e-5, rel=1e-12)
    assert out["area_cm2"] == pytest.approx(25.0, rel=1e-12)
    assert out["divisor"] == pytest.approx(7.5e-5, rel=1e-12)
    assert out["divisor_unit"] == "cm³"
    assert out["y"] == pytest.approx([20.0], rel=1e-12)
    assert out["y_unit"] == "emu/cm³"
    assert out["equation"] == "M [emu/cm³] = m [emu] / V [cm³]"
    assert "t_film" in out["geometry_equation"]

    si = normalize_mag_moment(
        [1000.0], [1.5e-3], from_field="Oe", to_field="T", from_moment="emu",
        basis="volume", to_moment="A/m", profile=FILM_5x5x30, geometry="rectangle",
    )
    assert si["y"] == pytest.approx([20_000.0], rel=1e-12)
    assert si["x"] == pytest.approx([0.1], rel=1e-12)  # 1000 Oe = 0.1 T
    assert si["x_unit"] == "T"
    assert si["equation"] == "M [A/m] = m [emu] × 1000 / V [cm³]"
    ka = normalize_mag_moment(
        [0.0], [1.5e-3], from_field="Oe", to_field="Oe", from_moment="emu",
        basis="volume", to_moment="kA/m", profile=FILM_5x5x30, geometry="rectangle",
    )
    assert ka["y"] == pytest.approx([20.0], rel=1e-12)


def test_emu_per_cm3_to_a_per_m_is_exactly_1000() -> None:
    per_cgs = moment_normalization_factor("emu", "volume", "emu/cm³", 1.0)
    per_si = moment_normalization_factor("emu", "volume", "A/m", 1.0)
    assert per_si / per_cgs == 1000.0
    assert moment_normalization_factor("emu", "volume", "kA/m", 1.0) == per_cgs


@pytest.mark.parametrize(
    ("basis", "to_unit", "divisor", "expected"),
    [
        # 2 emu raw: 2 emu; 2e-3 A·m²
        ("none", "emu", 1.0, 2.0),
        ("none", "A·m²", 1.0, 2e-3),
        # mass 4 g: 0.5 emu/g; 2e-3 A·m² / 4e-3 kg = 0.5 A·m²/kg
        ("mass", "emu/g", 4.0, 0.5),
        ("mass", "A·m²/kg", 4.0, 0.5),
        # volume 4 cm³: 0.5 emu/cm³ = 500 A/m = 0.5 kA/m
        ("volume", "emu/cm³", 4.0, 0.5),
        ("volume", "A/m", 4.0, 500.0),
        ("volume", "kA/m", 4.0, 0.5),
        # area 4 cm²: 0.5 emu/cm²; 2e-3 A·m² / 4e-4 m² = 5 A·m²/m²
        ("area", "emu/cm²", 4.0, 0.5),
        ("area", "A·m²/m²", 4.0, 5.0),
    ],
)
def test_every_output_family_from_emu(
    basis: str, to_unit: str, divisor: float, expected: float
) -> None:
    assert 2.0 * moment_normalization_factor("emu", basis, to_unit, divisor) == pytest.approx(
        expected, rel=1e-12
    )


@pytest.mark.parametrize(
    ("to_unit", "si_moment", "si_divisor"),
    [
        # Independent SI check: build the answer from SI quantities directly.
        ("A·m²/kg", 1e-3, 1e-3),  # 1 emu = 1e-3 A·m²; 1 g = 1e-3 kg
        ("A/m", 1e-3, 1e-6),  # 1 cm³ = 1e-6 m³
        ("A·m²/m²", 1e-3, 1e-4),  # 1 cm² = 1e-4 m²
    ],
)
def test_si_factors_are_dimensionally_derived(
    to_unit: str, si_moment: float, si_divisor: float
) -> None:
    assert OUTPUT_PER_EMU[to_unit] == pytest.approx(si_moment / si_divisor, rel=1e-15)


def test_a_m2_source_is_converted_to_emu_first() -> None:
    # 2e-3 A·m² = 2 emu; over 4 cm³ = 0.5 emu/cm³
    factor = moment_normalization_factor("A·m²", "volume", "emu/cm³", 4.0)
    assert 2e-3 * factor == pytest.approx(0.5)
    assert moment_normalization_factor("A·m²", "none", "emu") == pytest.approx(1e3)


def test_raw_factors_agree_with_the_matlab_port() -> None:
    # emu -> emu/g, emu/cm³, A·m² must match convert_mag_units (golden vs MATLAB).
    for to_unit, basis, mass, vol in [("emu/g", "mass", 2.5, 0.0), ("emu/cm³", "volume", 0.0, 0.4),
                                      ("A·m²", "none", 0.0, 0.0), ("A/m", "volume", 0.0, 0.4)]:
        _, legacy, _, unit, warn = convert_mag_units([0.0], [3.0], to_moment=to_unit,
                                                     sample_mass=mass, sample_volume=vol)
        assert warn == "" and unit == to_unit
        divisor = mass if basis == "mass" else vol if basis == "volume" else 1.0
        assert 3.0 * moment_normalization_factor("emu", basis, to_unit, divisor) == pytest.approx(
            float(legacy[0]), rel=1e-15
        )


def test_basis_unit_lists_are_disjoint_families() -> None:
    assert BASIS_OUTPUT_UNITS["volume"] == ("emu/cm³", "A/m", "kA/m")
    assert BASIS_OUTPUT_UNITS["area"] == ("emu/cm²", "A·m²/m²")
    seen: set[str] = set()
    for units in BASIS_OUTPUT_UNITS.values():
        assert not seen & set(units)
        seen |= set(units)
    with pytest.raises(ValueError, match="not a mass-basis unit"):
        moment_normalization_factor("emu", "mass", "A/m", 1.0)


def test_already_normalized_source_is_never_divided_again() -> None:
    assert moment_normalization_factor("emu/g", "none", "emu/g") == 1.0
    with pytest.raises(ValueError, match="already normalized"):
        moment_normalization_factor("emu/g", "mass", "emu/g", 2.0)
    with pytest.raises(ValueError, match="already normalized"):
        moment_normalization_factor("emu/cm³", "none", "emu")


@pytest.mark.parametrize(("basis", "to_unit"), [("mass", "emu/g"), ("none", "emu")])
def test_already_normalized_is_the_reported_reason_even_with_no_profile(
    basis: str, to_unit: str
) -> None:
    # The unit check runs before the geometry check, so the caller is told the
    # real reason rather than "Sample mass is required".
    with pytest.raises(ValueError, match="already normalized") as info:
        normalize_mag_moment([0.0], [1.0], from_field="Oe", to_field="Oe",
                             from_moment="emu/g", basis=basis, to_moment=to_unit, profile={})
    assert "required" not in str(info.value)


@pytest.mark.parametrize(
    ("profile", "geometry", "expected_cm3"),
    [
        # 2 mm × 3000 µm × 50 Å: 0.2 cm × 0.3 cm × 5e-7 cm = 3e-8 cm³
        ({"width": q(2, "mm"), "length": q(3000, "µm"), "film_thickness": q(50, "Å")},
         "rectangle", 3e-8),
        # 0.5 cm² × 100 nm = 0.5 × 1e-5 = 5e-6 cm³
        ({"area": q(0.5, "cm²"), "film_thickness": q(100, "nm")}, "area", 5e-6),
        # Ø 1 cm disc, 1 µm: π × 0.25 cm² × 1e-4 cm
        ({"diameter": q(10, "mm"), "film_thickness": q(1, "µm")}, "circle", math.pi * 0.25e-4),
        # 2 µL = 2 mm³ = 2e-3 cm³
        ({"volume": q(2, "µL")}, "volume", 2e-3),
        # 3e-9 m³ = 3e-3 cm³
        ({"volume": q(3e-9, "m³")}, "volume", 3e-3),
    ],
)
def test_mixed_unit_volume_paths(
    profile: dict[str, Any], geometry: str, expected_cm3: float
) -> None:
    geo = resolve_divisor(profile, "volume", geometry)
    assert geo.volume_cm3 == pytest.approx(expected_cm3, rel=1e-12)
    assert geo.divisor_unit == "cm³"


@pytest.mark.parametrize(
    ("profile", "geometry", "expected_cm2"),
    [
        ({"width": q(5, "mm"), "length": q(2, "cm")}, "rectangle", 1.0),  # 0.5 cm × 2 cm
        ({"area": q(150, "mm²")}, "area", 1.5),
        ({"diameter": q(2, "cm")}, "circle", math.pi),  # π × (1 cm)²
    ],
)
def test_mixed_unit_area_paths_ignore_thickness(
    profile: dict[str, Any], geometry: str, expected_cm2: float
) -> None:
    geo = resolve_divisor({**profile, "film_thickness": q(-1, "nm")}, "area", geometry)
    assert geo.area_cm2 == pytest.approx(expected_cm2, rel=1e-12)
    assert geo.volume_cm3 is None


def test_mass_units_and_greek_mu_spelling() -> None:
    assert resolve_divisor({"mass": q(250, "µg")}, "mass").mass_g == pytest.approx(2.5e-4)
    assert canonical_value("mass", 250, "μg") == pytest.approx(2.5e-4)  # Greek mu
    assert resolve_divisor({"mass": q(1.2, "kg")}, "mass").divisor == pytest.approx(1200.0)


@pytest.mark.parametrize(
    ("value", "message"),
    [(None, "is required"), (0, "greater than zero"), (-3, "greater than zero"),
     (float("nan"), "finite"), (float("inf"), "finite")],
)
def test_each_bad_field_is_named(value: float | None, message: str) -> None:
    profile = {"width": q(5, "cm"), "length": q(5, "cm"), "film_thickness": q(value, "nm")}
    with pytest.raises(SampleGeometryError) as info:
        resolve_divisor(profile, "volume", "rectangle")
    assert set(info.value.field_errors) == {"film_thickness"}
    assert "Magnetic-film thickness" in str(info.value) and message in str(info.value)


def test_all_missing_fields_are_reported_together() -> None:
    with pytest.raises(SampleGeometryError) as info:
        resolve_divisor({}, "volume", "circle")
    assert set(info.value.field_errors) == {"diameter", "film_thickness"}


def test_unknown_unit_and_impossible_path_refuse() -> None:
    with pytest.raises(SampleGeometryError, match="unknown unit"):
        resolve_divisor({"mass": q(1, "lb")}, "mass")
    with pytest.raises(ValueError, match="cannot give a area divisor"):
        resolve_divisor({"volume": q(1, "cm³")}, "area", "volume")
    with pytest.raises(ValueError, match="Unknown normalization basis"):
        resolve_divisor({}, "density")


def test_inputs_are_not_modified_and_field_failure_only_warns() -> None:
    y = np.array([1.0, 2.0])
    x = np.array([10.0, 20.0])
    out = normalize_mag_moment(x, y, from_field="K", to_field="T", from_moment="emu",
                               basis="mass", to_moment="emu/g", profile={"mass": q(2, "g")})
    assert y.tolist() == [1.0, 2.0] and x.tolist() == [10.0, 20.0]
    assert out["y"].tolist() == [0.5, 1.0]
    assert out["x_unit"] == "K" and "Unknown source field unit" in out["warning"]


def test_route_returns_the_calculation_record(client: TestClient) -> None:
    resp = client.post("/api/magnetometry/normalize", json={
        "x": [0.0, 1000.0], "y": [1.5e-3, 3e-3], "from_field": "Oe", "to_field": "Oe",
        "from_moment": "emu", "basis": "volume", "to_moment": "A/m", "geometry": "rectangle",
        "profile": FILM_5x5x30,
    })
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["y"] == pytest.approx([20_000.0, 40_000.0], rel=1e-12)
    assert out["factor"] == pytest.approx(1000.0 / 7.5e-5, rel=1e-12)
    assert out["canonical"]["film_thickness"] == pytest.approx(3e-6, rel=1e-12)


def test_route_names_the_bad_field(client: TestClient) -> None:
    resp = client.post("/api/magnetometry/normalize", json={
        "x": [0.0], "y": [1.0], "basis": "volume", "to_moment": "emu/cm³", "geometry": "area",
        "profile": {"area": q(1, "cm²"), "film_thickness": q(0, "nm")},
    })
    assert resp.status_code == 422
    assert "Magnetic-film thickness must be greater than zero" in resp.text


def test_mismatched_x_y_lengths_are_refused(client: TestClient) -> None:
    with pytest.raises(ValueError, match="same length"):
        normalize_mag_moment(
            [0.0, 1.0], [1.0], from_field="Oe", to_field="Oe",
            from_moment="emu", basis="none", to_moment="A·m²",
        )
    resp = client.post("/api/magnetometry/normalize", json={
        "x": [0.0, 1.0, 2.0], "y": [1.0, 2.0], "to_moment": "A·m²",
    })
    assert resp.status_code == 422
    assert "same length" in resp.text
