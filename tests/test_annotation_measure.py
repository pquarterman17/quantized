"""Measurement annotations (slope / distance / angle / scale bar): the shared
rules against ``tests/fixtures/wire/annotation_measures.json`` (the same table
``frontend/src/lib/annotationMeasure.test.ts`` asserts), then the vector export
drawing them."""

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
    angle_degrees,
    distance_parts,
    fmt_sig,
    label_below,
    scalebar_end,
    shape_label,
    slope_measure,
    slope_triangle,
)
from quantized.calc.figure import _validate_overrides, render_figure

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "annotation_measures.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("c", FIXTURE["fmt_sig"], ids=lambda c: f"{c['v']}@{c['digits']}")
def test_fmt_sig(c: dict[str, Any]) -> None:
    assert fmt_sig(c["v"], c["digits"]) == c["text"]


@pytest.mark.parametrize("c", FIXTURE["slope"], ids=lambda c: str(c["p"]))
def test_slope(c: dict[str, Any]) -> None:
    m = slope_measure(*c["p"], c["xlog"], c["ylog"])
    assert (m["mode"], m["label"]) == (c["mode"], c["label"])
    if c["value"] is None:
        assert m["value"] is None
    else:
        assert m["value"] == pytest.approx(c["value"])


def test_exponent_is_d_log_y_over_d_log_x() -> None:
    # y = 3 x**1.7 sampled two decades apart: the exponent comes back exactly.
    x1, x2 = 2.0, 200.0
    y1, y2 = 3 * x1**1.7, 3 * x2**1.7
    assert slope_measure(x1, y1, x2, y2, True, True)["value"] == pytest.approx(1.7)
    # ... and on linear axes the same points have an ordinary slope.
    plain = slope_measure(x1, y1, x2, y2, False, False)["value"]
    assert plain == pytest.approx((y2 - y1) / (x2 - x1))


@pytest.mark.parametrize("c", FIXTURE["distance"], ids=lambda c: str(c["p"]))
def test_distance(c: dict[str, Any]) -> None:
    d = distance_parts(*c["p"])
    assert d["label"] == c["label"]
    assert (d["d"], d["dx"], d["dy"]) == pytest.approx((c["d"], c["dx"], c["dy"]))


@pytest.mark.parametrize("c", FIXTURE["angle"], ids=lambda c: str(c["b"]))
def test_angle(c: dict[str, Any]) -> None:
    deg = angle_degrees(tuple(c["vertex"]), tuple(c["a"]), tuple(c["b"]))
    if c["degrees"] is None:
        assert deg is None
    else:
        assert deg == pytest.approx(c["degrees"])
    sh = {
        "kind": "angle",
        "x1": c["vertex"][0],
        "y1": c["vertex"][1],
        "x2": c["a"][0],
        "y2": c["a"][1],
        "x3": c["b"][0],
        "y3": c["b"][1],
    }
    assert shape_label(sh, False, False) == c["label"]


@pytest.mark.parametrize("c", FIXTURE["scalebar"], ids=lambda c: f"{c['orient']}{c['length']}")
def test_scalebar(c: dict[str, Any]) -> None:
    assert scalebar_end(c["x1"], c["y1"], c["orient"], c["length"]) == tuple(c["end"])
    sh: dict[str, Any] = {
        "kind": "scalebar",
        "x1": c["x1"],
        "y1": c["y1"],
        "x2": c["end"][0],
        "y2": c["end"][1],
        "length": c["length"],
        "orient": c["orient"],
    }
    if c["text"]:
        sh["text"] = c["text"]
    assert shape_label(sh, False, False) == c["label"]


def test_triangle_and_label_side() -> None:
    for c in FIXTURE["triangle"]:
        assert slope_triangle(*c["p"]) == [tuple(v) for v in c["vertices"]]
    for c in FIXTURE["label_below"]:
        assert label_below(*c["p"]) is c["below"]


@pytest.mark.parametrize("c", FIXTURE["shapes"], ids=lambda c: c["shape"]["kind"])
def test_wire_shape_label(c: dict[str, Any]) -> None:
    assert shape_label(c["shape"], c["xlog"], c["ylog"]) == c["label"]


def _render(shapes: list[dict[str, Any]], **kw: Any) -> Any:
    captured: dict[str, Any] = {}
    real = fig_mod.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    x = np.logspace(0, 3, 30)
    with patch.object(fig_mod, "savefig_bytes", grab):
        render_figure(x, [("A", x**2)], fmt="svg", overrides={"shapes": shapes}, **kw)
    return captured["fig"]


def _labels(fig: Any) -> dict[str, str]:
    return {
        a.get_gid(): a.get_text()
        for a in fig.axes[0].get_children()
        if isinstance(a, Annotation) and str(a.get_gid()).endswith(":label")
    }


def test_export_draws_every_kind_with_the_shared_label() -> None:
    linear = [c for c in FIXTURE["shapes"] if not (c["xlog"] or c["ylog"])]
    fig = _render([c["shape"] for c in linear])
    assert _labels(fig) == {f"shape:{i}:label": c["label"] for i, c in enumerate(linear)}


def test_export_exponent_on_log_log_axes_matches_the_fixture() -> None:
    case = FIXTURE["shapes"][0]
    fig = _render([case["shape"]], x_log=True, y_log=True)
    ax = fig.axes[0]
    assert ax.get_xscale() == "log" and ax.get_yscale() == "log"
    assert list(_labels(fig).values()) == [case["label"]]
    # The slope triangle is two polygons (fill + edge).
    assert len([p for p in ax.patches if len(p.get_xy()) >= 3]) == 2


def test_measure_labels_are_not_hitmap_annotations() -> None:
    # collect_map numbers ax.texts as "ann:<i>"; a shape's label is tagged so it is skipped.
    fig = _render([FIXTURE["shapes"][2]["shape"]])
    assert [str(t.get_gid()) for t in fig.axes[0].texts] == ["shape:0:label"]


def test_scalebar_bar_spans_its_length_in_data_units() -> None:
    sb = {
        "kind": "scalebar",
        "x1": 2.0,
        "y1": 100.0,
        "x2": 202.0,
        "y2": 100.0,
        "length": 200.0,
        "orient": "h",
        "text": "200 nm",
    }
    ax = _render([sb]).axes[0]
    bar = next(ln for ln in ax.lines if ln.get_gid() == "shape:0")
    assert list(bar.get_xdata()) == [2.0, 202.0]


@pytest.mark.parametrize(
    "shape",
    [
        {"kind": "angle", "x1": 0, "y1": 0, "x2": 1, "y2": 0},
        {"kind": "scalebar", "x1": 0, "y1": 0, "x2": 1, "y2": 0, "length": -1},
        {"kind": "scalebar", "x1": 0, "y1": 0, "x2": 1, "y2": 0, "orient": "z"},
    ],
)
def test_malformed_measure_shapes_are_rejected(shape: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        _validate_overrides({"shapes": [shape]})


def test_hitmap_lists_the_shape_but_no_phantom_annotation() -> None:
    from quantized.calc.figure import render_figure_map

    x = np.linspace(1.0, 10.0, 10)
    shape = FIXTURE["shapes"][2]["shape"]
    out = render_figure_map(x, [("A", x)], overrides={"shapes": [shape]})
    ids = [e["id"] for e in out["elements"]]
    assert "shape:0" in ids
    assert not [i for i in ids if i.startswith("ann:")]
