"""Bump the version everywhere at once (RELEASE.md "Cutting a release" step 1).

Quantized carries its version in five files (kept in sync by
``tests/test_version_consistency.py``) plus three lockfiles that record the
project's own version and must be regenerated after a bump:

    pyproject.toml               -> [project] version
    src/quantized/__init__.py    -> __version__
    src-tauri/Cargo.toml         -> [package] version
    src-tauri/tauri.conf.json    -> "version"
    frontend/package.json        -> "version"

    uv.lock                      -> `uv lock`
    frontend/package-lock.json   -> `npm install --package-lock-only`
    src-tauri/Cargo.lock         -> `cargo update -w --offline`

Each file edit is a single targeted regex substitution on the *first*
matching line only, so surrounding formatting (quote style, indentation,
trailing content) is untouched — this is a version bump, not a reformat.

Usage:
    uv run python tools/bump_version.py 0.25.0
    uv run python tools/bump_version.py 0.25.0-rc1 --dry-run
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# X.Y.Z with an optional -rcN (or -aN / -bN / -devN) pre-release suffix —
# the shape RELEASE.md's `vX.Y.Z` tag and Cargo/npm/Tauri all accept, and
# what tests/test_version_consistency.py::test_version_is_pep440_ish checks.
VERSION_RE = re.compile(r"\A\d+\.\d+\.\d+(-(rc|a|b|dev)\d+)?\Z")


@dataclass(frozen=True)
class Edit:
    """One targeted, single-line regex substitution in one file.

    ``pattern`` must match the *entire* line to replace. ``render`` builds
    the replacement line from the match (so surrounding punctuation, like a
    JSON line's leading indent and trailing comma, is preserved verbatim).
    """

    path: Path
    pattern: re.Pattern[str]
    render: Callable[[re.Match[str], str], str]


def _plain_line(template: str) -> Callable[[re.Match[str], str], str]:
    def render(_match: re.Match[str], version: str) -> str:
        return template.format(version=version)

    return render


def _json_version_line(match: re.Match[str], version: str) -> str:
    """`  "version": "X.Y.Z",` — keep the captured indent/key and comma."""
    return f'{match.group(1)}"{version}"{match.group(2)}'


def _edits() -> list[Edit]:
    return [
        Edit(
            ROOT / "pyproject.toml",
            re.compile(r'(?m)^version = "[^"]+"$'),
            _plain_line('version = "{version}"'),
        ),
        Edit(
            ROOT / "src" / "quantized" / "__init__.py",
            re.compile(r'(?m)^__version__ = "[^"]+"$'),
            _plain_line('__version__ = "{version}"'),
        ),
        Edit(
            ROOT / "src-tauri" / "Cargo.toml",
            re.compile(r'(?m)^version = "[^"]+"$'),
            _plain_line('version = "{version}"'),
        ),
        Edit(
            ROOT / "src-tauri" / "tauri.conf.json",
            re.compile(r'(?m)^(  "version": )"[^"]+"(,)$'),
            _json_version_line,
        ),
        Edit(
            ROOT / "frontend" / "package.json",
            re.compile(r'(?m)^(  "version": )"[^"]+"(,)$'),
            _json_version_line,
        ),
    ]


def _match(edit: Edit) -> re.Match[str]:
    text = edit.path.read_text(encoding="utf-8")
    match = edit.pattern.search(text)
    if match is None:
        raise SystemExit(f"bump_version: pattern not found in {edit.path}")
    return match


def _plan(version: str) -> list[tuple[Edit, str, str]]:
    """Return the (edit, old_line, new_line) triples that would actually change."""
    plan: list[tuple[Edit, str, str]] = []
    for edit in _edits():
        match = _match(edit)
        old_line = match.group(0)
        new_line = edit.render(match, version)
        if old_line != new_line:
            plan.append((edit, old_line, new_line))
    return plan


def _apply(version: str) -> None:
    for edit in _edits():
        text = edit.path.read_text(encoding="utf-8")
        match = edit.pattern.search(text)
        if match is None:
            raise SystemExit(f"bump_version: pattern not found in {edit.path}")
        new_line = edit.render(match, version)
        new_text = text[: match.start()] + new_line + text[match.end() :]
        edit.path.write_text(new_text, encoding="utf-8")


def _npm() -> str:
    npm = shutil.which("npm")
    if npm is None:
        raise SystemExit("bump_version: 'npm' not found on PATH")
    return npm


def _run_lock_commands(*, dry_run: bool) -> None:
    commands: list[tuple[str, list[str], Path]] = [
        ("uv.lock", ["uv", "lock"], ROOT),
        (
            "frontend/package-lock.json",
            [_npm(), "install", "--package-lock-only"],
            ROOT / "frontend",
        ),
    ]
    for label, argv, cwd in commands:
        if dry_run:
            print(f"[dry-run] would run in {cwd}: {' '.join(argv)}  (regenerates {label})")
            continue
        print(f"==> regenerating {label}: {' '.join(argv)}")
        subprocess.run(argv, cwd=cwd, shell=False, check=True)

    cargo = shutil.which("cargo")
    if cargo is None:
        print(
            "bump_version: 'cargo' not found on PATH — skipping Cargo.lock. "
            "Run this manually once Rust is installed: "
            "cd src-tauri && cargo update -w --offline"
        )
        return
    argv = [cargo, "update", "-w", "--offline"]
    if dry_run:
        print(f"[dry-run] would run in src-tauri: {' '.join(argv)}  (regenerates Cargo.lock)")
        return
    print(f"==> regenerating src-tauri/Cargo.lock: {' '.join(argv)}")
    subprocess.run(argv, cwd=ROOT / "src-tauri", shell=False, check=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    parser.add_argument("version", help="new version, e.g. 0.25.0 or 0.25.0-rc1")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print planned edits and lock commands, change nothing",
    )
    args = parser.parse_args(argv)

    if not VERSION_RE.match(args.version):
        raise SystemExit(
            f"bump_version: {args.version!r} is not X.Y.Z or X.Y.Z-rcN/aN/bN/devN"
        )

    plan = _plan(args.version)
    if not plan:
        print(
            f"bump_version: all five files already read version {args.version!r}; "
            "nothing to edit."
        )
    else:
        for edit, old_line, new_line in plan:
            rel = edit.path.relative_to(ROOT)
            verb = "[dry-run] would change" if args.dry_run else "changing"
            print(f"{verb} {rel}:\n  - {old_line}\n  + {new_line}")
        if not args.dry_run:
            _apply(args.version)

    _run_lock_commands(dry_run=args.dry_run)

    if args.dry_run:
        print("bump_version: dry run complete, nothing was written.")
    else:
        print(f"bump_version: bumped to {args.version}. Review with `git diff`, then commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
