# CLAUDE.md: backend tests (`tests/`)

Root rules still apply (see [../CLAUDE.md](../CLAUDE.md)). Porting loop and
mypy tips: [../src/quantized/CLAUDE.md](../src/quantized/CLAUDE.md).

## Golden parity (verification model)

- `tests/golden/`: frozen `quantized_matlab` outputs plus a `manifest.json`
  recording the source commit. Regenerate with
  `tools/matlab/freeze_reference_values.m` / `freeze_calc_values.m` (needs
  `../quantized_matlab`; `setupToolbox` for `+fitting`). Fixtures are
  committed, so CI needs no MATLAB.
- Markers: `golden` (compares against frozen values; `uv run pytest -m golden`),
  `realdata` (needs the local-only instrument corpus; auto-skips in CI).
- Reuse `quantized_matlab/+test_datasets/` as the shared corpus via conftest
  fixtures.
- **MEASURE before loosening a tolerance**; most fits are golden at 1e-9.

## `jsonencode` quirks (the freeze boundary)

- Flattens N x 1 columns to 1-D: `compare_calc` reshapes to the result shape.
- **Cannot serialize** complex or a MATLAB `dictionary`: freeze real-valued
  outputs (`|r|^2`, not complex amplitudes); for dict-typed fields freeze the
  structured outputs and test the raw map in Python.
- Writes `Inf`/`NaN` as `null`: keep freeze inputs finite (the VFT-overflow
  trap), or rely on `compare_calc`'s NaN-equality.
- A 1-element struct array encodes as an **object**, not a list: normalize.
- **Store 2-D arrays as 2-D**, never flattened: MATLAB is column-major, numpy
  row-major, so a flatten + reshape transposes silently.

## Real-data corpus

- `conftest.TEST_DATA_CORPUS` resolves the sibling `<root>/test-data` (walking
  up from worktrees); the `corpus_dir` fixture skips when it is absent.
- Origin realdata tests resolve the corpus ONLY through `tests/origin_corpus.py`
  (`origin_corpus_dir()`, `has_project()` treats a Git LFS pointer as absent).
  Never a private `__file__` walk: 68 tests once skipped silently that way
  (ledger R-27). Expectations are computed at run time; no corpus bytes,
  values or private paths in the repo.

## Determinism and flake evidence ([../docs/testing.md](../docs/testing.md))

- "It passed N times" is weak: 0 failures in n runs bounds the rate at only
  3/n (0/90 could not tell a fix from no fix). **Force the race** instead
  (frontend worked example: the test named "forces the item-22 race" in
  `useFigureBuilder.test.ts`).
- Wall-clock budgets: assert the load-invariant property (which algorithm
  ran, node count); keep the clock as a loose backstop; **never lower an
  existing bound** (`GridViewport.perf` flaked with ~8x headroom).
- Patch the name where it is RESOLVED at call time, not where it is defined;
  better, assert where the behaviour happens and need no patch.
- **The complete raw log is authoritative.** Save the whole output, then
  search the saved file: `uv run pytest ... 2>&1 | tee gate.log` then
  `rg 'FAILED|Error' gate.log`. A `| tail` alone lost a flaky test's name.
- Memory: `uv run pytest -n 4` (not `-n auto`) on shared or small boxes.
