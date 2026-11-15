"""Screen == export ticks through the hint -- the BACKEND half (audit 6 lane
L, reviews H2 / M2 / N2-N5 / N7).

``frontend/src/lib/tickHintFixture.test.ts`` draws each case on a real uPlot
canvas and records its majors beside the request Stage Export sends
(``*_step_hint`` = the drawn increments, no typed steps). Here each request
renders at its own size: an axis marked ``"screen"`` must draw the canvas'
majors (the hint fit the laid-out axes, ``calc.tick_hint.hint_fits``); one
marked ``"auto"`` must fall back to matplotlib's own spacing -- on X with at
least three ticks, the screen's X rule -- and warn. The "default style at
3.4x2.6 in" cases are the negative control; the real ``aps`` preset keeps
the screen's ticks.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.ticker import AutoLocator, MaxNLocator

from quantized.app import app
from quantized.calc.figure_tick_hint import HintLocator
from quantized.calc.figure_warnings import collect_figure_warnings
from quantized.calc.tick_hint import TickHint, hint_fits, step_or_hint

client = TestClient(app)
CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "tick_hint.json").read_text("utf-8")
)["cases"]


def _render(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> tuple[Any, list[str]]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1], json.loads(r.headers.get("X-Figure-Warnings", "[]"))


def _majors(axis: Any) -> list[float]:
    lo, hi = sorted(axis.get_view_interval())
    tol = 1e-9 * (hi - lo)
    return [float(t) for t in axis.get_majorticklocs() if lo - tol <= t <= hi + tol]


def _twin(fig: Any) -> Any:
    main = fig.axes[0]
    return next(a for a in fig.axes[1:] if a.bbox.bounds == main.bbox.bounds)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_export_takes_the_screen_ticks_only_where_they_fit(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig, warnings = _render(monkeypatch, case["request"])
    main = fig.axes[0]
    axes = {"x": main.xaxis, "y": main.yaxis}
    if case["request"].get("y2_keys"):
        axes["y2"] = _twin(fig).yaxis
    for name, want in case["expect"].items():
        axis = axes[name]
        got = _majors(axis)
        if want == "screen":
            tol = 1e-12 + 1e-9 * abs(got[-1])
            np.testing.assert_allclose(got, case["canvas"][name], rtol=0, atol=tol)
        else:
            fallback = (
                MaxNLocator("auto", steps=[1, 2, 2.5, 5, 10], min_n_ticks=3)
                if name == "x" else AutoLocator()
            )
            fallback.set_axis(axis)
            lo, hi = sorted(axis.get_view_interval())
            want_ticks = [t for t in fallback.tick_values(lo, hi) if lo <= t <= hi]
            assert got == pytest.approx(want_ticks), name
            assert len(got) >= (3 if name == "x" else 2), got
            assert any(w.startswith(f"{name.upper()} ticks re-spaced") for w in warnings), warnings
    if all(v == "screen" for v in case["expect"].values()):
        assert not any("re-spaced" in w for w in warnings), warnings


# -- the rule ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("lo", "hi", "hint", "space", "fits"),
    [
        (37, 211, 20, 12, True),  # 9 intervals on a 9-bin axis
        (37, 211, 20, 7, False),  # ... on a 7-bin axis: 9 > 7 + 1
        (37, 211, 20, 8, True),  # one interval of slack
        (0, 0.0105, 0.0005, 11, False),  # the 0.34.0 crowding: 21 intervals
        (0, 10, 5, 0, True),  # tick space clipped up to one bin: 2 <= 1 + 1
        (0, 10, 2.5, 0, False),  # 4 > 1 + 1
        (5, 5, 1, 9, False),  # no span
        # N2: a hint at or above the span leaves under two ticks.
        (37, 60, 50, 9, False),  # one tick (50)
        (37, 60, 30, 9, False),  # one tick (60)
        (37, 60, 23, 9, False),  # 46 only
        (40, 60, 20, 9, True),  # both ends are ticks
        (37, 60, 1e30, 9, False),  # none
        (37, 60, 1e308, 9, False),  # none, and no overflow
        (37, 60, 5e-324, 9, False),  # an absurd count, no overflow
        (-1e300, 1e300, 1e-10, 9, False),
    ],
)
def test_hint_fits(lo: float, hi: float, hint: float, space: int, fits: bool) -> None:
    assert hint_fits(lo, hi, hint, space) is fits


def test_a_typed_step_wins_and_a_bad_hint_is_dropped() -> None:
    assert step_or_hint(2.0, 5.0) == 2.0 and not isinstance(step_or_hint(2.0, 5.0), TickHint)
    assert isinstance(step_or_hint(None, 5.0), TickHint)
    assert step_or_hint(None, 0.0) is None and step_or_hint(None, float("nan")) is None


# -- the locator's warning --------------------------------------------------


class _Axis:
    """Just what HintLocator asks of an axis: a tick space that a later
    layout pass may change."""

    def __init__(self, space: int) -> None:
        self.space = space

    def get_tick_space(self) -> int:
        return self.space

    def get_view_interval(self) -> tuple[float, float]:
        return (37.0, 211.0)


def _locator(label: str, space: int) -> tuple[HintLocator, _Axis]:
    loc, axis = HintLocator(20, label), _Axis(space)
    loc.axis = axis
    for inner in (loc._multiple, loc._auto):
        inner.axis = axis
    return loc, axis


def test_the_warning_follows_the_last_layout_pass() -> None:
    # Reject (a small pre-layout axes), then accept (the final one): no note.
    with collect_figure_warnings() as notes:
        loc, axis = _locator("X", 4)
        loc.tick_values(37, 211)
        assert len(notes) == 1
        axis.space = 12
        loc.tick_values(37, 211)
    assert notes == []
    # Accept, then reject: the note stays.
    with collect_figure_warnings() as notes:
        loc, axis = _locator("X", 12)
        loc.tick_values(37, 211)
        axis.space = 4
        loc.tick_values(37, 211)
    assert notes == [
        "X ticks re-spaced for the export size: the screen's increment 20 "
        "does not fit this X axis"
    ]


def test_one_axis_accepting_never_retracts_another_axis_warning() -> None:
    """N3: equal hints on two axes, one rejected and one accepted, keep the
    rejected one's warning -- and two panels sharing a label too."""
    with collect_figure_warnings() as notes:
        y, _ = _locator("Y", 4)
        y2, _ = _locator("Y2", 12)
        y.tick_values(37, 211)
        y2.tick_values(37, 211)
    assert [n.split(":")[0] for n in notes] == ["Y ticks re-spaced for the export size"]
    with collect_figure_warnings() as notes:
        a, _ = _locator("X", 4)
        b, _ = _locator("X", 12)
        a.tick_values(37, 211)
        b.tick_values(37, 211)
    assert len(notes) == 1


# -- the route --------------------------------------------------------------


def _body(**extra: Any) -> dict[str, Any]:
    x = list(range(0, 41))
    return {
        "dataset": {
            "time": x, "values": [[v, v / 5] for v in x],
            "labels": ["A", "B"], "units": ["", ""], "metadata": {},
        },
        "y_keys": [0], "fmt": "svg", **extra,
    }


def test_y_and_y2_with_one_hint_warn_for_the_axis_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """N3 at the route: Y spans 0..40 and Y2 0..8 with the same hint 1; Y
    (40+ intervals) is re-spaced and warned, Y2 (8) takes it."""
    fig, warnings = _render(
        monkeypatch,
        _body(y_keys=[0, 1], y2_keys=[1], y_step_hint=1, y2_step_hint=1),
    )
    assert any(w.startswith("Y ticks re-spaced") for w in warnings), warnings
    assert not any(w.startswith("Y2 ") for w in warnings), warnings
    y2 = _majors(_twin(fig).yaxis)
    assert np.diff(y2) == pytest.approx([1.0] * (len(y2) - 1))


def test_a_typed_step_wins_over_a_hint_at_the_route(monkeypatch: pytest.MonkeyPatch) -> None:
    fig, warnings = _render(monkeypatch, _body(x_step=10, x_step_hint=4))
    assert np.diff(_majors(fig.axes[0].xaxis)) == pytest.approx([10.0] * 4)
    assert warnings == []


def test_a_hint_at_or_above_the_span_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    """N2 at the route: x 37..60 with a hint of 50 drew a lone tick."""
    body = _body(overrides={"x_lim": [37, 60]}, x_step_hint=50)
    fig, warnings = _render(monkeypatch, body)
    assert len(_majors(fig.axes[0].xaxis)) >= 3
    assert any(w.startswith("X ticks re-spaced") for w in warnings), warnings


@pytest.mark.parametrize("bad", [-1, 0, float("nan"), float("inf"), 1e308])
@pytest.mark.parametrize("field", ["x_step_hint", "y_step_hint", "y2_step_hint"])
def test_a_bad_hint_is_a_422(field: str, bad: float) -> None:
    """N4: never silently dropped, never an internal overflow message."""
    # Raw JSON: NaN / Infinity literals, as a non-strict client writes them.
    raw = json.dumps(_body(**{field: bad}))
    r = client.post(
        "/api/export/figure", content=raw, headers={"content-type": "application/json"}
    )
    assert r.status_code == 422, r.text
    assert field in r.text


def test_a_null_hint_is_no_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    fig, warnings = _render(monkeypatch, _body(x_step_hint=None, y_step_hint=None))
    assert warnings == []
    assert isinstance(fig.axes[0].xaxis.get_major_locator(), AutoLocator)


@pytest.mark.parametrize(
    "extra",
    [
        {"x_fmt": {"mode": "date", "digits": 0}},
        {"overrides": {"x_breaks": [[10, 20]]}},
    ],
)
def test_a_crafted_x_hint_is_ignored_where_the_client_sends_none(
    monkeypatch: pytest.MonkeyPatch, extra: dict[str, Any]
) -> None:
    _, warnings = _render(monkeypatch, _body(x_step_hint=0.5, **extra))
    assert not any("re-spaced" in w for w in warnings), warnings
