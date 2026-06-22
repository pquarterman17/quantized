"""Integration tests for the /api/corrections route (TestClient).

The math is golden-tested in ``test_calc_corrections``; here we only prove the
thin transport: request shape in, corrected DataStruct payload out, errors map
to HTTP status codes.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "qd_edp124.dat"


def _import() -> dict[str, Any]:
    return client.post("/api/parsers/import", json={"path": str(FIXTURE)}).json()


def test_apply_empty_params_is_identity_shape() -> None:
    dataset = _import()
    resp = client.post("/api/corrections/apply", json={"dataset": dataset})
    assert resp.status_code == 200
    out = resp.json()
    # Returns a full DataStruct payload, same length when nothing trims.
    assert set(out) == {"time", "values", "labels", "units", "metadata"}
    assert len(out["time"]) == len(dataset["time"])
    assert out["time"] == dataset["time"]


def test_apply_x_offset_shifts_time() -> None:
    dataset = _import()
    resp = client.post(
        "/api/corrections/apply",
        json={"dataset": dataset, "params": {"xOff": 10.0}},
    )
    assert resp.status_code == 200
    out = resp.json()
    # time' = time - xOff (pipeline step 2).
    assert out["time"][0] == dataset["time"][0] - 10.0
    assert out["time"][-1] == dataset["time"][-1] - 10.0


def test_apply_trim_reduces_point_count() -> None:
    dataset = _import()
    times = dataset["time"]
    mid = times[len(times) // 2]
    resp = client.post(
        "/api/corrections/apply",
        json={"dataset": dataset, "params": {"xTrimMax": mid}},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert len(out["time"]) < len(times)
    assert max(out["time"]) <= mid


def test_apply_y_offset_subtracts() -> None:
    dataset = {
        "time": [1.0, 2.0, 3.0],
        "values": [[10.0], [20.0], [30.0]],
        "labels": ["m"],
        "units": ["emu"],
        "metadata": {},
    }
    resp = client.post(
        "/api/corrections/apply",
        json={"dataset": dataset, "params": {"yOff": 5.0}},
    )
    assert resp.status_code == 200
    out = resp.json()
    # values' = values - yOff (no background).
    assert out["values"] == [[5.0], [15.0], [25.0]]


def test_missing_dataset_is_validation_error() -> None:
    resp = client.post("/api/corrections/apply", json={"params": {"xOff": 1.0}})
    assert resp.status_code == 422
