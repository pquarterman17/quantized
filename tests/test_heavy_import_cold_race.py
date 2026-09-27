"""Forced cold-process race over the real lazy import paths (BUG-032).

One fresh interpreter (the race needs a ``sys.modules`` that has never seen
matplotlib/lifelines/statsmodels/..., which is never true again inside this
pytest process), started the way the app starts -- ``import quantized.app``
-- and then ONE thread per lazy import path, all released together off a
``threading.Barrier`` (no timing window to miss; ``docs/testing.md``):

- every ``with heavy_imports(...)`` block in ``src/quantized``, executed
  verbatim (lifted out of the source by AST, so a new routed site joins the
  race automatically) with its own module's ``__name__``/``__package__`` (so
  a relative import resolves as it does in place; a ``while_waiting=``
  keyword is dropped, it names a local) -- the export routes' renderer imports, the renderers'
  own lazy cross-imports, and each optional library's import; blocks whose
  library is not installed here are left out;
- real calls through the call paths that reach them: Kaplan-Meier and the
  log-rank test (lifelines), a Poisson GLM (statsmodels), an SLD from a
  formula (periodictable), the mathtext parser (matplotlib), bumps' fitters
  and DREAM modules, and h5py.

Every one of those is individually valid, so ANY exception is the bug. A
``BrokenBarrierError`` is reported as such (a thread never reached the start
line -- a harness problem, never counted as import corruption).

Without the lock the same shape of race fails on every run: measured
2026-09-27 on this interpreter, 9-11 of 19 threads per run, 5/5 runs, with
the matplotlib failures persisting for the life of the process. After the
first attempt at this bug (preloading only the ``calc/figure*`` modules at
startup) it still failed 5/5 runs, in lifelines. See BUG-032.
"""

from __future__ import annotations

import json
import subprocess
import sys

_RACE_SCRIPT = r"""
import ast
import json
import sys
import threading
from importlib.util import find_spec
from pathlib import Path

import numpy as np

import quantized
import quantized.app  # noqa: F401 - the state right after startup
from quantized.heavy_import import heavy_imports

assert "matplotlib" not in sys.modules, "startup must not import matplotlib"
SRC = Path(quantized.__file__).parent


def _guard_names(node):
    for item in node.items:
        call = item.context_expr
        if isinstance(call, ast.Call) and getattr(call.func, "id", None) == "heavy_imports":
            # ``while_waiting=<a local of the enclosing function>`` cannot be
            # evaluated out of context; the race does not need it.
            call.keywords = []
            return [a.value for a in call.args]
    return None


def _module_globals(path):
    # The globals the block would see in its own module: __name__ and
    # __package__ make its relative imports resolve as they do there.
    parts = list(path.relative_to(SRC.parent).with_suffix("").parts)
    is_package = parts[-1] == "__init__"
    if is_package:
        parts.pop()
    name = ".".join(parts)
    package = name if is_package else name.rpartition(".")[0]
    return {"__name__": name, "__package__": package, "heavy_imports": heavy_imports}


tasks = {}
for path in sorted(SRC.rglob("*.py")):
    text = path.read_text(encoding="utf-8")
    if path.name == "heavy_import.py" or "heavy_imports(" not in text:
        continue
    for node in ast.walk(ast.parse(text)):
        names = _guard_names(node) if isinstance(node, ast.With) else None
        if names and all(find_spec(n.split(".")[0]) for n in names):
            code = compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec")
            where = f"{path.relative_to(SRC).as_posix()}:{node.lineno}"
            tasks[where] = lambda code=code, g=_module_globals(path): exec(code, dict(g))


def _km():
    from quantized.calc.stats_survival import kaplan_meier
    kaplan_meier(np.array([1.0, 2.0, 3.0, 4.0, 5.0]), np.array([1.0, 0.0, 1.0, 1.0, 0.0]))


def _logrank():
    from quantized.calc.stats_survival import logrank_test
    t, e = np.array([1.0, 2.0, 3.0, 4.0]), np.array([1.0, 1.0, 0.0, 1.0])
    logrank_test(t, e, t + 0.5, e)


def _glm():
    from quantized.calc.stats_glm import poisson_regression
    x = np.linspace(0.0, 1.0, 12)
    poisson_regression([x], np.array([1, 0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5], dtype=float))


def _sld():
    from quantized.calc.sld_formula import sld_from_formula
    sld_from_formula("SiO2", 2.65)


def _mathtext():
    from quantized.calc.figure_labels import _parser
    _parser()


def _bumps():
    from quantized.calc.dream_seed import seed_reproducible
    from quantized.calc.fit_bumps import _import_bumps
    _import_bumps()
    seed_reproducible()


def _h5py():
    from quantized.io.hdf5 import _import_h5py
    _import_h5py()


for fn, lib in [(_km, "lifelines"), (_logrank, "lifelines"), (_glm, "statsmodels"),
                (_sld, "periodictable"), (_mathtext, "matplotlib"), (_bumps, "bumps"),
                (_h5py, "h5py")]:
    if find_spec(lib):
        tasks[f"call:{fn.__name__}"] = fn

names = sorted(tasks)
barrier = threading.Barrier(len(names))
results = {}


def worker(name):
    try:
        barrier.wait(timeout=60.0)
    except threading.BrokenBarrierError:
        results[name] = "BARRIER"
        return
    try:
        tasks[name]()
        results[name] = "OK"
    except BaseException as exc:  # noqa: BLE001 - deliberately unfiltered
        results[name] = f"{type(exc).__name__}: {exc}"


threads = [threading.Thread(target=worker, args=(n,), daemon=True) for n in names]
for t in threads:
    t.start()
for t in threads:
    t.join(timeout=150.0)
for n in names:
    results.setdefault(n, "HUNG")
print("RESULTS " + json.dumps(results))
"""


def test_concurrent_cold_first_imports_through_heavy_imports_all_succeed() -> None:
    # A first-ever matplotlib import builds its font cache (seconds, once per
    # machine/config dir). Build it HERE, in this already-running process,
    # so the subprocess below -- same environment, same MPLCONFIGDIR -- only
    # ever times imports, never a cold font scan.
    import matplotlib.font_manager  # noqa: F401

    proc = subprocess.run(
        [sys.executable, "-c", _RACE_SCRIPT],
        capture_output=True,
        text=True,
        timeout=240,
    )
    lines = [ln for ln in proc.stdout.splitlines() if ln.startswith("RESULTS ")]
    assert proc.returncode == 0 and lines, (
        f"race subprocess crashed (exit {proc.returncode}):\n{proc.stdout}\n{proc.stderr}"
    )
    results: dict[str, str] = json.loads(lines[-1].removeprefix("RESULTS "))
    harness = {k: v for k, v in results.items() if v in ("BARRIER", "HUNG")}
    assert not harness, f"harness failure, not import corruption: {harness}"
    # Tripwire against a race that silently shrinks to nothing: the export
    # renderers and the non-matplotlib libraries both took part.
    assert sum(k.startswith("routes/export") for k in results) >= 10, sorted(results)
    assert {"call:_km", "call:_glm"} <= results.keys(), sorted(results)
    failures = {k: v for k, v in results.items() if v != "OK"}
    assert not failures, f"{len(failures)}/{len(results)} racing imports failed: {failures}"
