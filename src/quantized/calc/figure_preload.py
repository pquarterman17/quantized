"""Eagerly, single-threadedly import every renderer module (2026-09-27 bug).

Why this exists: every export route (``routes/export*.py``) reaches its
renderer through a FUNCTION-LEVEL lazy import --
``from quantized.calc.figure_map import render_map_figure`` and friends --
specifically so a caller that never renders (a parser-only test, a CLI
subcommand that only touches ``io/``/``calc``'s non-plotting pieces) never
pays matplotlib's heavy import cost. That is fine for a SINGLE request. It is
not fine on a cold process: FastAPI runs the sync export routes in a
threadpool, so a burst of concurrent first-ever exports triggers several
different renderer modules' FIRST import from several threads at once.

CPython's import system serializes concurrent imports of the SAME module
name (a per-module lock), but it does **not** serialize imports of
*different* module names that race on shared, not-yet-finished state --
here, matplotlib's own package ``__init__`` (``matplotlib.get_data_path`` is
set near the end of it) and heavily cross-imported submodules such as
``matplotlib.transforms``/``matplotlib.artist``. Measured on this repo's
main (post the render-lock fix in ``calc.figure_render``, which serializes
*renders* but not *imports*): 16 threads each importing a different renderer
module for the first time, released together off a ``threading.Barrier`` in
a fresh interpreter, failed 15/16 with ``ImportError: cannot import name
'Transform' from partially initialized module 'matplotlib.transforms'``,
``AttributeError: module 'matplotlib' has no attribute 'get_data_path'``,
plain ``NameError``s inside a module still mid-import, and the same shapes
against ``quantized.calc.figure*`` modules themselves (whichever module a
slower thread was mid-executing when a faster thread's *different*
top-level import statement grabbed the same partially-built
``sys.modules`` entry) -- the failure text is whatever line each thread
happened to be on, not a fixed set of strings -- reproduced in 10/10 cold runs
(``tests/test_figure_cold_import_race.py``). Every renderer import failure
after that point stays permanent for the process: the partially-initialized
module is cached in ``sys.modules`` and never re-executed.

The fix is structural, not a lock: import every renderer module ONCE,
single-threaded, before the process starts serving requests. Once a module
has finished importing, ``sys.modules`` serves the cached module to every
later importer (including the lazy ``from quantized.calc.figure_map import
...`` lines already in the routes) with no re-execution and no race, exactly
like any other already-imported module. ``quantized.app``'s lifespan calls
:func:`preload_renderer_modules` (off the event loop, via
``asyncio.to_thread`` -- importing ~31 modules pulls in matplotlib's Agg
backend and costs about a second, worth not blocking on) before it yields,
i.e. before the ASGI server accepts its first connection, so there is no
request thread yet to race against it.

Pure layer: no fastapi/pydantic/starlette. Discovers modules by walking the
``quantized.calc`` package rather than hardcoding a list, so a new
``figure_*.py`` renderer is preloaded automatically -- the ~31-module count
above is illustrative, not a value this module pins.
"""

from __future__ import annotations

import importlib
import pkgutil

import quantized.calc as _calc_pkg

__all__ = ["iter_renderer_module_names", "preload_renderer_modules"]


def iter_renderer_module_names() -> list[str]:
    """Every ``quantized.calc.figure*`` submodule's dotted name, sorted.

    Matches ``figure.py``, ``figure_render.py``, ``figure_page_facets.py``,
    etc. -- every module the export routes' lazy imports (and the renderer
    modules' own lazy, circular-import-avoiding cross-imports) can trigger.
    Deliberately does NOT reach into ``io/origin_project``'s unrelated
    ``figure_geometry.py``/``figure_layers.py``/``figure_text.py`` (Origin
    project metadata, no matplotlib import at all) -- ``quantized.calc``'s
    own ``__path__`` is the whole search root.
    """
    return sorted(
        info.name
        for info in pkgutil.iter_modules(_calc_pkg.__path__, prefix="quantized.calc.")
        if info.name.rsplit(".", 1)[-1].startswith("figure")
    )


def preload_renderer_modules() -> list[str]:
    """Import every renderer module once, in this thread, sequentially.

    Idempotent past the first call (``importlib.import_module`` on an
    already-imported name is a ``sys.modules`` lookup, never a re-execution),
    but MUST be called from a single thread before any other thread performs
    its own first import of one of these modules -- calling it concurrently
    from multiple threads is exactly the race it exists to close. The only
    caller is ``quantized.app``'s startup lifespan, which runs to completion
    before the ASGI server accepts its first connection, so no request
    thread exists yet to race against.

    Returns the sorted module names it imported (also handed back for a test
    to assert against, and for a startup log line if one is ever wanted).
    """
    names = iter_renderer_module_names()
    for name in names:
        importlib.import_module(name)
    return names
