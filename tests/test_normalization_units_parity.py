"""The backend normalization unit tables must equal the shared fixture that the
frontend preview is also tested against
(``frontend/src/lib/normalizationUnits.parity.test.ts``), so the two copies
cannot drift. If a table changes on purpose, regenerate the fixture from it."""

from __future__ import annotations

import json
from pathlib import Path

from quantized.calc import magnetometry_normalization as norm
from quantized.calc import sample_geometry as geo

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "frontend" / "src" / "lib" / "__fixtures__" / "normalizationUnits.json"
)


def test_python_unit_tables_match_shared_fixture() -> None:
    f = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert norm.RAW_MOMENT_TO_EMU == f["raw_moment_to_emu"]
    assert {k: list(v) for k, v in norm.BASIS_OUTPUT_UNITS.items()} == f["basis_output_units"]
    assert norm.OUTPUT_PER_EMU == f["output_per_emu"]
    assert geo.MASS_TO_G == f["mass_to_g"]
    assert geo.LENGTH_TO_CM == f["length_to_cm"]
    assert geo.AREA_TO_CM2 == f["area_to_cm2"]
    assert geo.VOLUME_TO_CM3 == f["volume_to_cm3"]
