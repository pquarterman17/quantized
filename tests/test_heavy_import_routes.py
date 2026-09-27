"""A heavy-import lock timeout reaches the client as a retryable 503 (BUG-032).

``quantized.heavy_import`` bounds every slow-path lock wait by
``HEAVY_IMPORT_TIMEOUT_S`` and raises ``HeavyImportTimeout``; the routes map it
exactly like ``RenderLockTimeout`` -- through ``raise_calc_error`` where a
route already catches ``CALC_ERRORS_WITH_LOCK``, and through an app-level
exception handler everywhere else -- so a stuck first import in another
thread fails one request with a message, never an unbounded hang or a 500.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from quantized import heavy_import as hi
from quantized.app import app, create_app

_JOIN_S = 10.0


@pytest.fixture
def quantized_lock_held(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Another thread holds the ``quantized`` package's heavy-import lock (as
    a stuck first import of a ``quantized.*`` module would), every guarded
    import is forced onto the slow path, and the timeout is short."""
    monkeypatch.setattr(hi, "_fast_path_ok", lambda modules: False)
    monkeypatch.setattr(hi, "HEAVY_IMPORT_TIMEOUT_S", 0.1)
    held, release = threading.Event(), threading.Event()

    def hold() -> None:
        with hi._package("quantized").lock:
            held.set()
            release.wait(_JOIN_S)

    holder = threading.Thread(target=hold, daemon=True)
    holder.start()
    assert held.wait(_JOIN_S)
    try:
        yield
    finally:
        release.set()
        holder.join(_JOIN_S)


def test_export_route_maps_a_heavy_import_timeout_to_503(quantized_lock_held: None) -> None:
    dataset = {
        "time": [1.0, 2.0, 3.0],
        "values": [[1.0], [2.0], [3.0]],
        "labels": ["y"],
        "units": [""],
        "metadata": {},
    }
    resp = TestClient(app).post("/api/export/figure", json={"dataset": dataset, "fmt": "png"})
    assert resp.status_code == 503, resp.text
    assert "retry later" in resp.json()["detail"]


def test_app_handler_maps_an_uncaught_heavy_import_timeout_to_503() -> None:
    application = create_app()

    @application.get("/api/_hvr_probe")
    def probe() -> None:
        raise hi.HeavyImportTimeout("stuck first import; retry later")

    resp = TestClient(application).get("/api/_hvr_probe")
    assert resp.status_code == 503, resp.text
    assert resp.json() == {"detail": "stuck first import; retry later"}
