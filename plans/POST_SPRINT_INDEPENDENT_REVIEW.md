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

**Implementation status (2026-08-22, implementer=this lane, on branch
`claude/r1-lock-held-write`) — still open pending independent review, TWO
rounds so far:**

*Round 1.* New operation `desktop_project_lock_write.write_holding_token(
path, token, write_fn)` takes the same exclusive OS lock `refresh`/
`take_over` use, verifies `token` against the parsed on-disk record, and —
only on a match — invokes `write_fn()` (the real temp-write +
`os.replace`) while still holding that lock, releasing only after
`write_fn` returns or raises. An absent lock file (or a release tombstone,
which parses identically) with a non-empty token now returns `LockLost` —
refused — rather than the old `token_still_valid`'s "nothing to check
against, proceed"; that function has been removed, fully superseded.
`desktop_bridge.py::write_project_file` routes a non-empty `lock_token`
through this operation and an empty one through the unchanged legacy
no-lock path.

*Round 2 (code review of round 1 — 4 real findings + 1 cleanup, all
fixed).* **Blocking finding:** on Windows, `msvcrt` region locks are
MANDATORY, so `refresh`'s then-unprotected pre-read (needed to build the
refreshed record's other fields) would hit a `PermissionError` immediately
while a save was in progress and misclassify it as `UnverifiableLock` —
demoting a perfectly healthy holder, and never even reaching round 1's
enlarged retry budget. Fixed by introducing a distinct `Contended` outcome
(`desktop_project_lock_record.py`) for "someone else genuinely holds this
right now" — separate from `UnverifiableLock`'s "content is readable but
untrustworthy" — and by folding `refresh`'s read into the SAME locked CAS
section as the write (`_cas_update`, `desktop_project_lock.py`), so there
is no separate unprotected pre-read left to fail. `read`'s other callers
(`acquire`'s existing-file path, `project_lock_read`) get the identical
Windows-mandatory-lock retry-then-`Contended` treatment. The bridge maps a
`Contended` refresh to a non-demoting "soft success" carrying the last
genuinely-observed record (never fabricated, never null) so the
frontend's `record.token` for its next save stays intact — verified
`store/projectLock.ts` needs no change (its `heartbeat()`/`toCasResult`
handling already treats this correctly). The retry-budget constant that
round 1 quintupled was split into two independent, MODEST constants
(`desktop_project_lock_oslock.py`'s `_LOCK_ACQUIRE_RETRY_ATTEMPTS` /
`_IDENTITY_RETRY_ATTEMPTS`) — a shared constant had silently coupled the
OS-lock acquire budget to an unrelated orphan-inode identity-retry loop.
The exclusive-OS-lock mechanism (`_open_locked`/`_unlock`) was also
pulled into its own `desktop_project_lock_oslock.py` module so
`desktop_project_lock.py` and `desktop_project_lock_write.py` both import
it the ordinary way instead of one reaching into the other's private
names — a proportionate response to `desktop_project_lock.py` exceeding
the 500-line ceiling once `Contended`'s documentation landed. See the
closure log below (reviewer row left blank for the orchestrator to
assign) — this item stays open until an independent reviewer signs off.

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

- [x] Define a backend operation that verifies the token and retains the lock
  through temporary-file completion and atomic replacement.
  (`desktop_project_lock_write.write_holding_token`)
- [x] Treat an absent lock as token failure when a non-empty token was supplied.
  (`test_absent_lock_with_a_non_empty_token_refuses_write_fn_never_called`,
  `test_write_project_file_with_a_non_empty_token_refuses_when_no_lock_file_exists`)
- [x] Preserve the existing no-lock compatibility path only for callers that
  intentionally supply no token. (empty `lock_token` still skips
  `write_holding_token` entirely in `write_project_file`.)
- [x] Add a real two-process regression in which takeover/release/reacquire races
  an in-progress save; the displaced writer must never replace the project.
  (`test_two_real_processes_a_concurrent_takeover_never_lands_mid_write`,
  spawn-context multiprocessing, forced ordering via an `Event` signalled
  from inside `write_fn`.)
- [x] Test Windows and POSIX behavior, including tombstones and orphaned-inode
  handling. Tombstone: `test_a_release_tombstone_refuses_the_pre_release_token`
  (tombstone content written directly so it runs on every CI OS). Orphaned-
  inode: NOT a new test — `write_holding_token` calls the existing, unmodified
  `_open_locked` primitive (the same one `refresh`/`take_over` use), so the
  existing orphan-inode protection and its 3-OS CI matrix coverage apply
  unchanged; no new code path was introduced that could reintroduce it.
- [ ] Correct release documentation if implementation is deferred. — N/A;
  implemented, not deferred. `RC_RELEASE_NOTES_DRAFT.md`'s claim was
  instead strengthened to match the now-true stronger guarantee.

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
| 2026-08-22 | R1 fix (round 1) | branch `claude/r1-lock-held-write` (not yet merged/PR'd) | Claude (this lane) | _(blank — orchestrator to assign)_ | `write_holding_token` holds the exclusive OS lock across verify + temp-write + `os.replace`; absent lock + non-empty token now refuses (`token_still_valid` removed). Red-first: `tests/test_desktop_project_lock_write.py` (9 tests: basic contract, absent/mismatched/corrupt/tombstoned-token refusal, a real 2-process takeover-during-write race via `multiprocessing` spawn, and 2 forced contention-budget tests proving the old ~1s OS-lock retry budget could spuriously fail a concurrent `refresh` mid-save and the new ~5s budget does not) plus updated `tests/test_desktop_bridge_lock.py`/`test_desktop_project_lock.py`. Full gates green: `ruff check src tests`, `mypy src`, targeted lock/bridge tests, full `pytest -q`. Residual risk flagged at the time: not yet independently reviewed; a code-review pass (see the round-2 row) found the retry-budget fix incomplete. |
| 2026-08-22 | R1 fix (round 2 — code review of round 1) | branch `claude/r1-lock-held-write` (not yet merged/PR'd) | Claude (this lane) | _(blank — orchestrator to assign)_ | Fixed 4 real findings + 1 cleanup from a code-review pass on round 1. BLOCKING finding: Windows `msvcrt` locks are mandatory, so `refresh`'s unprotected pre-read hit `PermissionError` immediately during a concurrent save and misclassified it as `UnverifiableLock` (demotion), bypassing round 1's enlarged budget entirely. Fixed with a new `Contended` outcome (`desktop_project_lock_record.py`), folding `refresh`'s read into its own locked CAS section (`_cas_update`), the same retry-then-classify treatment for `read`'s other callers (`acquire`, `project_lock_read`), and a bridge-side non-demoting "soft success" mapping for a `Contended` refresh that echoes the last genuinely-observed record (never null/fabricated) — verified `frontend/src/store/projectLock.ts` needs no change. Split the overloaded retry constant into two modest, independent ones and pulled the OS-lock mechanism into its own `desktop_project_lock_oslock.py` module (kept every touched module under the 500-line ceiling). Cleaned up a dead `tmp_path` pre-assignment in `desktop_bridge.py`. Red-first: real forced-contention tests (`threading`, not sampled) in `tests/test_desktop_project_lock_write.py` (`Contended` from both `refresh` and `write_holding_token` while a real writer holds the lock), `tests/test_desktop_project_lock.py` (Windows-PermissionError simulated via `builtins.open` monkeypatching — the real proof is the Windows CI leg — plus a structural "refresh must not pre-read" guard), and `tests/test_desktop_bridge_lock.py` (the end-to-end soft-success mapping under real contention, its no-cached-record fallback, and the generic `Contended`→`unverifiable` mapping for `read`/`acquire`). Full gates green: `ruff check src tests`, `mypy src`, targeted lock/bridge tests (110 passed), full `pytest -q`. Residual risk: still not independently reviewed; real Windows CI leg is the only genuine proof of the mandatory-lock behavior these tests simulate. |

