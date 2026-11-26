"""Where a measurement label sits: the placement rules shared with the canvas
(``tests/fixtures/wire/annotation_measures.json``: ``label_origin``,
``label_fit``, ``angle_label``; asserted again by ``lib/annotationMeasure.test.ts``)
and the export honouring them: a label stays inside the plot frame and an angle
label is clear of both of its arms."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
from matplotlib.text import Annotation

import quantized.calc.figure as fig_mod
from quantized.calc.annotation_measure import (
    _segment_hits_box,
    angle_label_centre,
    fit_label_box,
    label_origin,
)
from quantized.calc.figure import render_figure

F = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "annotation_measures.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("c", F["label_origin"], ids=lambda c: "-".join(c["align"]))
def test_label_origin(c: dict[str, Any]) -> None:
    assert label_origin(*c["anchor"], *c["size"], *c["align"]) == tuple(c["out"])


@pytest.mark.parametrize("c", F["label_fit"], ids=lambda c: c["name"])
def test_fit_label_box(c: dict[str, Any]) -> None:
    assert fit_label_box(*c["box"], tuple(c["plot"])) == tuple(c["out"])


def _clear(c: dict[str, Any], centre: tuple[float, float]) -> bool:
    w, h, pad = c["w"], c["h"], c["pad"]
    box = (centre[0] - w / 2 - pad, centre[1] - h / 2 - pad, w + 2 * pad, h + 2 * pad)
    v = tuple(c["vertex"])
    return not (
        _segment_hits_box(v, tuple(c["a"]), box) or _segment_hits_box(v, tuple(c["b"]), box)  # type: ignore[arg-type]
    )


@pytest.mark.parametrize("c", F["angle_label"], ids=lambda c: c["name"])
def test_angle_label_centre(c: dict[str, Any]) -> None:
    got = angle_label_centre(
        tuple(c["vertex"]), tuple(c["a"]), tuple(c["b"]),  # type: ignore[arg-type]
        c["w"], c["h"], c["radius"], c["pad"], c["step"],
    )
    assert got == pytest.approx(tuple(c["centre"]))
    assert _clear(c, got), "the label box must not touch either arm"
    # Never closer to the vertex than the arc radius.
    assert np.hypot(got[0] - c["vertex"][0], got[1] - c["vertex"][1]) >= c["radius"]


def _rendered(shapes: list[dict[str, Any]]) -> Any:
    captured: dict[str, Any] = {}
    real = fig_mod.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    x = np.linspace(0, 20, 30)
    with patch.object(fig_mod, "savefig_bytes", grab):
        render_figure(x, [("S", x)], fmt="png", overrides={"shapes": shapes})
    fig = captured["fig"]
    fig.canvas.draw()
    return fig


def _label_box(fig: Any, gid: str) -> Any:
    ax = fig.axes[0]
    note = next(a for a in ax.get_children() if isinstance(a, Annotation) and a.get_gid() == gid)
    return note.get_window_extent(fig.canvas.get_renderer())


def test_a_distance_label_near_the_right_edge_stays_inside_the_frame() -> None:
    # The screenshot case: mid-point x = 14.5 of 20, a long label.
    fig = _rendered([{"kind": "distance", "x1": 11, "y1": 2.2, "x2": 18, "y2": 8.8}])
    frame = fig.axes[0].get_window_extent()
    box = _label_box(fig, "shape:0:label")
    assert box.x0 >= frame.x0 - 0.5 and box.x1 <= frame.x1 + 0.5
    assert box.y0 >= frame.y0 - 0.5 and box.y1 <= frame.y1 + 0.5


def test_an_angle_label_is_clear_of_both_arms_in_the_export() -> None:
    sh = {"kind": "angle", "x1": 3, "y1": 16.5, "x2": 7, "y2": 18.7, "x3": 7.4, "y3": 16.5}
    fig = _rendered([sh])
    ax = fig.axes[0]
    box = _label_box(fig, "shape:0:label")
    pts = ax.transData.transform([(sh["x1"], sh["y1"]), (sh["x2"], sh["y2"]), (sh["x3"], sh["y3"])])
    # Display y grows upward here; the clipping test is orientation-free.
    rect = (box.x0, box.y0, box.width, box.height)
    assert not _segment_hits_box(tuple(pts[0]), tuple(pts[1]), rect)  # type: ignore[arg-type]
    assert not _segment_hits_box(tuple(pts[0]), tuple(pts[2]), rect)  # type: ignore[arg-type]
    frame = ax.get_window_extent()
    assert box.x0 >= frame.x0 - 0.5 and box.x1 <= frame.x1 + 0.5
