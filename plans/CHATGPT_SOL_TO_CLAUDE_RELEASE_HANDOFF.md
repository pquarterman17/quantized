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

- [ ] Add **Browse...** beside **New location** and use the operating system folder picker.
- [ ] A directory returned by that picker grants read-only inspection of that directory and descendants for this relink session only.
- [ ] Never create a grant from a path merely typed or pasted. For typed paths, show **Choose folder to verify**; any stat-only preview must be clearly labeled unverified.
- [ ] Keep old/new roots visible. Explain: “Files under the old location will be looked up under the new location; nothing changes until you choose Relink.”
- [ ] **Preview** is non-mutating; **Relink** is the sole commit. Cancel revokes consent and changes nothing.
- [ ] Show a plain-language state per row: **Verified identical**; **Changed** (block relink, offer **Import as new version**); **Could not verify** (deliberate per-row **Use anyway**); and distinct **Missing**, **Offline**, or **Permission denied** outcomes.
- [ ] Re-probe immediately before commit. Preview consent never accepts content changed afterward.
- [ ] Relink changes references/provenance and never rewrites the original source file.

### Native/backend requirements and tests

- [ ] Mint grants only from native-picker returns; canonicalize the root.
- [ ] Permit only canonical descendants. Reject sibling-prefix tricks, `..`, and symlink/junction escapes.
- [ ] Grant no write/delete capability; revoke on dialog close, project change, and app exit.
- [ ] Both Preview and commit probes must use the same bounded grant.
- [ ] Preserve **Offline** for unavailable network roots; never infer deletion or silently broaden credentials.
- [ ] Backend tests cover containment, sibling-prefix rejection, traversal, symlink/junction escape, read-only behavior, and revocation.
- [ ] Frontend tests cover Browse cancellation, session cancellation, every row state/action, and zero mutation before Relink.
- [ ] Integration tests cover identical-at-Preview/changed-before-commit refusal and typed-only paths receiving no grant.
- [ ] Smoke-test Windows and macOS native pickers. Ubuntu is bonus coverage, not a blocker.

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
