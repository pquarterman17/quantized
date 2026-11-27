"""3-D bar layouts (grouped, absolute sizes) and vector colour columns: the rules
and their refusals, against the shared wire fixture (``plot3d_kinds.json``) and by hand.

The screen half is ``Map3D/plot3dKindsFixture.test.ts`` (it records the same requests and
what the canvas makes of them); the shared cases are also rendered and compared to the
screen's boxes, colours, legends and notes in ``test_export_plot3d_kinds.py``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib
import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_map3d_bar_layout import apply_bar_layout, bar_layout_requested
from quantized.calc.figure_map3d_colour import (
    vector_colour_plan,
    vector_colour_requested,
    vector_colour_rows,
)

matplotlib.use("Agg")
client = TestClient(app)
CASES = {
    c["name"]: c
    for c in json.loads(
        (Path(__file__).parent / "fixtures" / "wire" / "plot3d_kinds.json").read_text("utf-8")
    )["cases"]
}
GROUPED = CASES["bars grouped side by side"]
ABSOLUTE = CASES["bars with absolute sizes, the depth clamped"]
VEC_NUM = CASES["vectors coloured by a number column"]
VEC_TEXT = CASES["vectors coloured by a text column"]


def _fig_texts(body: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> list[str]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/map-figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return [t.get_text() for t in kept[-1].texts]


def test_the_footnote_carries_the_clamp_sentence_the_screen_shows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    texts = _fig_texts(ABSOLUTE["request"], monkeypatch)
    assert any(ABSOLUTE["note"] in t for t in texts)


def test_no_layout_option_means_no_layout_work() -> None:
    assert not bar_layout_requested({})
    assert not bar_layout_requested({"bar_abs": False, "bar_grouped": False})
    x = np.array([0.0, 1.0, 2.0])
    out = apply_bar_layout(x, x, 0.8, 0.8, None, {})
    assert out[0] is x
    assert out[1:] == (0.8, 0.8, "")


@pytest.mark.parametrize(
    ("w", "d", "dx", "dy", "note"),
    [
        (0.5, 2.0, 0.5, 2.0, ""),  # inside the spacing (1 x 5): as typed, no note
        (3.0, 2.0, 1.0, 2.0, "Bar width clamped"),
        (0.5, 9.0, 0.5, 5.0, "Bar depth clamped"),
        (3.0, 9.0, 1.0, 5.0, "Bar width and depth clamped"),
        (1.0, 5.0, 1.0, 5.0, ""),  # exactly touching is not an overlap
    ],
)
def test_absolute_sizes_clamp_to_the_spacing(
    w: float, d: float, dx: float, dy: float, note: str
) -> None:
    x = np.array([0.0, 1.0, 2.0, 0.0])
    y = np.array([0.0, 5.0, 10.0, 5.0])
    _, got_dx, got_dy, got_note = apply_bar_layout(
        x, y, 0.8, 0.8, None, {"bar_abs": True, "bar_abs_w": w, "bar_abs_d": d}
    )
    assert (got_dx, got_dy) == pytest.approx((dx, dy))
    if note:
        assert got_note.startswith(note)
    else:
        assert got_note == ""


@pytest.mark.parametrize("bad", [0, -1.0, None, float("nan")])
def test_absolute_sizes_refuse_a_value_not_above_zero(bad: Any) -> None:
    x = np.array([0.0, 1.0])
    for key in ("bar_abs_w", "bar_abs_d"):
        opts = {"bar_abs": True, "bar_abs_w": 1.0, "bar_abs_d": 1.0, key: bad}
        with pytest.raises(ValueError, match=f"{key} must be a number above 0"):
            apply_bar_layout(x, x, 0.8, 0.8, None, opts)


def test_absolute_sizes_refused_through_the_route() -> None:
    body = {**ABSOLUTE["request"], "bar_abs_w": 0}
    r = client.post("/api/export/map-figure", json=body)
    assert r.status_code == 422
    assert "bar_abs_w must be a number above 0" in r.text
    r = client.post("/api/export/map-figure", json={**ABSOLUTE["request"], "bar_abs_d": None})
    assert r.status_code == 422
    assert "bar_abs_d must be a number above 0" in r.text


def test_grouped_slots_by_hand() -> None:
    # Two positions 1 apart; position 0 holds categories 0 and 2 (slots 0 and 1 of the two
    # that have a bar), position 1 holds 0 only. Footprint 0.8: two slots of 0.4, centred
    # at -0.2 and +0.2 of their position.
    x = np.array([0.0, 0.0, 1.0])
    y = np.array([0.0, 0.0, 0.0])
    codes = np.array([0, 2, 0], dtype=np.intp)
    xs, dx, dy, note = apply_bar_layout(x, y, 0.8, 0.5, codes, {"bar_grouped": True})
    np.testing.assert_allclose(xs, [-0.2, 0.2, 0.8])
    assert (dx, dy) == pytest.approx((0.4, 0.5))
    assert note == ""


def test_grouped_bars_refuse_without_categories_and_with_repeats() -> None:
    x = np.array([0.0, 1.0])
    with pytest.raises(ValueError, match="categorical bar colour column"):
        apply_bar_layout(x, x, 0.8, 0.8, None, {"bar_grouped": True})
    with pytest.raises(ValueError, match="1 rows repeat a position and category"):
        apply_bar_layout(
            np.array([0.0, 0.0]), np.array([0.0, 0.0]), 0.8, 0.8,
            np.array([1, 1], dtype=np.intp), {"bar_grouped": True},
        )


def test_grouped_bars_refuse_more_than_ten_levels_through_the_route() -> None:
    body = {**GROUPED["request"], "bar_group_names": [str(i) for i in range(11)]}
    r = client.post("/api/export/map-figure", json=body)
    assert r.status_code == 422
    assert "1 to 10 colour categories" in r.text


def test_grouped_bars_without_a_category_colour_are_refused_through_the_route() -> None:
    drop = ("bar_group", "bar_group_names", "bar_group_label")
    body = {k: v for k, v in GROUPED["request"].items() if k not in drop}
    r = client.post("/api/export/map-figure", json=body)
    assert r.status_code == 422
    assert "categorical bar colour column" in r.text


def test_vector_column_rows_by_hand() -> None:
    assert not vector_colour_requested({})
    assert vector_colour_requested({"vec_cval": [1.0]})
    ok = vector_colour_rows({"vec_cval": [1.0, None, float("nan"), 4.0]}, 4)
    assert ok.tolist() == [True, False, False, True]
    ok = vector_colour_rows({"vec_group": [0, 2, None, 1], "vec_group_names": ["a", "b"]}, 4)
    assert ok.tolist() == [True, False, False, True]  # an index past the names is a gap too
    plan = vector_colour_plan(
        {"vec_cval": [5.0, 6.0, 7.0], "vec_cval_label": "T"}, np.array([0, 2], dtype=np.intp)
    )
    assert plan.values is not None
    np.testing.assert_allclose(plan.values, [5.0, 7.0])
    assert plan.label == "T"
    assert plan.codes is None


@pytest.mark.parametrize(
    ("patch", "needle"),
    [
        ({"vec_color": "#112233"}, "not more than one"),
        ({"vec_by_length": True}, "not more than one"),
        ({"vec_group": [0], "vec_group_names": ["a"]}, "not both"),
        ({"vec_cval": [1.0]}, "one value per row"),
    ],
)
def test_vector_columns_refuse_with_a_reason(patch: dict[str, Any], needle: str) -> None:
    r = client.post("/api/export/map-figure", json={**VEC_NUM["request"], **patch})
    assert r.status_code == 422
    assert needle in r.text


def test_vector_categories_refuse_more_than_ten_levels() -> None:
    body = {**VEC_TEXT["request"], "vec_group_names": [str(i) for i in range(11)]}
    r = client.post("/api/export/map-figure", json=body)
    assert r.status_code == 422
    assert "3-D vectors take 1 to 10 colour categories" in r.text
    assert "has 11" in r.text


def test_vector_columns_on_a_grid_source_are_refused() -> None:
    r = client.post("/api/export/map-figure", json={**VEC_NUM["request"], "contour_source": "grid"})
    assert r.status_code == 422
    assert "contour_source='points'" in r.text
