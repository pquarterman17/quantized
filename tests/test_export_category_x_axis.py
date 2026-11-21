"""A text (category) X axis exports as its labels at positions 1..N, as the
screen draws it (A1b follow-up; ``lib/categoricalTicks.ts`` is the twin).

Synthetic data only.
"""

from __future__ import annotations

from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.axis_categories import category_aware_x_fmt, x_axis_kind, x_category_labels
from quantized.calc.figure_category_ticks import CategoryFormatter, category_step
from quantized.calc.plotting import build_series
from quantized.datastruct import DataStruct

client = TestClient(app)
_CATS = ["low", "mid", "high", "max"]


def _axes(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1].axes[0]


def _body(metadata: dict[str, Any], n: int = 4, **extra: Any) -> dict[str, Any]:
    return {
        "dataset": {
            "time": [float(i + 1) for i in range(n)],
            "values": [[2.0 * i] for i in range(n)],
            "labels": ["Y"],
            "units": [""],
            "metadata": metadata,
        },
        "y_keys": [0],
        "fmt": "svg",
        **extra,
    }


def _labels(ax: Any) -> list[tuple[float, str]]:
    ax.figure.canvas.draw()
    ticks = ax.get_xticklabels()
    return [(float(t.get_position()[0]), t.get_text()) for t in ticks if t.get_text()]


def test_export_labels_the_integer_positions_with_the_text(monkeypatch: pytest.MonkeyPatch) -> None:
    ax = _axes(monkeypatch, _body({"x_category_labels": _CATS}))
    assert _labels(ax) == [(1.0, "low"), (2.0, "mid"), (3.0, "high"), (4.0, "max")]


def test_a_numeric_x_and_a_channel_x_are_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    plain = _labels(_axes(monkeypatch, _body({})))
    assert not any(lbl in _CATS for _, lbl in plain)
    chan = _body({"x_category_labels": _CATS}, x_key=0)
    chan["dataset"]["values"] = [[float(i), 1.0] for i in range(4)]
    chan["dataset"]["labels"] = ["A", "B"]
    chan["dataset"]["units"] = ["", ""]
    chan["y_keys"] = [1]
    assert not any(lbl in _CATS for _, lbl in _labels(_axes(monkeypatch, chan)))


def test_a_long_list_is_thinned_so_labels_do_not_overlap(monkeypatch: pytest.MonkeyPatch) -> None:
    names = [f"category-{i:02d}" for i in range(60)]
    ax = _axes(monkeypatch, _body({"x_category_labels": names}, n=60))
    shown = _labels(ax)
    assert 2 <= len(shown) < 30
    steps = {round(b[0] - a[0]) for a, b in zip(shown, shown[1:], strict=False)}
    assert len(steps) == 1 and steps.pop() > 1
    assert all(lbl == names[int(x) - 1] for x, lbl in shown)


def test_step_is_the_screens_step_for_the_same_geometry() -> None:
    """Twin of ``categoricalTicks.test.ts`` ("matches the export's step"):
    40 labels "c0".."c39", 12-unit font, 300 units across 40 categories ->
    slot 29.6 over a 7.5 pitch -> every 4th. uPlot's own 1-2-5 increment
    (5) used to make the screen draw every 5th."""
    labels = [f"c{i}" for i in range(40)]
    assert category_step(labels, 300.0, 12.0, 40.0) == 4
    assert category_step(labels, 300.0, 12.0, 20.0) == 2  # a zoomed view thins less


def test_the_export_step_follows_the_axis_range_set_after_the_format(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    names = [f"category-{i:02d}" for i in range(60)]
    full = _labels(_axes(monkeypatch, _body({"x_category_labels": names}, n=60)))
    zoom = _labels(
        _axes(
            monkeypatch, _body({"x_category_labels": names}, n=60, overrides={"x_lim": [0.5, 10.5]})
        )
    )
    step = lambda shown: round(shown[1][0] - shown[0][0])  # noqa: E731
    assert step(zoom) < step(full)


def test_formatter_blanks_fractional_and_out_of_range_ticks() -> None:
    f = CategoryFormatter(_CATS, 1)
    assert [f(v) for v in (1.0, 2.5, 4.0, 0.0, 5.0)] == ["low", "", "max", "", ""]
    assert category_step(["a"] * 4, 400.0, 10.0) == 1
    assert category_step(["x" * 20] * 40, 300.0, 10.0) > 1


def test_the_rule() -> None:
    assert x_category_labels({"x_category_labels": ["a", "b"]}, None) == ["a", "b"]
    assert x_category_labels({"x_category_labels": ["a", "b"]}, 0) is None
    assert x_category_labels({}, None) is None
    assert category_aware_x_fmt({"mode": "fixed", "digits": 2}, ["a"]) == {
        "mode": "category",
        "digits": 2,
        "labels": ["a"],
        "base": 1,
    }
    assert category_aware_x_fmt({"mode": "fixed", "digits": 2}, None) == {
        "mode": "fixed",
        "digits": 2,
    }
    assert x_axis_kind({"time_is_datetime": True}, None).is_datetime


def test_labels_apply_only_while_x_is_still_the_category_axis() -> None:
    """A derived dataset (FFT, resample, transpose) that copied the source
    metadata has another X: its labels would mislabel it, so it draws numbers."""
    md = {"x_category_labels": ["a", "b", "c"]}
    assert x_category_labels(md, None, [1.0, 2.0, 3.0]) == ["a", "b", "c"]
    assert x_category_labels(md, None, [1.0, 3.0, float("nan")]) == ["a", "b", "c"]  # row subset
    assert x_category_labels(md, None, [0.0, 0.5, 1.0]) is None  # an FFT frequency axis
    assert x_category_labels(md, None, [1.5, 2.5]) is None  # bin centres
    assert x_category_labels(md, None, [1.0, 4.0]) is None  # beyond the labels
    assert x_axis_kind(md, None, [0.0, 1.0]).categories is None


def test_an_unrecovered_text_x_titles_nothing_not_row() -> None:
    md = {"x_category_labels": ["a", "b"], "x_column_name": "", "x_column_long": "Row"}
    ds = DataStruct.create([1.0, 2.0], [[1.0], [2.0]], labels=["y"], metadata=md)
    assert build_series(ds).x_label == ""
    derived = DataStruct.create([0.0, 0.5], [[1.0], [2.0]], labels=["y"], metadata=md)
    assert build_series(derived).x_label == "Row"  # not a category axis: placeholder stays
    named = DataStruct.create(
        [1.0, 2.0],
        [[1.0], [2.0]],
        labels=["y"],
        metadata={**md, "x_column_name": "A", "x_column_long": "Month"},
    )
    assert build_series(named).x_label == "Month"
