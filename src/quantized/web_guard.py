"""The local server's request guard: Host, Origin, API token, SPA index, CSP.

``app.py`` installs :func:`security_guard` as its HTTP middleware and calls
:func:`origin_ok` / :func:`authorized` on the ``/api/ws`` upgrade, which no
HTTP middleware sees. The pure checks live in ``quantized.security`` (Host,
Origin) and ``quantized.auth`` (token); this module applies them to Starlette
requests.

Order per request:

1. Host (every path) -- the DNS-rebinding guard; 403.
2. ``/api/*``: Origin (the CSRF guard; 403), then the API token (401), except
   ``/api/health`` (launch and e2e readiness probes) and CORS preflights,
   which never carry cookies. Under ``qz --dev`` only,
   ``/api/auth/bootstrap?token=...`` sets the cookie on the Vite origin.
3. The SPA index (``/``, ``/index.html``): ``?token=`` matching the server's
   token sets the cookie and redirects to strip it; a request with neither a
   valid token nor the cookie gets a short 401 page instead of an app that
   cannot reach its API. Static assets are served to anyone (no secrets).
4. Every non-API response carries the Content-Security-Policy.
"""

from __future__ import annotations

import html
from collections.abc import Awaitable, Callable
from contextlib import aclosing

from starlette.requests import ClientDisconnect, HTTPConnection, Request
from starlette.responses import HTMLResponse, JSONResponse, Response

from quantized.auth import (
    DEV_BOOTSTRAP_PATH,
    TOKEN_HEADER,
    TOKEN_QUERY,
    cookie_name,
    set_cookie_value,
    strip_token_query,
    tokens_equal,
)
from quantized.security import host_allowed, host_port, origin_allowed

__all__ = ["CSP", "DEV_BOOTSTRAP_PATH", "authorized", "origin_ok", "security_guard"]

# The baseline policy plus only what a full Chromium e2e run reported as a
# securitypolicyviolation without it (docs/api_auth.md):
# - style-src-attr 'unsafe-inline': KaTeX's renderToString markup (equation
#   previews) and several components use inline style attributes. Style
#   sheets and <style> elements stay 'self'-only.
# - img-src data: -- report/figure previews and thumbnails are data: PNGs.
# - font-src data: -- the KaTeX stylesheet inlines a small data: font.
# connect-src falls back to 'self', which also covers the same-origin ws: of
# /api/ws. frontend/e2e/specs/csp-auth.spec.ts fails on any violation.
CSP = (
    "default-src 'self'; script-src 'self'; object-src 'none'; "
    "frame-ancestors 'none'; base-uri 'self'; "
    "style-src 'self'; style-src-attr 'unsafe-inline'; "
    "img-src 'self' data:; font-src 'self' data:"
)

_INDEX_PATHS = frozenset({"/", "/index.html"})
_PUBLIC_API = frozenset({"/api/health"})
_UNAUTHORIZED = "missing or invalid API token"
_LOCKED_PAGE = (
    "<!doctype html><html lang=en><meta charset=utf-8><title>Quantized</title>"
    "<p>This Quantized window needs its launch link. Open Quantized again, or "
    "use the link qz printed when it started.</p></html>"
)
_NO_STORE = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}

# A refused request's body is read and discarded (never kept) up to this many
# bytes before the refusal goes out; see ``refuse``.
REFUSED_BODY_DRAIN_CAP = 64 * 1024

CallNext = Callable[[Request], Awaitable[Response]]


def origin_ok(conn: HTTPConnection) -> bool:
    """The CSRF check shared by the HTTP guard and the WS upgrade.

    No Origin header passes (same-origin navigations, curl, the desktop
    shells -- ``host_allowed`` covers those). A present Origin must be this
    server's own origin for the request's scheme + Host port (BUG-030), the
    Tauri shell, or -- under ``qz --dev`` only -- the Vite dev origin."""
    origin = conn.headers.get("origin")
    if not origin:
        return True
    return origin_allowed(
        origin,
        host_header=conn.headers.get("host"),
        scheme=conn.url.scheme,
        extra_origins=getattr(conn.app.state, "dev_origins", frozenset()),
    )


def _cookie_name(conn: HTTPConnection) -> str:
    return cookie_name(host_port(conn.headers.get("host"), conn.url.scheme))


def authorized(conn: HTTPConnection) -> bool:
    """The token arrived in the ``X-Quantized-Token`` header or this port's
    cookie (constant-time compares)."""
    expected: str = conn.app.state.api_token
    return tokens_equal(conn.headers.get(TOKEN_HEADER), expected) or tokens_equal(
        conn.cookies.get(_cookie_name(conn)), expected
    )


async def refuse(request: Request, detail: str, status: int = 403) -> JSONResponse:
    """The guard's refusal, sent only once the request body has been drained.

    Answering from the headers alone left the body unread (or still in
    flight) when uvicorn closed the connection -- which it does straight after
    the response when the client sent ``Connection: close``, as urllib does.
    The kernel answers such a close with a TCP RST instead of a FIN, and on
    Windows an RST discards data the client has received but not yet read, so
    the refusal could surface as ``ConnectionResetError`` [WinError 10054]
    instead of the 403 already sent.

    Bounded: reading stops once more than ``REFUSED_BODY_DRAIN_CAP`` bytes
    have arrived, and nothing is read for ``Expect: 100-continue`` (reading
    would make the server invite the very body being refused). When the body
    was not fully read, the refusal carries ``Connection: close`` so the
    server closes rather than keep reading it -- an attacker's body is never
    read without limit. (A client that stalls mid-body stalls this wait
    exactly as it would stall any route that reads a body; uvicorn times
    neither out.)"""
    drained = await _drain_body(request)
    headers = None if drained else {"Connection": "close"}
    return JSONResponse({"detail": detail}, status_code=status, headers=headers)


async def _drain_body(request: Request) -> bool:
    """Read and discard the body up to the cap; True only if all of it was read."""
    if request.headers.get("expect", "").lower() == "100-continue":
        return False
    seen = 0
    try:
        async with aclosing(request.stream()) as chunks:
            async for chunk in chunks:
                seen += len(chunk)
                if seen > REFUSED_BODY_DRAIN_CAP:
                    return False
    except ClientDisconnect:
        return False
    return True


def _bootstrap(request: Request, target: str) -> Response:
    """Set the cookie, then send the page on to ``target`` (the request's
    query minus ``token``).

    A meta refresh, not a 303: when the launch URL is opened FROM another
    site (the Tauri splash on tauri.localhost, a link on some other page),
    Chromium withholds a SameSite=Strict cookie from every request in that
    redirect chain, so a 303 lands on the locked page (measured). The
    refresh is a fresh navigation started by this origin's own page, so the
    cookie goes with it. No script involved, so the CSP is untouched."""
    query = strip_token_query(request.url.query)
    location = html.escape(f"{target}?{query}" if query else target, quote=True)
    cookie = set_cookie_value(_cookie_name(request), request.app.state.api_token)
    page = (
        "<!doctype html><html lang=en><meta charset=utf-8><title>Quantized</title>"
        f'<meta http-equiv="refresh" content="0; url={location}"></html>'
    )
    return HTMLResponse(page, headers={"Set-Cookie": cookie, **_NO_STORE})


def _locked() -> HTMLResponse:
    return HTMLResponse(_LOCKED_PAGE, status_code=401, headers=_NO_STORE)


def _launch_token_ok(request: Request) -> bool:
    return tokens_equal(request.query_params.get(TOKEN_QUERY), request.app.state.api_token)


async def _index(request: Request, call_next: CallNext) -> Response:
    """The SPA index: bootstrap the cookie from a launch URL, else need it."""
    if TOKEN_QUERY in request.query_params:
        return _bootstrap(request, request.url.path) if _launch_token_ok(request) else _locked()
    if not authorized(request):
        return _locked()
    return await call_next(request)


async def _api(request: Request, call_next: CallNext) -> Response:
    if not origin_ok(request):
        return await refuse(request, "cross-origin API request blocked")
    path = request.url.path
    if path == DEV_BOOTSTRAP_PATH and request.app.state.dev_origins:
        if _launch_token_ok(request):
            return _bootstrap(request, "/")
        return await refuse(request, _UNAUTHORIZED, 401)
    preflight = request.method == "OPTIONS" and "access-control-request-method" in request.headers
    if path not in _PUBLIC_API and not preflight and not authorized(request):
        return await refuse(request, _UNAUTHORIZED, 401)
    return await call_next(request)


async def security_guard(request: Request, call_next: CallNext) -> Response:
    """Host check (all paths, defeats DNS rebinding), then the /api or index
    rules above. CORSMiddleware alone is NOT this: it never inspects Host and
    doesn't block simple cross-site POSTs."""
    if not host_allowed(request.headers.get("host")):
        return await refuse(request, "unrecognized Host header")
    path = request.url.path
    if path.startswith("/api"):
        return await _api(request, call_next)
    response = await (_index(request, call_next) if path in _INDEX_PATHS else call_next(request))
    response.headers["Content-Security-Policy"] = CSP
    return response
