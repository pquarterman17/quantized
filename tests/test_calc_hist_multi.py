"""Multi-column histogram (ORIGIN_PLOT_TYPE_PARITY_PLAN #15): shared edges, one
graph, on the stat route and in the publication export."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.calc.figure_statplots import render_statplot_figure
from quantized.calc.statplots import histogram_multi

A = [1.0, 2.0, 2.0, 3.0, float("nan")]
B = [3.0, 4.0, 5.0, 5.0, 5.0]


def test_columns_share_one_set_of_edges() -> None:
    h = histogram_multi([A, B], bins=4)
    assert h["edges"] == [1.0, 2.0, 3.0, 4.0, 5.0]
    assert [s["n"] for s in h["series"]] == [4, 5]  # the NaN is not counted
    assert h["series"][0]["counts"] == [1.0, 2.0, 1.0, 0.0]
    assert h["series"][1]["counts"] == [0.0, 0.0, 1.0, 4.0]
    # every column's counts add up on the SAME bins
    assert np.sum([s["counts"] for s in h["series"]]) == 9


def test_one_value_overall_is_one_unit_bin_and_nothing_finite_fails() -> None:
    h = histogram_multi([[2.0], [2.0, float("nan")]])
    assert h["edges"] == [1.5, 2.5] and [s["counts"] for s in h["series"]] == [[1.0], [1.0]]
    try:
        histogram_multi([[float("nan")], []])
    except ValueError as e:
        assert "at least 1 finite" in str(e)
    else:
        raise AssertionError("expected ValueError")


def test_route_and_export() -> None:
    client = TestClient(create_app())
    r = client.post("/api/statplots/histogram-multi", json={"columns": [A[:4], B], "bins": 4})
    assert r.status_code == 200, r.text
    assert len(r.json()["series"]) == 2
    assert client.post("/api/statplots/histogram-multi", json={"columns": []}).status_code == 422
    out = render_statplot_figure(
        "histogram", [A, B], labels=["a", "b"], fmt="svg", colors=["#ff0000", "#0000ff"]
    )
    assert b"<svg" in out and b"#ff0000" in out
    e = client.post(
        "/api/export/statplot-figure",
        json={
            "kind": "histogram", "data": [A[:4], B], "labels": ["a", "b"], "fmt": "svg",
            "palette": ["#112233", "#445566"],
        },
    )
    assert e.status_code == 200, e.text
    assert b"#112233" in e.content and b"#445566" in e.content
