"""Generic CSV parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from quantized.io import import_auto
from quantized.io.delimited import import_csv


@pytest.mark.golden
def test_csv_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_csv(fixtures_dir / "csv_xrd.csv")
    assert_golden(ds, "csv_xrd_default.json")


def test_csv_structure(fixtures_dir: Path) -> None:
    ds = import_csv(fixtures_dir / "csv_xrd.csv")
    # comments stripped; header detected; first col = x, second = value
    assert ds.labels == ("Intensity",)
    assert ds.units == ("cps",)
    assert ds.metadata["x_column_name"] == "2-Theta"
    assert ds.metadata["x_column_unit"] == "deg"
    assert ds.metadata["delimiter"] == ","
    assert ds.n_points == 6474


def test_registry_routes_csv(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "csv_xrd.csv")
    assert ds.metadata["parser_name"] == "import_csv"
