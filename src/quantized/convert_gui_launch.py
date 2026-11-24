"""``qz convert --gui [files...]``: the quick-convert window, without the app.

Starts the API headless (no workspace, no plots, nothing but the converter)
and opens ``/convert`` in the browser -- or in a small pywebview window with
``--desktop`` -- prefilled with the files given. This is what the right-click
entry (``convert_context_menu``) runs.

How the files reach the page: they are put, absolute, in the
``QZ_CONVERT_PREFILL`` environment variable (a JSON list) before the server
starts, and ``GET /api/convert/config`` returns them. A file outside the
allowed data folders (another drive, a network share) is a file the user named
on the command line, so its folder is added to ``QZ_DATA_ROOTS`` for this run
only -- the API stays confined to the user's own choices.

Like ``qz`` itself the server exits when its last tab closes
(``QZ_AUTO_SHUTDOWN``); it never touches the full app's other windows.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from quantized.auth import ensure_launch_token, launch_url
from quantized.data_roots import is_inside_data_roots
from quantized.io.convert_session import PREFILL_ENV
from quantized.server_launch import _open_when_healthy, _resolve_port, _run_desktop

__all__ = ["CONVERT_PATH", "gui_command", "prepare_prefill"]

CONVERT_PATH = "/convert"
_WINDOW = {"title": "Quick Convert", "width": 820, "height": 700}


def prepare_prefill(files: list[Path], environ: dict[str, str] | None = None) -> list[str]:
    """Put ``files`` (absolute) in :data:`PREFILL_ENV`; widen ``QZ_DATA_ROOTS``
    with the folder of any file outside the allowed folders. Returns the list."""
    env = os.environ if environ is None else environ
    absolute = [str(Path(os.path.abspath(f))) for f in files]
    env[PREFILL_ENV] = json.dumps(absolute)
    outside = [p for p in absolute if not is_inside_data_roots(p)]
    widen: set[str] = set()
    for p in outside:
        parent = Path(p).parent
        if parent == parent.parent:  # a drive / filesystem root: never widen to it
            print(f"[qz] convert --gui: {p} is at a drive root; not widened", file=sys.stderr)
        else:
            widen.add(str(parent))
    extra = sorted(widen)
    if extra:
        have = [r for r in env.get("QZ_DATA_ROOTS", "").split(os.pathsep) if r.strip()]
        env["QZ_DATA_ROOTS"] = os.pathsep.join([*have, *(e for e in extra if e not in have)])
    return absolute


def gui_command(
    inputs: list[str], *, desktop: bool = False, host: str = "127.0.0.1", port: int | None = None
) -> int:
    """Run the launcher; returns the process exit status (0 normal, 2 usage)."""
    from quantized.cli_convert import expand_inputs  # noqa: PLC0415 - cli_convert imports us

    files, unmatched = expand_inputs(inputs)
    for pattern in unmatched:
        print(f"[qz] convert --gui: no file matches {pattern!r} (left out)", file=sys.stderr)
    existing = [f for f in files if f.is_file()]
    for f in files:
        if f not in existing:
            print(f"[qz] convert --gui: {f} is not a file (left out)", file=sys.stderr)
    prepare_prefill(existing)
    token = ensure_launch_token()
    resolved = _resolve_port(host, port if port is not None else 8000, explicit=port is not None)
    if desktop:
        _run_desktop(host, resolved, path=CONVERT_PATH, **_WINDOW)  # type: ignore[arg-type]
        return 0
    os.environ.setdefault("QZ_AUTO_SHUTDOWN", "1")  # before quantized.app reads it
    url = launch_url(f"http://{host}:{resolved}", token, CONVERT_PATH)
    _open_when_healthy(url, host, resolved)
    print(f"[qz] quick convert -> {url}   (closing the tab stops it)")
    import uvicorn  # noqa: PLC0415

    uvicorn.run("quantized.app:app", host=host, port=resolved, log_level="warning")
    return 0
