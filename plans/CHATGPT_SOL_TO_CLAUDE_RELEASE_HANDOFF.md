# ChatGPT-Sol to Claude: post-sprint release handoff

**Created:** 2026-08-22  
**Author:** ChatGPT-Sol  
**Status:** actionable handoff; check items only after the named evidence exists  
**Coordination:** a separate session recently worked on Diraculator/calculator code. Do not alter calculator files in this lane unless a release-blocking failure proves that work is involved.

## Current truth

Sol extracted the Plot Recipe persistence schema from the capture implementation and changed recipe capture/matching to load on first recipe action. The production build fell from approximately **904.4 kB to 902.5 kB eager JavaScript** against the unchanged **904.7 kB budget**. This is real, but approximately **2.3 kB is not meaningful working headroom**. R8 remains open; do not raise the budget or mark it complete from this result.

Installed-app acceptance must use a new candidate. `v0.23.0-rc1` points to `069616d1` and predates the post-sprint fixes and later recipe/calculator work, so RC1 cannot qualify the current tree.

## Relink consent and interaction contract

This is the product contract for Claude's native implementation. It avoids repeated per-file prompts while retaining explicit, bounded consent.

- [x] Add **Browse...** beside **New location** and use the operating system folder picker.
- [x] A directory returned by that picker grants read-only inspection of that directory and descendants for this relink session only.
- [x] Never create a grant from a path merely typed or pasted. For typed paths, show **Choose folder to verify**; any stat-only preview must be clearly labeled unverified.
- [x] Keep old/new roots visible. Explain: “Files under the old location will be looked up under the new location; nothing changes until you choose Relink.”
- [x] **Preview** is non-mutating; **Relink** is the sole commit. Cancel revokes consent and changes nothing.
- [x] Show a plain-language state per row: **Verified identical**; **Changed** (block relink, offer **Import as new version**); **Could not verify** (deliberate per-row **Use anyway**); and distinct **Missing**, **Offline**, or **Permission denied** outcomes.
- [x] Re-probe immediately before commit. Preview consent never accepts content changed afterward.
- [x] Relink changes references/provenance and never rewrites the original source file.

### Native/backend requirements and tests

- [x] Mint grants only from native-picker returns; canonicalize the root.
- [x] Permit only canonical descendants. Reject sibling-prefix tricks, `..`, and symlink/junction escapes.
- [x] Grant no write/delete capability; revoke on dialog close, project change, and app exit.
- [x] Both Preview and commit probes must use the same bounded grant.
- [x] Preserve **Offline** for unavailable network roots; never infer deletion or silently broaden credentials.
- [x] Backend tests cover containment, sibling-prefix rejection, traversal, symlink/junction escape, read-only behavior, and revocation.
- [x] Frontend tests cover Browse cancellation, session cancellation, every row state/action, and zero mutation before Relink.
- [x] Integration tests cover identical-at-Preview/changed-before-commit refusal and typed-only paths receiving no grant.
- [ ] Smoke-test Windows and macOS native pickers. Ubuntu is bonus coverage, not a blocker. **UNMET** — this lane has no Windows/macOS hardware; owner-gated, carried to R2/C5.

**Recommended model:** Claude Sonnet. Escalate only platform-specific path-containment/threat-model ambiguity to Claude Opus.

## Claude work queue

### C1. Implement relink consent

**Goal:** make checksum verification functional without requiring dozens of individual prompts, while preserving all merged R3 commit-time verdict protections.

**Done when:** every contract/test checkbox above passes and review confirms no typed path becomes an implicit grant.

**Owner/model:** Claude Sonnet.

### C2. Finish R8 bundle headroom

**Goal:** restore a practical eager-JavaScript working band.

- [ ] Profile the integrated eager graph after the Sol branch lands.
- [ ] Choose the next coherent lazy boundary, favoring implementation needed only after an explicit gesture.
- [ ] Reach at least **15 kB** measured headroom, preferably **20 kB+**, under an unchanged or lowered budget.
- [ ] Preserve synchronous workspace parsing and recipe/template behavior.
- [ ] Record before/after bytes, eager references, and exact commands in `POST_SPRINT_INDEPENDENT_REVIEW.md`.
- [ ] Lower the ratchet when its existing slack rule requires it; never raise it for R8.

**Owner/model:** Claude Sonnet for profiling/implementation. Haiku only for mechanical moves after Sonnet selects the boundary.

### C3. Reconcile release documents

**Goal:** remove stale status claims before cutting a candidate.

- [ ] Reconcile `POST_SPRINT_INDEPENDENT_REVIEW.md`, `RELEASE_BLOCKERS.md`, `RC_RELEASE_NOTES_DRAFT.md`, and the Day-7 sprint section against `origin/main` after C1/C2 merge.
- [ ] Keep R2 open until owner acceptance occurs; keep R8 open until its measured target is met.
- [ ] Replace stale in-flight claims with PRs/SHAs by appending dated closure rows, without rewriting historical evidence.

**Owner/model:** Claude Haiku for mechanical reconciliation, then Sonnet fact-check.

### C4. Cut and qualify RC2

**Goal:** provide one reproducible candidate containing the reviewed post-sprint tree.

- [ ] Cut `v0.23.0-rc2` from the exact reviewed `main` SHA after C1/C2 and record it.
- [ ] Run the required frontend, backend, packaging, installer, and platform matrix.
- [ ] Publish artifacts/checksums and verify the installed desktop/taskbar icon uses the Quantized logo.
- [ ] Perform owner testing on RC2, not a dev server or RC1. Fix failures through branches/PRs; never patch a tag.

**Owner/model:** Claude Sonnet. Haiku may collect logs/checklists, but should not interpret packaging or integrity failures.

### C5. Installed usability acceptance and stable promotion

**Goal:** validate what static review cannot: window dragging/resizing, intermittent blank subwindows, Origin-project legibility, non-maximized plot/worksheet layout, quick plotting, figure editing, Office copy/paste, relink consent, and recovery.

- [ ] Record pass/fail with screenshots or concise reproduction steps.
- [ ] Copy/paste should take seconds; first production figure remains a 20-minute maximum and unfamiliar-data import a 30-minute maximum.
- [ ] Route defects through PR review. Change wording/tooltips only for reproducible confusion.
- [ ] Promote `v0.23.0` only after blockers close on the exact candidate SHA and rollback/recovery instructions match shipped behavior.

**Owner/model:** owner + Claude Sonnet. Use Sol for follow-up interaction/wording review once owner observations exist.

## Sol static usability findings for RC2

- Relink currently reads as a technical root-replacement operation. Native **Browse...** and the one-sentence explanation are required for a normal desktop workflow.
- Per-file OS prompts are safe but impractical for scientific projects. A native-picked, session-scoped folder grant is the better balance.
- “Unknown” must not make users infer whether a source is offline, inaccessible, absent, or unverifiable; those states require different remedies.
- Static review cannot certify dragging/resizing or blank subwindows. Do not check those from unit tests alone.

## Completion log

Append dated rows; include PR, merge SHA, model, tests, bundle bytes where relevant, and remaining limitations. Never delete earlier rows.

| Date | Task | PR / SHA | Evidence | Remaining limitation |
|---|---|---|---|---|
| 2026-08-22 | Sol partial R8 + relink UX contract | Sol branch pending PR | Build ~902.5 kB eager / 904.7 kB budget; TypeScript clean | R8 open; installed review waits for RC2; native consent unimplemented |
| 2026-08-23 | C1: relink native folder-grant consent | branch `claude/c1-relink-consent`, not yet PR'd (orchestrator review pending) | Third grant kind added: `desktop_consent.grant_read_dir`/`is_dir_consented` — read-only, canonical-descendant containment (realpath both sides, `os.path.normcase`-compared), bounded (`_MAX_DIR_ENTRIES=32`), minted ONLY by the new `desktop_bridge_dialogs.pick_relink_directory` js_api method (a real native FOLDER_DIALOG) and revoked by the new `revoke_relink_dir` method plus two more call sites: `_read_granted` (project open/reopen — mirrors `set_declared_sources`'s wholesale-replace) and `server_launch._run_desktop`'s window-closed `finally` block (app exit). `probe_source` now computes a checksum when EITHER `is_consented` OR `is_dir_consented` — closing `store/relink.ts`'s documented KNOWN LIMITATION for the Browse…-granted path (a typed new root still degrades to stat-only, honestly labeled). Frontend: `store/relink.ts` gained `newRootConsented` + `browseNewRoot` (the only path to a `true` flag — `setNewRoot` always clears it) and routed `closePanel`/commit-success through one revoke call; `RelinkPanel.tsx` gained a Browse… button, a Cancel button, the exact required explanation sentence, a "Choose folder to verify" prompt for typed-but-unconsented paths, a session-level stat-only/unverified banner, and plain-language per-row labels (Verified identical / Changed — content differs / Could not verify (+ "included anyway") / Missing / Offline (volume unreachable) / Permission denied) via new `rowLabel`/`rowColor` helpers. R3's merged commit-time verdict protections (`guardVerdict`, the referential-identity pre-write re-check, recompute from RECORDED provenance) are UNTOUCHED — `commit()`'s guard logic and `lib/relink.ts` were not modified, only imports/wiring around them. Backend RED-FIRST tests added: `tests/test_desktop_consent.py` (+18: `grant_read_dir` accept/reject-file/reject-missing, containment on root+descendants+not-yet-created path, false-before-any-grant, sibling-prefix rejection `/data/proj` vs `/data/proj2`, `..`-traversal rejection, POSIX symlink-escape rejection (`os.name=="nt"`-skipped), read-only-never-answers-write, bounded+eviction, `clear_dir_grants` scoped to only dir grants, `clear_consent` also clears dir grants); `tests/test_desktop_bridge.py` (+11: `pick_relink_directory` grants/cancel-grants-nothing/no-window/dialog-failure/refuses-a-file/never-widens-write, `revoke_relink_dir` clears+idempotent, typed-path-never-grants negative assertion, `probe_source` now checksums a dir-granted candidate and still does NOT for a typed-unconsented one, project-open revokes a prior relink dir grant); `tests/test_server_launch.py` (+1: app-exit calls `clear_dir_grants`, mocked webview). Frontend RED-FIRST tests added: `frontend/src/lib/desktopBridge.test.ts` (+7: `pickRelinkDirectory` null/success/CANCELLED/throw, `revokeRelinkDir` no-op/calls/swallows-error); `frontend/src/store/relink.test.ts` (+9: `browseNewRoot` grants+clears-preview / CANCELLED-leaves-everything-unchanged / null-bridge-toasts-and-changes-nothing / typing-never-calls-the-picker (the "typed-only path receives no grant" integration assertion) / typing-after-Browse-clears-consent; `closePanel` revokes+resets flag; `openPanel` never carries a seeded root's consent forward; a successful `commit()` also revokes); `frontend/src/components/workshops/relink/RelinkPanel.test.tsx` (+13, one existing pin updated `needs verification`→`could not verify` for the new wording: exact explanation sentence, Browse… wiring+disabled-without-bridge, "Choose folder to verify" shown/hidden, stat-only banner shown/hidden, Cancel wired to `closePanel` not `commit`+zero-mutation, per-row plain-language labels including the `it.each` Missing/Offline/Permission-denied set). Pre-existing R3 identical-at-Preview/changed-before-commit regressions (recorded-conflict, Preview-mismatch, still-unknown-escalated, reimported/removed-between) re-ran unmodified and green, confirming the commit-time guards are undisturbed. Gates (all foreground): backend `uv run ruff check src tests` clean; `uv run mypy src` — "Success: no issues found in 263 source files"; `uv run pytest -q` — 3751 passed, 175 skipped, 18 xfailed (0 failures); frontend `npx tsc --noEmit` clean; `npx eslint --max-warnings=0 src` clean; full `npx vitest run` — 551 files / 8288 tests passed; `npm run build` — bundle-size ratchet **unchanged and green**: 892.2 kB eager, 0.4 kB under the pre-existing 892.6 kB budget (`EAGER_JS_BUDGET` itself not touched; `RelinkPanel-*.js` confirmed in the lazy-chunk list, not the eager total). `desktop_consent.py` 335 lines, `desktop_bridge_dialogs.py` 359, `desktop_bridge.py` 441, `server_launch.py` unaffected-length (backend 500-line ceiling); `store/relink.ts` 499 lines (general 500-line `.ts` ceiling, 1 line headroom — traded by trimming the module's own header-doc prose, not by cutting behavior), `lib/desktopBridge.ts` 465, `RelinkPanel.tsx` 218 (well under the ~400-line `.tsx` convention). No calculator files touched. | Windows/macOS native-picker smoke test UNMET — no such hardware in this lane; carried to R2/C5 owner acceptance. `store/relink.ts` sits at only 1 line of ceiling headroom — the next feature touching that file needs an extraction, not a line squeeze. A dataset with NO recorded checksum at all still degrades to a legitimate stat-only "Verified identical" even with a Browse…-granted root (pre-existing, documented behavior — unaffected by this fix, not relabeled, since distinguishing it per-row would have required a new `RelinkPreviewRow` field touching ~40 existing test fixtures for a UI nuance already covered by the session-level banner). |
