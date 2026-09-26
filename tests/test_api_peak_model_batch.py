"""POST /api/peaks/model-fit-batch (TestClient + the real job queue).

The loop is verified in test_calc_peak_model_batch; here the transport: the
route queues a job whose rows equal the direct calc call, a bad item is an
error row (the batch still finishes), cancel through /api/jobs ends the job
as "cancelled" mid-fit, and malformed requests are ASCII 422s."""

from __future__ import annotations

import threading
import time
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.peak_model_batch import fit_peak_model_batch
from quantized.routes.peaks_batch import BATCH_MAX_ITEMS, BATCH_MAX_POINTS

client = TestClient(app)
X = np.linspace(-5.0, 5.0, 201)


def _item(item_id: str, center: float, height: float) -> dict[str, Any]:
    rng = np.random.default_rng(len(item_id))
    y = height * np.exp(-4 * np.log(2) * (X - center) ** 2) + 2.0 + 0.1 * rng.normal(size=X.size)
    return {
        "id": item_id, "x": X.tolist(), "y": y.tolist(),
        "shapes": ["gaussian"], "background": "constant",
        "parameters": [
            {"name": "p0.center", "value": center + 0.2, "vary": True},
            {"name": "p0.height", "value": 0.7 * height, "vary": True, "min": 0.0},
            {"name": "p0.fwhm", "value": 1.4, "vary": True},
            {"name": "bg.c0", "value": 1.0, "vary": True},
        ],
    }


def _wait(job_id: str, timeout: float = 60.0) -> dict[str, Any]:
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        snap: dict[str, Any] = client.get(f"/api/jobs/{job_id}").json()
        if snap["status"] in ("done", "error", "cancelled"):
            return snap
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not finish")


def test_batch_job_returns_the_calc_rows() -> None:
    items = [_item("ds-1", -1.0, 30.0), _item("ds-2", 0.5, 12.0)]
    resp = client.post("/api/peaks/model-fit-batch", json={"items": items})
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_items"] == 2
    snap = _wait(body["job_id"])
    assert snap["status"] == "done" and snap["progress"] == 1.0
    assert snap["message"] == "fitted 2/2"
    result = client.get(f"/api/jobs/{body['job_id']}/result").json()["result"]
    direct = fit_peak_model_batch(items)
    assert [r["id"] for r in result["rows"]] == ["ds-1", "ds-2"]
    for got, want in zip(result["rows"], direct["rows"], strict=True):
        assert got["status"] == want["status"] == "ok"
        gp, wp = got["fit"]["peaks"][0], want["fit"]["peaks"][0]
        assert gp["center"] == pytest.approx(wp["center"], rel=1e-12)
        assert gp["area_stderr"] == pytest.approx(wp["area_stderr"], rel=1e-9)
        assert got["fit"]["metrics"]["objective"] == "ssr"


def test_bad_item_is_an_error_row_not_a_failed_batch() -> None:
    bad = _item("ds-bad", 0.0, 10.0)
    bad["parameters"][2] = {"name": "p0.fwhm", "value": 1.0, "vary": True, "min": 3.0, "max": 2.0}
    items = [_item("ds-1", -1.0, 30.0), bad, _item("ds-3", 1.0, 20.0)]
    job_id = client.post("/api/peaks/model-fit-batch", json={"items": items}).json()["job_id"]
    assert _wait(job_id)["status"] == "done"
    result = client.get(f"/api/jobs/{job_id}/result").json()["result"]
    assert [r["status"] for r in result["rows"]] == ["ok", "error", "ok"]
    assert result["n_failed"] == 1
    assert result["rows"][1]["error"].isascii() and "p0.fwhm" in result["rows"][1]["error"]


def test_cancel_through_the_job_api_stops_a_running_fit(monkeypatch: pytest.MonkeyPatch) -> None:
    import quantized.calc.peak_model_batch as mod

    real = mod.fit_peak_model
    entered = threading.Event()

    def held(*args: Any, **kwargs: Any) -> dict[str, Any]:
        entered.set()
        abort = kwargs["abort_check"]
        t0 = time.monotonic()
        while not abort() and time.monotonic() - t0 < 30:
            time.sleep(0.01)  # a fit that would run until cancelled
        return real(*args, **kwargs)  # its first evaluation sees the cancel

    monkeypatch.setattr(mod, "fit_peak_model", held)
    items = [_item(f"ds-{k}", 0.0, 10.0) for k in range(3)]
    job_id = client.post("/api/peaks/model-fit-batch", json={"items": items}).json()["job_id"]
    assert entered.wait(30)
    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    snap = _wait(job_id)
    assert snap["status"] == "cancelled"
    assert snap["message"] == "fitting 1/3"  # it never reached item 2
    assert client.get(f"/api/jobs/{job_id}/result").status_code == 409


def _detail(resp: Any) -> str:
    return str(resp.json()["detail"])


@pytest.mark.parametrize(
    ("mutate", "needle"),
    [
        (lambda b: b.update(items=[]), "at least 1"),
        (lambda b: b["items"].append(dict(b["items"][0])), "item ids must be unique"),
        (lambda b: b["items"][0].update(id="bad id!"), "items[0].id must be"),
        (lambda b: b["items"][0].pop("id"), "items[0].id must be"),
        (lambda b: b.update(items=[1]), "valid dictionary"),
        (lambda b: b.update(item_deadline_s=31.0), "less than or equal"),
        (lambda b: b.update(total_deadline_s=0.0), "greater than 0"),
    ],
)
def test_malformed_requests_are_ascii_422(mutate: Any, needle: str) -> None:
    body: dict[str, Any] = {"items": [_item("ds-1", 0.0, 10.0)]}
    mutate(body)
    resp = client.post("/api/peaks/model-fit-batch", json=body)
    assert resp.status_code == 422
    assert _detail(resp).isascii()
    assert needle in _detail(resp)


def test_caps_are_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    assert BATCH_MAX_ITEMS == 200 and BATCH_MAX_POINTS == 2_000_000
    small = {**_item("x", 0.0, 10.0), "x": [0.0, 1.0], "y": [0.0, 1.0]}
    many = [dict(small, id=f"ds-{k}") for k in range(BATCH_MAX_ITEMS + 1)]
    resp = client.post("/api/peaks/model-fit-batch", json={"items": many})
    assert resp.status_code == 422 and _detail(resp).isascii()
    # The total-points cap, at a size a test can afford (5 x 201 > 1000).
    import quantized.routes.peaks_batch as mod

    monkeypatch.setattr(mod, "BATCH_MAX_POINTS", 1000)
    items = [_item(f"ds-{k}", 0.0, 10.0) for k in range(5)]
    resp = client.post("/api/peaks/model-fit-batch", json={"items": items})
    assert resp.status_code == 422
    assert "1005 points; the limit is 1000" in _detail(resp)


def test_one_invalid_item_is_an_error_row_not_a_422() -> None:
    """A NaN start value serializes to null (JSON has no NaN) and an unknown
    shape fails the item schema: each is ITS dataset's error row."""
    nan_seed = _item("ds-nan", 0.0, 10.0)
    nan_seed["parameters"][0]["value"] = None
    sinc = _item("ds-sinc", 0.0, 10.0)
    sinc["shapes"] = ["sinc"]
    items = [_item("ds-1", -1.0, 30.0), nan_seed, sinc, _item("ds-4", 1.0, 20.0)]
    resp = client.post("/api/peaks/model-fit-batch", json={"items": items})
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    assert _wait(job_id)["status"] == "done"
    rows = client.get(f"/api/jobs/{job_id}/result").json()["result"]["rows"]
    assert [r["status"] for r in rows] == ["ok", "error", "error", "ok"]
    assert rows[1]["error"] == "invalid item: parameters.0.value: Input should be a valid number"
    assert rows[2]["error"].startswith("invalid item: shapes.0: Input should be 'gaussian'")
    assert all(r["error"].isascii() for r in rows[1:3])


def test_the_job_does_not_hold_the_parsed_request(monkeypatch: pytest.MonkeyPatch) -> None:
    import quantized.routes.peaks_batch as mod

    captured: list[Any] = []
    monkeypatch.setattr(mod.jobs, "submit", lambda fn: captured.append(fn) or "j")
    client.post("/api/peaks/model-fit-batch", json={"items": [_item("ds-1", 0.0, 10.0)]})
    cells = [c.cell_contents for c in captured[0].__closure__ or ()]
    assert not any(isinstance(c, mod.PeakModelBatchRequest) for c in cells)


def test_batch_items_and_single_fits_share_one_problem_model() -> None:
    from quantized.routes.peaks import PeakModelFitRequest, PeakModelProblem
    from quantized.routes.peaks_batch import PeakModelBatchItem

    assert issubclass(PeakModelBatchItem, PeakModelProblem)
    assert issubclass(PeakModelFitRequest, PeakModelProblem)
    assert set(PeakModelBatchItem.model_fields) == set(PeakModelProblem.model_fields) | {"id"}
