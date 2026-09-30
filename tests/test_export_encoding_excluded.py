"""Excluded rows on an ENCODED (Color / Symbol / label-source) export.

FIGURE_AUTHORING_WORKFLOW_PLAN F4.2c (a): an export asks whether excluded and
filter-dropped rows are drawn greyed or omitted, and draws what the plot window
draws. The flat path carries greyed rows client-side as extra channels, but an
encoded request is split and coloured server-side, so it gets a per-row mask
instead: ``excluded_rows`` (rows of the FULL dataset the window does not draw as
data) and ``grey_excluded`` (draw them as grey "(excluded)" companions).

The window's split takes its levels over every row and then blanks the dropped
ones (``Stage/usePlotEncoding`` over ``active.data``, then
``plotdata.maskExcludedPayload``). So a level present only in excluded rows is
still a series there, and later series keep their display-position colour. The
export used to prune the rows first and lose that level
(PRIMARY_SOFTWARE_AUDIT_PLAN P1.4's documented limit). With the mask it takes
its levels the same way.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_excluded import EXCLUDED_GHOST_STYLE
from quantized.routes.export_figures import FigureRequest, _figure_series

client = TestClient(app)

PALETTE = ["#111111", "#222222", "#333333"]
# Rows 2 and 5 are excluded, and they hold the ONLY rows of sample level 2.
DATASET: dict[str, Any] = {
    "time": [0, 1, 2, 3, 4, 5],
    "values": [[10, 1], [11, 1], [12, 2], [13, 3], [14, 3], [15, 2]],
    "labels": ["y", "sample"],
    "units": ["V", ""],
    "metadata": {},
}
EXCLUDED = [2, 5]


def _request(**extra: Any) -> dict[str, Any]:
    return {
        "dataset": DATASET,
        "y_keys": [0],
        "encoding": {
            "symbol_col": 1,
            "palette": PALETTE,
            "markers": ["circle", "square", "diamond"],
        },
        **extra,
    }


def _resolve(**extra: Any) -> Any:
    return _figure_series(FigureRequest(**_request(**extra)))


def _finite_rows(values: Any) -> list[int]:
    return [int(i) for i in np.flatnonzero(np.isfinite(np.asarray(values, dtype=float)))]


def test_omitted_rows_keep_the_screen_levels_and_position_colours() -> None:
    r = _resolve(excluded_rows=EXCLUDED)
    # Three series, as on screen: level 2 is still one, drawn empty.
    assert [name for name, _v in r.series] == [
        "y (sample=1) (V)",
        "y (sample=2) (V)",
        "y (sample=3) (V)",
    ]
    assert [_finite_rows(v) for _n, v in r.series] == [[0, 1], [], [3, 4]]
    # No colour factor: colour by display position, so level 3 keeps slot 2.
    assert [s["color"] for s in r.styles] == PALETTE
    assert not any(name.endswith("(excluded)") for name, _v in r.series)


def test_negative_control_pruned_rows_lose_the_level_and_shift_the_colour() -> None:
    # What the export sent before the mask: the pruned rows. Level 2 vanishes
    # and level 3 takes palette slot 1, which the screen never shows.
    pruned = {**DATASET, "time": [0, 1, 3, 4], "values": [[10, 1], [11, 1], [13, 3], [14, 3]]}
    r = _resolve(dataset=pruned)
    assert len(r.series) == 2
    assert r.styles[1]["color"] == PALETTE[1]


def test_greyed_rows_become_one_grey_companion_per_series() -> None:
    r = _resolve(excluded_rows=EXCLUDED, grey_excluded=True)
    names = [name for name, _v in r.series]
    assert names[3:] == [f"{n} (excluded)" for n in names[:3]]
    assert [_finite_rows(v) for _n, v in r.series] == [[0, 1], [], [3, 4], [], [2, 5], []]
    assert r.styles[3:] == [dict(EXCLUDED_GHOST_STYLE)] * 3
    assert r.styles[:3] == _resolve(excluded_rows=EXCLUDED).styles
    assert r.y2_mask == [False] * 6


def test_grey_without_excluded_rows_is_byte_identical() -> None:
    plain = _resolve()
    greyed = _resolve(grey_excluded=True, excluded_rows=[])
    assert [n for n, _v in greyed.series] == [n for n, _v in plain.series]
    assert greyed.styles == plain.styles


def test_a_label_source_legend_keeps_its_text_and_spans_stay_aligned() -> None:
    spans = [{"y": {"plus": [0.5] * 6, "minus": [0.5] * 6}}]
    r = _resolve(
        encoding={"label_col": 1, "palette": PALETTE},
        excluded_rows=EXCLUDED,
        grey_excluded=True,
        error_spans=spans,
    )
    # Legend text over EVERY row of the series (the screen's legendSourceText).
    assert [n for n, _v in r.series] == ["1, 2, 3", "1, 2, 3 (excluded)"]
    assert r.error_spans == [spans[0], None]


def test_a_gradient_scale_spans_only_the_rows_the_figure_keeps() -> None:
    r = _resolve(encoding={"gradient_col": 0}, excluded_rows=[5], grey_excluded=True)
    kept, ghost = r.styles
    assert kept["color_lim"] == [10.0, 14.0]  # row 5's 15 is excluded
    assert ghost == dict(EXCLUDED_GHOST_STYLE)  # a ghost is never colour-mapped


def test_excluded_rows_need_an_encoding_and_valid_rows() -> None:
    no_encoding = {k: v for k, v in _request(excluded_rows=EXCLUDED).items() if k != "encoding"}
    for body in (no_encoding, _request(excluded_rows=[6]), _request(excluded_rows=[-1])):
        r = client.post("/api/export/figure", json={**body, "fmt": "svg"})
        assert r.status_code == 422, (body, r.text)


_GREY_POINT = re.compile(r'<use xlink:href="#m[0-9a-f]+"[^>]*style="fill: #9a9a9a')


def test_the_exported_svg_draws_the_excluded_points_grey() -> None:
    def grey_points(**extra: Any) -> int:
        r = client.post("/api/export/figure", json={**_request(**extra), "fmt": "svg"})
        assert r.status_code == 200, r.text
        # Drawn points only: the legend's handles repeat each series' marker.
        # (`axes_minus_legend` cannot parse this SVG: an empty series is a
        # self-closing <g/>, which its depth count reads as never closed.)
        return len(_GREY_POINT.findall(r.text.split('<g id="legend_1">')[0]))

    assert grey_points(excluded_rows=EXCLUDED, grey_excluded=True) == 2
    assert grey_points(excluded_rows=EXCLUDED) == 0


def test_a_page_panel_and_a_report_figure_take_the_mask_too() -> None:
    # "Send to report" and the Figure Page carry the same FigureRequest, so a
    # greyed encoded panel/figure renders there as it does on /figure.
    from quantized.routes.report_figures import render_spec

    body = _request(excluded_rows=EXCLUDED, grey_excluded=True)
    page = client.post(
        "/api/export/figure-page",
        json={"rows": 1, "cols": 1, "panels": [{"figure": body, "row": 0, "col": 0}], "fmt": "svg"},
    )
    assert page.status_code == 200, page.text
    assert len(_GREY_POINT.findall(page.text)) >= 2
    rendered = render_spec({**body, "fmt": "svg"}, "html")
    assert rendered.error is None
    assert rendered.svg is not None
    assert len(_GREY_POINT.findall(rendered.svg.decode())) >= 2
