"""POST /api/map-stack-fit/job: the stack is checked synchronously (422), the
fit runs through the job queue, and a cancel leaves no result."""

from __future__ import annotations

import threading
import time
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc import map_stack_fit
from quantized.io._array_books import grid_map_datastruct
from quantized.routes._payload import datastruct_payload

client = TestClient(app)
URL = "/api/map-stack-fit/job"
X = np.linspace(0.0, 6.0, 8)
NY, NX = 4, 5


def _body(**over: Any) -> dict[str, Any]:
    rng = np.random.default_rng(2)
    a = 1.0 + rng.random((NY, NX))
    tau = 1.5 + rng.random((NY, NX))
    maps = []
    for xv in X:
        z = a * np.exp(-xv / tau) + 0.2 + rng.normal(0, 0.005, (NY, NX))
        ds = grid_map_datastruct(
            z, np.arange(NX, dtype=float), np.arange(NY, dtype=float),
            x_label="x", x_unit="mm", y_label="y", y_unit="mm", z_unit="cts",
        )
        maps.append(datastruct_payload(ds))
    body: dict[str, Any] = {
        "datasets": maps, "layer_names": [f"T{k}" for k in range(len(X))],
        "x_values": X.tolist(), "model": "Exponential Decay",
    }
    body.update(over)
    return body


def _poll(job_id: str) -> list[dict[str, Any]]:
    snaps: list[dict[str, Any]] = []
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        snaps.append(client.get(f"/api/jobs/{job_id}").json())
        if snaps[-1]["status"] in ("done", "error", "cancelled"):
            return snaps
        time.sleep(0.02)
    raise AssertionError("job never finished")


def test_job_returns_a_map_per_output_with_a_summary() -> None:
    r = client.post(URL, json=_body())
    assert r.status_code == 200
    snaps = _poll(r.json()["job_id"])
    assert snaps[-1]["status"] == "done"
    res = client.get(f"/api/jobs/{r.json()['job_id']}/result").json()["result"]
    names = [o["name"] for o in res["outputs"]]
    assert names[:2] == ["A", "A (std. error)"] and names[-2:] == ["reduced chi-sq", "converged"]
    assert len(names) == 8
    a_map = res["outputs"][0]["dataset"]
    assert a_map["metadata"]["is2D"] is True and a_map["metadata"]["map_shape"] == [NY, NX]
    assert len(a_map["values"]) == NY * NX
    assert res["summary"]["n_fitted"] == NY * NX and res["summary"]["n_failed"] == 0


def test_bad_stacks_are_422_before_any_job_is_queued() -> None:
    assert client.post(URL, json=_body(model="Nope")).status_code == 422
    assert client.post(URL, json=_body(x_values=[1.0] * len(X))).status_code == 422
    body = _body()
    rows = body["datasets"][0]["values"]
    body["datasets"][0]["values"] = [[v[0] + 0.5, v[1], v[2]] for v in rows]
    assert client.post(URL, json=body).status_code == 422


def test_a_job_level_refusal_surfaces_as_a_job_error() -> None:
    r = client.post(URL, json=_body(p0=[1.0, 1.0, 0.0], fixed=[True, True, True]))
    snaps = _poll(r.json()["job_id"])
    assert snaps[-1]["status"] == "error" and "every parameter is held" in snaps[-1]["error"]


def test_cancel_ends_cancelled_and_leaves_no_result(monkeypatch: pytest.MonkeyPatch) -> None:
    real = map_stack_fit.curve_fit
    started = threading.Event()
    go = threading.Event()

    def gated(*a: Any, **k: Any) -> Any:
        started.set()
        assert go.wait(30)  # hold the first pixel until the cancel has been posted
        return real(*a, **k)

    monkeypatch.setattr(map_stack_fit, "curve_fit", gated)
    r = client.post(URL, json=_body())
    job_id = r.json()["job_id"]
    assert started.wait(30)
    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    go.set()
    snaps = _poll(job_id)
    assert snaps[-1]["status"] == "cancelled"
    assert client.get(f"/api/jobs/{job_id}/result").status_code == 409
