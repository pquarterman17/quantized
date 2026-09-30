"""P2.6 box 1 leftover -- long upright category labels wrap or rotate.

An upright, unwrapped label wider than its slot used to overlap its
neighbour (on screen and in the figure); now ``axis_style.fit = "auto"``
applies ONE rule (``calc.figure_category_axis.fit_category_labels``, the
canvas's ``lib/statMarks.fitCategoryLabels``), pinned by the shared fixture
``tests/fixtures/wire/stat_label_fit.json``, each side over its OWN text
metrics and slot pitch. A rotated label's depth (where a nested axis's
outer tier starts) is measured from the same metrics, not counted.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from matplotlib.figure import Figure

from quantized.app import app
from quantized.calc.figure_category_axis import (
    _axis_metrics,
    fit_category_labels,
    style_category_axis,
)

client = TestClient(app)
WIRE = Path(__file__).parent / "fixtures" / "wire"
FIT = json.loads((WIRE / "stat_label_fit.json").read_text(encoding="utf-8"))
LONG = [f"Anneal temperature under vacuum {t} C" for t in (400, 450, 500, 550, 600, 650)]


@pytest.mark.parametrize("case", FIT["cases"], ids=lambda c: c["name"])
def test_fit_rule_matches_the_shared_fixture(case: dict[str, Any]) -> None:
    char_w = FIT["char_w"]
    got = fit_category_labels(
        case["labels"], case["rotation"], case["wrap"], lambda s: len(s) * char_w,
        case["pitch"], FIT["line_h"],
    )
    assert got == (case["fit"]["rotation"], case["fit"]["wrap"])


def _axis(figsize: tuple[float, float], n: int) -> Any:
    fig = Figure(figsize=figsize)
    ax = fig.subplots()
    ax.set_xlim(0.5, n + 0.5)
    return ax


def test_auto_leaves_labels_that_fit_untouched() -> None:
    ax = _axis((6, 3), 3)
    before = [t.get_text() for t in ax.get_xticklabels()]
    assert style_category_axis(ax, [1, 2, 3], ["a", "b", "c"], fit="auto") is None
    assert [t.get_text() for t in ax.get_xticklabels()] == before


def test_auto_rotates_labels_wider_than_their_slot_in_the_figures_own_metrics() -> None:
    ax = _axis((3, 3), 6)
    style_category_axis(ax, list(range(1, 7)), LONG, fit="auto")
    texts = ax.get_xticklabels()
    assert [t.get_text() for t in texts] == LONG  # whole: four lines would not wrap
    assert {t.get_rotation() for t in texts} == {45.0}
    assert {t.get_horizontalalignment() for t in texts} == {"right"}
    # The rule's inputs ARE the figure's own metrics: wider than a slot,
    # and a slot wide enough for 45 degrees.
    measure, size, pitch = _axis_metrics(ax, 6)
    assert max(measure(s) for s in LONG) > pitch
    assert pitch >= size * 1.25 * math.sqrt(2)


def test_auto_turns_labels_upright_when_the_slots_are_too_narrow_for_45() -> None:
    ax = _axis((2, 3), 12)
    style_category_axis(ax, list(range(1, 13)), LONG * 2, fit="auto")
    assert {t.get_rotation() for t in ax.get_xticklabels()} == {90.0}


def test_auto_wraps_when_every_wrapped_line_fits() -> None:
    labels = ["Anneal temperature 450 C", "Anneal temperature 500 C"]
    ax = _axis((3, 3), 2)
    style_category_axis(ax, [1, 2], labels, fit="auto")
    texts = ax.get_xticklabels()
    assert [t.get_text() for t in texts] == [
        "Anneal\ntemperature\n450 C", "Anneal\ntemperature\n500 C",
    ]
    assert {t.get_rotation() for t in texts} == {0.0}


def test_an_explicit_option_is_never_overridden_by_auto() -> None:
    ax = _axis((3, 3), 6)
    style_category_axis(ax, list(range(1, 7)), LONG, rotation=90, fit="auto")
    assert {t.get_rotation() for t in ax.get_xticklabels()} == {90.0}
    ax = _axis((3, 3), 6)
    style_category_axis(ax, list(range(1, 7)), LONG, wrap=12, fit="auto")
    texts = ax.get_xticklabels()
    assert {t.get_rotation() for t in texts} == {0.0}
    assert all("\n" in t.get_text() for t in texts)


def test_unknown_fit_values_are_refused() -> None:
    ax = _axis((3, 3), 1)
    with pytest.raises(ValueError):
        style_category_axis(ax, [1], ["a"], fit="always")


def _tier_depth(inner: str, rotation: int) -> tuple[float, Any]:
    ax = _axis((4, 3), 2)
    labels = [f"lot = 1 / w = {inner}", f"lot = 2 / w = {inner}"]
    outer = style_category_axis(ax, [1, 2], labels, rotation=rotation, tiered=True)
    assert outer is not None
    kind, depth = outer.spines["bottom"].get_position()
    assert kind == "outward"
    return float(depth), ax


def test_rotated_label_depth_is_measured_from_text_metrics_not_counted() -> None:
    # The same character count, different glyph widths: the outer tier sits
    # deeper under the wider labels (a count-based estimate could not tell
    # them apart), and exactly the measured width below the pad at 90 deg.
    narrow, _ = _tier_depth("iiiiiiii", 90)
    wide, ax = _tier_depth("WWWWWWWW", 90)
    assert wide > narrow
    measure = _axis_metrics(ax, 2)[0]
    assert wide == pytest.approx(3.5 + 3.5 + 2.0 + measure("w = WWWWWWWW"), abs=1e-9)
    # Upright, the depth is a line count; the widths play no part.
    assert _tier_depth("iiiiiiii", 0)[0] == _tier_depth("WWWWWWWW", 0)[0]


def test_route_takes_fit_auto_and_rotates_the_figure_it_draws() -> None:
    base = {
        "kind": "box", "data": [[1.0, 2.0, 3.0], [2.0, 3.0, 4.0]], "labels": LONG[:2], "fmt": "svg",
    }
    r = client.post("/api/export/statplot-figure", json={**base, "axis_style": {"fit": "auto"}})
    assert r.status_code == 200, r.text
    assert "rotate(-45" in r.text
    plain = client.post("/api/export/statplot-figure", json=base)
    assert plain.status_code == 200
    assert "rotate(-45" not in plain.text  # a legacy request: the options as given
    r = client.post("/api/export/statplot-figure", json={**base, "axis_style": {"fit": "always"}})
    assert r.status_code == 422
