# Testing conventions

## Flake-fix evidence standards

"I ran it N times and it passed" is weak evidence that a flake is fixed. Use
the **rule of three** as a reality check: zero failures in *n* runs bounds the
true failure rate at only **3/n** with 95% confidence. So 0/90 runs bounds it
at 3.3%.

A worked case from this repo: an item-22 race failed **1 time in 30 runs
(3.3%)** standalone, single-file, single-threaded. After the fix was applied, it passed 0/90. If the
bug had been fully intact, the chance of seeing 0/90 by luck is ~4.7%. The
post-fix 95% upper bound (3.3%) is **identical to the baseline** — the
repetitions could not distinguish "fixed" from "unchanged". Ruling out 3.3%
at 99% confidence would have needed ~136 clean runs.

**Once a race is understood, force it.** The standard is not repetition; it is
a deterministic test that reproduces the race on every run. The item-22 case
uses this pattern: hold the promise unresolved via a deferred value, dispatch
the gesture into that guaranteed-failure window, then resolve and verify the
same gesture succeeds. See
`frontend/src/components/workshops/figurebuilder/useFigureBuilder.test.ts` —
find the test whose name begins "forces the item-22 race" to read a worked
implementation.

**Also watch wall-clock budgets.** Assert the load-invariant property (which
algorithm ran, how many DOM nodes, complexity class); keep a clock only as a
loose order-of-magnitude backstop. Never lower an existing budget.
`GridViewport.perf` measured ~0.3–1.2 s against an 8 s budget (~8x headroom)
and still flaked under concurrent load. Load does not scale predictably — a
worker can stall for whole seconds. An old bound that has never failed is
evidence that bound is survivable; keep it.

## Patch where the name is RESOLVED, not where it is defined

A monkeypatch that passes alone and fails under `pytest -n auto` is usually not
a race at all — it is a patch that never applied, and only appeared to work
because of import ordering.

`from x import f` **binds `f` into the importing module at import time.**
Patching `x.f` afterwards does not change that already-bound name. Whether the
patch lands then depends on whether the importing module had been imported yet
when the patch ran — which single-file runs and sharded parallel runs decide
differently, and neither decides deliberately.

Worked example (2026-09-09, Group L). A route test patched
`quantized.calc.figure_facets.draw_facet_grid` to capture the styles reaching
the facet renderer. But `calc/figure_facets_map.py` does
`from quantized.calc.figure_facets import draw_facet_grid` at module level, so
the running code called the ORIGINAL. Alone the test passed (the map module had
not been imported yet, so its later import picked up the patched attribute);
under `-n auto` its shard imported that module first and the test failed. The
count-only gate line said "1 failed" — the name came from re-running with
`FAILED` in the grep, which is why the raw log is authoritative.

The fix is not to retry or to reorder tests:

- **Patch a name the target resolves at CALL time.** That route imported
  `render_facets_figure` *inside* the function, so patching
  `calc.figure_facets.render_facets_figure` would always apply.
- **Better: assert the claim where it happens, and need no patch.** The
  "a dashed series really draws dashed" assertion belongs in a calc-level test
  that calls the drawing function directly and inspects the matplotlib artist —
  nothing can silently fail to apply.

(The feature those tests covered was itself reverted the same day, for unrelated
reasons — see `plans/BUGS_AND_ISSUES.md` FEATURE-001. The lesson stands on its
own; it is about where to patch, not about that feature.)

Rule of thumb: if a test needs a patch to observe its subject, patch the
narrowest name the subject looks up when it runs, and prefer restructuring the
assertion to need no patch at all.
