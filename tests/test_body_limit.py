"""Request body caps, enforced while the body streams in (``quantized.body_limit``).

A declared ``Content-Length`` over the cap is refused before a byte of the
body is read; a chunked body is counted and refused as soon as it passes the
cap -- never after Starlette has spooled the whole upload.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from quantized import body_limit
from quantized.app import create_app
from quantized.routes import _uploadstream

JSON_ROUTE = "/api/parsers/import"
UPLOAD_ROUTE = "/api/parsers/upload"


@pytest.fixture(scope="module")
def app() -> FastAPI:
    return create_app(dev_origins=())


def test_limits_are_the_documented_values() -> None:
    assert body_limit.MAX_JSON_BODY_BYTES == 256 * 1024 * 1024
    assert body_limit.limit_for("application/json") == 256 * 1024 * 1024
    assert body_limit.limit_for("multipart/form-data; boundary=x") == (
        _uploadstream.MAX_UPLOAD_BYTES + body_limit.MULTIPART_OVERHEAD_BYTES
    )


def test_json_over_declared_length_is_413(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(body_limit, "MAX_JSON_BODY_BYTES", 64)
    r = TestClient(app).post(JSON_ROUTE, json={"path": "x" * 100})
    assert r.status_code == 413
    assert r.json() == {"detail": "request body too large (limit 64 bytes)"}
    assert r.headers["connection"] == "close"


def test_json_under_the_cap_reaches_the_route(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(body_limit, "MAX_JSON_BODY_BYTES", 4096)
    r = TestClient(app).post(JSON_ROUTE, json={"path": "/nonexistent/x.csv"})
    assert r.status_code not in (413, 401)


def test_chunked_json_over_the_cap_is_413(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(body_limit, "MAX_JSON_BODY_BYTES", 64)

    def chunks() -> Iterator[bytes]:
        yield b'{"path": "'
        yield b"x" * 100
        yield b'"}'

    r = TestClient(app).post(
        JSON_ROUTE, content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 413
    assert r.json()["detail"] == "request body too large (limit 64 bytes)"


# ── multipart, straight through ASGI so the test owns every receive() ──


def _run(
    app: FastAPI, headers: list[tuple[bytes, bytes]], bodies: list[bytes]
) -> tuple[int, dict[bytes, bytes], bytes, int]:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": UPLOAD_ROUTE,
        "raw_path": UPLOAD_ROUTE.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"127.0.0.1:8000"),
            (b"x-quantized-token", app.state.api_token.encode()),
            *headers,
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("127.0.0.1", 8000),
    }
    reads = 0

    async def receive() -> dict[str, Any]:
        nonlocal reads
        reads += 1
        if reads <= len(bodies):
            return {
                "type": "http.request",
                "body": bodies[reads - 1],
                "more_body": reads < len(bodies),
            }
        await asyncio.sleep(3600)  # a client that has nothing more to send
        return {"type": "http.disconnect"}

    sent: list[dict[str, Any]] = []

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    asyncio.run(asyncio.wait_for(app(scope, receive, send), timeout=30))
    start, *rest = sent
    return (
        int(start["status"]),
        dict(start["headers"]),
        b"".join(m.get("body", b"") for m in rest),
        reads,
    )


_BOUNDARY = b"qzboundary"
_MULTIPART = (b"content-type", b"multipart/form-data; boundary=" + _BOUNDARY)


def _multipart_chunks(n_chunks: int, size: int) -> list[bytes]:
    head = (
        b"--" + _BOUNDARY + b'\r\nContent-Disposition: form-data; name="file"; '
        b'filename="big.csv"\r\nContent-Type: text/csv\r\n\r\n'
    )
    return [head] + [b"1,2\n" * (size // 4)] * n_chunks + [b"\r\n--" + _BOUNDARY + b"--\r\n"]


def test_upload_over_declared_length_refused_before_reading(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_uploadstream, "MAX_UPLOAD_BYTES", 1000)
    monkeypatch.setattr(body_limit, "MULTIPART_OVERHEAD_BYTES", 24)
    bodies = _multipart_chunks(10, 1024)
    declared = str(sum(map(len, bodies))).encode()
    status, headers, body, reads = _run(app, [_MULTIPART, (b"content-length", declared)], bodies)
    assert status == 413
    assert json.loads(body) == {"detail": "request body too large (limit 1024 bytes)"}
    assert headers[b"connection"] == b"close"
    assert reads == 0  # not one body chunk read, so nothing was spooled


def test_chunked_upload_refused_as_it_streams(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_uploadstream, "MAX_UPLOAD_BYTES", 4000)
    monkeypatch.setattr(body_limit, "MULTIPART_OVERHEAD_BYTES", 96)
    bodies = _multipart_chunks(1000, 1024)  # ~1 MB offered, 4 kB allowed
    status, headers, body, reads = _run(app, [_MULTIPART], bodies)
    assert status == 413
    assert json.loads(body) == {"detail": "request body too large (limit 4096 bytes)"}
    assert headers[b"connection"] == b"close"
    assert reads <= 6  # stopped at the cap, not after spooling all 1002 chunks


def test_upload_under_the_cap_still_imports(app: FastAPI) -> None:
    r = TestClient(app).post(
        UPLOAD_ROUTE, files={"file": ("tiny.csv", b"x,y\n1,2\n2,3\n3,5\n", "text/csv")}
    )
    assert r.status_code == 200, r.text
