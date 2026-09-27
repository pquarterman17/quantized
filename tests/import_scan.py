"""Static name resolution over ``src/quantized`` for the import-time guards.

Shared by ``test_heavy_import_guard.py`` (lazy imports go through
``quantized.heavy_import``; nothing calls into it at module scope) and
``test_render_lock_import_time.py`` (nothing takes the render lock at module
scope). Both need the same two things, done here once:

- **Resolution** of a ``Name``/``Attribute`` expression to a fully qualified
  name through the file's imports (``from X import f as g``, ``import X.Y as
  Z``, ``import X.Y`` -> ``X``), following re-exports between scanned modules
  (``figure_render`` re-exports ``render_lock``'s names).
- **Reachability**: the functions that (transitively, through calls the
  resolver can see) use a set of seed names. Deliberately static and
  approximate -- method calls through ``self`` and dynamic dispatch are not
  followed -- so it errs on the side of a practical, low-noise rule.
"""

from __future__ import annotations

import ast
import functools
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "quantized"


def module_name(path: Path) -> str:
    rel = path.relative_to(SRC.parent).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def package_of(path: Path) -> str:
    """``__package__`` for the module at ``path``."""
    name = module_name(path)
    return name if path.name == "__init__.py" else name.rpartition(".")[0]


def resolve_from(node: ast.ImportFrom, path: Path) -> str:
    if not node.level:
        return node.module or ""
    base = package_of(path).split(".")
    base = base[: len(base) - (node.level - 1)]
    return ".".join([*base, node.module] if node.module else base)


@dataclass
class ModuleInfo:
    name: str
    path: Path
    tree: ast.Module
    imports: dict[str, str] = field(default_factory=dict)  # local -> qualified
    functions: dict[str, ast.FunctionDef | ast.AsyncFunctionDef] = field(default_factory=dict)
    #: per function: (resolved call targets, resolved references) -- memo for
    #: :func:`reaching` (each full walk of ``src`` costs ~1.5 s).
    uses: dict[str, tuple[set[str], set[str]]] = field(default_factory=dict)


def build_info(source: str, path: Path) -> ModuleInfo:
    tree = ast.parse(source, filename=str(path))
    info = ModuleInfo(module_name(path), path, tree)
    for node in ast.walk(tree):  # every import in the file (function-level too)
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    info.imports[alias.asname] = alias.name
                else:
                    top = alias.name.partition(".")[0]
                    info.imports.setdefault(top, top)
        elif isinstance(node, ast.ImportFrom):
            module = resolve_from(node, path)
            for alias in node.names:
                if alias.name != "*":
                    info.imports[alias.asname or alias.name] = f"{module}.{alias.name}"
    for stmt in tree.body:
        if isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef):
            info.functions[stmt.name] = stmt
        elif isinstance(stmt, ast.ClassDef):  # ``Cls(...)`` runs ``__init__``
            for item in stmt.body:
                if isinstance(item, ast.FunctionDef) and item.name == "__init__":
                    info.functions[stmt.name] = item
    return info


def _dotted(expr: ast.expr) -> list[str] | None:
    parts: list[str] = []
    while isinstance(expr, ast.Attribute):
        parts.append(expr.attr)
        expr = expr.value
    if not isinstance(expr, ast.Name):
        return None
    parts.append(expr.id)
    return parts[::-1]


class Index:
    """Every scanned module, by qualified name."""

    def __init__(self, infos: list[ModuleInfo]) -> None:
        self.modules = {i.name: i for i in infos}

    def canonical(self, qualified: str) -> str:
        """Follow re-exports: ``pkg.mod.name`` where ``pkg.mod`` imported
        ``name`` from elsewhere becomes that elsewhere."""
        for _ in range(20):
            module, _, attr = qualified.rpartition(".")
            info = self.modules.get(module)
            if info is None or attr in info.functions or attr not in info.imports:
                return qualified
            qualified = info.imports[attr]
        return qualified

    def resolve(self, expr: ast.expr, info: ModuleInfo) -> str | None:
        parts = _dotted(expr)
        if parts is None:
            return None
        head, rest = parts[0], parts[1:]
        if head in info.functions:
            base = f"{info.name}.{head}"
        elif head in info.imports:
            base = info.imports[head]
        else:
            return None
        return self.canonical(".".join([base, *rest]))


def module_scope_nodes(tree: ast.Module) -> Iterator[ast.AST]:
    """Nodes evaluated when the module body runs: everything except function
    and lambda bodies (decorators and default values DO run at import)."""
    stack: list[ast.AST] = list(tree.body)
    while stack:
        node = stack.pop()
        yield node
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            stack += [*node.decorator_list, *node.args.defaults]
            stack += [d for d in node.args.kw_defaults if d is not None]
        elif isinstance(node, ast.Lambda):
            stack += [*node.args.defaults]
        else:
            stack += list(ast.iter_child_nodes(node))


def reaching(index: Index, seeds: frozenset[str]) -> frozenset[str]:
    """Qualified names of the functions that use a seed -- reference it
    anywhere in their body -- or call a function that does, transitively."""
    calls: dict[str, set[str]] = {}
    found: set[str] = set()
    for info in index.modules.values():
        for fname, fn in info.functions.items():
            if fname not in info.uses:
                info.uses[fname] = _uses(index, info, fn)
            callees, refs = info.uses[fname]
            qual = f"{info.name}.{fname}"
            calls[qual] = callees
            if refs & seeds:
                found.add(qual)
    changed = True
    while changed:
        changed = False
        for qual, callees in calls.items():
            if qual not in found and callees & found:
                found.add(qual)
                changed = True
    return frozenset(found)


def _uses(index: Index, info: ModuleInfo, fn: ast.AST) -> tuple[set[str], set[str]]:
    """(resolved call targets, every resolved Name/Attribute reference)."""
    callees: set[str] = set()
    refs: set[str] = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Call):
            target = index.resolve(node.func, info)
            if target is not None:
                callees.add(target)
        elif isinstance(node, ast.Name | ast.Attribute):
            target = index.resolve(node, info)
            if target is not None:
                refs.add(target)
    return callees, refs


def module_scope_calls(
    index: Index, info: ModuleInfo, targets: frozenset[str],
) -> list[tuple[int, str]]:
    """``(line, target)`` for every call (or ``with``) evaluated at module
    scope whose callee / context manager resolves into ``targets``."""
    hits: list[tuple[int, str]] = []
    for node in module_scope_nodes(info.tree):
        expr: ast.expr | None = None
        if isinstance(node, ast.Call):
            expr = node.func
        elif isinstance(node, ast.withitem):
            expr = node.context_expr
        if expr is None:
            continue
        target = index.resolve(expr, info)
        if target in targets:
            hits.append((getattr(node, "lineno", getattr(expr, "lineno", 0)), target))
    return hits


@functools.cache
def src_infos() -> tuple[ModuleInfo, ...]:
    return tuple(
        build_info(path.read_text(encoding="utf-8"), path) for path in sorted(SRC.rglob("*.py"))
    )


def index_with(*extra: ModuleInfo) -> Index:
    """The ``src`` index, plus synthetic modules (replacing same-named ones)."""
    by_name = {i.name: i for i in src_infos()}
    by_name.update({i.name: i for i in extra})
    return Index(list(by_name.values()))
