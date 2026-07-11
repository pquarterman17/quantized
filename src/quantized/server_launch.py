"""Desktop (``--desktop``, pywebview) and dev (``--dev``, Vite HMR) launch paths.

Adapted from fermiviewer ``server_launch.py`` + ``netprobe.py`` (shared
platform code — keep in sync). Split out of ``cli.py`` to respect the
500-line god-module ceiling; ``main()``/arg parsing stay in cli.py and only
its ``--dev`` / ``--desktop`` branches (plus the health-polled browser open
on the default path) reach into this module.

The probe helpers (``_health_ok``/``_bind``) are pure stdlib so importing
this module stays cheap — uvicorn/pywebview are imported inside the launch
functions that need them.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import socket as _socket

__all__ = ["_open_when_healthy", "_run_desktop", "_run_dev"]

# Built SPA — same resolution as quantized.app._WEB_DIR / cli._WEB_DIR.
_WEB_DIR = Path(__file__).parent / "web"


def _frontend_dir() -> Path:
    """The repo-checkout ``frontend/`` (``--dev`` needs sources, not a build)."""
    return Path(__file__).resolve().parents[2] / "frontend"


def _health_ok(host: str, port: int, timeout: float = 0.4) -> bool:
    """True iff a *quantized* server answers /api/health with ``status: ok`` —
    tells our own instance apart from a foreign app on the port, and gates
    the browser/window open on the server actually being up."""
    import json
    import urllib.request

    try:
        with urllib.request.urlopen(
            f"http://{host}:{port}/api/health", timeout=timeout
        ) as r:
            if r.status != 200:
                return False
            data = json.loads(r.read())
            return bool(isinstance(data, dict) and data.get("status") == "ok")
    except Exception:
        return False


def _bind(host: str, port: int) -> _socket.socket | None:
    """Bind + listen on host:port, returning the live socket, or None if the
    port is taken. Binding up front turns a busy port into a value we can
    branch on (reuse a healthy sibling, refuse a foreign app) instead of an
    'address already in use' traceback; the socket is handed to
    ``Server.run(sockets=[...])``, closing the check->bind race."""
    import os
    import socket

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        # SO_REUSEADDR everywhere EXCEPT Windows, where it acts like
        # SO_REUSEPORT and would let us bind a port a foreign server owns.
        if os.name != "nt":
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((host, port))
        s.listen()
        return s
    except OSError:
        s.close()
        return None


def _open_browser_later(url: str, delay: float = 2.0) -> None:
    """Fixed-delay browser open — used only for the dev path, where the
    target is the Vite server (no /api/health to poll)."""
    import webbrowser

    timer = threading.Timer(delay, webbrowser.open, [url])
    timer.daemon = True  # don't keep the process alive on Ctrl+C in --dev
    timer.start()


def _open_when_healthy(url: str, host: str, port: int, timeout: float = 30.0) -> None:
    """Open the browser only once the server answers — a fixed delay races a
    cold numpy/scipy/matplotlib import and shows 'can't reach this page'.
    Polls /api/health in a daemon thread; opens anyway after the timeout."""
    import webbrowser

    def _wait_then_open() -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if _health_ok(host, port):
                webbrowser.open(url)
                return
            time.sleep(0.25)
        webbrowser.open(url)  # last resort: open anyway after the timeout

    threading.Thread(target=_wait_then_open, daemon=True).start()


_WEBVIEW_HINT = (
    "--desktop needs pywebview: pip install quantized[desktop]\n"
    "On Linux it also needs a native GUI backend (PyGObject + WebKitGTK, "
    "e.g. `sudo apt install python3-gi gir1.2-webkit2-4.1`, or PyQt5/PySide2)."
)


def _run_desktop(host: str, port: int) -> None:
    """Native window: uvicorn in a thread, pywebview on top — pure Python, no
    Rust toolchain (the Tauri shell in src-tauri/ is the packaged path).
    Closing the window stops the server."""
    if not _WEB_DIR.is_dir():
        print(
            f"[qz] UI not built ({_WEB_DIR} missing). "
            "Run: cd frontend && npm run build  (or use the run launcher)."
        )
        return

    try:
        import webview
    except ImportError as e:
        print(f"[qz] {_WEBVIEW_HINT}\n(import error: {e})")
        return

    import uvicorn

    from quantized.app import app

    # Bind up front so a taken port is a clean branch, not a crashed server
    # thread: reuse our own healthy instance (point the window at it), or
    # refuse a foreign app instead of hanging 30 s on a dead window.
    sock = _bind(host, port)
    server: uvicorn.Server | None = None
    t: threading.Thread | None = None
    if sock is None:
        if not _health_ok(host, port):
            print(f"[qz] port {port} is in use by another app - close it and retry")
            return
    else:
        server = uvicorn.Server(
            uvicorn.Config(app, host=host, port=port, log_level="warning")
        )
        s = sock  # bound socket handed to uvicorn — closes the bind race
        t = threading.Thread(target=lambda: server.run(sockets=[s]), daemon=True)
        t.start()

    # Wait for the server to answer before pointing the window at it, else
    # the webview shows a connection-refused page and never retries.
    deadline = time.monotonic() + 30.0
    while time.monotonic() < deadline and not _health_ok(host, port):
        time.sleep(0.25)

    try:
        webview.create_window(
            "Quantized",
            f"http://{host}:{port}",
            width=1440,
            height=920,
            background_color="#121116",  # dark --surface-0 (oklch 0.16 0.008 280)
        )
        webview.start()
    except Exception as e:
        print(f"[qz] {_WEBVIEW_HINT}\n(error: {e})")
    finally:
        if server is not None:
            server.should_exit = True
        if t is not None:
            t.join(timeout=5)


def _run_dev(host: str, port: int) -> None:
    """Vite dev server (HMR) + auto-reloading uvicorn in one terminal."""
    import os
    import subprocess

    import uvicorn

    frontend = _frontend_dir()
    if not frontend.is_dir():
        print(f"[qz] --dev requires a source checkout; frontend/ not found at {frontend}")
        raise SystemExit(2)
    npm = "npm.cmd" if os.name == "nt" else "npm"
    # Tell the Vite proxy which backend port to target (vite.config.ts reads
    # QZ_BACKEND_PORT; review 2026-07-11: it was hardcoded to 8000, so
    # `qz --dev --port 9000` silently proxied /api to the WRONG server).
    env = dict(os.environ, QZ_BACKEND_PORT=str(port))
    vite = subprocess.Popen([npm, "run", "dev"], cwd=frontend, env=env)
    _open_browser_later("http://localhost:5173")
    try:
        uvicorn.run("quantized.app:app", host=host, port=port, reload=True)
    finally:
        # Windows: terminate() only kills the npm.cmd wrapper and orphans the
        # node/Vite child holding :5173 (review 2026-07-11) - kill the tree.
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(vite.pid)],
                capture_output=True,
                check=False,
            )
        else:
            vite.terminate()
        try:
            vite.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass  # never mask the real exit path from inside finally
