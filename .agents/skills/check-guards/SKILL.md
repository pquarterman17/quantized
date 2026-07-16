---
name: check-guards
description: >
  Run quantized's architecture enforcement guards locally before
  committing: the integrity test (pure-layer imports, 500-line ceiling,
  no-GPL), lint/type checks, the ~400-line frontend component scan, and a
  few convention greps. Reports offenders. Use before push / before
  declaring a port done.
---

# check-guards

Fast local quality gate. Mirrors `.Codex/rules/architecture-guards.md`
and CI (W0 #5).

## Run

```bash
# Backend — authoritative invariants
uv run pytest tests/test_repo_integrity.py -q     # pure layers, 500-line, no-GPL
uv run ruff check src tests
uv run mypy src

# Frontend
cd frontend && npm run typecheck && npm test       # includes component-size test
```

## Convention greps the tests can't fully catch

- **eval/exec:** `grep -rnE "\b(eval|exec)\(" src/` → expect none.
- **pure-layer leak:** `grep -rnE "import (fastapi|pydantic|starlette)" src/quantized/{io,calc}/ src/quantized/datastruct.py` → expect none.
- **dual registration:** parsers should appear once in
  `src/quantized/io/registry.py` — grep the parser name across `io/`.
- **fat routes:** skim `src/quantized/routes/` for loops/math/algorithms
  that belong in `calc/` or `io/`.
- **raster-by-default:** export code paths should default to PDF/SVG.

## Output
A pass/fail summary per check with offenders (file:line). If a guard
fails, the fix is to split the module / push logic down a layer /
decompose the component — **never** edit the guard test to pass.
