"""Tests for ``quantized.client.QuantizedClient`` (scripting/API slice 1).

Primary coverage drives the REAL app over an in-process ASGI transport (no
sockets, no port collisions) — the exact same ``app`` object other route
tests wrap in ``TestClient``, just exercised through the new client class.
One opt-in test (``QZ_LIVE_SMOKE=1``) drives a real uvicorn socket; it is
the one thing the ASGI-transport tests structurally cannot replace (real
header handling, connection pooling, a genuine wire-JSON round trip), and
never runs unless explicitly requested (never in CI).
"""

from __future__ import annotations

import os
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import numpy as np
import pytest
import uvicorn
from fastapi import FastAPI
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.client import QuantizedClient, QuantizedClientError, QuantizedConnectionError
from quantized.datastruct import DataStruct
from quantized.jobs import jobs as global_jobs

FIXTURE = Path(__file__).parent / "fixtures" / "qd_edp124.dat"
_TERMINAL = ("done", "error", "cancelled")


@pytest.fixture
def qz_client() -> Iterator[QuantizedClient]:
    """A QuantizedClient driving the real app in-process (no real socket).

    ``TestClient`` (not a raw ``httpx.Client(transport=httpx.ASGITransport(...))``)
    is the injection value: httpx 0.28's ``ASGITransport`` implements only the
    ASYNC transport interface (``handle_async_request``), so a *sync*
    ``httpx.Client`` — what ``QuantizedClient`` and slice-1's real callers
    use — cannot drive it directly (``AttributeError: no attribute
    'handle_request'``). ``TestClient`` IS an ``httpx.Client`` subclass
    (`starlette.testclient.TestClient(httpx.Client)`) that bridges the
    sync/async gap internally, so it satisfies ``QuantizedClient``'s
    ``_client: httpx.Client | None`` seam exactly while still running the
    real app in-process with no socket.
    """
    http = TestClient(app, base_url="http://testserver")
    client = QuantizedClient(_client=http)
    yield client
    client.close()


# ── Construction / base_url resolution ──────────────────────────────────


def test_base_url_resolves_default_and_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QZ_URL", raising=False)
    assert QuantizedClient()._base_url == "http://127.0.0.1:8000"
    monkeypatch.setenv("QZ_URL", "http://127.0.0.1:9999")
    assert QuantizedClient()._base_url == "http://127.0.0.1:9999"
    assert QuantizedClient(base_url="http://127.0.0.1:7000")._base_url == "http://127.0.0.1:7000"


def test_no_server_required_to_construct(monkeypatch: pytest.MonkeyPatch) -> None:
    """Building a client object never touches the network (lazy handshake)."""
    monkeypatch.delenv("QZ_URL", raising=False)
    client = QuantizedClient(base_url="http://127.0.0.1:1")  # nothing listens here
    assert client is not None  # no exception, no request sent


# ── Identity handshake (mandatory) ───────────────────────────────────────


def test_health_identifies_as_quantized(qz_client: QuantizedClient) -> None:
    body = qz_client.health()
    assert body["app"] == "quantized"
    assert body["status"] == "ok"


def test_identity_refusal_on_foreign_app() -> None:
    """A fermiviewer-shaped health payload (same {"status": "ok"} shape,
    same default port in real life) must be refused, not silently adopted —
    this is the exact cross-app-adoption bug class fixed 2026-08-05."""
    fake = FastAPI()

    @fake.get("/api/health")
    def fake_health() -> dict[str, str]:
        return {"status": "ok", "app": "fermiviewer", "version": "9.9.9"}

    http = TestClient(fake, base_url="http://testserver")
    client = QuantizedClient(_client=http)
    with pytest.raises(QuantizedConnectionError, match="fermiviewer"):
        client.health()

    # Every other public method must refuse too, not just health() itself —
    # the identity check gates every request, not a one-off call site.
    with pytest.raises(QuantizedConnectionError):
        client.import_path("whatever.csv")
    client.close()


def test_connection_error_wrapped() -> None:
    def _boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    http = httpx.Client(transport=httpx.MockTransport(_boom), base_url="http://127.0.0.1:1")
    client = QuantizedClient(_client=http)
    with pytest.raises(QuantizedConnectionError):
        client.health()
    client.close()


def test_http_error_unwraps_detail(qz_client: QuantizedClient) -> None:
    with pytest.raises(QuantizedClientError, match="unknown job id"):
        qz_client.job_status("not-a-real-job-id")


# ── Import ────────────────────────────────────────────────────────────


def test_import_path(qz_client: QuantizedClient) -> None:
    ds = qz_client.import_path(FIXTURE)
    assert isinstance(ds, DataStruct)
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)
    assert ds.n_points == 401


def test_import_bytes(qz_client: QuantizedClient) -> None:
    ds = qz_client.import_bytes(FIXTURE)
    assert isinstance(ds, DataStruct)
    assert ds.labels == ("Moment",)
    assert ds.n_points == 401


def test_import_bytes_filename_override(qz_client: QuantizedClient, tmp_path: Path) -> None:
    # Same bytes, staged under a name with no registered extension — the
    # override picks the extension the registry actually dispatches on.
    staged = tmp_path / "data.unrecognized"
    staged.write_bytes(FIXTURE.read_bytes())
    ds = qz_client.import_bytes(staged, filename="qd_edp124.dat")
    assert ds.n_points == 401


# ── Corrections ───────────────────────────────────────────────────────


def test_apply_corrections(qz_client: QuantizedClient) -> None:
    x = np.linspace(0.0, 10.0, 50)
    y = 2.0 * x + 1.0
    ds = DataStruct.create(x, y, labels=["signal"], units=["V"])
    corrected = qz_client.apply_corrections(ds, {"xOff": 1.0})
    assert isinstance(corrected, DataStruct)
    assert corrected.n_points == ds.n_points
    assert corrected.time[0] == pytest.approx(ds.time[0] - 1.0)


def test_apply_corrections_with_datastruct_background(qz_client: QuantizedClient) -> None:
    x = np.linspace(0.0, 10.0, 50)
    y = np.full_like(x, 5.0)
    ds = DataStruct.create(x, y, labels=["signal"], units=["V"])
    bg = DataStruct.create(x, np.full_like(x, 2.0), labels=["signal"], units=["V"])
    corrected = qz_client.apply_corrections(ds, {"bgSlope": 0.0, "bgInt": 0.0}, background=bg)
    assert isinstance(corrected, DataStruct)
    assert corrected.n_points == ds.n_points


# ── Fitting ───────────────────────────────────────────────────────────

_TRUE_GAUSSIAN = [2.0, 0.5, 1.2]  # A, mu, sigma


def _gaussian_xy() -> tuple[list[float], list[float]]:
    x = np.linspace(-5.0, 5.0, 201)
    a, mu, sigma = _TRUE_GAUSSIAN
    y = a * np.exp(-((x - mu) ** 2) / (2 * sigma**2))
    return x.tolist(), y.tolist()


def test_fit(qz_client: QuantizedClient) -> None:
    x, y = _gaussian_xy()
    result = qz_client.fit("Gaussian", x, y)
    assert len(result["params"]) == 3
    assert abs(result["params"][0] - _TRUE_GAUSSIAN[0]) < 1e-3
    assert abs(result["params"][1] - _TRUE_GAUSSIAN[1]) < 1e-3


def test_fit_dream_submits_and_polls_to_done(qz_client: QuantizedClient) -> None:
    x, y = _gaussian_xy()
    dy = [0.02] * len(x)
    result = qz_client.fit_dream(
        "Gaussian",
        x,
        y,
        dy,
        p0=[1.0, 0.0, 1.0],
        lower=[0.0, -5.0, 0.01],
        upper=[10.0, 5.0, 10.0],
        samples=240,
        burn=10,
        pop=4,
        poll_interval=0.01,
        timeout=60.0,
    )
    assert result["engine"] == "dream"
    assert result["uncertainty_kind"] == "posterior"
    assert len(result["popt"]) == 3


def test_fit_dream_timeout_raises(qz_client: QuantizedClient) -> None:
    # Deliberately tiny timeout (not a large sample budget) so the deadline
    # is guaranteed to already be past by the first poll — this tests the
    # timeout branch itself, not job duration, and keeps the underlying job
    # small (same fast budget as the poll-to-done test above) so it doesn't
    # tie up a job-pool worker thread for the rest of the suite.
    x, y = _gaussian_xy()
    with pytest.raises(QuantizedClientError, match="did not finish within"):
        qz_client.fit_dream(
            "Gaussian",
            x,
            y,
            p0=[1.0, 0.0, 1.0],
            lower=[0.0, -5.0, 0.01],
            upper=[10.0, 5.0, 10.0],
            samples=240,
            burn=10,
            pop=4,
            poll_interval=0.01,
            timeout=0.0,
        )


# ── Jobs (poll / cancel any job, not just fit_dream's own) ──────────────


def test_job_status_and_cancel_job(qz_client: QuantizedClient) -> None:
    started = threading.Event()

    def body(progress, abort):  # type: ignore[no-untyped-def]
        started.set()
        while True:  # report() raises JobCancelled once the flag is set
            progress(0.1, "looping")
            time.sleep(0.005)

    job_id = global_jobs.submit(body)
    assert started.wait(timeout=10)

    status = qz_client.job_status(job_id)
    assert status["status"] == "running"

    cancelled = qz_client.cancel_job(job_id)
    assert cancelled["status"] in ("running", "cancelled")

    deadline = time.monotonic() + 10.0
    status = qz_client.job_status(job_id)
    while status["status"] not in _TERMINAL and time.monotonic() < deadline:
        time.sleep(0.01)
        status = qz_client.job_status(job_id)
    assert status["status"] == "cancelled"


# ── Frozen public surface (mirrors tests/test_public_api.py) ───────────


def test_client_surface_is_frozen() -> None:
    public = {
        name
        for name in dir(QuantizedClient)
        if not name.startswith("_") and callable(getattr(QuantizedClient, name))
    }
    expected = {
        "health",
        "import_bytes",
        "import_path",
        "apply_corrections",
        "fit",
        "fit_dream",
        "job_status",
        "cancel_job",
        "close",
    }
    assert public == expected, "quantized.client public surface drift — update deliberately"


# ── Opt-in live-socket smoke test (never runs in CI) ────────────────────


@pytest.mark.skipif(
    os.environ.get("QZ_LIVE_SMOKE") != "1",
    reason="opt-in live-socket smoke test; set QZ_LIVE_SMOKE=1 to run",
)
def test_live_socket_smoke() -> None:
    """Real sockets, real headers, a genuine wire-JSON round trip — the one
    thing the ASGI-transport tests above cannot exercise. health -> import
    -> fit against a real uvicorn server on an ephemeral port."""
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10.0
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        assert server.started, "uvicorn did not start within 10s"
        port = server.servers[0].sockets[0].getsockname()[1]

        client = QuantizedClient(base_url=f"http://127.0.0.1:{port}")
        try:
            health = client.health()
            assert health["app"] == "quantized"

            ds = client.import_bytes(FIXTURE)
            assert ds.n_points == 401

            x, y = _gaussian_xy()
            result = client.fit("Gaussian", x, y)
            assert len(result["params"]) == 3
        finally:
            client.close()
    finally:
        server.should_exit = True
        thread.join(timeout=10.0)
