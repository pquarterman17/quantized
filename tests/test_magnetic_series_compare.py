"""Unit plan for overlaying M(T) / M(H) series (calc + route)."""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from quantized.calc.magnetic_series_compare import series_unit_plan


def _s(label: str, x: str, y: str) -> dict[str, str]:
    return {"label": label, "x_unit": x, "y_unit": y}


def test_field_and_volume_units_convert_to_first_series() -> None:
    plan = series_unit_plan(
        [_s("a", "Oe", "emu/cm³"), _s("b", "T", "A/m"), _s("c", "mT", "kA/m")], axis="field"
    )
    assert plan["x_unit"] == "Oe" and plan["y_unit"] == "emu/cm³"
    f = [s["x_factor"] for s in plan["series"]]
    assert f[0] == 1.0 and f[1] == pytest.approx(1e4) and f[2] == pytest.approx(10.0)
    y = [s["y_factor"] for s in plan["series"]]
    assert y[0] == 1.0 and y[1] == pytest.approx(1e-3) and y[2] == pytest.approx(1.0)


def test_total_moment_and_explicit_targets() -> None:
    plan = series_unit_plan(
        [_s("a", "K", "emu"), _s("b", "K", "A·m²")], axis="temperature", y_unit="A·m²"
    )
    assert plan["y_unit"] == "A·m²"
    assert plan["series"][0]["y_factor"] == pytest.approx(1e-3)
    assert plan["series"][1]["y_factor"] == 1.0


def test_mass_family_spellings_agree() -> None:
    plan = series_unit_plan([_s("a", "K", "emu/g"), _s("b", "K", "A·m²/kg")], axis="temperature")
    assert plan["series"][1]["y_factor"] == pytest.approx(1.0)


def test_identical_unknown_unit_passes_through_unconverted() -> None:
    plan = series_unit_plan(
        [_s("a", "K", "cm³/mol"), _s("b", "K", "cm³/mol")], axis="temperature"
    )
    assert plan["y_unit"] == "cm³/mol"
    assert [s["y_factor"] for s in plan["series"]] == [1.0, 1.0]


@pytest.mark.parametrize(
    ("series", "axis", "needle"),
    [
        ([_s("a", "K", "emu"), _s("b", "K", "emu/g")], "temperature", "one basis"),
        ([_s("a", "K", "emu"), _s("b", "°C", "emu")], "temperature", "must be in K"),
        ([_s("a", "Oe", "emu"), _s("b", "", "emu")], "field", "X unit"),
        ([_s("a", "Oe", "emu"), _s("b", "Oe", "")], "field", "Y unit"),
        ([_s("a", "Oe", "emu"), _s("b", "furlong", "emu")], "field", "furlong"),
        ([_s("a", "K", "cm³/mol"), _s("b", "K", "emu")], "temperature", "not a known"),
        ([_s("a", "Oe", "emu")], "field", "at least two"),
        ([_s("a", "K", "emu"), _s("b", "K", "emu")], "field", "not a field unit"),
        ([_s("a", "Oe", "emu"), _s("b", "K", "emu")], "field", "not a field unit"),
    ],
)
def test_refusals(series: list[dict[str, str]], axis: str, needle: str) -> None:
    with pytest.raises(ValueError, match=needle):
        series_unit_plan(series, axis=axis)


def test_route_plan_and_422(client: TestClient) -> None:
    body = {"series": [_s("a", "Oe", "emu/cm3"), _s("b", "T", "A/m")], "axis": "field"}
    r = client.post("/api/magnetic/series-compare-plan", json=body)
    assert r.status_code == 200
    out = r.json()
    assert out["y_unit"] == "emu/cm³"
    assert math.isclose(out["series"][1]["x_factor"], 1e4)
    bad = client.post(
        "/api/magnetic/series-compare-plan",
        json={"series": [_s("a", "K", "emu"), _s("b", "K", "emu/g")], "axis": "temperature"},
    )
    assert bad.status_code in (400, 422)
