"""A8 acceptance journey (FIGURE_AUTHORING_WORKFLOW_PLAN, ~line 1514):
"Export SVG/PDF and compare limits, ticks, text, legend, errors,
annotations, and panel placement."

This is the STRUCTURAL half of that comparison: what Stage's figure spec
says (axis limits, tick positions/labels, title/axis-label text, legend
entries, error spans, annotations, panel placement) versus what the real
export routes (``/api/export/figure``, ``/api/export/figure-hitmap``,
``/api/export/figure-page``) actually put into the rendered SVG/PDF bytes.
Every render below goes through the real FastAPI routes (``TestClient``),
never a hand-rolled matplotlib call — so a route-layer regression (e.g. a
dropped kwarg in ``routes.export_figures``) is just as reachable as a
``calc/`` one.

What is compared, and how:
  * axis LIMITS -- ``/api/export/figure-hitmap``'s ``axes.xlim``/``ylim``
    (exact floats the renderer actually set, harvested via
    ``calc.figure_hitmap.collect_map``'s own ``ax.get_xlim()``/
    ``get_ylim()`` -- not re-derived here) against the requested
    ``overrides["x_lim"]``/``["y_lim"]``.
  * TICKS -- the exact tick-label strings the requested ``x_step`` +
    ``x_fmt`` produce, read literally out of the exported SVG's
    ``matplotlib.axis_1`` group (matplotlib emits the tick value as plain
    ``<text>`` content, not a raster glyph).
  * TEXT -- title/axis-label strings appear as rendered glyphs (rich-text
    mathtext renders as real Unicode -- mu/Å -- not the raw ``$...$``
    markup, which only ever appears inside an XML *comment* matplotlib
    emits alongside the real ``<tspan>`` content).
  * LEGEND -- ``<g id="legend_1">``'s child ``<text>`` entries, exact
    strings AND order.
  * ERRORS -- an error-span series draws a ``LineCollection`` (the bar) in
    the SVG; its absence means the export silently dropped the uncertainty.
  * ANNOTATIONS -- each annotation's text appears exactly once, standalone
    (not swallowed into the legend or a tick label).
  * WATERFALL (BUG-013) -- a `waterfall_offsets` request really shifts each
    series line by its own amount, measured from the hit-map's own series
    pixel boxes converted back to data units, and widens the autoscaled
    y-axis to fit the stagger.
  * PANEL PLACEMENT -- a 2x2 page's four ``axes_N`` groups' own background-
    patch pixel rects tile a 2x2 grid in row-major order, and each panel's
    own title text lands inside the geometrically-correct ``axes_N`` block.

What is NOT compared (out of scope for this suite):
  * Byte-identity of the SVG (it carries a build timestamp/UUID in some
    matplotlib versions) -- every assertion below is structural/textual.
  * Sub-pixel text placement, font metrics, or anti-aliasing -- "the text
    is present, in the right group, in the right order" is checked, not
    "the glyph outline is identical".
  * PDF text extraction -- neither ``pypdf`` nor ``pdfminer`` is a project
    dependency (checked against ``pyproject.toml``); PDF assertions here
    are limited to the file magic, media type, and the real PDF *page
    count* (via a ``/Type /Page`` object-count regex on the raw bytes --
    no library needed for that one structural fact).
  * The frontend's on-screen render -- ``figureSpec.a8.test.ts`` pins that
    the WIRE payload built from a document carries every one of these
    fields; this file is the other half, proving the SERVER honors them.
"""

from __future__ import annotations

import math
import re
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

_N = 40

# ---------------------------------------------------------------------------
# Fixture: one dataset, one flat-figure payload exercising every dimension
# the A8 journey names, and one 2x2 page payload for panel placement.
# ---------------------------------------------------------------------------


def _dataset() -> dict[str, Any]:
    xs = [10.0 * i / (_N - 1) for i in range(_N)]
    a = [math.sin(v) for v in xs]
    b = [math.cos(v) for v in xs]
    c = [0.1 * v for v in xs]
    return {
        "time": xs,
        "values": [[a[i], b[i], c[i]] for i in range(_N)],
        "labels": ["Series A", "Series B", "Series C"],
        "units": ["au", "au", "au"],
        "metadata": {},
    }


_ERROR_MAG = [0.15] * _N
_LEGEND_ENTRIES = ["Series A (au)", "Series B (au)", "Series C (au)"]
_ANNOTATION_TEXTS = ("peak note", "dip note")


def _fixture_payload(fmt: str = "svg") -> dict[str, Any]:
    """A single-panel figure exercising limits, ticks, rich text, a
    3-series legend, one series' error spans, two annotations, and an
    arrow shape -- everything A8 names except panel placement (covered by
    ``_page_payload`` below, since placement is meaningless for one panel)."""
    return {
        "dataset": _dataset(),
        "y_keys": [0, 1, 2],
        "fmt": fmt,
        "title": r"Field $\mu_0 H$ ($\AA^{-1}$)",
        "x_label": "Field",
        "y_label": "Signal",
        "x_step": 1.0,
        "x_fmt": {"mode": "fixed", "digits": 1},
        "error_spans": [{"y": {"plus": _ERROR_MAG, "minus": _ERROR_MAG}}, None, None],
        "overrides": {
            "x_lim": [1.0, 9.0],
            "y_lim": [-1.5, 1.5],
            "legend": {"show": True, "loc": "upper right"},
            "annotations": [
                {"x": 3.0, "y": 0.5, "text": "peak note"},
                {"x": 6.0, "y": -0.5, "text": "dip note"},
            ],
            "shapes": [{"kind": "arrow", "x1": 2.0, "y1": 1.0, "x2": 4.0, "y2": 1.2}],
        },
        "filename": "a8_fixture",
    }


def _page_payload(fmt: str = "svg") -> dict[str, Any]:
    """A 2x2 page, one series per panel, panel titles A/B/C/D in row-major
    placement order -- the placement half of the A8 journey."""
    ds = _dataset()

    def _panel(row: int, col: int, key: int, title: str) -> dict[str, Any]:
        return {
            "figure": {"dataset": ds, "y_keys": [key], "title": title},
            "row": row,
            "col": col,
        }

    return {
        "rows": 2,
        "cols": 2,
        "fmt": fmt,
        "panels": [
            _panel(0, 0, 0, "Panel A"),
            _panel(0, 1, 1, "Panel B"),
            _panel(1, 0, 2, "Panel C"),
            _panel(1, 1, 0, "Panel D"),
        ],
        "filename": "a8_page",
    }


# ---------------------------------------------------------------------------
# SVG structural helpers: matplotlib's SVG backend is stable enough (see
# tests/test_calc_figure.py's existing "search the SVG text" precedent) to
# read structurally, not just for substring containment -- these helpers do
# depth-aware `<g id="...">...</g>` extraction so a nested legend/tick group
# never gets truncated early by the first unrelated `</g>` after it.
# ---------------------------------------------------------------------------


def _extract_group(svg: str, gid: str) -> str:
    """The full ``<g id="{gid}">...</g>`` subtree, matching the closing tag
    by nesting DEPTH (not the next literal ``</g>``) so a group that itself
    contains child groups (legend entries, axis ticks, ...) is returned
    whole."""
    m = re.search(rf'<g id="{re.escape(gid)}">', svg)
    assert m, f'<g id="{gid}"> not found in SVG'
    depth = 1
    pos = m.end()
    for tm in re.finditer(r"<g\b|</g>", svg[pos:]):
        if tm.group() == "</g>":
            depth -= 1
            if depth == 0:
                return svg[m.start() : pos + tm.end()]
        else:
            depth += 1
    raise AssertionError(f"unbalanced <g> nesting for {gid!r}")


_RECT_PATH_RE = re.compile(
    r"<path d=\"M\s+([\d.]+)\s+([\d.]+)\s*\n"
    r"L\s+([\d.]+)\s+([\d.]+)\s*\n"
    r"L\s+([\d.]+)\s+([\d.]+)\s*\n"
    r"L\s+([\d.]+)\s+([\d.]+)\s*\n"
    r"z"
)


def _axes_bbox_px(axes_block: str) -> tuple[float, float, float, float]:
    """(x0, y0, x1, y1) pixel rect of an axes group's OWN background patch
    (``ax.patch``, always the first child path in the group) -- SVG pixel
    coordinates, y growing DOWNWARD."""
    m = _RECT_PATH_RE.search(axes_block)
    assert m, "axes background rect (ax.patch) not found in this axes block"
    xs = [float(m.group(i)) for i in (1, 3, 5, 7)]
    ys = [float(m.group(i)) for i in (2, 4, 6, 8)]
    return min(xs), min(ys), max(xs), max(ys)


def _legend_entries(svg: str) -> list[str]:
    legend = _extract_group(svg, "legend_1")
    return re.findall(r"<text[^>]*>([^<]*)</text>", legend)


def _pdf_page_count(pdf_bytes: bytes) -> int:
    """Count real ``/Type /Page`` objects (word-boundary'd so ``/Pages``,
    the page-TREE root every PDF also has exactly one of, never counts) --
    no PDF library needed for this one structural fact (none is a project
    dependency; see this module's docstring)."""
    return len(re.findall(rb"/Type\s*/Page\b", pdf_bytes))


# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------


def test_axis_limits_match_the_requested_overrides() -> None:
    # The hit-map route harvests `ax.get_xlim()`/`get_ylim()` directly off
    # the SAME rendered Axes the SVG/PDF export draws -- the ground truth
    # for "did the requested x_lim/y_lim actually apply", independent of
    # any pixel-to-data reconstruction from the SVG.
    resp = client.post("/api/export/figure-hitmap", json=_fixture_payload("png"))
    assert resp.status_code == 200, resp.text
    axes = resp.json()["axes"]
    assert axes["xlim"] == [1.0, 9.0]
    assert axes["ylim"] == [-1.5, 1.5]


def test_axis_limits_clip_the_ticks_to_the_requested_range() -> None:
    # The x_lim=[1, 9] + x_step=1 combination is only meaningful if BOTH
    # applied: a dropped x_lim would still show a step-1 sequence, just not
    # bounded to [1, 9] (e.g. a 0.0 or 10.0 tick would leak in).
    resp = client.post("/api/export/figure", json=_fixture_payload("svg"))
    svg = resp.content.decode("utf-8", "ignore")
    xaxis = _extract_group(svg, "matplotlib.axis_1")
    x_ticks = re.findall(r"<text[^>]*>([^<]*)</text>", xaxis)
    assert x_ticks[:-1] == [f"{v}.0" for v in range(1, 10)]  # last entry is the x label
    assert "0.0" not in x_ticks[:-1]
    assert "10.0" not in x_ticks


# ---------------------------------------------------------------------------
# Ticks (custom step + explicit number format)
# ---------------------------------------------------------------------------


def test_tick_labels_use_the_requested_step_and_format() -> None:
    resp = client.post("/api/export/figure", json=_fixture_payload("svg"))
    svg = resp.content.decode("utf-8", "ignore")
    xaxis = _extract_group(svg, "matplotlib.axis_1")
    for v in range(1, 10):
        assert f"{v}.0" in xaxis  # x_fmt={"mode": "fixed", "digits": 1}, x_step=1.0


# ---------------------------------------------------------------------------
# Text: rich-text title + plain axis labels
# ---------------------------------------------------------------------------


def test_title_and_axis_labels_render_with_rich_text_glyphs() -> None:
    resp = client.post("/api/export/figure", json=_fixture_payload("svg"))
    svg = resp.content.decode("utf-8", "ignore")
    assert "Field" in svg  # x_label, plain text
    assert "Signal" in svg  # y_label, plain text
    # Rich-text mathtext title ($\mu_0 H$ ($\AA^{-1}$)) renders as real
    # glyphs, not the raw markup: mu, H, and Å must appear as RENDERED
    # <tspan> content.
    rendered = "".join(re.findall(r"<tspan[^>]*>([^<]*)</tspan>", svg))
    assert "μ" in rendered
    assert "Å" in rendered
    # The raw source only ever appears inside matplotlib's own XML comment
    # (harmless, unrendered) -- the RENDERED text must never contain the
    # literal markup.
    assert "\\mu_0" not in rendered
    assert "\\AA" not in rendered


# ---------------------------------------------------------------------------
# Legend: exact entries, exact order
# ---------------------------------------------------------------------------


def test_legend_has_exactly_the_requested_entries_in_order() -> None:
    resp = client.post("/api/export/figure", json=_fixture_payload("svg"))
    svg = resp.content.decode("utf-8", "ignore")
    assert _legend_entries(svg) == _LEGEND_ENTRIES


# ---------------------------------------------------------------------------
# Errors: an error-span series draws a real error-bar collection
# ---------------------------------------------------------------------------


def test_error_spans_render_a_line_collection() -> None:
    resp = client.post("/api/export/figure", json=_fixture_payload("svg"))
    svg = resp.content.decode("utf-8", "ignore")
    assert '<g id="LineCollection_1">' in svg


# ---------------------------------------------------------------------------
# Annotations: text present exactly once, standalone (not the legend/ticks)
# ---------------------------------------------------------------------------


def test_annotations_render_standalone_not_swallowed_by_the_legend() -> None:
    resp = client.post("/api/export/figure", json=_fixture_payload("svg"))
    svg = resp.content.decode("utf-8", "ignore")
    legend = _extract_group(svg, "legend_1")
    for text in _ANNOTATION_TEXTS:
        assert svg.count(text) == 1, f"{text!r} should appear exactly once"
        assert text not in legend


def test_arrow_annotation_renders_as_its_own_shape_group() -> None:
    # A line/arrow "annotation" (calc.figure_shapes) is a distinct drawn
    # artist from a text annotation, tagged with a stable gid so it can be
    # told apart from ordinary series/tick lines.
    resp = client.post("/api/export/figure", json=_fixture_payload("svg"))
    svg = resp.content.decode("utf-8", "ignore")
    assert '<g id="shape:0">' in svg


# ---------------------------------------------------------------------------
# PDF: format sanity + real page count (no PDF library available/needed)
# ---------------------------------------------------------------------------


def test_pdf_export_is_a_single_page_with_the_requested_content_type() -> None:
    resp = client.post("/api/export/figure", json=_fixture_payload("pdf"))
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:5] == b"%PDF-"
    assert _pdf_page_count(resp.content) == 1


def test_page_pdf_export_is_a_single_page() -> None:
    # A 2x2 page composes four panels onto ONE rendered page -- still one
    # PDF page, not four.
    resp = client.post("/api/export/figure-page", json=_page_payload("pdf"))
    assert resp.status_code == 200, resp.text
    assert resp.content[:5] == b"%PDF-"
    assert _pdf_page_count(resp.content) == 1


# ---------------------------------------------------------------------------
# Panel placement: a 2x2 page's four axes tile a grid in row-major order
# ---------------------------------------------------------------------------


def test_page_2x2_panels_tile_the_grid_in_row_major_order() -> None:
    resp = client.post("/api/export/figure-page", json=_page_payload("svg"))
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")

    blocks = {i: _extract_group(svg, f"axes_{i}") for i in range(1, 5)}
    boxes = {i: _axes_bbox_px(blocks[i]) for i in range(1, 5)}
    a_x0, a_y0, a_x1, a_y1 = boxes[1]
    b_x0, b_y0, b_x1, b_y1 = boxes[2]
    c_x0, c_y0, c_x1, c_y1 = boxes[3]
    d_x0, d_y0, d_x1, d_y1 = boxes[4]

    # Row 0 (axes_1/A, axes_2/B) sits ABOVE row 1 (axes_3/C, axes_4/D) --
    # SVG y grows downward, so a smaller y is higher on the page.
    assert a_y1 <= c_y0 + 1e-6
    assert b_y1 <= d_y0 + 1e-6
    # Col 0 (A, C) sits LEFT of col 1 (B, D).
    assert a_x1 <= b_x0 + 1e-6
    assert c_x1 <= d_x0 + 1e-6
    # Same-row panels share a y-extent; same-column panels share an x-extent
    # (a real grid, not four arbitrarily placed boxes).
    assert (a_y0, a_y1) == (b_y0, b_y1)
    assert (c_y0, c_y1) == (d_y0, d_y1)
    assert (a_x0, a_x1) == (c_x0, c_x1)
    assert (b_x0, b_x1) == (d_x0, d_x1)

    # Each panel's OWN title lands inside the geometrically-correct axes_N
    # block -- proof the authored row/col order and the rendered grid
    # position agree, not just that four boxes happen to tile a grid.
    assert "Panel A" in blocks[1]
    assert "Panel B" in blocks[2]
    assert "Panel C" in blocks[3]
    assert "Panel D" in blocks[4]


# ---------------------------------------------------------------------------
# Waterfall: the per-series stagger the canvas draws reaches the render
# (BUG-013). Read STRUCTURALLY -- where the series line actually lands in the
# rendered Axes, recovered from the hit-map's own pixel boxes + the axis
# limits the renderer set, never re-derived from the request.
# ---------------------------------------------------------------------------

_WATERFALL_YLIM = [-2.0, 5.0]


def _waterfall_payload(offsets: list[float] | None, *, fixed_ylim: bool = True) -> dict[str, Any]:
    """Two series (sin, cos -- both inside [-1, 1]) so a stagger is
    unambiguous. With ``fixed_ylim`` the y-range is pinned wide enough for
    both renders, which makes the two pixel boxes directly comparable."""
    payload: dict[str, Any] = {
        "dataset": _dataset(),
        "y_keys": [0, 1],
        "fmt": "png",
        "filename": "waterfall",
    }
    if fixed_ylim:
        payload["overrides"] = {"y_lim": _WATERFALL_YLIM}
    if offsets is not None:
        payload["waterfall_offsets"] = offsets
    return payload


def _series_data_span(hitmap: dict[str, Any], index: int) -> tuple[float, float]:
    """(y_min, y_max) of series ``index`` in DATA units, converted from the
    hit-map's pixel box with the axes rect + ``ylim`` the renderer reported."""
    axes = hitmap["axes"]
    box = next(e for e in hitmap["elements"] if e["id"] == f"series:{index}")
    lo, hi = axes["ylim"]
    span_px = axes["y1"] - axes["y0"]

    def to_data(py: float) -> float:
        return hi - (py - axes["y0"]) / span_px * (hi - lo)

    return to_data(box["y1"]), to_data(box["y0"])


def _hitmap(payload: dict[str, Any]) -> dict[str, Any]:
    resp = client.post("/api/export/figure-hitmap", json=payload)
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


def test_waterfall_offsets_shift_each_series_by_its_own_amount() -> None:
    plain = _hitmap(_waterfall_payload(None))
    staggered = _hitmap(_waterfall_payload([0.0, 2.0]))
    # Both renders share the same fixed y-range, so a pixel box is directly
    # comparable; the stroke-width padding cancels in the DIFFERENCE.
    for index, want_shift in ((0, 0.0), (1, 2.0)):
        before = _series_data_span(plain, index)
        after = _series_data_span(staggered, index)
        assert after[0] - before[0] == pytest.approx(want_shift, abs=0.05)
        assert after[1] - before[1] == pytest.approx(want_shift, abs=0.05)


def test_waterfall_offsets_are_absent_by_default() -> None:
    """Omitting the field renders exactly what it always did -- the offsets
    are opt-in, so no existing export moves."""
    plain = _hitmap(_waterfall_payload(None))
    explicit_zero = _hitmap(_waterfall_payload([0.0, 0.0]))
    for index in (0, 1):
        assert _series_data_span(explicit_zero, index) == pytest.approx(
            _series_data_span(plain, index), abs=1e-9
        )


def test_waterfall_offsets_widen_the_autoscaled_axis_to_fit_the_stagger() -> None:
    """The canvas autoscales over the OFFSET values, so the vector export must
    too -- otherwise the staggered curves are drawn off the top of the axes."""
    plain = _hitmap(_waterfall_payload(None, fixed_ylim=False))
    staggered = _hitmap(_waterfall_payload([0.0, 3.0], fixed_ylim=False))
    assert plain["axes"]["ylim"][1] < 2.0  # sin/cos alone
    assert staggered["axes"]["ylim"][1] > 3.0  # the shifted cos is inside the axes


def test_waterfall_offsets_leave_the_legend_and_axis_labels_alone() -> None:
    payload = _waterfall_payload([0.0, 2.0])
    payload["fmt"] = "svg"
    payload["title"] = "Stagger"
    payload["x_label"] = "Field"
    payload["y_label"] = "Signal"
    payload["overrides"] = {"y_lim": _WATERFALL_YLIM, "legend": {"show": True}}
    resp = client.post("/api/export/figure", json=payload)
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    assert _legend_entries(svg) == _LEGEND_ENTRIES[:2]
    assert "Field" in svg and "Signal" in svg and "Stagger" in svg


# ---------------------------------------------------------------------------
# Legend renames (BUG-014): `series_styles[i].legend` is used VERBATIM
# ---------------------------------------------------------------------------


def _renamed_payload(legends: list[str | None]) -> dict[str, Any]:
    """The fixture figure with a per-series legend override on some series.

    The override rides the SAME per-series presentation list colour/width/dash
    already ride, and the wire ``dataset`` keeps the DATA's labels and units --
    which is the whole point of BUG-014: the renderer must not re-derive
    "label (unit)" from those bytes once the user has renamed the series.
    """
    payload = _fixture_payload("svg")
    payload["overrides"] = {"legend": {"show": True, "loc": "upper right"}}
    payload["series_styles"] = [
        None if legend is None else {"legend": legend} for legend in legends
    ]
    return payload


def test_a_renamed_series_renders_its_legend_text_exactly() -> None:
    # "Loop 1", not "Loop 1 (au)": the channel's own unit is NOT appended to a
    # user-supplied legend, which is what the on-screen legend does too.
    payload = _renamed_payload(["Loop 1", None, None])
    # The request POSTED below still names the channel "Series A" and carries
    # its unit -- the rename reaches the renderer through the presentation
    # field alone, so "Loop 1" in the legend can only have come from there.
    assert payload["dataset"]["labels"][0] == "Series A"
    assert payload["dataset"]["units"][0] == "au"
    resp = client.post("/api/export/figure", json=payload)
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    assert _legend_entries(svg) == ["Loop 1", "Series B (au)", "Series C (au)"]
    # ... and the un-renamed "Series A (au)" the same bytes would otherwise
    # compose appears nowhere in the rendered figure.
    assert "Series A" not in svg


def test_an_unrenamed_series_still_gets_its_unit_appended() -> None:
    # The common case must not regress: with no `legend` anywhere the legend is
    # byte-for-byte the pre-BUG-014 one.
    resp = client.post("/api/export/figure", json=_renamed_payload([None, None, None]))
    svg = resp.content.decode("utf-8", "ignore")
    assert _legend_entries(svg) == _LEGEND_ENTRIES


def test_a_renamed_solo_series_titles_its_axis_with_the_same_text() -> None:
    # ``soloLabel`` on screen reads the RESOLVED legend, so the auto-derived
    # y-axis title of a single-series figure has to read the rename too --
    # otherwise the axis says "Series A (au)" under a legend saying "Loop 1".
    payload = _renamed_payload(["Loop 1"])
    payload["y_keys"] = [0]
    payload["error_spans"] = [None]
    payload.pop("y_label")
    resp = client.post("/api/export/figure", json=payload)
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    assert _legend_entries(svg) == ["Loop 1"]
    assert "Loop 1" in svg
    assert "Series A" not in svg


def test_an_empty_rename_drops_the_series_from_the_rendered_legend() -> None:
    # RESIDUAL DIVERGENCE, pinned deliberately rather than "fixed" (BUG-014
    # review round, NIT 4). An empty rename is honoured VERBATIM on the wire
    # and by `series_display_name` -- but matplotlib treats a zero-length
    # label the way it treats a leading "_" and omits the artist from the
    # legend entirely, so the series loses its ROW here while uPlot still
    # draws a blank row with its swatch on screen. "Identical text" therefore
    # degenerates to "blank row vs no row" for `""` alone.
    #
    # Not papered over with a " ": which of the two legs should move is a
    # product decision, and a space would silently change what the user typed.
    # The pre-BUG-014 wire rendered " (au)" here, so this is a change from one
    # divergence to another, and the point of this test is that the change is
    # a chosen, visible one.
    payload = _renamed_payload(["", None, None])
    assert payload["series_styles"][0] == {"legend": ""}
    resp = client.post("/api/export/figure", json=payload)
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    assert _legend_entries(svg) == ["Series B (au)", "Series C (au)"]
    # Specifically NOT the derived label: the empty override was honoured, it
    # just left matplotlib nothing to draw.
    assert "Series A" not in svg


def test_a_non_string_legend_degrades_instead_of_422ing_the_export() -> None:
    # Same degrade-gracefully contract as every other key in that loose dict.
    payload = _renamed_payload([None, None, None])
    payload["series_styles"] = [{"legend": 7}, None, None]
    resp = client.post("/api/export/figure", json=payload)
    assert resp.status_code == 200, resp.text
    assert _legend_entries(resp.content.decode("utf-8", "ignore")) == _LEGEND_ENTRIES


def test_a_grouped_export_folds_the_rename_into_its_per_level_labels() -> None:
    # The group branch expands each channel into one series per level, so a
    # rename cannot name a finished series there; it replaces the CHANNEL-label
    # half of "{label} ({group}={level})". Grouped export parity as a whole is
    # BUG-016 -- this only pins that the rename still reaches that branch.
    payload = _renamed_payload(["Loop 1", None, None])
    payload["y_keys"] = [0]
    payload["error_spans"] = [None]
    payload["group_col"] = 2
    payload["dataset"]["values"] = [
        [row[0], row[1], float(i % 2)] for i, row in enumerate(payload["dataset"]["values"])
    ]
    resp = client.post("/api/export/figure", json=payload)
    assert resp.status_code == 200, resp.text
    assert _legend_entries(resp.content.decode("utf-8", "ignore")) == [
        "Loop 1 (Series C=0) (au)",
        "Loop 1 (Series C=1) (au)",
    ]


# ---------------------------------------------------------------------------
# Grouped per-series styling (BUG-016)
#
# The ``group_col`` branch expands every plotted channel into one synthetic
# series per group level, and the CANVAS hands each of those levels the
# channel's one style object (``Stage/usePlotPayload.ts``'s ``styleList`` over
# ``plotGroupSplit.groupSplitChannelMap`` -> ``lib/uplotOpts.buildOpts``).
# Until BUG-016 the branch dropped ``series_styles`` outright, so a figure the
# user styled red/dashed/3px on screen exported solid, default-width and in
# matplotlib's default cycle. A wire-level assertion could not see that (the
# spec carried the style the renderer ignored), which is how it survived -- so
# these read the RENDERED artists out of the SVG, like the rest of this file.
# ---------------------------------------------------------------------------

_GROUP_LEVELS = 3

# The drawn line of a DASHED series: matplotlib writes the dash pattern, the
# stroke and the width into one `style="..."` attribute, in this order. The
# width group is optional because matplotlib omits `stroke-width` at SVG's own
# default of 1 -- every width asserted below is deliberately something else.
_STYLED_LINE_RE = re.compile(
    r'style="fill: none; stroke-dasharray: ([\d.,]+); stroke-dashoffset: 0; '
    r'stroke: (#[0-9a-f]{6})(?:; stroke-width: ([\d.]+))?"'
)
# An UNDASHED data line. The trailing `stroke-linecap` is what separates these
# from the axes spines (which carry a `stroke-linejoin` first) and the grid
# lines (a `stroke-opacity`), so this matches only the curves.
_PLAIN_LINE_RE = re.compile(
    r'style="fill: none; stroke: (#[0-9a-f]{6}); stroke-width: ([\d.]+); stroke-linecap: square"'
)
# matplotlib's square marker glyph: four straight corners. The DEFAULT marker
# is a circle, whose path is cubic Beziers ("C ..."), so this distinguishes
# "the requested shape reached the renderer" from "a marker was drawn".
_SQUARE_GLYPH = "M -2.5 2.5 L 2.5 2.5 L 2.5 -2.5 L -2.5 -2.5 z"


def _grouped_dataset() -> dict[str, Any]:
    """Two value channels plus a 3-level group column, two rows per level."""
    return {
        "time": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
        "values": [
            [1.0, 7.0, 0.0],
            [2.0, 8.0, 0.0],
            [3.0, 9.0, 1.0],
            [4.0, 10.0, 1.0],
            [5.0, 11.0, 2.0],
            [6.0, 12.0, 2.0],
        ],
        "labels": ["Value", "Other", "Group"],
        "units": ["V", "V", ""],
        "metadata": {},
    }


def _grouped_plot_area(**extra: Any) -> str:
    """The rendered ``axes_1`` subtree MINUS its legend: matplotlib draws a
    second copy of every series' style as that series' legend handle, so the
    data curves can only be counted with the legend cut away."""
    payload = {"dataset": _grouped_dataset(), "fmt": "svg", "group_col": 2, **extra}
    resp = client.post("/api/export/figure", json=payload)
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    axes = _extract_group(svg, "axes_1")
    legend = axes.find('<g id="legend_1">')
    return axes if legend < 0 else axes[:legend]


def test_a_grouped_export_draws_every_level_with_its_channel_style() -> None:
    # BUG-016's headline case: ONE channel, ONE style entry, three levels --
    # all three curves red, dashed, 3px, with the requested square marker.
    plot = _grouped_plot_area(
        y_keys=[0],
        series_styles=[
            {
                "color": "#ff0000",
                "line": "dashed",
                "width": 3,
                "marker": True,
                "marker_shape": "square",
            }
        ],
    )
    lines = _STYLED_LINE_RE.findall(plot)
    assert len(lines) == _GROUP_LEVELS
    assert {stroke for _dash, stroke, _w in lines} == {"#ff0000"}
    assert {width for _dash, _stroke, width in lines} == {"3"}
    # One dash PATTERN, shared by every level. The pattern's exact numbers are
    # matplotlib's (they scale with linewidth) and not this test's business;
    # "every level is dashed, identically" is.
    assert len({dash for dash, _s, _w in lines}) == 1
    # The requested marker SHAPE, not merely "a marker": the default is a
    # circle, drawn with Bezier segments.
    assert _SQUARE_GLYPH in " ".join(plot.split())


def test_a_grouped_export_maps_each_level_back_to_its_own_channel_style() -> None:
    # The MAPPING, not just the expansion: synthetic series `i` belongs to
    # channel `i // levels` (`calc.figure_group_styles`), so two differently
    # styled channels must not bleed into each other's levels. An
    # "apply series_styles[0] to everything" implementation passes the test
    # above and fails here.
    plot = _grouped_plot_area(
        y_keys=[0, 1],
        series_styles=[
            {"color": "#ff0000", "line": "dashed", "width": 3},
            {"color": "#0000ff", "line": "dotted", "width": 5},
        ],
    )
    lines = _STYLED_LINE_RE.findall(plot)
    assert len(lines) == 2 * _GROUP_LEVELS
    # Channel-major, level-minor -- the nesting `build_grouped_series` uses.
    assert [stroke for _d, stroke, _w in lines] == ["#ff0000"] * 3 + ["#0000ff"] * 3
    assert [width for _d, _s, width in lines] == ["3"] * 3 + ["5"] * 3
    # The two dash PATTERNS differ (dashed vs dotted), so `line` was read per
    # channel rather than copied from the first entry.
    assert len({dash for dash, _s, _w in lines}) == 2


def test_a_grouped_export_with_no_series_styles_still_cycles_its_levels() -> None:
    # The acceptance criterion the fix must NOT break: with nothing to honour,
    # the rendering is the pre-BUG-016 one -- matplotlib's own property cycle
    # gives each level its own colour and nothing is dashed. It is also what
    # keeps the canvas' per-LEVEL palette cycle matched in STRUCTURE for an
    # UNCOLOURED channel, for which the client omits `color` entirely (see
    # `calc.figure_group_styles`' module doc).
    plot = _grouped_plot_area(y_keys=[0])
    strokes = [stroke for stroke, _w in _PLAIN_LINE_RE.findall(plot)]
    assert len(strokes) == _GROUP_LEVELS
    assert len(set(strokes)) == _GROUP_LEVELS  # one cycle colour per level
    assert not _STYLED_LINE_RE.findall(plot)  # nothing dashed


def test_a_grouped_export_cycles_the_levels_of_a_styled_but_UNCOLOURED_channel() -> None:
    # BUG-016 round 3, the RENDERED half of the frontend's provenance rule.
    # `test_..._with_no_series_styles_still_cycles_its_levels` covers
    # ``series_styles=None``; this covers the shape the client actually sends
    # for a grouped channel whose colour was the palette's and not the user's:
    # a real style entry with ``color`` OMITTED. Every level must take its own
    # cycle colour, matching the canvas, which paints its three levels three
    # different ``--series-N`` slots. Sending the channel's one slot instead --
    # what a pinned array did before this round, and again after any theme
    # change under round 2's palette comparison -- paints all three one hue.
    plot = _grouped_plot_area(
        y_keys=[0],
        series_styles=[{"line": "dashed", "width": 3}],
    )
    lines = _STYLED_LINE_RE.findall(plot)
    assert len(lines) == _GROUP_LEVELS
    # The style half still expands onto every level...
    assert {width for _d, _s, width in lines} == {"3"}
    assert len({dash for dash, _s, _w in lines}) == 1
    # ...and the colour half cycles, three distinct strokes rather than one.
    assert len({stroke for _d, stroke, _w in lines}) == _GROUP_LEVELS


def test_a_grouped_export_does_not_colour_map_a_level() -> None:
    # `color_by` is DROPPED on this branch, because the canvas drops it too:
    # `Stage/usePlotPayload.ts` builds its `colorByColumns` map only when
    # `groupCol === null`, so a grouped canvas draws an ordinary styled line
    # for such a channel. Honouring it here would put a point cloud and a
    # colourbar in the PDF that the screen never showed.
    plot = _grouped_plot_area(
        y_keys=[0],
        series_styles=[{"color": "#ff0000", "line": "dashed", "width": 3, "color_by": 1}],
    )
    lines = _STYLED_LINE_RE.findall(plot)
    assert len(lines) == _GROUP_LEVELS
    assert {stroke for _d, stroke, _w in lines} == {"#ff0000"}
