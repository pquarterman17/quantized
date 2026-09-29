"""P1.4 Graph Builder Color-by / Symbol-by / legend-label source -- export parity.

The BACKEND half of the screen <-> export check (the A8 pattern, as in
``tests/test_statplot_levels_parity.py``). ``frontend/src/lib/
plotEncodingExport.test.ts`` builds, from ONE ``plotEncoding.encodeSpec``
derivation, both what the Graph Builder preview draws (each series' colour,
glyph and legend text) and the export request, and pins the pair
byte-for-byte as ``tests/fixtures/wire/graph_encoding_export.json``
(``{"request", "screen"}``). This file posts that SAME request to the real
``/api/export/figure`` route, reads the SVG back structurally and compares
every drawn series against ``screen``:

* the same number of series, in the same order, each with the colour the
  preview drew (colour by colour-factor LEVEL, under a user level order) and
  the glyph it drew (glyph by symbol-factor level);
* each series' point count -- the row partition, NaN rows excluded;
* the legend text, verbatim, from the label-source column.

Plus the calc-level port check (``calc.plotting_encoded``) on the fixture's
dataset, a negative control (the same request without ``encoding`` draws one
unsplit, uncoloured series), and the 422 paths.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from _regression_matrix_wire import axes_minus_legend, extract_group, legend_entries
from quantized.app import app
from quantized.calc.plotting import build_grouped_series
from quantized.calc.plotting_encoded import build_encoded_series, legend_source_text
from quantized.datastruct import DataStruct

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "graph_encoding_export.json"
_SERIES_GROUP = re.compile(r'<g id="(line2d_\d+)">')
_USE_FILL = re.compile(r'<use xlink:href="#(m[0-9a-f]+)"[^>]*style="fill: (#[0-9a-f]{6})')


def _fixture() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _svg(body: dict[str, Any]) -> str:
    r = client.post("/api/export/figure", json={**body, "fmt": "svg"})
    assert r.status_code == 200, r.text
    return r.text


def _glyph(svg: str, marker_id: str) -> str:
    """Classify a matplotlib marker definition: the circle is cubic Beziers,
    the square four straight corners (``_regression_matrix_wire.
    square_marker_glyph``'s shape)."""
    m = re.search(rf'<path id="{marker_id}" d="([^"]*)"', svg)
    assert m, marker_id
    d = " ".join(m.group(1).split())
    if " C " in d:
        return "circle"
    if re.fullmatch(r"M -([\d.]+) \1 L \1 \1 L \1 -\1 L -\1 -\1 z", d):
        return "square"
    return f"other:{d}"


def _drawn_series(svg: str) -> list[tuple[str, str, int]]:
    """(colour, glyph, point count) per data series, in draw order: the
    axes' line2d groups whose marker uses carry a FILL (tick marks are
    stroke-only), legend handles excluded."""
    area = axes_minus_legend(svg)
    out: list[tuple[str, str, int]] = []
    for gid in _SERIES_GROUP.findall(area):
        uses = _USE_FILL.findall(extract_group(area, gid))
        if not uses:
            continue
        marker_ids = {mid for mid, _ in uses}
        colours = {c for _, c in uses}
        assert len(marker_ids) == 1 and len(colours) == 1, (gid, uses)
        out.append((colours.pop(), _glyph(svg, marker_ids.pop()), len(uses)))
    return out


def test_export_draws_every_series_with_the_screen_colour_glyph_and_legend() -> None:
    fixture = _fixture()
    screen = fixture["screen"]
    svg = _svg(fixture["request"])
    drawn = _drawn_series(svg)
    assert [c for c, _g, _n in drawn] == screen["colors"]
    assert [g for _c, g, _n in drawn] == screen["markers"]
    # The row partition: (S3,0)=rows 4,12 · (S3,1)=5,6 · (S1,0)=0,7 ·
    # (S1,1)=1 (row 9's NaN value draws nothing) · (S2,0)=2,11 · (S2,1)=3,8;
    # row 10's NaN sample joins no series.
    assert [n for _c, _g, n in drawn] == [2, 2, 2, 1, 2, 2]
    assert legend_entries(svg) == screen["legend"]


def test_legend_handles_carry_the_same_encoding_as_the_curves() -> None:
    fixture = _fixture()
    svg = _svg(fixture["request"])
    handles = _USE_FILL.findall(extract_group(svg, "legend_1"))
    assert [c for _m, c in handles] == fixture["screen"]["colors"]
    assert [_glyph(svg, m) for m, _c in handles] == fixture["screen"]["markers"]


def test_without_encoding_the_same_request_draws_one_unsplit_series() -> None:
    # Negative control: drop `encoding` and the split, the level colours, the
    # glyph cycle and the label-source legend all go -- proof the assertions
    # above come from the encoding, not from the dataset.
    body = {k: v for k, v in _fixture()["request"].items() if k != "encoding"}
    svg = _svg(body)
    drawn = _drawn_series(svg)
    assert len(drawn) == 1
    assert drawn[0][1] == "circle"
    assert drawn[0][2] == 12  # every finite Rxy row, the NaN-sample row included
    assert drawn[0][0] not in _fixture()["request"]["encoding"]["palette"]
    # The request still forces a legend on; without the encoding it names the
    # channel, not a label-source value.
    assert legend_entries(svg) == ["Rxy (Ohm)"]


def _fixture_ds() -> DataStruct:
    return DataStruct.from_dict(_fixture()["request"]["dataset"])


def test_calc_port_matches_the_screen_series_for_series() -> None:
    fixture = _fixture()
    enc = fixture["request"]["encoding"]
    e = build_encoded_series(
        _fixture_ds(),
        None,
        [0],
        color_col=enc["color_col"],
        symbol_col=enc["symbol_col"],
        label_col=enc["label_col"],
    )
    assert list(e.legends) == fixture["screen"]["legend"]
    assert [s.label for s in e.plot.series] == [
        "Rxy (sample=S3, field=0)",
        "Rxy (sample=S3, field=1)",
        "Rxy (sample=S1, field=0)",
        "Rxy (sample=S1, field=1)",
        "Rxy (sample=S2, field=0)",
        "Rxy (sample=S2, field=1)",
    ]
    assert list(e.color_levels) == [0, 0, 1, 1, 2, 2]
    assert list(e.symbol_levels) == [0, 1, 0, 1, 0, 1]


def test_group_col_joins_the_split_and_colour_falls_back_to_display_position() -> None:
    base = _fixture()["request"]
    palette = base["encoding"]["palette"]
    body = {**base, "group_col": 2, "encoding": {"label_col": 3, "palette": palette}}
    drawn = _drawn_series(_svg(body))
    assert [c for c, _g, _n in drawn] == palette[:2]  # two field levels, by position
    assert {g for _c, g, _n in drawn} == {"circle"}  # no symbol factor


def _label_only(**extra: Any) -> dict[str, Any]:
    base = _fixture()["request"]
    return {**base, "encoding": {"label_col": 3, "palette": base["encoding"]["palette"]}, **extra}


def test_label_only_is_one_series_with_its_legend_forced_on() -> None:
    # The preview lists a lone series' label-source legend; matplotlib draws no
    # legend for one series unless told to, so the request's `legend.show`
    # (sent by lib/plotEncodingExport.ts) is what keeps the text in the export.
    svg = _svg(_label_only())
    assert len(_drawn_series(svg)) == 1
    assert legend_entries(svg) == ["10 K … 300 K (4 values)"]


def test_label_only_keeps_the_error_spans_but_a_split_drops_them() -> None:
    spans = [{"y": {"plus": [0.2] * 13, "minus": [0.2] * 13}}]
    assert '<g id="LineCollection_1">' in _svg(_label_only(error_spans=spans))
    split = {**_fixture()["request"], "error_spans": spans}
    assert '<g id="LineCollection_1">' not in _svg(split)


def test_calc_group_factor_alone_is_build_grouped_series() -> None:
    # The Group split is the single-factor case of the encoded split; the two
    # implementations are pinned equal here (the frontend pins buildXY ==
    # buildEncodedXY the same way).
    ds = _fixture_ds()
    for group in (1, 2):
        grouped = build_grouped_series(ds, None, [0, 3], group)
        encoded = build_encoded_series(ds, None, [0, 3], group_col=group).plot
        assert [s.label for s in encoded.series] == [s.label for s in grouped.series]
        for a, b in zip(encoded.series, grouped.series, strict=True):
            np.testing.assert_array_equal(a.values, b.values)
        assert (encoded.x_label, encoded.x_unit) == (grouped.x_label, grouped.x_unit)


def test_label_source_summarizes_past_three_values() -> None:
    ds = DataStruct.create(
        time=[0, 1, 2, 3, 4], values=[[1, 5], [2, 10], [3, 20], [4, 40], [5, 80]],
        labels=("y", "T"), units=("V", "K"),
    )
    assert legend_source_text(ds, 1, np.arange(3)) == "5 K, 10 K, 20 K"
    assert legend_source_text(ds, 1, np.arange(5)) == "5 K … 80 K (5 values)"


@pytest.mark.parametrize(
    "patch",
    [
        {"y2_keys": [0]},
        {"encoding": {"color_col": 99}},
        {"encoding": {"label_col": -5}},
        {"y_keys": [-1]},  # numpy would silently plot the LAST column
    ],
)
def test_bad_encoding_requests_are_422(patch: dict[str, Any]) -> None:
    body = {**_fixture()["request"], **patch, "fmt": "svg"}
    r = client.post("/api/export/figure", json=body)
    assert r.status_code == 422, r.text
