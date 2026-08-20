# Release-candidate notes draft — v0.23.0-rc1 (proposed)

**Status:** DRAFT — for the owner's Day-7 review. Do not tag or publish
without her explicit go. The Day-7 gate also requires re-running the release
matrix on the exact candidate commit before tagging.

**Candidate commit at draft time:** `main` after #189 (the two performance
fixes below). Update this line to the actual tagged SHA at cut time.

---

## What's new (Origin-replacement sprint, PRs #167–#186 + #188/#189)

### Projects and files
- **Native project lifecycle** (P1.1/P1.2): real Open/Save through the
  desktop bridge, named atomic saves, bounded autosave, and consent-gated
  crash recovery.
- **Relink & portability** (P1.7): moved/renamed source files can be
  relinked; project references survive relocation. Backend-enforced
  declared-source consent — the app can only be granted paths it already
  declared, never arbitrary local files.
- **Single-writer locking** (I2): a second instance opening the same
  project gets read-only, **Open as Copy**, or a guarded **Take Over**;
  the displaced writer's next save is refused with a fresh lock check.
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
- **Packaged-desktop E2E is not agent-tested**: the desktop bridge is
  covered by mocked tests + CI sidecar smoke only; the packaged-app smoke
  pass is the owner's Day-6/7 checklist item.
- Live "Send to Origin" (COM) remains Windows-only and untested in CI;
  cross-platform export is Origin-ASCII + `.ogs`.

## Recovery instructions (pointer)
Crash recovery, lock takeover, relink, and package-import failure paths are
documented in-app where they occur; the behavioral source of truth is
`plans/LIBRARY_WORKBOOK_UX_PLAN.md` (items 9/9b/13) and
`PRIMARY_SOFTWARE_AUDIT_PLAN.md` §P1.2/§P1.7. Summarize into user-facing
prose here before tagging.

## Rollback
Keep v0.22.0 installers available; the updater manifest must continue to
serve v0.22.0 until the RC is promoted.
