"""Generic CSV parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
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


def test_csv_iso_datetime_x_is_converted_to_epoch_seconds(tmp_path: Path) -> None:
    path = tmp_path / "dated.csv"
    path.write_text(
        "Timestamp,Signal\n2026-07-19T12:00:00Z,1\n2026-07-19T12:01:00Z,2\n",
        encoding="utf-8",
    )
    ds = import_csv(path)
    expected = datetime(2026, 7, 19, 12, 0, tzinfo=UTC).timestamp()
    assert ds.time.tolist() == [expected, expected + 60]
    assert ds.metadata["time_is_datetime"] is True
    assert ds.metadata["time_timezone"] == "UTC"
