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


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_the_screens_label_width_gives_the_same_ticks(case: dict[str, Any]) -> None:
    """The request carries the width the screen's labels had; the step follows it exactly."""
    formatter: Any = axis_tick_formatter({"mode": case["mode"], "digits": 2})
    ticks = date_tick_values(
        case["lo"],
        case["hi"],
        case["plot_px"],
        case["font_px"],
        formatter.text,
        case["label_chars"],
    )
    assert ticks == pytest.approx(case["ticks"], abs=1e-3)


def test_a_wider_screen_label_widens_the_step_and_a_narrower_one_narrows_it() -> None:
    case = CASES[0]  # an afternoon: the screen stepped 3 h at 19 characters
    formatter: Any = axis_tick_formatter({"mode": case["mode"], "digits": 2})

    def step(chars: int | None) -> float:
        t = date_tick_values(
            case["lo"], case["hi"], case["plot_px"], case["font_px"], formatter.text, chars
        )
        return t[1] - t[0]

    assert step(case["label_chars"]) == 3 * 3600
    assert step(30) == 4 * 3600 and step(8) == 2 * 3600


def test_the_label_width_rides_the_export_request_to_the_ticks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``x_fmt.labelChars`` through the real route: a wide screen label thins the exported ticks."""
    from test_export_date_x_axis import _axes, _body

    t0 = 1772355780.0
    def ticks(extra: dict[str, Any]) -> list[float]:
        body = _body({"time_is_datetime": True}, **extra)
        body["dataset"]["time"] = [t0 + 1800.0 * i for i in range(17)]
        body["dataset"]["values"] = [[float(i)] for i in range(17)]
        return [float(v) for v in _axes(monkeypatch, body).get_xticks()]

    plain = ticks({})
    wide = ticks({"x_fmt": {"mode": "datetime", "digits": 2, "labelChars": 60}})
    assert len(wide) < len(plain)


def test_a_real_figure_ticks_on_round_times(monkeypatch: pytest.MonkeyPatch) -> None:
    """Half-hourly data from 09:03: every exported label is on the half hour, never 09:03."""
    from test_export_date_x_axis import _axes, _body, _labels

    t0 = 1772355780.0  # 2026-03-01 09:03 UTC
    body = _body({"time_is_datetime": True})
    body["dataset"]["time"] = [t0 + 1800.0 * i for i in range(17)]
    body["dataset"]["values"] = [[float(i)] for i in range(17)]
    labels = _labels(_axes(monkeypatch, body))
    assert labels and all(lbl.endswith((":00", ":30")) for lbl in labels), labels
