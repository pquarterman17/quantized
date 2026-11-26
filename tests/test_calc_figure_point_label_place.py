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


def _laid_out(ov: dict[str, Any], size: tuple[float, float] = (4, 3)) -> tuple[Figure, Any]:
    from quantized.calc.figure_layout import apply_figure_layout

    fig = Figure(figsize=size)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    ax.set_xlabel("Temp")
    line = ax.plot([0, 20], [0, 30])[0]
    apply_point_labels(ax, ov, [line])
    apply_figure_layout(fig, ov)
    fig.canvas.draw()
    return fig, ax


@pytest.mark.parametrize("avoid", [None, AVOID])
def test_the_note_is_a_footer_below_the_axes_not_text_over_the_plot(avoid: Any) -> None:
    note = "14 of 30 labels drawn; 16 crowded labels left out"
    pl = {"points": _cluster(8), "note": note, **({"avoid": avoid} if avoid else {})}
    fig, ax = _laid_out({"point_labels": pl})
    (foot,) = [t for t in fig.texts if t.get_text().startswith("14 of 30")]
    r = fig.canvas.get_renderer()
    box, plot = foot.get_window_extent(r), ax.get_window_extent(r)
    assert box.y1 <= plot.y0, "the note must sit below the axes box"
    assert not any(t.get_text().startswith("14 of 30") for t in ax.texts)
    assert box.y1 <= ax.xaxis.label.get_window_extent(r).y0, "and clear of the x title"


def test_an_overlap_only_note_reaches_the_footer_too() -> None:
    # a crowd in a tiny box has no free slot: the "could not avoid overlap" count is the note
    pts = [{"x": 10 + 0.01 * i, "y": 15, "text": "XXXXXXXXXXXXXXXX", "s": 0} for i in range(40)]
    fig, ax = _laid_out({"point_labels": {"points": pts, "avoid": AVOID}}, size=(1.5, 1.2))
    assert any("could not avoid overlap" in t.get_text() for t in fig.texts)


def test_no_note_leaves_the_layout_untouched() -> None:
    fig, _ = _laid_out({"point_labels": {"points": _cluster(2)}})
    assert fig.texts == []


def test_the_cluster_wire_fixture_places_all_thirty_apart_with_leaders() -> None:
    import json
    from pathlib import Path

    fx = json.loads(
        (Path(__file__).parent / "fixtures" / "wire" / "point_label_avoid_cluster.json").read_text(
            encoding="utf-8"
        )
    )
    pts = fx["wire_points"]
    assert len(pts) == 30
    art = _drawn(pts, AVOID, size=(6, 4))
    assert len(art.placements) == 30
    boxes = [
        (p.left, p.top, p.left + it.w, p.top + it.h)
        for p, it in zip(art.placements, art.items, strict=True)
    ]
    free = [b for b, p in zip(boxes, art.placements, strict=True) if not p.overlap]
    for i, a in enumerate(free):
        for b in free[i + 1 :]:
            assert a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1]
    assert sum(1 for p in art.placements if p.leader) >= fx["min_leaders"]


def _text_column_fixture() -> dict[str, Any]:
    import json
    from pathlib import Path

    path = Path(__file__).parent / "fixtures" / "wire" / "point_label_avoid_cluster.json"
    return dict(json.loads(path.read_text(encoding="utf-8"))["text_column"])


def test_text_column_wire_matches_the_real_csv_import(tmp_path: Any) -> None:
    """The text-column fixture is what ``import_csv`` really makes of its CSV, and the export
    draws exactly the fixture's wire strings (plan item 47 follow-up)."""
    from quantized.io.delimited import import_csv

    fx = _text_column_fixture()
    path = tmp_path / "labels.csv"
    path.write_bytes(fx["csv"].encode("utf-8"))
    ds = import_csv(path)
    assert ds.metadata["text_columns"] == {fx["column"]: fx["cells"]}
    assert ds.time.tolist() == fx["x"]
    assert ds.values[:, 0].tolist() == fx["y"]

    pts = fx["wire_points"]
    fig = Figure()
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    line = ax.plot([0, 70], [0, 7])[0]
    apply_point_labels(ax, {"point_labels": {"points": pts}}, [line])
    assert [t.get_text() for t in ax.texts] == [p["text"] for p in pts]
    assert any(t.get_text() == "α-Fe" for t in ax.texts)  # non-ASCII verbatim

    art = _drawn(pts, AVOID)  # and through the placement path
    assert len(art.placements) == len(pts)
