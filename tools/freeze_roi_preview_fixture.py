"""Freeze the RSM box/sector/chi cross-boundary parity fixture (RSM_CUTS_PLAN
item 5).

Not a MATLAB freeze (see ``tools/matlab/freeze_calc_values.m`` for that
lineage) -- this fixture proves the OTHER boundary this repo carries: the
Python backend (``calc/boxcut.py``, ``calc/sectorcut.py``) against its
client-side live-preview mirror (``frontend/src/lib/roiMath.ts``). The owner
chose a client-side preview so dragging an ROI box never pays an HTTP
round-trip (see RSM_CUTS_PLAN.md, Resolved decisions rev 2, FINDING 2) --
which means two implementations of one reduction exist on purpose, and this
fixture is the drift guard: it runs the REAL backend once, embeds both the
INPUT columns and the OUTPUT values in one committed JSON file, and neither
``tests/test_roi_preview_parity.py`` (pytest) nor
``frontend/src/lib/roiMath.golden.test.ts`` (vitest) may regenerate it at
test time -- they only read what is committed here. A staleness guard, not a
snapshot: if ``calc/boxcut.py``/``calc/sectorcut.py`` semantics ever change,
the pytest side goes red until this script is re-run and the new JSON is
committed alongside the calc change, in the same spirit as
``tools/matlab/freeze_calc_values.m``'s "{input, params, output}" contract
(see that file's header) but for a Python<->TypeScript boundary instead of a
MATLAB<->Python one.

Two small synthetic datasets (following the project's "fixtures derive from
production" rule -- ``grid_rsm`` is built by
``tests/fixtures/synthetic_rsm.py::make_synthetic_rsm``, the SAME generator
``test_calc_boxcut.py``/``test_calc_sectorcut.py`` use, not a transcribed
copy) feed a case matrix exercising every code path
``frontend/src/lib/roiMath.ts`` mirrors: the box's exact angular grid path
(sum/mean/max, both collapse axes), its Q-space cloud path (sum/mean), a
rotated cut-ruler box, a periodic (pole-figure-style) wrapped band, box_stats
(plain and rotated), and the true-polar sector/chi profiles. Every case's
bounds/bin count were chosen so no output bin is empty -- NOT because an
empty bin is untested behaviour (``box_cut``/``sector_profile``/
``chi_profile`` all define it: sum->0, mean/max->NaN), but because Python's
stdlib ``json`` module writes a bare, non-standard ``NaN`` token that
``JSON.parse`` rejects. The empty-bin/NaN and wrap-seam behaviours are
instead covered by ``roiMath.test.ts``'s hand-built, fixture-independent
cases (mirroring ``test_calc_boxcut.py``/``test_calc_sectorcut.py``'s own
hand-built oracles) -- this fixture's job is proving the two big numeric
pipelines agree, not re-covering every edge case a second time in JSON.

Run::

    uv run python tools/freeze_roi_preview_fixture.py

Regenerate ONLY when ``calc/boxcut.py`` or ``calc/sectorcut.py``'s semantics
deliberately change -- commit the new JSON in the SAME commit as that change
so the parity guard never lands out of sync with the calc it is guarding.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))
sys.path.insert(0, str(REPO_ROOT / "tests"))

import numpy as np  # noqa: E402

from fixtures.synthetic_rsm import make_synthetic_rsm  # noqa: E402
from quantized.calc.boxcut import box_cut, box_stats  # noqa: E402
from quantized.calc.sectorcut import chi_profile, sector_profile  # noqa: E402
from quantized.datastruct import DataStruct  # noqa: E402

OUT_PATH = REPO_ROOT / "frontend" / "src" / "lib" / "roiMath.golden.json"

# Distinct RNG seed from tools/baselines' bands (2001+/2101+) -- this script
# lives outside that family entirely, but picking a documented, unrelated
# seed keeps it obviously deliberate rather than an arbitrary leftover.
_SEED_WRAP_CLOUD = 9001


def _ds_dict(ds: DataStruct) -> dict[str, Any]:
    """DataStruct -> the SAME {time, values, labels, units, metadata} shape
    ``DataStruct.to_dict()``/``DataStruct.from_dict()`` round-trip through --
    both the pytest side (``DataStruct.from_dict``) and the vitest side (pick
    columns by label) read this directly. Asserts finite -- see the module
    docstring's NaN/JSON note; a case whose OUTPUT would contain NaN must
    change its bounds/bins, not slip a non-standard token into the fixture.
    """
    payload = ds.to_dict()
    values = np.asarray(payload["values"], dtype=float)
    if not np.all(np.isfinite(values)):
        raise ValueError(
            "fixture dataset/output contains non-finite values -- JSON can't carry "
            "a bare NaN token across the Python<->TypeScript boundary; narrow the "
            "case's bounds/bins instead (see this script's module docstring)"
        )
    return payload


def _make_wrap_cloud() -> DataStruct:
    """A small periodic-axis scattered cloud (Omega spans the full 0-360 deg
    circle) -- the pole-figure-style ``wrap`` case, same construction as
    ``test_calc_boxcut.py``'s ``test_wrap_selects_same_points_as_a_hand_written_
    wraparound_mask``, just with a fixed seed so the embedded arrays (not the
    seed) are what both languages actually read."""
    rng = np.random.default_rng(_SEED_WRAP_CLOUD)
    n = 300
    tt = rng.uniform(0.0, 5.0, n)
    omega = rng.uniform(0.0, 360.0, n)
    intensity = rng.uniform(1.0, 10.0, n)
    return DataStruct.create(
        np.arange(n, dtype=float),
        np.column_stack([tt, omega, intensity]),
        labels=["2Theta", "Omega", "Intensity"],
        units=["deg", "deg", "counts"],
        metadata={
            "is2D": True,
            "source": "tools/freeze_roi_preview_fixture.py::_make_wrap_cloud",
        },
    )


def build_fixture() -> dict[str, Any]:
    grid_rsm, planted = make_synthetic_rsm(n=24, m=32)
    peak = planted[0]
    wrap_cloud = _make_wrap_cloud()

    datasets = {
        "grid_rsm": _ds_dict(grid_rsm),
        "wrap_cloud": _ds_dict(wrap_cloud),
    }

    # Angular sub-box comfortably inside the mesh (58-64 deg x 28-32 deg) so
    # every case below selects a real, non-degenerate patch of the map.
    ang = {"x_min": 59.0, "x_max": 63.0, "y_min": 29.0, "y_max": 31.0}
    # Q-space box centred on the fixture's own planted peak (never a
    # hardcoded literal -- read off `peak`, the fixtures-derive-from-
    # production rule this repo holds every generator to).
    q_half = 0.3
    qbox = {
        "x_min": peak.qx - q_half,
        "x_max": peak.qx + q_half,
        "y_min": peak.qz - q_half,
        "y_max": peak.qz + q_half,
    }
    wrap_box = {"x_min": 0.0, "x_max": 5.0, "y_min": 350.0, "y_max": 10.0}

    cases: dict[str, dict[str, Any]] = {}

    def add(name: str, fn: str, dataset: str, params: dict[str, Any], out: dict[str, Any]) -> None:
        cases[name] = {"fn": fn, "dataset": dataset, "params": params, "output": out}

    # ── box_cut: exact grid path (angular, angle=0, wrap=None) ─────────────
    p = {**ang, "space": "angular", "collapse": "x", "reduce": "sum"}
    add("box_grid_sum_x", "box_cut", "grid_rsm", p, _ds_dict(box_cut(grid_rsm, **p)))
    p = {**ang, "space": "angular", "collapse": "x", "reduce": "mean"}
    add("box_grid_mean_x", "box_cut", "grid_rsm", p, _ds_dict(box_cut(grid_rsm, **p)))
    p = {**ang, "space": "angular", "collapse": "y", "reduce": "max"}
    add("box_grid_max_y", "box_cut", "grid_rsm", p, _ds_dict(box_cut(grid_rsm, **p)))

    # ── box_cut: cloud path (space="q" always forces it — curvilinear grid) ─
    p = {**qbox, "space": "q", "collapse": "x", "reduce": "sum", "n_bins": 12}
    add("box_cloud_q_sum", "box_cut", "grid_rsm", p, _ds_dict(box_cut(grid_rsm, **p)))
    p = {**qbox, "space": "q", "collapse": "y", "reduce": "mean", "n_bins": 5}
    add("box_cloud_q_mean", "box_cut", "grid_rsm", p, _ds_dict(box_cut(grid_rsm, **p)))

    # ── box_cut: rotated cut-ruler (angle != 0 forces the cloud path even on
    # an angular, grid-shaped dataset) ──────────────────────────────────────
    p = {**ang, "space": "angular", "collapse": "x", "reduce": "sum", "angle": 25.0, "n_bins": 10}
    add("box_rotated_sum", "box_cut", "grid_rsm", p, _ds_dict(box_cut(grid_rsm, **p)))

    # ── box_cut: periodic (pole-figure-style) wrapped band ──────────────────
    p = {**wrap_box, "space": "angular", "collapse": "x", "reduce": "sum", "n_bins": 8, "wrap": "y"}
    add("box_wrap_sum", "box_cut", "wrap_cloud", p, _ds_dict(box_cut(wrap_cloud, **p)))

    # ── box_stats: always cloud (plain, rotated, wrapped) ───────────────────
    p = {**ang, "space": "angular"}
    add("box_stats_plain", "box_stats", "grid_rsm", p, box_stats(grid_rsm, **p))
    p = {**ang, "space": "angular", "angle": 25.0}
    add("box_stats_rotated", "box_stats", "grid_rsm", p, box_stats(grid_rsm, **p))
    p = {**wrap_box, "space": "angular", "wrap": "y"}
    add("box_stats_wrap", "box_stats", "wrap_cloud", p, box_stats(wrap_cloud, **p))

    # ── true-polar: sector / chi (mode="sum" -- see the module docstring's
    # NaN/JSON note for why "mean" isn't exercised here) ────────────────────
    p = {"q_min": 3.8, "q_max": 4.5, "n_bins": 10, "phi_min": 70.0, "phi_max": 110.0, "mode": "sum"}
    add("sector_profile", "sector_profile", "grid_rsm", p, _ds_dict(sector_profile(grid_rsm, **p)))
    p = {"q_min": 3.8, "q_max": 4.5, "n_bins": 8, "phi_min": 70.0, "phi_max": 110.0, "mode": "sum"}
    add("chi_profile", "chi_profile", "grid_rsm", p, _ds_dict(chi_profile(grid_rsm, **p)))

    return {
        "$schema_note": (
            "cases[*].output is a DataStruct dict ({time,values,labels,units,metadata}) "
            "for fn in {box_cut, sector_profile, chi_profile}, or a plain scalar dict "
            "for fn='box_stats' (box_stats has no grid path -- see calc/boxcut.py)."
        ),
        "generator": "tools/freeze_roi_preview_fixture.py",
        "python_fns": [
            "quantized.calc.boxcut.box_cut",
            "quantized.calc.boxcut.box_stats",
            "quantized.calc.sectorcut.sector_profile",
            "quantized.calc.sectorcut.chi_profile",
        ],
        "typescript_fns": [
            "frontend/src/lib/roiMath.ts::boxProfileLocal",
            "frontend/src/lib/roiMath.ts::boxStatsLocal",
            "frontend/src/lib/roiMath.ts::sectorProfileLocal",
            "frontend/src/lib/roiMath.ts::chiProfileLocal",
        ],
        "rtol": 1e-9,
        "note": (
            "RSM_CUTS_PLAN item 5 cross-boundary parity fixture. Regenerate via "
            "`uv run python tools/freeze_roi_preview_fixture.py` ONLY when calc/boxcut.py "
            "or calc/sectorcut.py semantics deliberately change; commit the new JSON in "
            "the same commit as that change. Neither tests/test_roi_preview_parity.py "
            "(pytest) nor roiMath.golden.test.ts (vitest) may regenerate this file at "
            "test run time -- both only read it."
        ),
        "datasets": datasets,
        "cases": cases,
    }


def main() -> None:
    fixture = build_fixture()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    n_cases = len(fixture["cases"])
    n_bytes = OUT_PATH.stat().st_size
    print(f"wrote {n_cases} case(s) to {OUT_PATH} ({n_bytes / 1024:.1f} KiB)")


if __name__ == "__main__":
    main()
