"""Route tests for POST /api/transform/average (origin gap audit 2, #9).

The statistics are pinned in ``test_calc_curve_average.py``; these pin the
wire shape and that a refusal is a 422 carrying the calc message.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from quantized.app import create_app

client = TestClient(create_app())
URL = "/api/transform/average"


def _curve(name: str, x: list[float], y: list[float]) -> dict[str, Any]:
    return {
        "name": name,
        "dataset": {
            "time": x,
            "values": [[v] for v in y],
            "labels": ["I"],
            "units": ["cps"],
            "metadata": {"xUnit": "deg"},
        },
    }


def test_average_returns_mean_sd_sem_n() -> None:
    r = client.post(
        URL,
        json={"curves": [_curve("a", [0, 1, 2], [1, 2, 3]), _curve("b", [0, 1, 2], [3, 4, 5])]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dataset"]["labels"] == ["I mean", "I SD", "I SEM", "N"]
    assert [row[0] for row in body["dataset"]["values"]] == [2, 3, 4]
    assert [row[3] for row in body["dataset"]["values"]] == [2, 2, 2]
    assert body["overlap"] == [0, 2]
    assert body["channels"] == ["I", "I"]


def test_no_overlap_reports_nulls_and_partial_coverage() -> None:
    r = client.post(
        URL,
        json={"curves": [_curve("a", [0, 1], [1, 2]), _curve("b", [5, 6], [3, 4])]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["overlap"] == [None, None]
    assert any(w["code"] == "out-of-range" for w in body["warnings"])
    # SD is blank (JSON null) where only one curve covers the point.
    assert all(row[1] is None for row in body["dataset"]["values"])


def test_refusal_is_422_with_the_reason() -> None:
    r = client.post(
        URL,
        json={
            "curves": [_curve("a", [0, 1], [1, 2]), _curve("b", [5, 6], [3, 4])],
            "grid": "step",
            "step": 0.5,
        },
    )
    assert r.status_code == 422
    assert "do not overlap" in r.json()["detail"]


def test_fewer_than_two_curves_is_a_validation_error() -> None:
    r = client.post(URL, json={"curves": [_curve("a", [0, 1], [1, 2])]})
    assert r.status_code == 422
