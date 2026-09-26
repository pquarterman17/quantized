"""P2.6 "Missing levels and unbalanced groups are explicit" -- the EXPORT half
of the interactive-vs-export structural parity (the A8 pattern of
``test_export_vector_structure.py``).

``tests/fixtures/wire/level_slots_statplot.json`` is shared with the frontend:
``frontend/src/components/Stage/levelSlotsParity.test.ts`` proves its
``request`` is exactly what the Stat Stage builds from its ``dataset`` AND that
the canvas draw has the same slots, labels and count labels. This file posts
that SAME ``request`` to the real route and reads the SVG back:

  * TICKS -- one x tick per slot, labels in slot order, empty slots included;
  * COUNT LABELS -- each authored label (``n=12``, the caveated ``n=2``+dagger,
    ``n=0``) sits over its OWN tick (same x), in slot order;
  * EMPTY SLOTS draw no glyph (no path starts at their tick x), while every
    filled slot does;
  * FOOTNOTE -- the unbalanced-groups notice is rendered verbatim (wrapped
    inside the figure, whatever the style preset).

``bar_request`` gets the same treatment through ``/api/export/categorical-
figure``: every category keeps its tick, count labels sit over their bars, an
empty category draws no bar, and a null (NaN) mean is accepted.

Plus the calc-level edge cases the fixture does not cover: the connect-means
line BREAKS across an empty slot and at each nested outer factor (both where
the canvas polyline restarts), and the default annotation without
``count_labels`` marks only empty slots.
"""

from __future__ import annotations

import html
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_statplots import render_statplot_figure

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "level_slots_statplot.json"


def _request() -> dict[str, Any]:
    req: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))["request"]
    return req


def _svg(req: dict[str, Any]) -> str:
    resp = client.post("/api/export/statplot-figure", json=req)
    assert resp.status_code == 200, resp.text
    return resp.text


def _group(svg: str, gid: str) -> str:
    start = svg.index(f'id="{gid}"')
    depth, i = 0, svg.rindex("<g", 0, start)
    for m in re.finditer(r"<g\b|</g>", svg[i:]):
        depth += 1 if m.group(0) == "<g" else -1
        if depth == 0:
            return svg[i : i + m.end()]
    raise AssertionError(f"unterminated group {gid}")


_TEXT = re.compile(r'<text[^>]*\sx="([-\d.]+)"[^>]*>([^<]*)</text>')


def _tick_positions(svg: str) -> list[tuple[float, str]]:
    """(x, label) of each x TICK -- read per ``xtick_N`` group, because the
    axis group also holds the axis title text."""
    axis = _group(svg, "matplotlib.axis_1")
    out: list[tuple[float, str]] = []
    for gid in re.findall(r'<g id="(xtick_\d+)">', axis):
        out.extend((float(x), html.unescape(t)) for x, t in _TEXT.findall(_group(axis, gid)))
    return out


def test_every_slot_keeps_its_tick_and_label_in_order() -> None:
    req = _request()
    ticks = _tick_positions(_svg(req))
    assert [t for _, t in ticks] == req["labels"]
    xs = [x for x, _ in ticks]
    assert xs == sorted(xs)


def test_each_count_label_sits_over_its_own_slot() -> None:
    req = _request()
    svg = _svg(req)
    ticks = _tick_positions(svg)
    axis_block = _group(svg, "matplotlib.axis_1")
    outside = svg.replace(axis_block, "")
    by_text: dict[str, list[float]] = {}
    for x, t in _TEXT.findall(outside):
        by_text.setdefault(html.unescape(t), []).append(float(x))
    for (tick_x, _), label in zip(ticks, req["count_labels"], strict=True):
        assert label is not None
        assert any(abs(x - tick_x) < 1e-6 for x in by_text.get(label, [])), (label, tick_x)
    # n=0 exactly once per empty slot -- not dropped, not duplicated.
    assert len(by_text["n=0"]) == sum(1 for g in req["data"] if not g)


def test_an_empty_slot_draws_no_glyph_while_filled_slots_do() -> None:
    req = _request()
    svg = _svg(req)
    for (x, _), group in zip(_tick_positions(svg), req["data"], strict=True):
        starts_here = re.search(rf'd="M {x:g} ', svg) or re.search(rf'd="M {x} ', svg)
        if group:
            assert starts_here, f"filled slot at x={x} drew no whisker/box path"
        else:
            assert not starts_here, f"empty slot at x={x} drew a glyph"


def _footnote_text(svg: str, first_words: str) -> str:
    """The footnote's wrapped lines (one ``<text>`` each), rejoined."""
    start = svg.index(html.escape(first_words, quote=False))
    block = svg[svg.rindex("<g id=", 0, start) : svg.index("</g>", start)]
    return " ".join(html.unescape(t) for t in re.findall(r"<text[^>]*>([^<]*)</text>", block))


def test_the_notice_renders_as_the_footnote() -> None:
    req = _request()
    assert _footnote_text(_svg(req), req["footnote"][:24]) == req["footnote"]


def test_count_labels_sit_ABOVE_the_axes_not_on_the_data() -> None:
    # Inside the axes they landed on the tallest whisker / CI bar (review
    # finding); the canvas draws them above the plot area, and so must this.
    req = _request()
    svg = _svg(req)
    axes_top = min(float(y) for y in re.findall(r"L [\d.]+ ([\d.]+)", _group(svg, "patch_2")))
    ys = [float(y) for y in re.findall(r'<text[^>]*\sy="([\d.]+)"[^>]*>n=', svg)]
    assert ys and all(y < axes_top for y in ys), (ys, axes_top)


def test_place_footnote_wraps_inside_the_figure_in_every_preset() -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from quantized.calc.figure_footnote import place_footnote
    from quantized.calc.figure_styles import figure_style

    text = _request()["footnote"]
    for preset in ("default", "report", "aps"):
        st = figure_style(preset)
        with matplotlib.rc_context({"font.size": st.font_size}):
            fig, _ = plt.subplots(figsize=(st.fig_width_in, st.fig_height_in))
            try:
                rect = place_footnote(fig, text)
                assert rect is not None
                fig.canvas.draw()
                note = fig.texts[-1]
                extent = note.get_window_extent()
                assert extent.x1 <= fig.bbox.width, (preset, extent.x1, fig.bbox.width)
                # the reserved band really holds the text
                assert extent.y1 <= rect[1] * fig.bbox.height + 1, (preset, extent.y1)
            finally:
                plt.close(fig)
    assert place_footnote(None, None) is None


# -- bar mode: the same slots through /api/export/categorical-figure ----------


def _bar_request() -> dict[str, Any]:
    req: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))["bar_request"]
    return req


def _bar_svg(req: dict[str, Any]) -> str:
    resp = client.post("/api/export/categorical-figure", json=req)
    assert resp.status_code == 200, resp.text
    return resp.text


def test_bar_every_category_keeps_its_tick_including_empty_ones() -> None:
    req = _bar_request()
    svg = _bar_svg(req)
    ticks = _tick_positions(svg)
    assert [t for _, t in ticks] == req["groups"]
    # the axis spans every slot, so the trailing empty categories are not left
    # sitting on the right spine (an all-NaN bar has no data extent)
    frame = [float(x) for x in re.findall(r"([\d.]+) [\d.]+", _group(svg, "patch_2"))]
    assert min(frame) < ticks[0][0] and ticks[-1][0] < max(frame)


def test_bar_count_labels_sit_over_their_bars_and_empty_bars_draw_nothing() -> None:
    req = _bar_request()
    svg = _bar_svg(req)
    ticks = _tick_positions(svg)
    texts = [(float(x), html.unescape(t)) for x, t in _TEXT.findall(svg)]
    labels = {t: x for x, t in texts if t.startswith("n=")}
    for (tick_x, _), text in zip(ticks, req["count_labels"], strict=True):
        if text != "n=0":  # two n=0 labels share a dict key; checked below
            assert abs(labels[text] - tick_x) < 1e-6, (text, tick_x)
    xs_n0 = [float(x) for x, t in _TEXT.findall(svg) if t == "n=0"]
    assert len(xs_n0) == 2
    empty_ticks = [x for (x, _), row in zip(ticks, req["values"], strict=True) if row[0] is None]
    assert sorted(xs_n0) == sorted(empty_ticks)
    # Bar rectangles are the clipped PATCH paths; an all-NaN bar emits "M 0 0 z".
    patches = re.findall(r'<g id="patch_\d+">\s*<path d="([^"]+)"[^>]*clip-path', svg)
    assert len(patches) == 4 and sum("L" in p for p in patches) == 2, patches
    assert _footnote_text(svg, req["footnote"][:24]) == req["footnote"]


def test_bar_route_accepts_a_null_mean() -> None:
    # A NaN mean (an empty category) crosses JSON as null; the route used to
    # declare list[list[float]] and 422 on it.
    req = _bar_request()
    assert any(row[0] is None for row in req["values"])
    resp = client.post("/api/export/categorical-figure", json={**req, "fmt": "pdf"})
    assert resp.status_code == 200


def test_without_count_labels_only_empty_slots_are_annotated() -> None:
    svg = render_statplot_figure(
        "strip", [[1.0, 2.0], [], [3.0]], labels=["a", "b", "c"], fmt="svg"
    ).decode("utf-8")
    assert svg.count(">n=0<") == 1
    assert ">n=2<" not in svg and ">n=1<" not in svg


def test_connect_means_breaks_across_an_empty_slot() -> None:
    # slots 1 and 3 are filled, slot 2 is empty: the canvas polyline restarts
    # after a non-finite mean, so the export must NOT draw a 1->3 segment.
    fig = render_statplot_figure(
        "box", [[1.0, 2.0, 3.0], [np.nan], [7.0, 8.0, 9.0]], labels=["a", "b", "c"],
        fmt="svg", show_connect_means=True,
    ).decode("utf-8")
    dashed = re.findall(r'<path d="([^"]+)"[^>]*stroke-dasharray', fig)
    assert dashed == [], "a connect-means segment crossed the empty slot"
    joined = render_statplot_figure(
        "box", [[1.0, 2.0, 3.0], [4.0, 5.0], [7.0, 8.0, 9.0]], labels=["a", "b", "c"],
        fmt="svg", show_connect_means=True,
    ).decode("utf-8")
    control = re.findall(r'<path d="([^"]+)"[^>]*stroke-dasharray', joined)
    assert control, "control: no dashed line drawn"


def test_connect_means_breaks_at_each_new_outer_factor_of_a_nested_plot() -> None:
    # The canvas (statstage.connectMeansBreaks) starts a new segment at every
    # new outer level; the export drew one line across lots until this fix.
    labels = ["lot = 0 / w = 0", "lot = 0 / w = 1", "lot = 1 / w = 0", "lot = 1 / w = 1"]
    svg = render_statplot_figure(
        "box", [[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]], labels=labels,
        fmt="svg", show_connect_means=True,
    ).decode("utf-8")
    dashed = re.findall(r'<path d="([^"]+)"[^>]*stroke-dasharray', svg)
    assert len(dashed) == 2, dashed
    assert all(d.count("L") == 1 for d in dashed)  # two points per lot


def test_a_labels_data_mismatch_is_a_descriptive_422() -> None:
    req = {**_request(), "labels": ["only one"]}
    resp = client.post("/api/export/statplot-figure", json=req)
    assert resp.status_code == 422
    assert "one entry per group" in resp.text
