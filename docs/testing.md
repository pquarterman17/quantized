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
