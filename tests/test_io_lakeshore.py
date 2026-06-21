"""Lake Shore VSM parser: golden parity (synthetic fixture) + behaviour.

Direct-call only — auto-routing .csv to Lake Shore vs generic CSV is
ambiguous, so the registry doesn't sniff it (matches the MATLAB ambiguity).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from quantized.io.lakeshore import import_lake_shore


@pytest.mark.golden
def test_lakeshore_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_lake_shore(fixtures_dir / "lakeshore_synth.csv")
    assert_golden(ds, "lakeshore_synth_default.json")


def test_lakeshore_defaults_temp_moment(fixtures_dir: Path) -> None:
    ds = import_lake_shore(fixtures_dir / "lakeshore_synth.csv")
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.n_points == 5


def test_lakeshore_all_columns(fixtures_dir: Path) -> None:
    ds = import_lake_shore(fixtures_dir / "lakeshore_synth.csv", y_axis="all")
    assert ds.n_channels == 2  # Magnetic Field + Moment (Temperature is x)
    assert "Moment" in ds.labels
