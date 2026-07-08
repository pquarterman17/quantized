"""``qz`` — launch the quantized app (API + built SPA) and open the browser.

    qz                  serve http://127.0.0.1:8000 and open a browser tab
    qz --port 9000      use a different port
    qz --no-browser     don't open a browser (headless / CI)
    qz plugin list      list discovered plugins and what they contribute
    qz plugin enable <name>    re-enable a previously disabled plugin
    qz plugin disable <name>   disable a plugin without deleting it

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
    """``qz plugin ...`` — inspect and manage installed/drop-in plugins.

    Subcommands: ``list`` (default — also runs when no subcommand is given),
    ``enable <name>``, ``disable <name>``. ``<name>`` is the source
    identifier shown in the first column of ``qz plugin list`` (the drop-in
    module's file stem, or the entry-point name for a packaged plugin).
    Enable/disable persist the ``disabled`` list in
    ``<config_dir>/plugins.json`` (see :mod:`quantized.plugins.loader`); a
    disabled plugin is never imported, so it can be parked without deleting
    it.
    """
    parser = argparse.ArgumentParser(prog="qz plugin", description="Inspect quantized plugins.")
    sub = parser.add_subparsers(dest="action")
    sub.add_parser("list", help="list discovered plugins and what they contribute")
    enable_parser = sub.add_parser("enable", help="re-enable a disabled plugin")
    enable_parser.add_argument("name", help="plugin source identifier (see 'qz plugin list')")
    disable_parser = sub.add_parser("disable", help="disable a plugin without deleting it")
    disable_parser.add_argument("name", help="plugin source identifier (see 'qz plugin list')")
    args = parser.parse_args(argv)

    if args.action == "enable":
        _plugin_set_enabled(args.name, enabled=True)
    elif args.action == "disable":
        _plugin_set_enabled(args.name, enabled=False)
    else:
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


def _plugin_set_enabled(name: str, *, enabled: bool) -> None:
    """``qz plugin enable|disable <name>``: flip ``name``'s disabled state.

    ``name`` is validated against the currently discoverable plugins (a
    disabled plugin still shows up here — only a nonexistent source is
    rejected) so a typo fails loudly with the known names, instead of
    silently writing a dead entry to ``plugins.json``. Reloads afterwards so
    the change (and a following ``qz plugin list``) reflects it immediately.
    """
    from quantized.plugins import disable_plugin, enable_plugin, load_plugins

    known = {info.source for info in load_plugins()}
    if name not in known:
        print(f"[qz] unknown plugin {name!r}.")
        if known:
            print(f"  known plugins: {', '.join(sorted(known))}")
        else:
            print("  no plugins discovered. Run 'qz plugin list' for details.")
        sys.exit(1)

    if enabled:
        enable_plugin(name)
    else:
        disable_plugin(name)
    load_plugins()
    print(f"[qz] plugin {name!r} {'enabled' if enabled else 'disabled'}.")


if __name__ == "__main__":
    main()
