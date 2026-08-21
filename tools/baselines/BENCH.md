# Reproducing the large-map performance numbers

The measured closures in `plans/RELEASE_BLOCKERS.md` and the RC notes
(1M/4M-point 2-D map regrid; #188/#189/#191) were produced with the
commands below. Run them from the repo root. (Sol Day-6 audit item P2-3:
"retain a benchmark command/artifact for the reported 1M/4M map timings".)

## 1. Generate the fixtures (gitignored, ~17 MB)

```bash
uv run python tools/baselines/make_map_fixtures.py
```

Writes `tools/baselines/out/large_rsm_map_{500,1000,2000}.xrdml`
(250k / 1M / 4M points at realistic `.6f` instrument-export precision —
the quantization that #189's detection tolerance is keyed to).

## 2. The instrumented harness (memory + import + regrid)

```bash
uv run python tools/baselines/measure_map_regrid.py
```

NOTE: this harness runs under `tracemalloc`, which inflates wall times
roughly 3–4×. Use it for memory and for relative comparisons on one
machine; do NOT quote its seconds as the user-facing numbers.

## 3. Un-instrumented timings (the quoted numbers)

```bash
uv run python - <<'PY'
import time
from quantized.io.registry import import_auto
from quantized.calc.map import MapState, map_from_datastruct
for name in ("large_rsm_map_500", "large_rsm_map_1000", "large_rsm_map_2000"):
    ds = import_auto(f"tools/baselines/out/{name}.xrdml")
    st = MapState(method="linear", nx=200, ny=200)
    for i in range(3):
        t0 = time.perf_counter()
        map_from_datastruct(ds, 0, 1, 2, st)
        print(f"{name} run{i+1}: {time.perf_counter()-t0:.2f}s")
PY
```

Run 1 is the cold number (includes detection caches, page cache); runs
2–3 are warm. Reference points on the merged tree (2026-08-20/21, a
contended 4-core CI-class box): 250k ≈ 0.5 s; 1M ≈ 3.3 s; 4M ≈ 18.6 s
cold / ~9 s warm. Pre-fix baselines: 29.8 s (1M) / 141.6 s (4M).

## Bounded regression guard

The committed tests assert the load-invariant properties, not seconds
(per `docs/testing.md`): `tests/test_calc_grid_detect.py` pins that
detection engages on `.6f`-quantized grids (#189) and still rejects
log/irregular axes; `frontend/src/lib/…interp2d` tests pin the thinning
threshold's bit-exact passthrough and the point count handed to
`griddata` (#188); `test_calc_interp2d.py`-adjacent call-count spies pin
the single-detection invariant (#191). Wall-clock is deliberately never
asserted in CI.
