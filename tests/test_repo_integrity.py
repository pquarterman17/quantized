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
4. DATA FILE GUARD  — every non-.py file under src/quantized/ (excluding the
   built web/ SPA and __pycache__) is pinned to a loader that actually reads
   it. tools/bundle/qz-server.spec's collect_data_files("quantized") ships
   every such file into the PyInstaller sidecar automatically (see its
   comment for the bug this fixed: only src/quantized/web ever shipped, so
   the installed app 500'd on the Elements calculator, SLD presets, and the
   demo dataset); this is the matching Python-side pin so a new data file
   with no working loader fails a test instead of shipping broken.

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


# tools/ scripts rot exactly like source modules but were walked by no guard
# (ROBUSTNESS #7 census, 2026-08-01: export_origin_graphs.py had already
# drifted to 506 — the lib/api.ts failure class, one directory over). Same
# ceiling; files already over it are pinned at their found size and may only
# shrink. Never add a pin — split instead.
TOOLS_PINS = {
    "tools/origin_compare/export_origin_graphs.py": 506,
}


def test_no_god_tools() -> None:
    """No tools/ script exceeds the ceiling; pinned legacy files only shrink."""
    offenders = []
    for path in (ROOT / "tools").rglob("*.py"):
        rel = path.relative_to(ROOT).as_posix()
        n_lines = len(path.read_text(encoding="utf-8").splitlines())
        limit = TOOLS_PINS.get(rel, MAX_MODULE_LINES)
        if n_lines > limit:
            offenders.append(f"{rel}: {n_lines} lines (limit {limit})")
        elif rel in TOOLS_PINS and n_lines <= MAX_MODULE_LINES:
            offenders.append(
                f"{rel}: {n_lines} lines — under the general ceiling; "
                "delete its TOOLS_PINS entry (graduation)"
            )
    assert not offenders, (
        "tools/ size guard failures (split the script, or lower its pin "
        "after an extraction):\n  " + "\n  ".join(offenders)
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


# Every non-.py package data file, mapped to a callable proving its consumer's
# public loader can actually read it. A new data file added anywhere under
# src/quantized/ must be added here (with a working loader) or
# test_every_data_file_has_a_pinned_loader fails — the Python-side half of
# the collect_data_files("quantized") fix in tools/bundle/qz-server.spec.
def _element_data_loads() -> None:
    from quantized.calc.element_data import element_data

    assert len(element_data()) == 118


def _refl_sld_presets_loads() -> None:
    from quantized.calc.sld import refl_sld_presets

    assert len(refl_sld_presets()) > 0


def _demo_sample_exists() -> None:
    from quantized.routes.samples import _DEMO_FILE

    assert _DEMO_FILE.is_file()


DATA_FILE_LOADERS = {
    SRC / "calc" / "element_data.json": _element_data_loads,
    SRC / "calc" / "refl_sld_presets.json": _refl_sld_presets_loads,
    SRC / "samples" / "demo_vsm.csv": _demo_sample_exists,
}


def test_data_file_loaders_pinned_contracts() -> None:
    """Each pinned data file's consumer loads it and returns the expected shape."""
    for loader in DATA_FILE_LOADERS.values():
        loader()


def test_every_data_file_has_a_pinned_loader() -> None:
    """Census: no package data file may ship without a loader test pinning it.

    This is what makes the guard future-proof — collect_data_files("quantized")
    will happily ship a brand-new JSON/CSV into the sidecar, but if nothing
    ever proves the file loads, a broken or missing file only surfaces as a
    500 in the installed app. Excludes the built web/ SPA (not a
    Python-loaded data file; the smoke-test in release.yml covers it) and
    __pycache__.
    """
    found = set()
    for path in SRC.rglob("*"):
        if path.is_dir() or path.suffix == ".py":
            continue
        if "__pycache__" in path.parts or "web" in path.parts:
            continue
        found.add(path)

    unknown = found - set(DATA_FILE_LOADERS)
    missing = set(DATA_FILE_LOADERS) - found
    assert not unknown, (
        "new package data file(s) with no pinned loader test — add one to "
        "DATA_FILE_LOADERS in this file:\n  "
        + "\n  ".join(str(p.relative_to(ROOT)) for p in sorted(unknown))
    )
    assert not missing, (
        "pinned data file(s) missing from disk (stale DATA_FILE_LOADERS "
        "entry?):\n  " + "\n  ".join(str(p.relative_to(ROOT)) for p in sorted(missing))
    )


def test_plan_items_claiming_completion_are_moved_to_completed() -> None:
    """Plan drift guard: items claiming CLOSED/SHIPPED/COMPLETE must be struck.

    Per plan-hygiene rules (plans/MAIN_PLAN.md context), when an item finishes,
    it is moved to the ## Completed section with strike-through formatting
    (~~**Item title**~~). Items that claim completion but remain unstr uck in tier
    sections are drift: the tier shows them as open while the text claims they're
    done.

    Three recent cases (GUI_INTERACTION_PLAN #8/#11/#12, fixed 2026-08-10):
    items were marked "CLOSED 2026-07-18 (see Completed)" in Tier 2 but never
    struck, so they rendered as open while Completed had them struck separately.

    False positives ruled out: only flags items whose FIRST two lines contain
    the completion claim in the item's own text, not context (e.g., "item 14
    CLOSED" in a sub-item description). Allows "superseded" in context alone.
    """
    import re

    COMPLETION_WORDS = {"CLOSED", "SHIPPED", "COMPLETE", "DONE"}
    plans_dir = ROOT / "plans"

    drift_found = []

    for plan_file in sorted(plans_dir.glob("*.md")):
        if "archive" in plan_file.parts or plan_file.name.endswith(("_DRAFT.md", "_SURVEY.md", "_NOTES.md")):
            continue

        text = plan_file.read_text(encoding="utf-8")
        lines = text.splitlines()

        # Find the ## Completed section line number (if it exists)
        completed_idx = None
        for i, line in enumerate(lines):
            if line.strip().startswith("## Completed"):
                completed_idx = i
                break

        # Scan tier sections (between "## Tier" and "## Completed" or EOF)
        in_completed = False
        for i, line in enumerate(lines):
            if completed_idx is not None and i >= completed_idx:
                in_completed = True
                break

            # Look for numbered items: "N. **Title**" (with or without checkbox)
            # Match: 1. **Item** or 3. **[x] Item** or 7. **[ ] Item**
            item_match = re.match(r"^(\d+)\.\s+(?:\*\*\[.\]\s+)?\*\*(.+?)\*\*", line)
            if not item_match:
                continue

            item_num, item_text = item_match.groups()

            # Is the item struck? (starts with ~~)
            if line.strip().startswith("~~"):
                continue  # Already correctly struck

            # Check if item or next 2 lines claim completion in the item's own text
            context = "\n".join([line] + lines[i + 1 : min(i + 3, len(lines))])
            has_completion_claim = any(word in context for word in COMPLETION_WORDS)

            if not has_completion_claim:
                continue

            # Is the claim about THIS item, not a sub-item or context?
            # Rule: the completion word must appear in the first line or in a
            # continuation line that's part of the item's own description
            # (not a [ ]/[x] sub-box or a separate context paragraph).
            # Heuristic: if the second line starts with whitespace + [ ], it's a sub-item.
            is_self_claim = True
            if i + 1 < len(lines) and re.match(r"^\s+- \[", lines[i + 1]):
                # This is a top-level item with sub-boxes; only flag if the ITEM line itself claims done
                is_self_claim = COMPLETION_WORDS.intersection(line.split())

            if is_self_claim:
                drift_found.append(
                    f"{plan_file.name}: {item_num}. — claims {list(COMPLETION_WORDS & set(context.split()))} "
                    f"but not struck"
                )

    assert not drift_found, (
        "Plan items claiming completion must be moved to ## Completed with "
        "strike-through. Fix by removing from tier sections OR add individual "
        "struck entries to Completed:\n  " + "\n  ".join(drift_found)
    )
