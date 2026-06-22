"""``qz`` — launch the quantized app (API + built SPA) and open the browser.

    qz                  serve http://127.0.0.1:8000 and open a browser tab
    qz --port 9000      use a different port
    qz --no-browser     don't open a browser (headless / CI)

The UI is served from the Vite build output (``src/quantized/web``). On a bare
dev checkout that directory is absent — build it once with
``cd frontend && npm run build``, or just double-click the ``run`` launcher,
which builds on first use.
"""

from __future__ import annotations

import argparse
import threading
import webbrowser
from pathlib import Path

import uvicorn

_WEB_DIR = Path(__file__).parent / "web"


def main(argv: list[str] | None = None) -> None:
    """Parse args, (optionally) schedule the browser, and run the server."""
    parser = argparse.ArgumentParser(prog="qz", description="Launch the quantized app.")
    parser.add_argument("--host", default="127.0.0.1", help="bind host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="bind port (default 8000)")
    parser.add_argument(
        "--no-browser", action="store_true", help="do not open a browser tab"
    )
    args = parser.parse_args(argv)

    url = f"http://{args.host}:{args.port}"
    if not _WEB_DIR.is_dir():
        print(
            f"[qz] UI not built ({_WEB_DIR} missing). "
            "Run: cd frontend && npm run build  (or use the run launcher)."
        )

    if not args.no_browser:
        # The server needs a moment to bind before the first request succeeds;
        # open the tab shortly after uvicorn starts (a daemon timer, so Ctrl+C
        # still exits cleanly).
        def _open() -> None:
            webbrowser.open(url)

        timer = threading.Timer(1.5, _open)
        timer.daemon = True
        timer.start()

    print(f"[qz] quantized -> {url}   (press Ctrl+C to stop)")
    uvicorn.run("quantized.app:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
