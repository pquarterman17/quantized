"""Ternary line and vector plots (plan item 25): numerics, renderers, route."""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_ternary_paths import (
    render_ternary_line_figure,
    render_ternary_vector_figure,
)
from quantized.calc.ternary_paths import arrows_between, normalise_path_rows, valid_runs

client = TestClient(app)
ROUTE = "/api/export/ternary-paths-figure"
ROWS = [[10, 20, 70], [20, 30, 50], [30, 30, 40]]


def test_fractions_and_percentages_give_the_same_rows() -> None:
    pct, r1 = normalise_path_rows(ROWS)
    frac, r2 = normalise_path_rows(np.array(ROWS) / 100)
    np.testing.assert_allclose(pct, frac, atol=1e-12)
    assert not r1 and not r2
    assert normalise_path_rows([[1, 2, 3]])[1]  # sums to 6: neither 1 nor 100


def test_a_missing_cell_is_a_gap_not_a_refusal() -> None:
    abc, _ = normalise_path_rows([[1, 1, 1], [None, 1, 1], [1, 2, 1], [1, 1, 2]])  # type: ignore[list-item]  # noqa: E501
    assert np.isnan(abc[1]).all()
    assert valid_runs(abc) == [(0, 1), (2, 4)]
    assert valid_runs(np.full((2, 3), np.nan)) == []


@pytest.mark.parametrize("bad", [[[1, -1, 2]], [[0, 0, 0]], [[1, np.inf, 1]], [[1, 2]]])
def test_the_scatters_refusal_rules(bad: Any) -> None:
    with pytest.raises(ValueError):
        normalise_path_rows(bad)


def test_arrows_skip_rows_with_a_gap_at_either_end() -> None:
    s, _ = normalise_path_rows([[1, 1, 1], [None, 1, 1], [1, 2, 1]])  # type: ignore[list-item]
    e, _ = normalise_path_rows([[1, 1, 2], [1, 1, 2], [None, 1, 1]])  # type: ignore[list-item]
    a = arrows_between(s, e)
    assert a.kept.tolist() == [0] and a.skipped == 2
    # Length is the length in the triangle's own 2-D projection.
    x0, y0 = 1 / 3 + 0.5 / 3, np.sqrt(3) / 2 / 3
    x1, y1 = 0.5 + 0.5 * 0.25, np.sqrt(3) / 2 * 0.25
    assert a.length[0] == pytest.approx(np.hypot(x1 - x0, y1 - y0))


@pytest.mark.parametrize("fmt", ["pdf", "svg", "png", "tiff"])
def test_every_format_renders(fmt: str) -> None:
    assert render_ternary_line_figure([("s", ROWS)], fmt=fmt, dpi=50)
    assert render_ternary_vector_figure(ROWS, ROWS[::-1], fmt=fmt, dpi=50)


def test_line_refusals() -> None:
    with pytest.raises(ValueError, match="at least one series"):
        render_ternary_line_figure([], fmt="png")
    with pytest.raises(ValueError, match="no drawable"):
        render_ternary_line_figure([("s", [[None, 1, 1]])], fmt="png")  # type: ignore[list-item]
    with pytest.raises(ValueError, match="several series"):
        render_ternary_line_figure([("a", ROWS), ("b", ROWS)], color="red", fmt="png")
    with pytest.raises(ValueError, match="colour"):
        render_ternary_line_figure([("a", ROWS)], color="notacolour", fmt="png")
    with pytest.raises(ValueError, match="dash"):
        render_ternary_line_figure([("a", ROWS)], dash="zigzag", fmt="png")
    with pytest.raises(ValueError, match="at most"):
        render_ternary_line_figure([("a", ROWS)] * 51, fmt="png")


def test_vector_refusals() -> None:
    with pytest.raises(ValueError, match="start has"):
        render_ternary_vector_figure(ROWS, ROWS[:2], fmt="png")
    with pytest.raises(ValueError, match="no row"):
        render_ternary_vector_figure([[None, 1, 1]], [[1, 1, 1]], fmt="png")  # type: ignore[list-item]  # noqa: E501
    with pytest.raises(ValueError, match="exclusive"):
        render_ternary_vector_figure(ROWS, ROWS, values=[1, 2, 3], color="red", fmt="png")
    with pytest.raises(ValueError, match="head_style"):
        render_ternary_vector_figure(ROWS, ROWS, head_style="fat", fmt="png")
    with pytest.raises(ValueError, match="values has"):
        render_ternary_vector_figure(ROWS, ROWS, values=[1.0], fmt="png")


def _post(body: dict[str, Any]) -> Any:
    return client.post(ROUTE, json={"fmt": "png", "dpi": 50, **body})


def test_route_line_and_vector_render() -> None:
    line = {"kind": "line", "series": [{"name": "a", "rows": [*ROWS, [None, None, None], *ROWS]}]}
    r = _post(line)
    assert r.status_code == 200 and r.content[:4] == b"\x89PNG"
    vec = {"kind": "vector", "start": ROWS, "end": ROWS[::-1], "values": [1, 2, 3]}
    assert _post(vec).status_code == 200


def test_route_notes_rescaled_rows_and_skipped_arrows() -> None:
    r = _post({"kind": "line", "series": [{"rows": [[1, 2, 3], [2, 2, 2]]}]})
    assert "did not sum to 1 or 100" in json.loads(r.headers["x-figure-warnings"])[0]
    r = _post({"kind": "vector", "start": [[10, 20, 70], [None, 1, 1]], "end": [[20, 20, 60], [1, 1, 98]]})  # noqa: E501
    assert "1 of 2 rows has a missing" in json.loads(r.headers["x-figure-warnings"])[0]
    assert "x-figure-warnings" not in _post({"kind": "line", "series": [{"rows": ROWS}]}).headers


@pytest.mark.parametrize("body", [
    {"kind": "line", "series": [{"rows": [[1, -1, 2]]}]},  # refused composition
    {"kind": "line", "series": []},
    {"kind": "line", "series": [{"rows": ROWS}] * 51},
    {"kind": "line", "series": [{"rows": ROWS}], "start": ROWS},  # wrong body for the kind
    {"kind": "line", "series": [{"rows": [[1, 2]]}]},  # not three cells
    {"kind": "vector", "start": ROWS},  # no end
    {"kind": "vector", "start": ROWS, "end": ROWS, "series": [{"rows": ROWS}]},
    {"kind": "vector", "start": ROWS, "end": ROWS, "values": [1, None, 3]},
    {"kind": "vector", "start": ROWS, "end": ROWS, "head_size": 99},
    {"kind": "vector", "start": ROWS, "end": [[1, 1, 1], [1, 1, 1]]},  # length mismatch
    {"kind": "spiral"},
])
def test_route_refuses_with_422(body: dict[str, Any]) -> None:
    assert _post(body).status_code == 422
