"""Determinism + size-cap guard for the P0.3 timed-workflow baseline fixtures.

PRIMARY_SOFTWARE_AUDIT_PLAN P0.3: the committed fixture set under
``tests/fixtures/baselines/`` must be reproducible from
``tools/baselines/make_fixtures.py`` (nobody hand-edits a fixture without
regenerating) and must stay small enough to commit. This runs the real CLI
entry point — the exact command documented in
``docs/timed_workflow_baselines.md`` — against a scratch directory and
byte-compares every file against the committed copy.

No markers needed: fast, no external corpus, runs everywhere including CI.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
COMMITTED_DIR = REPO_ROOT / "tests" / "fixtures" / "baselines"
MAKE_FIXTURES = REPO_ROOT / "tools" / "baselines" / "make_fixtures.py"

# Committed-payload cap from the P0.3 brief ("total committed fixture payload
# under ~1.5 MB"). Comfortably above the ~172 KiB the current set measures.
MAX_TOTAL_BYTES = 1_500_000


def _committed_files() -> list[Path]:
    if not COMMITTED_DIR.is_dir():
        return []
    return sorted(p for p in COMMITTED_DIR.iterdir() if p.is_file())


_COMMITTED_NAMES = [p.name for p in _committed_files()]


@pytest.fixture(scope="module")
def regenerated_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Regenerate the committed fixture set into a scratch directory via the
    real CLI, so this test exercises exactly what a developer would run."""
    out_dir = tmp_path_factory.mktemp("baseline-regen")
    subprocess.run(
        [sys.executable, str(MAKE_FIXTURES), "--out", str(out_dir)],
        check=True,
        cwd=REPO_ROOT,
    )
    return out_dir


def test_committed_fixtures_exist() -> None:
    assert _COMMITTED_NAMES, "no committed fixtures found under tests/fixtures/baselines"


@pytest.mark.parametrize("name", _COMMITTED_NAMES)
def test_regeneration_is_byte_identical(name: str, regenerated_dir: Path) -> None:
    """Regenerating must reproduce the committed bytes exactly — this is what
    catches an un-regenerated hand-edit AND proves the generator is seeded
    deterministically (fixed numpy seeds, no timestamps/hostnames)."""
    committed = (COMMITTED_DIR / name).read_bytes()
    regenerated_path = regenerated_dir / name
    assert regenerated_path.is_file(), f"generator did not (re)produce {name}"
    regenerated = regenerated_path.read_bytes()
    assert regenerated == committed, (
        f"{name} differs from freshly-regenerated output — was it hand-edited? "
        f"Re-run: uv run python tools/baselines/make_fixtures.py"
    )


def test_regeneration_produces_no_extra_or_missing_files(regenerated_dir: Path) -> None:
    regenerated_names = {p.name for p in regenerated_dir.iterdir() if p.is_file()}
    assert regenerated_names == set(_COMMITTED_NAMES)


def test_committed_payload_under_size_cap() -> None:
    total = sum(p.stat().st_size for p in _committed_files())
    assert total < MAX_TOTAL_BYTES, (
        f"committed baseline fixtures total {total} bytes (cap {MAX_TOTAL_BYTES}); "
        "trim a case or move data-heavy variants to the --large (non-committed) set"
    )
