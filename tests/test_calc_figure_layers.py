"""Graph layers in the vector export (origin gap audit 3 #15).

An inset graph of OTHER data with its own axes, an inserted image and a small
table, positioned over the plot (``PlotView.layers``). The request carries
them fully resolved (``overrides["layers"]``, ``lib/graphLayersWire.ts``):
the export must put each at the same frame fractions with the same data, the
same axis ranges, tick positions and tick text the screen drew, and show the
screen's notice when an inset's sources are missing.
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import matplotlib.pyplot as plt
import numpy as np
import pytest
from matplotlib.table import Table

import quantized.calc.figure as fig_mod
from quantized.calc.figure import _validate_overrides, render_figure
from quantized.calc.figure_layers import validate_layers

X = np.linspace(-100.0, 100.0, 41)
M = np.tanh(X / 30.0)
AT = [0.55, 0.1, 0.4, 0.35]  # left, top, width, height: frame fractions, top-origin


def _axis(lim: list[float], ticks: list[float], labels: list[str], scale: str = "linear",
          label: str = "") -> dict[str, Any]:
    return {"lim": lim, "scale": scale, "label": label, "ticks": ticks, "tick_labels": labels}


INSET = {
    "kind": "inset", "at": AT, "mark": "linesymbol",
    "x": _axis([0.0, 3.0], [0.0, 1.0, 2.0, 3.0], ["0", "1", "2", "3"], label="T (K)"),
    "y": _axis([1.0, 1000.0], [1.0, 10.0, 100.0, 1000.0], ["1", "10", "100", "1000"], scale="log",
               label="dM/dH"),
    "curves": [{"x": [0.5, 1.0, 2.5], "y": [2.0, None, 500.0], "color": "#d62728"}],
}


def _png(w: int = 4, h: int = 2) -> str:
    buf = io.BytesIO()
    plt.imsave(buf, np.zeros((h, w, 3)), format="png")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _render(layers: list[dict[str, Any]], **kw: Any) -> Any:
    captured: dict[str, Any] = {}
    real = fig_mod.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    ov = {**kw.pop("overrides", {}), "layers": layers}
    with patch.object(fig_mod, "savefig_bytes", grab):
        render_figure(X, [("M", M)], fmt="svg", overrides=ov, **kw)
    return captured["fig"]


def test_inset_layer_sits_at_the_frame_fractions() -> None:
    fig = _render([INSET])
    main = fig.axes[0]
    (ins,) = main.child_axes
    fig.canvas.draw()
    p, q = main.get_position(), ins.get_position()
    left, top, w, h = AT
    assert q.x0 == pytest.approx(p.x0 + left * p.width)
    assert q.y1 == pytest.approx(p.y1 - top * p.height)
    assert q.width == pytest.approx(w * p.width)
    assert q.height == pytest.approx(h * p.height)


def test_inset_layer_draws_its_own_data_and_axes_verbatim() -> None:
    fig = _render([INSET])
    (ins,) = fig.axes[0].child_axes
    (line,) = [ln for ln in ins.lines if ln.get_label() == "_layer"]
    np.testing.assert_array_equal(line.get_xdata(), [0.5, 1.0, 2.5])
    np.testing.assert_array_equal(line.get_ydata(), [2.0, np.nan, 500.0])  # a gap stays a gap
    assert line.get_color() == "#d62728"
    assert line.get_marker() == "o"
    assert ins.get_xlim() == (0.0, 3.0)
    assert ins.get_ylim() == pytest.approx((1.0, 1000.0))
    assert ins.get_yscale() == "log"
    assert list(ins.get_xticks()) == [0.0, 1.0, 2.0, 3.0]
    assert [t.get_text() for t in ins.get_yticklabels()] == ["1", "10", "100", "1000"]
    assert not list(ins.yaxis.get_minorticklocs())
    assert ins.get_xlabel() == "T (K)"
    assert ins.get_ylabel() == "dM/dH"


def test_missing_sources_show_the_screen_notice_not_a_curve() -> None:
    notice = "No curves: their sources are missing"
    fig = _render([{**INSET, "curves": [], "notice": notice}])
    (ins,) = fig.axes[0].child_axes
    assert not [ln for ln in ins.lines if ln.get_label() == "_layer"]
    assert [t.get_text() for t in ins.texts] == [notice]
    # A framed notice, as on screen: no axes.
    assert not list(ins.get_xticks()) and not list(ins.get_yticks())


def test_an_inset_with_no_curve_bound_yet_exports_an_empty_frame() -> None:
    """Review L1: the screen's "add one in the layer's properties" hint is UI,
    never printed into a publication figure."""
    fig = _render([{**INSET, "curves": [], "notice": ""}])
    (ins,) = fig.axes[0].child_axes
    assert not list(ins.texts) and not list(ins.get_xticks())


def test_log_axes_gap_non_positive_points_as_the_screen_does() -> None:
    """Review M1: a y <= 0 on a log axis is a gap, not a dive to the edge."""
    fig = _render([{**INSET, "curves": [{"x": [0.5, 1.0, 2.5], "y": [10.0, 0.0, 50.0],
                                          "color": "#000000"}]}])
    (ins,) = fig.axes[0].child_axes
    (line,) = [ln for ln in ins.lines if ln.get_label() == "_layer"]
    np.testing.assert_array_equal(line.get_ydata(), [10.0, np.nan, 50.0])


def test_dollar_signs_in_layer_text_print_literally() -> None:
    """Review M3: the screen shows layer text literally, so must the export
    (an unpaired `$` used to fail the export; a pair became math)."""
    x = _axis([0.0, 3.0], [0.0, 3.0], ["$0", "3$"], label="cost $x^$ y")
    table = {"kind": "table", "at": AT, "rows": [["$a^$ b", "$5-$10"]], "header": False}
    fig = _render([{**INSET, "x": x}, table])
    fig.canvas.draw()  # mathtext would raise here
    (ins,) = fig.axes[0].child_axes
    assert ins.xaxis.label.get_text() == r"cost \$x^\$ y"
    (t,) = [c for c in fig.axes[0].get_children() if isinstance(c, Table)]
    assert t.get_celld()[0, 1].get_text().get_text() == r"\$5-\$10"
    ok = _route_svg([{**INSET, "x": x}, table])
    assert ok.status_code == 200 and b"cost $x^$ y" in ok.content


def _jpeg() -> str:
    buf = io.BytesIO()
    plt.imsave(buf, np.zeros((2, 4, 3)), format="jpeg")
    return base64.b64encode(buf.getvalue()).decode()


def test_an_image_is_read_as_what_its_bytes_are() -> None:
    """Review M2: a JPEG labelled PNG is refused with a clear reason (the
    bytes are sniffed, never trusted to the label); a real JPEG draws."""
    with pytest.raises(ValueError, match="not the format"):
        _render([{"kind": "image", "at": AT, "src": "data:image/png;base64," + _jpeg()}])
    fig = _render([{"kind": "image", "at": AT, "src": "data:image/jpeg;base64," + _jpeg()}])
    assert fig.axes[0].child_axes[0].images


def test_a_huge_image_is_refused_before_it_is_decoded() -> None:
    """Review M6: a tiny crafted PNG of 6000x6000 pixels (36 M > 25 M) is
    refused from its header, without decoding it."""
    from PIL import Image

    buf = io.BytesIO()
    Image.new("1", (6000, 6000)).save(buf, format="PNG")
    src = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    assert len(src) < 100_000
    with patch.object(Image.Image, "load", side_effect=AssertionError("decoded")), \
            pytest.raises(ValueError, match="too large"):
        _render([{"kind": "image", "at": AT, "src": src}])


def test_layers_draw_over_the_legend_as_on_screen() -> None:
    """Review M5: the screen mounts layers after the legend (Origin: layer 2
    over layer 1's legend); the export stacks them the same way."""
    fig = _render([INSET], overrides={"legend": {"show": True, "loc": "upper right"}})
    main = fig.axes[0]
    legend = main.get_legend()
    assert legend is not None
    assert main.child_axes[0].get_zorder() > legend.get_zorder()


def _route_svg(layers: list[dict[str, Any]]) -> Any:
    from fastapi.testclient import TestClient

    from quantized.app import app

    ds = {"time": [1.0, 2.0, 3.0], "values": [[1.0], [4.0], [9.0]], "labels": ["a"], "units": ["V"],
          "metadata": {}}
    return TestClient(app).post("/api/export/figure", json={
        "dataset": ds, "fmt": "svg", "dpi": 60, "overrides": {"layers": layers}})


def test_image_layer_fits_inside_its_rect() -> None:
    fig = _render([{"kind": "image", "at": AT, "src": _png(4, 2)}])
    (ins,) = fig.axes[0].child_axes
    (im,) = ins.images
    assert im.get_array().shape[:2] == (2, 4)
    assert not ins.axison
    fig.canvas.draw()
    p, q = fig.axes[0].get_position(), ins.get_position()
    # Contained: as wide as the rect allows or as tall, centred, aspect kept.
    cx, cy = p.x0 + (AT[0] + AT[2] / 2) * p.width, p.y1 - (AT[1] + AT[3] / 2) * p.height
    assert (q.x0 + q.x1) / 2 == pytest.approx(cx)
    assert (q.y0 + q.y1) / 2 == pytest.approx(cy)


def test_table_layer_fills_its_rect_with_a_bold_header() -> None:
    fig = _render([{"kind": "table", "at": AT, "rows": [["T", "Hc"], ["10", "120"], ["300"]],
                    "header": True}])
    (table,) = [c for c in fig.axes[0].get_children() if isinstance(c, Table)]
    left, top, w, h = AT
    assert table._bbox == pytest.approx([left, 1 - top - h, w, h])
    cells = table.get_celld()
    assert cells[0, 1].get_text().get_text() == "Hc"
    assert cells[2, 1].get_text().get_text() == ""  # a short row is padded
    assert cells[0, 0].get_text().get_fontweight() == "bold"
    assert cells[1, 0].get_text().get_fontweight() != "bold"


def test_layers_stack_in_list_order_as_on_screen() -> None:
    """The screen draws a later layer's box over an earlier one; so must the
    export (an image inserted after a table covers it)."""
    table = {"kind": "table", "at": AT, "rows": [["a"]], "header": False}
    image = {"kind": "image", "at": AT, "src": _png()}
    fig = _render([table, image])
    main = fig.axes[0]
    (t,) = [c for c in main.get_children() if isinstance(c, Table)]
    (im,) = main.child_axes
    assert im.get_zorder() > t.get_zorder() > max(ln.get_zorder() for ln in main.lines)
    fig = _render([image, table])
    (t,) = [c for c in fig.axes[0].get_children() if isinstance(c, Table)]
    assert t.get_zorder() > fig.axes[0].child_axes[0].get_zorder()


def test_dual_y_draws_layers_over_the_twin() -> None:
    captured: dict[str, Any] = {}
    real = fig_mod.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    with patch.object(fig_mod, "savefig_bytes", grab):
        render_figure(X, [("M", M), ("M2", -M)], fmt="svg", y2_mask=[False, True],
                      overrides={"layers": [INSET]})
    fig = captured["fig"]
    hosts = [a for a in fig.axes if a.child_axes]
    assert len(hosts) == 1 and hosts[0] is not fig.axes[0]  # the twin, drawn last


@pytest.mark.parametrize(
    "bad",
    [
        "nope",
        [{"kind": "chart", "at": AT}],
        [{**INSET, "at": [0, 0, 0, 0.2]}],
        [{**INSET, "x": {**INSET["x"], "lim": [3, 1]}}],
        [{**INSET, "y": {**INSET["y"], "lim": [0, 10]}}],  # log axis through zero
        [{**INSET, "x": {**INSET["x"], "tick_labels": ["0"]}}],
        [{**INSET, "curves": [{"x": [1], "y": [], "color": "#000"}]}],
        [{"kind": "image", "at": AT, "src": "data:image/svg+xml;base64,PHN2Zz4="}],
        [{"kind": "table", "at": AT, "rows": [[1, 2]]}],
    ],
)
def test_malformed_layers_are_rejected(bad: Any) -> None:
    with pytest.raises(ValueError):
        validate_layers(bad)
    with pytest.raises(ValueError):
        _validate_overrides({"layers": bad})


def test_an_unreadable_image_is_a_value_error() -> None:
    with pytest.raises(ValueError):
        _render([{"kind": "image", "at": AT, "src": "data:image/png;base64,AAAA"}])


FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "graph_layers.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_export_draws_the_wire_the_screen_resolved(case: dict[str, Any]) -> None:
    """The shared fixture: ``lib/graphLayersWire.ts`` resolves the inputs to
    exactly this wire (``graphLayersWire.fixture.test.ts``); the export must
    draw exactly these values at exactly these frame fractions."""
    fig = _render(case["wire"])
    main = fig.axes[0]
    fig.canvas.draw()
    p = main.get_position()
    insets = iter(main.child_axes)
    for spec in case["wire"]:
        left, top, w, h = spec["at"]
        if spec["kind"] == "table":
            (table,) = [c for c in main.get_children() if isinstance(c, Table)]
            assert table._bbox == pytest.approx([left, 1 - top - h, w, h])
            continue
        ins = next(insets)
        q = ins.get_position()
        if spec["kind"] == "image":
            assert (q.x0 + q.x1) / 2 == pytest.approx(p.x0 + (left + w / 2) * p.width)
            continue
        assert (q.x0, q.y1) == pytest.approx((p.x0 + left * p.width, p.y1 - top * p.height))
        assert (q.width, q.height) == pytest.approx((w * p.width, h * p.height))
        lines = [ln for ln in ins.lines if ln.get_label() == "_layer"]
        assert len(lines) == len(spec["curves"])
        for ln, c in zip(lines, spec["curves"], strict=True):
            np.testing.assert_array_equal(ln.get_xdata(), c["x"])
            assert ln.get_color() == c["color"]
        if "notice" in spec:  # a framed box, its notice ("" = none) and no axes
            assert [t.get_text() for t in ins.texts] == ([spec["notice"]] if spec["notice"] else [])
            assert not list(ins.get_xticks())
            continue
        for which, ax in (("x", ins.xaxis), ("y", ins.yaxis)):
            want = spec[which]
            lim = ins.get_xlim() if which == "x" else ins.get_ylim()
            assert lim == pytest.approx(tuple(want["lim"]))
            assert list(ax.get_majorticklocs()) == pytest.approx(want["ticks"])
            assert [t.get_text() for t in ax.get_majorticklabels()] == want["tick_labels"]


def test_the_export_route_draws_layers_and_rejects_bad_ones() -> None:
    from fastapi.testclient import TestClient

    from quantized.app import app

    client = TestClient(app)
    ds = {"time": [1.0, 2.0, 3.0], "values": [[1.0], [4.0], [9.0]], "labels": ["a"], "units": ["V"],
          "metadata": {}}
    table = {"kind": "table", "at": AT, "rows": [["Hc"], ["120 Oe"]], "header": True}
    ok = client.post("/api/export/figure", json={
        "dataset": ds, "fmt": "svg", "dpi": 60, "overrides": {"layers": [INSET, table]}})
    assert ok.status_code == 200
    assert b"120 Oe" in ok.content and b"dM/dH" in ok.content
    bad = client.post("/api/export/figure", json={
        "dataset": ds, "fmt": "svg", "overrides": {"layers": [{"kind": "chart", "at": AT}]}})
    assert bad.status_code == 422
