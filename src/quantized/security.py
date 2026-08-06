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
"""

from __future__ import annotations

from urllib.parse import urlparse

# Hostnames (port ignored) this server answers to — the DNS-rebinding guard.
# Production has NO "testserver"; tests/conftest.py extends this set once for
# the suite (FastAPI's TestClient sends ``Host: testserver``).
ALLOWED_HOSTS: set[str] = {"127.0.0.1", "localhost", "::1"}


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


def origin_allowed(origin: str) -> bool:
    """True for this app's own origins (served SPA, Vite dev server,
    pywebview, Tauri)."""
    # exact Tauri origins only — ``endswith`` would also pass a crafted
    # ``evil.tauri.localhost`` from another local app
    if origin.startswith("tauri://") or origin in {
        "https://tauri.localhost",
        "http://tauri.localhost",
    }:
        return True
    try:
        host = urlparse(origin).hostname
    except ValueError:
        return False
    return host in {"127.0.0.1", "localhost", "::1"}
