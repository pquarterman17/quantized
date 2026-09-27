"""Route tests for POST /api/sims/process (audit P2.3). The formulas are
pinned in ``test_calc_sims.py``; these pin the wire shape and the 422s."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app

client = TestClient(create_app())
URL = "/api/sims/process"

PROFILE: dict[str, Any] = {
    "time": [0.0, 10.0, 20.0, 30.0],
    "values": [[40.0, 1000.0], [20.0, 1000.0], [4.0, 2000.0], [2.0, 2000.0]],
    "labels": ["B", "Si"],
    "units": ["c/s", "c/s"],
    "metadata": {"x_column_name": "Time", "x_column_unit": "s"},
}


def test_process_returns_derived_dataset_stages_and_warnings() -> None:
    res = client.post(
        URL,
        json={
            "dataset": PROFILE,
            "calibration": {"method": "crater", "crater_depth": 0.3, "crater_unit": "um"},
            "normalization": {"reference": 1},
            "smoothing": {"method": "moving", "window": 1},
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["dataset"]["time"] == pytest.approx([0.0, 100.0, 200.0, 300.0])
    assert body["dataset"]["metadata"]["x_column_unit"] == "nm"
    assert body["dataset"]["units"] == ["ratio to Si", "c/s"]
    assert [s["stage"] for s in body["stages"]] == ["calibration", "normalization", "smoothing"]
    assert body["stages"][0]["sputter_rate_nm_per_s"] == pytest.approx(10.0)
    assert [w["code"] for w in body["warnings"]] == ["assumed-total-time"]


def test_blank_values_travel_as_null() -> None:
    ds = {**PROFILE, "values": [[40.0, 1000.0], [20.0, 0.0], [4.0, 2000.0], [2.0, 2000.0]]}
    res = client.post(URL, json={"dataset": ds, "normalization": {"reference": 1}})
    assert res.status_code == 200
    assert res.json()["dataset"]["values"][1][0] is None


def test_refusals_are_422_with_the_reason() -> None:
    cases: list[dict[str, Any]] = [
        {"dataset": PROFILE},
        {
            "dataset": {**PROFILE, "metadata": {}},
            "calibration": {"method": "rate", "sputter_rate": 1},
        },
        {"dataset": PROFILE, "background": {"lo": 500, "hi": 600}},
        {"dataset": PROFILE, "normalization": {"reference": 5}},
    ]
    for body in cases:
        res = client.post(URL, json=body)
        assert res.status_code == 422, body
        assert isinstance(res.json()["detail"], str)
    assert (
        client.post(URL, json={"dataset": PROFILE, "smoothing": {"window": 0}}).status_code == 422
    )
