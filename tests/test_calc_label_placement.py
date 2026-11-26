"""Plan item 18: the overlap-avoiding label placement rule.

Shared with the canvas through ``tests/fixtures/wire/point_label_placement.json``
(``frontend/src/lib/labelPlacement.test.ts`` asserts the same file).
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from quantized.calc.label_placement import PlaceItem, PlaceOpts, Rect, place_labels

FIX = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "point_label_placement.json").read_text("utf-8")
)
TOL = FIX["tolerance"]


def _run(case: dict[str, Any], width_scale: float = 1.0) -> Any:
    items = [PlaceItem(**{**i, "w": i["w"] * width_scale}) for i in case["items"]]
    return items, place_labels(items, Rect(**case["rect"]), PlaceOpts(**case["opts"]))


@pytest.mark.parametrize("case", FIX["cases"], ids=lambda c: c["name"])
def test_rule_matches_the_shared_fixture(case: dict[str, Any]) -> None:
    _, got = _run(case)
    assert len(got) == len(case["placed"])
    for g, want in zip(got, case["placed"], strict=True):
        assert g.left == pytest.approx(want["left"], abs=TOL)
        assert g.top == pytest.approx(want["top"], abs=TOL)
        assert g.overlap is want["overlap"]
        if want["leader"] is None:
            assert g.leader is None
        else:
            assert g.leader is not None
            assert list(g.leader) == pytest.approx(want["leader"], abs=TOL)


@pytest.mark.parametrize(
    "case", [c for c in FIX["cases"] if c.get("metric_robust")], ids=lambda c: c["name"]
)
@pytest.mark.parametrize("scale", [0.95, 1.05])
def test_a_text_width_spread_keeps_flags_and_leaders(case: dict[str, Any], scale: float) -> None:
    _, got = _run(case, scale)
    for g, want in zip(got, case["placed"], strict=True):
        assert g.overlap is want["overlap"]
        assert (g.leader is None) is (want["leader"] is None)


def test_the_dense_cluster_has_no_overlapping_boxes() -> None:
    case = next(c for c in FIX["cases"] if c["name"].startswith("a dense cluster"))
    items, got = _run(case)
    boxes = [(g.left, g.top, g.left + i.w, g.top + i.h) for g, i in zip(got, items, strict=True)]
    assert not any(g.overlap for g in got)
    for a in range(len(boxes)):
        for b in range(a + 1, len(boxes)):
            la, ta, ra, ba = boxes[a]
            lb, tb, rb, bb = boxes[b]
            assert ra <= lb or rb <= la or ba <= tb or bb <= ta


def test_a_label_with_no_room_stays_at_the_default_slot_and_is_flagged() -> None:
    case = next(c for c in FIX["cases"] if "no free slot" in c["name"])
    items, got = _run(case)
    assert got[0].overlap
    # the default slot is up and right of the point by `gap`
    assert (got[0].left, got[0].top) == (items[0].ax + 4, items[0].ay - 4 - items[0].h)


def test_output_is_deterministic_and_input_order_is_kept() -> None:
    case = next(c for c in FIX["cases"] if c["name"].startswith("a dense cluster"))
    _, a = _run(case)
    _, b = _run(case)
    assert a == b
    items = [PlaceItem(**i) for i in case["items"]]
    rev = place_labels(items[::-1], Rect(**case["rect"]), PlaceOpts(**case["opts"]))
    assert len(rev) == len(a)  # importance, not list order, decides priority
    assert [(p.left, p.top) for p in rev[::-1]] == [(p.left, p.top) for p in a]


def test_leader_lines_only_past_the_threshold() -> None:
    items = [PlaceItem(100 + i * 3, 50, 30, 10, 20 - i) for i in range(10)]
    rect = Rect(0, 0, 200, 100)
    o = PlaceOpts(gap=4, marker_r=3, step=12, rings=6)
    assert any(p.leader for p in place_labels(items, rect, o))
    assert not any(p.leader for p in place_labels(items, rect, replace(o, leader_min=50)))
    near = place_labels([PlaceItem(50, 50, 24, 10, 1)], rect, o)
    assert near[0].leader is None  # the default slot sits within 1.5 label heights
