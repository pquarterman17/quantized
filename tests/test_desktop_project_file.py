"""Direct tests for :mod:`quantized.desktop_project_file` — split out of
``test_desktop_bridge.py`` alongside the module itself once
``desktop_bridge.py`` crossed the repo's 500-line god-module ceiling
(``tests/test_repo_integrity.py``).
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

import pytest

from quantized.desktop_project_file import (
    WORKSPACE_FORMAT,
    WORKSPACE_VERSIONS,
    WRITE_TEMP_PREFIX,
    cleanup_stray_write_temps,
    declared_source_paths_of,
    extract_declared_source_paths,
    parse_workspace_payload,
    payload_declares_source,
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


# -- cleanup_stray_write_temps's age floor (R1 round-3 review, F3) ----------


def test_cleanup_stray_write_temps_spares_a_young_file(tmp_path: Path) -> None:
    """A freshly-created `.qz-write-*` file is plausibly a DIFFERENT,
    still in-flight save's own temp file — never a genuine crash leftover
    on the timescale a save actually takes — so the default age floor
    (10 minutes) must spare it."""
    stray = tmp_path / f"{WRITE_TEMP_PREFIX}fresh"
    stray.write_text("in flight", encoding="utf-8")
    cleanup_stray_write_temps(str(tmp_path))
    assert stray.exists()


def test_cleanup_stray_write_temps_removes_a_genuinely_old_file(tmp_path: Path) -> None:
    stray = tmp_path / f"{WRITE_TEMP_PREFIX}ancient"
    stray.write_text("crashed a while ago", encoding="utf-8")
    old = time.time() - 3600.0
    os.utime(stray, (old, old))
    cleanup_stray_write_temps(str(tmp_path))
    assert not stray.exists()


def test_cleanup_stray_write_temps_min_age_seconds_is_overridable(tmp_path: Path) -> None:
    """The default is a sensible belt-and-braces floor for the unlocked
    legacy call site, but is a plain keyword argument, not a hardcoded
    constant, in case a caller ever needs a different budget.

    The stray's mtime is backdated EXPLICITLY (1 s) rather than relying on
    "just written" being older than the cleanup's own clock sample: on the
    Windows CI leg the fresh file's mtime landed marginally AFTER
    `time.time()` (filesystem timestamp granularity), the computed age went
    negative, and the — correctly conservative — filter kept the file."""
    stray = tmp_path / f"{WRITE_TEMP_PREFIX}barely_young"
    stray.write_text("x", encoding="utf-8")
    backdated = time.time() - 1.0
    os.utime(stray, (backdated, backdated))
    cleanup_stray_write_temps(str(tmp_path), min_age_seconds=0.0)
    assert not stray.exists()


def test_cleanup_stray_write_temps_ignores_files_without_the_prefix(tmp_path: Path) -> None:
    other = tmp_path / "not-ours.txt"
    other.write_text("leave me alone", encoding="utf-8")
    old = time.time() - 3600.0
    os.utime(other, (old, old))
    cleanup_stray_write_temps(str(tmp_path), min_age_seconds=0.0)
    assert other.exists()


# --- payload_declares_source (P1.2 box 4, #291 self-review) -------------------


def _payload_with_sources(*paths: str) -> dict[str, object]:
    return {"datasets": [{"source": {"path": p}} for p in paths]}


def test_payload_declares_source_matches_the_identical_and_alias_spellings(tmp_path) -> None:
    raw = tmp_path / "sub" / "raw.csv"
    raw.parent.mkdir()
    raw.write_text("x")
    dest = os.path.realpath(str(raw))
    assert payload_declares_source(_payload_with_sources(str(raw)), dest)
    # `sub/../sub/raw.csv` is caught by the pure-string pass, no realpath needed
    alias = str(tmp_path / "sub" / ".." / "sub" / "raw.csv")
    assert payload_declares_source(_payload_with_sources(alias), dest)
    assert not payload_declares_source(_payload_with_sources(str(tmp_path / "other.csv")), dest)
    assert not payload_declares_source(_payload_with_sources(), dest)


@pytest.mark.skipif(os.name == "nt", reason="symlink creation needs a privilege on Windows")
def test_payload_declares_source_resolves_a_symlink_on_the_same_root(tmp_path) -> None:
    raw = tmp_path / "raw.csv"
    raw.write_text("x")
    link = tmp_path / "link.csv"
    link.symlink_to(raw)
    dest = os.path.realpath(str(raw))
    assert payload_declares_source(_payload_with_sources(str(link)), dest)


def test_payload_declares_source_never_resolves_a_source_on_another_root(
    tmp_path, monkeypatch
) -> None:
    # The cost rule: a source on a different drive/UNC root than the
    # destination is compared as a string only -- `os.path.realpath` (which
    # can stall on an unreachable share) must not be called for it.
    dest = os.path.realpath(str(tmp_path / "w.dwk"))
    calls: list[str] = []
    real_realpath = os.path.realpath

    def spy(path: str, **kw: object) -> str:
        calls.append(path)
        return real_realpath(path, **kw)

    def fake_splitdrive(p: str) -> tuple[str, str]:
        # Separator/case-agnostic: on Windows the implementation hands this
        # the `normcase(abspath(...))` spelling (`\\server\share\...`), on
        # POSIX the forward-slash one — both must read as the UNC root.
        q = p.replace("\\", "/").lower()
        return ("//server/share", p[14:]) if q.startswith("//server/share") else ("", p)

    monkeypatch.setattr(os.path, "splitdrive", fake_splitdrive)
    monkeypatch.setattr(os.path, "realpath", spy)
    assert not payload_declares_source(_payload_with_sources("//server/share/raw.csv"), dest)
    assert calls == []


def test_payload_declares_source_tolerates_an_unresolvable_string(tmp_path) -> None:
    dest = os.path.realpath(str(tmp_path / "w.dwk"))
    assert not payload_declares_source(_payload_with_sources("\x00bad"), dest)


def test_parse_workspace_payload_returns_the_document_once_for_both_checks() -> None:
    payload, reason = parse_workspace_payload(_workspace_json())
    assert reason is None
    assert isinstance(payload, dict)
    bad_payload, bad_reason = parse_workspace_payload("not json")
    assert bad_payload is None
    assert bad_reason is not None and bad_reason.startswith("not valid JSON")


# --- P1.7 PR 3 ("Pack Project"): `base_dir` / `kind: "bundle"` sources -----
#
# A packed project's dataset sources carry `kind: "bundle"` with a
# bundle-relative `path` instead of an absolute one. These three functions
# all gained an optional `base_dir` (the `.dwk`'s own directory) to resolve
# that back to a real path -- see `quantized.portable.project_rewrite
# .resolve_bundle_source` for the one sanctioned resolver these delegate to.


def _bundle_payload(rel_path: str) -> dict[str, object]:
    return {"datasets": [{"source": {"kind": "bundle", "path": rel_path}}]}


def test_declared_source_paths_of_skips_a_bundle_source_with_no_base_dir() -> None:
    assert declared_source_paths_of(_bundle_payload("sources/raw.csv")) == []


def test_declared_source_paths_of_resolves_a_bundle_source_with_base_dir(
    tmp_path: Path,
) -> None:
    resolved = declared_source_paths_of(_bundle_payload("sources/raw.csv"), base_dir=str(tmp_path))
    assert resolved == [os.path.join(str(tmp_path), "sources", "raw.csv")]


def test_declared_source_paths_of_still_handles_a_kind_path_source_with_base_dir(
    tmp_path: Path,
) -> None:
    # `base_dir` must not change ordinary `kind: "path"` (or kind-less,
    # pre-existing-fixture-shaped) sources at all.
    payload = _payload_with_sources("/abs/raw.csv")
    assert declared_source_paths_of(payload, base_dir=str(tmp_path)) == ["/abs/raw.csv"]


def test_declared_source_paths_of_skips_a_bundle_source_that_escapes(tmp_path: Path) -> None:
    escaping = _bundle_payload("../escape.csv")
    assert declared_source_paths_of(escaping, base_dir=str(tmp_path)) == []


def test_extract_declared_source_paths_resolves_a_bundle_source_with_base_dir(
    tmp_path: Path,
) -> None:
    content = (
        '{"format": "quantized-workspace", "version": 4, '
        '"datasets": [{"source": {"kind": "bundle", "path": "sources/raw.csv"}}]}'
    )
    resolved = extract_declared_source_paths(content, base_dir=str(tmp_path))
    assert resolved == [os.path.join(str(tmp_path), "sources", "raw.csv")]
    # without base_dir, the bundle source is invisible
    assert extract_declared_source_paths(content) == []


def test_declared_source_paths_of_resolves_multiple_bundle_sources_with_one_base_dir(
    tmp_path: Path,
) -> None:
    """Review finding #7 (PR 3 backend round): the lazy
    ``quantized.portable.project_rewrite`` import in
    ``declared_source_paths_of`` was hoisted out of the per-dataset loop
    to run at most once per call rather than once per matching row — this
    pins that the loop still resolves EVERY matching row correctly
    afterward (not just the first, e.g. from a stale/shadowed binding a
    careless hoist could introduce)."""
    payload = {
        "datasets": [
            {"source": {"kind": "bundle", "path": "sources/a.csv"}},
            {"source": {"kind": "path", "path": "/abs/untouched.csv"}},
            {"source": {"kind": "bundle", "path": "sources/b.csv"}},
        ]
    }
    resolved = declared_source_paths_of(payload, base_dir=str(tmp_path))
    assert resolved == [
        os.path.join(str(tmp_path), "sources", "a.csv"),
        "/abs/untouched.csv",
        os.path.join(str(tmp_path), "sources", "b.csv"),
    ]


def test_desktop_project_file_and_portable_import_cleanly_in_both_orders() -> None:
    """Review finding #7: ``quantized.portable.project_rewrite`` now
    imports ``parse_workspace_payload`` at MODULE level (the previous
    function-local import was justified by a circular-import claim that
    does not actually hold — see that module's own doc). The one real
    cycle risk runs the OTHER way: ``quantized.portable.publish`` needs
    ``quantized.desktop_project_file.WRITE_TEMP_PREFIX`` at module-load
    time, so ``desktop_project_file``'s own cross-package call stays
    function-local. Each import order is run in a FRESH subprocess so a
    previous test's ``sys.modules`` caching can never hide a regression
    (a module that already finished importing earlier in THIS process
    would silently mask a real ordering bug)."""
    import subprocess

    for statement in (
        "import quantized.desktop_project_file; import quantized.portable",
        "import quantized.portable; import quantized.desktop_project_file",
    ):
        proc = subprocess.run(
            [sys.executable, "-c", statement],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, (
            f"import order {statement!r} failed:\n{proc.stdout}\n{proc.stderr}"
        )


def test_payload_declares_source_resolves_a_bundle_copy_only_with_base_dir(
    tmp_path: Path,
) -> None:
    bundle_dir = tmp_path / "bundle"
    sources_dir = bundle_dir / "sources"
    sources_dir.mkdir(parents=True)
    copied = sources_dir / "raw.csv"
    copied.write_bytes(b"x")
    dest = os.path.realpath(str(copied))

    payload = _bundle_payload("sources/raw.csv")
    assert payload_declares_source(payload, dest, base_dir=str(bundle_dir)) is True
    assert payload_declares_source(payload, dest) is False
