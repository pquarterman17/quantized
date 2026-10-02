"""Local API token: every /api route and /api/ws need it; /api/health does not.

The token reaches the SPA as an HttpOnly cookie that the index sets only for
a request presenting the token in its launch URL (``/?token=...``) -- an
index that handed the cookie to any GET would hand it to any local process.
Programmatic callers send it in the ``X-Quantized-Token`` header.
"""

from __future__ import annotations

import hmac
import html
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import quantized.app as app_mod
from quantized import auth
from quantized.app import create_app
from quantized.security import DEV_VITE_PORT_ENV

TOKEN = "t" * 43
HOST = "127.0.0.1:8000"
COOKIE = "qz_token_8000"
PROTECTED = "/api/fitting/models"


@pytest.fixture
def web_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    (tmp_path / "index.html").write_text("<!doctype html><title>Quantized</title>")
    (tmp_path / "app.js").write_text("console.log(1)")
    monkeypatch.setattr(app_mod, "_WEB_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def app(web_dir: Path, monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    monkeypatch.delenv(DEV_VITE_PORT_ENV, raising=False)
    return create_app(api_token=TOKEN)


def _anon(app: FastAPI, cookies: dict[str, str] | None = None) -> TestClient:
    """A client with NO token (conftest authenticates every TestClient), plus
    ``cookies`` in its jar."""
    c = TestClient(app, headers={"Host": HOST}, cookies=cookies)
    c.headers.pop(auth.TOKEN_HEADER, None)
    return c


def _refresh_target(page: str) -> str:
    m = re.search(r'http-equiv="refresh" content="0; url=([^"]*)"', page)
    assert m, page
    return html.unescape(m.group(1))


def test_refresh_target_is_escaped(app: FastAPI) -> None:
    r = _anon(app).get(f'/?a=%22%3E&b="x<y&token={TOKEN}')
    assert "<y" not in r.text.split("url=", 1)[1]
    assert _refresh_target(r.text).startswith("/?a=")


# ── /api/* ───────────────────────────────────────────────────────────


def test_api_401_without_token(app: FastAPI) -> None:
    c = _anon(app)
    r = c.get(PROTECTED)
    assert r.status_code == 401
    assert r.json() == {"detail": "missing or invalid API token"}
    assert c.post("/api/parsers/import", json={"path": "x"}).status_code == 401


def test_api_401_with_wrong_token(app: FastAPI) -> None:
    c = _anon(app)
    assert c.get(PROTECTED, headers={auth.TOKEN_HEADER: "u" * 43}).status_code == 401
    assert _anon(app, {COOKIE: "u" * 43}).get(PROTECTED).status_code == 401
    # a right token under another port's cookie name is not this server's cookie
    assert _anon(app, {"qz_token_9000": TOKEN}).get(PROTECTED).status_code == 401


def test_api_ok_with_cookie(app: FastAPI) -> None:
    assert _anon(app, {COOKIE: TOKEN}).get(PROTECTED).status_code == 200


def test_api_ok_with_header(app: FastAPI) -> None:
    c = _anon(app)
    assert c.get(PROTECTED, headers={auth.TOKEN_HEADER: TOKEN}).status_code == 200


def test_health_is_exempt(app: FastAPI) -> None:
    r = _anon(app).get("/api/health")
    assert r.status_code == 200
    assert r.json()["app"] == "quantized"


def test_cors_preflight_is_exempt(monkeypatch: pytest.MonkeyPatch, web_dir: Path) -> None:
    # a preflight never carries cookies; the actual request still needs the token
    app = create_app(api_token=TOKEN, dev_origins={"http://localhost:5173"})
    r = _anon(app).options(
        PROTECTED,
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code == 200


def test_compare_is_constant_time(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[bytes, bytes]] = []
    real = hmac.compare_digest

    def spy(a: bytes, b: bytes) -> bool:
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(auth.hmac, "compare_digest", spy)
    _anon(app).get(PROTECTED, headers={auth.TOKEN_HEADER: TOKEN})
    assert (TOKEN.encode(), TOKEN.encode()) in calls


# ── /api/ws ──────────────────────────────────────────────────────────


def test_ws_rejected_without_token(app: FastAPI) -> None:
    with pytest.raises(WebSocketDisconnect) as exc:
        with _anon(app).websocket_connect("/api/ws"):
            pass
    assert exc.value.code == 1008


def test_ws_rejected_with_wrong_token(app: FastAPI) -> None:
    with pytest.raises(WebSocketDisconnect):
        with _anon(app, {COOKIE: "u" * 43}).websocket_connect("/api/ws"):
            pass


def test_ws_accepted_with_cookie(app: FastAPI) -> None:
    before = app_mod._clients
    with _anon(app, {COOKIE: TOKEN}).websocket_connect("/api/ws"):
        assert app_mod._clients == before + 1


# ── SPA index: the cookie bootstrap ──────────────────────────────────


def test_index_without_token_is_401_page(app: FastAPI) -> None:
    r = _anon(app).get("/")
    assert r.status_code == 401
    assert "text/html" in r.headers["content-type"]
    assert "set-cookie" not in r.headers


def test_index_with_wrong_token_sets_no_cookie(app: FastAPI) -> None:
    r = _anon(app).get("/?token=" + "u" * 43, follow_redirects=False)
    assert r.status_code == 401
    assert "set-cookie" not in r.headers


def test_index_launch_url_sets_cookie_and_strips_token(app: FastAPI) -> None:
    r = _anon(app).get(f"/?view=calc&token={TOKEN}", follow_redirects=False)
    # a meta refresh, not a 303: Chromium withholds a Strict cookie from a
    # redirect chain that another site started (web_guard._bootstrap)
    assert r.status_code == 200
    assert _refresh_target(r.text) == "/?view=calc"
    cookie = r.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}={TOKEN};")
    attrs = {a.strip().lower() for a in cookie.split(";")[1:]}
    assert {"httponly", "samesite=strict", "path=/"} <= attrs
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["referrer-policy"] == "no-referrer"


def test_index_with_cookie_serves_spa(app: FastAPI) -> None:
    c = _anon(app)
    boot = c.get(f"/?token={TOKEN}")
    r = c.get(_refresh_target(boot.text))  # what the refresh loads, cookie in the jar
    assert r.status_code == 200
    assert "<title>Quantized</title>" in r.text
    assert c.get(PROTECTED).status_code == 200  # the jar now authenticates /api


def test_static_assets_are_exempt(app: FastAPI) -> None:
    assert _anon(app).get("/app.js").status_code == 200


def test_dev_bootstrap_only_in_dev(web_dir: Path) -> None:
    prod = create_app(api_token=TOKEN, dev_origins=())
    r = _anon(prod).get(f"/api/auth/bootstrap?token={TOKEN}", follow_redirects=False)
    assert r.status_code == 401
    dev = create_app(api_token=TOKEN, dev_origins={"http://localhost:5173"})
    c = TestClient(dev, headers={"Host": "localhost:5173"})
    c.headers.pop(auth.TOKEN_HEADER, None)
    r = c.get(f"/api/auth/bootstrap?token={TOKEN}&view=calc", follow_redirects=False)
    assert r.status_code == 200
    assert _refresh_target(r.text) == "/?view=calc"
    assert r.headers["set-cookie"].startswith(f"qz_token_5173={TOKEN};")
    bad = c.get("/api/auth/bootstrap?token=nope", follow_redirects=False)
    assert bad.status_code == 401


# ── token source ─────────────────────────────────────────────────────


def test_token_comes_from_env(monkeypatch: pytest.MonkeyPatch, web_dir: Path) -> None:
    monkeypatch.setenv(auth.TOKEN_ENV, "e" * 40)
    assert create_app().state.api_token == "e" * 40


def test_token_random_per_app_without_env(monkeypatch: pytest.MonkeyPatch, web_dir: Path) -> None:
    monkeypatch.delenv(auth.TOKEN_ENV, raising=False)
    a, b = create_app().state.api_token, create_app().state.api_token
    assert a != b
    assert len(a) >= 43


@pytest.mark.parametrize("bad", ["short", "x" * 40 + ";", "x" * 40 + " y"])
def test_weak_or_unsafe_env_token_refused(monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    monkeypatch.setenv(auth.TOKEN_ENV, bad)
    with pytest.raises(ValueError, match=auth.TOKEN_ENV):
        auth.resolve_token()


@pytest.mark.parametrize(
    ("query", "kept"),
    [
        ("token=x", ""),
        ("harness&token=x", "harness"),
        ("view=calc&token=x&a=1", "view=calc&a=1"),
        ("%74oken=x&b=%20", "b=%20"),
    ],
)
def test_strip_token_query_keeps_the_rest_verbatim(query: str, kept: str) -> None:
    assert auth.strip_token_query(query) == kept


# ── Content-Security-Policy ──────────────────────────────────────────


def test_index_and_assets_carry_the_csp(app: FastAPI) -> None:
    c = _anon(app, {COOKIE: TOKEN})
    for path in ("/", "/app.js"):
        csp = c.get(path).headers["content-security-policy"]
        for directive in (
            "default-src 'self'",
            "script-src 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
        ):
            assert directive in csp
        assert "unsafe-eval" not in csp
        assert "'unsafe-inline'" not in csp.split("style-src-attr")[0]  # scripts/sheets never
    assert "content-security-policy" in _anon(app).get("/").headers  # the locked page too


def test_api_responses_carry_no_csp(app: FastAPI) -> None:
    # an exported PDF opened in a tab must keep the browser's PDF viewer
    assert "content-security-policy" not in _anon(app).get("/api/health").headers
