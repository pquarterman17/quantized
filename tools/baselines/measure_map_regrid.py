"""P0.4 FINAL residual M1 — isolate the map-viewer's regrid cost from the
browser round trip.

`tools/bench/map_envelope.mjs` measures the REAL app end-to-end (import ->
canvas paint) and found paint times far larger than the backend numbers
already in `docs/performance_envelope.md` (which cover a DIFFERENT code path
-- `calc/figure_map.py`'s matplotlib publication render, Delaunay-triangulated
via `matplotlib.tri`). The interactive Canvas2D map viewer
(`components/Stage/MapStage.tsx`) goes through a separate pipeline instead:
`/api/plot/map` -> `calc/map.map_from_datastruct` -> `calc/interp2d.regrid2d`,
whose default method ("linear", the frontend store's `mapMethod` default)
delegates to `scipy.interpolate.griddata(method="linear")` -- a Delaunay
triangulation of the FULL scattered source point cloud, independent of the
requested OUTPUT grid resolution (the thing the UI's "2-D map" Resolution
dropdown actually controls, capped at 100/200/400).

This script isolates that one call so the two variables (source point count
vs. output grid size) can be told apart, and covers 2000^2 -- crashes the
Playwright harness itself before the app can render it (see the
`docs/envelope/*-map.json` `harness_crash` entry), so this is the only way
to get ANY number for that size.

Usage::

    uv run python tools/baselines/measure_map_regrid.py
    uv run python tools/baselines/measure_map_regrid.py --out result.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import tracemalloc
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from common import DEFAULT_LARGE_DIR  # noqa: E402

from quantized.calc.map import MapState, map_from_datastruct  # noqa: E402
from quantized.io.registry import import_auto  # noqa: E402

SIZES = [500, 1000, 2000]


def measure_one(path: Path, *, nx: int, ny: int, method: str = "linear") -> dict:
    t0 = time.perf_counter()
    ds = import_auto(str(path))
    t1 = time.perf_counter()
    n_points = int(ds.values.shape[0])

    tracemalloc.start()
    state = MapState(method=method, nx=nx, ny=ny)
    map_from_datastruct(ds, 0, 1, 2, state)
    t2 = time.perf_counter()
    _cur, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    return {
        "n_points": n_points,
        "method": method,
        "output_grid": f"{nx}x{ny}",
        "import_s": round(t1 - t0, 3),
        "regrid_s": round(t2 - t1, 3),
        "regrid_peak_mem_mb": round(peak / 1e6, 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--dir", type=Path, default=DEFAULT_LARGE_DIR)
    args = parser.parse_args()

    rows = []
    for n in SIZES:
        path = args.dir / f"large_rsm_map_{n}.xrdml"
        if not path.exists():
            print(f"skip n={n}: {path} missing (run make_map_fixtures.py first)")
            continue
        r = measure_one(path, nx=200, ny=200)
        r["size"] = f"{n}x{n}"
        rows.append(r)
        print(
            f"n={n}: points={r['n_points']} import={r['import_s']}s "
            f"regrid(linear,200x200)={r['regrid_s']}s peak_mem={r['regrid_peak_mem_mb']}MB"
        )

    # Isolate output-grid-size vs input-point-count: same 1000^2 source,
    # nx/ny swept from the UI default to the max the backend route accepts
    # (routes/plot.py MapRequest.nx/ny, ge=2 le=2000) — if regrid_s barely
    # moves, the cost is dominated by triangulating the INPUT, not by the
    # requested output resolution.
    mid_path = args.dir / "large_rsm_map_1000.xrdml"
    res_sweep = []
    if mid_path.exists():
        for res in [200, 2000]:
            r = measure_one(mid_path, nx=res, ny=res)
            r["size"] = "1000x1000 (fixed input, output grid swept)"
            res_sweep.append(r)
            print(
                f"[res sweep] output={res}x{res}: regrid={r['regrid_s']}s "
                f"(points fixed at {r['n_points']})"
            )

    out = {"per_size": rows, "output_resolution_sweep": res_sweep}
    if args.out:
        args.out.write_text(json.dumps(out, indent=2), encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
