"""Static guard: nothing in ``src/quantized`` takes the render lock at import.

``quantized.heavy_import``'s lock-ordering argument (``RENDER_LOCK`` may be
held while a heavy-import lock is taken, never the reverse) rests on two
facts: a ``heavy_imports`` body only imports (``test_heavy_import_guard``),
and no module body -- which may be running under a heavy-import lock, as the
first import of that module -- takes ``RENDER_LOCK``. This file enforces the
second: no call evaluated at module scope (module body, class bodies,
decorators, default values) resolves to anything that uses ``RENDER_LOCK`` or
``acquire_render_lock`` -- directly (``with RENDER_LOCK:``) or through the
functions that do, transitively (``render_scope``, ``safe_mathtext_label``,
every renderer ...), as far as ``import_scan`` can resolve calls.
"""

from __future__ import annotations

import import_scan
from import_scan import SRC

LOCK_SEEDS = frozenset({
    "quantized.calc.render_lock.RENDER_LOCK",
    "quantized.calc.render_lock.acquire_render_lock",
})


def _lock_users(index: import_scan.Index) -> frozenset[str]:
    return import_scan.reaching(index, LOCK_SEEDS) | LOCK_SEEDS


def _violations(index: import_scan.Index, infos: list[import_scan.ModuleInfo]) -> list[str]:
    users = _lock_users(index)
    return [
        f"{info.path.relative_to(SRC).as_posix()}:{line}: module-scope use of {target}"
        for info in infos
        if info.name != "quantized.calc.render_lock"  # defines the lock
        for line, target in import_scan.module_scope_calls(index, info, users)
    ]


def test_no_module_takes_the_render_lock_at_import_time() -> None:
    index = import_scan.index_with()
    problems = _violations(index, list(import_scan.src_infos()))
    assert not problems, (
        "taking RENDER_LOCK while a module body runs inverts the lock order "
        "quantized.heavy_import documents (render lock, then heavy-import locks):\n  "
        + "\n  ".join(problems)
    )


def test_the_resolver_sees_the_lock_takers() -> None:
    """Tripwire: a resolver that stopped following calls/re-exports would
    make the guard above vacuously green."""
    users = _lock_users(import_scan.index_with())
    assert {
        "quantized.calc.figure_render.render_scope",
        "quantized.calc.figure_labels.safe_mathtext_label",
        "quantized.calc.figure.render_figure",
    } <= users


def test_the_guard_flags_each_import_time_shape() -> None:
    source = """
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc import figure_render
from quantized.calc.render_lock import RENDER_LOCK
import quantized.calc.render_lock as rl

LABEL = safe_mathtext_label("$x$")  # L7

with figure_render.render_scope():  # L9
    pass

with RENDER_LOCK:  # L12
    pass

rl.acquire_render_lock()  # L15

class Panel:
    TITLE = safe_mathtext_label("t")  # L18

def fine():
    return safe_mathtext_label("$y$")

@staticmethod
def default_value(label=safe_mathtext_label("d")):  # L24
    return label
"""
    path = SRC / "calc" / "_synthetic_render_lock_probe.py"
    info = import_scan.build_info(source, path)
    index = import_scan.index_with(info)
    lines = sorted(int(p.split(":")[1]) for p in _violations(index, [info]))
    assert lines == [7, 9, 12, 15, 18, 24], lines
