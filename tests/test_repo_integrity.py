"""Structural guards — enforced from day one so they never need retrofitting.

The MATLAB predecessor (BosonPlotter.m ~7k lines) and the first Python port
(thin_film_toolkit server.py 5.5k lines) both rotted into god-scripts for
lack of an enforced boundary. These invariants make that impossible by
construction:

1. LICENSE GUARD    — no GPL package in runtime/extra deps (this is Apache-2.0).
2. GOD-MODULE GUARD — no source module over MAX_MODULE_LINES. Raise the
   ceiling ONLY with a written justification in the commit message.
3. LAYERING GUARD   — datastruct/io/calc/plugins never import the web stack, so
   their tests run server-free and business logic can't leak into transport.

See .claude/rules/architecture-guards.md for the full rationale.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "quantized"

# GPL packages we must never ship at runtime (parser oracles etc. are dev-only).
# `liborigin`/`ropj` read Origin projects but are GPL — quantized rolls its own
# clean-room reader instead (see io/origin_project.py). Substring match, so
# "liborigin" also blocks the "python-liborigin2" wrapper.
GPL_PACKAGES = {"rosettasciio", "rsciio", "hyperspy", "exspy", "holospy", "liborigin", "ropj"}
MAX_MODULE_LINES = 500
# plugins/ is pure too: the plugin machinery (discovery, contract, registration)
# must never reach the web stack — plugins register through io/calc, not routes.
PURE_LAYERS = ("io", "calc", "plugins")
FORBIDDEN_IN_PURE = ("fastapi", "pydantic", "quantized.routes", "starlette")


def _pyproject() -> dict:
    return tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))


def test_no_gpl_in_runtime_deps() -> None:
    """Apache-2.0 project: no GPL in [project.dependencies] or extras.

    Dev-only oracles (if ever needed) live in [dependency-groups], which
    does not ship to users and is intentionally not scanned here.
    """
    pyproject = _pyproject()
    runtime = " ".join(pyproject["project"].get("dependencies", [])).lower()
    for pkg in GPL_PACKAGES:
        assert pkg not in runtime, (
            f"GPL package '{pkg}' in [project.dependencies] — Apache-2.0 "
            f"violation. Dev-only deps belong in [dependency-groups]."
        )
    extras = pyproject["project"].get("optional-dependencies", {})
    for extra, deps in extras.items():
        joined = " ".join(deps).lower()
        for pkg in GPL_PACKAGES:
            assert pkg not in joined, f"GPL package '{pkg}' in extra '{extra}'"


def test_no_god_modules() -> None:
    """No source module exceeds the line ceiling."""
    offenders = []
    for path in SRC.rglob("*.py"):
        n_lines = len(path.read_text(encoding="utf-8").splitlines())
        if n_lines > MAX_MODULE_LINES:
            offenders.append(f"{path.relative_to(ROOT)}: {n_lines} lines")
    assert not offenders, (
        f"Modules over {MAX_MODULE_LINES} lines (split before merging):\n  "
        + "\n  ".join(offenders)
    )


def test_pure_layers_do_not_import_server_stack() -> None:
    """datastruct/io/calc/plugins must not import fastapi/pydantic/starlette/routes."""
    pure_files: list[Path] = [p for p in [SRC / "datastruct.py"] if p.exists()]
    for layer in PURE_LAYERS:
        pure_files.extend((SRC / layer).rglob("*.py"))

    offenders = []
    for path in pure_files:
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not (stripped.startswith(("import ", "from "))):
                continue
            if any(bad in stripped for bad in FORBIDDEN_IN_PURE):
                offenders.append(f"{path.relative_to(ROOT)}: {stripped}")
    assert not offenders, (
        "datastruct/io/calc are pure libraries — no web-stack imports:\n  "
        + "\n  ".join(offenders)
    )
