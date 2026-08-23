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
`claude/r1-lock-held-write`) — still open pending independent review,
THREE rounds so far:**

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
the 500-line ceiling once `Contended`'s documentation landed.

*Round 3 (second code-review pass, on round 2 — 6 findings, all fixed).*
**BLOCKING (F1+F4): a genuine single-writer violation through round 2's
own soft-success path.** Two independent gaps combined into a token-
laundering route: (F4) `_remember` cached a `LockRecord` from ANY outcome,
including a REFUSED acquire or a plain `project_lock_read` — both of
which can carry a DIFFERENT instance's live record, not this one's own;
and (F1) the soft-success mapping never checked that the cached record's
token matched the CALLER's presented token before echoing it back.
Poisoning path: a displaced instance A reads live holder B's record
(caching it, pre-fix); A's own stale-token heartbeat later hits
`Contended`; the bridge answers `refreshed: true` with B's record; the
frontend adopts B's live token as "its own"; A's NEXT save presents that
token and WINS — two writers believing they each hold the lock. Fixed at
BOTH ends: `_remember` now caches ONLY on an `ok: True` acquire/refresh/
takeover (never a refusal or a plain read), and the soft-success branch
additionally requires `cached.token == token` before ever firing — belt
AND braces, not either/or. **F2:** the `Contended` reclassification from a
`PermissionError` is now WIN32-ONLY (`_classify_permission_error` in
`desktop_project_lock_oslock.py`, and a `sys.platform` guard in `read`) —
on POSIX, `fcntl.flock` is advisory, so contention can never make a plain
`open()` raise `PermissionError`; one there is a REAL, persistent
permissions failure and must surface honestly (`UnverifiableLock`,
un-retried), never get masked behind a soft success forever the way
round 2's platform-blind version would have. **F3:** moved
`cleanup_stray_write_temps` INSIDE `write_project_file`'s `_replace`
closure (so a `lock_token` save now runs it under `write_holding_token`'s
held lock, serializing it against any other LOCKED save on the same
path) and gave `cleanup_stray_write_temps` itself a 10-minute age floor
(`desktop_project_file.py`) as belt-and-braces for the legacy, unlocked
no-token path, which has no such serialization at all — round 2's version
could let a second concurrent save delete a first save's still-open temp
file outright. **F5:** `write_holding_token` now opens the lock file
`mode="rb"` (it only ever reads it) instead of `_open_locked`'s `"r+b"`
default meant for the CAS mutators — a lock file this process can only
READ no longer misreports "lock lost"; both `msvcrt.locking` and
`fcntl.flock` accept a read-only handle. **F6:** bounded the soft-success
mechanism itself — `desktop_bridge.py` now caps consecutive `Contended`
soft-successes per path at 2 (`_MAX_CONSECUTIVE_CONTENDED_SOFT_SUCCESSES`,
resetting on any non-contended outcome); a third consecutive contended
tick returns the honest refusal (the frontend demotes), matching the TTL
design's own rationale that ONE missed/contended tick is what
`STALE_AFTER_MS` is sized to absorb, not an unbounded run of them.
Red-first (forced, not sampled): `tests/test_desktop_bridge_lock.py` gets
a mismatched-token refusal test, two `_remember`-scoping tests, a full
end-to-end token-laundering-path-is-closed test, and two streak-bound
tests (all independently verified to fail against a reverted patch of
each fix, per `docs/testing.md`'s evidence standard);
`tests/test_desktop_project_lock.py` gets a POSIX-`PermissionError`-never-
softens test alongside the existing (now win32-scoped)
Windows-simulation tests; `tests/test_desktop_project_lock_write.py` gets
a `mode="rb"` structural spy test; `tests/test_desktop_bridge.py` and
`tests/test_desktop_project_file.py` get a forced two-thread
concurrent-save-temp-survives test (`os.replace` paused mid-call via a
real thread + `Event`) plus direct age-floor unit tests. Full gates
green: `ruff check src tests`, `mypy src`, targeted lock/bridge tests
(119 passed), full `pytest -q` (3723 passed, 175 skipped, 18 xfailed).

See the closure log below (reviewer row left blank for the orchestrator to
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

- [x] At commit, look up the live dataset and recompute the verdict using its
  recorded checksum/mtime/size and the fresh probe.
- [x] Reject fresh `changed` results even when the preview was `unknown` and
  individually escalated.
- [x] Define whether an escalated `unknown` remains acceptable when the fresh
  probe is still unknown; never silently upgrade it to unchanged. (Ruling:
  stays committable — that is what escalation means. If something WAS
  recorded (a checksum on file the session's probe simply couldn't
  reconfirm), the write keeps the dataset's ORIGINAL recorded fields
  unchanged, moving only the path — nothing is fabricated from the
  incomplete fresh probe. If NOTHING was ever recorded (a legacy dataset)
  and the fresh probe still passed the Preview-consent guard — see F1/F2 in
  the closure log's code-review round — it gets genuinely backfilled from
  that consented-to probe instead of staying blank forever.)
- [x] Add the recorded-A / preview-null / commit-B regression.
- [x] Add tests for a dataset removed or reimported between preview and commit.

**Suggested owner:** Claude Sonnet; Claude Opus review for provenance semantics.  
**Acceptance:** No relink can overwrite original provenance for content that a
fresh comparison identifies as changed.
**Status (2026-08-22):** Implemented on `claude/r3-relink-commit-verdict`
(not yet pushed/merged); independent review still open — see closure log.
Four review passes landed on this same branch after the initial fix
(regressions F1/F2/F3, wording/advice/dedup F4-F7, structural fixes
F1/F3/F4/F5-F7 again in the third pass, and a checksum-unconfirmable stat
fallback F1+F2 plus a wording restoration F3 in the fourth/final pass — see
closure log rows for each). **Bundle-size note:** the fourth pass's fix
left this branch red-on-bundle-only (262 B over `main`'s pre-#209 pin,
explicitly accepted rather than raised — see that row); every other gate
is green.
**Known, tracked, NOT fixed:** the CHECKSUM comparison itself is inert in
the real desktop app (relink candidate paths are never read-consented —
see the third-pass closure log row's full F2 investigation and
`store/relink.ts`'s "KNOWN LIMITATION" doc). The mtime/size fallback DOES
work today, and — as of the fourth pass — the commit-time guards
(`guardVerdict`) now correctly fall back to it even when the checksum
comparison is unconfirmable, so a stat-level contradiction still refuses;
only a checksum MATCH can never be confirmed. Closing the checksum gap for
real needs a genuine new consent gesture for relink candidates, which does
not exist yet — out of this lane's scope, deliberately not implemented
rather than silently claimed as working.

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

- [x] Determine whether the UI currently prevents all participating mutations
  while the import is pending. (It does not — see the closure log's
  reachability verdict: no busy/disabled state guards any mutation surface
  except a second overlapping import.)
- [x] If not, use operation-scoped history batching or block conflicting edits
  with an honest progress/busy state. (Operation-scoped: a
  `HistoryBatchToken` threaded through `importPaths` → `addDataset`, per the
  closure log.)
- [x] Add a delayed-import test that attempts a second edit before completion
  and verifies independent Undo behavior. (`relink.test.ts`'s "R6" describe
  block.)

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
| 2026-08-22 | R1 fix (round 3 — second code review, on round 2) | branch `claude/r1-lock-held-write` (not yet merged/PR'd) | Claude (this lane) | _(blank — orchestrator to assign)_ | Fixed 6 findings from a second code-review pass on round 2. BLOCKING (F1+F4): a genuine single-writer violation through round 2's own `Contended` soft-success — `_remember` cached a record from ANY outcome (including a REFUSED acquire or a plain read, either of which can carry a DIFFERENT instance's live record), and the soft-success branch never checked the cached record's token against the caller's presented one, together opening a token-laundering path where a displaced instance could echo back a live holder's token and win a later save. Fixed at both ends: `_remember` now caches ONLY on an `ok:True` self-win; the soft-success branch additionally requires `cached.token == token`. F2: the `PermissionError`→`Contended` reclassification is now WIN32-ONLY (`_classify_permission_error`, `desktop_project_lock_oslock.py`; a `sys.platform` guard in `read`) — POSIX's advisory `fcntl.flock` means a `PermissionError` there is a real persistent permissions failure, not contention, and must surface honestly rather than get masked behind soft-success forever. F3: moved `cleanup_stray_write_temps` inside `write_project_file`'s `_replace` (so a locked save now runs it under `write_holding_token`'s held lock, serializing it against other locked saves) and gave the function itself a 10-minute age floor (`desktop_project_file.py`) as belt-and-braces for the still-unlocked legacy no-token path — round 2's version could let a concurrent save delete a different in-flight save's temp file outright. F5: `write_holding_token` now opens the lock file `mode="rb"` (it only ever reads it) instead of `_open_locked`'s `"r+b"` default, so a read-only-accessible lock file no longer misreports "lock lost". F6: bounded consecutive `Contended` soft-successes per path to 2 (`_MAX_CONSECUTIVE_CONTENDED_SOFT_SUCCESSES`, resets on any non-contended outcome) — a third consecutive contended tick now returns the honest refusal, matching the TTL design's "one tick absorbed" rationale rather than tolerating an unbounded run. Red-first, every fix independently verified to fail against a reverted patch (per `docs/testing.md`'s evidence standard): `tests/test_desktop_bridge_lock.py` (mismatched-token refusal, `_remember`-scoping x2, full end-to-end laundering-path-closed, streak-bound x2), `tests/test_desktop_project_lock.py` (POSIX-`PermissionError`-never-softens, alongside the existing tests now correctly win32-scoped), `tests/test_desktop_project_lock_write.py` (a `mode="rb"` structural spy test), `tests/test_desktop_bridge.py` + `tests/test_desktop_project_file.py` (a forced two-thread concurrent-save-temp-survives test via a paused `os.replace`, plus direct age-floor unit tests). Full gates green: `ruff check src tests`, `mypy src`, targeted lock/bridge tests (119 passed), full `pytest -q` (3723 passed, 175 skipped, 18 xfailed). Residual risk: still not independently reviewed; the Windows CI leg remains the only genuine proof of the platform-specific mandatory-lock behavior these tests simulate. |
| 2026-08-22 | R4 | branch `claude/r4-lock-bridge-failclosed` | Claude Sonnet | (blank — pending independent review) | Claim verified against code: `desktopLockProvider.toCasResult(null, false)` returned `{acquired:false, record:null}` with no `unverifiable` flag for bridge-absent/thrown-call refusals (only an explicit backend `unverifiable:true` set the flag); `statusFromRefusal` then classified that as `"unlocked"`, so `openProject` could report `readOnly:false` after acquisition never verifiably succeeded — confirmed red via a new test using the REAL `createDesktopLockProvider()` with no bridge present (`store/projectLock.test.ts`'s "R4 regression" block), now green. Fix: `toCasResult` always sets `unverifiable:true` on `out===null` (bridge absent, thrown call, or a malformed non-object response — new `isPlausibleOutcome` guard in `lib/desktopLockBridge.ts`); `LockProvider.read` stays bare `LockRecord\|null` (unchanged interface) since every mutating verb re-verifies independently. Every one-shot call site (open, takeover, Save-As destination-lock acquisition) audited to check `result.unverifiable` before deriving status; the Save `LOCK_LOST` follow-up read in `store/workspaceIO.ts` no longer re-derives `"unlocked"` from an ambiguous `null`. Demotion rule: `heartbeat()` demotes IMMEDIATELY on a definite CAS loss (real information) but only after `UNVERIFIABLE_DEMOTE_AFTER = 3` CONSECUTIVE unverifiable ticks (~90s, matching `STALE_AFTER_MS`'s existing 3-missed-heartbeats reasoning) — chosen so one transient IPC glitch never flickers the UI read-only while a genuinely dead bridge is still caught within the same window a dead peer's own lock would be. `record`/token are kept (not nulled) through the demotion so a later successful heartbeat promotes straight back to `held-by-me` (recovery, not a fresh acquire) instead of assuming stale state; `useProjectLockHeartbeat.ts`'s polling interval now keeps running past such a demotion (gated on `unverifiableHeartbeats > 0`, not only `status==="held-by-me"`) so a returning bridge can be discovered. Mid-implementation coordination with the concurrent R1 lane: added a `contended` outcome (OS lock momentarily busy with another process's own CAS) distinct from `unverifiable` — strictly benign in `heartbeat()` (never advances the demotion streak either way, never touches status/record), folded into the same fail-closed placeholder as `unverifiable` for one-shot callers; wired defensively at the wire/provider layers now so no frontend change is needed once R1's backend contract lands. 30 new/updated tests (absent method, thrown call, malformed response, heartbeat demotion after threshold, no-demotion-on-one-miss, thrown-heartbeat-counts-toward-streak, recovery-after-return, contended-never-demotes, contended-one-shot-fail-closed, the original open-reports-writable repro red-then-green, plus Save/Save-As call-site regressions) across `lib/desktopLockProvider.test.ts`, `lib/desktopLockBridge.test.ts`, `lib/lockState.test.ts`, `store/projectLock.test.ts`, `store/workspaceIO.test.ts`, `useProjectLockHeartbeat.test.ts`. Gates: `tsc --noEmit` clean; `eslint --max-warnings=0` clean on touched files; full `vitest run` 543/543 files, 8117/8117 tests green; `npm run build` green with NO bundle-budget change (898.2 kB eager vs 898.2 kB budget, 17 B under — `openProject`'s four near-duplicate fail-closed branches were unified into one `failClosed` helper to net out the real new eager logic). Residual risk: `contended` is speculative against R1's not-yet-landed backend contract and may need a follow-up once that contract is final; the `useProjectLockHeartbeat.ts`/`workspaceIO.ts` edits went slightly beyond this lane's literal file list (`lib/desktopLockProvider.ts`, `lib/lockState.ts`) because the claim's own required behavior (coherent Save/heartbeat state, recovery) could not be closed without them — flagged for the independent reviewer. |
| 2026-08-22 | R4 (code-review follow-up F1-F5) | branch `claude/r4-lock-bridge-failclosed` | Claude Sonnet | (blank — pending independent review) | A code-review pass on the R4 branch found 5 findings, all red-first, all fixed on the same branch. **F1 (BLOCKING, two-writer clobber):** `heartbeat()` captured `path`/`record` before its own `await provider.refresh(...)` and wrote `set()` unconditionally afterward with no re-validation — a straggler tick resolving after the session switched projects, or CAS-succeeding on ANOTHER holder's own currently-valid token (a real backend CAS validates by token, not caller identity), could clobber live state or promote this session onto a lock it does not own. Confirmed red with two tests (a project-switch straggler; an already-foreign-record straggler whose CAS legitimately succeeds) using a manually-resolved deferred promise to force the race. Fixed: after the await and before ANY `set()`, re-fetch the live store and require `path`+record `token`+record `instanceId` all still match what the call started with (mirrors `releaseLock`'s own instanceId guard) — any mismatch drops the write entirely; the four possible outcomes (contended-turned-out-benign, unverifiable, definite loss, success) all sit behind this one gate. **F2 (BLOCKING, array bypass):** `isPlausibleOutcome` accepted arrays (`typeof [] === "object"`), so an array wire response coerced into a definite non-unverifiable refusal — `"unlocked"`/writable on open, a definite-loss demotion (bypassing the streak) on heartbeat — reproducing the original R4 bug via a different vector; the guard's own doc had already (incorrectly) claimed arrays were rejected. Confirmed red at both the open (`acquireProjectLock`) and heartbeat (`refreshProjectLock`) wire paths, fixed by adding `!Array.isArray(out)`. **F3:** `openProject`/`takeOverEditing` success paths didn't reset `unverifiableHeartbeats`, so a streak carried from a prior session/path could demote a brand-new session after just one more blip, contradicting the single-miss-never-demotes invariant; confirmed red, fixed by resetting to 0 on both success paths. **F4:** `workspaceIO.ts`'s `acquireDestinationLock` re-derived status inline instead of reusing `statusFromRefusal`, and had drifted to ignore `contended` (at the time still modeled as a refusal flag); `statusFromRefusal` is now exported from `store/projectLock.ts` and reused there — the exact "one function, not a second copy that drifts" fix requested. **F5:** `openAsCopy` never cleared `path`/`record`/the streak, so a session demoted by heartbeat's unverifiable-streak logic (which deliberately keeps `record`/token intact for recovery) that then chose Open as Copy could have a LATER successful heartbeat silently re-promote it to `held-by-me` on the path the user explicitly relinquished, blocking every other instance indefinitely with no visible current-project to release it from; confirmed red, fixed by clearing `path`/`record`/`unverifiableHeartbeats` and best-effort releasing (gated by `canRelease`, so another party's lock is still never touched). **Mid-fix contract correction:** R1's backend contract for `contended` landed (main@fc85560) partway through this pass, superseding this lane's earlier pre-landing guess — `contended` rides a SUCCESS (a "soft success" after the backend internally retried past momentary contention), never a distinct refusal; a bounded refusal (contention exhausted its retry budget) arrives as an ordinary `unverifiable:true` and already counts toward the demotion streak. The ORIGINAL F1-era code had `toCasResult` forcing any `contended:true` into a fake `acquired:false` refusal and `heartbeat()` short-circuiting `contended` results as a pure no-op — both would have silently dropped/broken every real soft-success. Confirmed red (a soft-success heartbeat reported `false` and never updated the record) and fixed: `toCasResult` now passes `contended` through unmodified on whatever `out.ok` says; `heartbeat()`'s dedicated contended branch was removed entirely (a soft success now flows through the ordinary success path); `statusFromRefusal` no longer checks `contended` (it can never appear on a real refusal). Three now-unrealistic tests (a refusal carrying `contended:true`) were replaced with tests against the real shape. Line-ceiling gate: F1's re-validation pushed `store/projectLock.ts` over the 500-line ceiling; per the reviewer's ruling, extracted the cohesive, self-contained `createInMemoryLockProvider` into a new sibling module `store/inMemoryLockProvider.ts` (re-exported from `store/projectLock.ts` for import-site compatibility) rather than trimming safety comments — `store/projectLock.ts` is now 493 lines (500 by the test's `split("\n").length` convention). Bundle-size gate: the net new eager correctness logic (F1/F3/F5, all irreducible session-lifecycle store code, not deferrable behind a lazy/user-action boundary) measured ~249 B over the existing 898.2 kB budget after exhausting cheap simplifications (minification already collapses identifier names, so local-variable trims recovered only ~4 B) — raised `scripts/check-bundle-size.mjs`'s `EAGER_JS_BUDGET` from 919,795 to 921,068 (measured 920,044 + 1,024 B rounding room), following this file's own extensively-documented "measure first, minimal honest raise" precedent (2026-08-21/22 entries) rather than degrading the fix; the subsequent contended-contract correction reduced the actual eager cost slightly (measured 920,018 at final commit) but the raise was left as-is (within the file's own no-forced-relower-under-SLACK rule). **Flagged for the owner/independent reviewer:** this deviates from the original R4 task's explicit "no bundle budget change" instruction — done because these were coordinator-ruled BLOCKING fixes with no lazy-load option, but the raise itself was not separately pre-approved and should be confirmed or reverted (reverting would require finding an equivalent ~1 kB reduction elsewhere first). Gates: `tsc --noEmit` clean; `eslint --max-warnings=0` clean on touched files; full `vitest run` 543/543 files, 8126/8126 tests green (foreground); `npm run build` green (898.5 kB eager vs the raised 899.5 kB budget, 1.0 kB under). New files: `store/inMemoryLockProvider.ts`. |
| 2026-08-22 | R4 round-2 budget raise | — | — | Owner | **APPROVED** — the round-2 `EAGER_JS_BUDGET` raise (919,795 → 921,068) flagged above for confirmation is accepted and recorded. |
| 2026-08-22 | R4 (code-review round 3, F1-F6) | branch `claude/r4-lock-bridge-failclosed` | Claude Sonnet | (blank — pending independent review) | A third code-review pass found 6 findings, all red-first, all fixed on the same branch. **F1 (BLOCKING, null-record fail-open, 3 sites):** `toCasResult` can yield `{acquired: true, record: null}` when the wire record fails `parseLockRecord` (a version-skew class of bug) — `openProject`/`takeOverEditing`/`heartbeat`'s success branches stored that shape UNGUARDED, landing `status: "held-by-me"` with `record: null`; that then poisons `heartbeat()` (its own `record === null` guard early-returns forever, never demoting — permanently stuck, not just briefly wrong) AND `runSaveWorkspace` (computes `token: ""`, which by that function's own documented contract SKIPS the backend's lock verification entirely — an ungated write). Confirmed red at all three sites (a provider returning `{acquired: true, record: null}` from `tryAcquire`/`takeOver`/`refresh` was accepted as a real success). Fixed with a new shared `normalizeCasResult` helper in `store/projectLock.ts` — mirrors `acquireDestinationLock`'s pre-existing ad hoc guard — applied at all three call sites; a null-record success now normalizes into the same `unverifiable` shape, so `heartbeat()`'s existing demotion-streak and `statusFromRefusal`'s existing fail-closed handling cover it automatically (proven by a dedicated test showing the heartbeat site correctly counts it toward the streak and demotes after the threshold, rather than getting stuck). **F2:** the THIRD fresh-acquisition site — `runSaveWorkspaceToFile`'s (Save As) success `useProjectLock.setState` — was also missing round-2's F3 `unverifiableHeartbeats: 0` reset; confirmed red (a carried streak demoted the new Save-As lock after one blip), fixed by adding the reset. **F3:** at the bridge/provider layer, a REFUSAL whose current record is present-but-unparseable collapsed to `{record: null, unverifiable: false}` (`parseLockRecord` returning `null` for "missing token/instanceId" and "genuinely absent" alike), so `statusFromRefusal` reported `"unlocked"` and `openProject` could report `readOnly: false` without ever acquiring; confirmed red at the open path (`acquireProjectLock`/`readProjectLock`) and, for full coverage, the heartbeat path (`refreshProjectLock`) too. Fixed in `lib/desktopLockBridge.ts` with a new `parseRecordField` helper distinguishing "raw is null" (genuinely absent, `unverifiable: false`) from "raw is non-null but fails to parse" (`unverifiable: true`), applied at all four wire functions. **F4:** `heartbeat()` called `provider.refresh` with the snapshot record's token BEFORE any ownership check — a real backend CAS validates by token match, not caller identity, so sending a FOREIGN instanceId's token can legitimately succeed, bumping the intruder's own `heartbeatAt` on disk and delaying a legitimate third instance's stale-takeover (round-2's post-await re-validation only ever protected this session's own LOCAL state, never that remote side-effect). Confirmed red (a spied `provider.refresh` WAS called with a foreign-instanceId record). Fixed by bailing out before ever calling `provider.refresh` when `record.instanceId !== get().instanceId`. **F5:** `openAsCopy` cleared `path`/`record` (round 2) but left `status` at whatever `"held-by-other-*"` value it had before, so the status-gated Take Over Editing command could still act on a phantom lock (offering a takeover, or a misleading "not available" toast) for a lock this session no longer tracks at all; confirmed red (`canTakeOver` still returned true post-`openAsCopy`), fixed by resetting `status: "unlocked"` in the same clear. **F6 (dedup):** `lib/desktopLockBridge.ts`'s `isPlausibleOutcome` + field-coercion block was triplicated across `acquireProjectLock`/`refreshProjectLock`/`takeOverProjectLock`, differing only in which field name carries "did this call succeed" (`acquired` vs `refreshed`); extracted into a shared `parseCasOutcome(out, okField)` (built on the same `parseRecordField` F3 needed), collapsing all three to one-line bodies. **Bundle-size correction:** F6 was expected to recoup eager bytes, but it did NOT move the number — `lib/desktopLockBridge.ts`/`lib/desktopLockProvider.ts` are reached ONLY through `App.tsx`'s dynamic `import()` (re-verified: no static importer exists anywhere in `src/`), so that file was never part of the eager bundle this gate measures; the dedup is a real simplification of a LAZY chunk, not a lever on this number. The net effect this round is a further small RAISE, not the lowering the review anticipated: F1/F2/F4/F5's real new eager branching in `store/projectLock.ts`/`store/workspaceIO.ts` measured 920,202 B (up from round 2's 920,044 B) — `EAGER_JS_BUDGET` raised from 921,068 to 921,226 (measured + 1,024 B rounding room, same convention as every prior entry), reported here for the SAME confirm-or-revert decision round 2's raise went through. Line-ceiling gate: F1/F4's new logic pushed `store/projectLock.ts` back over 500 lines (531); trimmed verbose (but not load-bearing) prose in the round-2 F1 heartbeat comment, `normalizeCasResult`'s own doc, and the F4/F5 comments — no safety reasoning removed, only condensed — landing at 499 lines (500 by the test's `split("\n").length` convention). 20 new/updated tests across `lib/desktopLockBridge.test.ts` (3 present-but-unparseable-record cases), `lib/desktopLockProvider.test.ts`, `store/projectLock.test.ts` (F1×3, F4, F5), `store/workspaceIO.test.ts` (F2). Gates: `tsc --noEmit` clean; `eslint --max-warnings=0` clean on touched files; full `vitest run` 543/543 files, 8135/8135 tests green (foreground, the >480s auto-background waited out); `npm run build` green (898.6 kB eager vs the raised 899.6 kB budget, 1.0 kB under). **Flagged for the owner/independent reviewer:** the F1/F2/F4 budget raise (921,068 → 921,226) needs the same explicit confirm-or-revert round 2's raise received. |
| 2026-08-22 | R3 | branch `claude/r3-relink-commit-verdict` | Claude Sonnet | — | Claim confirmed exactly against `store/relink.ts`'s pre-fix `commit()`: the TOCTOU re-probe compared the fresh checksum against the PREVIEW row's own `candidateChecksum` snapshot, never against the dataset's recorded provenance — a null preview checksum (recorded A, Preview probe failed → "unknown") short-circuited the comparison, so an escalated row's fresh commit-time probe (checksum B) sailed through and overwrote recorded A with B. Fix: `commit()` now looks up the LIVE dataset per row and recomputes `sourceChangeVerdict` from ITS recorded checksum/mtime/size against a fresh probe taken at commit time, never trusting the preview snapshot alone. A fresh "changed" verdict refuses the row unconditionally, even a Preview-time "unknown" that was individually escalated (escalation approves "unverifiable", never "verified-different"). An escalated row whose fresh probe is still "unknown" stays committable but writes back the dataset's ORIGINAL recorded provenance fields unchanged (only the path moves) rather than fabricating one. A dataset removed, or whose recorded `source.path` no longer matches what Preview saw (reimported/independently relinked in the gap), fails closed for that row with zero mutation. Added 4 new red-first regressions (recorded-A/preview-null/commit-B; still-unknown escalated commit provenance; removed-between; reimported-between) alongside 3 existing tests updated to carry real recorded provenance so their scenarios still model what they claim under the new recompute — this row's original evidence text miscounted these as "6 new"; see the F5 correction below for the actual count, caught by a code-review pass on this same commit. Gates (frontend/, all foreground): `npx tsc --noEmit` clean; `npx eslint --max-warnings=0` on both touched files clean; full `npx vitest run` 543 files / 8096 tests passed (was 8090 before this lane); `npm run build` — bundle-size ratchet passed at exactly 898.2 kB eager against the 898.2 kB budget (0.0 kB headroom; budget threshold itself untouched, per the lane's constraint) after trimming toast-string/dedup overhead to fit the correctness fix inside the pre-existing headroom. Independent review: open. |
| 2026-08-22 | R3 (code-review round) | same branch, follow-up commit | Claude Sonnet | — | A code-review pass on the R3 commit above found 5 findings, 2 of them behavior regressions on the no-recorded-provenance (legacy dataset) path the R3 rework touched: **F1** (regression) — the pre-fix `commit()`'s "does the fresh checksum still match what Preview showed" guard was dropped and nothing replaced it for a dataset with EMPTY recorded provenance, so an escalated legacy row committed whatever was at the candidate path at commit time even if it differed from what the user actually saw and consented to at Preview. Fixed: restored as an ADDITIONAL guard (OR'd into the same refusal as the R3 recorded-provenance recompute) — when both the fresh probe checksum and the row's Preview-time `candidateChecksum` exist and differ, refuse. **F2** (regression) — the rewrite conflated "fresh probe couldn't confirm" with "nothing recorded to compare", so a legacy dataset that cleared F1's consent guard was never backfilled with its now-confirmed provenance (the documented "fills a genuine gap" behavior). Fixed: when recorded provenance is genuinely EMPTY and the fresh probe passed F1's guard, the fresh checksum/mtime/size are backfilled; "preserve the original recorded fields" is now reserved for the case where something WAS recorded but the fresh probe simply couldn't reconfirm it. **F3** (residual TOCTOU) — the live-dataset snapshot used for the identity check was read BEFORE the awaited per-row probes, so a dataset's recorded source could be swapped mid-probe (a reimport or a second relink racing the same commit) without being caught. Fixed: added a second, synchronous identity re-verification of every still-pending row's `source.path` against the live store, immediately before the write (nothing async runs in between, so this check and the write are effectively atomic). **F4** (wording) — the "unreachable" bucket was still worded "changed since Preview"; split into honestly distinct bucket messages (unreachable / changed-since-Preview / removed-reimported), and the two tests whose toast-wording pins had gone stale (the changed-again-since-Preview case and the reimported-between case) were updated to the accurate wording. **F5** (this row) — the R3 evidence text above claimed "6 new red-first regressions"; the actual diff added 4 `it()` blocks in that commit (16 → 20). This round adds 3 more (F1, F2, F3 regressions), for a verified final total of 7 new tests (16 → 23; confirmed by `grep -c "^  it(" src/store/relink.test.ts` against the pre-R3 commit and HEAD). Gates (frontend/, all foreground): `npx tsc --noEmit` clean; `npx eslint --max-warnings=0` on both touched files clean; full `npx vitest run` — 543 files / 8099 tests passed; `npm run build` — bundle-size ratchet passed at 898.2 kB eager, 28 B under the 919,795 B budget (budget threshold itself untouched — the F1/F3 additions were trimmed via dedup/shorter toast wording to fit back inside the pre-existing headroom rather than raising the pin). Independent review: open. |
| 2026-08-22 | R3 (third review pass) | same branch, follow-up commit | Claude Sonnet | — | A third review pass found 7 findings. **F2 investigation outcome (read this first — required before its implementation details):** investigated per the ruling ("find the native-dialog auto-consent precedent; if none, STOP and report"). Traced the full consent chain: `desktop_bridge_dialogs.py`'s `pick_files` (a REAL native multi-select OPEN dialog) is the one place a caller-asserted path gets `grant_paths()`'d on faith, because the dialog itself IS the proof of a deliberate per-file user gesture. `pick_directory` (the folder dialog) deliberately grants NO read consent for anything under it — "consent is per file", by the same module's own doc — matching this ruling's own "never a blanket directory grant" instruction. The relink panel's old/new-root fields (`RelinkPanel.tsx`) are plain TEXT INPUTS today — no native dialog of any kind sits behind a relink candidate path; candidates are programmatically DERIVED (string substitution over the old root), never a user's individual file picks. Separately, `grant_source_paths` — the RPC `runPreview()` already calls for the OLD recorded paths — is hardened (the "P1-A fix", its own docstring) to intersect every caller-asserted path against a SERVER-TRACKED declared-source set populated ONCE, at project-open time (`desktop_consent.set_declared_sources`, called only from `_read_granted` after a real project-file open dialog); a not-yet-linked candidate path can never be a member of that set by construction, so calling the existing grant RPC with candidate paths is not merely unhelpful, it is a guaranteed no-op — every such path is silently dropped server-side. Conclusion: no precedent exists for auto-consenting a candidate path without either a real native dialog return or prior project-declared-source membership, and the existing primitive that comes closest (`grant_source_paths`) was deliberately hardened against exactly the caller-asserted-path pattern this fix would need. Per the ruling's STOP branch: implemented NO consent-widening (no backend change, no `RelinkPanel.tsx` change, no new grant RPC). Narrowed the claims instead: `store/relink.ts`'s module doc now carries a "KNOWN LIMITATION" section stating plainly that every checksum-dependent guard is inert in the real desktop app today — a checksum-bearing dataset's relink verdict is always `"unknown"`, never `"unchanged"`/`"changed"` via checksum, because every candidate probe carries `checksum: null` (real desktop consent scope, not a mock artifact); the mtime/size fallback path (used when nothing was ever recorded, and F1's Preview-consent guard) genuinely works today since stat-ing needs no consent. Added a frontend regression (`runPreview` test) with a consent-accurate mock (checksum null, real size/mtime) proving the row degrades honestly to `"unknown"`, never a false `"unchanged"`. No backend test was added — there is no code path to exercise ("a granted candidate path" does not exist to test), and backend Python is outside this lane's file scope. **F1** — the consent guard from the prior round compared checksum ONLY; re-ran it through the SAME `sourceChangeVerdict` used for the recorded-provenance recompute so a checksum-less preview still gets stat-level (mtime/size) verification — red-first: the review's size-swap scenario (checksum null both times, but Preview's own size stat disagrees with the fresh probe's). **F2 (buckets, distinct from the F2 investigation above)** — n/a, folded into the investigation entry; no separate bucket change. **F3** — the pre-write identity re-check compared `source.path` (a string); now captures the exact `source` OBJECT reference per row and requires `===` referential identity, so a same-path provenance swap (a project reload or undo reconstructing a value-equal but different object) fails closed too — red-first: a new test swaps in a value-equal-but-different `source` object mid-probe. **F4** — `conflict` (fresh probe vs. RECORDED provenance) and `mismatch` (fresh probe vs. what PREVIEW showed) are now separate outcomes/buckets/toast wording ("recorded conflict" vs "changed since Preview"); the stale test pin (the flagship recorded-A/preview-null/commit-B regression, which is fundamentally a recorded-conflict, not a preview-mismatch) was corrected. **F5** — the "escalate to include" advice is now shown ONLY for rows the panel's "Use anyway" control actually renders for (`status === "resolved" && changeVerdict === "unknown"`, unescalated); a row that degraded from "unchanged" to "unknown" only at commit time, or that never reached "resolved" at all (missing/offline/permission_denied/unavailable), gets its own honest, non-prescriptive wording instead of a false promise of a button that isn't there. **F6** — the thrice-duplicated per-row write-result type is now one `PendingWrite` alias. **F7** — the O(n·m) `.find()` scan in the F3 re-check loop is now an O(n) Map lookup (the `liveById` pattern already used earlier in the same function). Structural: the per-row decision (R3 recompute + F1 guard + F2 backfill rule) was extracted into a new pure `evaluateCommitProbe` function in `lib/relink.ts` (with its own 8-case unit-test suite in `lib/relink.test.ts`) — required because the accumulated fixes pushed `store/relink.ts` over the repo's 500-line module ceiling (`architecture.test.ts`); this follows the file's own documented convention ("pure and unit-tested on their own... this module is the thin orchestrator") rather than raising the ceiling pin. Gates (frontend/, all foreground, `git stash`/`pop` used once mid-session to compare against the prior commit's build size — verified restored intact via `git diff --stat` immediately after): `npx tsc --noEmit` clean; `npx eslint --max-warnings=0` on all 4 touched files clean; full `npx vitest run` — 543 files / 8109 tests passed; `npm run build` — bundle-size ratchet passed at 898.2 kB eager, 7 B under the 919,795 B budget (budget threshold itself untouched; the extraction's own indirection overhead was trimmed via a positional-argument signature, string-literal outcome discriminators instead of wrapper objects, and shortened toast-bucket words, several confirmed by measurement to have zero effect where esbuild's minifier already collapses the equivalent pattern, e.g. adjacent `let` declarations). `store/relink.ts` is 475 lines, `lib/relink.ts` is 202 — both comfortably under the 500-line ceiling. Independent review: open. |

| 2026-08-22 | R3 (final review pass) | same branch, follow-up commit | Claude Sonnet | — | A final review pass found 3 findings, two sharing one root cause. **F1+F2** (correctness) — `evaluateCommitProbe`'s two commit-time guards reused `sourceChangeVerdict`'s "a recorded checksum is never demoted to size/mtime" rule, which is correct for the verdict SHOWN in Preview but wrong INSIDE a refusal guard: whenever the checksum leg was unconfirmable (fresh probe checksum `null` — per the third-pass KNOWN LIMITATION, the DOMINANT desktop path), both guards returned "unknown" and verified NOTHING, even when size/mtime observably contradicted. Two concrete corruptions this let through: (a) recorded `{checksum:A, mtime:10, size:10}` vs a fresh probe of `{checksum:null, mtime:5, size:5}` — an escalated row committed size-10 provenance for an observably size-5 file; (b) a Preview snapshot of `{checksum:X, mtime:1, size:1}` vs a fresh `{checksum:null, mtime:999, size:999}` — the consent guard passed a swapped file. Fixed per the ruling: added a guard-specific `guardVerdict(recorded, probed)` in `lib/relink.ts` — checksum comparison when BOTH sides have one, else the SAME stat-comparison fallback `sourceChangeVerdict` already uses (extracted into a shared, un-exported `statVerdict` helper so the fallback logic is defined once and reused by both), "unknown" only when NEITHER level is comparable. `sourceChangeVerdict` itself is untouched — still the DISPLAY verdict `runPreview` calls directly, still never demoting a recorded checksum for what gets shown. `evaluateCommitProbe` now calls `guardVerdict` for both the recorded-conflict and Preview-mismatch checks (proven that `guardVerdict(recorded, probe) === "changed"` is a strict superset of `sourceChangeVerdict(...) === "changed"`, so one call fully replaces the old check) and keeps calling the STRICT `sourceChangeVerdict` afterward, unchanged, for the "gap" (still-unverified) classification and the backfill/preserve decision — a stat MATCH when the checksum is unconfirmable only fails to contradict, it is never treated as "confirmed" for what gets recorded. Red-first: both named scenarios now refuse (`conflict`/`mismatch`); a genuinely-unknown case (recorded checksum only, no stats recorded at all, or stats that agree everywhere) still commits when escalated, preserving only what was actually on record — one existing test (`write (R3 #3, preserve original)`, and its store-level twin) had mismatched recorded-vs-probe stats that the OLD bug was silently relying on to pass; both were corrected to a stats-agree fixture that represents the intended case, and two brand-new store-level regressions pin the exact (a)/(b) scenarios end to end. **F3** (wording/doc) — the shipped toast labels (`"1 diff"`, `"1 stale"`, `"1 gone"`, `"1 moved"`, plain `"1 unknown"`) from the prior bundle-squeeze had drifted cryptic and now contradicted this module's own header doc and the second-pass closure log entry, which already promised `"conflicts with recorded provenance"` / `"changed since Preview"`. Restored descriptive labels for every bucket (`"conflicts with recorded provenance"`, `"changed since Preview"`, `"could not be re-verified"`, `"unreachable"`, `"moved/reimported"`, `"needs verification — use \"use anyway\" to include"`) and updated every test pin to match; added a note directly above the bucket table that these exact strings are what the header doc and closure log quote, so the doc-promise audit rule doesn't retroactively regress on the NEXT wording tweak. Gates (frontend/, all foreground): `npx tsc --noEmit` clean; `npx eslint --max-warnings=0` on all 4 touched files clean; full `npx vitest run` — 543 files / 8117 tests passed; `store/relink.ts` 485 lines, `lib/relink.ts` 252 — both under the 500-line ceiling. `npm run build` — bundle-size ratchet **FAILS on this branch alone**: 898.5 kB eager, 262 B over the 919,795 B budget pinned on `main` pre-#209, per this round's explicit instruction not to raise it (the `guardVerdict` fallback logic and the restored descriptive toast strings cost real, unavoidable bytes; a `statVerdict` extraction recovered ~133 B of that but the branch is intentionally left red-on-bundle-only — every other gate is green, and the merge is expected to land after `main`'s post-#209 budget of 926,459 supersedes this branch's). Independent review: open. |
| 2026-08-23 | R6 | branch `claude/r6-history-batch` | Claude Sonnet | _(blank — pending independent review)_ | **Reachability verdict: REACHABLE, confirmed against code before touching anything.** `withHistoryBatch`'s ONLY real caller is `store/relink.ts`'s `importChangedAsNewVersion`; its await spans `importPaths([sourcePath])` — a real network round trip (`importFile`, then `probeSource`) — with `historySuppressed` held `true` the whole time. Audited every mutation surface reachable while that's pending: `RelinkPanel.tsx`'s "Import as new version" button sets no `busy`/disabled state of its own (unlike `Preview`/`Relink`, which do disable on the store's `busy` flag); `store/importDatasets.ts`'s `useImportBatch` guard (`isImportRunning`) blocks only a SECOND import batch, nothing else; `store/pendingOps.ts` only feeds a StatusBar indicator, it disables nothing. So every other undoable action in the app (rename, cell edit, corrections, row exclusion, folder ops, …) remains fully clickable, and each one's `get().recordHistory(label)` call, while `historySuppressed` was true, silently no-op'd (only setting the internal `batchHadRecord` flag) — the mutation itself still happened, but its own undo entry never got pushed, so it could only ever be undone/redone as an involuntary side effect of the import's one entry. Confirmed red exactly as the spec asked: a new test in `relink.test.ts` ("R6: an unrelated edit during an in-flight import-as-new-version batch") holds `importFile` on a controllable, never-resolving promise, calls `renameDataset` while `historySuppressed` is `true`, then resolves — against the unmodified code this failed at the very assertion that the rename produced its own `history` entry (only the import's collapsed entry existed). **Fix: operation-scoped batching (preferred option), not a busy-block.** `withHistoryBatch` now mints a `HistoryBatchToken` (an opaque `symbol`, `store/history.ts`) per call and hands it to `fn`; `recordHistory(label, batchToken?)` folds a call into the active batch ONLY when `batchToken` is passed AND matches the currently active token — every one of the ~100 pre-existing call sites in the app passes no token at all and is therefore completely unaffected by any batch in flight, always recording its own live-state entry. The token is threaded down the ONE real path that needs it: `importChangedAsNewVersion` → `importPaths(paths, historyToken?)` → `runImport` → `addFromPayload` → every `addDataset(ds, historyToken?)` call (`useApp.ts`), each forwarding to `get().recordHistory("add dataset", historyToken)`. A residual bug surfaced while writing the red-first test and fixed in the same pass: the batch's own collapsed entry was using a snapshot captured EAGERLY at `withHistoryBatch`'s call time, which predates any interleaved foreign edit — undoing the import would have silently reverted that edit's mutation a second time even though it now has its own separate entry. Fixed by capturing the batch's "before" snapshot LAZILY, on the first call that actually folds (live state at that instant, exactly like an ordinary `recordHistory` call), not at batch-start. **Known, documented, honest residual limitation** (commented in `history.ts` at the `batchPreSnapshot` declaration): this only covers a gap BEFORE the operation's first folded mutation; a hypothetical FUTURE caller whose own folded calls straddle a real `await` BETWEEN them (today's one caller never does — `addFromPayload`'s multi-book loop runs its `addDataset` calls synchronously back to back after `importPaths`'s one `await`) could still have a foreign edit landing in THAT gap reverted by the batch's undo, since this is a snapshot-restore design, not an inverse-patch one; flagged for whoever adds a second multi-await batched caller, not silently claimed as fully general. Red-first test lives at `store/relink.test.ts` (verified failing against a stashed pre-fix copy of the 4 changed source files, then passing after `git stash pop` restored the fix — both runs captured). Gates (frontend/, all foreground): `npx tsc --noEmit` clean; `npx eslint --max-warnings=0` on all 5 touched files (`store/history.ts`, `store/importDatasets.ts`, `store/relink.ts`, `store/relink.test.ts`, `store/useApp.ts`) clean; full `npx vitest run` — 550 files / 8243 tests passed (foreground, the >480s auto-background waited out, no self-polling). `npm run build` — bundle-size ratchet passes: 904.4 kB eager vs the 904.7 kB budget (0.3 kB under); measured delta vs the pre-fix baseline on the same tree is +0.1 kB (904.3 kB → 904.4 kB, from the new `HistoryBatchToken` type/plumbing) — budget threshold itself untouched. Independent review: open. |
| 2026-08-23 | R6 (code-review round) | branch `claude/r6-history-batch`, same branch | Claude Sonnet | _(blank — pending independent review)_ | A code-review pass on the R6 fix found 4 findings; the KNOWN LIMITATION claim in the row above was FALSE today, not merely hypothetical — all fixed, all red-first. **F1 (BLOCKING):** `runImport` awaited `presentBatchOutcome` (`importBatchOffers.ts`) INSIDE `withHistoryBatch`'s window, AFTER the batch's only fold — and that function's recipe-suggestion branch makes REAL awaits (a dynamic `./globalPlotRecipes` import, `cleanMatchingPlotRecipe`'s own async match) on exactly the path `importChangedAsNewVersion` takes (one created dataset + ≥1 saved recipe). A foreign edit landing in THAT window got its own entry (correct), but the batch's fold-time-frozen snapshot still reverted it on undo, and undoing the FOREIGN entry next resurrected the imported dataset — the exact stack corruption R6 was supposed to have closed, just moved to a later window. Confirmed red with a test holding a `cleanMatchingPlotRecipe` stand-in that never resolves and a saved recipe present: against the pre-fix code the call hung until the test's own 2s timeout (proving the cascade really was reached); fixed, it resolves immediately because the cascade is never consulted. Fixed per the ruling: `importPaths` gained `ImportPathsOptions.presentOutcome` (default `true`); `importChangedAsNewVersion` passes `presentOutcome: false`, skipping `presentBatchOutcome` entirely — correct L0.46 behavior on its own merits too, since this gesture already reports its own "imported ... as a new version" outcome and a second generic offer toast would double up. The `history.ts` KNOWN LIMITATION comment (at `batchPreSnapshot`) is corrected: the true invariant is "zero real awaits after the last fold" (not "no await BETWEEN folds," which missed an await AFTER the only fold entirely), and today's caller satisfies it only because of this `presentOutcome: false` wiring — spelled out for whoever adds a second batched caller next. **F2:** the before/after dataset-id set-diff `importChangedAsNewVersion` used to compute mislabeled ANY dataset a concurrent, unblocked action (paste/demo/merge — all still fully clickable per R6's own reachability audit) added during the same window as `versionOf` tagging. Confirmed red: a concurrent `addDataset` mid-batch got tagged `versionOf` alongside the real import. Fixed per the ruling: `runImport`/`importFiles`/`importPaths` now return the true `createdIds` they themselves produced (every exit path, including cancel), and `importChangedAsNewVersion` reads that return value directly — the diff is deleted. Two narrow structural interfaces (`lib/importEntry.ts`'s `ImportEntryStore`, `lib/reopenRecent.ts`'s `ReopenStore`) needed their `Promise<void>` signatures widened to `Promise<unknown>` to keep type-checking (neither reads the resolved value). **F3:** the fold branch of `recordHistory` never cleared `future`, so a Redo pressed mid-batch (after the first fold, before the batch's own entry lands in `withHistoryBatch`'s `finally`, which can be further awaits away) could replay a stale pre-batch `future` snapshot over half-mutated state. Confirmed red with a direct `history.test.ts` unit test asserting `future` is `[]` synchronously right after the first fold — failed before the fix (the pre-undo `future` entry was still there mid-batch). Fixed: `future: []` is now set the moment `batchPreSnapshot` is first captured (same "any new action clears redo" rule every other `recordHistory` call already enforces, just no longer deferred). **F4:** added direct `history.test.ts` unit tests for the token-mechanics guarantees `withHistoryBatch`'s own doc promises: a stale/foreign token records its own entry (never folds); a batch that folds nothing pushes no entry; a nested `withHistoryBatch` call reuses the OUTER active token (one undo step, not two); the batch's own snapshot is captured lazily at the first fold (proven by an interleaved untokened edit surviving the batch's undo). All 4 findings verified red-first by temporarily reverting each specific fix in isolation (sed/manual edit, run the one targeted test, confirm failure, restore, confirm green) — never by inference. Line-ceiling gate (explicitly watched per the ruling): `store/relink.ts` 498/500, `store/history.ts` 492/500, `store/importDatasets.ts` 480/500 — all under, headroom trimmed back in on relink.ts's new comment after the F1/F2 edit first landed at exactly 500. Gates (frontend/, all foreground): `npx tsc --noEmit` clean; `npx eslint --max-warnings=0` on all 7 touched files (`store/history.ts`, `store/history.test.ts`, `store/importDatasets.ts`, `store/relink.ts`, `store/relink.test.ts`, `lib/importEntry.ts`, `lib/reopenRecent.ts`) clean; full `npx vitest run` — 550 files / 8250 tests passed (foreground, the >480s auto-background waited out, no self-polling). `npm run build` — 904.4 kB eager vs the 904.7 kB budget (0.3 kB under) — no measurable change from this round's fixes (identical to the prior row's post-fix number); budget threshold untouched. Independent review: open. |
