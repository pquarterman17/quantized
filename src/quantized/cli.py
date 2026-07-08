"""``qz`` — launch the quantized app (API + built SPA) and open the browser.

    qz                  serve http://127.0.0.1:8000 and open a browser tab
    qz --port 9000      use a different port
    qz --no-browser     don't open a browser (headless / CI)
    qz plugin list      list discovered plugins and what they contribute

The UI is served from the Vite build output (``src/quantized/web``). On a bare
dev checkout that directory is absent — build it once with
``cd frontend && npm run build``, or just double-click the ``run`` launcher,
which builds on first use.
"""

from __future__ import annotations

import argparse
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

# Same resolution as quantized.app._WEB_DIR (kept as a separate constant here
# rather than importing app.py, so this pre-uvicorn check stays cheap — it
# doesn't need to pull in FastAPI and every router just to print a warning).
_WEB_DIR = Path(__file__).parent / "web"


def main(argv: list[str] | None = None) -> None:
    """Dispatch: ``qz plugin ...`` to the plugin CLI, else launch the server."""
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == "plugin":
        _plugin_command(args[1:])
        return
    _serve(args)


def _serve(argv: list[str]) -> None:
    """Parse serve args, (optionally) schedule the browser, and run the server."""
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


def _plugin_command(argv: list[str]) -> None:
    """``qz plugin ...`` — inspect installed/drop-in plugins.

    Only ``list`` exists in v1 (enable/disable arrive with gap #10; until then
    disable by adding a source name to the ``disabled`` list in
    ``<config_dir>/plugins.json``). No subcommand defaults to ``list``.
    """
    parser = argparse.ArgumentParser(prog="qz plugin", description="Inspect quantized plugins.")
    sub = parser.add_subparsers(dest="action")
    sub.add_parser("list", help="list discovered plugins and what they contribute")
    parser.parse_args(argv)
    _plugin_list()


def _plugin_list() -> None:
    """Print each discovered plugin: identifier, name/version, contributions, status."""
    from quantized.plugins import load_plugins

    infos = load_plugins()
    if not infos:
        print("No plugins discovered.")
        print("  Drop a .py module into the plugins directory, or install a package")
        print("  exposing the 'quantized.plugins' entry point. See docs/plugins.md.")
        return
    for info in infos:
        head = info.source
        if info.name:
            head += f"  ({info.name} v{info.version})"
        print(f"{head}  [{info.status}]")
        if info.parsers:
            print(f"    parsers: {', '.join(info.parsers)}")
        if info.fit_models:
            print(f"    fit models: {', '.join(info.fit_models)}")
        if info.steps:
            print(f"    steps: {', '.join(info.steps)}")
        if info.error:
            print(f"    ! {info.error}")


if __name__ == "__main__":
    main()
