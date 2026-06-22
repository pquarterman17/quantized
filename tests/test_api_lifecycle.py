"""Integration tests for the /api/ws presence WebSocket (TestClient)."""

from __future__ import annotations

from fastapi.testclient import TestClient

import quantized.app as app_mod
from quantized.app import app

client = TestClient(app)


def test_ws_accepts_and_tracks_presence() -> None:
    before = app_mod._clients
    with client.websocket_connect("/api/ws"):
        # the connection is accepted and counted while open
        assert app_mod._clients == before + 1
    # ...and released on disconnect
    assert app_mod._clients == before


def test_ws_open_does_not_block_http() -> None:
    with client.websocket_connect("/api/ws"):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


def test_ws_rejects_cross_origin() -> None:
    try:
        with client.websocket_connect("/api/ws", headers={"origin": "http://evil.example"}):
            raise AssertionError("cross-origin WS should have been rejected")
    except Exception:
        pass  # starlette raises on a server-side close during connect
