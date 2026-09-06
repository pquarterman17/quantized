"""Excel .xlsx parser: golden parity (synthetic fixture) + routing."""

from __future__ import annotations

import subprocess
import sys
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


def test_xlsx_parser_name_is_transparent(fixtures_dir: Path) -> None:
    """The registry's lazy ``.xlsx`` wrapper must not leak its own identity to
    name-keyed consumers (parser matrix ids, technique.stamp_technique's
    fallback) -- see quantized.io.registry._import_excel_lazy."""
    from quantized.io.registry import resolve_parser

    parser = resolve_parser(fixtures_dir / "excel_synth.xlsx")
    assert parser.__name__ == "import_excel"
    assert parser.__qualname__ == "import_excel"


def test_registry_import_alone_does_not_import_openpyxl() -> None:
    """Importing the registry module must not eagerly pull in openpyxl -- that
    would defeat the point of deferring it into ``_import_excel_lazy``."""
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import quantized.io.registry; "
            "print('openpyxl' in sys.modules)",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False", result.stdout + result.stderr
