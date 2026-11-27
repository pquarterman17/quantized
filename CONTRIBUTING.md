# Contributing to quantized

Thanks for helping. This file covers the two things that are easy to get
wrong: the gate a change has to pass, and the evidence standard for calling
a flaky test fixed.

Architecture rules (pure `io/`+`calc/` libraries, thin `routes/`, the
500-line module ceiling, golden MATLAB parity) live in
[`CLAUDE.md`](CLAUDE.md) and are enforced by tests, not by review.

## The gate

Run all of it before opening a PR — CI runs the same commands on Windows
(py3.13 on PRs, py3.11 too on main pushes, every OS nightly) plus a
frontend job:

```bash
uv sync --group dev
uv run python tools/gate.py          # the whole gate, one command (~8 min)
```

`tools/gate.py` is the single source of truth for what the gate runs —
cross-platform (`subprocess.run(..., shell=False)`, resolves `npm`/`npm.cmd`
via `shutil.which`), prints each step and its elapsed time, and stops at the
first failure. Flags: `--backend-only`, `--frontend-only`, `--skip-tests`.

**Origin import changes** also run `uv run python tools/gate.py --origin`: it
fingerprints every local Origin project (public + owner corpus; structure only,
never values, never written into the repo) on HEAD and on a freshly built
`origin/main` worktree, and fails on any difference (lost/gained curves,
changed X binding, colour, hidden, omission reason, axis, books, figures).
Every change must be listed with a reason in an explained-changes JSON
(`--origin-allow FILE`). Without a corpus (CI) it skips. Details and the
`snapshot` / `diff` / `check` subcommands: `tools/origin_regress.py --help`.

Individual steps, if you want to run just one by hand:

```bash
uv run pytest -n auto                # add -m golden for the MATLAB parity subset
uv run ruff check src tests tools    # `tools` too — CI lints all three
uv run mypy src
cd frontend && npm test && npm run build
```

`-n auto` (pytest-xdist) runs the suite across all local cores — the full
serial run and single-file/`-k` runs still work unparallelized, just pass
`-n auto` yourself when you want the speedup.

Golden fixtures are committed, so none of this needs MATLAB.

**Gate traps** (each cost a red CI run once; the `gate` skill in
`.claude/skills/gate/SKILL.md` has the commands):

- `cmd | tail -n; echo "exit=$?"` reports TAIL's status. Measured:
  `false | tail -1` then `$?` is 0, while `${PIPESTATUS[0]}` is 1; several gate
  runs logged `BUILD exit=0` that way. Use `${PIPESTATUS[0]}` or redirect to a
  file and check `$?`.
- `tsc -b` is incremental and vite's transform cache can be stale (PR #343
  passed locally and failed CI twice): run `npx tsc -b --force` and `npm ci`
  first. Details in [`frontend/CLAUDE.md`](frontend/CLAUDE.md).
- A truncated log download is worse than no log. A `curl` of a failing job
  through the proxy died with `CONNECT tunnel failed, response 403` but still
  wrote 40 lines describing a different, stale failure (a module-size ceiling
  on a file the branch never touched). Use `mcp__github__get_job_logs`, or
  verify the download completed, and re-read before diagnosing.

## Pre-PR self-review

Adopted 2026-08-16, after PR #149 round 1:

- **Simulate the first real consumer before opening a PR.** Infrastructure
  contracts get review-tested by writing the next slice's strawman code
  against them (the E-c1 miss: a page preview renders figures, so figures
  belong in the cache key, obvious the moment the generator was sketched).
- **Cache/invalidation red-team question:** list ALL inputs the rendered
  output depends on (transitively); each one must be in the cache key.
- **Doc-promise audit:** every behavioural claim in a header or PR body needs
  a matching test, or the claim is narrowed to what the code does.
- **Run the code-review skill (high) on your own diff** and fix what it
  finds. Its first run caught a CI-red weak-wait, a deps-cursor desync, and
  two O(store)-per-tile inefficiencies before the push.

## Container and environment resets

**A remote container reset can restore STALE installed dependencies. Check
deterministically, then act only if the check fails.** Do not assume every
new session is a reset, and read nothing from directory mtimes
(`.venv/pyvenv.cfg` is written once at creation and never touched by
`uv sync`; it was cited as a signal on 2026-09-02 and means nothing).

- Python: `uv sync --check --group dev` exits 0 in sync, 1 when not, and
  prints the package diff (measured 2026-09-02 on a forced one-package
  downgrade). Restore with `uv sync --group dev`.
- Frontend: compare a pinned direct dependency in the lock with what is
  installed:
  `node -p "require('./frontend/package-lock.json').packages['node_modules/vite'].version"`
  vs `node -p "require('./frontend/node_modules/vite/package.json').version"`.
  A mismatch means `cd frontend && npm ci`.

The incident: a gate ran against `node_modules` from 2026-08-22 (vite 8.2.1
vs a lock at 8.2.2) and a venv from 2026-08-15 (statsmodels 0.14.6 vs
0.15.0), and a full green suite on that tree was treated as evidence. It was
caught only because a fresh worktree disagreed by 0.9 kB on the bundle. The
same reset recurred that day and the vite one-liner caught it in one second.
Neither check sees a stale vite transform cache: only `npm ci` does.

**The complete raw log is authoritative; extraction is a convenience.** A
`| tail -5` gate log threw away the name of a one-off failing test (a flake
that passed on re-run), and without the name it cannot be pursued per
[`docs/testing.md`](docs/testing.md). Save the whole output, then search the
saved file: bash `npx vitest run 2>&1 | tee gate.log` then
`rg 'FAIL|AssertionError' gate.log`; PowerShell `npx vitest run 2>&1 |
Tee-Object gate.log` then `Select-String 'FAIL|AssertionError' gate.log`.
Never pipe through a filter alone. (Vitest 4's `FAIL` line is plain text even
under a real pty, measured with `script`; the search runs on a saved file for
portability across shells, not because of ANSI.)

**A killed vitest run leaks ~80 MB into `$TMPDIR`.** Each run writes its
transformed modules to `$TMPDIR/<21-char nanoid>/client/` and removes the
directory only on a clean close. On 2026-09-28 about 1,100 leaked directories
(~28 GB) filled the disk and stalled six parallel agents. Let runs finish.
When disk is low, remove leaked directories older than 30 minutes:
`find /tmp -maxdepth 1 -type d -regextype posix-extended -regex
'/tmp/[A-Za-z0-9_-]{21}' -mmin +30 -exec rm -rf {} +`. The class must include
`_` and `-` (nanoid's alphabet); an alphanumeric-only class skipped about half
(measured 2026-09-30: 1,828 directories, ~20 GB, found only by the wider
class). On shared boxes also cap workers: `pytest -n 4`,
`vitest --maxWorkers=3`.

## CI and security

- Always lint `ruff check src tests tools`, as CI does: a tests-only
  import-sort slipped past a `src`-only local run and reddened CI.
- CI runs the backend on Windows plus the frontend and Chromium e2e jobs on
  every PR and main push. PRs run py3.13 only; main pushes add py3.11, the
  supported floor (owner decision 2026-11-27: dev speed first). Ruff and
  mypy target 3.11, so a PR still catches 3.12+ syntax and stdlib use; a
  3.11-only runtime break shows on the main-push run and is fixed forward.
  The full OS matrix (ubuntu/windows/macOS), the Firefox/WebKit e2e legs and
  the floating-Node
  vitest run go nightly and on a manual run (owner decision 2026-11-26:
  Windows is the platform that must build; other-OS breaks are fixed from
  the nightly result). Golden fixtures are committed, so CI needs no MATLAB.
- A newer push cancels the older CI and e2e run, on a PR and on `main`
  alike: a burst of merges to `main` runs once, on its newest commit. A red
  `main` run can therefore come from an earlier commit in that burst. To pin
  it down, push a branch at the suspect commit and run
  `gh workflow run ci.yml --ref <branch>` (re-running the cancelled `main`
  run would rejoin the `main` group and cancel the newest run). CodeQL,
  scheduled and manual runs keep one run per commit.
- `main` is branch-protected: 2 required checks (`frontend` and
  `backend (windows-latest, 3.13)`; the 3.11 leg left the list on
  2026-11-27, when it stopped running on PRs), not strict (a PR need not be
  up to date with `main`), and conversation resolution required. Admins are exempt, so
  direct pushes to `main` still work for the owner.
- The repo is public; secret scanning, push protection, Dependabot and
  CodeQL are on. The `gh` CLI token cannot enable CodeQL default setup (no
  `security_events` scope, 404), so CodeQL runs as an advanced-setup
  workflow (`.github/workflows/codeql.yml`).

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
