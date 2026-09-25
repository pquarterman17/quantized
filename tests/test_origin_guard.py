"""BUG-030: the API's Origin guard admits only this server's OWN origin.

The 2026-09-25 security review measured ``Origin: http://localhost:8888`` on
a text/plain POST being accepted with a 200: ``origin_allowed`` passed any
loopback origin on any port, so a page from another local dev server or
local app could drive the write routes (file writes, job submission). The
rule is now: the Origin's scheme and port must equal the request's own
scheme and Host port (``localhost`` / ``127.0.0.1`` interchangeable), plus
the exact Tauri shell origins, plus the Vite dev origin under ``qz --dev``
only. The pre-existing cases live in ``test_csrf_guard.py``.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient

from quantized import server_launch
from quantized.app import create_app
from quantized.io.workbook_transfer_store import TransferStore
from quantized.routes import workbook_transfer
from quantized.security import (
    DEV_VITE_PORT_ENV,
    dev_origins,
    dev_origins_from_env,
    origin_allowed,
)

BLOCKED = "cross-origin API request blocked"
TRANSFER = "/api/workbook-transfer/packages"
JOB_CANCEL = "/api/jobs/no-such-job/cancel"


@pytest.fixture
def transfer_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Point the file-writing transfer route at a temp dir we can inspect."""
    root = tmp_path / "transfer"
    monkeypatch.setattr(
        workbook_transfer, "_store", lambda: TransferStore(root, min_package_bytes=1)
    )
    return root


def _written(root: Path) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file()] if root.exists() else []


@pytest.fixture
def prod(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The app as `qz` / `qz --desktop` / the e2e server build it (no --dev)."""
    monkeypatch.delenv(DEV_VITE_PORT_ENV, raising=False)
    return TestClient(create_app())


@pytest.fixture
def dev(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The app as `qz --dev` builds it: server_launch exports the Vite port."""
    monkeypatch.setenv(DEV_VITE_PORT_ENV, str(server_launch._VITE_PORT))
    return TestClient(create_app())


def _assert_blocked(r: httpx.Response) -> None:
    assert r.status_code == 403
    assert r.json() == {"detail": BLOCKED}
    assert r.content.isascii()


# ── same origin: both loopback aliases of the SAME port ──────────────────────


@pytest.mark.parametrize("port", [8000, 51234])  # default + an auto-picked port
@pytest.mark.parametrize("host_name", ["127.0.0.1", "localhost"])
@pytest.mark.parametrize("origin_name", ["127.0.0.1", "localhost"])
def test_same_origin_either_alias_allowed_read_and_write(
    prod: TestClient, transfer_root: Path, port: int, host_name: str, origin_name: str
) -> None:
    h = {"Host": f"{host_name}:{port}", "Origin": f"http://{origin_name}:{port}"}
    assert prod.get("/api/health", headers=h).status_code == 200  # read
    # writes reach their route: an unknown job is the route's own 404 ...
    assert prod.post(JOB_CANCEL, headers=h).status_code == 404
    # ... and the text/plain file write succeeds and lands on disk
    r = prod.post(TRANSFER, content=b"{}", headers={**h, "Content-Type": "text/plain"})
    assert r.status_code == 200, r.text
    assert _written(transfer_root)


# ── a different localhost port is refused (the reported gap) ─────────────────


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:8888",  # the review's reproduction
        "http://127.0.0.1:8888",
        "http://localhost:5173",  # a Vite dev server, outside --dev
        "http://localhost",  # port 80, not 8000
        "http://[::1]:8000",  # ::1 is NOT an alias of 127.0.0.1 (other socket)
    ],
)
def test_other_local_origin_refused_read_and_write(
    prod: TestClient, transfer_root: Path, origin: str
) -> None:
    h = {"Host": "127.0.0.1:8000", "Origin": origin}
    _assert_blocked(prod.get("/api/health", headers=h))
    _assert_blocked(prod.post(JOB_CANCEL, headers=h))
    r = prod.post(TRANSFER, content=b"{}", headers={**h, "Content-Type": "text/plain"})
    _assert_blocked(r)
    assert _written(transfer_root) == []  # blocked BEFORE the route wrote anything


@pytest.mark.parametrize("origin", ["https://127.0.0.1:8000", "https://localhost:8000"])
def test_different_scheme_refused(prod: TestClient, origin: str) -> None:
    h = {"Host": "127.0.0.1:8000", "Origin": origin}
    _assert_blocked(prod.get("/api/health", headers=h))
    _assert_blocked(prod.post(JOB_CANCEL, headers=h))


def test_ipv6_origin_passes_only_on_an_ipv6_host(prod: TestClient) -> None:
    h = {"Host": "[::1]:8000", "Origin": "http://[::1]:8000"}
    assert prod.get("/api/health", headers=h).status_code == 200


def test_missing_and_null_origin_unchanged(prod: TestClient) -> None:
    h = {"Host": "127.0.0.1:8000"}
    assert prod.post(JOB_CANCEL, headers=h).status_code == 404  # no Origin: passes
    _assert_blocked(prod.post(JOB_CANCEL, headers={**h, "Origin": "null"}))


# ── the Vite dev origin: --dev only ──────────────────────────────────────────


@pytest.mark.parametrize("vite_host", ["localhost", "127.0.0.1"])
def test_dev_origin_allowed_in_dev_mode(dev: TestClient, vite_host: str) -> None:
    origin = f"http://{vite_host}:{server_launch._VITE_PORT}"
    h = {"Host": "127.0.0.1:8000", "Origin": origin}  # direct cross-origin call
    r = dev.get("/api/health", headers=h)
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == origin  # CORS read too
    assert dev.post(JOB_CANCEL, headers=h).status_code == 404


def test_dev_origin_refused_outside_dev_mode(prod: TestClient) -> None:
    origin = f"http://localhost:{server_launch._VITE_PORT}"
    h = {"Host": "127.0.0.1:8000", "Origin": origin}
    r = prod.get("/api/health", headers=h)
    _assert_blocked(r)
    assert "access-control-allow-origin" not in r.headers
    _assert_blocked(prod.post(JOB_CANCEL, headers=h))


def test_dev_mode_admits_only_the_configured_vite_port(dev: TestClient) -> None:
    h = {"Host": "127.0.0.1:8000", "Origin": f"http://localhost:{server_launch._VITE_PORT + 1}"}
    _assert_blocked(dev.post(JOB_CANCEL, headers=h))


def test_vite_proxied_request_is_same_origin(prod: TestClient) -> None:
    # vite.config.ts proxies /api without changeOrigin, so the backend sees
    # the Vite Host AND the Vite Origin: same-origin by the Host rule.
    port = server_launch._VITE_PORT
    h = {"Host": f"localhost:{port}", "Origin": f"http://localhost:{port}"}
    assert prod.post(JOB_CANCEL, headers=h).status_code == 404


@pytest.mark.parametrize("value", ["", "abc", "0", "70000", "-5173"])
def test_invalid_dev_port_env_admits_nothing(value: str) -> None:
    assert dev_origins_from_env({DEV_VITE_PORT_ENV: value}) == frozenset()


def test_dev_origins_from_env() -> None:
    assert dev_origins_from_env({DEV_VITE_PORT_ENV: "5173"}) == {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }
    assert dev_origins_from_env({}) == frozenset()
    assert dev_origins(None) == frozenset()


# ── the WS upgrade shares the rule ───────────────────────────────────────────


def test_ws_same_origin_accepted_other_port_refused(prod: TestClient) -> None:
    ok = {"host": "127.0.0.1:8000", "origin": "http://localhost:8000"}
    with prod.websocket_connect("/api/ws", headers=ok):
        pass
    rejected = False
    try:
        with prod.websocket_connect(
            "/api/ws", headers={**ok, "origin": "http://localhost:8888"}
        ):
            pass
    except Exception:
        rejected = True
    assert rejected, "other-port WS upgrade was accepted"


# ── pure-function edge cases ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "origin",
    [
        "http://127.0.0.1:8000/path",
        "http://user@127.0.0.1:8000",
        "http://127.0.0.1:99999",
        "file://",
        "null",
        "",
    ],
)
def test_malformed_origin_refused(origin: str) -> None:
    assert not origin_allowed(origin, host_header="127.0.0.1:8000", scheme="http")


def test_ws_scheme_maps_to_http_origin() -> None:
    assert origin_allowed("http://localhost:8000", host_header="127.0.0.1:8000", scheme="ws")
    assert not origin_allowed("https://localhost:8000", host_header="127.0.0.1:8000", scheme="ws")


def test_missing_host_refuses_any_origin() -> None:
    assert not origin_allowed("http://localhost:8000", host_header=None, scheme="http")


# ── desktop mode: a real uvicorn on an OS-picked port, as _run_desktop runs it ─


def _request(url: str, origin: str, method: str = "GET") -> int:
    req = urllib.request.Request(url, method=method, headers={"Origin": origin})
    if method == "POST":
        req.data = b"{}"
        req.add_header("Content-Type", "text/plain")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return int(r.status)
    except urllib.error.HTTPError as e:
        if e.code == 403:
            assert json.loads(e.read()) == {"detail": BLOCKED}
        return int(e.code)


def test_desktop_mode_real_server_on_auto_picked_port(
    monkeypatch: pytest.MonkeyPatch, transfer_root: Path
) -> None:
    """``qz --desktop`` binds up front (``_bind``) and hands the socket to
    uvicorn; pywebview then loads ``http://127.0.0.1:<port>``. Port 0 here is
    the auto-pick case: nothing knows the port before the bind, so the guard
    must take it from the live request (Host), not from config."""
    monkeypatch.delenv(DEV_VITE_PORT_ENV, raising=False)
    sock = server_launch._bind("127.0.0.1", 0)
    assert sock is not None
    port = int(sock.getsockname()[1])
    server = uvicorn.Server(
        uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning")
    )
    t = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    t.start()
    try:
        deadline = time.monotonic() + 20
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        assert server.started
        base = f"http://127.0.0.1:{port}"
        for alias in ("127.0.0.1", "localhost"):
            own = f"http://{alias}:{port}"
            assert _request(f"{base}/api/health", own) == 200
            assert _request(f"{base}{TRANSFER}", own, "POST") == 200
        n_written = len(_written(transfer_root))
        assert n_written > 0
        other = f"http://127.0.0.1:{port + 1 if port < 65535 else port - 1}"
        assert _request(f"{base}/api/health", other) == 403
        assert _request(f"{base}{TRANSFER}", other, "POST") == 403
        assert _request(f"{base}{TRANSFER}", f"https://127.0.0.1:{port}", "POST") == 403
        assert len(_written(transfer_root)) == n_written
    finally:
        server.should_exit = True
        t.join(timeout=10)
