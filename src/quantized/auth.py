"""The local API token: generation, launch URLs, cookie and comparison.

Pure stdlib (like ``quantized.security``) so the launchers can import it
without pulling in FastAPI. ``app.py``'s ``_security_guard`` enforces it; the
user-facing description lives in ``docs/api_auth.md``.

Why a token at all: the Host and Origin checks stop *browsers* on other sites,
but any local process -- or another user on a shared machine, since loopback
is shared -- could call ``/api/*`` directly and, say, import files from the
server user's home. Every ``/api`` route (except ``/api/health``) and
``/api/ws`` now need this per-launch secret.

How it reaches each caller:

- **The SPA** gets it as an ``HttpOnly; SameSite=Strict; Path=/`` cookie. The
  index sets that cookie only for a request that already presents the token
  in its launch URL (``/?token=...``), then redirects to strip it. An index
  that handed the cookie to any GET would hand it to any local process, which
  is the exact caller the token exists to stop. The launchers (``qz``,
  ``qz --desktop``, ``qz --dev``, the Tauri shell) open that launch URL.
- **Programmatic callers** send it in the ``X-Quantized-Token`` header. They
  learn it from ``QZ_API_TOKEN``: when that is set before launch the server
  uses it instead of generating one (``docs/api_auth.md``).

The cookie name carries the port (``qz_token_8000``): cookies are scoped by
host, not port, so two servers on one host (8000 plus an ephemeral fallback)
would otherwise overwrite each other's cookie in the same browser.
"""

from __future__ import annotations

import hmac
import os
import re
import secrets
from collections.abc import Mapping, MutableMapping
from urllib.parse import unquote_plus

__all__ = [
    "COOKIE_PREFIX",
    "DEV_BOOTSTRAP_PATH",
    "TOKEN_ENV",
    "TOKEN_HEADER",
    "TOKEN_QUERY",
    "cookie_name",
    "ensure_launch_token",
    "launch_url",
    "new_token",
    "resolve_token",
    "set_cookie_value",
    "strip_token_query",
    "tokens_equal",
]

TOKEN_ENV = "QZ_API_TOKEN"
# ``qz --dev`` only: the Vite server serves the index, so the browser trades
# the launch token for the cookie here instead (proxied to the API, so the
# cookie lands on the Vite origin), then is redirected to ``/``.
DEV_BOOTSTRAP_PATH = "/api/auth/bootstrap"
TOKEN_HEADER = "x-quantized-token"
TOKEN_QUERY = "token"
COOKIE_PREFIX = "qz_token_"

# A user-supplied QZ_API_TOKEN must be URL- and cookie-safe as-is (it goes
# into a query string and a Set-Cookie value unescaped) and long enough not
# to be guessable: 32+ characters of the unreserved URL alphabet.
_TOKEN_RE = re.compile(r"[A-Za-z0-9._~-]{32,}")


def new_token() -> str:
    """A fresh random token (256 bits, URL-safe)."""
    return secrets.token_urlsafe(32)


def resolve_token(environ: Mapping[str, str] | None = None) -> str:
    """``QZ_API_TOKEN`` when set (validated), else a fresh random token."""
    env = os.environ if environ is None else environ
    value = env.get(TOKEN_ENV, "").strip()
    if not value:
        return new_token()
    if not _TOKEN_RE.fullmatch(value):
        raise ValueError(
            f"{TOKEN_ENV} must be at least 32 characters of A-Z a-z 0-9 . _ ~ - "
            '(e.g. python -c "import secrets; print(secrets.token_urlsafe(32))")'
        )
    return value


def ensure_launch_token(environ: MutableMapping[str, str] | None = None) -> str:
    """Resolve the token once per launch and export it as ``QZ_API_TOKEN``.

    The launcher calls this before uvicorn imports ``quantized.app``: the app
    reads the same variable, and ``qz --dev``'s reloader subprocess inherits
    it, so every reload keeps the token the browser's cookie holds."""
    env = os.environ if environ is None else environ
    token = resolve_token(env)
    env[TOKEN_ENV] = token
    return token


def tokens_equal(presented: str | None, expected: str) -> bool:
    """Constant-time comparison; a missing token never matches."""
    if not presented:
        return False
    return hmac.compare_digest(presented.encode(), expected.encode())


def cookie_name(port: int | None) -> str:
    """The per-port cookie name (see the module doc for why it is per port)."""
    return f"{COOKIE_PREFIX}{port if port is not None else 0}"


def set_cookie_value(name: str, token: str) -> str:
    """A ``Set-Cookie`` value: session-only, HttpOnly, SameSite=Strict, Path=/."""
    return f"{name}={token}; HttpOnly; SameSite=Strict; Path=/"


def strip_token_query(query: str) -> str:
    """The query string with every ``token`` parameter removed, the rest kept
    byte-for-byte (``?harness`` must stay ``?harness``, not ``?harness=``)."""
    kept = [p for p in query.split("&") if p and unquote_plus(p.split("=", 1)[0]) != TOKEN_QUERY]
    return "&".join(kept)


def launch_url(base: str, token: str, path: str = "") -> str:
    """``base`` + ``path`` (``""`` or ``/?view=calc``) carrying the token."""
    target = f"{base.rstrip('/')}{path or '/'}"
    sep = "&" if "?" in target else "?"
    return f"{target}{sep}{TOKEN_QUERY}={token}"
