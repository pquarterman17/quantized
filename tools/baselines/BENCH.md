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

## R7: bounded wall-clock guard against a return to pre-sprint numbers

The tests above pin *structure* (fast-path selection, call counts) with no
wall-clock assertion at all, so nothing above fails automatically if the
optimized path regresses back toward the pre-sprint 30-140s numbers without
also breaking one of those structural invariants (e.g. a correct fast-path
call that's simply become O(n^2) internally). `tests/test_perf_map_guard.py`
(new `perfguard` marker, `pyproject.toml`) closes that gap:

- **What it pins.** Generates a 250k-point RSM-mesh fixture in-test (reuses
  `rsm.py`'s `write_xrdml_rsm` at the same 500x500 tier as
  `make_map_fixtures.py`'s smallest size — nothing large is committed), then
  asserts (a) the same structural invariants as above — exactly one
  `detect_regular_grid` call, the `_query_grid_linear` fast path engages
  exactly once, `griddata` is never called — and (b) a loose wall-clock
  backstop: import+regrid measured cold at ~0.58-0.61s on the reference
  devbox (2026-08-23), ceiling set to 6.0s (~10x, at/above R7's required 8x
  floor). The wall-clock assertion's own failure message says to check the
  structural test first — per `docs/testing.md`, the clock is a backstop,
  not the primary signal.
- **Why it's non-blocking (the CI job).** `.github/workflows/ci.yml`'s
  `perf-guard` job runs `uv run pytest -m perfguard -q` with
  `continue-on-error: true` and is deliberately NOT in the required-checks
  set — a noisy shared runner should never be able to block a merge on a
  timing assertion. (The `perfguard`-marked tests still also run inside the
  required `backend` job's ordinary `pytest -q`, same as the pre-existing
  `perf` marker — the ceiling is generous enough that this is not expected
  to be the thing that trips; the dedicated job's job is the artifact below,
  not an extra blocking gate.)
- **How to read the artifact.** Every `perf-guard` run uploads
  `perf-guard-timing` (90-day retention) — `pytest -vv --durations=0`
  output naming the two tests' wall times. Reading a run's artifact over
  time is how a slow, gradual drift back toward the old numbers would show
  up before it ever gets close to the 6.0s ceiling; treat a climbing trend
  as the actionable signal even while the job stays green.
