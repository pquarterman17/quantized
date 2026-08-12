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
**Updated:** 2026-08-11 (header date caught up during the twenty-second
BACKLOG reconcile — tasks 1/2/3/4/6 all completed 2026-08-10 without the
date being bumped; open residue is #7 plus the #5 standing rule)

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

## Tier 2 — Medium Impact

5. **Fix SUSPECT sites OPPORTUNISTICALLY — not as a campaign**
   (owner decision, 2026-08-10). `plans/weak-waits-inventory.md` stays as a
   standing reference; it is NOT deleted, and task 5 is never "done".
   - Rationale: the classification is **semantic, not syntactic** — whether a
     site is a real flake depends on whether that mock's *resolved value* feeds
     the state read afterwards, which no grep can determine. Three attempts at
     counting gave 110, then 124/98, then 57; the third was disproved by its
     own output (it flagged `expect(props.onSaveAs).not.toHaveBeenCalled()`,
     a mock assertion, as risky). An empirical ranking by observed flake rate
     was attempted and timed out without data.
   - 98 speculative edits to currently-passing tests is a bad trade: each
     carries its own risk of breaking a working test to prevent a flake that
     may not exist.
   - [ ] Standing rule: when you are editing a test file for any other reason
     and it appears in the inventory, fix its weak waits then. Wait on STATE
     (`await waitFor(() => expect(result.current.x).not.toBeNull())`), never on
     the mock. Lower the task-6 allowlist in the same commit.
   - The bound on this problem is task 6, not task 5.

7. **Statistical honesty note in the contributing docs** — a short paragraph on
   why "N clean runs" is weak evidence for a flake fix (rule of three: 0 in n
   bounds the rate at only 3/n), and that a forced-race test is the standard to
   aim for. Cite the item-22 case: 0/90 could not distinguish fixed from
   unchanged.

---

## Completed

- ~~**#1 Forced-race test**~~ (2026-08-10) — replaces the 0/90 probabilistic
  argument with a test that reproduces the race on EVERY run: the hitmap
  promise is held unresolved via `mockReturnValueOnce(deferred)`, a drag is
  dispatched into that guaranteed-null window, then it resolves and the same
  gesture succeeds. Concluded no production fix was needed — `if (!hitmap)
  return;` is correct, since the hitmap IS the px/data calibration and the
  draggable elements render from it, so a real user has nothing to grab first.
  The agent **refused my proposed proof** (revert the historical fix and show
  red) on the grounds that it only reddens ~1/30 — the same statistical trap
  this plan exists to escape — and instead made its own `waitFor` load-bearing.
  Independently verified: 15/15 deterministic, and removing that one line
  yields `expected undefined to match object { loc: 'custom' }`, the exact
  item-22 signature, on a single run.
- ~~**#2 Python wall-clock budgets**~~ (2026-08-10) — all four sites now assert
  a load-invariant property (ReDoS rejection on 200k chars; sparse-table result
  shape; vectorised return type; 127 MB decode success) with the clock demoted
  to a smoke ceiling. **Required one round back:** the first pass TIGHTENED
  three budgets (0.5→0.25 s, 30→5 s, 30→1 s) following my own flawed "5x
  measured on idle" instruction. Final: 0.5 / 30 / 30 kept, origin-fuzz
  120→600 s. Headroom now 25x / 36x / 150x / 5x.
- ~~**#3 GridViewport wall-clock**~~ (2026-08-10) — dropped the three time
  budgets, kept every bounded-DOM-node-count assertion (the real proof that
  virtualisation works). Notably KEPT test 4's timing assertion, which is a
  genuine invariant: it separates parallel (~15 ms) from serialised (~3015 ms)
  execution, a 200x algorithmic discriminator rather than a benchmark.
  Independently re-verified 10/10.

- ~~**#6 Weak-wait ratchet guard**~~ (2026-08-10) — extends
  `architecture.test.ts`'s existing ratchet idiom rather than adding a second
  mechanism. **33 files / 124 sites** pinned per-FILE (line pins would churn on
  unrelated edits and make the guard something people disable). Fails on a
  count over pin, on an unlisted file, and on a stale pin that should ratchet
  down. **Required one round of narrowing:** the first build matched bare
  `toHaveBeenCalled()` — 277 sites over 82 files — which is the ordinary,
  correct way to assert a mock was called and has nothing to do with the race.
  Narrowed to the `waitFor(() => expect(mock).toHaveBeenCalled())`
  synchronisation form only, with the distinction spelled out in the guard's
  own comment. Verified independently: a bare `expect(m).toHaveBeenCalled()`
  does NOT trip it; a `waitFor`-wrapped one in an unlisted file does.
- ~~**#4 Weak-wait triage**~~ (2026-08-10) — produced
  `plans/weak-waits-inventory.md` (124 matches, 26 SAFE, 98 SUSPECT) and
  correctly STOPPED at its threshold rather than proceeding. Its lasting value
  turned out to be negative evidence: the SUSPECT classification could not be
  made reliable (three attempts gave 110 / 124-98 / 57, the last disproved by
  its own output), which is what redirected the campaign into task 6's count
  ratchet. Inventory retained as a standing reference for task 5.

- ~~**Class A, `tests/test_calc_map.py`**~~ (2026-08-09) — the worked example
  every other Class-A task copies. A 2 s budget flaked immediately under
  concurrent load (2.22 s standalone, red under parallel agents); replaced by a
  deterministic assertion on the resolved gridding METHOD plus a loose 8 s
  backstop. Originated as RSM_CUTS_PLAN item 16.
- ~~**Class B, `useFigureBuilder.test.ts`**~~ (2026-08-09) — root-caused and
  fixed; was RSM_CUTS_PLAN item 22. Baseline 1/30 standalone single-threaded,
  0/90 after, independently re-verified 0/30. The evidence rests on the
  mechanism, not the repetitions — which is precisely why task 1 exists.
