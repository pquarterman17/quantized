"""Time-only columns in the Import Wizard (`io._time_of_day`): detection,
each per-column format, midnight unwrap, malformed cells, units/labels, the
settings wire shape, saved filters, and that direct import is unchanged."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest

from quantized.io import _time_of_day as tod
from quantized.io.delimited import import_csv
from quantized.io.import_filters import ImportFilter, load_filters, save_filter
from quantized.io.import_preview import (
    ImportSettings,
    guess_settings,
    parse_import,
    preview_import,
)

_LOG = "Time,Temp (K)\n23:59:58,1\n23:59:59,2\n00:00:00,3\n00:00:01.5,4\n"


@pytest.fixture(autouse=True)
def isolated_config_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QZ_CONFIG_DIR", str(tmp_path / "qzconfig"))


def _with(settings: ImportSettings, **over: object) -> ImportSettings:
    return ImportSettings.from_dict({**settings.to_dict(), **over})


# ── parsing single cells ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        ("12:30", (45000.0, False)),
        ("12:30:01", (45001.0, False)),
        ("12:30:01.250", (45001.25, False)),
        ("0:00:00", (0.0, False)),
        ("1:05 PM", (13 * 3600 + 300.0, False)),
        ("1:05pm", (13 * 3600 + 300.0, False)),
        ("12:00 AM", (0.0, False)),
        ("12:00:30 p.m.", (12 * 3600 + 30.0, False)),
        ("27:15:00", (27 * 3600 + 900.0, True)),  # [h]:mm:ss duration
        ("24:00:00", (86400.0, False)),  # a logger's end-of-day mark is a clock time
        ("24:00", (86400.0, False)),
        ("24:00:01", (86401.0, True)),
        ("100:00:00", (360000.0, True)),
    ],
)
def test_parse_time_of_day_accepts_clock_and_duration_spellings(
    token: str, expected: tuple[float, bool]
) -> None:
    assert tod.parse_time_of_day(token) == expected


@pytest.mark.parametrize(
    "token",
    ["12:60", "12:30:61", "13:00 PM", "0:30 AM", "25:00 PM", "12.5", "1:2", "abc",
     "2026-01-01 12:30:00", "012:30", ""],
)
def test_parse_time_of_day_refuses_everything_else(token: str) -> None:
    assert tod.parse_time_of_day(token) is None


# ── detection ───────────────────────────────────────────────────────────────


def test_detection_finds_clock_duration_and_ignores_numbers_and_dates() -> None:
    rows = [
        ["12:00:00", "1", "25:00:00", "2026-01-01T00:00:00", "a"],
        ["12:00:01", "2", "1:00:00", "2026-01-01T00:00:01", "b"],
        ["", "3", "n/a", "2026-01-01T00:00:02", "c"],  # missing cells do not count against
    ]
    assert tod.time_column_kinds(rows, 5) == ["clock", None, "duration", None, None]


def test_detection_needs_80_percent_time_cells() -> None:
    four_of_five = [["1:00"], ["2:00"], ["3:00"], ["4:00"], ["x"]]
    three_of_five = [["1:00"], ["2:00"], ["3:00"], ["y"], ["x"]]
    assert tod.time_column_kinds(four_of_five, 1) == ["clock"]
    assert tod.time_column_kinds(three_of_five, 1) == [None]


# ── the wizard's guess and each format ─────────────────────────────────────


def test_a_day_ending_at_24_00_is_still_a_clock_column() -> None:
    assert tod.time_column_kinds([["23:59:00"], ["24:00:00"]], 1) == ["clock"]


def test_ratio_like_columns_are_offered_but_not_turned_into_an_axis() -> None:
    """``1:10`` could be a dilution or a score: detected (the choice is
    offered), proposed as text, so the guess keeps it a label."""
    text = "Dilution,Signal\n1:10,0.5\n1:20,0.3\n1:50,0.1\n"
    s = guess_settings(text)
    assert s.time_formats == ["text", None]
    assert s.roles == ["label", "x"]
    assert preview_import(text, s)["columns"][0]["time_kind"] == "clock"
    padded = "t,v\n09:10,1\n09:20,2\n"
    assert guess_settings(padded).time_formats == ["text", None]  # no header says time
    named = "Time,v\n09:10,1\n09:20,2\n"
    assert guess_settings(named).time_formats == ["clock", None]
    assert guess_settings("t,v\n1:10 PM,1\n1:20 PM,2\n").time_formats == ["clock", None]


def test_guess_proposes_time_of_day_and_makes_the_column_x() -> None:
    s = guess_settings(_LOG)
    assert s.time_formats == ["clock", None]
    assert s.roles == ["x", "y"]


def test_clock_format_unwraps_across_midnight_and_marks_the_axis() -> None:
    ds = parse_import(_LOG, guess_settings(_LOG))
    np.testing.assert_array_equal(ds.time, [86398.0, 86399.0, 86400.0, 86401.5])
    assert ds.metadata["time_is_clock"] is True
    assert "time_is_datetime" not in ds.metadata
    assert ds.metadata["x_column_name"] == "Time"
    assert ds.metadata["x_column_unit"] == "s"
    assert ds.labels == ("Temp",) and ds.units == ("K",)
    assert ds.metadata["time_columns"] == {"Time": "clock"}
    assert "Time: unwrapped across midnight (1 day added)" in ds.metadata["notes"]


def test_seconds_format_is_seconds_since_midnight_without_the_clock_axis() -> None:
    s = _with(guess_settings(_LOG), time_formats=["seconds", None], unwrap_midnight=False)
    ds = parse_import(_LOG, s)
    np.testing.assert_array_equal(ds.time, [86398.0, 86399.0, 0.0, 1.5])
    assert "time_is_clock" not in ds.metadata
    assert ds.metadata["x_column_unit"] == "s"
    assert "notes" not in ds.metadata


def test_elapsed_format_starts_at_zero_and_crosses_midnight() -> None:
    ds = parse_import(_LOG, _with(guess_settings(_LOG), time_formats=["elapsed", None]))
    np.testing.assert_array_equal(ds.time, [0.0, 1.0, 2.0, 3.5])
    assert "time_is_clock" not in ds.metadata


def test_elapsed_counts_from_the_first_valid_row() -> None:
    text = "t,v\nbad,0\n10:00:00,1\n10:00:30,2\n10:01:00,3\n10:01:30,4\n"
    s = guess_settings(text)
    ds = parse_import(text, _with(s, time_formats=["elapsed", None], roles=["x", "y"]))
    assert math.isnan(ds.time[0])
    np.testing.assert_array_equal(ds.time[1:], [0.0, 30.0, 60.0, 90.0])


def test_text_format_keeps_todays_reading() -> None:
    s = _with(guess_settings(_LOG), time_formats=["text", None], roles=["label", "y"])
    ds = parse_import(_LOG, s)
    assert ds.metadata["text_columns"]["Time"][0] == "23:59:58"
    assert "time_columns" not in ds.metadata and "time_is_clock" not in ds.metadata


def test_a_time_y_channel_is_seconds_with_unit_s() -> None:
    text = "Run,Start (hh:mm:ss)\n1,08:00:00\n2,08:15:30\n"
    s = guess_settings(text)
    assert s.roles == ["x", "y"]
    ds = parse_import(text, s)
    np.testing.assert_array_equal(ds.values[:, 0], [28800.0, 29730.0])
    assert ds.labels == ("Start",) and ds.units == ("s",)
    assert "time_is_clock" not in ds.metadata  # the clock axis is an X property


def test_duration_column_reads_as_seconds_even_when_clock_is_asked() -> None:
    text = "Elapsed,V\n23:00:00,1\n25:30:00,2\n"
    s = guess_settings(text)
    assert s.time_formats == ["seconds", None]
    ds = parse_import(text, _with(s, time_formats=["clock", None]))
    np.testing.assert_array_equal(ds.time, [82800.0, 91800.0])
    assert "time_is_clock" not in ds.metadata


def test_unsorted_times_are_not_unwrapped_and_say_so() -> None:
    text = "Time,v\n10:00,1\n09:00,2\n23:00,3\n01:00,4\n"
    ds = parse_import(text, guess_settings(text))
    np.testing.assert_array_equal(ds.time, [36000.0, 32400.0, 82800.0, 3600.0])
    assert any("not in ascending order" in n for n in ds.metadata["notes"])


def test_multi_day_log_adds_one_day_per_wrap() -> None:
    text = "Time,v\n22:00,1\n02:00,2\n12:00,3\n23:00,4\n01:00,5\n"
    ds = parse_import(text, guess_settings(text))
    np.testing.assert_array_equal(
        ds.time, [79200.0, 93600.0, 129600.0, 169200.0, 176400.0]
    )
    assert ds.metadata["notes"] == ["Time: unwrapped across midnight (2 days added)"]


def test_malformed_cells_are_nan_and_named_in_the_notes() -> None:
    text = "t,v\n10:00:00,1\n10:00:01,2\n10:00:02,3\n10:00:03,4\n25:61,5\n"
    s = guess_settings(text)
    assert s.time_formats == ["text", None]  # a stray cell: proposed as text, never guessed
    ds = parse_import(text, _with(s, time_formats=["clock", None], roles=["x", "y"]))
    assert math.isnan(ds.time[-1])
    np.testing.assert_array_equal(ds.time[:4], [36000.0, 36001.0, 36002.0, 36003.0])
    assert any("25:61" in n for n in ds.metadata["notes"])


# ── preview payload ─────────────────────────────────────────────────────────


def test_preview_reports_kind_and_format_only_on_time_columns() -> None:
    pv = preview_import(_LOG, guess_settings(_LOG))
    time_col, temp_col = pv["columns"]
    assert (time_col["time_kind"], time_col["time_format"], time_col["unit"]) == (
        "clock", "clock", "s",
    )
    assert "time_kind" not in temp_col and "time_format" not in temp_col
    assert pv["rows"][2] == [86400.0, 3.0]


def test_preview_with_text_format_shows_no_numbers_for_the_column() -> None:
    pv = preview_import(_LOG, _with(guess_settings(_LOG), time_formats=["text", None]))
    assert pv["columns"][0]["time_format"] == "text"
    assert pv["columns"][0]["unit"] == ""
    assert pv["rows"][0][0] is None


# ── settings wire shape and persistence ────────────────────────────────────


def test_defaults_keep_the_pre_option_wire_shape() -> None:
    d = ImportSettings().to_dict()
    assert "time_formats" not in d and "unwrap_midnight" not in d


def test_time_formats_round_trip_and_fail_closed() -> None:
    s = ImportSettings.from_dict({"time_formats": ["elapsed", None], "unwrap_midnight": False})
    assert s.to_dict()["time_formats"] == ["elapsed", None]
    assert s.to_dict()["unwrap_midnight"] is False
    junk = ImportSettings.from_dict({"time_formats": ["hours", 3, None], "unwrap_midnight": 0})
    assert junk.time_formats == ["text", "text", None]
    assert junk.unwrap_midnight is True  # only an explicit false turns it off
    assert ImportSettings.from_dict({"time_formats": "clock"}).time_formats is None


def test_settings_without_formats_keep_text_when_roles_are_recorded() -> None:
    """A filter saved before the option: its time column stays text."""
    old = {"delimiter": ",", "header_line": 0, "data_start_line": 1,
           "column_names": ["Time", "Temp"], "roles": ["label", "y"]}
    ds = parse_import(_LOG, ImportSettings.from_dict(old))
    assert ds.metadata["text_columns"]["Time"][2] == "00:00:00"
    assert "time_columns" not in ds.metadata


def test_saved_filter_keeps_the_format_choice() -> None:
    s = _with(guess_settings(_LOG), time_formats=["elapsed", None], unwrap_midnight=False)
    save_filter(ImportFilter(name="log", glob="*.log", settings=s))
    (loaded,) = load_filters()
    assert loaded.settings.time_formats == ["elapsed", None]
    assert loaded.settings.unwrap_midnight is False
    ds = parse_import(_LOG, loaded.settings)
    assert ds.metadata["import_settings"]["time_formats"] == ["elapsed", None]


def test_direct_import_reads_the_same_clock_axis_as_the_wizard(tmp_path: Path) -> None:
    path = tmp_path / "log.csv"
    path.write_text(_LOG)
    ds = import_csv(path)
    assert ds.metadata["time_is_clock"] is True
    assert ds.metadata["time_columns"] == {"Time": "clock"}


def test_wizard_routes_carry_the_choice_over_the_wire() -> None:
    from fastapi.testclient import TestClient

    from quantized.app import app

    client = TestClient(app)
    guess = client.post("/api/import/guess", json={"text": _LOG}).json()
    assert guess["time_formats"] == ["clock", None]
    settings = {**guess, "time_formats": ["elapsed", None]}
    body = client.post("/api/import/parse", json={"text": _LOG, "settings": settings}).json()
    assert body["time"] == [0.0, 1.0, 2.0, 3.5]
    assert body["metadata"]["time_columns"] == {"Time": "elapsed"}
