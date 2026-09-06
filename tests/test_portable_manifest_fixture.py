"""Freshness guard: ``tests/fixtures/portable/manifest_v1.json`` must match
what ``tools/freeze_portable_manifest.py`` produces right now.

Loaded by path (not ``import tools.freeze_portable_manifest``) because
``tools/`` has no ``__init__.py`` and isn't installed as a package — same
approach as ``tests/test_openapi_snapshot.py``.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FREEZE_SCRIPT = ROOT / "tools" / "freeze_portable_manifest.py"
COMMITTED = ROOT / "tests" / "fixtures" / "portable" / "manifest_v1.json"

REGEN_HINT = (
    "tests/fixtures/portable/manifest_v1.json is stale relative to "
    "quantized.portable.manifest.build_dry_run_manifest. Run:\n"
    "  uv run python tools/freeze_portable_manifest.py"
)


def _load_freeze_script() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location("freeze_portable_manifest", FREEZE_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_committed_fixture_matches_live_builder() -> None:
    from quantized.portable.manifest import manifest_json

    freeze = _load_freeze_script()
    live_text = manifest_json(freeze.build_fixture_manifest())

    assert COMMITTED.exists(), REGEN_HINT
    committed_text = COMMITTED.read_text(encoding="utf-8")
    assert committed_text == live_text, REGEN_HINT


def test_fixture_covers_every_documented_case() -> None:
    """Census guard so the fixture can't quietly lose a case it claims to
    cover (tools/freeze_portable_manifest.py's own module docstring lists
    them)."""
    freeze = _load_freeze_script()
    manifest = freeze.build_fixture_manifest()

    statuses = {row["status"] for row in manifest["sources"]}
    assert statuses == {"ok", "missing", "offline", "permission_denied"}

    sources = manifest["sources"]
    assert any(row["shared"] for row in sources), "no shared source in fixture"
    assert any(
        row["collision_group"] is not None for row in sources
    ), "no collision group in fixture"
    assert any(
        "renamed_unportable_name" in row["warnings"] and "CON" in row["renamed_from"]
        for row in sources
        if row["renamed_from"]
    ), "no reserved-name row in fixture"
    assert any(
        len(row["bundle_path"]) < len(row["original_path"]) and "~" in row["bundle_path"]
        for row in sources
    ), "no over-long-name row in fixture"
    assert any("\\\\" in row["original_path"] for row in sources), "no UNC path in fixture"
    assert any(
        row["original_path"].startswith("C:\\") for row in sources
    ), "no Windows path in fixture"
    assert any(
        row["original_path"].startswith("/Volumes/") for row in sources
    ), "no macOS volume path in fixture"
    assert any(
        "\u00e9" in row["original_path"] or "\u00b5" in row["original_path"] for row in sources
    ), "no Unicode-named source in fixture"

    notes = {entry.get("note") for entry in manifest["datasets"] if "note" in entry}
    assert notes == {"embedded_only", "malformed_source"}
