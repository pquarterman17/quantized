"""Static guard: every lazy (function-level) import in ``src/quantized`` goes
through ``quantized.heavy_import.heavy_imports`` (BUG-032).

A function-level import of a third-party or ``quantized.*`` module runs on
whatever thread first calls that function -- a request's threadpool thread or
a job-queue worker -- so on a cold process two of them can race different
first imports into the same half-initialised package. ``heavy_imports``
serializes those first imports; this test makes sure a new lazy import cannot
quietly bypass it. Stdlib imports are exempt (``sys.stdlib_module_names``).

Rules checked, per function-level ``import``/``from ... import``:

1. It sits lexically inside a function-level ``with heavy_imports(...)`` whose
   arguments are string literals naming the module it imports -- and, for a
   ``from pkg import name`` where ``pkg.name`` is itself a submodule on disk,
   ``pkg.name`` too (``from periodictable import formula`` first-imports
   ``periodictable.formula``, which ``heavy_imports`` must know to wait for).
2. Or its ``(path, module)`` pair is on :data:`ALLOWLIST`, with a reason.

Plus, with the helper recognised under ANY spelling the file's imports allow
(``heavy_imports``, ``from ... import heavy_imports as hi``,
``quantized.heavy_import.heavy_imports``, ``hmod.heavy_imports`` ...): a
``with heavy_imports(...)`` body holds only import statements (keeps the lock
scope to imports, and the lock-ordering argument in the helper's module doc
true), its only keyword is ``while_waiting``; nothing evaluated at module
scope calls ``heavy_imports``/``heavy_import`` or any function that
(transitively, as far as ``import_scan`` can resolve calls) uses them -- a
module body waiting on the lock can deadlock against CPython's per-module
import locks; raw ``importlib.import_module``/``__import__`` calls go through
``heavy_import`` instead; and every allowlist entry still matches a real site.
"""

from __future__ import annotations

import ast
import functools
import sys
import tomllib
from dataclasses import dataclass
from importlib.machinery import (
    BYTECODE_SUFFIXES,
    EXTENSION_SUFFIXES,
    SOURCE_SUFFIXES,
    PathFinder,
)
from pathlib import Path

import import_scan
from import_scan import SRC, Index, ModuleInfo

HELPER = "heavy_import.py"
GUARD = "quantized.heavy_import.heavy_imports"
HELPER_SEEDS = frozenset({GUARD, "quantized.heavy_import.heavy_import"})
PYPROJECT = SRC.parents[1] / "pyproject.toml"

#: ``(path relative to src/quantized, imported module) -> reason``. Only for
#: code that provably never runs on a request or job thread. Add an entry
#: here, with its reason, rather than weakening the rules above.
ALLOWLIST: dict[tuple[str, str], str] = {
    ("cli.py", "quantized.plugins"): "`qz plugin ...` CLI subcommand; main thread, no server",
    ("server_launch.py", "webview"): "launcher, main thread, before the server starts",
    ("server_launch.py", "uvicorn"): "launcher, main thread, before the server starts",
    ("server_launch.py", "quantized.app"): "launcher, main thread, before the server starts",
    ("server_launch.py", "quantized.desktop_bridge"): (
        "launcher, main thread, imported before the server thread starts"
    ),
    ("server_launch.py", "quantized.desktop_consent"): (
        "launcher, main thread, imported before the server thread starts"
    ),
    ("server_launch.py", "quantized.security"): "`qz --dev` launcher, main thread, pre-server",
}

#: Optional-extra top-level packages that may legitimately be absent from the
#: environment running this test (so their submodules cannot be verified on
#: disk) -> the ``pyproject.toml`` extra that installs them. Any OTHER top-level
#: name that is not importable is reported as a typo.
OPTIONAL_TOPS: dict[str, str] = {
    "webview": "desktop",
    "win32com": "origin-com",
    "docx": "office",
    "pptx": "office",
    "lifelines": "stats",
    "statsmodels": "stats",
    "pandas": "stats",  # lifelines' / statsmodels' own dependency
    "bumps": "bumps",
}


@dataclass(frozen=True)
class _Site:
    path: str
    line: int
    module: str
    covered: bool


def _package_dirs(module: str) -> list[Path]:
    """Directories of package ``module`` on disk, without importing it (a
    ``sys.modules`` entry -- real, mocked or ``None`` -- is ignored)."""
    top, *rest = module.split(".")
    spec = PathFinder.find_spec(top)
    roots = list(spec.submodule_search_locations or []) if spec else []
    return [d for d in (Path(r).joinpath(*rest) for r in roots) if d.is_dir()]


_SUFFIXES = (*SOURCE_SUFFIXES, *BYTECODE_SUFFIXES, *EXTENSION_SUFFIXES)


def _is_submodule(package: str, name: str) -> bool:
    """``package.name`` exists on disk as anything the import system would
    load: a regular or namespace subpackage (a directory), a source, a
    sourceless ``.pyc``, or an extension module (``name.so``, ABI-tagged
    ``name.cpython-*.so``, ``name.pyd`` -- this platform's suffixes)."""
    wanted = {name, *(f"{name}{suf}" for suf in _SUFFIXES)}
    for d in _package_dirs(package):
        # Compare listed names exactly: on a case-insensitive filesystem
        # (Windows, default macOS) ``Path("docx/Document.py").is_file()`` is
        # True for ``docx/document.py``, which would misread the attribute
        # import ``from docx import Document`` as a submodule import.
        for entry in d.iterdir():
            if entry.name in wanted and (entry.is_dir() if entry.name == name else entry.is_file()):
                return True
    return False


def _module_exists(module: str) -> bool:
    top, _, _ = module.partition(".")
    if PathFinder.find_spec(top) is None:
        return top in sys.stdlib_module_names or top in OPTIONAL_TOPS
    parent, _, leaf = module.rpartition(".")
    return not parent or _is_submodule(parent, leaf)


def _is_stdlib(module: str) -> bool:
    return module.split(".")[0] in sys.stdlib_module_names


class _Visitor(ast.NodeVisitor):
    def __init__(self, info: ModuleInfo, index: Index) -> None:
        self.info = info
        self.index = index
        self.path = info.path
        self.rel = info.path.relative_to(SRC).as_posix()
        self.depth = 0
        self.guards: list[set[str]] = []
        self.sites: list[_Site] = []
        self.problems: list[str] = []

    def _where(self, node: ast.AST) -> str:
        return f"{self.rel}:{getattr(node, 'lineno', '?')}"

    def _guard_call(self, item: ast.withitem) -> ast.Call | None:
        call = item.context_expr
        if isinstance(call, ast.Call) and self.index.resolve(call.func, self.info) == GUARD:
            return call
        return None

    def visit_FunctionDef(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.depth += 1
        saved, self.guards = self.guards, []  # a nested def runs later, unguarded
        self.generic_visit(node)
        self.guards = saved
        self.depth -= 1

    visit_AsyncFunctionDef = visit_FunctionDef  # type: ignore[assignment]

    def visit_Lambda(self, node: ast.Lambda) -> None:
        self.depth += 1
        self.generic_visit(node)
        self.depth -= 1

    def visit_With(self, node: ast.With) -> None:
        names: set[str] = set()
        guarded = False
        for item in node.items:
            call = self._guard_call(item)
            if call is None:
                continue
            guarded = True
            args = [
                a.value
                for a in call.args
                if isinstance(a, ast.Constant) and isinstance(a.value, str)
            ]
            if not args or len(args) != len(call.args):
                self.problems.append(f"{self._where(node)}: heavy_imports() needs literal names")
            if any(k.arg != "while_waiting" for k in call.keywords):
                self.problems.append(
                    f"{self._where(node)}: heavy_imports()'s only keyword is while_waiting"
                )
            names.update(args)
            self.problems += [
                f"{self._where(node)}: {a!r} is not a module (typo? its fast path never fires)"
                for a in args if not _module_exists(a)
            ]
        if not guarded:
            self.generic_visit(node)
            return
        for stmt in node.body:
            if not isinstance(stmt, ast.Import | ast.ImportFrom):
                self.problems.append(
                    f"{self._where(stmt)}: a heavy_imports() body may only hold imports"
                )
        self.guards.append(names)
        for stmt in node.body:
            self.visit(stmt)
        self.guards.pop()

    def _record(self, node: ast.stmt, needed: list[str]) -> None:
        if not self.depth:
            return
        covered = set().union(*self.guards) if self.guards else set()
        for module in needed:
            if not _is_stdlib(module):
                self.sites.append(_Site(self.rel, node.lineno, module, module in covered))

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._record(node, [alias.name])

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = import_scan.resolve_from(node, self.path)
        needed = [module]
        if not _is_stdlib(module):
            needed += [
                f"{module}.{a.name}" for a in node.names
                if a.name != "*" and _is_submodule(module, a.name)
            ]
        self._record(node, needed)

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        raw = (isinstance(func, ast.Attribute) and func.attr == "import_module") or (
            isinstance(func, ast.Name) and func.id in {"import_module", "__import__"}
        )
        if raw:
            self.problems.append(
                f"{self._where(node)}: dynamic import -- use quantized.heavy_import.heavy_import"
            )
        self.generic_visit(node)


def _helper_users(index: Index) -> frozenset[str]:
    return import_scan.reaching(index, HELPER_SEEDS) | HELPER_SEEDS


def _scan_info(
    info: ModuleInfo, index: Index, users: frozenset[str],
) -> tuple[list[_Site], list[str]]:
    visitor = _Visitor(info, index)
    visitor.visit(info.tree)
    rel = info.path.relative_to(SRC).as_posix()
    visitor.problems += [
        f"{rel}:{line}: module-scope call into {target} (uses quantized.heavy_import)"
        for line, target in import_scan.module_scope_calls(index, info, users)
    ]
    return visitor.sites, visitor.problems


def _scan_source(source: str, path: Path) -> tuple[list[_Site], list[str]]:
    info = import_scan.build_info(source, path)
    index = import_scan.index_with(info)
    return _scan_info(info, index, _helper_users(index))


@functools.cache
def _scan() -> tuple[list[_Site], list[str]]:
    index = import_scan.index_with()
    users = _helper_users(index)
    sites: list[_Site] = []
    problems: list[str] = []
    for info in import_scan.src_infos():
        if info.path.relative_to(SRC).as_posix() == HELPER:
            continue  # the helper itself (stdlib-only; its own internals)
        found, issues = _scan_info(info, index, users)
        sites += found
        problems += issues
    return sites, problems


def test_every_lazy_import_goes_through_heavy_imports() -> None:
    sites, problems = _scan()
    bypass = [
        f"{s.path}:{s.line} imports {s.module!r} outside `with heavy_imports({s.module!r})`"
        for s in sites
        if not s.covered and (s.path, s.module) not in ALLOWLIST
    ]
    assert not problems + bypass, (
        "function-level imports must be serialized by quantized.heavy_import (BUG-032); "
        "wrap them in `with heavy_imports(\"<module>\"):` or, for code that never runs "
        "on a request/job thread, add an ALLOWLIST entry with a reason:\n  "
        + "\n  ".join(problems + bypass)
    )


def test_allowlist_entries_still_match_a_real_unguarded_site() -> None:
    sites, _ = _scan()
    live = {(s.path, s.module) for s in sites if not s.covered}
    stale = sorted(set(ALLOWLIST) - live)
    assert not stale, f"stale ALLOWLIST entries (remove them): {stale}"


def test_optional_tops_name_real_extras() -> None:
    extras = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"][
        "optional-dependencies"
    ]
    assert set(OPTIONAL_TOPS.values()) <= set(extras), sorted(extras)


def test_guard_scan_sees_the_known_routed_sites() -> None:
    """Tripwire against the scanner silently finding nothing (a moved ``src``
    root, a visitor that stopped descending, a resolver that stopped seeing
    the helper): these guarded sites and helper users exist."""
    sites, _ = _scan()
    covered = {(s.path, s.module) for s in sites if s.covered}
    for expected in [
        ("routes/export_figures_aux.py", "quantized.calc.figure_map"),
        ("routes/export_figures_facets.py", "quantized.calc.figure_facets"),
        ("calc/figure_facets.py", "quantized.calc.figure_statplots"),
        ("calc/stats_survival.py", "lifelines"),
        ("calc/stats_glm.py", "statsmodels.api"),
        ("calc/sld_formula.py", "periodictable"),
        ("io/netcdf.py", "scipy.io"),
    ]:
        assert expected in covered, (expected, sorted(covered))
    users = _helper_users(import_scan.index_with())
    assert {
        "quantized.calc.fit_bumps.bumps_available",  # direct
        "quantized.calc.fit_bumps.fit_bumps",  # via _import_bumps
        "quantized.calc.dream_seed.seeded_dream",  # heavy_import(), the function form
    } <= users


def test_module_exists_resolves_real_layouts(tmp_path: Path) -> None:
    assert _module_exists("scipy.io") and _module_exists("json")
    assert not _module_exists("scipy.not_a_module")
    assert not _module_exists("qz_no_such_top_level_package")  # a typo'd top-level
    assert _module_exists("win32com.client")  # optional extra: unverifiable, accepted
    # Every on-disk layout the import system loads, checked against a real
    # package on a temporary sys.path entry.
    pkg = tmp_path / "qz_guard_layouts"
    (pkg / "nspkg").mkdir(parents=True)  # namespace subpackage: no __init__
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    (pkg / "sourceless.pyc").write_bytes(b"")
    # The platform's untagged extension suffix (".so" on POSIX, ".pyd" on Windows).
    (pkg / f"plain{min(EXTENSION_SUFFIXES, key=len)}").write_bytes(b"")
    (pkg / f"tagged{EXTENSION_SUFFIXES[0]}").write_bytes(b"")
    sys.path.insert(0, str(tmp_path))
    try:
        for leaf in ("nspkg", "sourceless", "plain", "tagged"):
            assert _module_exists(f"qz_guard_layouts.{leaf}"), leaf
        assert not _module_exists("qz_guard_layouts.absent")
    finally:
        sys.path.remove(str(tmp_path))


def test_guard_flags_each_kind_of_bypass() -> None:
    """The rules themselves, on synthetic source -- so a scanner regression
    shows up as a failure here rather than as a silently green guard."""
    path = SRC / "calc" / "_synthetic_guard_probe.py"
    source = """
from quantized.heavy_import import heavy_imports
from quantized.heavy_import import heavy_imports as hi_alias
import quantized.heavy_import
import quantized.heavy_import as hmod
import importlib
from quantized.calc.fit_bumps import bumps_available
from quantized.calc import fit_bumps

with heavy_imports("lifelines"):  # L10
    import lifelines

bumps_available()  # L13
_AVAILABLE = fit_bumps.bumps_available()  # L14
hmod.heavy_import("lifelines")  # L15

class Probe:
    FLAG = bumps_available()  # L18: a class body runs at import

def ok():
    with heavy_imports("lifelines", "scipy.io", "scipy"):
        import lifelines
        from scipy import io

def ok_attribute_form():
    with quantized.heavy_import.heavy_imports("scipy.io", "scipy", while_waiting=print):
        from scipy import io
    bumps_available()  # inside a function: fine

def bypass():
    import statsmodels.api

def wrong_name():
    with heavy_imports("pandas"):
        import lifelines

def submodule_unnamed():
    with hmod.heavy_imports("scipy"):
        from scipy import io

def not_a_module():
    with heavy_imports("periodictable.formula"):
        from periodictable import formula

def typo_top_level():
    with heavy_imports("lifelinez"):
        import lifelines

def body_not_only_imports():
    with hi_alias("lifelines"):  # aliased: same body rule
        import lifelines
        lifelines.KaplanMeierFitter()

def bad_keyword():
    with heavy_imports("lifelines", timeout=1):
        import lifelines

def dynamic():
    importlib.import_module("h5py")

def relative():
    from .processing import smooth_data

def stdlib_is_exempt():
    import json
"""
    sites, problems = _scan_source(source, path)
    unguarded = sorted({s.module for s in sites if not s.covered})
    assert unguarded == [
        "lifelines", "periodictable", "quantized.calc.processing", "scipy.io", "statsmodels.api",
    ], unguarded
    joined = "\n".join(problems)
    scope = sorted(
        int(p.split(":")[1]) for p in problems if "module-scope call" in p
    )
    assert scope == [10, 13, 14, 15, 18], (scope, joined)
    assert "may only hold imports" in joined
    assert "only keyword is while_waiting" in joined
    assert "dynamic import" in joined
    assert "'periodictable.formula' is not a module" in joined
    assert "'lifelinez' is not a module" in joined
    assert not any(s.module == "json" for s in sites)
    assert not any(f":{n}:" in p for n in (26, 27, 28) for p in problems), joined  # attr form ok
