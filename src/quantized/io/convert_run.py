"""One conversion run, shared by ``qz convert`` and the quick-convert GUI.

:func:`convert_one` is the per-file dispatch the CLI used to inline: a data
file goes through :func:`~quantized.io.convert_data.convert_data_file`, an
Origin project through :func:`~quantized.io.origin_convert.convert_origin_project`;
either way the result is one report entry (never an exception for a bad file).
:func:`build_report` is the run's JSON report body, and
:func:`free_report_path` names a report that never collides with an earlier
one -- the GUI's answer to ``convert-report.json`` already existing (the CLI
stays fail-closed and refuses). Pure ``io``.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

from quantized.io.convert_data import classify_outcome, convert_data_file
from quantized.io.convert_defaults import PROVISIONAL
from quantized.io.origin_convert import ORIGIN_SUFFIXES, convert_origin_project

__all__ = ["REPORT_NAME", "build_report", "convert_one", "failed_entry", "free_report_path"]

REPORT_NAME = "convert-report.json"


def failed_entry(source: str, error: str) -> dict[str, Any]:
    """A report entry for an input that could not even be tried."""
    return {
        "source": source,
        "status": "failed",
        "error": error,
        "outputs": [],
        "omissions": [],
        "notes": [],
        "books": [],
    }


def convert_one(  # noqa: PLR0913 - one call site per surface
    path: Path,
    prefix: str,
    out_dir: Path,
    fmt: str,
    *,
    metadata: bool = True,
    allow_partial: bool = False,
    overwrite: bool = False,
    protected: Sequence[Path | str] = (),
    imported_at: str = "",
) -> dict[str, Any]:
    """Convert ``path`` into ``out_dir``; return its classified report entry."""
    if not path.is_file():
        return classify_outcome(failed_entry(str(path), "file not found"))
    if path.suffix.lower() not in ORIGIN_SUFFIXES:
        entry = convert_data_file(
            path, out_dir, fmt, metadata=metadata, prefix=prefix,
            overwrite=overwrite, protected=protected,
        )  # fmt: skip
        return classify_outcome(entry)
    origin_fmt = "xlsx" if fmt == "auto" else fmt
    entry = convert_origin_project(
        path, out_dir, origin_fmt, prefix=prefix, allow_partial=allow_partial,
        imported_at=imported_at, overwrite=overwrite, protected=protected,
    )  # fmt: skip
    entry["format"] = origin_fmt
    if fmt == "auto":
        entry["format_source"] = f"auto ({PROVISIONAL})"
    return classify_outcome(entry)


def build_report(entries: list[dict[str, Any]], fmt: str, out: str | None) -> dict[str, Any]:
    """The run's JSON report: counts per status and outcome, then every entry."""
    return {
        "version": 1,
        "format": fmt,
        "out": out,
        "summary": {s: sum(e["status"] == s for e in entries) for s in ("ok", "partial", "failed")},
        "outcomes": {
            o: sum(e["outcome"] == o for e in entries)
            for o in ("done", "partial", "skipped-exists", "failed")
        },
        "files": entries,
    }


def free_report_path(directory: Path, now: datetime) -> Path:
    """``convert-report-YYYYmmdd-HHMMSS.json`` in ``directory``, with ``~2``,
    ``~3`` ... if that exists too -- never an existing file."""
    base = f"convert-report-{now:%Y%m%d-%H%M%S}"
    path, k = directory / f"{base}.json", 2
    while path.exists() or path.is_symlink():
        path, k = directory / f"{base}~{k}.json", k + 1
    return path
