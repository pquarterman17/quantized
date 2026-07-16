---
name: freeze-golden
description: >
  Freeze MATLAB reference values for a case and wire the golden test:
  extend the MATLAB freeze script, run it against ../quantized_matlab,
  write tests/golden/<case>.json, add the manifest entry (source commit +
  tolerances), and add a @pytest.mark.golden test. Use when adding parity
  coverage for a ported function.
---

# freeze-golden

Make a feature's parity checkable. Full model: `.Codex/rules/golden-tests.md`.

## Steps

1. **Pick the case + corpus file.** Use a file from
   `../quantized_matlab/+test_datasets/` (shared corpus). Name the case
   descriptively, e.g. `qd_mpms_mvsh`.
2. **Extend the freeze script** `tools/matlab/freeze_reference_values.m`:
   add `../quantized_matlab` to the path, call the MATLAB reference
   function on the corpus file, and write the result as JSON to
   `tests/golden/<case>.json` (values + relevant metadata).
3. **Run it in MATLAB** (Windows):
   `matlab -batch "cd('<repo>'); run('tools/matlab/freeze_reference_values.m')"`.
   Confirm the JSON wrote. (Don't stack MATLAB runs; verify output.)
4. **Record provenance** in `tests/golden/manifest.json`:
   `source_repo`, `source_commit` (current `../quantized_matlab` HEAD,
   `git -C ../quantized_matlab rev-parse --short HEAD`), `frozen` date,
   and the case's `rtol`/`atol`.
5. **Add the test:** `tests/test_<area>.py` with `@pytest.mark.golden`,
   loading `tests/golden/<case>.json`, running the Python port on the same
   corpus file, and comparing with the manifest tolerances (never `==`).
6. **Run:** `uv run pytest -m golden -k <case>`.

## Notes
- If the file is too large or can't be committed, mark it `realdata`
  (auto-skips) and keep the corpus local under `tests/realdata/`.
- For RNG-based outputs, freeze invariants (shape/summary/convergence),
  not raw values; document why in the test.
- When the upstream formula changes (see parity-monitor), re-run this and
  bump `source_commit`.
