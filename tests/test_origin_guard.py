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

import asyncio
import json
import select
import socket
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient

from quantized import app as app_module
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


@pytest.fixture
def live_port(monkeypatch: pytest.MonkeyPatch) -> Iterator[int]:
    """``qz --desktop`` binds up front (``_bind``) and hands the socket to
    uvicorn; pywebview then loads ``http://127.0.0.1:<port>``. Port 0 here is
    the auto-pick case: nothing knows the port before the bind."""
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
        yield port
    finally:
        server.should_exit = True
        t.join(timeout=10)


def _other_port(port: int) -> int:
    return port + 1 if port < 65535 else port - 1


def test_desktop_mode_real_server_on_auto_picked_port(live_port: int, transfer_root: Path) -> None:
    """The guard must take the auto-picked port from the live request (Host),
    not from config: nothing knew it before the bind."""
    port = live_port
    base = f"http://127.0.0.1:{port}"
    for alias in ("127.0.0.1", "localhost"):
        own = f"http://{alias}:{port}"
        assert _request(f"{base}/api/health", own) == 200
        assert _request(f"{base}{TRANSFER}", own, "POST") == 200
    n_written = len(_written(transfer_root))
    assert n_written > 0
    other = f"http://127.0.0.1:{_other_port(port)}"
    assert _request(f"{base}/api/health", other) == 403
    assert _request(f"{base}{TRANSFER}", other, "POST") == 403
    assert _request(f"{base}{TRANSFER}", f"https://127.0.0.1:{port}", "POST") == 403
    assert len(_written(transfer_root)) == n_written


# ── a refused request's body is drained before the 403 (no TCP reset) ───────


def _read_to_eof(c: socket.socket) -> bytes:
    chunks = []
    while chunk := c.recv(65536):
        chunks.append(chunk)
    return b"".join(chunks)


@pytest.mark.parametrize(
    ("host", "origin", "detail"),
    [
        ("127.0.0.1:{port}", "http://127.0.0.1:{other}", BLOCKED),
        ("evil.example:{port}", None, "unrecognized Host header"),  # DNS rebinding
    ],
    ids=["origin-guard", "host-guard"],
)
def test_refused_post_is_answered_after_its_body_not_reset(
    live_port: int, transfer_root: Path, host: str, origin: str | None, detail: str
) -> None:
    """Forces the Windows CI race behind ``ConnectionResetError [WinError
    10054]`` in the desktop-mode test above, on every run and every OS.

    http.client sends a request's headers and its body in two ``send()``
    calls. The guard used to answer from the headers alone; uvicorn then
    closed the connection (urllib sends ``Connection: close``) with the body
    unread or still in flight, and the server's kernel answered that body with
    a TCP RST instead of a FIN. Windows discards received-but-unread data on
    an RST, so the client could lose the 403 it had already been sent. Here
    the body is held back until the server has had ample time to answer from
    the headers alone -- before the fix it always did, and the reset
    followed."""
    port = live_port
    fields = {"Host": host.format(port=port), "Content-Type": "text/plain"}
    if origin is not None:
        fields["Origin"] = origin.format(other=_other_port(port))
    head = f"POST {TRANSFER} HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in fields.items())
    head += "Content-Length: 2\r\nConnection: close\r\n\r\n"
    with socket.create_connection(("127.0.0.1", port), timeout=10) as c:
        c.sendall(head.encode("ascii"))
        answered_early, _, _ = select.select([c], [], [], 0.5)
        assert not answered_early, "refused from the headers alone, before its body was read"
        c.sendall(b"{}")
        raw = _read_to_eof(c)  # the unfixed guard: ConnectionResetError here
        assert c.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR) == 0  # FIN, not RST
    status, _, body = raw.partition(b"\r\n\r\n")
    assert status.startswith(b"HTTP/1.1 403 ")
    assert json.loads(body) == {"detail": detail}
    assert _written(transfer_root) == []


def _refuse_via_asgi(
    receive: Callable[[], Awaitable[dict[str, Any]]], *extra: tuple[bytes, bytes]
) -> tuple[int, dict[bytes, bytes], bytes]:
    """One cross-origin POST straight through the ASGI app, so the test owns
    every ``receive()`` the guard makes."""
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": TRANSFER,
        "raw_path": TRANSFER.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"127.0.0.1:8000"),
            (b"origin", b"http://localhost:8888"),
            (b"content-type", b"text/plain"),
            *extra,
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("127.0.0.1", 8000),
    }
    sent: list[dict[str, Any]] = []

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    asyncio.run(create_app(dev_origins=())(scope, receive, send))
    start, *rest = sent
    return int(start["status"]), dict(start["headers"]), b"".join(m["body"] for m in rest)


def test_refusal_drains_a_small_body_and_keeps_the_connection() -> None:
    reads = 0

    async def receive() -> dict[str, Any]:
        nonlocal reads
        reads += 1
        return {"type": "http.request", "body": b"{}", "more_body": False}

    status, headers, body = _refuse_via_asgi(receive)
    assert (status, json.loads(body)) == (403, {"detail": BLOCKED})
    assert reads == 1
    assert b"connection" not in headers  # fully read: keep-alive stays usable


def test_refusal_reads_only_a_bounded_prefix_of_an_endless_body() -> None:
    """An attacker's body is never read without limit: past the cap the guard
    stops, answers, and tells the server to close rather than keep reading."""
    chunk = 16 * 1024
    reads = 0

    async def endless() -> dict[str, Any]:
        nonlocal reads
        reads += 1
        return {"type": "http.request", "body": b"x" * chunk, "more_body": True}

    status, headers, body = _refuse_via_asgi(endless)
    assert (status, json.loads(body)) == (403, {"detail": BLOCKED})
    assert headers.get(b"connection") == b"close"
    assert 1 < reads <= app_module._REFUSED_BODY_DRAIN_CAP // chunk + 1


def test_refusal_does_not_invite_a_100_continue_body() -> None:
    """Reading would make the server send ``100 Continue``, soliciting the
    very body being refused; a final 403 + close is the RFC 9110 answer."""
    reads = 0

    async def receive() -> dict[str, Any]:
        nonlocal reads
        reads += 1
        return {"type": "http.request", "body": b"{}", "more_body": False}

    status, headers, body = _refuse_via_asgi(receive, (b"expect", b"100-continue"))
    assert (status, json.loads(body)) == (403, {"detail": BLOCKED})
    assert reads == 0
    assert headers.get(b"connection") == b"close"


def test_refusal_survives_a_client_that_disconnects_mid_body() -> None:
    async def gone() -> dict[str, Any]:
        return {"type": "http.disconnect"}

    status, headers, body = _refuse_via_asgi(gone)
    assert (status, json.loads(body)) == (403, {"detail": BLOCKED})
    assert headers.get(b"connection") == b"close"
