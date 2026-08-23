"""Bounded performance-regression guard for the large-2-D-map import+regrid
path (POST_SPRINT_INDEPENDENT_REVIEW.md R7).

The functional pins for this path already exist and are NOT duplicated here:
``tests/test_calc_grid_detect.py`` (regular-grid detection itself),
``tests/test_calc_interp2d.py`` (the ``detect_regular_grid`` double-call
dedupe / single-detection-call invariant, thinning passthrough), and
``frontend/src/lib/…interp2d`` tests (thinning threshold bit-exact
passthrough). What was missing per R7: protection against the *optimized*
path becoming dramatically slower again -- the pre-sprint numbers were
30-140s for 1M/4M points (see ``tools/baselines/BENCH.md``); post-sprint,
~0.5-18s.

This module is deliberately SEPARATE from ``tests/test_perf_baselines.py``
(``perf`` marker, PORT_PLAN W9 #53's general wall-time tripwires) and uses
its own ``perfguard`` marker: it is the R7-specific large-map guard, wired
to its own non-blocking CI job (``.github/workflows/ci.yml``'s
``perf-guard``) that uploads timing output as an artifact, whereas ``perf``
runs inside the ordinary required ``pytest -q`` gate.

Generates a SMALL-but-representative fixture in-test at the 250k-point tier
(500x500 -- the smallest of ``tools/baselines/make_map_fixtures.py``'s three
sizes; reuses that script's own generator, ``tools/baselines/rsm.py``'s
``write_xrdml_rsm``, rather than re-deriving the XRDML RSM-mesh format).
Nothing is committed to disk -- the fixture is written to ``tmp_path`` fresh
on every run, unlike the gitignored-but-persistent ``tools/baselines/out/``
files the manual BENCH.md walkthrough uses.

Per ``docs/testing.md``: assert the load-invariant STRUCTURAL properties
(which path ran, how many times) and keep wall-clock as a loose backstop
only, generously bounded, and never lowered once set.
"""

from __future__ import annotations

import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

# tools/baselines/rsm.py is a flat-import script module (imports `from
# common import write_text` assuming its own directory is on sys.path, the
# way `uv run python tools/baselines/make_map_fixtures.py` provides for
# free) -- add that directory once, at import time, so this test can reuse
# its generator instead of re-deriving the XRDML RSM-mesh format.
_BASELINES_DIR = Path(__file__).resolve().parent.parent / "tools" / "baselines"
if str(_BASELINES_DIR) not in sys.path:
    sys.path.insert(0, str(_BASELINES_DIR))

from rsm import write_xrdml_rsm  # noqa: E402 -- needs the sys.path insert above

import quantized.calc.interp2d as interp2d_mod  # noqa: E402
from quantized.calc.map import MapState, map_from_datastruct  # noqa: E402
from quantized.io.registry import import_auto  # noqa: E402

pytestmark = pytest.mark.perfguard

# Same generation params as tools/baselines/large.py's `write_large_map` /
# make_map_fixtures.py's SIZES[0] tier, just not written under the
# gitignored, persistent tools/baselines/out/ directory.
_N = 500  # 500x500 = 250,000 points -- the "250k tier" named in the R7 task.
_SEED = 90210  # distinct band from make_fixtures.py/make_map_fixtures.py's seeds.


def _write_fixture(path: Path) -> None:
    write_xrdml_rsm(
        path,
        seed=_SEED,
        n_omega=_N,
        n_tt=_N,
        tt_start=40.0,
        tt_end=44.0,
        omega_start=20.5,
        omega_end=21.3,
    )


@pytest.fixture
def map_fixture_path(tmp_path: Path) -> Path:
    """A fresh 250k-point RSM-mesh XRDML file, generated (untimed) per test."""
    path = tmp_path / "perfguard_rsm_250k.xrdml"
    _write_fixture(path)
    return path


def _call_spy(monkeypatch: pytest.MonkeyPatch, module: Any, name: str) -> list[int]:
    """Wrap ``module.name`` to record one entry per call, delegating to the
    real implementation. Mirrors ``test_calc_interp2d.py``'s ``_spy_detect``."""
    calls: list[int] = []
    real = getattr(module, name)

    def _wrapped(*args: Any, **kwargs: Any) -> Any:
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(module, name, _wrapped)
    return calls


@pytest.fixture
def spies(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, list[int]]]:
    """Structural spies on the three interp2d entry points that distinguish
    "took the regular-grid fast path, once" from every regression this guard
    cares about: falling back to griddata/Qhull, or re-detecting twice (the
    RELEASE_BLOCKERS.md dedupe regression that motivated this whole path's
    speedup in the first place -- see interp2d.py's module docstring)."""
    yield {
        "detect": _call_spy(monkeypatch, interp2d_mod, "detect_regular_grid"),
        "fast_path": _call_spy(monkeypatch, interp2d_mod, "_query_grid_linear"),
        "griddata": _call_spy(monkeypatch, interp2d_mod, "griddata"),
    }


def test_large_map_takes_the_regular_grid_fast_path_exactly_once(
    map_fixture_path: Path, spies: dict[str, list[int]]
) -> None:
    """Structural invariants for the 250k-point regular-grid map path:
    ``MapState``'s default ``method="auto"`` resolves to "linear" (point
    count alone clears ``_AUTO_LINEAR_MIN_POINTS``, so this doesn't even
    reach ``_resolve_auto_method``'s own ``detect_regular_grid`` probe --
    see calc/map.py), ``regrid2d`` detects the regular grid, threads it
    through as ``grid_hint`` (never re-detecting), and dispatches to the
    O(log n)-per-query ``_query_grid_linear`` fast path -- never falling
    back to ``griddata``'s O(n log n) Qhull triangulation on the full cloud.
    """
    ds = import_auto(map_fixture_path)
    result = map_from_datastruct(ds, 0, 1, 2, MapState(nx=200, ny=200))

    assert result.z_grid.shape == (200, 200)
    assert len(spies["detect"]) == 1, (
        f"expected exactly 1 detect_regular_grid call, got {len(spies['detect'])} "
        "-- see tests/test_calc_interp2d.py's dedupe tests / interp2d.py's "
        "module docstring for the double-call regression this guards against"
    )
    assert len(spies["fast_path"]) == 1, (
        "regular-grid fast path (_query_grid_linear) did not engage exactly "
        f"once (got {len(spies['fast_path'])}) -- a regular 500x500 grid must "
        "take this path, not fall back to scattered interpolation"
    )
    assert len(spies["griddata"]) == 0, (
        "fell back to griddata (Qhull triangulation) instead of the "
        "regular-grid fast path -- this is the exact regression class "
        "(pre-sprint 30-140s on 1M/4M points) R7 exists to catch"
    )


def test_large_map_import_and_regrid_wall_clock_backstop(map_fixture_path: Path) -> None:
    """Loose wall-clock backstop only -- see docs/testing.md: assert the
    load-invariant property first (the sibling test above), keep the clock
    as a secondary, generously-bounded tripwire.

    Measured cold (fresh interpreter, no warm-up, 3 runs on this devbox,
    2026-08-23): 0.58s / 0.58s / 0.61s for import_auto + map_from_datastruct
    on this exact 250k-point fixture. Ceiling = 8x the highest of those
    (0.61 * 8 = 4.9s), rounded up generously to 6.0s per the R7 task's
    instruction and the GridViewport.perf lesson in docs/testing.md (an
    old bound that has never failed is evidence it's survivable -- widen
    up front rather than trim later). A CI-class shared runner or a real
    regression are the only things this should ever catch; if it trips,
    the first suspect is a structural change (see the sibling test in this
    module, plus tests/test_calc_grid_detect.py and
    tests/test_calc_interp2d.py's dedupe tests), NOT ordinary machine noise.
    """
    ceiling_s = 6.0

    t0 = time.perf_counter()
    ds = import_auto(map_fixture_path)
    map_from_datastruct(ds, 0, 1, 2, MapState(nx=200, ny=200))
    elapsed = time.perf_counter() - t0

    assert elapsed < ceiling_s, (
        f"large-map import+regrid took {elapsed:.2f}s against an "
        f"{ceiling_s:.1f}s ceiling (8x+ the 0.61s measured cold baseline). "
        "CHECK FOR A STRUCTURAL REGRESSION FIRST -- run "
        "test_large_map_takes_the_regular_grid_fast_path_exactly_once in "
        "this file to see whether the fast path stopped engaging, the "
        "detection call count doubled, or it fell back to griddata -- "
        "before assuming this is a real, otherwise-unexplained slowdown."
    )
