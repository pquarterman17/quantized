# Release-candidate notes draft — v0.23.0-rc1 (proposed)

**Status:** FINAL for v0.23.0-rc1; extended 2026-08-23 with the
"Changes since rc1 → v0.23.0-rc2" section, and again 2026-08-27 with
"Changes since rc2 → rc3 → rc4" at the end. **The current acceptance
candidate is `v0.23.0-rc4` (`a8a939c1`); rc1, rc2 and rc3 are all
disqualified** — see that final section for why, including a data-loss
defect verified present in v0.22.0. The rc1 body below
it is a frozen record — two Known-limitations bullets carry dated
"superseded on main" annotations rather than edits. Original: FINAL for
v0.23.0-rc1 — owner gave the explicit tag go on
2026-08-22 after the audit wave (#194–#200) and her local verification
campaign (corpus re-sweep 350 graphs / 0 renderer failures, DiraCulator
golden freeze, live Origin COM oracles) landed. Published as a GitHub
**prerelease**: auto-update keeps serving v0.22.0 until promotion.

**Candidate commit:** the `v0.23.0-rc1` tag target (main after #200 + the
2026-08-21 verification-campaign commits) — exact SHA `069616d1`, published
via release workflow run `32548354991` (all legs green: Windows, Linux,
Apple-silicon macOS).

**Acceptance still owed against THIS build (owner's explicit call —
deliberately deferred past the tag, not forgotten):** the packaged
Windows/macOS install + workflow smoke pass, the 60–90 min interactive
real-data session with friction log, the installer/icon/taskbar check, and
ChatGPT-Sol's wording/menu review. Promotion to plain v0.23.0 waits on
those. Tracked as R2 in `plans/POST_SPRINT_INDEPENDENT_REVIEW.md`, which
also carries an added product question (the relink per-file-dialog consent
gesture — see Known limitations) for the owner's list.

---

## What's new (Origin-replacement sprint, PRs #167–#186 + #188/#189 + the
audit wave #194–#199)

### Projects and files
- **Native project lifecycle** (P1.1/P1.2): real Open/Save through the
  desktop bridge, named atomic saves, bounded autosave, and consent-gated
  crash recovery.
- **Relink & portability** (P1.7): moved/renamed source files can be
  relinked; project references survive relocation. Backend-enforced
  declared-source consent — the app can only be granted paths it already
  declared, never arbitrary local files. R3-fixed (2026-08-22): the commit
  step now recomputes provenance against the dataset's original recorded
  checksum/mtime/size and a fresh probe taken at commit time, rather than
  trusting the Preview-time snapshot alone — a row that changed between
  Preview and commit is rejected even if it was individually escalated
  earlier. See Known limitations for the one gap this does not close.
- **Single-writer locking** (I2, hardened in the audit wave; R1-fixed
  2026-08-22): a second desktop instance opening the same project gets
  read-only, **Open as Copy**, or a guarded **Take Over** — enforced by a
  real cross-process lock file (atomic create + OS-level compare-and-swap).
  A save verifies its lock token AND performs the actual file replacement
  while holding that SAME exclusive OS lock the whole time
  (`desktop_project_lock_write.write_holding_token`), so a displaced
  writer's save is refused, never silently applied, with no gap between
  verification and replacement for another process to land in. An absent
  lock file is treated as an unverifiable claim (refused), not as "nothing
  to check, proceed." R4-fixed (2026-08-22): the frontend now fails closed
  — read-only, never a false "writable" — when the desktop lock bridge
  itself is absent, throws, or returns a malformed response, not only when
  the backend explicitly refuses. Browser multi-tab is NOT protected (known
  limitation below).
- **Workbook transfer packages** (I): export/import a workbook package
  across instances with fresh-ID rewrite; bounded large transfers,
  incompatible/expired package handling.

### Data operations
- **Combine / split workbooks** (J) with collision-safe naming and
  multi-source provenance.
- **Recode workshop** (J2): merge/rename categorical levels, find-replace,
  with a worksheet C/O/N type badge and a categorical cell-edit guard.
- **Derived worksheets & Freeze Copy** (K) on an acyclic dependency model
  with deterministic evaluation.
- **Batch metadata & Collections** (L, L2): multi-select metadata editing,
  project-local collections, details-column selection.
- **Reimport / delete with impact preview** (M, single-dataset): see every
  dependent before a destructive action; atomic transaction core.
- **Lossless categorical/metadata representation** (P1.4) and **import
  role assignment** (P1.6) with live grouping/facets (P1.5).

### Plotting
- **Quick Plot templates** (H): save mapping + style + technique matching;
  mismatch handling, no silent overwrite.
- **Quick Figure Builder** (G1–G5, pre-sprint): full create → edit →
  close → reopen → project-reload lifecycle, proven byte-exact by a real
  browser E2E journey.

### Performance (measured, un-instrumented, on the merged tree)
- **Large 2-D map regrid** (#189): realistic instrument-precision RSM maps
  now hit the regular-grid fast path. 1M points: 29.8 → **3.3 s**;
  4M: 141.6 → **~13 s cold / ~9 s warm** after #191's detection dedupe
  (200×200 output).
- **Scattered-cloud maps** (#188): input denser than the output raster is
  bin-averaged before triangulation. Random 1M points: 20.4 → **2.7 s**;
  4M: 88.2 → **4.8 s** (200×200). Below the threshold the path is
  bit-exact with previous behavior; spatial holes are preserved.
- (Earlier, already in v0.22.0: plot payloads decimated server-side,
  154 MB → 2.7 MB at 1M×7; staged window hydration on workspace restore.)

### Audit-wave correctness fixes (post-freeze, pre-RC — #194-#199)
An independent Day-6 audit gated the RC on a correctness pass; all fixes
landed with red-first regression tests:
- **Formula integrity on column removal**: deleting a computed column no
  longer lets later formulas silently read a shifted (wrong) column —
  references are rewritten by the parser, and references to the removed
  column become explicit errors (#198). Recode commits are identity-checked
  against the column the panel was opened on (#198).
- **Relink honesty**: when a recorded checksum can't be re-verified, the
  verdict is "unknown" — and unknown rows are excluded from bulk commit
  unless individually confirmed (#196). Import-as-new-version is one undo
  step (#196).
- **Import wizard**: multiple X-role assignments are rejected loudly at
  both ends instead of silently dropping columns; error-role suggestions
  use the names the import will actually assign (#197).
- **Quick Plot templates** refuse to bind a value column as an error
  column (#195). Malformed categorical metadata degrades instead of
  crashing (#195). No-op edits no longer create phantom Undo entries
  (#195). Canceled dialogs and offline sources settle cleanly with real
  recovery paths (#194).

## Known limitations (shipping as-is in this RC)
- **macOS is Apple silicon only.** `Quantized_0.23.0_aarch64.dmg` is the only
  macOS artifact; there is no Intel/x86-64 or universal build for this
  release. (Owner decision, 2026-08-22.)
- **Relink checksum verification is inert in the desktop app.** Every
  relink candidate is probed with `checksum: null` today — the app has no
  consent gesture to read a not-yet-linked candidate file's contents, only
  its own already-declared project sources — so a row's relink verdict can
  only ever be confirmed via file size/modification-time comparison, never
  via a content checksum match. Size/mtime comparison does work and does
  catch a changed or swapped file; it just cannot positively confirm
  "byte-identical." Closing this needs a genuine new consent gesture for
  relink candidates (a product decision, not yet made — tracked against
  the owner's acceptance pass in `plans/POST_SPRINT_INDEPENDENT_REVIEW.md`
  R2/R3).
  **Superseded on `main` 2026-08-23 (#217): true of rc1 as tagged, fixed
  for rc2.** The consent gesture was specified in
  `CHATGPT_SOL_TO_CLAUDE_RELEASE_HANDOFF.md`'s contract and implemented:
  a native Browse… folder pick mints a read-only, session-scoped grant
  and candidates under it get real checksum comparison; typed paths still
  degrade to stat-only, labeled as such.
- **Reimport All (multi-source)** and the full Trash dependency-review UI
  are not built; single-dataset reimport/delete with impact preview is.
- **Plot recipes** beyond Quick Plot templates (axis limits, legend,
  decorations, annotations, waterfall) are not saved/reused yet (P1.3).
  **Superseded on `main` 2026-08-22/23 (#203/#204/#209, #215): true of
  rc1 as tagged, shipped for rc2** — the full P1.3 recipe vocabulary with
  project + global scopes, import/export, and technique matching.
- **Managed large-data sidecars** (N) deliberately deferred with evidence —
  multi-hundred-MB projects load, but reopen of a ~188 MB project measures
  ~5.8 s; if that is your normal case, say so and N gets rebuilt into scope.
- **Very large maps**: 4M-point regrid is ~9-18 s depending on cache state
  (was 141 s); the duplicate grid-detection call was deduped in #191.
- **Browser multi-tab is not protected by the project lock** — the
  cross-process lock (#199) covers desktop instances; two browser tabs on
  the same project remain a booked defer.
- **Packaged-desktop E2E is not agent-tested**: the desktop bridge is
  covered by mocked tests + CI sidecar smoke only; the packaged-app smoke
  pass is the owner's Day-6/7 checklist item.
- Live "Send to Origin" (COM) remains Windows-only and untested in CI;
  cross-platform export is Origin-ASCII + `.ogs`.

## Recovery instructions

- **The app or machine crashed with unsaved work.** Reopen the project:
  Quantized detects the autosave newer than your last named save and asks
  before restoring it — nothing is applied silently, and declining keeps
  the last saved state. Autosaves are bounded, so a corrupt one never
  wedges opening.
- **"This project is open in another Quantized" on open.** Another running
  instance holds the write lock. Choose **read-only** to look without
  touching it, **Open as Copy** to branch your own editable copy, or
  **Take Over** if the other instance is dead (a stale lock is detected
  automatically; taking over a live one is guarded). If you were the
  displaced side, your next save is refused rather than silently
  overwriting — Save As to keep your version.
- **A data file moved, renamed, or its drive is unplugged.** Reimport and
  plots report the source as missing or offline (they are distinguished)
  and open **Relink**: point rows at the new location. Rows whose content
  can be verified against the recorded checksum commit normally; rows that
  cannot be verified are marked "needs verification" and are excluded from
  bulk commit unless you confirm them individually. A changed file can be
  imported as a new version instead — one Undo reverts the whole
  operation.
- **A transfer package won't import.** Incompatible or expired packages
  are refused with the reason; nothing partial is applied.
- The behavioral source of truth for these paths is
  `plans/LIBRARY_WORKBOOK_UX_PLAN.md` (items 9/9b/13) and
  `PRIMARY_SOFTWARE_AUDIT_PLAN.md` §P1.2/§P1.7.

## Rollback
v0.22.0 installers remain on their Release. Because v0.23.0-rc1 is a
GitHub **prerelease** (enforced in `release.yml` for `-rc` tags),
`releases/latest` — and therefore in-app auto-update — continues to serve
v0.22.0 until the RC is promoted with a plain `v0.23.0` tag. PyPI does not
receive `-rc` builds at all (guarded in `pypi.yml`).

**Install/platform note:** this RC ships Windows `.exe`, Linux `.deb`, and
macOS **Apple silicon only** (`Quantized_0.23.0_aarch64.dmg`) — no
Intel/x86-64 or universal macOS artifact (owner decision, 2026-08-22; see
`plans/POST_SPRINT_INDEPENDENT_REVIEW.md` R5).

## Post-tag hardening (independent-review wave, PRs #207/#208/#210/#211/#212/#213)
An independent second review pass (`plans/POST_SPRINT_INDEPENDENT_REVIEW.md`)
found and fixed further correctness issues after this RC's tag; all landed
on `main` with adversarial code-review rounds and orchestrator independent
verification (see that document's closure log). Summary beyond the R1/R3/R4
callouts above: R6 made an async import-as-new-version's Undo batch
operation-scoped instead of globally suppressing history, so an unrelated
edit made while the import is in flight always gets its own, independent
Undo entry. R7 added a non-blocking performance-regression guard (structural
+ wall-clock) for the large-map fast path this RC's performance section
measures. R9 resolved all nine pre-existing React-hook lint warnings (two
were real stale-closure bugs; CI now enforces zero warnings). R8 (eager JS
bundle headroom) is still in flight on a parallel lane as of this note.
None of these change the RC's tag or artifacts — they are already on `main`
and will ship in the promoted `v0.23.0` build.

## Changes since rc1 → v0.23.0-rc2 (2026-08-23)

rc1 (`069616d1`) predates the post-sprint fix waves, so installed
acceptance (R2) runs against **rc2**, cut from `main` after the following
landed (each merged on green CI after an adversarial review round; evidence
in `POST_SPRINT_INDEPENDENT_REVIEW.md`'s closure log and
`CHATGPT_SOL_TO_CLAUDE_RELEASE_HANDOFF.md`'s completion log):

- **P1.3 plot recipes** (#203/#204/#209, schema split #215) — see the
  superseded Known-limitations bullet above.
- **Calculator provenance fixes** (#206) and the R1-R10 audit remediation
  (#207/#208/#210-#214): lock write-path atomicity, fail-closed lock
  bridge, commit-time relink provenance recompute, operation-scoped Undo
  batches, perf-regression guard, zero hook warnings, macOS
  Apple-silicon-only decision recorded.
- **R8/C2 eager-bundle diet** (#216/#218): 926,154 → 905,870 B measured
  (−20.3 kB), budget ratcheted to 906,894.
- **Relink native folder-grant consent** (#217) — see the superseded
  Known-limitations bullet above; the acceptance pass should exercise
  Browse…, the per-row states, and Cancel-revokes on a real picker.

rc2 publishes as a prerelease exactly like rc1 (auto-update and PyPI
untouched); `v0.22.0` remains the rollback build.

---

## Changes since rc2 → rc3 → rc4 (2026-08-27)

**rc4 (`a8a939c1`) is the acceptance candidate. rc1, rc2 and rc3 are all
disqualified** — each by a defect found after it was cut. 25 PRs (#221-#247)
landed after rc2.

### Fixes that affect data you already have

Two of these were **live in v0.22.0**, the current stable. They are the reason
to upgrade, not merely reasons this candidate is newer.

- **Re-importing a dataset with a computed column destroyed the base data.**
  With a measurement column `m` and a formula `2x`, a re-import returned only
  `2x`, filled with nulls — the measurement column gone, silently, no toast and
  no error. The recompute stripped trailing computed columns from a payload
  that had none to strip, because a freshly re-read file only ever carries base
  columns. **Verified present in v0.22.0, rc1, rc2 and rc3**; fixed in #245.
  If you have re-imported a formula-bearing dataset on any of those builds,
  check that dataset against its source file.
- **Removing a computed column silently re-fitted a saved fit against the wrong
  column.** The saved fit's own parameters were then overwritten with the wrong
  result. The only guard was an out-of-range check, which an in-range-but-wrong
  index passes. Fixed in #244, along with four more instances of the same
  stale-column-index class (error-bar roles, group/facet keys, saved figure
  bindings, and the facet render cache).
- **Fifteen ordinary column names were being converted into error bars** —
  `Kerr`, `Phase`, `Noise`, `Depth` and others — which cost a plain MOKE file
  both of its data channels. The error-label classifier was rewritten around
  explicit generate/rank/select stages (#238), and Origin error roles now come
  from the file's own column designations rather than a name guess (#239).
- **Origin books whose columns were all `disregard`/`label`/`Z` discarded
  Origin's own answer** in favour of a label guess, because the frontend's
  designation set had two of the seven strings miscased and one missing
  entirely. Both sides now pin to one shared fixture (#241).
- **Two keystrokes in the new peak table destroyed data** — Delete on a focused
  peak row removed the whole dataset with no confirm, and an arrow key wiped a
  fit (#237). **An invisible hit box swallowed clicks on the Export control**
  after any box-zoom (#234).

### New in this window

- **Reimport All** (#221) — transactional multi-source re-import.
- **Faceting reaches parity**: a durable facet-by-column binding (#222),
  faceted views exporting as the small-multiples grid on every export path
  (#226), and faceted Figure Page panels rendering as true vector sub-grids
  (#227).
- **Annotation**: right-click "Add text here…" (#224) and a bulk "Label peaks"
  workflow with per-peak row selection (#228, #236).
- **Library**: Origin project imports land collapsed with the active sheet's
  chain revealed (#225); fidelity disclosure survives search (#233).
- **Browser multi-tab single-writer lock** for the shared autosave slot (#223).

### Release engineering

- **Every release now publishes a `SHA256SUMS` manifest** covering all assets
  (#242). Previously there was no single offline-verifiable checksum file.
  Verified on both rc3 and rc4 against GitHub's own per-asset digests.

### Why rc3 was disqualified

rc3 (`412609850e...`) was cut, built and fully verified — all five jobs green,
nine assets, checksums matching — and then the reimport data-loss bug above was
found. Because that defect is pre-existing rather than introduced, rc1 and rc2
carry it too, so there was no earlier candidate to fall back to. rc4 is the
first candidate without it.

### Acceptance still owed against rc4

Unchanged in kind from rc1: the packaged Windows/macOS install and workflow
smoke pass, the 60-90 minute interactive real-data session with friction log,
the installer/icon/taskbar check, and ChatGPT-Sol's wording/menu review.
Promotion to plain `v0.23.0` waits on those.

**Note on urgency.** Because the reimport defect is live in v0.22.0, the usual
"a bad candidate is worse than no release" calculus is not symmetric here:
holding also leaves a data-destroying bug in the shipped stable. That argues
for testing rc4 promptly, not for skipping the test — promotion makes rc4
`releases/latest`, which auto-updates every existing install, and publishes to
PyPI irreversibly.

rc4 publishes as a prerelease exactly like rc1-rc3 (auto-update and PyPI both
skip `-rc` tags), so `releases/latest` remains `v0.22.0` until promotion.
