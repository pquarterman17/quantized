"""A date-only timestamp X exports as dates, not "00:00" ticks (acceptance 6 C5).

Shares ``tests/fixtures/wire/date_only_x.json`` with the screen test
(``frontend/src/lib/dateOnly.fixture.test.ts``); the CSV export uses the same
rule (``io/table_export._date_only``)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from quantized.calc.axis_categories import x_axis_kind
from quantized.calc.axis_dates import date_aware_x_fmt, is_date_only
from quantized.calc.figure_ticks import axis_tick_formatter

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "date_only_x.json"
CASES = json.loads(FIXTURE.read_text("utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_the_export_follows_the_shared_rule(case: dict[str, Any]) -> None:
    time = [float("nan") if t is None else t for t in case["time"]]
    assert is_date_only(time) is case["date_only"]
    kind = x_axis_kind({"time_is_datetime": True}, None, time)
    assert kind.is_datetime and kind.is_date_only is case["date_only"]
    fmt = date_aware_x_fmt({"mode": "auto", "digits": 2}, True, False, kind.is_date_only)
    assert fmt is not None and fmt["mode"] == ("date" if case["date_only"] else "datetime")
    if case["tick"]:
        formatter: Any = axis_tick_formatter(fmt)
        assert formatter.text(time[0], 86400.0) == case["tick"]


def test_an_explicit_format_and_a_numeric_x_are_untouched() -> None:
    fixed = {"mode": "fixed", "digits": 1}
    assert date_aware_x_fmt(fixed, True, False, True) == fixed
    kind = x_axis_kind({}, None, [0.0, 86400.0])
    assert not kind.is_datetime and not kind.is_date_only
    assert x_axis_kind({"time_is_datetime": True}, 2, [0.0]).is_date_only is False


def test_a_date_only_figure_has_no_clock_in_its_ticks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Through the real figure route: a week of midnights draws plain dates."""
    from test_export_date_x_axis import _axes, _body, _labels

    t0 = 1709769600.0
    body = _body({"time_is_datetime": True})
    body["dataset"]["time"] = [t0 + 86400.0 * i for i in range(7)]
    body["dataset"]["values"] = [[float(i)] for i in range(7)]
    labels = _labels(_axes(monkeypatch, body))
    assert labels and all(lbl.startswith("2024-03-") and ":" not in lbl for lbl in labels), labels
    body["dataset"]["time"][3] += 3600.0  # one time of day: back to date + time
    labels = _labels(_axes(monkeypatch, body))
    assert labels and all(":" in lbl for lbl in labels), labels
