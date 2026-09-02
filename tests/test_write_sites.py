"""Write-site ratchet (P1.2 box 4: "raw source files are never rewritten").

`desktop_bridge.py`/`desktop_bridge_dialogs.py` refuse to write a project
over one of its own declared dataset sources (see `test_desktop_bridge.py`'s
P1.2 box 4 tests) -- but that guard only protects the ONE write path that
runs it. This test makes the claim checkable at the repo level: every
module under `src/quantized` that touches the filesystem for a WRITE is
enumerated here, by name, with a one-line justification for why what it
writes is never a user's raw source file. A new module that starts writing
without being added here fails loudly, and a listed module that stops
writing (a stale allowlist entry, same risk `architecture.test.ts`'s pins
guard against on the frontend side) fails just as loudly -- symmetric
drift detection, not just a one-way ratchet.

**What counts as a "write site"**, scanned via `ast` (never a type checker,
so this is a syntactic approximation -- see the false-positive note below):

  * `open(...)` whose mode argument is a STRING LITERAL containing `w`,
    `a`, `x`, or `+` (a non-literal/computed mode is not seen -- none exist
    in this codebase today, checked by hand).
  * `os.replace`, `os.rename`, `os.remove`, `os.unlink`, `shutil.rmtree`,
    `shutil.copy`, `shutil.copy2`, `shutil.copyfile`, `shutil.move`,
    `tempfile.mkstemp`, `os.fdopen` -- MODULE-QUALIFIED only (`os.`/
    `shutil.`/`tempfile.`), because these names collide with unrelated
    stdlib methods that are NOT filesystem writes: `str.replace`,
    `list.remove`, `dict.copy`/`ndarray.copy`, etc. -- `calc/`'s numeric
    code calls `.copy()` on arrays constantly and none of it touches disk.
    A bare, unqualified `.replace(...)`/`.remove(...)`/`.copy(...)` is
    therefore deliberately NOT flagged; qualifying by module name is the
    cheapest way to keep the scan honest without a type checker.
  * `.write_text(...)` / `.write_bytes(...)` -- Path-specific method names
    with no unrelated stdlib collision, so these ARE flagged unqualified.
  * `.unlink(...)` on anything NOT itself `os`/`shutil`/`tempfile` --
    `Path.unlink` has no unrelated collision either (nothing else in this
    codebase's vocabulary is named `unlink`).

This intentionally does NOT catch every conceivable filesystem write (e.g.
a third-party library's own internal writes, like `h5py.File(path, "w")` in
`io/hdf5.py` -- the CALL SHAPE isn't in the tracked-attribute set above,
only the surrounding module's OWN `Path.unlink` earns its entry here). The
scanned vocabulary matches P1.2's brief precisely; broadening it is a
follow-up, not silently expanded here.
"""

from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "quantized"

_WRITE_MODE_CHARS = frozenset("wax+")
# Path-specific method names -- no unrelated stdlib type shares them, so
# they are flagged regardless of the receiver.
_UNQUALIFIED_WRITE_METHODS = frozenset({"write_text", "write_bytes"})
# Names that ARE filesystem writes when qualified by one of these modules,
# but collide with unrelated str/list/dict/ndarray methods when they are
# not -- see the module docstring's false-positive note.
_MODULE_QUALIFIED_WRITE_METHODS = frozenset(
    {
        "replace",
        "rename",
        "remove",
        "unlink",
        "rmtree",
        "copy",
        "copy2",
        "copyfile",
        "move",
        "mkstemp",
        "fdopen",
    }
)
_WRITE_MODULES = frozenset({"os", "shutil", "tempfile"})

# Relative-to-SRC path -> one-line justification: what it writes, and why
# that is never a user's raw imported/opened source file. Verified by
# running this test's own scan (see the module docstring) -- not copied
# blind from a prior grep pass; `api.py`'s bare `open("report.html", "w")`
# is illustrative text INSIDE the module docstring's example snippet, so it
# is never parsed as an executable `ast.Call` and correctly does not
# appear here (a grep-based pre-scan sees it; this `ast`-based one doesn't,
# on purpose -- grep has no notion of "inside a string literal").
WRITE_SITE_ALLOWLIST: dict[str, str] = {
    "desktop_bridge.py": (
        "write_project_file: the consented .dwk project file at the path the "
        "user chose in the native Save/Save As dialog -- refuses (P1.2 box 4, "
        "desktop_consent.is_declared_source) before touching disk when that "
        "path is the open project's own declared dataset source."
    ),
    "desktop_project_file.py": (
        "cleanup_stray_write_temps: removes this module's OWN "
        "`.qz-write-*` crash-leftover temp files from a project's save "
        "directory -- never the project file itself, never a source."
    ),
    "desktop_project_lock.py": (
        "os.remove releases this module's own filesystem lock sidecar file "
        "(the `<project>.qzlock`-shaped lock record) it created, not the "
        "project or any dataset source."
    ),
    "io/hdf5.py": (
        "write_hdf5: writes only to the explicit `output_path` argument its "
        "caller supplies. The only in-repo caller, routes/export.py, always "
        "passes a path inside a fresh `tempfile.TemporaryDirectory()` it "
        "creates itself -- never a caller-supplied filesystem path."
    ),
    "io/import_filters.py": (
        "_write_filters: persists the saved import-filter list to this "
        "app's own config-dir JSON file (`_filters_path()`), not a dataset."
    ),
    "io/origin_project/writer.py": (
        "write_opj: a pure library function taking an explicit `path` "
        "argument, exported for the headless `api.py`/CLI surface -- no "
        "route in this repo calls it (routes/export.py uses the sibling "
        "`opj_bytes`, which returns bytes with no filesystem write at all)."
    ),
    "io/xrd_csv.py": (
        "write_xrd_csv: a pure library export function taking an explicit "
        "`output_path` argument, exported for the headless `api.py`/CLI "
        "surface -- no route in this repo calls it with any path at all."
    ),
    "plugins/loader.py": (
        "_write_disabled_sources: persists the enabled/disabled plugin list "
        "to this app's own config-dir `plugins.json`, not a dataset."
    ),
    "routes/_uploadcache.py": (
        "stage_upload/_commit: writes and evicts (unlink) entries inside "
        "this module's own bounded staging directory "
        "(`tempfile.gettempdir()/qz_origin_uploads/<token>/<name>`) -- a "
        "server-generated token-named path, never a caller-supplied one, "
        "and always a COPY of uploaded bytes, never the original file."
    ),
    "routes/_uploadstream.py": (
        "stream_to_path: on a failed/oversized upload, unlinks the partial "
        "copy it was just streaming to -- always a fresh `dest` its callers "
        "build under a `tempfile.TemporaryDirectory()` (or the upload-cache "
        "staging dir above) with the file's basename only, never a "
        "caller-supplied absolute path and never the original uploaded file."
    ),
}


def _base_name(node: ast.expr) -> str | None:
    """The leftmost `Name` in an attribute chain (`os.path.foo` -> `os`),
    or `None` when the chain doesn't bottom out in a plain name (e.g. a
    call result's attribute)."""
    while isinstance(node, ast.Attribute):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def _open_mode_is_a_write(call: ast.Call) -> bool:
    mode_arg: ast.expr | None = call.args[1] if len(call.args) >= 2 else None
    for kw in call.keywords:
        if kw.arg == "mode":
            mode_arg = kw.value
    if mode_arg is None:
        return False  # open()'s own default mode is "r"
    return (
        isinstance(mode_arg, ast.Constant)
        and isinstance(mode_arg.value, str)
        and any(c in _WRITE_MODE_CHARS for c in mode_arg.value)
    )


def _write_call_sites(tree: ast.AST) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name) and func.id == "open":
            if _open_mode_is_a_write(node):
                found.append((node.lineno, "open(...)"))
            continue
        if not isinstance(func, ast.Attribute):
            continue
        attr = func.attr
        base = _base_name(func.value)
        if attr in _UNQUALIFIED_WRITE_METHODS:
            found.append((node.lineno, f".{attr}"))
        elif attr == "unlink" and base not in _WRITE_MODULES:
            found.append((node.lineno, ".unlink"))
        elif attr in _MODULE_QUALIFIED_WRITE_METHODS and base in _WRITE_MODULES:
            found.append((node.lineno, f"{base}.{attr}"))
    return found


def _scan_write_sites() -> dict[str, list[tuple[int, str]]]:
    sites: dict[str, list[tuple[int, str]]] = {}
    for path in sorted(SRC.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        found = _write_call_sites(tree)
        if found:
            sites[path.relative_to(SRC).as_posix()] = found
    return sites


def test_write_sites_match_the_allowlist_exactly() -> None:
    """Two-sided: a NEW writer must be added (with a justification) before
    it can land, and a STALE entry (a listed file that no longer writes)
    must be pruned -- an allowlist nobody trims is worse than no allowlist,
    because it stops meaning "these are the write sites" at all."""
    found = _scan_write_sites()
    scanned = set(found)
    listed = set(WRITE_SITE_ALLOWLIST)

    unlisted = scanned - listed
    assert not unlisted, (
        "New filesystem-write site(s) found that are NOT in "
        "WRITE_SITE_ALLOWLIST (tests/test_write_sites.py) -- add a one-line "
        "justification for why this is not a user's raw source, or fix the "
        "code to route through an already-justified helper:\n  "
        + "\n  ".join(f"{name}: {found[name]}" for name in sorted(unlisted))
    )

    stale = listed - scanned
    assert not stale, (
        "WRITE_SITE_ALLOWLIST entry no longer writes anything the scan can "
        "see -- prune it (P1.2 box 4's two-sided discipline: a stale "
        "allowlist is drift, same as an unlisted new writer):\n  "
        + "\n  ".join(sorted(stale))
    )


def test_allowlist_has_no_unjustified_entries() -> None:
    """Every allowlisted path carries a real, non-empty justification --
    catches a copy-pasted or accidentally-blanked entry."""
    empty = [name for name, why in WRITE_SITE_ALLOWLIST.items() if len(why.strip()) < 20]
    assert not empty, f"WRITE_SITE_ALLOWLIST entries with no real justification: {empty}"


def test_allowlisted_paths_actually_exist() -> None:
    """Catches a typo'd relative path in the allowlist that would otherwise
    silently never match anything the scan finds."""
    missing = [name for name in WRITE_SITE_ALLOWLIST if not (SRC / name).is_file()]
    assert not missing, f"WRITE_SITE_ALLOWLIST path(s) not under src/quantized: {missing}"
