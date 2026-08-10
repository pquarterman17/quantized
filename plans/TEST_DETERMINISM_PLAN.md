# Test Determinism

Replace probabilistic test assertions with deterministic ones. Two defect
classes, both already caught in production: **wall-clock budgets** that pass on
an idle machine and fail under load, and **weak waits** that synchronise on a
mock being *called* rather than on the state that call produces. Every task
here is a mechanical recipe with an exact file list, an acceptance command, and
a stated stop condition, so it can be executed in small independent chunks by
agents that do not need to hold the whole picture.

**Status:** Active
**Parent:** MAIN_PLAN.md
**Created:** 2026-08-09
**Updated:** 2026-08-09

---

## Context

### How the pieces fit together

Nothing here changes product behaviour. Every task edits tests, or adds a guard
that prevents a bad test pattern from landing. Chunks are independent by
construction: each owns a disjoint file set, so several can run in parallel
worktrees and merge in any order.

### The two defect classes

**Class A — wall-clock budget.** `assert elapsed < N` calibrated on an idle
machine, then run on a 6-way shared CI matrix or a dev box with three agents
on it. Observed three times on 2026-08-09.

*The fix pattern, already applied once and proven —* `tests/test_calc_map.py`
is the worked example. Split the load-INVARIANT claim from the timing one:

```python
# was:  assert elapsed < 2.0
assert _resolve_auto_method("auto", x, y, z) == "linear"   # invariant: WHAT ran
assert elapsed < 8.0                                        # loose backstop only
```

The invariant assertion is what actually encodes the fix and cannot flake. The
clock survives only to catch an order-of-magnitude regression, never as a
benchmark.

**Budget rule — corrected 2026-08-10, after task 2 got this wrong:**
`new_budget = max(old_budget, 5 x measured)`. **Never lower an existing bound.**
"5x the runtime measured on an idle machine" is NOT a safe margin by itself:
`GridViewport.perf` measured ~0.3-1.2 s against an **8 s** budget (~8x headroom)
and still flaked under three concurrent agents. Load does not scale runtime by
5x — it can stall a worker for whole seconds. An old bound that has never failed
is evidence that bound is survivable; keep it.

Safe precisely because these guards are **order-of-magnitude, not marginal**: a
ReDoS regression on a 200k-char input takes minutes, not 0.3 s; a sparse-table
to naive regression is quadratic. A loose ceiling catches those as reliably as a
tight one and never flakes.

**Class B — weak wait.** `await waitFor(() => expect(someMock).toHaveBeenCalled())`
proves the mock was *invoked*. It does NOT prove the resolved value reached
component state. Item 22's flake: `dragElement` early-returns on `!hitmap`, so
on a lost race the gesture silently no-ops and the later assertion sees
`undefined`.

*The fix pattern, also already in the tree —* wait on the STATE, not the call:

```ts
// weak:   await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());
// strong: await waitFor(() => expect(result.current.hitmap).not.toBeNull());
```

### Why this plan exists at all

The item-22 fix was verified as **0/90 repetitions**. That sounds strong and is
not: if the bug were fully intact at its measured 1/30 (3.3%) rate, the chance
of 0/90 by luck is ~4.7%. The rule of three puts the 95% upper bound after
0/90 at exactly 3/90 = 3.3% — *identical to the baseline*. The repetitions
could not distinguish "fixed" from "unchanged"; only the mechanistic argument
did. Ruling out 3.3% at 99% confidence would need ~136 clean runs.

**The lesson driving task 1:** once a race is understood, forcing it beats
repeating the test. A deterministic test is worth more than any number of runs.

### Inventory (measured 2026-08-09, re-verify before editing)

Class A — Python:

| file:line | budget |
|---|---|
| `tests/test_calc_unitconvert.py:100` | **0.5 s** — tightest in the repo |
| `tests/test_calc_peaks.py:112` | 30 s |
| `tests/test_calc_peaks.py:126` | 30 s |
| `tests/test_io_origin_fuzz.py:213` | 120 s |
| `tests/test_calc_map.py:288` | 8 s — ALREADY FIXED, the worked example |

Class A — TypeScript: `frontend/src/components/Stage/worksheet/GridViewport.perf.test.tsx`
(`performance.now()` at lines ~63, ~91, ~139).

Class B — **110 call sites** matching
`waitFor(() => expect(<ident>).toHaveBeenCalled...)`. Most are fine. Triage
rule in task 4.

### Dependency map

- Tasks 1, 2, 3 are fully independent — run in parallel.
- Task 4 (triage) blocks tasks 5+ (the per-directory fixes it schedules).
- Task 6 (lint guard) should land LAST, after 4/5, so its allowlist reflects
  the cleaned tree rather than the current one.

---

## Tier 1 — High Impact

1. **Deterministic test for the item-22 race** — the task that motivated this plan.
   Files: `frontend/src/components/workshops/figurebuilder/useFigureBuilder.test.ts`.
   - [ ] Add ONE new test that **forces** the race rather than hoping for it:
     make the preview/hitmap promise resolve only *after* a drag gesture has
     been dispatched, then assert the guarded path behaves correctly (the drag
     is either correctly deferred or correctly applied — decide which is right
     by reading `useFigureBuilder.ts:494`'s `if (!hitmap) return;` and say
     which in the test name).
   - [ ] The new test must FAIL if the `waitFor(result.current.hitmap)` fix is
     reverted. Prove it: revert the fix, run, show red; restore, show green.
     A determinism test that never saw the bug proves nothing.
   - [ ] Leave the existing repetition-based confidence alone; this test
     replaces the NEED for it, it does not delete history.
   - Acceptance: `cd frontend && npx vitest run src/components/workshops/figurebuilder`
   - Stop if: forcing the race requires changing `useFigureBuilder.ts`. That
     would mean it is a production race, not a test-sync gap — report instead.

2. **Class A, Python — 4 remaining budgets.**
   Files: `tests/test_calc_unitconvert.py`, `tests/test_calc_peaks.py`,
   `tests/test_io_origin_fuzz.py`.
   - [ ] For EACH site: identify what the test is really protecting (an
     algorithm choice? a complexity class? a vectorised path vs a Python
     loop?) and assert THAT. Then set the clock to
     `max(old_budget, 5x measured)` — see the budget rule in Context;
     **never lower an existing bound**.
   - [ ] `test_calc_unitconvert.py:100` (0.5 s) is the priority — it is the
     tightest and has the least headroom. If no load-invariant claim exists
     (i.e. the test only ever meant "this is fast"), KEEP the existing budget
     and add a comment saying it is a smoke bound, not a benchmark.
   - [ ] Copy the comment style from `tests/test_calc_map.py:280-292`, which
     explains WHY the bound is loose and warns against tightening it.
   - Acceptance: `uv run pytest tests/test_calc_unitconvert.py tests/test_calc_peaks.py tests/test_io_origin_fuzz.py -q && uv run ruff check src tests`
   - Stop if: a site's only meaningful assertion is the time. Report it; do not
     delete the test.

3. **Class A, TypeScript — `GridViewport.perf.test.tsx`.**
   Files: `frontend/src/components/Stage/worksheet/GridViewport.perf.test.tsx`.
   - [ ] The test already asserts a **bounded DOM node count** alongside the
     time budget. The node count is the load-invariant claim and is the real
     protection (it proves virtualisation works). Keep it; loosen or drop the
     wall-clock half per the task-2 recipe.
   - [ ] Verified flaky under concurrent load, green 4/4 alone.
   - Acceptance: `cd frontend && npx vitest run src/components/Stage/worksheet`
   - Stop if: removing the time bound leaves the test asserting nothing new.

---

## Tier 2 — Medium Impact

4. **Triage the 110 Class-B sites — produce an inventory, change nothing.**
   Output: `plans/weak-waits-inventory.md` (a scratch inventory, deleted by
   task 5's completion per the plan-consolidation rule).
   - [ ] Enumerate every match of
     `waitFor\(\(\) => *expect\([a-zA-Z]+\)\.toHaveBeenCalled`
     in `frontend/src/**/*.test.ts{,x}`.
   - [ ] Classify each by this MECHANICAL rule, no judgement required:
     - **SAFE** — the `waitFor` is the test's final assertion, or every
       following line is another `expect(...)` on a mock. The test's purpose
       IS "we called it".
     - **SUSPECT** — after the `waitFor`, the test performs an action
       (`fireEvent`, `userEvent`, `act(`, a hook method call) or asserts on
       component/hook STATE (`result.current.*`, `screen.getBy*`). Anything
       that could depend on the call's resolved value.
   - [ ] For each SUSPECT, record file:line, the mock name, and the first
     dependent line. Group by directory so task 5 can be chunked.
   - Acceptance: the inventory exists, counts SAFE + SUSPECT = 110, and 5
     spot-checked entries classify correctly on manual read.
   - Stop if: SUSPECT exceeds ~40 — that is a bigger campaign than this plan
     scoped, so report the count and let the owner decide the appetite.

5. **Fix the SUSPECT sites — one chunk per directory.**
   Files: as scheduled by task 4; each chunk owns exactly one directory under
   `frontend/src/components/workshops/` or `frontend/src/components/Stage/`.
   - [ ] Replace the weak wait with a wait on the state the test actually
     depends on, following `useFigureBuilder.test.ts`'s idiom
     (`await waitFor(() => expect(result.current.<field>).not.toBeNull())`).
   - [ ] Do NOT change production code. Do NOT add retries, extend timeouts,
     or loosen assertions.
   - [ ] Each chunk is independently mergeable and gets its own branch.
   - Acceptance per chunk: `cd frontend && npx vitest run <that directory>`
     then the full `npx vitest run`.
   - Stop if: a site cannot be fixed without touching production code —
     that is a real race, report it as its own finding.

6. **Lint guard so new weak waits cannot land** — do LAST.
   Files: the frontend ESLint config; possibly `frontend/src/architecture.test.ts`.
   - [ ] A rule (custom ESLint rule, or a test that greps, matching whichever
     mechanism the repo already uses — **grep for an existing guard first**,
     per the owner's standing "two ratchets is drift by construction" rule)
     that flags `waitFor(() => expect(<mock>).toHaveBeenCalled())` when
     followed by a state-dependent line.
   - [ ] Allowlist the SAFE sites task 4 identified, pinned exactly, so the
     guard starts green and only new violations fail.
   - Acceptance: `cd frontend && npx vitest run && npm run build`; plus plant
     a violation, show it fails, revert.
   - Stop if: the false-positive rate makes the allowlist unmanageable
     (> ~60 entries) — report rather than shipping a guard people will disable.

---

## Tier 3 — Nice-to-Have

7. **Statistical honesty note in the contributing docs** — a short paragraph on
   why "N clean runs" is weak evidence for a flake fix (rule of three: 0 in n
   bounds the rate at only 3/n), and that a forced-race test is the standard to
   aim for. Cite the item-22 case: 0/90 could not distinguish fixed from
   unchanged.

---

## Completed

- ~~**Class A, `tests/test_calc_map.py`**~~ (2026-08-09) — the worked example
  every other Class-A task copies. A 2 s budget flaked immediately under
  concurrent load (2.22 s standalone, red under parallel agents); replaced by a
  deterministic assertion on the resolved gridding METHOD plus a loose 8 s
  backstop. Originated as RSM_CUTS_PLAN item 16.
- ~~**Class B, `useFigureBuilder.test.ts`**~~ (2026-08-09) — root-caused and
  fixed; was RSM_CUTS_PLAN item 22. Baseline 1/30 standalone single-threaded,
  0/90 after, independently re-verified 0/30. The evidence rests on the
  mechanism, not the repetitions — which is precisely why task 1 exists.
