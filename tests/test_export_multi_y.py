"""Origin-style multiple Y axes in the figure export (gap audit 4 G11): the
request contract (``routes.export_figures_multi_y``) and the renderer's
handling of the interactions the canvas defines (``calc.figure_multi_y``).
The screen == export values themselves are pinned by
``test_export_multi_y_wire.py`` over the shared wire fixture."""

from __future__ import annotations

from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure import render_figure
from quantized.calc.figure_multi_y import SLOT_PT

client = TestClient(app)

DS = {
    "time": [0, 1, 2, 3],
    "values": [[1, 10, 100, 5], [2, 20, 300, 6], [3, 15, 200, 7], [4, 12, 150, 8]],
    "labels": ["A", "B", "C", "D"],
    "units": ["u", "v", "w", "z"],
    "metadata": {},
}


def _body(**kw: Any) -> dict[str, Any]:
    return {"dataset": DS, "y_keys": [0, 1, 2, 3], "fmt": "svg", **kw}


def _figure(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **k: Any) -> None:
        kept.append(self)
        real(self, *a, **k)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1]


@pytest.mark.parametrize(
    ("extra", "needle"),
    [
        ({"y_axes": [{"keys": [9]}]}, "subset of y_keys"),
        ({"y2_keys": [2], "y_axes": [{"keys": [2]}]}, "overlap"),
        ({"y_axes": [{"keys": [2]}, {"keys": [2, 3]}]}, "overlap"),
        ({"y_axes": [{"keys": [2]}], "group_col": 1}, "group_col"),
        ({"y_axes": [{"keys": [2], "lim": [5, 1]}]}, "low < high"),
        ({"y_axes": [{"keys": [2], "color": "red"}]}, "pattern"),
        ({"y_axes": [{"keys": [2], "scale": "probit"}]}, "pattern"),
        ({"y_axes": [{"keys": [k]} for k in range(7)]}, "at most 6"),
    ],
)
def test_a_bad_or_unsupported_request_is_refused_not_dropped(
    extra: dict[str, Any], needle: str
) -> None:
    r = client.post("/api/export/figure", json=_body(**extra))
    assert r.status_code == 422, r.text
    assert needle in r.text


def test_extra_axes_with_x_breaks_name_y_axes_not_y2_keys() -> None:
    body = _body(y_axes=[{"keys": [2]}], overrides={"x_breaks": [[1.2, 1.8]]})
    r = client.post("/api/export/figure", json=body)
    assert r.status_code == 422, r.text
    assert "y_axes is not supported together with x_breaks" in r.text


def test_facets_polar_and_page_panels_refuse_extra_axes() -> None:
    facet = {"label": "a", "rows": [0, 1]}
    r = client.post("/api/export/figure", json=_body(y_axes=[{"keys": [2]}], facets=[facet]))
    assert r.status_code == 422 and "facets" in r.text
    r = client.post("/api/export/figure", json=_body(y_axes=[{"keys": [2]}], polar={}))
    assert r.status_code == 422 and "y_axes" in r.text
    page = {
        "rows": 1,
        "cols": 1,
        "panels": [{"figure": _body(y_axes=[{"keys": [2]}]), "row": 0, "col": 0}],
    }
    r = client.post("/api/export/figure-page", json=page)
    assert r.status_code == 422 and "figure-page panel" in r.text


def test_without_a_y2_series_the_twin_draws_nothing_and_y3_takes_the_first_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fig = _figure(monkeypatch, _body(y_axes=[{"keys": [2], "label": "C"}]))
    drawn = [ax for ax in fig.axes[1:] if ax.axison]
    assert len(drawn) == 1
    assert drawn[0].get_ylabel() == "C"
    assert drawn[0].spines["right"].get_position() == ("outward", 0.0)
    # Y1's derived title counts only its own series, as the canvas titles it.
    assert fig.axes[0].get_ylabel() == "A (u) / B (v) / D (z)"


def test_y1_and_y2_titles_leave_out_the_extra_axis_series(monkeypatch: pytest.MonkeyPatch) -> None:
    fig = _figure(monkeypatch, _body(y2_keys=[1], y_axes=[{"keys": [2]}, {"keys": [3]}]))
    labels = [ax.get_ylabel() for ax in fig.axes]
    assert labels[0] == "A (u)" and labels[1] == "B (v)"
    assert [ax.spines["right"].get_position()[1] for ax in fig.axes[1:]] == [
        0.0,
        SLOT_PT,
        2 * SLOT_PT,
    ]


def test_an_extra_axis_title_is_plain_text_like_the_canvas(monkeypatch: pytest.MonkeyPatch) -> None:
    fig = _figure(monkeypatch, _body(y_axes=[{"keys": [2], "label": "$x^2$"}]))
    assert fig.axes[-1].get_ylabel() == r"\$x^2\$"


def test_error_bars_ride_their_own_extra_axis(monkeypatch: pytest.MonkeyPatch) -> None:
    span = {"y": {"plus": [1.0] * 4, "minus": [1.0] * 4}}
    fig = _figure(monkeypatch, _body(y_axes=[{"keys": [2]}], error_spans=[None, None, span, None]))
    y3 = fig.axes[-1]
    assert y3.containers, "the Y3 series' error bars are drawn on the Y3 axes"
    assert not fig.axes[0].containers


def test_layers_draw_over_the_outermost_axis_and_the_inset_skips_extra_series(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **k: Any) -> None:
        kept.append(self)
        real(self, *a, **k)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    x = np.arange(4.0)
    table = {"kind": "table", "at": [0.55, 0.1, 0.4, 0.35], "rows": [["a", "b"]], "header": False}
    inset = {"x": [1.0, 2.0], "at": [0.1, 0.1, 0.3, 0.3]}
    render_figure(
        x,
        [("A", x), ("B", x * 2), ("C", x * 3)],
        fmt="svg",
        y2_mask=[False, True, False],
        extra_y=[{"mask": [False, False, True], "label": "C"}],
        overrides={"layers": [table], "inset": inset},
    )
    fig = kept[-1]
    y3 = next(ax for ax in fig.axes if ax.get_ylabel() == "C")
    assert y3.tables, "the layer table sits on the outermost twin, over every curve"
    insets = [child for ax in fig.axes for child in ax.child_axes]
    assert insets, "the magnifier is drawn"
    magnified = [ln.get_ydata()[-1] for inset in insets for ln in inset.get_lines()]
    # A (3) and B (6) are magnified -- the canvas inset shows Y1 and Y2 -- and C (9, on Y3) is not.
    assert 9.0 not in magnified and {3.0, 6.0} <= set(magnified)
