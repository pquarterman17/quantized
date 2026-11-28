"""A calendar X axis exports with the screen's round ticks (acceptance 10 C4).

Shares ``tests/fixtures/wire/date_ticks.json`` with the screen test
(``frontend/src/lib/dateTicksFixture.test.ts``), whose ticks come from a real
uPlot instance. The SVG used to put them at matplotlib's numeric multiples
(09:03, 10:26) where the screen showed 09:00 and 12:00.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from quantized.calc.date_ticks import date_tick_values
from quantized.calc.figure_ticks import axis_tick_formatter

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "date_ticks.json"
CASES = json.loads(FIXTURE.read_text("utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_the_export_ticks_where_the_screen_does(case: dict[str, Any]) -> None:
    formatter: Any = axis_tick_formatter({"mode": case["mode"], "digits": 2})
    lo, hi, px, font = case["lo"], case["hi"], case["plot_px"], case["font_px"]
    ticks = date_tick_values(lo, hi, px, font, formatter.text)
    assert ticks == pytest.approx(case["ticks"], abs=1e-3)
    labels = [formatter.text(t, ticks[1] - ticks[0]) for t in ticks]
    assert any(":" in lbl for lbl in labels) is case["clock"], labels


def test_a_real_figure_ticks_on_round_times(monkeypatch: pytest.MonkeyPatch) -> None:
    """Half-hourly data from 09:03: every exported label is on the half hour, never 09:03."""
    from test_export_date_x_axis import _axes, _body, _labels

    t0 = 1772355780.0  # 2026-03-01 09:03 UTC
    body = _body({"time_is_datetime": True})
    body["dataset"]["time"] = [t0 + 1800.0 * i for i in range(17)]
    body["dataset"]["values"] = [[float(i)] for i in range(17)]
    labels = _labels(_axes(monkeypatch, body))
    assert labels and all(lbl.endswith((":00", ":30")) for lbl in labels), labels
