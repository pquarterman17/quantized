# Robustness Plan — enforcement, environment, and runtime hardening

The repo's *feature* correctness is well defended (3,104 backend + 5,055
frontend tests, golden parity, CodeQL, Dependabot). What is thinly defended is
everything *around* the code: which environment it runs in, which guards
actually cover which files, and how the local server behaves under inputs
larger or more numerous than a demo. This plan collects that class. Every item
below was found by evidence on 2026-07-29 — a defect that had already shipped,
or a guard that provably could not see one — not by a general robustness
checklist.

**Status:** Active
**Parent:** `plans/MAIN_PLAN.md`
**Created:** 2026-07-29
**Updated:** 2026-07-31 (Tier 1 COMPLETE — #1/#2/#3 shipped in one agent
branch, merged `cc02e65`; #1 deliberately deviates from the literal "Node
matrix" wording, see the item)

---

## Context

### How the pieces fit together

Three enforcement layers exist today, and each has a hole this plan names:

| Layer | Lives in | Covers | Gap |
|---|---|---|---|
| Repo structure | `tests/test_repo_integrity.py` | GPL license, 500-line Python ceiling, pure-layer imports | — (healthy) |
| Frontend structure | `frontend/src/architecture.test.ts` | `.tsx` 400 ceiling, store pins, `MODULE_PINS` (added 2026-07-29), row-state chokepoint | Coverage was never censused — `MODULE_PINS` existed only because a review happened to look |
| Bundle | `frontend/scripts/check-bundle-size.mjs` | eager JS budget, both directions | — (healthy) |
| **Environment** | *nothing* | — | **CI pins Node by hand in 4 workflows, inconsistently; no file is authoritative** |
| **Runtime limits** | *nothing* | — | **uploads unbounded, job admission unbounded, executor never shut down** |

The last two rows are the plan.

### Data / control flow — where the runtime gaps sit

```
browser ──upload──> routes/parsers.py ──await file.read()──> RAM (whole file, no cap)
                                       └─> io/registry ─> DataStruct  [already 16x file size peak]

browser ──submit──> jobs.JobStore.submit ──> ThreadPoolExecutor
                    (evicts >100 for RETENTION, never REJECTS)      (no shutdown hook)
```

Both paths are the shapes the owner's `local-server-hardening.md` rule was
written from, in a repo whose real corpus is multi-hundred-MB (a 188 MB `.dwk`,
1M-row CSVs, Origin projects).

### Dependency map

- Items **1 + 2** touch the same surface (`.github/workflows/`) — one change, not two.
- Items **3, 4, 5** are the runtime-hardening triple; independent of the CI work and of each other.
- Item **7** (guard census) should land *before* any new guard, so it isn't another guard added by coincidence.
- Item **6** is independent of everything.
- Item **8** is deliberately parked — see its note.

### What this plan deliberately excludes

- **Frontend workspace atomicity / recovery** — already PRIMARY **P1.2**; not duplicated here.
- **Progress/cancel feedback** — already PRIMARY **P3.4**, closed 2026-07-26. Items 4/5 below are about *bounding and teardown*, which P3.4 never covered.
- **Regression matrix breadth** — already PRIMARY **P4.2**.
- Test-coverage depth and refactoring: not robustness, and the ratchets already govern the second.

---

## Tier 1 — High Impact

1. **~~Frontend CI is a single point of failure~~** SHIPPED 2026-07-31
   (`ea30cf7`, merged `cc02e65`) — the `frontend` job ran
   `ubuntu-latest` + Node 22 only, while `backend` matrices 3 OS × 2 Python.
   - [x] Second Node lane added — as a separate, NON-required
         `frontend-node-current` job (`ci.yml:64-102`), NOT a
         `strategy.matrix`: matrixing renames the check context to
         `frontend (22)` while branch protection pins the literal string
         `"frontend"` (verified via the protection API), so a matrix would
         have silently desynced required checks and blocked every PR merge.
         Non-required mirrors the repo's macos-lane precedent (a brand-new
         Node can lag native-binary availability for non-repo reasons).
         Needs one live CI run to confirm the job executes.
   - [x] OS breadth decided NOT needed (the evidence failure was
         version-, not OS-shaped) — documented inline in the workflow
   - **Evidence:** on 2026-07-29 a clean checkout failed **176 frontend tests
     across 22 files** under Node 26 while CI stayed green throughout, because
     CI only ever runs the one version where the bug does not exist. Fixed in
     `67a448f`, but the blind spot that hid it is untouched.

2. **~~Node version has four declarations and no source of truth~~**
   SHIPPED 2026-07-31 (`9553d6e`, merged `cc02e65`) —
   `ci.yml` 22, `e2e.yml` 22, `pypi.yml` **20**, `release.yml` **20**, all
   hardcoded; the new root `.nvmrc` (22) was read by none of them.
   - [x] All four workflows now use `node-version-file: .nvmrc` (setup-node
         docs confirm resolution from repo root regardless of a job's
         `working-directory`; needs one live run per workflow to confirm)
   - [x] 20-vs-22 resolved deliberately on 22; the fifth, looser declaration
         (`package.json` `engines.node >=20`) bumped to `>=22` to agree.
         The release artifact is now built on the same Node CI tests.
   - **Why Tier 1:** `pypi.yml` and `release.yml` both run `npm ci && npm run
     build`, so **the artifact users install is built on a Node version nothing
     tests.** It works today; nothing makes it keep working.

3. **~~Uploads read the whole file into RAM, with no size cap~~**
   SHIPPED 2026-07-31 (`034fcdf`, merged `cc02e65`) —
   `routes/parsers.py:305` and `routes/import_template.py:90` both
   `await file.read()`.
   - [x] Both routes stream to disk in 1 MiB chunks via new pure
         `routes/_uploadstream.py` (a `Protocol` reader, no
         fastapi/starlette import — unit-testable with a fake reader);
         `_uploadcache.py` gained `stage_upload_stream()`
   - [x] Cap = 512 MiB, evidence-based: largest real corpus file is
         PNR.opj at ~127.5 MB, 1M-row CSVs run ~70–100 MB → ~4× headroom.
         `UploadTooLargeError` → HTTP 413 (caught before the generic
         ValueError→422 handler); cap read at call time so tests
         monkeypatch it. 6 unit + 3 end-to-end 413 tests.
   - **Evidence:** direct violation of `local-server-hardening.md` §2, in the
     one path that receives the corpus this app is *for* — and it stacks on the
     already-measured 16× file-size peak of the CSV import path (P0.4).

---

## Tier 2 — Medium Impact

4. **Job admission is unbounded** — `JobStore.submit` never refuses.
   `jobs.py:101` evicts at >100 jobs, but that is *retention* trimming, not
   admission control: nothing returns 429, so a stuck producer or an
   impatient double-click accumulates work in the executor queue.
   - [ ] Reject past N pending with a domain exception (`JobQueueFullError`)
   - [ ] Translate it to 429 in the route, keeping `jobs.py` framework-free
   - The four-state machine itself is already correct
     (`pending|running|done|error|cancelled`) — this is the one missing piece.

5. **The executor is never shut down** — no lifespan hook, no `atexit`, no
   `pool.shutdown(...)` anywhere.
   - [ ] Wire `shutdown(wait=False, cancel_futures=True)` to the FastAPI
         lifespan shutdown (per the rule: `atexit` is too late — Python joins
         executor threads and drains the pending queue before it runs)
   - **Symptom to expect if left:** `qz` exits late, or appears to hang, after
     submitting a long fit.

6. **No standing check on transitive vulnerability surface** — the repo
   enforces a dependency *policy* (Apache-2.0, no GPL, tested) but nothing
   watches for CVEs in packages it never declared.
   - [ ] Add a periodic sweep (`gh api .../dependabot/alerts` + `npm audit`) or
         make it a scheduled workflow
   - **Evidence:** already named in BACKLOG after the 2026-07-24 round, where
     **13 of 14 alerts** arrived through `pillow` — a package this repo never
     declares, reached transitively via `matplotlib`, which `routes/export`
     renders user data through. The exposure was real and the class was
     invisible.

7. **Guard-coverage census** — one pass asking, of every guard, *what does it
   NOT see?*
   - [ ] Enumerate file classes (`.py`, `.ts`, `.tsx`, `.mjs`, workflows,
         config) against the guards that actually match them
   - [ ] Book the uncovered intersections; add guards only where a real defect
         class lives, not for symmetry
   - **Evidence:** `MODULE_PINS` (2026-07-29) closed a gap where `.tsx` had a
     ceiling and store `.ts` had pins but every other `.ts` had neither — which
     is exactly how `lib/api.ts` reached 2,282 lines unseen. That gap was found
     by a reviewer's eye, not by a process. Assume there are others.

---

## Tier 3 — Nice-to-Have

8. **Node version-manager standardization** — `fermiviewer` pins with Volta
   (`frontend/package.json`, 22.22.3); quantized now has a root `.nvmrc` (22).
   Two repos, two mechanisms.
   - [ ] Standardize on one (recommendation: Volta — PATH shims apply to
         subprocesses with no shell hook or `cd` trigger) and delete the other
   - [ ] Resolve the machine-level cause first: **both managers are installed
         and fnm precedes `~/.volta/bin` in PATH**, so *neither* pin currently
         takes effect — verified 2026-07-29, `../fermiviewer` serves Node 26
         despite its Volta pin
   - **Parked deliberately** (owner decision, 2026-07-29): it touches personal
     shell config on top of two repos. Item 2 makes CI authoritative regardless
     of which manager wins, so this is comfort, not correctness.

9. **Automate the recurring backend exception-class sweep** — BACKLOG records
   that the "route catches a narrow exception tuple, callee raises something
   else" class "recurs as new routes land — re-sweep periodically". A recurring
   manual sweep is a guard that has not been written yet.
   - [ ] Decide whether `tests/test_routes_malformed_dataset.py` can be
         generalized to enumerate routes rather than list them

10. **Pre-commit hooks** — none configured; CI is the only gate.
    - [ ] Judge whether local hooks earn their friction here, given CI already
          runs the full gate and the owner works across two machines

---

## Completed

- ~~**Tier 1 (#1 CI second Node lane, #2 Node source of truth, #3 bounded
  streaming uploads)**~~ (2026-07-31, one agent branch, merged `cc02e65`) —
  details struck inline on the items above. Merged-tree gate: backend
  3,422 / ruff / mypy clean; frontend suite + build + lint green. Two
  residual live-CI confirmations: the `frontend-node-current` job actually
  runs, and `node-version-file` resolves in all four workflows — check on
  the next push's Actions run.

The two fixes that *produced* this plan are booked in their own plans, not
here: the `MODULE_PINS` ratchet under `JMP_GAP_PLAN.md` #14, and the Node 26
`localStorage` fix (`67a448f`) in BACKLOG's 2026-07-29 reconciliation.
