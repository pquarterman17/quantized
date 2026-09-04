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
    `a`, `x`, or `+`. A computed/non-literal MODE STRING is not seen (the
    `open`-family calls in this codebase all use literals).
  * `os.open(...)` whose flags expression names `O_WRONLY`, `O_RDWR`,
    `O_CREAT`, `O_APPEND` or `O_TRUNC` anywhere in it (self-review on #291:
    `desktop_project_lock.py` creates its lock sidecar with
    `os.open(path, O_CREAT | O_EXCL | O_WRONLY)`, a writer the mode-literal
    rule above cannot see). A flags value held in a variable is not seen.
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

  * Open-like calls with a WRITE-MODE LITERAL -- the builtin `open`, any
    `.open(...)` method (`Path.open`), `os.fdopen`, and `h5py.File(path,
    "w")` -- whatever the receiver (review finding on #291: the first
    version tracked only the bare builtin). The mode literal is the
    discriminant; a computed/non-literal mode is still not seen.

WHAT THIS PROVES, AND WHAT IT DOES NOT. This is a syntactic INVENTORY of the
places this codebase writes to disk, kept honest by the two-sided
allowlist -- it is not a proof that no output path can ever equal an input
path. Library functions that take a caller-supplied output path
(`io/xrd_csv.write_xrd_csv`, `io/origin_project/writer.write_opj`,
`io/hdf5.write_hdf5`) are LISTED with the justification that no HTTP route
passes user input into them; the invariant P1.2 box 4 actually claims --
that the app's own project-save path never lands on a declared raw source
-- is enforced at write time by `desktop_bridge.write_project_file`
(payload-derived AND cached declared-source refusal), and that is what the
plan's completed acceptance criterion is scoped to.
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
# Open-like callables whose SECOND positional argument (or `mode=`) is the
# file mode: the builtin, `Path.open`, `os.fdopen`-style wrappers, and
# `h5py.File` (the one third-party writer this codebase drives with a mode).
_OPEN_LIKE_CALLABLES = frozenset({"open", "File", "fdopen"})
# `os.open` takes FLAGS, not a mode string: any of these names in its flags
# expression makes it a write (or create) site.
_OS_OPEN_WRITE_FLAGS = frozenset({"O_WRONLY", "O_RDWR", "O_CREAT", "O_APPEND", "O_TRUNC"})

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
        "os.open(O_CREAT|O_EXCL|O_WRONLY) creates, and os.remove releases, "
        "this module's own filesystem lock sidecar file (the "
        "`<project>.qzlock`-shaped lock record), never the project or any "
        "dataset source."
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


def _os_open_flags_write(call: ast.Call) -> bool:
    flags: ast.expr | None = call.args[1] if len(call.args) >= 2 else None
    for kw in call.keywords:
        if kw.arg == "flags":
            flags = kw.value
    if flags is None:
        return False
    for sub in ast.walk(flags):
        name: str | None = None
        if isinstance(sub, ast.Attribute):
            name = sub.attr
        elif isinstance(sub, ast.Name):
            name = sub.id
        if name in _OS_OPEN_WRITE_FLAGS:
            return True
    return False


def _write_call_sites(tree: ast.AST) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        is_os_open = isinstance(func, ast.Attribute) and func.attr == "open"
        if is_os_open and _base_name(func.value) == "os":
            if _os_open_flags_write(node):
                found.append((node.lineno, "os.open(O_WRONLY|O_RDWR|O_CREAT...)"))
            continue
        if isinstance(func, ast.Name) and func.id in _OPEN_LIKE_CALLABLES:
            if _open_mode_is_a_write(node):
                found.append((node.lineno, f"{func.id}(...)"))
            continue
        if not isinstance(func, ast.Attribute):
            continue
        attr = func.attr
        base = _base_name(func.value)
        # Review finding on #291: `Path.open(...)`, `h5py.File(path, "w")` and
        # any other open-like METHOD taking a mode literal were invisible to
        # the first version of this scan. Any attribute call named like an
        # opener whose mode literal is a write mode is a write site, whatever
        # the receiver -- the mode literal is the discriminant, so `str`/list
        # methods (which take no mode) cannot false-positive here.
        if attr in _OPEN_LIKE_CALLABLES:
            if _open_mode_is_a_write(node):
                found.append((node.lineno, f".{attr}(...)"))
            continue
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


def test_scan_sees_an_os_open_with_write_flags_but_not_a_read_only_one() -> None:
    # Self-review on #291: `os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)`
    # (desktop_project_lock.py's sidecar creation) is a write site the
    # mode-literal rule cannot see; the flags expression is the discriminant.
    write_tree = ast.parse("import os\nfd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)\n")
    sites = [site for _, site in _write_call_sites(write_tree)]
    assert sites == ["os.open(O_WRONLY|O_RDWR|O_CREAT...)"]
    read_tree = ast.parse("import os\nfd = os.open(p, os.O_RDONLY)\n")
    assert _write_call_sites(read_tree) == []
    kw_tree = ast.parse("import os\nfd = os.open(p, flags=os.O_RDWR)\n")
    assert len(_write_call_sites(kw_tree)) == 1
