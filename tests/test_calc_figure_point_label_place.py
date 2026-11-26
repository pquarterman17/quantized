"""Plan item 18: overlap-avoiding point labels in the export."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from quantized.calc.figure import render_figure
from quantized.calc.figure_point_label_place import PlacedLabels, avoid_options
from quantized.calc.figure_point_labels import apply_point_labels

AVOID = {"leader_distance": 1.5, "leader_width": 0.75, "leader_dashed": False}


def _cluster(n: int) -> list[dict[str, Any]]:
    return [
        {"x": 10 + 0.3 * i, "y": 15 - 0.2 * i, "text": f"P{i + 1}-peak", "s": 0} for i in range(n)
    ]


def _drawn(
    points: list[dict[str, Any]], avoid: Any, size: tuple[float, float] = (4, 3)
) -> PlacedLabels:
    fig = Figure(figsize=size)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    line = ax.plot([0, 20], [0, 30])[0]
    apply_point_labels(ax, {"point_labels": {"points": points, "avoid": avoid}}, [line])
    fig.tight_layout()
    fig.canvas.draw()
    (art,) = [a for a in ax.get_children() if isinstance(a, PlacedLabels)]
    return art


def test_a_dense_cluster_comes_out_non_overlapping_in_the_figures_own_metrics() -> None:
    art = _drawn(_cluster(8), AVOID)
    assert len(art.placements) == 8 and not any(p.overlap for p in art.placements)
    boxes = [
        (p.left, p.top, p.left + i.w, p.top + i.h)
        for p, i in zip(art.placements, art.items, strict=True)
    ]
    for a in range(8):
        for b in range(a + 1, 8):
            assert (
                boxes[a][2] <= boxes[b][0]
                or boxes[b][2] <= boxes[a][0]
                or boxes[a][3] <= boxes[b][1]
                or boxes[b][3] <= boxes[a][1]
            )
    assert any(p.leader for p in art.placements)


def test_output_is_deterministic() -> None:
    a, b = _drawn(_cluster(8), AVOID), _drawn(_cluster(8), AVOID)
    assert a.placements == b.placements


def test_leader_lines_only_past_the_threshold() -> None:
    assert any(p.leader for p in _drawn(_cluster(8), AVOID).placements)
    far = {**AVOID, "leader_distance": 8.0}
    assert not any(p.leader for p in _drawn(_cluster(8), far).placements)
    assert _drawn(_cluster(1), AVOID).placements[0].leader is None


def test_a_label_with_no_room_stays_and_is_flagged() -> None:
    art = _drawn(_cluster(6), AVOID, size=(0.9, 0.7))
    assert len(art.placements) == 6  # nothing dropped
    assert any(p.overlap for p in art.placements)


def test_off_is_todays_annotation_path() -> None:
    fig = Figure()
    ax = fig.add_subplot()
    line = ax.plot([0, 20], [0, 30])[0]
    apply_point_labels(ax, {"point_labels": {"points": _cluster(2)}}, [line])
    assert len(ax.texts) == 2
    assert not any(isinstance(a, PlacedLabels) for a in ax.get_children())


def test_renders_through_every_format_with_the_labels_present() -> None:
    x = np.linspace(0, 20, 21)
    ov = {"point_labels": {"points": _cluster(8), "avoid": AVOID, "note": "n"}}
    svg = render_figure(x, [("s", x * 1.5)], fmt="svg", overrides=ov)
    text = svg.decode() if isinstance(svg, bytes) else str(svg)
    assert "P1-peak" in text and "P8-peak" in text
    for fmt in ("pdf", "png"):
        assert render_figure(x, [("s", x * 1.5)], fmt=fmt, overrides=ov)


@pytest.mark.parametrize(
    "raw",
    [
        {"leader_distance": 0.1, "leader_width": 1, "leader_dashed": False},
        {"leader_distance": 1, "leader_width": 9, "leader_dashed": False},
        {"leader_distance": True, "leader_width": 1},
        {"leader_distance": 1, "leader_width": 1, "leader_dashed": "yes"},
        "on",
    ],
)
def test_malformed_options_are_rejected(raw: Any) -> None:
    with pytest.raises(ValueError):
        avoid_options(raw)


def test_absent_options_mean_off() -> None:
    assert avoid_options(None) is None
