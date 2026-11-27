"""The 2-D map's scale bar: length, label and placement against the shared table
(``tests/fixtures/wire/map_scalebar.json``, also asserted by
``frontend/src/lib/mapScaleBar.test.ts``), then the map export drawing it."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

import quantized.calc.figure_map as map_mod
from quantized.app import app
from quantized.calc.figure_map import render_map_figure
from quantized.calc.map_scalebar import (
    BAR_PX,
    MARGIN_PX,
    check_scale_bar,
    nice_length,
    resolve_scale_bar,
    scale_bar_layout,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "map_scalebar.json").read_text(encoding="utf-8")
)
client = TestClient(app)
_PT = 0.75  # one screen pixel in points


@pytest.mark.parametrize("c", FIXTURE["nice_length"], ids=lambda c: str(c["span"]))
def test_nice_length(c: dict[str, Any]) -> None:
    got = nice_length(c["span"])
    assert got == c["length"] if c["length"] is None else got == pytest.approx(c["length"])


@pytest.mark.parametrize("c", FIXTURE["resolve"], ids=lambda c: json.dumps(c["spec"]))
def test_resolve(c: dict[str, Any]) -> None:
    got = resolve_scale_bar(c["spec"], c["span"])
    if c["length"] is None:
        assert got is None
    else:
        assert got is not None
        assert got[0] == pytest.approx(c["length"])
        assert got[1] == c["text"]


@pytest.mark.parametrize("c", FIXTURE["layout"], ids=lambda c: f"{c['corner']}-{c['text'][0]}")
def test_layout(c: dict[str, Any]) -> None:
    got = scale_bar_layout(c["corner"], *c["plot"], c["bar_px"], *c["text"])
    for key in ("x0", "x1", "y", "label_left", "label_top"):
        assert got[key] == pytest.approx(c[key]), key


def test_an_automatic_bar_is_a_round_number_near_a_fifth_of_the_axis() -> None:
    for span in (3.7, 48.0, 820.0, 0.0031, 1.2e6):
        length = nice_length(span)
        assert length is not None
        mantissa = length / 10 ** np.floor(np.log10(length))
        assert round(mantissa, 9) in (1.0, 2.0, 5.0)
        assert 0.1 <= length / span <= 0.35  # never far from 20 %


def _render(spec: dict[str, Any] | None, **kw: Any) -> Any:
    captured: dict[str, Any] = {}

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return b""

    x, y = np.linspace(0.0, 100.0, 11), np.linspace(0.0, 60.0, 7)
    z = np.add.outer(y, x)
    with patch.object(map_mod, "savefig_bytes", grab):
        render_map_figure(x, y, z, kind="heatmap", fmt="svg", scale_bar=spec, **kw)
    fig = captured["fig"]
    fig.canvas.draw()
    return fig


def _bar(fig: Any) -> tuple[Any, Any, Any, float]:
    """The axes, the bar line, the label, and display px per screen px."""
    ax = fig.axes[0]
    art = next(a for a in ax.get_children() if a.get_gid() == "map-scalebar")
    k = fig.canvas.get_renderer().points_to_pixels(_PT)
    return ax, art._bar, art._text, k


def test_export_bar_spans_its_length_in_x_data_units_and_sits_in_the_corner() -> None:
    fig = _render({"unit": "nm", "corner": "br"})
    ax, bar, label, k = _bar(fig)
    box = ax.get_window_extent()
    xs, ys = bar.get_xdata(), bar.get_ydata()
    assert label.get_text() == "20 nm"  # 20 % of the 100 nm axis
    assert xs[1] - xs[0] == pytest.approx(20.0 / 100.0 * box.width)
    assert xs[1] == pytest.approx(box.x1 - MARGIN_PX * k)  # inset 12 px from the right
    ext = label.get_window_extent(fig.canvas.get_renderer())
    assert ext.y0 == pytest.approx(box.y0 + MARGIN_PX * k)  # label ends 12 px above the bottom
    assert ys[0] > ext.y1  # the bar sits above its label
    assert ((ext.x0 + ext.x1) / 2) == pytest.approx((xs[0] + xs[1]) / 2)  # centred on the bar
    assert bar.get_linewidth() == pytest.approx(BAR_PX * _PT)


@pytest.mark.parametrize("corner", ["bl", "br", "tl", "tr"])
def test_export_bar_is_in_the_requested_corner(corner: str) -> None:
    fig = _render({"corner": corner, "length": 30.0, "label": "30 nm", "color": "#ff0000"})
    ax, bar, label, k = _bar(fig)
    box = ax.get_window_extent()
    xs, ys = bar.get_xdata(), bar.get_ydata()
    assert label.get_text() == "30 nm"
    assert xs[1] - xs[0] == pytest.approx(0.3 * box.width)
    assert (xs[0] < box.x0 + box.width / 2) == corner.endswith("l")
    assert (ys[0] > box.y0 + box.height / 2) == corner.startswith("t")
    assert box.x0 <= xs[0] and xs[1] <= box.x1 and box.y0 <= ys[0] <= box.y1
    assert bar.get_color() == "#ff0000" and label.get_color() == "#ff0000"


def test_no_scale_bar_unless_asked() -> None:
    fig = _render(None)
    assert not [a for a in fig.axes[0].get_children() if a.get_gid() == "map-scalebar"]


@pytest.mark.parametrize(
    "spec", [{"length": 0}, {"length": -1.0}, {"length": True}, {"length": "x"}, {"corner": "mid"}]
)
def test_malformed_scale_bars_are_rejected(spec: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        check_scale_bar(spec)
    with pytest.raises(ValueError):
        _render(spec)


def test_route_draws_the_bar_and_rejects_bad_options() -> None:
    body: dict[str, Any] = {
        "x_axis": [0, 25, 50, 75, 100],
        "y_axis": [0, 1, 2],
        "z_grid": [[0, 1, 2, 3, 4], [4, 5, 6, 7, 8], [8, 9, 10, 11, 12]],
        "kind": "heatmap",
        "fmt": "svg",
        "scale_bar": {"unit": "nm", "corner": "tl"},
    }
    ok = client.post("/api/export/map-figure", json=body)
    assert ok.status_code == 200 and b"20 nm" in ok.content
    for bad in (
        {"corner": "centre"},
        {"length": -5},
        {"length": 0},
        {"color": "red"},
        {"label": "x" * 81},
    ):
        resp = client.post("/api/export/map-figure", json={**body, "scale_bar": bad})
        assert resp.status_code == 422, bad
