# ChatGPT-Sol to Claude: post-sprint release handoff

**Created:** 2026-08-22  
**Author:** ChatGPT-Sol  
**Status:** actionable handoff; check items only after the named evidence exists  
**Coordination:** a separate session recently worked on Diraculator/calculator code. Do not alter calculator files in this lane unless a release-blocking failure proves that work is involved.

## Current truth

> **Superseded 2026-08-26.** The paragraphs below are Sol's 2026-08-22 snapshot, kept as historical evidence. Current state follows.

~~Sol extracted the Plot Recipe persistence schema from the capture implementation and changed recipe capture/matching to load on first recipe action. The production build fell from approximately **904.4 kB to 902.5 kB eager JavaScript** against the unchanged **904.7 kB budget**. This is real, but approximately **2.3 kB is not meaningful working headroom**. R8 remains open; do not raise the budget or mark it complete from this result.~~

~~Installed-app acceptance must use a new candidate. `v0.23.0-rc1` points to `069616d1` and predates the post-sprint fixes and later recipe/calculator work, so RC1 cannot qualify the current tree.~~

### Current truth (2026-08-26)

> **Superseded 2026-08-28.** `v0.23.0` and `v0.23.1` were promoted to
> stable and published as `releases/latest` (release-plumbing PRs
> #249/#250) — RC4 was accepted as the promotion candidate. The bullets
> below (RC4 as the acceptance candidate, `releases/latest` still v0.22.0)
> are historical. The next acceptance candidate will be `v0.23.2-rc1`, cut
> after the Class B (silent-state-corruption) fix branch merges — see
> `SILENT_STATE_CORRUPTION_PLAN.md` tasks #2/#4/#6-#9. No SHA exists yet.

- **R8 is CLOSED.** C2 landed a measured 20.3 kB net eager recovery (PR #218) and lowered the ratchet accordingly. The bundle measures **888.5 kB eager against a 910,711 B (889.4 kB) budget — 0.9 kB headroom** as of `a8a939c1` (was 887.7 kB / 1.7 kB before #241-#245). That is again thin: the ratchet's own header (`frontend/scripts/check-bundle-size.mjs`) requires a lazy split to be attempted before any raise, and separately fails the build if headroom ever exceeds 40 kB. See the open decision recorded under C6.
- **Neither RC1 nor RC2 can qualify the current tree.** RC1 (`069616d1`) predates the post-sprint work. RC2 (`4f51f6e`) was cut and published but never owner-tested, and **19 further merges (#221-#239) landed after it** — including fixes for silent data-integrity defects that a fully green CI did not catch. A new candidate is required.
- **`main` is `a8a939c1`** (2026-08-27, after #241-#245). All CI green; `releases/latest` still `v0.22.0`, so the rollback build is intact. **`v0.23.0-rc4` is the acceptance candidate — RC1, RC2 and RC3 are all disqualified** (see C6 for why RC3 joined them).

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

- [x] Profile the integrated eager graph after the Sol branch lands. (2026-08-23: sourcemap + static-reachability BFS, branch `claude/c2-bundle-topup`.)
- [x] Choose the next coherent lazy boundary, favoring implementation needed only after an explicit gesture. (6 module-boundary splits — see `check-bundle-size.mjs` header.)
- [x] Reach at least **15 kB** measured headroom, preferably **20 kB+**, under an unchanged or lowered budget. (21,178 B / 20.7 kB recovered: 926,154 → 904,976 B.)
- [x] Preserve synchronous workspace parsing and recipe/template behavior. (Pure re-export-boundary moves only; `parseWorkspace` unchanged.)
- [x] Record before/after bytes, eager references, and exact commands in `POST_SPRINT_INDEPENDENT_REVIEW.md`. (See its closure log's 2026-08-23 C2 row.)
- [x] Lower the ratchet when its existing slack rule requires it; never raise it for R8. (`EAGER_JS_BUDGET` 914,047 → 906,000.)

**Closed 2026-08-23** (pending orchestrator review — not yet pushed/PR'd). See the Completion log row below and `POST_SPRINT_INDEPENDENT_REVIEW.md`'s R8 section + closure log for full detail.

**Owner/model:** Claude Sonnet for profiling/implementation. Haiku only for mechanical moves after Sonnet selects the boundary.

### C3. Reconcile release documents

**Goal:** remove stale status claims before cutting a candidate.

- [x] Reconcile `POST_SPRINT_INDEPENDENT_REVIEW.md`, `RELEASE_BLOCKERS.md`, `RC_RELEASE_NOTES_DRAFT.md`, and the Day-7 sprint section against `origin/main` after C1/C2 merge.
- [x] Keep R2 open until owner acceptance occurs; keep R8 open until its measured target is met.
- [x] Replace stale in-flight claims with PRs/SHAs by appending dated closure rows, without rewriting historical evidence.

**Closed 2026-08-23** — PR #219, merge `4f51f6e`. R8 closed by C2's measured recovery; R2 remains open pending owner acceptance (now against RC3, see C6).

**Owner/model:** Claude Haiku for mechanical reconciliation, then Sonnet fact-check.

### C4. Cut and qualify RC2

**Goal:** provide one reproducible candidate containing the reviewed post-sprint tree.

- [x] Cut `v0.23.0-rc2` from the exact reviewed `main` SHA after C1/C2 and record it.
- [x] Run the required frontend, backend, packaging, installer, and platform matrix.
- [x] Publish artifacts/checksums and verify the installed desktop/taskbar icon uses the Quantized logo.
- [ ] ~~Perform owner testing on RC2~~ — **SUPERSEDED by C6/RC3.** RC2 was cut and published but never owner-tested; 19 further merges (#221-#239) landed after it, several fixing silent data-integrity defects. RC2 is no longer a valid acceptance candidate for the same reason RC1 was not.

**Closed 2026-08-23** — tag `v0.23.0-rc2` at `4f51f6e`, `release.yml` run `32622022893`. Verified 2026-08-26: the prerelease carries 8 assets (`Quantized_0.23.0_x64-setup.exe` + `.sig`, `Quantized_0.23.0_aarch64.dmg`, `Quantized_0.23.0_amd64.deb`, three `qz-server-*` archives, `latest.json`), each with a GitHub-recorded sha256 digest. `releases/latest` still points at `v0.22.0`, so the rollback build is intact.

**Owner/model:** Claude Sonnet. Haiku may collect logs/checklists, but should not interpret packaging or integrity failures.

### C5. Installed usability acceptance and stable promotion

**Goal:** validate what static review cannot: window dragging/resizing, intermittent blank subwindows, Origin-project legibility, non-maximized plot/worksheet layout, quick plotting, figure editing, Office copy/paste, relink consent, and recovery.

- [ ] Record pass/fail with screenshots or concise reproduction steps.
- [ ] Copy/paste should take seconds; first production figure remains a 20-minute maximum and unfamiliar-data import a 30-minute maximum.
- [ ] Route defects through PR review. Change wording/tooltips only for reproducible confusion.
- [ ] Promote `v0.23.0` only after blockers close on the exact candidate SHA and rollback/recovery instructions match shipped behavior.

**Owner/model:** owner + Claude Sonnet. Use Sol for follow-up interaction/wording review once owner observations exist.

### C6. Cut and qualify RC3

**Goal:** one reproducible candidate containing the post-RC2 correctness work, since RC2 is no longer valid (see C4).

**Why RC3 exists:** #221-#239 landed 19 merges after RC2. Several fixed defects that were live on `main` with fully green CI and would have shipped in RC2 — an invisible hit box swallowing clicks on the Export control after any box-zoom; Delete on a focused peak row silently removing the user's dataset with no confirm; an arrow key wiping a fit; fifteen ordinary column names (`Kerr`, `Phase`, `Noise`, `Depth`, …) being converted into error bars, costing a plain MOKE file both of its data channels; and a guard that would have silently deleted error bars from every sheet-2+ Origin book. None were caught by a test suite.

- [x] Land the two gaps PR #239 recorded — **PR #241.** Each field classified individually rather than moved as a block; `errorRoles` re-derived from fresh `column_designations` instead of discarded. Designation set aligned with `windows.py`'s real 7-member enum (lowercase `label`/`disregard`, plus the entirely missing `Z`), both sides now pinned to one shared fixture, with a subset pin on `windows_opju.py`'s independent map.
- [x] Complete an independent correctness review of #221-#239 — **four findings, all closed.** Two in #241; the `isNameDrivenMatch` loose/strict asymmetry in **#243** (proven, not assumed: `errorLabelClassify.ts`'s own header forbids using the context-free classifier for pairing-target exclusion, which is exactly what it did — a `Serr`/`dSerr` pair lost its suggestion outright); the fourth booked as the derived-worksheet strip mismatch.
- [x] Cut `v0.23.0-rc3` from the exact reviewed `main` SHA — `412609850e74d83a0e7e4090ed7e8b61e58affc4`, via `cut-tag.yml`. **Subsequently DISQUALIFIED — see below.**
- [x] Dispatch `release.yml` **with the tag as the ref** — both traps held in practice; the build did not start on its own and required the manual dispatch.
- [x] Verify the published prerelease — all 5 jobs green, 9 assets (3 installers, 3 server archives, `.sig`, `latest.json`, `SHA256SUMS`), `prerelease: true`, `releases/latest` still `v0.22.0`.
- [ ] Owner acceptance on the installed build — **now against RC4**, not RC3 (carries C5 and R2).

### RC3 is disqualified; RC4 is the candidate

**`v0.23.0-rc3` must not be promoted.** After it was cut and built, a reimport data-loss bug was confirmed: re-importing any dataset carrying a computed column **deleted the user's measurement column**, returning `labels: ["2x"]`, `values: [[null], …]`, with no toast and no error. `applyReimportMerge` used `recomputeData`, which strips the last `formulas.length` columns before reapplying — correct for every other caller, but the reimport payload is the freshly re-read file that only ever has base columns, so the strip ate real data and the formulas then evaluated to null against a column that no longer existed.

It is **pre-existing, not a regression**: the unchanged-shape branch has always kept formulas and always recomputed, so `v0.23.0-rc1` and `-rc2` carry it too. Both affected paths were reproduced before the fix. #241 widened the reach from "unchanged shape" to "unchanged shape or row-only change"; it did not introduce the defect.

Fixed in **PR #245** (`applyFormulas`, the already-base variant; `recomputeData` had no other non-test caller). **`v0.23.0-rc4` cut at `a8a939c1adb8320d9cbb3e560f1e2e4ffd19c422`** and is the acceptance candidate.

It was found by pulling on a scope note #241 left behind. That PR flagged the concern and correctly declined to fix it as out of scope — but nothing had established whether "out of scope" meant "minor" or "destroys user data."

**Open decisions recorded here rather than silently resolved:**

1. ~~**Checksums.**~~ **RESOLVED — PR #242.** `release.yml` now publishes a `SHA256SUMS` manifest covering every asset, ordered after both `installers` and `updater-manifest` so it can never hash an incomplete set. Two bugs were caught by running the shell against a fixture directory rather than reasoning about it: a whitespace-bearing asset name shattered into four "No such file or directory" errors, and the manifest hashed **itself**, because the `> SHA256SUMS` redirect recreates the file before `find` walks the directory (so deleting it first cannot help). Verified on RC3's real build: **all 8 entries match GitHub's own recorded per-asset digests exactly**, no self-entry, bare filenames, sorted. The manifest is unsigned — it proves a download matches what the build produced, not that the build is trusted.
2. **Bundle headroom (now 0.9 kB, measured on `a8a939c1`).** Defer `ContextMenu` (14.2 kB, the one real lazy-split candidate — but it puts a Suspense fallback on right-click, which the ratchet's own rule forbids on a hot path), or raise the pin with written justification for irreducible eager store/lib growth. Owner call; both are within the documented rules.
3. **macOS coverage.** The pipeline builds `aarch64` only — confirmed empirically on RC3, whose only .dmg is `Quantized_0.23.0_aarch64.dmg`. Fine if Apple Silicon is the only supported target; a gap if not.

**Owner/model:** Claude for cut/qualify/verification; owner for installed acceptance.

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
| 2026-08-23 | C1: relink native folder-grant consent | PR #217, squash-merged as `2f88b28` after the orchestrator review round (6 seam findings fixed: post-pick errors surfaced, late-pick grant revoked, project-switch panel close, busy-disabled Browse…, no prompt without a bridge, picker starts at the typed root; `browseNewRoot` extracted to `store/relinkBrowse.ts` under the 500-line ceiling) | Third grant kind added: `desktop_consent.grant_read_dir`/`is_dir_consented` — read-only, canonical-descendant containment (realpath both sides, `os.path.normcase`-compared), bounded (`_MAX_DIR_ENTRIES=32`), minted ONLY by the new `desktop_bridge_dialogs.pick_relink_directory` js_api method (a real native FOLDER_DIALOG) and revoked by the new `revoke_relink_dir` method plus two more call sites: `_read_granted` (project open/reopen — mirrors `set_declared_sources`'s wholesale-replace) and `server_launch._run_desktop`'s window-closed `finally` block (app exit). `probe_source` now computes a checksum when EITHER `is_consented` OR `is_dir_consented` — closing `store/relink.ts`'s documented KNOWN LIMITATION for the Browse…-granted path (a typed new root still degrades to stat-only, honestly labeled). Frontend: `store/relink.ts` gained `newRootConsented` + `browseNewRoot` (the only path to a `true` flag — `setNewRoot` always clears it) and routed `closePanel`/commit-success through one revoke call; `RelinkPanel.tsx` gained a Browse… button, a Cancel button, the exact required explanation sentence, a "Choose folder to verify" prompt for typed-but-unconsented paths, a session-level stat-only/unverified banner, and plain-language per-row labels (Verified identical / Changed — content differs / Could not verify (+ "included anyway") / Missing / Offline (volume unreachable) / Permission denied) via new `rowLabel`/`rowColor` helpers. R3's merged commit-time verdict protections (`guardVerdict`, the referential-identity pre-write re-check, recompute from RECORDED provenance) are UNTOUCHED — `commit()`'s guard logic and `lib/relink.ts` were not modified, only imports/wiring around them. Backend RED-FIRST tests added: `tests/test_desktop_consent.py` (+18: `grant_read_dir` accept/reject-file/reject-missing, containment on root+descendants+not-yet-created path, false-before-any-grant, sibling-prefix rejection `/data/proj` vs `/data/proj2`, `..`-traversal rejection, POSIX symlink-escape rejection (`os.name=="nt"`-skipped), read-only-never-answers-write, bounded+eviction, `clear_dir_grants` scoped to only dir grants, `clear_consent` also clears dir grants); `tests/test_desktop_bridge.py` (+11: `pick_relink_directory` grants/cancel-grants-nothing/no-window/dialog-failure/refuses-a-file/never-widens-write, `revoke_relink_dir` clears+idempotent, typed-path-never-grants negative assertion, `probe_source` now checksums a dir-granted candidate and still does NOT for a typed-unconsented one, project-open revokes a prior relink dir grant); `tests/test_server_launch.py` (+1: app-exit calls `clear_dir_grants`, mocked webview). Frontend RED-FIRST tests added: `frontend/src/lib/desktopBridge.test.ts` (+7: `pickRelinkDirectory` null/success/CANCELLED/throw, `revokeRelinkDir` no-op/calls/swallows-error); `frontend/src/store/relink.test.ts` (+9: `browseNewRoot` grants+clears-preview / CANCELLED-leaves-everything-unchanged / null-bridge-toasts-and-changes-nothing / typing-never-calls-the-picker (the "typed-only path receives no grant" integration assertion) / typing-after-Browse-clears-consent; `closePanel` revokes+resets flag; `openPanel` never carries a seeded root's consent forward; a successful `commit()` also revokes); `frontend/src/components/workshops/relink/RelinkPanel.test.tsx` (+13, one existing pin updated `needs verification`→`could not verify` for the new wording: exact explanation sentence, Browse… wiring+disabled-without-bridge, "Choose folder to verify" shown/hidden, stat-only banner shown/hidden, Cancel wired to `closePanel` not `commit`+zero-mutation, per-row plain-language labels including the `it.each` Missing/Offline/Permission-denied set). Pre-existing R3 identical-at-Preview/changed-before-commit regressions (recorded-conflict, Preview-mismatch, still-unknown-escalated, reimported/removed-between) re-ran unmodified and green, confirming the commit-time guards are undisturbed. Gates (all foreground): backend `uv run ruff check src tests` clean; `uv run mypy src` — "Success: no issues found in 263 source files"; `uv run pytest -q` — 3751 passed, 175 skipped, 18 xfailed (0 failures); frontend `npx tsc --noEmit` clean; `npx eslint --max-warnings=0 src` clean; full `npx vitest run` — 551 files / 8288 tests passed; `npm run build` — bundle-size ratchet **unchanged and green**: 892.2 kB eager, 0.4 kB under the pre-existing 892.6 kB budget (`EAGER_JS_BUDGET` itself not touched; `RelinkPanel-*.js` confirmed in the lazy-chunk list, not the eager total). `desktop_consent.py` 335 lines, `desktop_bridge_dialogs.py` 359, `desktop_bridge.py` 441, `server_launch.py` unaffected-length (backend 500-line ceiling); `store/relink.ts` 499 lines (general 500-line `.ts` ceiling, 1 line headroom — traded by trimming the module's own header-doc prose, not by cutting behavior), `lib/desktopBridge.ts` 465, `RelinkPanel.tsx` 218 (well under the ~400-line `.tsx` convention). No calculator files touched. | Windows/macOS native-picker smoke test UNMET — no such hardware in this lane; carried to R2/C5 owner acceptance. `store/relink.ts` sits at only 1 line of ceiling headroom — the next feature touching that file needs an extraction, not a line squeeze. A dataset with NO recorded checksum at all still degrades to a legitimate stat-only "Verified identical" even with a Browse…-granted root (pre-existing, documented behavior — unaffected by this fix, not relabeled, since distinguishing it per-row would have required a new `RelinkPreviewRow` field touching ~40 existing test fixtures for a UI nuance already covered by the session-level banner). |
| 2026-08-23 | C2 — finished R8's re-opened bundle-headroom target | branch `claude/c2-bundle-topup`, orchestrator-reviewed (export-preservation diff clean on all 6 splits, build reproduced, 2 doc/naming findings fixed); integrated re-measure after C1 #217: 905,870 B, budget 906,894 | Started from 913,023 B/914,047 budget (post R8+#215 integration). Confirmed the App.tsx `globalPlotRecipes` candidate already resolved (all recipe storage/matching/manager chunks verified lazy, no eager consumer left). Found + fixed 5 more `lib/api.ts`-pattern co-locations (`lib/pageDocument.ts`, `lib/figurepage.ts`, `lib/mapdata.ts`, `lib/quickFigureMapping.ts`, `lib/datasetsplit.ts`, `lib/fitselection.ts` — 6 splits total incl. datasetsplit's tiny one), each a pure module-boundary move to a new sibling `*Actions.ts`/`*Fetch.ts`/`*Default.ts` file. Measured 913,023 → 904,976 B (-8,047 B), 21,178 B (20.7 kB) below the 926,154 B figure R8/#215 both started from — clears the "at least 15 kB, preferably 20 kB+" target. `EAGER_JS_BUDGET` lowered 914,047 → 906,000. Full gates green: tsc, eslint --max-warnings=0, full vitest (551 files/8,261 tests), build 1.0 kB under new budget. Synchronous `parseWorkspace` and all recipe/template behavior unchanged — pure re-export-boundary moves only. Full per-move deltas in `frontend/scripts/check-bundle-size.mjs`'s header and `POST_SPRINT_INDEPENDENT_REVIEW.md`'s closure log. | 20,284 B net recovery from the 926,154 B campaign start on the integrated tree — C2 target met |
| 2026-08-23 | C3 + C4 — docs reconciled, `v0.23.0-rc2` cut and published | C3: PR #219 (merge `4f51f6e`). C4: tag `v0.23.0-rc2` at that same `4f51f6e` (the exact reviewed post-C1/C2/C3 `main`), created via `cut-tag.yml` (proxy no-ops tag pushes) and built by `release.yml` run `32622022893` dispatched with the tag as ref | Release run all legs green in 10 min; published as a GitHub **prerelease** with sha256-digested artifacts: `Quantized_0.23.0_x64-setup.exe` (+`.sig`), `Quantized_0.23.0_aarch64.dmg`, `Quantized_0.23.0_amd64.deb`, `qz-server-{win64.zip,macos.tar.gz,linux.tar.gz}`, `latest.json`. `releases/latest` still `v0.22.0` (rollback build intact); PyPI untouched (`pypi.yml` skips `-rc`). rc2 contains everything through #219 — the full R1-R10 remediation, P1.3 recipes, the 20.3 kB bundle recovery, and the C1 relink consent | C5/R2 installed acceptance on THIS build is the remaining gate (owner): Windows/macOS install, real-data session, Office paste, icon/taskbar, and the native relink Browse… consent flow (the one unmet C1 contract box). Promotion to plain `v0.23.0` is a separate tag after owner sign-off |
| 2026-08-27 | C6 items 1-3 + 6: the two #239 gaps, the independent #221-#239 review, doc reconciliation, and dependency triage | #240 (docs), #241 (gaps), #243 (wizard), #244 (channel remap), #242 (checksums) — `main` at `a8a939c1` | Six PRs merged, every check green on each. **Seven real defects found, none by the test suite**, which stayed green at 8,764 tests throughout. #241: each reimport field classified individually (only `excludedRows` is genuinely row-indexed); `errorRoles` re-derived from fresh designations via the same chokepoint the import path uses; designation set corrected to `windows.py`'s real 7 members (`label`/`disregard` were miscased and `Z` was absent entirely, so a book designated wholly out of those three discarded Origin's own answer for a label guess) and pinned on both sides from ONE shared fixture, plus a subset pin on `windows_opju.py`'s independent map (red-proven by renaming `"Z"`→`"Z-axis"`). #243: `isNameDrivenMatch` used the context-free classifier for a pairing-target-exclusion decision that `errorLabelClassify.ts`'s own header forbids — red 2 failed/40 passed with an `R`/`dR` control green on both sides, isolating the cause to the base column's own classification. #244: five channel-index staleness gaps, incl. `fitSpec` — `fitselection.ts:124` guards only out-of-range, and `recalcFits.ts:63` stamps the result back, so removing a computed column **silently overwrote a saved fit's params with a fit of the wrong column**; red 16/34 then 6/30, with rendered-consequence assertions (`expected [999,999] to deeply equal [7,7]`). #242: `SHA256SUMS`, with two bugs caught by running the shell against a fixture rather than reasoning about it (whitespace filenames; the manifest hashing itself via the redirect). | #61 (saved-figure `plot.view` cosmetic remap) and #62 (derived-worksheet strip) booked, neither release-blocking. Bundle headroom down to 0.9 kB. |
| 2026-08-27 | C6 items 4-5: RC3 cut, disqualified, RC4 cut | rc3 `412609850e74d83a0e7e4090ed7e8b61e58affc4`; **rc4 `a8a939c1adb8320d9cbb3e560f1e2e4ffd19c422`** | RC3 build: all 5 jobs green in ~10 min (3 installers + sidecar smoke tests, updater manifest, checksums), 9 assets, `prerelease: true`, `releases/latest` still `v0.22.0`. **`SHA256SUMS` verified independently: all 8 entries match GitHub's own recorded per-asset sha256 digests exactly**, no self-entry, bare filenames, sorted — the new job works on its first real run. Both documented tag traps held: the proxy still no-ops tag pushes (so `cut-tag.yml` was required), and the `GITHUB_TOKEN`-created tag did not fire the tag-push trigger (so `release.yml` needed a manual dispatch with the tag as ref). | **RC3 disqualified after the cut** by the reimport data-loss bug (#245) — pre-existing, so RC1/RC2 carry it too. RC4 supersedes it. Owner acceptance on the installed RC4 build remains the gate. |
