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

Plus: a ``with heavy_imports(...)`` body holds only import statements (keeps
the lock scope to imports, and the lock-ordering argument in the helper's
module doc true); ``heavy_imports`` is never used at module scope (a module
body waiting on the lock can deadlock against CPython's per-module import
locks); raw ``importlib.import_module``/``__import__`` calls go through
``heavy_import`` instead; and every allowlist entry still matches a real site.
"""

from __future__ import annotations

import ast
import functools
import sys
from dataclasses import dataclass
from importlib.util import find_spec
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "quantized"
HELPER = "heavy_import.py"

#: ``(path relative to src/quantized, imported module) -> reason``. Only for
#: code that provably never runs on a request or job thread. Add an entry
#: here, with its reason, rather than weakening the rules above.
ALLOWLIST: dict[tuple[str, str], str] = {
    ("cli.py", "quantized.plugins"): "`qz plugin ...` CLI subcommand; main thread, no server",
    ("server_launch.py", "webview"): "launcher, main thread, before the server starts",
    ("server_launch.py", "uvicorn"): "launcher, main thread, before the server starts",
    ("server_launch.py", "quantized.app"): "launcher, main thread, before the server starts",
    ("server_launch.py", "quantized.desktop_bridge"): "launcher, main thread, pre-server",
    ("server_launch.py", "quantized.desktop_consent"): "launcher shutdown path, main thread",
    ("server_launch.py", "quantized.security"): "`qz --dev` launcher, main thread, pre-server",
}


@dataclass(frozen=True)
class _Site:
    path: str
    line: int
    module: str
    covered: bool


def _module_name(path: Path) -> str:
    rel = path.relative_to(SRC.parent).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _resolve_from(node: ast.ImportFrom, path: Path) -> str:
    if not node.level:
        return node.module or ""
    package = _module_name(path).split(".")
    if path.name != "__init__.py":
        package.pop()
    base = package[: len(package) - (node.level - 1)]
    return ".".join([*base, node.module] if node.module else base)


def _package_dirs(module: str) -> list[Path]:
    """Directories of package ``module`` on disk, without importing it."""
    top, *rest = module.split(".")
    spec = find_spec(top) if top not in sys.modules else sys.modules[top].__spec__
    roots = list(spec.submodule_search_locations or []) if spec else []
    return [d for d in (Path(r).joinpath(*rest) for r in roots) if d.is_dir()]


def _is_submodule(package: str, name: str) -> bool:
    for d in _package_dirs(package):
        if (d / f"{name}.py").exists() or (d / name / "__init__.py").exists():
            return True
        if any(d.glob(f"{name}.*.so")) or any(d.glob(f"{name}.*.pyd")):
            return True
    return False


def _module_exists(module: str) -> bool:
    """False only when ``module``'s top-level package is installed but the
    module itself is not on disk (an uninstalled optional dep can't be checked)."""
    parent, _, leaf = module.rpartition(".")
    if not parent:
        return True  # a top-level name: missing means "optional, not installed"
    if not _package_dirs(module.split(".")[0]):
        return True
    return _is_submodule(parent, leaf)


def _is_stdlib(module: str) -> bool:
    return module.split(".")[0] in sys.stdlib_module_names


def _guard_args(item: ast.withitem) -> list[str] | None:
    """The literal module names of a ``heavy_imports(...)`` with-item, else None."""
    call = item.context_expr
    if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name)):
        return None
    if call.func.id != "heavy_imports":
        return None
    return [a.value for a in call.args if isinstance(a, ast.Constant) and isinstance(a.value, str)]


class _Visitor(ast.NodeVisitor):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.rel = path.relative_to(SRC).as_posix()
        self.depth = 0
        self.guards: list[set[str]] = []
        self.sites: list[_Site] = []
        self.problems: list[str] = []

    def _where(self, node: ast.AST) -> str:
        return f"{self.rel}:{getattr(node, 'lineno', '?')}"

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
            args = _guard_args(item)
            if args is None:
                continue
            guarded = True
            call = item.context_expr
            assert isinstance(call, ast.Call)
            if not args or len(args) != len(call.args) or call.keywords:
                self.problems.append(f"{self._where(node)}: heavy_imports() needs literal names")
            names.update(args)
            self.problems += [
                f"{self._where(node)}: {a!r} is not a module (typo? its fast path never fires)"
                for a in args if not _module_exists(a)
            ]
        if not guarded:
            self.generic_visit(node)
            return
        if not self.depth:
            self.problems.append(f"{self._where(node)}: heavy_imports() at module scope")
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
                self.sites.append(
                    _Site(self.rel, node.lineno, module, module in covered)
                )

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._record(node, [alias.name])

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = _resolve_from(node, self.path)
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


def _scan_source(source: str, path: Path) -> tuple[list[_Site], list[str]]:
    visitor = _Visitor(path)
    visitor.visit(ast.parse(source, filename=str(path)))
    return visitor.sites, visitor.problems


@functools.cache
def _scan() -> tuple[list[_Site], list[str]]:
    sites: list[_Site] = []
    problems: list[str] = []
    for path in sorted(SRC.rglob("*.py")):
        if path.relative_to(SRC).as_posix() == HELPER:
            continue  # the helper itself (stdlib-only; its own internals)
        found, issues = _scan_source(path.read_text(encoding="utf-8"), path)
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


def test_guard_scan_sees_the_known_routed_sites() -> None:
    """Tripwire against the scanner silently finding nothing (a moved ``src``
    root, a visitor that stopped descending): these guarded sites exist."""
    sites, _ = _scan()
    covered = {(s.path, s.module) for s in sites if s.covered}
    for expected in [
        ("routes/export_figures_aux.py", "quantized.calc.figure_map"),
        ("calc/figure_facets.py", "quantized.calc.figure_statplots"),
        ("calc/stats_survival.py", "lifelines"),
        ("calc/stats_glm.py", "statsmodels.api"),
        ("calc/sld_formula.py", "periodictable"),
        ("io/netcdf.py", "scipy.io"),
    ]:
        assert expected in covered, (expected, sorted(covered))


def test_guard_flags_each_kind_of_bypass() -> None:
    """The rules themselves, on synthetic source -- so a scanner regression
    shows up as a failure here rather than as a silently green guard."""
    path = SRC / "calc" / "_synthetic_guard_probe.py"
    source = """
from quantized.heavy_import import heavy_imports
import importlib

with heavy_imports("lifelines"):
    import lifelines

def ok():
    with heavy_imports("lifelines", "scipy.io", "scipy"):
        import lifelines
        from scipy import io

def bypass():
    import statsmodels.api

def wrong_name():
    with heavy_imports("pandas"):
        import lifelines

def submodule_unnamed():
    with heavy_imports("scipy"):
        from scipy import io

def not_a_module():
    with heavy_imports("periodictable.formula"):
        from periodictable import formula

def body_not_only_imports():
    with heavy_imports("lifelines"):
        import lifelines
        lifelines.KaplanMeierFitter()

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
    assert "module scope" in joined
    assert "may only hold imports" in joined
    assert "dynamic import" in joined
    assert "'periodictable.formula' is not a module" in joined
    assert not any(s.module == "json" for s in sites)
