"""Host-header (DNS-rebinding) + Origin (CSRF) checks for the local API.

Adapted from fermiviewer ``server.py``'s ``_host_allowed`` /
``_origin_allowed`` (shared platform code — keep in sync). The middleware
that applies them lives in ``app.py``; this module stays pure stdlib so the
checks are unit-testable without a server.

Why both checks exist (2026-08-05 cross-repo inventory — quantized relied on
``CORSMiddleware`` alone, which never inspects ``Host`` and does not block
non-preflighted simple requests):

- ``host_allowed`` defeats DNS rebinding: a browser tricked into resolving
  evil.example to 127.0.0.1 sends NO Origin header (same-origin, from its
  view) but still ``Host: evil.example``.
- ``origin_allowed`` is the CSRF guard for requests that DO carry an Origin
  header (cross-origin fetches from other sites). Same-origin navigations,
  curl, and the desktop shells send none and rely on ``host_allowed``.

BUG-030 (2026-09-25, plans/BUGS_AND_ISSUES.md): ``origin_allowed`` used to
accept ANY loopback origin on ANY port, so a page served by some other local
dev server or local app could drive the write routes. It now accepts only
this server's own origin (see ``origin_allowed``), the exact Tauri shell
origins, and -- under ``qz --dev`` only -- the Vite dev server's origin.
"""

from __future__ import annotations

import os
from collections.abc import Collection, Mapping
from urllib.parse import urlparse

# Hostnames (port ignored) this server answers to — the DNS-rebinding guard.
# Production has NO "testserver"; tests/conftest.py extends this set once for
# the suite (FastAPI's TestClient sends ``Host: testserver``).
ALLOWED_HOSTS: set[str] = {"127.0.0.1", "localhost", "::1"}

# The two loopback spellings a browser uses for the SAME IPv4 listening
# socket (qz binds 127.0.0.1; users type either). ``::1`` is deliberately NOT
# an alias: ``[::1]:port`` can be a different process than 127.0.0.1:port, so
# an ``[::1]`` origin passes only when the Host names ``[::1]`` too.
_LOOPBACK_ALIASES = frozenset({"localhost", "127.0.0.1"})
_DEFAULT_PORTS = {"http": 80, "https": 443}
# ASGI reports a WebSocket upgrade's scheme as ws/wss; the page that opened it
# still has an http/https Origin.
_ORIGIN_SCHEME_FOR = {"http": "http", "https": "https", "ws": "http", "wss": "https"}

# Exact Tauri shell origins only -- ``endswith`` would also pass a crafted
# ``evil.tauri.localhost`` from another local app.
_TAURI_ORIGINS = frozenset({"https://tauri.localhost", "http://tauri.localhost"})

# ``qz --dev`` exports the Vite dev-server port here (server_launch._run_dev).
# Unset in every other run mode, so the dev origin is refused there.
DEV_VITE_PORT_ENV = "QZ_DEV_VITE_PORT"


def host_allowed(host_header: str | None) -> bool:
    """Host header (port/IPv6-brackets stripped) names our own hostname."""
    if not host_header:
        return False
    v = host_header.strip()
    if v.startswith("["):
        v = v[1 : v.find("]")] if "]" in v else v
    elif v.count(":") == 1:  # "host:port" — a bare IPv6 literal has 2+
        v = v.split(":", 1)[0]
    return v.lower() in ALLOWED_HOSTS


def _port(value: str) -> int | None:
    """A decimal TCP port 1..65535, else None."""
    if not value.isdigit():
        return None
    n = int(value)
    return n if 0 < n < 65536 else None


def _parse_origin(origin: str) -> tuple[str, str, int] | None:
    """``scheme://host[:port]`` -> (scheme, host, port), default port filled.

    None for anything that is not a bare http(s) origin (``null``, a path,
    userinfo, a malformed port) -- those are never this server's origin."""
    try:
        u = urlparse(origin.strip())
        port = u.port
    except ValueError:
        return None
    scheme = u.scheme.lower()
    if scheme not in _DEFAULT_PORTS or not u.hostname:
        return None
    if u.username is not None or u.path or u.params or u.query or u.fragment:
        return None
    return scheme, u.hostname.lower(), port if port is not None else _DEFAULT_PORTS[scheme]


def _parse_host(host_header: str | None, scheme: str) -> tuple[str, int] | None:
    """``Host`` header -> (host, port), the scheme's default port filled."""
    if not host_header:
        return None
    v = host_header.strip().lower()
    port_s = ""
    if v.startswith("["):  # [v6] or [v6]:port
        end = v.find("]")
        if end < 0:
            return None
        host, rest = v[1:end], v[end + 1 :]
        if rest:
            if not rest.startswith(":"):
                return None
            port_s = rest[1:]
    elif v.count(":") == 1:  # host:port (a bare IPv6 literal has 2+)
        host, port_s = v.split(":", 1)
    else:
        host = v
    if not port_s:
        return host, _DEFAULT_PORTS[scheme]
    port = _port(port_s)
    return None if port is None else (host, port)


def dev_origins(vite_port: int | None) -> frozenset[str]:
    """The Vite dev server's origins (both loopback aliases), or none."""
    if vite_port is None:
        return frozenset()
    return frozenset(f"http://{h}:{vite_port}" for h in sorted(_LOOPBACK_ALIASES))


def dev_origins_from_env(environ: Mapping[str, str] | None = None) -> frozenset[str]:
    """Dev origins iff ``qz --dev`` exported a valid Vite port, else empty.

    Read from the environment, not a CLI arg, because ``--dev`` runs uvicorn
    with ``reload=True``: the app is built in a reloader subprocess that
    inherits only the environment."""
    env = os.environ if environ is None else environ
    return dev_origins(_port(env.get(DEV_VITE_PORT_ENV, "").strip()))


def origin_allowed(
    origin: str,
    *,
    host_header: str | None,
    scheme: str,
    extra_origins: Collection[str] = (),
) -> bool:
    """True only for this server's OWN origin, the Tauri shell, and
    ``extra_origins`` (the Vite dev origin under ``qz --dev``).

    "Own origin" is derived from the request: the Origin must carry the
    request's scheme and exactly the port in its ``Host`` header, with
    ``localhost`` and ``127.0.0.1`` interchangeable for that same port. Any
    other local port (another dev server, another local app) is refused.

    Why Host and not a port captured at startup: the Host header is already
    vetted by ``host_allowed`` and a web page cannot set it, so its port is
    the port the browser really connected to. That stays correct under
    ``--port``, the busy-8000 ephemeral fallback, the Tauri shell's
    ephemeral sidecar, uvicorn's ``--reload`` subprocess, and TestClient,
    with no port plumbing that could drift from the real bind."""
    if origin.startswith("tauri://") or origin in _TAURI_ORIGINS:
        return True
    o = _parse_origin(origin)
    if o is None:
        return False
    if any(_parse_origin(e) == o for e in extra_origins):
        return True
    req_scheme = _ORIGIN_SCHEME_FOR.get(scheme.lower())
    if req_scheme is None:
        return False
    h = _parse_host(host_header, req_scheme)
    if h is None:
        return False
    o_scheme, o_host, o_port = o
    h_host, h_port = h
    if o_scheme != req_scheme or o_port != h_port:
        return False
    return o_host == h_host or (o_host in _LOOPBACK_ALIASES and h_host in _LOOPBACK_ALIASES)
