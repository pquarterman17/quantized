---
name: port-feature
description: >
  Scaffold the port of one quantized_matlab feature into quantized: locate
  the MATLAB source, create the pure io/ or calc/ module (<500 lines), a
  thin route if needed, and a golden-test stub — following the porting
  workflow. Use when starting a new PORT_CHECKLIST item. Optionally pass
  the feature name or checklist line.
---

# port-feature

Scaffold a clean, layer-correct port of one feature. Full rules:
`.Codex/rules/porting-workflow.md` and `.Codex/rules/architecture-guards.md`.

## Steps

1. **Identify** the feature + its MATLAB source from
   `plans/PORT_CHECKLIST.md` (e.g. `+parser/importQDVSM.m`). If the user
   named a feature, find its checklist line.
2. **Read** the MATLAB source and its test(s) in
   `../quantized_matlab/tests/`. Note edge cases + physics constants
   (copy verbatim; annotate calibrated values do-not-fix).
3. **Peek** at `../thin_film_toolkit/backend/thin_film_toolkit/` for an
   existing Python draft (head start, not truth).
4. **Create the pure module:**
   - parser/reader/writer → `src/quantized/io/<name>.py`
   - other math → `src/quantized/calc/<name>.py`
   - in → ndarray/`DataStruct`, out → results. No fastapi/pydantic imports.
   - keep it <500 lines; return `DataStruct` where applicable.
5. **Register** (parsers only): add ONE line to `src/quantized/io/registry.py`
   (+ a content sniffer if the extension is ambiguous).
6. **Thin route** (only if the UI needs it): `src/quantized/routes/<domain>.py`
   — pydantic schema here, validate → call → serialize. Long work → jobs queue.
7. **Golden stub:** create `tests/test_<area>.py` with a
   `@pytest.mark.golden` test; then invoke the `freeze-golden` skill (or
   parity-verifier agent) to populate `tests/golden/`.
8. **Verify:** `uv run pytest -k <area>` and
   `uv run pytest tests/test_repo_integrity.py`.
9. **Check the box** in `PORT_CHECKLIST.md` ONLY when ported AND
   golden-verified.

## Output
List the files created, the registry/route wiring, and the next action
(freeze golden values). Don't tick the checklist until parity passes.
