"""The arc on the angle measure: its geometry against the shared table
(``tests/fixtures/wire/annotation_measures.json`` ``angle_arc``, the rows
``frontend/src/lib/annotationMeasure.test.ts`` asserts), then the export
drawing it. The arc is an opt-in (``arc: true``): a saved figure without it is
byte-identical to what it was before the option existed."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any
from unittest.mock import patch

import matplotlib
import numpy as np
import pytest

import quantized.calc.figure as fig_mod
from quantized.calc.annotation_measure import angle_arc, angle_arc_points
from quantized.calc.figure import _validate_overrides, render_figure

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "annotation_measures.json").read_text(
        encoding="utf-8"
    )
)["angle_arc"]

_ANGLE = {"kind": "angle", "x1": 2.0, "y1": 2.0, "x2": 8.0, "y2": 2.0, "x3": 4.0, "y3": 8.0}


@pytest.mark.parametrize("c", FIXTURE, ids=lambda c: c["note"][:40])
def test_arc_geometry_matches_the_shared_table(c: dict[str, Any]) -> None:
    got = angle_arc(tuple(c["vertex"]), tuple(c["a"]), tuple(c["b"]))
    if c["radius"] is None:
        assert got is None
    else:
        assert got == pytest.approx((c["radius"], c["start"], c["sweep"]))


def test_arc_points_lie_on_the_circle_between_the_arms() -> None:
    vertex = (10.0, 20.0)
    r, start, sweep = angle_arc(vertex, (13.0, 24.0), (10.0, 60.0)) or (0.0, 0.0, 0.0)
    pts = angle_arc_points(vertex, r, start, sweep)
    assert math.hypot(pts[0][0] - 10, pts[0][1] - 20) == pytest.approx(1.5)
    assert all(math.hypot(x - 10, y - 20) == pytest.approx(1.5) for x, y in pts)
    # starts on the first arm's direction, ends on the second's (straight down)
    assert pts[0] == pytest.approx((10 + 1.5 * 3 / 5, 20 + 1.5 * 4 / 5))
    assert pts[-1] == pytest.approx((10.0, 21.5))
    # no step bigger than the 2-degree cap
    steps = [math.dist(p, q) for p, q in zip(pts, pts[1:], strict=False)]
    assert max(steps) <= 2 * 1.5 * math.sin(math.radians(1.0)) * 1.0001


def _render(shape: dict[str, Any], fmt: str = "svg", capture: bool = True) -> Any:
    x = np.linspace(0.0, 10.0, 11)
    captured: dict[str, Any] = {}

    def grab(fig: Any, *args: Any, **kwargs: Any) -> bytes:
        captured["fig"] = fig
        return b""

    kw: dict[str, Any] = {"fmt": fmt, "overrides": {"shapes": [shape]}}
    if capture:
        with patch.object(fig_mod, "savefig_bytes", grab):
            render_figure(x, [("A", x)], **kw)
        fig = captured["fig"]
        fig.canvas.draw()
        return fig
    return render_figure(x, [("A", x)], **kw)


def test_export_arc_is_the_screen_circle_on_the_smaller_side() -> None:
    fig = _render({**_ANGLE, "arc": True})
    ax = fig.axes[0]
    arc = next(a for a in ax.get_children() if a.get_gid() == "shape:0:arc")
    xs, ys = arc.get_xdata(), arc.get_ydata()
    vx, vy = ax.transData.transform((2.0, 2.0))
    ax_, ay_ = ax.transData.transform((8.0, 2.0))
    bx_, by_ = ax.transData.transform((4.0, 8.0))
    shorter = min(math.hypot(ax_ - vx, ay_ - vy), math.hypot(bx_ - vx, by_ - vy))
    radii = [math.hypot(x - vx, y - vy) for x, y in zip(xs, ys, strict=True)]
    assert radii == pytest.approx([0.3 * shorter] * len(radii), rel=1e-6)
    # ends on the two arms' directions
    assert math.atan2(ys[0] - vy, xs[0] - vx) == pytest.approx(math.atan2(ay_ - vy, ax_ - vx))
    assert math.atan2(ys[-1] - vy, xs[-1] - vx) == pytest.approx(math.atan2(by_ - vy, bx_ - vx))
    # the middle point sits between the arms (the smaller side), not on the far side
    mid = len(xs) // 2
    bis = math.atan2(ay_ - vy, ax_ - vx) + (
        (math.atan2(by_ - vy, bx_ - vx) - math.atan2(ay_ - vy, ax_ - vx)) / 2
    )
    assert math.atan2(ys[mid] - vy, xs[mid] - vx) == pytest.approx(bis, abs=0.05)


def test_label_clears_the_arc() -> None:
    off = _render(_ANGLE)
    on = _render({**_ANGLE, "arc": True})

    def label_dist(fig: Any) -> float:
        ax = fig.axes[0]
        note = next(a for a in ax.get_children() if a.get_gid() == "shape:0:label")
        ext = note.get_window_extent(fig.canvas.get_renderer())
        vx, vy = ax.transData.transform((2.0, 2.0))
        return math.hypot((ext.x0 + ext.x1) / 2 - vx, (ext.y0 + ext.y1) / 2 - vy)

    assert label_dist(on) >= label_dist(off)


def _svg(shape: dict[str, Any]) -> bytes:
    """The export's bytes, less the SVG's own timestamp (the only thing that varies)."""
    return re.sub(rb"<dc:date>[^<]*</dc:date>", b"", _render(shape, capture=False))


def test_arc_is_opt_in_and_off_exports_are_byte_identical(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(matplotlib.rcParams, "svg.hashsalt", "fixed")  # element ids are salted
    plain = _svg(_ANGLE)
    assert _svg(_ANGLE) == plain  # the comparison itself is stable
    assert _svg({**_ANGLE, "arc": False}) == plain
    assert _svg({**_ANGLE, "arc": True}) != plain
    fig = _render(_ANGLE)
    assert not [a for a in fig.axes[0].get_children() if str(a.get_gid()).endswith(":arc")]


def test_arc_must_be_a_boolean() -> None:
    with pytest.raises(ValueError):
        _validate_overrides({"shapes": [{**_ANGLE, "arc": "yes"}]})
    _validate_overrides({"shapes": [{**_ANGLE, "arc": True}]})
