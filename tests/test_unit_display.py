"""Units are spelled typographically in axis titles and legends, on screen and
in the vector export alike ("cm^-1" -> "cm⁻¹"), while the data keeps its own
unit string. Both legs read ``tests/fixtures/wire/unit_display.json``; the
screen leg is ``frontend/src/lib/unitDisplay.test.ts``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_labels import series_display_name, shared_axis_title
from quantized.calc.plotting import PlotSeries
from quantized.unit_display import display_unit, with_unit

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "unit_display.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]

client = TestClient(app)


@pytest.mark.parametrize("case", CASES, ids=[c["unit"] or "<empty>" for c in CASES])
def test_display_unit_matches_the_shared_table(case: dict[str, Any]) -> None:
    assert display_unit(case["unit"]) == case["display"]


def test_with_unit_composes_the_display_spelling() -> None:
    assert with_unit("Wavenumber", "cm^-1") == "Wavenumber (cm⁻¹)"
    assert with_unit("Transmittance", "") == "Transmittance"


def test_legend_and_shared_axis_title_use_the_display_spelling() -> None:
    assert series_display_name("Mag", "emu/cm^3") == "Mag (emu/cm³)"
    # A rename is verbatim -- never rewritten.
    assert series_display_name("Mag", "emu/cm^3", "M (emu/cm^3)") == "M (emu/cm^3)"
    series = [PlotSeries("Qz", "Ang^-1", np.zeros(2)), PlotSeries("Qz", "Ang^-1", np.zeros(2))]
    assert shared_axis_title(series) == "Qz (Å⁻¹)"


def _export_svg(**extra: Any) -> str:
    payload: dict[str, Any] = {
        "dataset": {
            "time": [4000.0, 3000.0, 2000.0],
            "values": [[0.9, 1.0], [0.5, 1.0], [0.8, 1.0]],
            "labels": ["Transmittance", "Mag"],
            "units": ["", "emu/cm^3"],
            "metadata": {"x_column_name": "Wavenumber", "x_column_unit": "cm^-1"},
        },
        "y_keys": [0, 1],
        "fmt": "svg",
        "overrides": {"legend": {"show": True, "loc": "upper right"}},
        "filename": "units",
        **extra,
    }
    resp = client.post("/api/export/figure", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.content.decode("utf-8")


def test_vector_export_spells_the_axis_title_and_legend_units() -> None:
    svg = _export_svg()
    assert "Wavenumber (cm⁻¹)" in svg
    assert "Mag (emu/cm³)" in svg
    assert "cm^-1" not in svg
    assert "cm^3" not in svg
