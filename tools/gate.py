"""Single cross-platform gate command.

The gate used to be a 5-command chant across two directories, copy-pasted
(with drift) into CONTRIBUTING.md, README.md, and CLAUDE.md. This script is
the one source of truth for "what does the gate actually run" — the docs
point here first and keep the individual commands after it for people who
want to run one step by hand.

Cross-platform on purpose (the owner develops on Windows): every step runs
through ``subprocess.run`` with ``shell=False`` and an explicit argv list, so
there is no shell-quoting difference between platforms. ``npm`` resolves via
``shutil.which`` so it picks up ``npm.cmd`` on Windows automatically.

Usage:
    uv run python tools/gate.py                  # everything
    uv run python tools/gate.py --backend-only   # ruff + mypy + pytest
    uv run python tools/gate.py --frontend-only  # npm lint + test + build
    uv run python tools/gate.py --skip-tests     # skip pytest and npm test
    uv run python tools/gate.py --origin         # ONLY the Origin corpus before/after check

``--origin`` runs ``tools/origin_regress.py check`` (HEAD vs a freshly built
``origin/main`` in a temporary worktree) when a local Origin corpus exists
(``test-data/origin``, ``QZ_ORIGIN_PUBLIC_CORPUS`` / ``QZ_ORIGIN_OWNER_CORPUS``);
without one it skips with a message (CI has no corpus). Pass an explained-
changes file with ``--origin-allow FILE``; every corpus change must be in it.

Stops at the first failing step and exits with that step's return code.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def _npm() -> str:
    npm = shutil.which("npm")
    if npm is None:
        raise SystemExit("gate: 'npm' not found on PATH")
    return npm


def _run(step: str, argv: list[str], *, cwd: Path = ROOT) -> None:
    print(f"==> {step}: {' '.join(argv)}", flush=True)
    start = time.monotonic()
    result = subprocess.run(argv, cwd=cwd, shell=False, check=False)
    elapsed = time.monotonic() - start
    print(f"    ({elapsed:.1f}s)", flush=True)
    if result.returncode != 0:
        print(f"gate: FAILED at step {step!r} (exit {result.returncode})", file=sys.stderr)
        raise SystemExit(result.returncode)


def _backend_steps(skip_tests: bool) -> list[tuple[str, list[str]]]:
    steps = [
        ("ruff", ["uv", "run", "ruff", "check", "src", "tests", "tools"]),
        ("mypy", ["uv", "run", "mypy", "src"]),
    ]
    if not skip_tests:
        steps.append(("pytest", ["uv", "run", "pytest", "-q", "-n", "auto"]))
    return steps


def _frontend_steps(skip_tests: bool) -> list[tuple[str, list[str]]]:
    npm = _npm()
    steps = [("npm lint", [npm, "run", "lint"])]
    if not skip_tests:
        steps.append(("npm test", [npm, "test"]))
    steps.append(("npm build", [npm, "run", "build"]))
    return steps


def _origin_corpus_present() -> bool:
    sys.path.insert(0, str(ROOT / "tools"))
    from origin_regress_lib import runner

    return bool(runner.collect_files(runner.discover_corpora([])))


def _origin_step(allow: str | None) -> int:
    if not _origin_corpus_present():
        print(
            "gate: --origin skipped: no local Origin corpus (test-data/origin, "
            "QZ_ORIGIN_PUBLIC_CORPUS, QZ_ORIGIN_OWNER_CORPUS)"
        )
        return 0
    argv = [
        "uv",
        "run",
        "python",
        "tools/origin_regress.py",
        "check",
        "--base",
        "origin/main",
        "--fetch",
    ]
    if allow:
        argv += ["--allow-file", allow]
    _run("origin regress", argv, cwd=ROOT)
    print("gate: origin corpus check passed")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the quantized gate (lint + typecheck + tests + build)."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--backend-only", action="store_true", help="run only ruff + mypy + pytest")
    group.add_argument(
        "--frontend-only", action="store_true", help="run only npm lint + test + build"
    )
    parser.add_argument(
        "--origin",
        action="store_true",
        help="run only the Origin corpus regression check vs origin/main (skips w/o corpus)",
    )
    parser.add_argument("--origin-allow", help="explained-changes JSON for --origin")
    parser.add_argument(
        "--skip-tests",
        action="store_true",
        help="skip pytest and npm test (still lints and builds)",
    )
    args = parser.parse_args(argv)

    if args.origin:
        return _origin_step(args.origin_allow)

    gate_start = time.monotonic()

    if not args.frontend_only:
        for step, cmd in _backend_steps(args.skip_tests):
            _run(step, cmd, cwd=ROOT)

    if not args.backend_only:
        for step, cmd in _frontend_steps(args.skip_tests):
            _run(step, cmd, cwd=FRONTEND)

    total = time.monotonic() - gate_start
    print(f"gate: all steps passed in {total:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
