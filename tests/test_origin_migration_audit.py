"""Behavioral tests for the local Origin migration corpus auditor."""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest

from quantized.io.origin_project import OriginProjectError

ROOT = Path(__file__).resolve().parents[1]
AUDIT_SCRIPT = ROOT / "tools" / "origin_migration_audit.py"


def _load_audit_script() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location("origin_migration_audit", AUDIT_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_audit_records_an_unreadable_probe_instead_of_aborting(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    origin_migration_audit = _load_audit_script()
    project = tmp_path / "graph-only-probe.opju"
    project.write_bytes(b"probe")

    def reject(_path: Path) -> None:
        raise OriginProjectError("no worksheet columns")

    monkeypatch.setattr(origin_migration_audit, "_import_with_books", reject)

    result = origin_migration_audit.audit_project(project)

    assert result["status"] == "unreadable"
    assert result["graph_records_total"] == 0
    assert result["issues"] == ["import failed: no worksheet columns"]


@pytest.mark.parametrize(("lazy", "expects_issue"), [(False, False), (True, True)])
def test_only_lazy_workbooks_require_a_reloadable_source(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    lazy: bool,
    expects_issue: bool,
) -> None:
    origin_migration_audit = _load_audit_script()
    project = tmp_path / "project.opju"
    project.write_bytes(b"project")
    payload = {
        "books": [{"lazy": lazy}],
        "figures": [],
        "origin_fidelity": {
            "status": "exact",
            "graph_records_total": 0,
            "graph_records_actionable": 0,
            "graph_records_filtered": 0,
            "filtered_figures": [],
        },
    }
    monkeypatch.setattr(origin_migration_audit, "_import_with_books", lambda _path: (payload, None))

    result = origin_migration_audit.audit_project(project)

    assert ("lazy workbook inventory has no reloadable source" in result["issues"]) is expects_issue
