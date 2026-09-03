# Contributing to quantized

Thanks for helping. This file covers the two things that are easy to get
wrong: the gate a change has to pass, and the evidence standard for calling
a flaky test fixed.

Architecture rules (pure `io/`+`calc/` libraries, thin `routes/`, the
500-line module ceiling, golden MATLAB parity) live in
[`CLAUDE.md`](CLAUDE.md) and are enforced by tests, not by review.

## The gate

Run all of it before opening a PR — CI runs the same commands on a
ubuntu/windows/macOS × py3.11/3.13 matrix plus a frontend job:

```bash
uv sync --group dev
uv run pytest -n auto                # add -m golden for the MATLAB parity subset
uv run ruff check src tests          # `src tests`, not just `src` — CI lints both
uv run mypy src
cd frontend && npm test && npm run build
```

`-n auto` (pytest-xdist) runs the suite across all local cores — the full
serial run and single-file/`-k` runs still work unparallelized, just pass
`-n auto` yourself when you want the speedup.

Golden fixtures are committed, so none of this needs MATLAB.

## Flake-fix evidence

**"I ran it N times and it passed" is weak evidence that a flaky test is
fixed.** Use the rule of three as a reality check: zero failures in *n* runs
bounds the true failure rate at only **3/n** with 95% confidence. 0 failures
in 90 runs bounds it at 3.3% — which is useless against a bug that only
fires 3% of the time in the first place.

This is not hypothetical. A race in `useFigureBuilder` failed **1 time in 30
runs (3.3%)** standalone. After the candidate fix it passed 0/90 — but an
intact bug had a ~4.7% chance of producing that same clean streak, and the
post-fix 95% upper bound (3.3%) was *identical to the baseline*. The 90 runs
could not distinguish "fixed" from "unchanged". Ruling out 3.3% at 99%
confidence would have taken ~136 clean runs.

**Once you understand a race, force it.** The standard is a deterministic
test that reproduces the race on every run — hold the promise unresolved,
dispatch the gesture into that guaranteed-failure window, then resolve and
assert the same gesture succeeds. A worked implementation is the test named
"forces the item-22 race" in
`frontend/src/components/workshops/figurebuilder/useFigureBuilder.test.ts`.

Two corollaries, both learned the hard way:

- **Wait on state, not on a call.** `await waitFor(() => expect(result.current.x)
  .not.toBeNull())`, never `waitFor(() => expect(mock).toHaveBeenCalled())`.
  `architecture.test.ts` ratchets the count of the latter per file — new ones
  fail the build.
- **Never lower an existing wall-clock budget.** Assert the load-invariant
  property (which algorithm ran, how many DOM nodes) and keep the clock only
  as a loose backstop. `GridViewport.perf` flaked with ~8x headroom; a bound
  that has never failed is evidence that bound is survivable.

Full write-up, including the arithmetic: [`docs/testing.md`](docs/testing.md).

## Commits and plans

Plans in `plans/` are the work tracker; `BACKLOG.md` is the derived
dashboard. Code and git history are truth #1, a plan's `## Completed`
section truth #2, `BACKLOG.md` truth #3 — when they disagree, fix the plan
first, then the dashboard, in the same commit. Tick a `PORT_CHECKLIST.md`
item only when the feature is both ported **and** golden-verified.

Raising a module-size ceiling needs written justification in the commit
message; the expected move is to extract a cohesive sibling module instead.

License: Apache-2.0. No GPL runtime dependencies (enforced).
