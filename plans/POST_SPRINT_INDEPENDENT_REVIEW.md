# Post-sprint independent review and correction plan

**Reviewer:** ChatGPT-Sol  
**Audit date:** 2026-08-22  
**Audited revision:** `origin/main` at `844a35c2`  
**Release examined:** `v0.23.0-rc1` at `069616d1`  
**Status:** Active — the release candidate may be tested, but should not be
promoted to stable until the release-blocking rows below are closed or explicitly
deferred by the owner.

## Coordination note

A parallel ChatGPT session is preparing a calculator-improvement PR. Work from
this plan must not modify, reformat, or opportunistically refactor calculator
code. Keep each correction in a narrowly scoped PR, rebase after the calculator
PR lands when files overlap, and rerun the relevant checks on the resulting
commit. None of the currently identified P0/P1 corrections requires calculator
changes.

## Audit basis

The sprint produced substantial working functionality and has a strong automated
baseline. This review ran without changing application code:

- Frontend: 543 test files and 8,090 tests passed.
- Backend: 4,233 tests passed, with 69 skipped and 8 expected failures.
- TypeScript typecheck and production build passed.
- Lint completed with nine existing React-hook warnings and no errors.
- CI, E2E and CodeQL were green on current `main`.
- The release workflow passed on the exact RC tag and published Windows,
  Linux and Apple-silicon macOS artifacts.

Green automated checks do not establish packaged-app usability, visual fidelity,
Office interoperability, or correctness for concurrency races the tests do not
currently exercise.

## P0 — required before stable promotion

### [ ] R1. Hold project ownership through the actual project-file replacement

**Problem:** `desktop_bridge.py::write_project_file` calls
`desktop_project_lock.token_still_valid`, releases that function's OS-level lock,
and only afterward creates/writes the temporary file and calls `os.replace`.
Another process can acquire or take over the project in that gap. In addition,
`token_still_valid` currently returns true for any supplied token when the lock
file is absent. The release notes' claim that lock verification and write share
one atomic boundary is therefore inaccurate.

**Goal:** A writer may replace a named project only while it verifiably owns the
same cross-process lock for the complete ownership-sensitive write boundary.

**Required work:**

- [ ] Define a backend operation that verifies the token and retains the lock
  through temporary-file completion and atomic replacement.
- [ ] Treat an absent lock as token failure when a non-empty token was supplied.
- [ ] Preserve the existing no-lock compatibility path only for callers that
  intentionally supply no token.
- [ ] Add a real two-process regression in which takeover/release/reacquire races
  an in-progress save; the displaced writer must never replace the project.
- [ ] Test Windows and POSIX behavior, including tombstones and orphaned-inode
  handling.
- [ ] Correct release documentation if implementation is deferred.

**Suggested owner:** Claude Opus for the concurrency contract and adversarial
review; Claude Sonnet for implementation and platform tests.  
**Independent review:** A reviewer other than the implementer.  
**Acceptance:** No interleaving permits two processes to believe their writes
were accepted; the final file always belongs to the process holding the current
token at replacement time.

### [ ] R2. Complete packaged-app and owner acceptance

**Problem:** The RC was built successfully, but the sprint still records the
installed Windows/macOS workflow, owner real-data session, Office paste,
installer/icon/taskbar check, baseline Quick Figure smoke, and Sol usability
review as outstanding. Renderer-corpus success is not a substitute for visual
fidelity or daily-driver usability.

**Required work:**

- [ ] Install the Windows RC and run import → browse → Quick Plot/Quick Figure →
  edit → annotate → copy/paste to Word and PowerPoint → save/reopen → recovery.
- [ ] Repeat the supported macOS workflow on an installed artifact.
- [ ] Exercise real native dialogs: cancel, long Unicode path, disconnected
  network location, reopen/relink and Save As.
- [ ] Verify desktop, Start menu/Dock and taskbar icons from the installer.
- [ ] Run the owner's 60–90 minute real-data session with Origin/JMP closed and
  record every workaround, failure and switch-back trigger.
- [ ] Judge representative Origin comparison images for visual fidelity; a
  zero-renderer-failure corpus does not close this criterion.
- [ ] Record OS, artifact name, exact SHA, dataset/workflow and verdict.

**Suggested owner:** Owner for experiential verdicts; Claude Sonnet for packaged
artifact support; ChatGPT-Sol for wording, menus, recovery and workflow review.  
**Acceptance:** The evidence is recorded against the exact promotion candidate,
and every serious failure has a fixing PR or an owner-approved limitation.

## P1 — correctness and release-scope fixes

### [ ] R3. Recompute relink provenance at commit time

**Problem:** `store/relink.ts` compares a commit-time checksum with the preview
checksum only when both exist. It does not always recompute
`sourceChangeVerdict` against the dataset's original recorded provenance. A row
with recorded checksum A can preview as `unknown`, be individually approved,
then re-probe as checksum B and commit because the preview checksum was null.
The commit also replaces the stored provenance with B.

**Required work:**

- [ ] At commit, look up the live dataset and recompute the verdict using its
  recorded checksum/mtime/size and the fresh probe.
- [ ] Reject fresh `changed` results even when the preview was `unknown` and
  individually escalated.
- [ ] Define whether an escalated `unknown` remains acceptable when the fresh
  probe is still unknown; never silently upgrade it to unchanged.
- [ ] Add the recorded-A / preview-null / commit-B regression.
- [ ] Add tests for a dataset removed or reimported between preview and commit.

**Suggested owner:** Claude Sonnet; Claude Opus review for provenance semantics.  
**Acceptance:** No relink can overwrite original provenance for content that a
fresh comparison identifies as changed.

### [ ] R4. Fail closed when the desktop lock bridge is unavailable

**Problem:** `desktopLockProvider.toCasResult(null, false)` returns a refused
result with `record: null` but without the `unverifiable` flag.
`statusFromRefusal` then classifies the null record as `unlocked`, so project
open can report `readOnly: false` after lock acquisition failed. Quick Save
usually refuses later, but the visible/editing state is misleading.

**Required work:**

- [ ] Represent bridge absence, malformed responses and thrown bridge calls as
  an explicit unverifiable/fail-closed result.
- [ ] Ensure open, heartbeat, takeover, Save and Save As all expose a coherent
  read-only/recovery state after provider failure.
- [ ] Demote a previously writable session when heartbeat cannot verify
  ownership; do not leave stale `held-by-me` UI indefinitely.
- [ ] Add tests for absent method, thrown call, malformed response and recovery
  after bridge availability returns.

**Suggested owner:** Claude Sonnet.  
**Independent review:** ChatGPT-Sol for the recovery UI and status wording.  
**Acceptance:** Every unverifiable provider condition is visibly read-only and
no UI path claims editing ownership that was not acquired.

### [ ] R5. Decide and document macOS architecture support

**Problem:** The RC publishes `Quantized_0.23.0_aarch64.dmg` only. There is no
Intel/x86-64 macOS installer, although plans generally say “macOS” without an
architecture limitation.

- [ ] Ask the owner whether Intel Mac support is required for this release.
- [ ] If required, add and verify an x86-64 or universal artifact.
- [ ] If not required, state Apple silicon explicitly in installation and
  release documentation.

**Suggested owner:** Claude Sonnet for release infrastructure; cheaper Claude
model for documentation after the decision.  
**Acceptance:** Supported macOS architectures are explicit and match published
artifacts.

## P2 — bounded hardening and reconciliation

### [ ] R6. Prevent unrelated edits from joining an asynchronous Undo batch

**Problem:** `withHistoryBatch` sets global `historySuppressed` while awaiting
the complete import-as-new-version operation. Any unrelated edit during that
await can be absorbed into the import's single Undo transaction.

- [ ] Determine whether the UI currently prevents all participating mutations
  while the import is pending.
- [ ] If not, use operation-scoped history batching or block conflicting edits
  with an honest progress/busy state.
- [ ] Add a delayed-import test that attempts a second edit before completion
  and verifies independent Undo behavior.

**Suggested owner:** Claude Sonnet.  
**Acceptance:** An asynchronous import cannot suppress or relabel another user
action's history entry.

### [ ] R7. Add bounded performance-regression protection

**Problem:** `tools/baselines/BENCH.md` makes the large-map measurements
reproducible, but the sprint requested a bounded regression check as well.
Functional tests do not fail if the optimized path becomes dramatically slower.

- [ ] Add a stable, generously bounded performance test or a dedicated
  non-blocking benchmark job with recorded trend data.
- [ ] Keep timing thresholds broad enough to avoid ordinary shared-runner noise.
- [ ] Pin structural expectations such as fast-path selection and maximum
  duplicate expensive detection calls separately from wall-clock timing.

**Suggested owner:** Claude Sonnet.  
**Acceptance:** A major return toward the pre-sprint 30–140 second behavior is
detected automatically or produces an unmistakable benchmark alert.

### [ ] R8. Restore meaningful eager-bundle headroom

**Problem:** Current `main` builds at approximately 897.9 kB eager against an
898.2 kB budget, leaving roughly 0.3 kB. The next small eager import can break
CI. The budget script also says the ratchet only moves down even though reviewed
raises have occurred.

- [ ] Do not solve this with another unexplained budget increase.
- [ ] Identify post-RC recipe or store modules that can move behind an existing
  lazy boundary without changing first-paint behavior.
- [ ] Restore a practical headroom band and update the ratchet documentation so
  it accurately describes the allowed review process.

**Suggested owner:** ChatGPT-Sol for module-boundary analysis; Claude Sonnet for
implementation/reliability review.  
**Acceptance:** Production build passes with useful measured headroom and no new
loading flash or delayed core interaction.

### [ ] R9. Resolve existing React-hook warnings

The audit observed nine lint warnings in Notes, PlotViewport, multi-panel,
filter, graph-builder, peak and waterfall hooks. These were not proven to be
sprint regressions, so handle them separately and verify behavior rather than
mechanically expanding dependency arrays.

- [ ] Triage each warning as real stale-closure risk or documented intentional
  behavior.
- [ ] Add focused regressions before changing effects that control plots or
  workshops.

**Suggested owner:** Cheaper Claude model for inventory; Claude Sonnet for any
behavior-sensitive fixes.  
**Acceptance:** Zero unexplained hook warnings, with no render loop or reset of
in-progress user edits.

### [ ] R10. Reconcile sprint and release tracking

**Problem:** The RC exists and its exact-tag CI/release workflow passed, while
Day 7 remains wholly unchecked. The audit closure says all P0/P1 rows have fixes
or deferrals even though owner/Sol acceptance remains open. This makes “sprint
done” ambiguous.

- [ ] Record the exact RC SHA and exact workflow run in the Day-7 rows.
- [ ] Keep owner/Sol acceptance open until genuinely performed.
- [ ] Distinguish “RC published,” “engineering sprint complete,” and “stable
  promotion accepted.”
- [ ] Replace stale or contradictory statements across the sprint, release
  blockers and RC notes after R1–R5 are decided.

**Suggested owner:** Cheaper Claude model for mechanical reconciliation; Claude
Sonnet and ChatGPT-Sol review.  
**Acceptance:** Every applicable row is completed, deferred with an owner and
reason, or linked to a live follow-up; none remains ambiguously in progress.

## Stable-promotion gate

- [ ] R1–R4 are fixed and independently reviewed, or explicitly deferred by the
  owner with accurate user-visible limitations.
- [ ] R2 packaged and owner acceptance is recorded against the candidate.
- [ ] R5 architecture support is explicit.
- [ ] Full backend, frontend, typecheck, lint policy, build, E2E, CodeQL and
  release matrix pass on the exact promotion SHA.
- [ ] Recovery and rollback instructions match the shipped behavior.
- [ ] This document and the sprint/release documents carry a dated closure log.

## Closure log

Add entries without deleting the original finding. Use this format so a later
agent can distinguish implementation from verification:

| Date | Item | PR/commit | Implementer | Independent reviewer | Evidence and residual risk |
|---|---|---|---|---|---|
| 2026-08-22 | Audit created | — | ChatGPT-Sol | — | Read-only review; no application fixes made |

