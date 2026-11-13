"""Waterfall legend order -- screen == export, the BACKEND half.

``frontend/src/lib/waterfallLegendWireFixture.test.ts`` builds, from one view,
the export request the window sends AND the legend rows the screen lists (top
trace first under a waterfall, figures audit #19), and pins both as
``tests/fixtures/wire/waterfall_legend.json``. This posts each request to the
real route and reads the matplotlib legend back: its rows must be the screen's,
in the screen's order. Before ``calc.figure_legend_order`` the export listed
handles in draw order -- the bottom curve's name at the top of the legend.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure import render_figure
from quantized.calc.figure_legend_order import (
    LEGEND_TOP_FIRST,
    top_first_order,
    waterfall_legend_rows,
    with_waterfall_legend,
)

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "waterfall_legend.json"


def _fixture() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _saved_figure(monkeypatch: pytest.MonkeyPatch, render: Any) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    render()
    monkeypatch.undo()
    assert kept, "no figure was saved"
    return kept[-1]


def _legend_rows(fig: Any) -> list[str]:
    legends = [ax.get_legend() for ax in fig.axes if ax.get_legend() is not None]
    assert len(legends) == 1, "exactly one legend is drawn"
    return [t.get_text() for t in legends[0].get_texts()]


def _posted(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    def post() -> None:
        r = client.post("/api/export/figure", json=body)
        assert r.status_code == 200, r.text

    return _saved_figure(monkeypatch, post)


@pytest.mark.parametrize("case", ["staggered", "plain"])
def test_the_export_legend_lists_the_screens_rows_in_the_screens_order(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    fx = _fixture()[case]
    assert _legend_rows(_posted(monkeypatch, fx["request"])) == fx["legend"]


def test_the_two_cases_really_differ() -> None:
    """Guards the fixture itself: a stagger must reverse the rows."""
    fx = _fixture()
    assert fx["staggered"]["legend"] == list(reversed(fx["plain"]["legend"]))


def test_a_secondary_axis_series_keeps_its_display_slot(monkeypatch: pytest.MonkeyPatch) -> None:
    """The y2 path rebuilds ONE legend over both axes: the order is by display
    slot across both, not primary-then-secondary."""
    body = dict(_fixture()["staggered"]["request"])
    body["y2_keys"] = [body["y_keys"][1]]
    assert _legend_rows(_posted(monkeypatch, body)) == _fixture()["staggered"]["legend"]


def test_a_group_split_keeps_draw_order(monkeypatch: pytest.MonkeyPatch) -> None:
    """A ``group_col`` request never applies the offsets, so its legend must
    not be reordered by them either."""
    body = {
        "dataset": {
            "time": [0.0, 1.0, 2.0, 3.0],
            "values": [[1.0, 0.0], [2.0, 0.0], [3.0, 1.0], [4.0, 1.0]],
            "labels": ["S", "g"], "units": ["", ""], "metadata": {},
        },
        "y_keys": [0], "group_col": 1, "fmt": "svg",
        "overrides": {"legend": {"show": True}},
    }
    plain = _legend_rows(_posted(monkeypatch, body))
    assert len(plain) == 2
    staggered = _legend_rows(_posted(monkeypatch, {**body, "waterfall_offsets": [0, 5]}))
    assert staggered == plain


def test_broken_axis_legend_follows_the_same_order(monkeypatch: pytest.MonkeyPatch) -> None:
    x = np.linspace(0.0, 10.0, 21)
    series = [("low", x * 0.0), ("mid", x * 0.0 + 1.0), ("top", x * 0.0 + 2.0)]
    ov = with_waterfall_legend({"x_breaks": [[4.0, 6.0]]}, [0.0, 1.0, 2.0])

    def render() -> None:
        render_figure(x, series, fmt="svg", overrides=ov)

    assert _legend_rows(_saved_figure(monkeypatch, render)) == ["top", "mid", "low"]


def test_an_empty_label_has_no_row_and_does_not_shift_the_reversal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Slots, not handle positions: the unlabelled series drops out, and the
    zero-offset overlay column after the stagger keeps its place at the end."""
    x = np.linspace(0.0, 1.0, 5)
    series = [("a", x), ("", x + 1.0), ("c", x + 2.0), ("fit", x)]
    ov = with_waterfall_legend({"legend": {"show": True}}, [0.0, 1.0, 2.0, 0.0])

    def render() -> None:
        render_figure(x, series, fmt="svg", overrides=ov)

    assert _legend_rows(_saved_figure(monkeypatch, render)) == ["c", "a", "fit"]


def test_waterfall_legend_rows_counts_up_to_the_last_lifted_series() -> None:
    assert waterfall_legend_rows(None) == 0
    assert waterfall_legend_rows([]) == 0
    assert waterfall_legend_rows([0, 0, 0]) == 0
    assert waterfall_legend_rows([0, 4, 6]) == 3
    assert waterfall_legend_rows([0, 4, 6, 0, 0]) == 3  # padded overlay columns
    assert waterfall_legend_rows([0, float("nan"), float("inf")]) == 0  # skipped, as the shift is
    assert waterfall_legend_rows([0, None, 2]) == 3


def test_with_waterfall_legend_leaves_an_unstaggered_bag_untouched() -> None:
    bag = {"grid": True}
    assert with_waterfall_legend(bag, None) is bag
    assert with_waterfall_legend(None, [0, 0]) is None
    assert with_waterfall_legend(bag, [0, 2]) == {"grid": True, LEGEND_TOP_FIRST: 2}
    assert bag == {"grid": True}  # never mutated


def test_top_first_order_reverses_only_the_staggered_slots() -> None:
    assert top_first_order([0, 1, 2, 3], 3) == [2, 1, 0, 3]
    assert top_first_order([0, 2, None, 3], 3) == [1, 0, 2, 3]
    assert top_first_order([0, 1], 0) == [0, 1]
