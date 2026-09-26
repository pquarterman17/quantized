"""P2.6 box 2 -- "missing levels and unbalanced groups are explicit", export half.

The BACKEND half of the interactive <-> export parity check (the A8 pattern:
``tests/test_export_vector_structure.py`` + ``lib/figureSpec.a8.test.ts``).
``frontend/src/components/Stage/statLevelsParity.test.ts`` drives the real
Stat Stage hook on a fixture with a declared-only level, an all-NaN level, an
all-excluded level and a small, unbalanced group, asserts the screen's slots
and the export spec agree slot for slot, and pins that spec byte-for-byte as
``tests/fixtures/wire/statplot_levels_export.json``. This file posts that SAME
JSON to the real route and reads the SVG back:

* the category tick labels are the spec's labels, in order -- empty levels
  included, never closed up;
* one ``n=0`` marker per empty group;
* the ``show_n`` top axis reads ``n=K`` per slot, K = the finite count the
  screen shows for that slot;
* the caveat is a footnote, verbatim.

Plus the renderer-level contracts the fixture does not reach: bars with a
missing (null) mean, violin/strip/faceted empties, the connect-means break
rule, and the defaults-off byte-compatibility of the new fields.
"""

from __future__ import annotations

import html
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_group_notes import EMPTY_MARKER, connect_segments
from quantized.calc.figure_statplots import _draw_statplot

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "statplot_levels_export.json"
_SVG = "{http://www.w3.org/2000/svg}"
_COUNT = re.compile(r"^n=\d+$")


def _spec() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _svg(path: str, body: dict[str, Any]) -> ET.Element:
    r = client.post(path, json={**body, "fmt": "svg"})
    assert r.status_code == 200, r.text
    return ET.fromstring(r.text)


def _texts(el: ET.Element) -> list[str]:
    return [html.unescape(t.text or "") for t in el.iter(f"{_SVG}text")]


def _axes(root: ET.Element) -> list[list[str]]:
    """Each ``matplotlib.axis_*`` group's text, in document order."""
    return [
        _texts(g) for g in root.iter(f"{_SVG}g") if g.get("id", "").startswith("matplotlib.axis")
    ]


def _count_axis(root: ET.Element) -> list[str] | None:
    hits = [a for a in _axes(root) if a and all(_COUNT.match(t) for t in a)]
    return hits[0] if hits else None


def _markers(root: ET.Element) -> int:
    """``n=0`` texts that are NOT tick labels of a count axis: the markers."""
    in_axis = sum(t == EMPTY_MARKER for a in _axes(root) for t in a)
    return sum(t == EMPTY_MARKER for t in _texts(root)) - in_axis


# ── The wire fixture: what the screen showed, rendered ──────────────────────


def test_fixture_export_carries_every_slot_the_screen_showed() -> None:
    spec = _spec()
    root = _svg("/api/export/statplot-figure", spec)
    labels: list[str] = spec["labels"]
    data: list[list[float]] = spec["data"]
    # Tick labels: exactly the spec's labels, in order, empties included.
    tick_axes = [a for a in _axes(root) if a[: len(labels)] == labels]
    assert tick_axes, _axes(root)
    # One n=0 marker per empty group, and the empties are real (3 of 5).
    empties = sum(1 for g in data if not g)
    assert empties == 3
    assert _markers(root) == empties
    # n per slot == the finite count the screen captions.
    assert _count_axis(root) == [f"n={len(g)}" for g in data]
    # The caveat, verbatim, as a footnote.
    assert spec["caveat"] in _texts(root)


def test_fixture_without_show_n_keeps_the_markers_and_drops_the_counts() -> None:
    root = _svg("/api/export/statplot-figure", {**_spec(), "show_n": False})
    assert _count_axis(root) is None
    assert _markers(root) == 3


def test_fixture_renders_as_pdf_too() -> None:
    r = client.post("/api/export/statplot-figure", json={**_spec(), "fmt": "pdf"})
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")


def test_fixture_is_consistent_with_itself() -> None:
    """Guards the fixture against a hand edit that desyncs its arrays."""
    spec = _spec()
    assert len(spec["data"]) == len(spec["labels"]) == len(spec["point_row_indices"])
    for values, rows in zip(spec["data"], spec["point_row_indices"], strict=True):
        assert len(values) == len(rows)


# ── Other kinds and surfaces ────────────────────────────────────────────────


@pytest.mark.parametrize("kind", ["violin", "strip"])
def test_violin_and_strip_keep_empty_slots(kind: str) -> None:
    body = {
        "kind": kind, "data": [[1, 2, 3, 4], [], [5, 6, 7]], "labels": ["a", "b", "c"],
        "show_n": True,
    }
    root = _svg("/api/export/statplot-figure", body)
    assert any(a[:3] == ["a", "b", "c"] for a in _axes(root))
    assert _markers(root) == 1
    assert _count_axis(root) == ["n=4", "n=0", "n=3"]


def test_every_group_empty_is_still_refused() -> None:
    r = client.post("/api/export/statplot-figure", json={"kind": "box", "data": [[], []]})
    assert r.status_code == 422
    assert "at least one group" in r.json()["detail"]


def test_bar_with_a_missing_mean_exports_instead_of_422() -> None:
    """A NaN mean reaches the wire as null. ``values`` was ``list[list[float]]``,
    so an all-NaN level used to 422 the whole bar export."""
    body = {
        "groups": ["A", "B", "C"], "series": ["y", "z"],
        "values": [[1.0, 2.0], [None, None], [3.0, None]],
        "errors": [[0.1, 0.2], [None, None], [None, None]],
        "counts": [[3, 4], [0, 0], [1, 0]],
        "caveat": "Caveat: n < 3 in 1 group",
    }
    root = _svg("/api/export/categorical-figure", body)
    texts = _texts(root)
    assert _markers(root) == 1 + 3  # B's marker + the three n=0 bar labels
    for lab in ("n=3", "n=4", "n=1"):
        assert lab in texts
    assert "Caveat: n < 3 in 1 group" in texts


def test_bar_null_means_draw_no_bar() -> None:
    """A null mean draws no visible bar -- never a zero-height stand-in. Its
    patch degenerates to an empty path, so the visible patches are one fewer
    than with a real value in the same cell."""

    def drawn(values: list[list[float | None]]) -> int:
        body = {"groups": ["A", "B"], "series": ["y"], "values": values, "errors": None}
        root = _svg("/api/export/categorical-figure", body)
        return sum(
            1
            for g in root.iter(f"{_SVG}g") if g.get("id", "").startswith("patch_")
            for p in g.iter(f"{_SVG}path") if "L" in (p.get("d") or "")
        )

    assert drawn([[2.0], [None]]) == drawn([[2.0], [3.0]]) - 1


def test_faceted_box_and_bar_keep_empty_slots_per_panel() -> None:
    stat = {
        "kind": "box", "data": [[1.0]], "show_n": True, "caveat": "cc",
        "facets": [
            {"label": "f0", "data": [[1, 2, 3], []], "labels": ["a", "b"]},
            {"label": "f1", "data": [[1, 2], [3, 4, 5]], "labels": ["a", "b"]},
        ],
    }
    root = _svg("/api/export/statplot-figure", stat)
    assert _markers(root) == 1
    assert "cc" in _texts(root)
    bar = {
        "groups": ["a"], "series": ["y"], "values": [[1.0]], "caveat": "cc",
        "facets": [
            {"label": "f0", "groups": ["a", "b"], "series": ["y"], "values": [[1.0], [None]],
             "counts": [[2], [0]]},
        ],
    }
    root = _svg("/api/export/categorical-figure", bar)
    assert _markers(root) == 2  # the empty-category marker + its n=0 bar label


def test_new_fields_default_off_add_no_text() -> None:
    body = {"kind": "box", "data": [[1, 2, 3], [4, 5, 6]], "labels": ["a", "b"]}
    texts = _texts(_svg("/api/export/statplot-figure", body))
    assert not any(_COUNT.match(t) for t in texts)


# ── The connect-means break rule (export twin of connectMeansBreaks) ────────


def test_connect_segments_break_at_empty_slots_and_nested_boundaries() -> None:
    assert connect_segments(["a", "b", "c"], [False, False, False]) == [[0, 1, 2]]
    assert connect_segments(["a", "b", "c"], [False, True, False]) == [[0], [2]]
    nested = ["lot = 0 / w = 0", "lot = 0 / w = 1", "lot = 1 / w = 0", "lot = 1 / w = 1"]
    assert connect_segments(nested, [False] * 4) == [[0, 1], [2, 3]]


def test_connect_means_line_is_segmented_in_the_export() -> None:
    body = {
        "kind": "box", "data": [[1, 2, 3], [], [4, 5, 6], [7, 8, 9]],
        "labels": ["a", "b", "c", "d"],
        "show_connect_means": True,
    }
    root = _svg("/api/export/statplot-figure", body)
    # Dashed means lines are Line2D groups; one segment (c-d) of 2 points and
    # the lone "a" is not drawn -- so exactly one dashed polyline.
    dashed = [
        p for p in root.iter(f"{_SVG}path")
        if "stroke-dasharray" in (p.get("style") or "")
    ]
    assert len(dashed) == 1


def test_a_caveat_with_stray_mathtext_still_renders() -> None:
    body = {"kind": "box", "data": [[1, 2, 3], [4]], "caveat": "n < 3 in $group"}
    r = client.post("/api/export/statplot-figure", json={**body, "fmt": "svg"})
    assert r.status_code == 200, r.text


def _box_widths(data: list[list[float]]) -> set[float]:
    """Widths of the box outlines matplotlib drew (5-point closed Line2Ds)."""
    fig, ax = plt.subplots()
    try:
        _draw_statplot(ax, "box", data, None, "norm", "fd", None, None)
        return {
            round(float(max(ln.get_xdata()) - min(ln.get_xdata())), 6)
            for ln in ax.lines if len(ln.get_xdata()) == 5
        }
    finally:
        plt.close(fig)


def test_box_width_does_not_depend_on_where_the_empty_slots_fall() -> None:
    """boxplot sizes boxes from the positions it is GIVEN; the renderer pins
    the width to the full axis, so an empty slot's position is irrelevant."""
    trailing = _box_widths([[1, 2, 3], [4, 5, 6], [], [], []])
    middle = _box_widths([[1, 2, 3], [], [4, 5, 6], [], [7, 8]])
    assert trailing == middle == {0.5}
