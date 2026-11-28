"""A time-of-day column in a plain CSV (`io._time_of_day.is_clock_column`).

One strict rule serves direct import and the Import Wizard's proposal; the
imported column must match the wizard's ``clock`` format value for value."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.axis_categories import x_axis_kind
from quantized.datastruct import DataStruct
from quantized.io import _time_of_day as tod
from quantized.io.delimited import import_csv
from quantized.io.import_preview import guess_settings, parse_import


@pytest.mark.parametrize(
    "cells",
    [
        ["12:30:01", "12:30:02"],
        ["9:05:00", "09:05:01.250"],
        ["00:00:00", "23:59:59"],
        ["12:30:01", "", "  ", "12:30:03"],
        ["12:30:01", None, "12:30:03"],
        ["12:30", "12:30:05"],  # seconds on any cell settle the ambiguity
    ],
)
def test_rule_accepts_clock_columns(cells: list[str | None]) -> None:
    assert tod.is_clock_column(cells, "Col1")


@pytest.mark.parametrize(
    "cells",
    [
        ["25:00:00", "12:00:00"],  # hour out of range: an [h]:mm:ss duration
        ["12:60:00", "12:00:00"],
        ["12:00:60", "12:00:00"],
        ["1:2:3", "12:00:00"],
        ["12:30:01", "n/a"],
        ["12:30:01", "NaN"],
        ["12:30:01", "noon"],
        ["12:30:01", "1.5"],
        ["12:30:01 PM", "1:30:01 PM"],  # AM/PM is not part of the shared rule
        ["24:00:00", "12:00:00"],
        ["", "  ", None],  # nothing to read
        ["2026-01-01 12:30:01"],
        ["25:00", "12:30"],
        ["12:60"],
        ["1:2"],
        ["12:30", "x"],
    ],
)
def test_rule_refuses_near_misses(cells: list[str | None]) -> None:
    assert not tod.is_clock_column(cells, "Time")


def test_hour_minute_only_column_needs_a_header_that_names_a_time() -> None:
    cells = ["12:30", "12:31", "12:32"]
    assert tod.is_clock_column(cells, "Time (hh:mm)")
    assert tod.is_clock_column(cells, "Clock")
    assert tod.is_clock_column(cells, "Time of day")
    assert not tod.is_clock_column(cells, "")  # ratio or minutes:seconds
    assert not tod.is_clock_column(cells, "Dilution")
    assert not tod.is_clock_column(cells, "Lap time")  # a lap is mm:ss
    assert not tod.is_clock_column(cells, "Elapsed time")
    assert not tod.is_clock_column(cells, "Ratio")


def _write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "log.csv"
    path.write_text(body, newline="")
    return path


def _both(path: Path) -> tuple[DataStruct, DataStruct]:
    text = path.read_text()
    return import_csv(path), parse_import(text, guess_settings(text))


@pytest.mark.parametrize(
    "rows",
    [
        "Time,T (K)\n09:00:00,1\n09:00:30,2\n09:01:00,3\n",
        "Time,T (K)\n09:00,1\n09:01,2\n09:02,3\n",
        "Time,T (K)\n09:00:00.250,1\n09:00:00.750,2\n09:00:01.500,3\n",
        "Time,T (K)\n09:00:00,1\n,2\n09:01:00,3\n",  # a blank cell
        "Time,T (K)\n23:59:58,1\n23:59:59,2\n00:00:00,3\n",  # across midnight
        "Time;T (K)\n09:00:00;1\n09:00:30;2\n09:01:00;3\n",
    ],
)
def test_direct_import_and_wizard_agree(tmp_path: Path, rows: str) -> None:
    direct, wizard = _both(_write(tmp_path, rows))
    assert direct.metadata["time_is_clock"] is True
    assert "time_is_datetime" not in direct.metadata
    assert wizard.metadata["time_is_clock"] is True
    np.testing.assert_allclose(direct.time, wizard.time, equal_nan=True)
    assert direct.labels == wizard.labels and direct.units == wizard.units
    for key in ("x_column_name", "x_column_unit", "time_columns", "notes"):
        assert direct.metadata.get(key) == wizard.metadata.get(key), key
    np.testing.assert_allclose(direct.values, wizard.values, equal_nan=True)
    assert x_axis_kind(direct.metadata, None, direct.time).is_clock
    assert x_axis_kind(wizard.metadata, None, wizard.time).is_clock


def test_values_are_seconds_since_midnight_and_blank_is_nan(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "Time,v\n09:00:00,1\n,2\n09:01:00.5,3\n"))
    expected = [9 * 3600.0, math.nan, 9 * 3600.0 + 60.5]
    np.testing.assert_allclose(ds.time, expected, equal_nan=True)
    assert ds.metadata["x_column_name"] == "Time"
    assert ds.metadata["x_column_unit"] == "s"


def test_midnight_wrap_unwraps_like_the_wizard(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "Time,v\n23:59:58,1\n23:59:59,2\n00:00:00,3\n"))
    np.testing.assert_array_equal(ds.time, [86398.0, 86399.0, 86400.0])
    assert ds.metadata["notes"] == ["Time: unwrapped across midnight (1 day added)"]


def test_ambiguous_hour_minute_column_stays_an_index_both_paths(tmp_path: Path) -> None:
    direct, wizard = _both(_write(tmp_path, "Dilution,v,w\n1:10,1,4\n1:20,2,5\n1:50,3,6\n"))
    assert "time_is_clock" not in direct.metadata
    assert direct.metadata["x_column_name"] == "Sample Index"
    assert "time_is_clock" not in wizard.metadata


def test_an_hour_minute_column_under_a_time_header_is_a_clock(tmp_path: Path) -> None:
    direct, wizard = _both(_write(tmp_path, "Time,v\n12:30,1\n12:31,2\n"))
    assert direct.metadata["time_is_clock"] and wizard.metadata["time_is_clock"]
    np.testing.assert_allclose(direct.time, [45000.0, 45060.0])


def test_duration_over_a_day_is_not_a_clock_in_direct_import(tmp_path: Path) -> None:
    """``25:00:00`` is an [h]:mm:ss duration: direct import keeps today's
    reading (text, a 1..N index); the wizard still offers it as seconds."""
    direct, wizard = _both(_write(tmp_path, "Time,v\n25:00:00,1\n26:00:00,2\n"))
    assert "time_is_clock" not in direct.metadata
    assert direct.metadata["x_column_name"] == "Sample Index"
    assert "time_is_clock" not in wizard.metadata
    np.testing.assert_allclose(wizard.time, [90000.0, 93600.0])


def test_stray_text_keeps_the_column_text(tmp_path: Path) -> None:
    rows = "Time,v,w\n09:00:00,1,1\n09:00:01,2,1\n09:00:02,3,1\n09:00:03,4,1\nlater,5,1\n"
    direct, wizard = _both(_write(tmp_path, rows))
    assert "time_is_clock" not in direct.metadata
    assert wizard.metadata["time_is_clock"] is True  # the wizard's broader proposal, unchanged


def test_wizard_proposal_is_broader_than_direct_import(tmp_path: Path) -> None:
    """Direct import has no confirmation step, so it needs the strict rule; the
    wizard's proposal is unchanged: a header-less zero-padded ``HH:MM`` column
    is proposed as clock there and stays text (a 1..N index) in direct import."""
    rows = "t,v,w\n09:10,1,4\n09:20,2,5\n09:30,3,6\n"
    path = _write(tmp_path, rows)
    assert guess_settings(rows).time_formats == ["clock", None, None]
    direct, wizard = _both(path)
    assert wizard.metadata["time_is_clock"] is True
    assert "time_is_clock" not in direct.metadata
    assert direct.metadata["x_column_name"] == "Sample Index"


def test_date_column_is_still_a_date(tmp_path: Path) -> None:
    rows = "Time,v\n2026-01-01 09:00:00,1\n2026-01-01 09:00:01,2\n"
    ds = import_csv(_write(tmp_path, rows))
    assert ds.metadata["time_is_datetime"] is True
    assert "time_is_clock" not in ds.metadata


def test_upload_route_and_wizard_give_the_same_clock_axis() -> None:
    """The route a dropped file takes, compared with the wizard, down to the
    X axis kind the Clock tick mode reads."""
    rows = "Time,v\n09:00:00,1\n09:00:30,2\n"
    res = TestClient(app).post(
        "/api/parsers/upload", files={"file": ("log.csv", rows.encode(), "text/csv")}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    wizard = parse_import(rows, guess_settings(rows))
    assert body["time"] == [32400.0, 32430.0] == list(wizard.time)
    assert x_axis_kind(body["metadata"], None, body["time"]).is_clock
    assert x_axis_kind(wizard.metadata, None, wizard.time).is_clock
