"""Direct tests for :mod:`quantized.desktop_project_file` — split out of
``test_desktop_bridge.py`` alongside the module itself once
``desktop_bridge.py`` crossed the repo's 500-line god-module ceiling
(``tests/test_repo_integrity.py``).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from quantized.desktop_project_file import (
    WORKSPACE_FORMAT,
    WORKSPACE_VERSIONS,
    extract_declared_source_paths,
    validate_workspace_payload,
)


def _workspace_json(marker: str = "x") -> str:
    return (
        '{"format": "quantized-workspace", "version": 4, '
        f'"datasets": [{{"id": "{marker}"}}]}}'
    )


def test_validate_workspace_payload_accepts_a_well_formed_document() -> None:
    assert validate_workspace_payload(_workspace_json()) is None


def test_validate_workspace_payload_rejects_invalid_json() -> None:
    assert validate_workspace_payload("not json") is not None


def test_validate_workspace_payload_rejects_a_non_object() -> None:
    assert validate_workspace_payload("[1, 2, 3]") is not None


def test_validate_workspace_payload_rejects_wrong_format() -> None:
    payload = '{"format": "not-a-workspace", "version": 4, "datasets": []}'
    assert validate_workspace_payload(payload) is not None


def test_validate_workspace_payload_rejects_unsupported_version() -> None:
    payload = '{"format": "quantized-workspace", "version": 99, "datasets": []}'
    assert validate_workspace_payload(payload) is not None


def test_validate_workspace_payload_rejects_missing_datasets_array() -> None:
    payload = '{"format": "quantized-workspace", "version": 4}'
    assert validate_workspace_payload(payload) is not None


def test_validate_workspace_payload_tolerates_the_new_plot_recipes_field() -> None:
    """P1.3 wave 2 (Lane C) added a top-level `plotRecipes` array to the v4
    workspace doc (frontend/src/lib/workspace.ts). This gate is intentionally
    narrow — format/version/datasets only, per the module's own doc ("no
    further") — so a v4 payload carrying the new field must still validate
    with no backend change needed; this test is the proof, not an assumption."""
    payload = (
        '{"format": "quantized-workspace", "version": 4, "datasets": [], '
        '"plotRecipes": [{"id": "r1", "name": "XRD standard"}]}'
    )
    assert validate_workspace_payload(payload) is None


# --- cross-language pin (P3-b, adversarial review) --------------------------
#
# `WORKSPACE_FORMAT`/`WORKSPACE_VERSIONS` here are hand-copied from
# frontend/src/lib/workspace.ts's `WORKSPACE_FORMAT`/`WORKSPACE_VERSION` — the
# module's own doc admits it ("kept in sync BY HAND, since nothing crosses
# the Python/TypeScript boundary to share them"). A version bump on the
# frontend with nobody remembering to mirror it here would make every native
# save fail validation for every user, silently, until someone noticed. This
# reads the frontend source directly (the wire-fixture-discipline pattern)
# and asserts the backend still accepts what the frontend currently declares.


def _frontend_workspace_ts() -> Path | None:
    # tests/ -> repo root -> frontend/src/lib/workspace.ts
    candidate = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "workspace.ts"
    return candidate if candidate.is_file() else None


def test_backend_accepts_the_frontends_current_workspace_format_and_version() -> None:
    path = _frontend_workspace_ts()
    if path is None:
        pytest.skip("frontend/src/lib/workspace.ts not found in this checkout")
    src = path.read_text(encoding="utf-8")

    format_match = re.search(r'WORKSPACE_FORMAT\s*=\s*"([^"]+)"', src)
    version_match = re.search(r"WORKSPACE_VERSION\s*=\s*(\d+)", src)
    if format_match is None or version_match is None:
        pytest.skip(
            "could not find WORKSPACE_FORMAT/WORKSPACE_VERSION in workspace.ts "
            "(renamed or restructured? update this test's regexes)"
        )
    frontend_format = format_match.group(1)
    frontend_version = int(version_match.group(1))

    assert frontend_format == WORKSPACE_FORMAT, (
        "backend WORKSPACE_FORMAT has drifted from the frontend's — "
        "update quantized/desktop_project_file.py"
    )
    assert frontend_version in WORKSPACE_VERSIONS, (
        f"the frontend's current WORKSPACE_VERSION ({frontend_version}) is not in backend "
        f"WORKSPACE_VERSIONS {WORKSPACE_VERSIONS} — update quantized/desktop_project_file.py"
    )

    # The end-to-end proof, not just the two constants in isolation: a
    # payload built from the frontend's OWN current values must actually
    # pass the backend's gate.
    payload = f'{{"format": "{frontend_format}", "version": {frontend_version}, "datasets": []}}'
    assert validate_workspace_payload(payload) is None


# --- extract_declared_source_paths (P1.7 P1-A) ------------------------------


def test_extract_declared_source_paths_finds_every_dataset_source() -> None:
    payload = (
        '{"format": "quantized-workspace", "version": 4, "datasets": ['
        '{"id": "a", "source": {"kind": "path", "path": "/data/a.csv"}}, '
        '{"id": "b", "source": {"kind": "path", "path": "/data/b.csv"}}, '
        '{"id": "c"}'  # no source at all
        "]}"
    )
    assert extract_declared_source_paths(payload) == ["/data/a.csv", "/data/b.csv"]


def test_extract_declared_source_paths_never_raises_on_a_malformed_payload() -> None:
    assert extract_declared_source_paths("not json") == []
    assert extract_declared_source_paths("[]") == []
    assert extract_declared_source_paths('{"datasets": "not a list"}') == []
    assert extract_declared_source_paths('{"datasets": [1, 2, "not an object"]}') == []
    assert (
        extract_declared_source_paths('{"datasets": [{"source": "not an object"}]}') == []
    )
    assert (
        extract_declared_source_paths('{"datasets": [{"source": {"path": 123}}]}') == []
    )
    assert (
        extract_declared_source_paths('{"datasets": [{"source": {"path": ""}}]}') == []
    )


def test_extract_declared_source_paths_ignores_everything_but_source_path() -> None:
    """It reads narrowly — a malicious payload can't smuggle extra
    "declared" paths through some OTHER field this function might have been
    tempted to also scan."""
    payload = '{"datasets": [{"id": "a", "pending": {"kind": "path", "path": "/sneaky/a.csv"}}]}'
    assert extract_declared_source_paths(payload) == []
