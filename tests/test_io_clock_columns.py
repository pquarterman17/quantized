"""Every time-of-day column of a direct CSV import (#1214 left a second one as text).

Direct import and the Import Wizard must read the same columns as clocks: a ``Date,Time,Value``
file's Time column, an AM/PM column, and a file with several. Each converted column equals the
wizard's ``clock`` column value for value, unit for unit, note for note."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.io import _time_of_day as tod
from quantized.io.delimited import import_csv
from quantized.io.import_preview import ImportSettings, guess_settings, parse_import


def _channel(ds: DataStruct, label: str) -> np.ndarray:
    return np.asarray(ds.values)[:, ds.labels.index(label)]


def _both(tmp_path: Path, body: str) -> tuple[DataStruct, DataStruct]:
    path = tmp_path / "log.csv"
    path.write_text(body, newline="")
    return import_csv(path), parse_import(body, guess_settings(body))


@pytest.mark.parametrize(
    "cells",
    [
        ["1:05 PM", "11:58 PM"],
        ["12:00 AM", "12:30 pm", "1:05 p.m."],
        ["9:05:00 AM", None, "9:05:30.5 AM"],
        ["01:05PM"],
    ],
)
def test_the_rule_accepts_am_pm_columns(cells: list[str | None]) -> None:
    assert tod.is_clock_column(cells, "Col1")  # AM/PM is evidence enough, as seconds are


@pytest.mark.parametrize("cells", [["13:00 PM"], ["0:30 AM"], ["1:05 PM", "x"], ["1:65 PM"]])
def test_the_rule_refuses_bad_am_pm_cells(cells: list[str | None]) -> None:
    assert not tod.is_clock_column(cells, "Time")


def test_a_second_time_of_day_column_is_read_like_the_wizard(tmp_path: Path) -> None:
    body = (
        "Date,Time,Value\n"
        "2026-01-01,23:59:58,1.5\n2026-01-01,23:59:59,2.5\n2026-01-02,00:00:01,3.5\n"
    )
    direct, wizard = _both(tmp_path, body)
    assert direct.metadata["time_is_datetime"] is True
    assert "Time" in direct.labels  # no longer a text label
    np.testing.assert_allclose(_channel(direct, "Time"), [86398.0, 86399.0, 86401.0])
    np.testing.assert_allclose(_channel(direct, "Time"), _channel(wizard, "Time"))
    np.testing.assert_allclose(_channel(direct, "Value"), [1.5, 2.5, 3.5])
    units = [d.units[d.labels.index("Time")] for d in (direct, wizard)]
    assert units == ["s", "s"]
    assert direct.metadata["time_columns"]["Time"] == wizard.metadata["time_columns"]["Time"]
    assert "Time" not in direct.metadata.get("text_columns", {})
    note = "Time: unwrapped across midnight (1 day added)"
    assert note in direct.metadata["notes"] and note in wizard.metadata["notes"]


def test_every_clock_column_is_read_not_only_the_first(tmp_path: Path) -> None:
    body = "Start,Stop,Value\n09:00:00,09:00:10,1\n09:00:30,09:00:50,2\n09:01:00,09:01:20,3\n"
    direct, wizard = _both(tmp_path, body)
    assert direct.metadata["time_is_clock"] is True
    np.testing.assert_allclose(direct.time, [32400.0, 32430.0, 32460.0])
    np.testing.assert_allclose(_channel(direct, "Stop"), [32410.0, 32450.0, 32480.0])
    np.testing.assert_allclose(_channel(direct, "Stop"), _channel(wizard, "Stop"))
    assert direct.metadata["time_columns"] == wizard.metadata["time_columns"]


def test_an_am_pm_x_column_matches_the_wizard(tmp_path: Path) -> None:
    body = "Time,v\n11:58 AM,1\n12:00 PM,2\n1:05 PM,3\n11:59 PM,4\n"
    direct, wizard = _both(tmp_path, body)
    assert direct.metadata["time_is_clock"] is True and wizard.metadata["time_is_clock"] is True
    expected = [43080.0, 43200.0, 47100.0, 86340.0]
    np.testing.assert_allclose(direct.time, expected)
    np.testing.assert_allclose(wizard.time, expected)
    for key in ("x_column_name", "x_column_unit", "time_columns", "notes"):
        assert direct.metadata.get(key) == wizard.metadata.get(key), key


def test_an_am_pm_column_beside_a_clock_x_column(tmp_path: Path) -> None:
    body = "Time,Local,v\n13:05:00,1:05 PM,1\n13:06:00,1:06 PM,2\n"
    direct, wizard = _both(tmp_path, body)
    np.testing.assert_allclose(_channel(direct, "Local"), [47100.0, 47160.0])
    np.testing.assert_allclose(_channel(direct, "Local"), _channel(wizard, "Local"))


@pytest.mark.parametrize(
    "body",
    [
        "Time,Ratio,v\n09:00:00,1:10,1\n09:00:30,1:20,2\n",  # a ratio is not a clock
        "Time,Note,v\n09:00:00,ok,1\n09:00:30,late,2\n",
        "Time,Mixed,v\n09:00:00,09:00:00,1\n09:00:30,never,2\n",  # one stray cell: stays text
        "Time,Long,v\n09:00:00,25:00:00,1\n09:00:30,26:00:00,2\n",  # a duration over a day
        "Time,Plain,v\n09:00:00,12:30,1\n09:00:30,12:31,2\n",  # no seconds, header names no time
    ],
)
def test_other_text_columns_stay_text(tmp_path: Path, body: str) -> None:
    ds, _ = _both(tmp_path, body)
    assert ds.labels == ("v",), ds.labels
    assert len(ds.metadata["text_columns"]) == 1


def test_a_chosen_data_column_set_still_applies(tmp_path: Path) -> None:
    path = tmp_path / "log.csv"
    path.write_text("Date,Time,Value\n2026-01-01,09:00:00,1\n2026-01-01,09:00:01,2\n")
    ds = import_csv(path, data_columns=["Value"])
    assert ds.labels == ("Value",)


def test_upload_route_reads_the_second_clock_column() -> None:
    """The route a dropped file takes, not only the sniffing helper."""
    body = "Date,Time,Value\n2026-01-01,09:00:00,1\n2026-01-01,09:00:30,2\n"
    res = TestClient(app).post(
        "/api/parsers/upload", files={"file": ("log.csv", body.encode(), "text/csv")}
    )
    assert res.status_code == 200, res.text
    out = res.json()
    k = out["labels"].index("Time")
    assert [row[k] for row in out["values"]] == [32400.0, 32430.0]
    assert out["metadata"]["time_columns"] == {"Time": "clock"}
    assert "Time" not in out["metadata"].get("text_columns", {})
    wizard = parse_import(body, guess_settings(body))
    assert [row[k] for row in out["values"]] == list(_channel(wizard, "Time"))


def test_wizard_settings_object_still_builds() -> None:
    assert ImportSettings().time_formats is None
