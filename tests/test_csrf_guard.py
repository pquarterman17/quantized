"""Cross-origin (CSRF) + Host-header (DNS-rebinding) guards on the API.

Adapted from fermiviewer ``tests/test_csrf_guard.py`` (shared platform
code — keep in sync). Booked from the 2026-08-05 cross-repo inventory:
quantized relied on CORSMiddleware alone, which guards neither.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.security import DEV_VITE_PORT_ENV


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # a non-dev app: no Vite origin, whatever the ambient environment holds
    monkeypatch.delenv(DEV_VITE_PORT_ENV, raising=False)
    return TestClient(create_app())


def test_no_origin_allowed(client: TestClient) -> None:
    # same-origin navigations / desktop shell / curl / tests send no Origin
    assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize(
    ("host", "origin"),
    [
        # BUG-030: "our origin" is the request's own Host port, so each case
        # names the Host the browser connected to (TestClient defaults to
        # "testserver"). The Vite dev origin moved to test_origin_guard.py:
        # it is allowed under qz --dev only.
        ("127.0.0.1:8000", "http://127.0.0.1:8000"),  # served SPA
        ("localhost:8000", "http://localhost:8000"),
        ("testserver", "http://testserver"),
        ("127.0.0.1:8000", "tauri://localhost"),  # Tauri (macOS/Linux)
        ("127.0.0.1:8000", "http://tauri.localhost"),  # Tauri (Windows)
    ],
)
def test_app_origins_allowed(client: TestClient, host: str, origin: str) -> None:
    r = client.get("/api/health", headers={"Host": host, "Origin": origin})
    assert r.status_code == 200


@pytest.mark.parametrize("origin", ["https://evil.example", "http://attacker.test:8000", "null"])
def test_foreign_origin_blocked(client: TestClient, origin: str) -> None:
    # reads…
    assert client.get("/api/health", headers={"Origin": origin}).status_code == 403
    # …and mutations are both rejected before reaching the route
    r = client.post(
        "/api/parsers/import", json={"path": "x"}, headers={"Origin": origin}
    )
    assert r.status_code == 403


def test_guard_only_covers_api(client: TestClient) -> None:
    # non-/api paths aren't origin-guarded (no 403 from the guard)
    assert client.get("/", headers={"Origin": "https://evil.example"}).status_code != 403


# ── Host header (DNS-rebinding) guard ────────────────────────────────


def test_spoofed_host_blocked(client: TestClient) -> None:
    # no Origin header at all — the same-origin request a DNS-rebinding
    # attack relies on — but the Host header names a foreign hostname
    r = client.get("/api/health", headers={"Host": "evil.example"})
    assert r.status_code == 403


@pytest.mark.parametrize(
    "host",
    [
        "127.0.0.1",
        "127.0.0.1:8000",
        "localhost",
        "localhost:5173",
        "[::1]",
        "[::1]:8000",
        "testserver",  # conftest.py extends ALLOWED_HOSTS for the suite
    ],
)
def test_allowed_hosts_pass(client: TestClient, host: str) -> None:
    assert client.get("/api/health", headers={"Host": host}).status_code == 200


def test_host_guard_covers_non_api_paths_too(client: TestClient) -> None:
    # unlike the Origin/CSRF guard, the Host guard applies everywhere —
    # DNS rebinding isn't limited to /api
    assert client.get("/", headers={"Host": "evil.example"}).status_code == 403


def test_ws_upgrade_rejects_spoofed_host(client: TestClient) -> None:
    # the HTTP middleware doesn't run on the WS upgrade; app.py enforces
    # the same host check in the handler (close-before-accept). Starlette
    # raises on a server-side close during connect — a clean connect means
    # the guard is NOT running (asserted after, so nothing here can swallow
    # its own assertion).
    rejected = False
    try:
        with client.websocket_connect("/api/ws", headers={"host": "evil.example"}):
            pass
    except Exception:
        rejected = True
    assert rejected, "spoofed-host WS upgrade was accepted"
