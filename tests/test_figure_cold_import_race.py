"""Cold-process concurrent-export import race (2026-09-27 bug, follow-on to
the render-lock fix in PR #448: ``calc/render_lock.py`` / ``calc/figure_render.py``).

``routes/export*.py`` reach every renderer through a FUNCTION-LEVEL lazy
import (``from quantized.calc.figure_map import render_map_figure``, etc.,
each explicitly commented ``# lazy: matplotlib is heavy``). FastAPI runs the
sync export routes in a threadpool, so on a freshly started process a burst
of concurrent *first-ever* exports can trigger several different renderer
modules' FIRST import from several threads at once. The render lock
(``RENDER_LOCK``) that PR #448 added serializes *renders*; it does nothing
for *imports* that happen before a render even starts.

Every test here runs in a **subprocess with a fresh interpreter** — the
race depends on ``sys.modules`` genuinely not containing these modules yet,
which is never true again once any earlier test in this process (or an
xdist worker sibling) has imported one of them.

- ``test_unguarded_concurrent_first_import_corrupts_modules_on_this_interpreter``
  FORCES the underlying hazard with a ``threading.Barrier`` (not a timing
  guess) and demonstrates it is real on the current interpreter + matplotlib
  version, not hypothetical (``docs/testing.md``: force the race). It
  bypasses the fix on purpose (no preload) to produce the evidence quoted in
  ``calc.figure_preload``'s module doc.
- ``test_preload_then_concurrent_first_import_is_safe`` forces the SAME
  barrier race but after calling
  ``quantized.calc.figure_preload.preload_renderer_modules()`` first — the
  exact thing ``quantized.app``'s startup lifespan now does before it
  yields — and must pass with ZERO failures, reliably, every run.
- ``test_app_lifespan_preloads_renderer_modules_before_serving`` checks the
  actual production wiring: entering ``TestClient(app)`` as a context
  manager (running the real lifespan) leaves every renderer module already
  imported before any request is served.
- ``test_concurrent_cold_export_requests_all_succeed`` is the closest
  reproduction of the ORIGINAL bug report: a genuinely cold app, started via
  the real lifespan, immediately hit with concurrent HTTP requests against
  four DIFFERENT export endpoints (four different renderer modules' first
  import) — must all return 200.
"""

from __future__ import annotations

import json
import subprocess
import sys

# The exact statements the routes use (routes/export_figures.py,
# routes/export_figures_aux.py, routes/export_multivar.py,
# routes/export_statplots.py, routes/export_page.py) -- one distinct
# renderer module's first import per thread, mirroring 16 concurrent
# first-ever export requests hitting 16 different endpoints on a cold
# process.
_IMPORT_STATEMENTS = [
    "from quantized.calc.figure_map import render_map_figure",
    "from quantized.calc.figure_corner import render_corner_figure",
    "from quantized.calc.figure_ternary import render_ternary_figure",
    "from quantized.calc.figure_field import render_field_figure",
    "from quantized.calc.figure_multivar import render_correlation_heatmap_figure",
    "from quantized.calc.figure_multivar import render_splom_figure",
    "from quantized.calc.figure_multivar import render_pca_figure",
    "from quantized.calc.figure_multivar import render_pca_scree_figure",
    "from quantized.calc.figure_facets import render_stat_facets_figure",
    "from quantized.calc.figure_statplots import render_statplot_figure",
    "from quantized.calc.figure_facets import render_categorical_facets_figure",
    "from quantized.calc.figure_categorical import render_categorical_figure",
    "from quantized.calc.figure_group_styles import expand_grouped_series_styles",
    "from quantized.calc.figure_facets import render_facets_figure",
    "from quantized.calc.figure_facets_map import render_facets_figure_map",
    "from quantized.calc.figure import render_figure_map",
]
_N = len(_IMPORT_STATEMENTS)

# Corruption shapes observed reproducing this bug (module doc in
# calc/figure_preload.py has the full transcript): ``ImportError: cannot
# import name ... from partially initialized module ...``,
# ``AttributeError: module 'matplotlib' has no attribute 'get_data_path'``,
# and even a plain ``NameError`` (a slower thread mid-executing a module
# whose namespace a faster thread's *different* top-level import of the
# SAME name grabbed out of ``sys.modules`` before it finished populating --
# the failure text is whatever line each thread happened to be on, not a
# fixed set of strings). Each of these 16 import statements is individually
# valid -- run sequentially, single-threaded, all 16 succeed (this is exactly
# what preload does) -- so ANY exception here, whatever its text, is
# corruption evidence; there is nothing else it could be.

_BARRIER_RACE_SCRIPT = r"""
import json
import sys
import threading

IMPORT_STATEMENTS = json.loads(sys.argv[2])
N = len(IMPORT_STATEMENTS)

if sys.argv[1] == "preload":
    from quantized.calc.figure_preload import preload_renderer_modules
    preload_renderer_modules()

barrier = threading.Barrier(N)
results = [None] * N


def worker(i):
    barrier.wait(timeout=10.0)
    try:
        exec(IMPORT_STATEMENTS[i], {})
        results[i] = "OK"
    except BaseException as exc:  # noqa: BLE001 - deliberately unfiltered
        results[i] = f"{type(exc).__name__}: {exc}"


threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
for t in threads:
    t.start()
for t in threads:
    t.join(timeout=30.0)

print(json.dumps(results))
"""


def _run_barrier_race(preload_first: bool) -> list[str]:
    result = subprocess.run(
        [sys.executable, "-c", _BARRIER_RACE_SCRIPT,
         "preload" if preload_first else "nopreload", json.dumps(_IMPORT_STATEMENTS)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, (
        f"race-forcing subprocess itself crashed (not a per-thread import "
        f"failure -- those are caught): {result.stdout}\n{result.stderr}"
    )
    return list(json.loads(result.stdout.strip().splitlines()[-1]))


def test_unguarded_concurrent_first_import_corrupts_modules_on_this_interpreter() -> None:
    """Evidence, not a hypothetical: force 16 threads to each perform a
    DIFFERENT renderer module's first import at the exact same instant (a
    ``threading.Barrier``, released only once every thread has reached it --
    no timing window to miss) on a fresh interpreter with no preload. Measured
    10/10 cold subprocess runs reproducing this during development, 15/16
    threads failing per run, with exactly the three error shapes in
    ``_CORRUPTION_MARKERS`` (``ImportError: cannot import name 'Transform'
    from partially initialized module 'matplotlib.transforms'``,
    ``AttributeError: module 'matplotlib' has no attribute 'get_data_path'``,
    and the same against ``quantized.calc.figure*`` modules themselves).

    Asserts a conservative quarter of the threads (4/16) raised -- far below
    the ~15/16 observed, to stay robust to a slower/CI box's scheduler giving
    the barrier-released threads less overlap, while still being a
    meaningless-to-pass-by-accident bar.
    """
    results = _run_barrier_race(preload_first=False)
    assert len(results) == _N
    failures = [r for r in results if r != "OK"]
    assert len(failures) >= _N // 4, (
        f"expected the cold unguarded concurrent-first-import race to corrupt at least "
        f"{_N // 4}/{_N} threads (evidence this hazard is real on this interpreter), got "
        f"{len(failures)}/{_N}: {results}"
    )


def test_preload_then_concurrent_first_import_is_safe() -> None:
    """The fix, forced with the SAME barrier race: call
    ``preload_renderer_modules()`` once, single-threaded (exactly what
    ``quantized.app``'s startup lifespan now does before it yields -- see
    ``calc.figure_preload``), THEN release the same 16 threads on the same
    barrier. Every renderer module is already a completed ``sys.modules``
    entry by then, so each thread's "first" import is really a cache lookup
    -- must be zero failures, every run, not "usually zero"."""
    results = _run_barrier_race(preload_first=True)
    assert results == ["OK"] * _N, results


def test_app_lifespan_preloads_renderer_modules_before_serving() -> None:
    """Wiring check: the real ``quantized.app`` lifespan actually calls the
    preload before yielding (i.e. before the ASGI server would accept its
    first connection) -- not just that the barrier race above is safe in the
    abstract. Fresh interpreter so ``sys.modules`` starts genuinely empty of
    these names."""
    script = (
        "import sys\n"
        "from fastapi.testclient import TestClient\n"
        "from quantized.app import app\n"
        "with TestClient(app):\n"
        "    pass\n"
        "print(sorted(m for m in sys.modules if m.startswith('quantized.calc.figure')))\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=60, check=True
    )
    preloaded = result.stdout.strip().splitlines()[-1]
    for name in ("quantized.calc.figure_map", "quantized.calc.figure_corner",
                 "quantized.calc.figure_statplots", "quantized.calc.figure_categorical",
                 "quantized.calc.figure_multivar", "quantized.calc.figure_facets_map"):
        assert f"'{name}'" in preloaded, (
            f"{name} was not preloaded by app startup: {preloaded}\n{result.stderr}"
        )


_COLD_HTTP_SCRIPT = r"""
import json
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.security import ALLOWED_HOSTS

# This subprocess has none of conftest.py's fixtures -- TestClient sends
# ``Host: testserver``, so allow it here too (conftest.py's own comment
# explains why: app.py's DNS-rebinding guard only allows the app's own
# hostnames otherwise).
ALLOWED_HOSTS.add("testserver")


def _xrd_dataset():
    return {
        "time": [10.0, 10.02, 10.04, 10.06],
        "values": [[100.0], [120.0], [95.0], [110.0]],
        "labels": ["Intensity"],
        "units": ["cps"],
        "metadata": {"x_column_name": "2Theta", "x_column_unit": "deg"},
    }


def _demo_map():
    x = np.linspace(-2.0, 2.0, 16)
    y = np.linspace(-1.0, 3.0, 12)
    xg, yg = np.meshgrid(x, y)
    z = 100.0 * np.exp(-(xg**2 + (yg - 1.0) ** 2))
    return {"x_axis": x.tolist(), "y_axis": y.tolist(), "z_grid": z.tolist(),
            "kind": "contourf", "fmt": "png"}


def _demo_corner():
    rng = np.random.default_rng(3)
    samples = rng.normal(0.0, 1.0, size=(200, 2)).tolist()
    return {"samples": samples, "param_names": ["p0", "p1"], "fmt": "png"}


REQUESTS = [
    ("/api/export/figure", {"dataset": _xrd_dataset(), "fmt": "png"}),
    ("/api/export/map-figure", _demo_map()),
    ("/api/export/statplot-figure",
     {"kind": "histogram", "data": [1.0, 2.0, 2.5, 3.0, 3.5, 4.0], "fmt": "png"}),
    ("/api/export/corner-figure", _demo_corner()),
]

with TestClient(app) as client:
    def post(i):
        url, body = REQUESTS[i % len(REQUESTS)]
        resp = client.post(url, json=body)
        return url, resp.status_code, resp.text[:200]

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(post, range(8)))

print(json.dumps(results))
"""


def test_concurrent_cold_export_requests_all_succeed() -> None:
    """Closest reproduction of the original bug report: a genuinely cold
    process, started through the real ``quantized.app`` lifespan, immediately
    hit with 8 concurrent HTTP requests cycling across 4 DIFFERENT export
    endpoints (4 different renderer modules) -- each endpoint's OWN
    lazy import is the first-ever import of that module, all landing while
    the others are also mid-request. Must all be HTTP 200."""
    result = subprocess.run(
        [sys.executable, "-c", _COLD_HTTP_SCRIPT], capture_output=True, text=True, timeout=60
    )
    assert result.returncode == 0, result.stdout + result.stderr
    results = json.loads(result.stdout.strip().splitlines()[-1])
    assert len(results) == 8
    failures = [(url, status, body) for url, status, body in results if status != 200]
    assert not failures, f"cold concurrent export request(s) failed: {failures}"
