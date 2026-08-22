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
Three code-review passes landed on this same branch after the initial fix
(regressions F1/F2/F3, wording/advice/dedup F4-F7, and structural fixes
F1/F3/F4/F5-F7 again in the third pass — see closure log rows for each).
**Known, tracked, NOT fixed:** checksum-dependent verification is inert in
the real desktop app (relink candidate paths are never read-consented —
see the third-pass closure log row's full F2 investigation and
`store/relink.ts`'s "KNOWN LIMITATION" doc); the mtime/size fallback path
does work today. Closing this gap needs a genuine new consent gesture for
relink candidates, which does not exist yet — out of this lane's scope,
deliberately not implemented rather than silently claimed as working.

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
| 2026-08-22 | R3 | branch `claude/r3-relink-commit-verdict` | Claude Sonnet | — | Claim confirmed exactly against `store/relink.ts`'s pre-fix `commit()`: the TOCTOU re-probe compared the fresh checksum against the PREVIEW row's own `candidateChecksum` snapshot, never against the dataset's recorded provenance — a null preview checksum (recorded A, Preview probe failed → "unknown") short-circuited the comparison, so an escalated row's fresh commit-time probe (checksum B) sailed through and overwrote recorded A with B. Fix: `commit()` now looks up the LIVE dataset per row and recomputes `sourceChangeVerdict` from ITS recorded checksum/mtime/size against a fresh probe taken at commit time, never trusting the preview snapshot alone. A fresh "changed" verdict refuses the row unconditionally, even a Preview-time "unknown" that was individually escalated (escalation approves "unverifiable", never "verified-different"). An escalated row whose fresh probe is still "unknown" stays committable but writes back the dataset's ORIGINAL recorded provenance fields unchanged (only the path moves) rather than fabricating one. A dataset removed, or whose recorded `source.path` no longer matches what Preview saw (reimported/independently relinked in the gap), fails closed for that row with zero mutation. Added 4 new red-first regressions (recorded-A/preview-null/commit-B; still-unknown escalated commit provenance; removed-between; reimported-between) alongside 3 existing tests updated to carry real recorded provenance so their scenarios still model what they claim under the new recompute — this row's original evidence text miscounted these as "6 new"; see the F5 correction below for the actual count, caught by a code-review pass on this same commit. Gates (frontend/, all foreground): `npx tsc --noEmit` clean; `npx eslint --max-warnings=0` on both touched files clean; full `npx vitest run` 543 files / 8096 tests passed (was 8090 before this lane); `npm run build` — bundle-size ratchet passed at exactly 898.2 kB eager against the 898.2 kB budget (0.0 kB headroom; budget threshold itself untouched, per the lane's constraint) after trimming toast-string/dedup overhead to fit the correctness fix inside the pre-existing headroom. Independent review: open. |
| 2026-08-22 | R3 (code-review round) | same branch, follow-up commit | Claude Sonnet | — | A code-review pass on the R3 commit above found 5 findings, 2 of them behavior regressions on the no-recorded-provenance (legacy dataset) path the R3 rework touched: **F1** (regression) — the pre-fix `commit()`'s "does the fresh checksum still match what Preview showed" guard was dropped and nothing replaced it for a dataset with EMPTY recorded provenance, so an escalated legacy row committed whatever was at the candidate path at commit time even if it differed from what the user actually saw and consented to at Preview. Fixed: restored as an ADDITIONAL guard (OR'd into the same refusal as the R3 recorded-provenance recompute) — when both the fresh probe checksum and the row's Preview-time `candidateChecksum` exist and differ, refuse. **F2** (regression) — the rewrite conflated "fresh probe couldn't confirm" with "nothing recorded to compare", so a legacy dataset that cleared F1's consent guard was never backfilled with its now-confirmed provenance (the documented "fills a genuine gap" behavior). Fixed: when recorded provenance is genuinely EMPTY and the fresh probe passed F1's guard, the fresh checksum/mtime/size are backfilled; "preserve the original recorded fields" is now reserved for the case where something WAS recorded but the fresh probe simply couldn't reconfirm it. **F3** (residual TOCTOU) — the live-dataset snapshot used for the identity check was read BEFORE the awaited per-row probes, so a dataset's recorded source could be swapped mid-probe (a reimport or a second relink racing the same commit) without being caught. Fixed: added a second, synchronous identity re-verification of every still-pending row's `source.path` against the live store, immediately before the write (nothing async runs in between, so this check and the write are effectively atomic). **F4** (wording) — the "unreachable" bucket was still worded "changed since Preview"; split into honestly distinct bucket messages (unreachable / changed-since-Preview / removed-reimported), and the two tests whose toast-wording pins had gone stale (the changed-again-since-Preview case and the reimported-between case) were updated to the accurate wording. **F5** (this row) — the R3 evidence text above claimed "6 new red-first regressions"; the actual diff added 4 `it()` blocks in that commit (16 → 20). This round adds 3 more (F1, F2, F3 regressions), for a verified final total of 7 new tests (16 → 23; confirmed by `grep -c "^  it(" src/store/relink.test.ts` against the pre-R3 commit and HEAD). Gates (frontend/, all foreground): `npx tsc --noEmit` clean; `npx eslint --max-warnings=0` on both touched files clean; full `npx vitest run` — 543 files / 8099 tests passed; `npm run build` — bundle-size ratchet passed at 898.2 kB eager, 28 B under the 919,795 B budget (budget threshold itself untouched — the F1/F3 additions were trimmed via dedup/shorter toast wording to fit back inside the pre-existing headroom rather than raising the pin). Independent review: open. |
| 2026-08-22 | R3 (third review pass) | same branch, follow-up commit | Claude Sonnet | — | A third review pass found 7 findings. **F2 investigation outcome (read this first — required before its implementation details):** investigated per the ruling ("find the native-dialog auto-consent precedent; if none, STOP and report"). Traced the full consent chain: `desktop_bridge_dialogs.py`'s `pick_files` (a REAL native multi-select OPEN dialog) is the one place a caller-asserted path gets `grant_paths()`'d on faith, because the dialog itself IS the proof of a deliberate per-file user gesture. `pick_directory` (the folder dialog) deliberately grants NO read consent for anything under it — "consent is per file", by the same module's own doc — matching this ruling's own "never a blanket directory grant" instruction. The relink panel's old/new-root fields (`RelinkPanel.tsx`) are plain TEXT INPUTS today — no native dialog of any kind sits behind a relink candidate path; candidates are programmatically DERIVED (string substitution over the old root), never a user's individual file picks. Separately, `grant_source_paths` — the RPC `runPreview()` already calls for the OLD recorded paths — is hardened (the "P1-A fix", its own docstring) to intersect every caller-asserted path against a SERVER-TRACKED declared-source set populated ONCE, at project-open time (`desktop_consent.set_declared_sources`, called only from `_read_granted` after a real project-file open dialog); a not-yet-linked candidate path can never be a member of that set by construction, so calling the existing grant RPC with candidate paths is not merely unhelpful, it is a guaranteed no-op — every such path is silently dropped server-side. Conclusion: no precedent exists for auto-consenting a candidate path without either a real native dialog return or prior project-declared-source membership, and the existing primitive that comes closest (`grant_source_paths`) was deliberately hardened against exactly the caller-asserted-path pattern this fix would need. Per the ruling's STOP branch: implemented NO consent-widening (no backend change, no `RelinkPanel.tsx` change, no new grant RPC). Narrowed the claims instead: `store/relink.ts`'s module doc now carries a "KNOWN LIMITATION" section stating plainly that every checksum-dependent guard is inert in the real desktop app today — a checksum-bearing dataset's relink verdict is always `"unknown"`, never `"unchanged"`/`"changed"` via checksum, because every candidate probe carries `checksum: null` (real desktop consent scope, not a mock artifact); the mtime/size fallback path (used when nothing was ever recorded, and F1's Preview-consent guard) genuinely works today since stat-ing needs no consent. Added a frontend regression (`runPreview` test) with a consent-accurate mock (checksum null, real size/mtime) proving the row degrades honestly to `"unknown"`, never a false `"unchanged"`. No backend test was added — there is no code path to exercise ("a granted candidate path" does not exist to test), and backend Python is outside this lane's file scope. **F1** — the consent guard from the prior round compared checksum ONLY; re-ran it through the SAME `sourceChangeVerdict` used for the recorded-provenance recompute so a checksum-less preview still gets stat-level (mtime/size) verification — red-first: the review's size-swap scenario (checksum null both times, but Preview's own size stat disagrees with the fresh probe's). **F2 (buckets, distinct from the F2 investigation above)** — n/a, folded into the investigation entry; no separate bucket change. **F3** — the pre-write identity re-check compared `source.path` (a string); now captures the exact `source` OBJECT reference per row and requires `===` referential identity, so a same-path provenance swap (a project reload or undo reconstructing a value-equal but different object) fails closed too — red-first: a new test swaps in a value-equal-but-different `source` object mid-probe. **F4** — `conflict` (fresh probe vs. RECORDED provenance) and `mismatch` (fresh probe vs. what PREVIEW showed) are now separate outcomes/buckets/toast wording ("recorded conflict" vs "changed since Preview"); the stale test pin (the flagship recorded-A/preview-null/commit-B regression, which is fundamentally a recorded-conflict, not a preview-mismatch) was corrected. **F5** — the "escalate to include" advice is now shown ONLY for rows the panel's "Use anyway" control actually renders for (`status === "resolved" && changeVerdict === "unknown"`, unescalated); a row that degraded from "unchanged" to "unknown" only at commit time, or that never reached "resolved" at all (missing/offline/permission_denied/unavailable), gets its own honest, non-prescriptive wording instead of a false promise of a button that isn't there. **F6** — the thrice-duplicated per-row write-result type is now one `PendingWrite` alias. **F7** — the O(n·m) `.find()` scan in the F3 re-check loop is now an O(n) Map lookup (the `liveById` pattern already used earlier in the same function). Structural: the per-row decision (R3 recompute + F1 guard + F2 backfill rule) was extracted into a new pure `evaluateCommitProbe` function in `lib/relink.ts` (with its own 8-case unit-test suite in `lib/relink.test.ts`) — required because the accumulated fixes pushed `store/relink.ts` over the repo's 500-line module ceiling (`architecture.test.ts`); this follows the file's own documented convention ("pure and unit-tested on their own... this module is the thin orchestrator") rather than raising the ceiling pin. Gates (frontend/, all foreground, `git stash`/`pop` used once mid-session to compare against the prior commit's build size — verified restored intact via `git diff --stat` immediately after): `npx tsc --noEmit` clean; `npx eslint --max-warnings=0` on all 4 touched files clean; full `npx vitest run` — 543 files / 8109 tests passed; `npm run build` — bundle-size ratchet passed at 898.2 kB eager, 7 B under the 919,795 B budget (budget threshold itself untouched; the extraction's own indirection overhead was trimmed via a positional-argument signature, string-literal outcome discriminators instead of wrapper objects, and shortened toast-bucket words, several confirmed by measurement to have zero effect where esbuild's minifier already collapses the equivalent pattern, e.g. adjacent `let` declarations). `store/relink.ts` is 475 lines, `lib/relink.ts` is 202 — both comfortably under the 500-line ceiling. Independent review: open. |

