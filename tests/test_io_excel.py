"""Excel .xlsx parser: golden parity (synthetic fixture) + routing."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from quantized.io import import_auto
from quantized.io.excel import import_excel


@pytest.mark.golden
def test_excel_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_excel(fixtures_dir / "excel_synth.xlsx")
    assert_golden(ds, "excel_synth_default.json")


def test_excel_structure(fixtures_dir: Path) -> None:
    ds = import_excel(fixtures_dir / "excel_synth.xlsx")
    assert ds.labels == ("Signal", "Temperature")
    assert ds.units == ("V", "K")
    assert ds.metadata["x_column_name"] == "Time"
    assert ds.metadata["sheet_name"] == "Data"
    assert ds.n_points == 6


def test_registry_routes_xlsx(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "excel_synth.xlsx")
    assert ds.metadata["parser_name"] == "import_excel"
