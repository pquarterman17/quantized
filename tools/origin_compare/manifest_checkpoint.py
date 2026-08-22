"""Manifest checkpoint persistence for the Origin COM export oracle.

Extracted from ``export_origin_graphs.py`` (tools/ size ratchet). Same
contract: a ``manifest.json`` beside the exported PNGs records per-graph
status so an interrupted run resumes instead of restarting.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_manifest(path: Path, project: Path) -> dict[str, Any]:
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        recorded = data.get("project")
        # Identity is the project FILE NAME, not the absolute path -- the
        # output dir is already keyed by project stem (_exports/<stem>/), so
        # a manifest sitting there with a matching name IS this project's
        # checkpoint. Absolute-path identity breaks on every corpus/repo
        # relocation (e.g. the 2026-07-25 test-data move off OneDrive), which
        # would otherwise silently discard every checkpoint and re-export
        # everything from scratch.
        if recorded is not None and Path(recorded).name == project.name:
            if recorded != str(project):
                print(
                    f"[manifest] project path changed ({recorded} -> "
                    f"{project}) -- resuming",
                    flush=True,
                )
                data["project"] = str(project)  # self-heal the recorded path
            data.setdefault("graphs", {})
            return data
        print(
            f"[manifest] existing manifest is for a different project "
            f"({data.get('project')!r}) -- starting fresh",
            flush=True,
        )
    return {"project": str(project), "graphs": {}}


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=1, default=str), encoding="utf-8")
    tmp.replace(path)  # same-volume rename is atomic on Windows
