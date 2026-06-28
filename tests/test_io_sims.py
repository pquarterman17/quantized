"""SIMS depth-profile parser: golden parity (shared + interpolated) + behaviour.

.csv/.xlsx are ambiguous with generic CSV/Excel, so the registry routes them by
content sniff: a SIMS layout (vendor banner or depth/concentration fingerprint)
goes to import_sims, everything else falls back to the generic parser.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from quantized.io import import_auto
from quantized.io.sims import import_sims, is_sims_file


@pytest.mark.golden
def test_sims_shared_depth_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    # Shared-depth layout -> no interpolation -> exact parity.
    ds = import_sims(fixtures_dir / "sims_shared.csv")
    assert_golden(ds, "sims_shared_default.json")


@pytest.mark.golden
def test_sims_paired_interpolation_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    # Paired columns with differing depth grids -> union grid + interp1.
    ds = import_sims(fixtures_dir / "sims_barrier.csv")
    assert_golden(ds, "sims_barrier_default.json")


def test_sims_shared_structure(fixtures_dir: Path) -> None:
    ds = import_sims(fixtures_dir / "sims_shared.csv")
    assert ds.labels == ("H", "O", "Si")
    assert ds.units == ("atoms/cc", "atoms/cc", "atoms/cc")
    assert ds.metadata["x_column_name"] == "Depth"
    assert ds.metadata["is_paired_layout"] is False


def test_sims_paired_recovers_element_names(fixtures_dir: Path) -> None:
    ds = import_sims(fixtures_dir / "sims_barrier.csv")
    assert ds.metadata["is_paired_layout"] is True
    # Element names recovered from the vendor row above the header; 'Cu->' -> 'Cu'
    assert ds.labels == ("H", "C", "O", "N", "F", "Cu", "Ta", "Si", "Ti", "W")


@pytest.mark.parametrize("name", ["sims_shared.csv", "sims_barrier.csv", "sims_synth.xlsx"])
def test_registry_routes_sims(fixtures_dir: Path, name: str) -> None:
    # SIMS .csv (banner + structural) and .xlsx (Evans banner, no "SIMS" word)
    # all sniff to import_sims through auto-import.
    ds = import_auto(fixtures_dir / name)
    assert ds.metadata["parser_name"] == "import_sims"


@pytest.mark.parametrize(
    ("name", "parser"),
    [("csv_xrd.csv", "import_csv"), ("excel_synth.xlsx", "import_excel")],
)
def test_registry_keeps_generic_tables(fixtures_dir: Path, name: str, parser: str) -> None:
    # Non-SIMS .csv/.xlsx must fall through the SIMS sniffer to the generic parser.
    ds = import_auto(fixtures_dir / name)
    assert ds.metadata["parser_name"] == parser


def test_is_sims_file_detects_and_rejects(fixtures_dir: Path) -> None:
    assert is_sims_file(fixtures_dir / "sims_shared.csv") is True
    assert is_sims_file(fixtures_dir / "sims_synth.xlsx") is True
    assert is_sims_file(fixtures_dir / "csv_xrd.csv") is False
    assert is_sims_file(fixtures_dir / "excel_synth.xlsx") is False
