"""P1.4 residuals 4 and 5 -- a GRADIENT Color-by and TEXT-COLUMN factors, export parity.

The BACKEND half of the screen <-> export check, the sibling of
``tests/test_export_graph_encoding.py``. ``frontend/src/lib/
plotEncodingGradient.test.ts`` builds, from ONE ``plotEncoding.encodeSpec``
derivation, both what the Graph Builder preview draws and the export request,
and pins the pair as ``tests/fixtures/wire/graph_encoding_gradient.json``
(``{"request", "screen"}``). The Stage, Publication Preview and a plot window's
own export are pinned to the same file on the frontend. This file posts that
request to the real ``/api/export/figure`` route and reads the SVG back:

* every drawn point, series by series, has exactly the fill the screen paints
  (``colorScatterFill`` -> ``calc.figure_colorscatter.gradient_colors``: the
  screen's stops and range, not matplotlib's own viridis table);
* each series draws the glyph of its text-column Symbol level;
* the legend text comes from the text-column label source, verbatim;
* exactly one colourbar, labelled as the screen's colour scale, over its range.

Only the gradient's COLUMN and the text columns' NAMES ride the wire; the
backend derives the scale (``calc.plotting_encoded.gradient_spec``) and appends
the text factors (``calc.encoding_text.append_text_factors``) as ports of the
screen's ``encodedGradient`` / ``encodingData``. The calc checks below pin
each port against the fixture's ``screen``, and the stops copy against the
frontend table.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from _regression_matrix_wire import axes_minus_legend, legend_entries
from quantized.app import app
from quantized.calc.encoding_text import append_text_factors, text_column_cells
from quantized.calc.figure_colorscatter import GRADIENT_STOPS, draw_color_scatter, gradient_colors
from quantized.calc.figure_styles import figure_style
from quantized.calc.plotting_encoded import build_encoded_series, gradient_spec
from quantized.datastruct import DataStruct

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "graph_encoding_gradient.json"
_COLLECTION = re.compile(r'<g id="(PathCollection_\d+)">')
# A scatter point is either a <use> of a shared marker definition or, for a few
# points, an inline <path>; both carry the point's own fill.
_POINT = re.compile(
    r'<use xlink:href="#(?P<ref>[A-Za-z0-9_]+)"[^>]*style="fill: (?P<fill_use>#[0-9a-f]{6})'
    r'|<path d="(?P<d>[^"]*)"[^>]*style="fill: (?P<fill_path>#[0-9a-f]{6})'
)


def _fixture() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _svg(body: dict[str, Any]) -> str:
    r = client.post("/api/export/figure", json={**body, "fmt": "svg"})
    assert r.status_code == 200, r.text
    return r.text


def _group(svg: str, gid: str) -> str:
    """``<g id="{gid}">``'s subtree by nesting depth -- ``extract_group``, but
    tolerant of the self-closing ``<g .../>`` a colourbar's empty collection
    writes."""
    m = re.search(rf'<g id="{re.escape(gid)}">', svg)
    assert m, gid
    depth, pos = 1, m.end()
    for tm in re.finditer(r"<g\b[^>]*?(/?)>|</g>", svg[pos:]):
        if tm.group() == "</g>":
            depth -= 1
            if depth == 0:
                return svg[m.start() : pos + tm.end()]
        elif not tm.group(1):
            depth += 1
    raise AssertionError(f"unbalanced <g> nesting for {gid!r}")


def _shape(d: str) -> str:
    """Circle = cubic Beziers; square = four straight corners."""
    d = " ".join(d.split())
    if " C " in d:
        return "circle"
    if re.fullmatch(r"M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+){3} z", d):
        return "square"
    return f"other:{d}"


def _drawn_points(svg: str) -> list[tuple[str, list[str]]]:
    """(glyph, point fills in draw order) per scatter collection in the plot
    area, legend handles excluded."""
    area = axes_minus_legend(svg)
    out: list[tuple[str, list[str]]] = []
    for gid in _COLLECTION.findall(area):
        glyphs: set[str] = set()
        fills: list[str] = []
        for m in _POINT.finditer(_group(area, gid)):
            if m.group("ref"):
                d = re.search(rf'<path id="{m.group("ref")}" d="([^"]*)"', svg)
                assert d, m.group("ref")
                glyphs.add(_shape(d.group(1)))
                fills.append(m.group("fill_use"))
            else:
                glyphs.add(_shape(m.group("d")))
                fills.append(m.group("fill_path"))
        if not fills:
            continue
        assert len(glyphs) == 1, (gid, glyphs)
        out.append((glyphs.pop(), fills))
    return out


def test_export_draws_every_point_in_the_screen_colour_and_glyph() -> None:
    fixture = _fixture()
    drawn = _drawn_points(_svg(fixture["request"]))
    assert [pts for _g, pts in drawn] == fixture["screen"]["points"]
    assert [g for g, _pts in drawn] == fixture["screen"]["markers"]


def test_legend_text_comes_from_the_text_column_label_source() -> None:
    fixture = _fixture()
    assert legend_entries(_svg(fixture["request"])) == fixture["screen"]["legend"]


def test_one_colourbar_labelled_as_the_screen_colour_scale() -> None:
    fixture = _fixture()
    svg = _svg(fixture["request"])
    assert '<g id="axes_2">' in svg  # the colourbar
    assert '<g id="axes_3">' not in svg  # one, although two series are colour-mapped
    texts = re.findall(r"<text[^>]*>([^<]*)</text>", _group(svg, "axes_2"))
    assert fixture["screen"]["colorbar"]["label"] in texts


def test_without_the_gradient_the_same_request_draws_level_styled_markers_and_no_colourbar() -> (
    None
):
    # Negative control: the per-point fills and the colourbar come from the
    # gradient, not from the dataset.
    body = _fixture()["request"]
    enc = {k: v for k, v in body["encoding"].items() if not k.startswith("gradient_")}
    svg = _svg({**body, "encoding": enc})
    assert _drawn_points(svg) == []
    assert '<g id="axes_2">' not in svg


def test_greyscale_leaves_the_gradient_colours_alone() -> None:
    # The gradient's colour IS the plotted quantity (MAIN #14's ruling).
    fixture = _fixture()
    drawn = _drawn_points(_svg({**fixture["request"], "greyscale": True}))
    assert [pts for _g, pts in drawn] == fixture["screen"]["points"]


def _fixture_ds() -> DataStruct:
    return DataStruct.from_dict(_fixture()["request"]["dataset"])


def test_the_backend_stops_are_the_screen_colormap() -> None:
    # A verbatim copy (calc.figure_colorscatter.GRADIENT_STOPS), pinned here to
    # the frontend's lib/colormap.ts table as the fixture wrote it.
    assert list(GRADIENT_STOPS) == _fixture()["screen"]["stops"]


def test_calc_colour_port_is_the_screen_rule() -> None:
    fixture = _fixture()
    bar = fixture["screen"]["colorbar"]
    stops = fixture["screen"]["stops"]
    z = np.array([10.0, 35.0, np.nan, 300.0, 155.0, -5.0, 400.0])
    fills = gradient_colors(z, bar["lo"], bar["hi"], stops)
    assert fills[0] == stops[0] and fills[3] == stops[-1]
    assert fills[2] is None  # a non-finite value draws no point
    assert fills[5] == stops[0] and fills[6] == stops[-1]  # clamped, as on screen
    assert fills[1] == fixture["screen"]["points"][1][0]  # row 1 (S2) = 35 K
    # A degenerate range reads 0 -- the first stop.
    assert gradient_colors(np.array([7.0]), 7.0, 7.0, stops) == [stops[0]]


def test_calc_js_round_half_up_not_half_even() -> None:
    # 0.5 of the way between channel values 0 and 1 rounds UP, as Math.round
    # does; Python's round() would give 0. Two stops: black -> #010101.
    assert gradient_colors(np.array([0.5]), 0.0, 1.0, ["#000000", "#010101"]) == ["#010101"]


def test_calc_gradient_scale_is_the_screens() -> None:
    # Range over the request's rows (row 9's T = 300 is in no series yet tops
    # the scale), label "name (unit)" -- the screen's `encodedGradient`.
    spec = gradient_spec(_fixture_ds(), _fixture()["request"]["encoding"]["gradient_col"])
    assert spec is not None
    bar = _fixture()["screen"]["colorbar"]
    assert spec["color_lim"] == [bar["lo"], bar["hi"]]
    assert spec["colorbar_label"] == bar["label"]
    assert spec["color_stops"] == list(GRADIENT_STOPS)
    # A column with no finite value colours nothing, as on screen.
    blank = DataStruct.create(time=[0, 1], values=[[1.0, np.nan], [2.0, np.nan]], labels=("y", "T"))
    assert gradient_spec(blank, 1) is None


def test_calc_colourbar_spans_the_scale_with_the_stops() -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ds = _fixture_ds()
    spec = gradient_spec(ds, _fixture()["request"]["encoding"]["gradient_col"])
    assert spec is not None
    fig, ax = plt.subplots()
    try:
        draw_color_scatter(
            fig,
            ax,
            ds.time,
            ds.values[:, 0],
            "s",
            {**spec, "colorbar": True},
            figure_style("default"),
        )
        cbar = fig.axes[1]
        assert cbar.get_ylim() == pytest.approx((10.0, 300.0))
        assert cbar.get_ylabel() == "T (K)"
        mappable = cbar.collections[0] if cbar.collections else cbar.images[0]
        cmap = mappable.cmap
        lo_rgb = tuple(round(c * 255) for c in cmap(0.0)[:3])
        hi_rgb = tuple(round(c * 255) for c in cmap(1.0)[:3])
        assert lo_rgb == (0x44, 0x01, 0x54) and hi_rgb == (0xFD, 0xE7, 0x25)
    finally:
        plt.close(fig)


def test_calc_text_columns_append_as_the_screens_factor_channels() -> None:
    ds = append_text_factors(_fixture_ds(), ["C", "D"])
    assert ds.labels == ("Rxy", "T", "C", "D")
    assert ds.cat_levels == {2: ("S1", "S2"), 3: ("ann", "bob", "cy")}
    np.testing.assert_array_equal(ds.values[:, 2], [0, 1, 0, 1, 0, 1, 0, 1, 0, np.nan])
    assert append_text_factors(ds, []) is ds
    with pytest.raises(ValueError, match="not in this dataset"):
        append_text_factors(_fixture_ds(), ["Z"])


def test_calc_text_cells_trim_and_keep_first_appearance_order() -> None:
    ds = DataStruct.create(
        time=[0, 1, 2, 3, 4],
        values=[[1.0], [2.0], [3.0], [4.0], [5.0]],
        labels=("y",),
        metadata={
            "origin_text_columns": {"A": [" b ", "a", None, "b"]},  # short: row 4 is missing
            "text_columns": {"B": ["x"] * 5},  # `text_columns` wins when present
        },
    )
    assert text_column_cells(ds, "A") is None
    meta = {"origin_text_columns": {"A": [" b ", "a", None, "b"]}}
    ds2 = DataStruct.create(time=ds.time, values=ds.values, labels=("y",), metadata=meta)
    out = append_text_factors(ds2, ["A"])
    assert out.cat_levels == {1: ("b", "a")}
    np.testing.assert_array_equal(out.values[:, 1], [0, 1, np.nan, 0, np.nan])


def test_calc_the_appended_text_channels_split_and_label_like_any_factor() -> None:
    fixture = _fixture()
    enc = fixture["request"]["encoding"]
    e = build_encoded_series(
        append_text_factors(_fixture_ds(), enc["text_columns"]),
        None,
        [0],
        symbol_col=enc["symbol_col"],
        label_col=enc["label_col"],
    )
    assert [s.label for s in e.plot.series] == ["Rxy (C=S1)", "Rxy (C=S2)"]
    assert list(e.legends) == fixture["screen"]["legend"]
    assert list(e.symbol_levels) == [0, 1]


def test_without_text_columns_the_text_factor_indices_are_422() -> None:
    body = _fixture()["request"]
    enc = {k: v for k, v in body["encoding"].items() if k != "text_columns"}
    r = client.post("/api/export/figure", json={**body, "encoding": enc, "fmt": "svg"})
    assert r.status_code == 422, r.text


@pytest.mark.parametrize(
    "patch",
    [{"gradient_col": 99}, {"gradient_col": -1}, {"text_columns": ["C", "Z"]}],
)
def test_bad_gradient_or_text_requests_are_422(patch: dict[str, Any]) -> None:
    body = _fixture()["request"]
    r = client.post(
        "/api/export/figure",
        json={**body, "encoding": {**body["encoding"], **patch}, "fmt": "svg"},
    )
    assert r.status_code == 422, r.text
