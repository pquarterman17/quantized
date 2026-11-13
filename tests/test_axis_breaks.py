"""Y-axis breaks -- screen == export, the BACKEND half, plus the render.

``frontend/src/lib/axisBreaksFixture.test.ts`` freezes what the canvas' break
math (``lib/axisBreaks.ts``) answers for a set of cases in
``tests/fixtures/wire/axis_breaks.json``; ``calc.axis_breaks`` must answer the
same. The second half posts a broken-axis request to the real route and reads
the matplotlib axes back: the stretch is elided, no tick sits inside it, the
typed limit / formatter / increment survive, and a log axis is left alone.
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
from quantized.calc.axis_breaks import (
    break_auto_range,
    break_backward,
    break_forward,
    break_gap,
    break_ticks,
    elide,
    normalize_breaks,
    unelide,
)

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "axis_breaks.json"
CASES: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _pairs(case: dict[str, Any]) -> list[tuple[float, float]]:
    return [(float(lo), float(hi)) for lo, hi in case["breaks"]]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_export_math_answers_what_the_canvas_does(case: dict[str, Any]) -> None:
    breaks = _pairs(case)
    gap = break_gap(breaks, *case["data"])
    assert gap == pytest.approx(case["gap"], rel=1e-11)
    samples = case["samples"]
    assert [elide(v, breaks) for v in samples] == pytest.approx(case["elided"], rel=1e-11)
    forward = break_forward(samples, breaks, gap)
    assert forward.tolist() == pytest.approx(case["forward"], rel=1e-11)
    assert break_backward(forward, breaks, gap).tolist() == pytest.approx(
        case["backward"], rel=1e-9, abs=1e-9
    )
    assert break_ticks(*case["view"], breaks, case["step"]) == case["ticks"]
    assert list(break_auto_range(*case["data"], breaks)) == pytest.approx(
        case["autoRange"], rel=1e-11
    )


def test_unelide_inverts_elide_outside_a_break() -> None:
    breaks = [(10.0, 100.0), (120.0, 1000.0)]
    for v in (-5.0, 0.0, 10.0, 105.0, 1001.0, 1500.0):
        assert unelide(elide(v, breaks), breaks) == pytest.approx(v)


def test_normalize_breaks_drops_what_the_canvas_drops() -> None:
    raw = [[100, 200], [1, 2], [150, 300], [5, 5], ["a", 3], [9, float("inf")], [True, 4]]
    assert normalize_breaks(raw) == [(1.0, 2.0), (100.0, 200.0)]
    assert len(normalize_breaks([[1, 2], [2, 3], [3, 4], [4, 5], [5, 6]])) == 4
    assert normalize_breaks(None) == []
    assert normalize_breaks("nope") == []


# ── The render ──────────────────────────────────────────────────────────────


def _body(**extra: Any) -> dict[str, Any]:
    x = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]
    return {
        "dataset": {
            "time": x,
            "values": [[2.0, 1000.0], [4.0, 1002.0], [6.0, 1004.0], [8.0, 1006.0],
                       [10.0, 1008.0], [12.0, 1010.0]],
            "labels": ["low", "high"], "units": ["", ""], "metadata": {},
        },
        "y_keys": [0, 1], "fmt": "svg",
        "y_fmt": {"mode": "auto", "digits": 2, "breaks": [[12, 990]]},
        **extra,
    }


def _axes(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> list[Any]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return list(kept[-1].axes)


def _frac(ax: Any, y: float) -> float:
    """Where data value ``y`` sits up the axes, 0 (bottom) .. 1 (top)."""
    return float(ax.transAxes.inverted().transform(ax.transData.transform((0.0, y)))[1])


def test_the_stretch_is_elided_and_both_clusters_get_room(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (ax,) = _axes(monkeypatch, _body())
    assert ax.get_yscale() == "function"
    # 978 of the 1008 data units are elided: unbroken, the low cluster would
    # be squeezed into the bottom 1% of the frame.
    assert _frac(ax, 12.0) - _frac(ax, 2.0) > 0.25
    assert _frac(ax, 1010.0) - _frac(ax, 1000.0) > 0.25
    # ... and the break itself is a narrow gap.
    assert 0 < _frac(ax, 990.0) - _frac(ax, 12.0) < 0.08
    lo, hi = ax.get_ylim()
    assert (lo, hi) == pytest.approx(break_auto_range(2.0, 1010.0, [(12.0, 990.0)]))


def test_no_tick_sits_inside_the_break_and_marks_are_drawn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (ax,) = _axes(monkeypatch, _body())
    ticks = [float(t) for t in ax.get_yticks()]
    assert ticks == break_ticks(*ax.get_ylim(), [(12.0, 990.0)])
    assert not any(12 < t < 990 for t in ticks)
    assert any(t <= 12 for t in ticks) and any(t >= 990 for t in ticks)
    marks = [ln for ln in ax.lines if ln.get_label() == "_axis_break"]
    assert len(marks) == 1
    assert marks[0].get_ydata().tolist() == [12.0, 990.0]
    legend = ax.get_legend()
    assert legend is not None
    assert [t.get_text() for t in legend.get_texts()] == ["low", "high"]


def test_an_unbroken_request_is_untouched(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _body()
    body["y_fmt"] = {"mode": "auto", "digits": 2}
    (ax,) = _axes(monkeypatch, body)
    assert ax.get_yscale() == "linear"
    assert not [ln for ln in ax.lines if ln.get_label() == "_axis_break"]


def test_a_typed_limit_and_increment_survive_the_break(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _body(y_step=4.0, overrides={"y_lim": [0.0, 1012.0]})
    (ax,) = _axes(monkeypatch, body)
    assert ax.get_ylim() == pytest.approx((0.0, 1012.0))
    assert [float(t) for t in ax.get_yticks()] == break_ticks(0.0, 1012.0, [(12.0, 990.0)], 4.0)


def test_a_typed_limit_at_or_below_zero_survives_the_break(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A broken axis is a matplotlib "function" scale, like the reciprocal one,
    but takes any limit: a typed lower limit of -50 (or 0) is the screen's
    range too, never dropped to auto."""
    (ax,) = _axes(monkeypatch, _body(overrides={"y_lim": [-50.0, 1012.0]}))
    assert ax.get_ylim() == pytest.approx((-50.0, 1012.0))
    body = _body(y2_keys=[1])
    body["y_fmt"] = {"mode": "auto", "digits": 2}
    body["y2_fmt"] = {"mode": "auto", "digits": 2, "breaks": [[1002, 1008]]}
    body["overrides"] = {"y2_lim": [-10.0, 1012.0]}
    _ax, ax2 = _axes(monkeypatch, body)
    assert ax2.get_ylim() == pytest.approx((-10.0, 1012.0))


def test_the_preview_hitmap_reports_the_break_so_a_pixel_inverts_right() -> None:
    """The preview's drag/drop inverts pixels with the hit-map's axes. A broken
    axis still reads ``yscale: "linear"``, so it also reports its breaks and
    gap; the inversion through them lands on the data value that pixel shows
    (``previewmap.pxToData`` does the same in TypeScript)."""
    r = client.post("/api/export/figure-hitmap", json=_body())
    assert r.status_code == 200, r.text
    axes = r.json()["axes"]
    assert axes["yscale"] == "linear"
    assert axes["ybreaks"] == [[12.0, 990.0]]
    breaks, gap = [(12.0, 990.0)], axes["ybreak_gap"]
    assert gap == pytest.approx(break_gap(breaks, 2.0, 1010.0))
    lo, hi = (float(break_forward(v, breaks, gap)) for v in axes["ylim"])
    # The pixel a quarter of the way up the frame, inverted through the break:
    frac = 0.25
    y = float(break_backward(lo + frac * (hi - lo), breaks, gap))
    linear = axes["ylim"][0] + frac * (axes["ylim"][1] - axes["ylim"][0])
    assert y < 12.0 < linear  # the low cluster's range, not the linear guess


def test_the_tick_formatter_survives_the_break(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _body()
    body["y_fmt"] = {"mode": "fixed", "digits": 1, "breaks": [[12, 990]]}
    (ax,) = _axes(monkeypatch, body)
    ax.figure.canvas.draw()
    labels = [t.get_text() for t in ax.get_yticklabels() if t.get_text()]
    assert labels and all(lab.endswith(".0") for lab in labels), labels


def test_a_log_axis_ignores_the_break(monkeypatch: pytest.MonkeyPatch) -> None:
    (ax,) = _axes(monkeypatch, _body(y_scale="log"))
    assert ax.get_yscale() == "log"
    assert not [ln for ln in ax.lines if ln.get_label() == "_axis_break"]


def test_the_x_axis_ignores_a_break_in_its_format(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _body()
    body["x_fmt"] = {"mode": "auto", "digits": 2, "breaks": [[1, 4]]}
    body["y_fmt"] = {"mode": "auto", "digits": 2}
    (ax,) = _axes(monkeypatch, body)
    assert ax.get_xscale() == "linear" and ax.get_yscale() == "linear"


def test_a_secondary_axis_breaks_on_its_own_format(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _body(y2_keys=[1])
    body["y_fmt"] = {"mode": "auto", "digits": 2}
    body["y2_fmt"] = {"mode": "auto", "digits": 2, "breaks": [[1002, 1008]]}
    ax, ax2 = _axes(monkeypatch, body)
    assert ax.get_yscale() == "linear"
    assert ax2.get_yscale() == "function"
    assert not any(1002 < float(t) < 1008 for t in ax2.get_yticks())
    marks = [ln for ln in ax2.lines if ln.get_label() == "_axis_break"]
    assert len(marks) == 1 and marks[0].get_xdata().tolist() == [1.0, 1.0]  # right spine


def test_a_hysteresis_loop_keeps_its_row_order_under_a_break(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-monotonic x: the break changes the y SCALE only, never the data."""
    x = [0.0, 1.0, 2.0, 1.0, 0.0, -1.0, -2.0, -1.0, 0.0]
    y = [0.0, 5.0, 8.0, 1000.0, 1004.0, -3.0, -6.0, 2.0, 0.0]
    body = {
        "dataset": {
            "time": x, "values": [[v] for v in y],
            "labels": ["M"], "units": [""], "metadata": {},
        },
        "y_keys": [0], "fmt": "svg",
        "y_fmt": {"mode": "auto", "digits": 2, "breaks": [[10, 995]]},
    }
    (ax,) = _axes(monkeypatch, body)
    line = next(ln for ln in ax.lines if ln.get_label() != "_axis_break")
    assert np.asarray(line.get_xdata(), dtype=float).tolist() == x
    assert np.asarray(line.get_ydata(), dtype=float).tolist() == y
    assert ax.get_yscale() == "function"


def test_x_and_y_breaks_share_one_broken_y_over_every_panel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review finding: with an X break too, the Y break was applied per panel
    on the shared y -- panel 0's data alone sized it, and the later panel's
    1015..1020 fell off-axis. One break now spans every panel's data, with
    the range the canvas' x-break panels share (break_auto_range over all
    the data; breakPanelYBreak.test.ts on the screen side)."""
    x = [float(v) for v in range(21)]
    y = [v if v < 10 else 1000.0 + v for v in x]
    body = {
        "dataset": {
            "time": x, "values": [[v] for v in y],
            "labels": ["S"], "units": [""], "metadata": {},
        },
        "y_keys": [0], "fmt": "svg",
        "y_fmt": {"mode": "auto", "digits": 2, "breaks": [[15, 995]]},
        "overrides": {"x_breaks": [[5, 15]]},
    }
    axes = _axes(monkeypatch, body)
    assert len(axes) == 2
    want = break_auto_range(0.0, 1020.0, [(15.0, 995.0)])
    for ax in axes:
        assert ax.get_ylim() == pytest.approx(want)
    lo, hi = axes[1].get_ylim()
    assert lo <= 1015.0 and 1020.0 <= hi  # the later panel's data is on-axis
    assert sum(1 for ln in axes[0].lines if ln.get_label() == "_axis_break") == 1
