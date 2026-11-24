"""The quick-convert window's engine: preview, run, browse (pure ``io``).

Everything the GUI route (``routes/convert_quick.py``) does is here, so the
route stays a validate -> call -> serialize adapter:

* :func:`run_conversion` -- convert several inputs, one report entry each
  (:func:`~quantized.io.convert_run.convert_one`), progress per file, then
  write the run report under a **timestamped name**
  (:func:`~quantized.io.convert_run.free_report_path`) so a second run never
  trips over ``convert-report.json`` from the first (the CLI keeps its
  fail-closed refusal). A report that cannot be written is the result's
  ``report_error``, never a failed conversion.
* :func:`list_directory` -- one folder level for the in-page file/folder
  chooser (a browser cannot hand a web page a real path).
* :func:`out_dir_status` -- what the chosen output folder is, for the preview.
* :func:`prefill_from_env` -- the files ``qz convert --gui`` was started with.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from quantized.io.convert_plan import unique_prefixes
from quantized.io.convert_run import build_report, convert_one, free_report_path
from quantized.io.write_guard import atomic_write

__all__ = [
    "BROWSE_LIMIT",
    "PREFILL_ENV",
    "existing_outputs",
    "list_directory",
    "out_dir_status",
    "prefill_from_env",
    "run_conversion",
]

PREFILL_ENV = "QZ_CONVERT_PREFILL"
BROWSE_LIMIT = 2000


def prefill_from_env(environ: dict[str, str] | None = None) -> list[str]:
    """The absolute paths ``qz convert --gui`` put in :data:`PREFILL_ENV`
    (a JSON list); anything malformed is ignored, never raised."""
    raw = (os.environ if environ is None else environ).get(PREFILL_ENV, "")
    try:
        items = json.loads(raw) if raw else []
    except ValueError:
        return []
    return [i for i in items if isinstance(i, str)] if isinstance(items, list) else []


def out_dir_status(out_dir: Path | None) -> str:
    """``same`` (none given: each output next to its input), ``exists``,
    ``will_be_created`` or ``not_a_folder`` (the path is a file)."""
    if out_dir is None:
        return "same"
    if out_dir.is_dir():
        return "exists"
    if out_dir.exists():
        return "not_a_folder"
    return "will_be_created"


def existing_outputs(source: Path, outputs: Sequence[str], out_dir: Path | None) -> list[str]:
    """The planned ``outputs`` that already exist (in ``out_dir``, or next to
    ``source``): what a run without overwrite would refuse to replace."""
    folder = out_dir or source.parent
    return [n for n in outputs if (folder / n).exists() or (folder / n).is_symlink()]


def run_conversion(  # noqa: PLR0913 - the window's options
    paths: Sequence[Path],
    out_dir: Path | None,
    fmt: str,
    *,
    overwrite: bool = False,
    metadata: bool = True,
    allow_partial: bool = False,
    progress: Callable[[float, str], None] = lambda _f, _m: None,
    abort: Callable[[], bool] = lambda: False,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> dict[str, Any]:
    """Convert ``paths``; return ``{report, report_path, report_error,
    cancelled}`` where ``report`` is :func:`build_report`'s body.

    Never raises for a bad input. ``abort()`` is checked between files: the
    files already done keep their outputs and the rest are left out of the
    report (``cancelled`` is then true)."""
    stamp = now()
    imported_at = stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    entries: list[dict[str, Any]] = []
    cancelled = False
    prefixes = unique_prefixes(list(paths))
    for k, (path, prefix) in enumerate(zip(paths, prefixes, strict=True)):
        if abort():
            cancelled = True
            break
        progress(k / len(paths), f"converting {path.name} ({k + 1}/{len(paths)})")
        entries.append(
            convert_one(
                path,
                prefix,
                out_dir or path.parent,
                fmt,
                metadata=metadata,
                allow_partial=allow_partial,
                overwrite=overwrite,
                protected=list(paths),
                imported_at=imported_at,
            )  # fmt: skip
        )
    report = build_report(entries, fmt, str(out_dir) if out_dir else None)
    report_path: str | None = None
    report_error: str | None = None
    if entries:
        target = free_report_path(out_dir or paths[0].parent, stamp)
        try:
            body = json.dumps(report, indent=1, ensure_ascii=False).encode("utf-8")
            atomic_write(target, lambda tmp: tmp.write_bytes(body), protected=list(paths))
            report_path = str(target)
        except (OSError, ValueError) as exc:
            report_error = f"report not saved: {exc}"
    progress(1.0, "done")
    return {
        "report": report,
        "report_path": report_path,
        "report_error": report_error,
        "cancelled": cancelled,
    }


def list_directory(path: Path) -> dict[str, Any]:
    """One level of ``path`` for the chooser: sub-folders first, then files
    (dot-files hidden), each name-sorted, at most :data:`BROWSE_LIMIT`.

    Raises :class:`OSError` (``NotADirectoryError``, ``PermissionError``...)
    when ``path`` cannot be listed."""
    folders: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    with os.scandir(path) as it:
        for e in it:
            if e.name.startswith("."):
                continue
            try:
                is_dir = e.is_dir()
                size = 0 if is_dir else e.stat().st_size
            except OSError:  # a broken link or a vanished entry: leave it out
                continue
            (folders if is_dir else files).append(
                {"name": e.name, "path": e.path, "is_dir": is_dir, "size": size}
            )
    key: Callable[[dict[str, Any]], str] = lambda d: str(d["name"]).lower()  # noqa: E731
    entries = (sorted(folders, key=key) + sorted(files, key=key))[:BROWSE_LIMIT]
    parent = str(path.parent) if path.parent != path else None
    return {"path": str(path), "parent": parent, "entries": entries}
