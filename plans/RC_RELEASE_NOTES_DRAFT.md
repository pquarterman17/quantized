# Release-candidate notes draft — v0.23.0-rc1 (proposed)

**Status:** FINAL for v0.23.0-rc1 — owner gave the explicit tag go on
2026-08-22 after the audit wave (#194–#200) and her local verification
campaign (corpus re-sweep 350 graphs / 0 renderer failures, DiraCulator
golden freeze, live Origin COM oracles) landed. Published as a GitHub
**prerelease**: auto-update keeps serving v0.22.0 until promotion.

**Candidate commit:** the `v0.23.0-rc1` tag target (main after #200 + the
2026-08-21 verification-campaign commits).

**Acceptance still owed against THIS build (owner's explicit call —
deliberately deferred past the tag, not forgotten):** the packaged
Windows/macOS install + workflow smoke pass, the 60–90 min interactive
real-data session with friction log, the installer/icon/taskbar check, and
ChatGPT-Sol's wording/menu review. Promotion to plain v0.23.0 waits on
those.

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
  declared, never arbitrary local files.
- **Single-writer locking** (I2, hardened in the audit wave): a second
  desktop instance opening the same project gets read-only, **Open as
  Copy**, or a guarded **Take Over** — enforced by a real cross-process
  lock file (atomic create + OS-level compare-and-swap) with saves bound
  to the held lock token, so a displaced writer's save is refused, not
  silently applied. Browser multi-tab is NOT protected (known
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
- **Reimport All (multi-source)** and the full Trash dependency-review UI
  are not built; single-dataset reimport/delete with impact preview is.
- **Plot recipes** beyond Quick Plot templates (axis limits, legend,
  decorations, annotations, waterfall) are not saved/reused yet (P1.3).
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
