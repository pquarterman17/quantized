// Frontend architecture guards — the grep-able invariants that keep the row-state
// model (#50) the single source of truth for per-row selection/exclusion. Linking
// is threshold-shaped: 80%-linked feels broken, not innovative. Every view must
// read row state THROUGH the model so exclusion/selection is honored uniformly.
//
// Reads each source module's raw text at build time (Vite's import.meta.glob) and
// asserts the sanctioned modules are the only ones touching the persistent
// Dataset row-state fields. A new analysis view that needs the pruned rows must
// call lib/rowstate.analysisData — never re-derive exclusion itself.

import { describe, expect, it } from "vitest";

const modules = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every source module (path, text), minus tests and this guard file itself. */
function sources(): [string, string][] {
  return Object.entries(modules).filter(
    ([p]) => !/\.test\.(ts|tsx)$/.test(p) && !p.endsWith("/architecture.test.ts"),
  );
}

/** Test modules only, for ratchets on test-environment technique. */
function testSources(): [string, string][] {
  return Object.entries(modules).filter(([p]) => /\.test\.(ts|tsx)$/.test(p) && !p.endsWith("/architecture.test.ts"));
}

describe("browser-storage test reliability", () => {
  it("replaces the localStorage binding instead of patching Storage.prototype", () => {
    const unreliable = testSources()
      .filter(([, src]) =>
        /Storage\.prototype\s*\.\s*(?:getItem|setItem|removeItem|clear)|spyOn\(\s*(?:globalThis\.)?localStorage\s*,\s*["'](?:getItem|setItem|removeItem|clear)["']/.test(src.replace(/\/\/.*$/gm, "")),
      )
      .map(([path]) => path);
    expect(
      unreliable,
      "jsdom Storage methods are not reliably intercepted; replace globalThis.localStorage with a fake and restore it after the test",
    ).toEqual([]);
  });
});

/** Modules that reference `re`, minus those whose path ends with an allowlisted
 *  suffix (the sanctioned model layers). */
function offenders(re: RegExp, allow: string[]): string[] {
  return sources()
    .filter(([, src]) => re.test(src))
    .map(([p]) => p)
    .filter((p) => !allow.some((a) => p.endsWith(a)));
}

// BUG-020 follow-up: these workshop hooks used page-lifetime counters for
// durable dataset ids.  A restored project can already contain any id minted
// during an earlier page lifetime, so every dataset producer must draw from
// the workspace-wide sequence instead of restarting at 1 after reload.
describe("workshop dataset identity", () => {
  const migrated = [
    "/components/workshops/baseline/useBaseline.ts",
    "/components/workshops/hysteresis/useHysteresis.ts",
    "/components/workshops/magtools/useMagTools.ts",
    "/components/workshops/reflectivity/useReflectivity.ts",
    "/commands/fileCommands.ts",
    "/components/Library/Library.tsx",
    "/components/Library/folderOps.ts",
    "/components/Stage/worksheet/useWorksheetView.ts",
    "/components/workshops/database/SqliteQueryDialog.tsx",
    "/components/workshops/datasetmath/useDatasetMath.ts",
    "/components/workshops/digitizer/useDigitizer.ts",
    "/components/workshops/importwizard/useImportWizard.ts",
    "/components/workshops/pipeline/useTemplates.ts",
    "/components/workshops/reductions/useFftThickness.ts",
    "/components/workshops/reductions/useReflectivityFft.ts",
    "/components/workshops/tabulate/useTabulate.ts",
    "/lib/worksheetTransformCommands.ts",
  ];

  it("keeps the BUG-020 workshop producers on the shared dataset-id sequence", () => {
    const workshopSources = sources().filter(([path]) => migrated.some((suffix) => path.endsWith(suffix)));
    expect(workshopSources.map(([path]) => path)).toHaveLength(migrated.length);
    for (const [path, src] of workshopSources) {
      expect(src, `${path} must mint durable ids through store/idSeq.ts`).toContain("nextDatasetId()");
      expect(src, `${path} must not restore a private durable dataset-id sequence`).not.toMatch(
        /(?:const\s+id\s*=|id:)\s*`(?:bgsub|hystbg|magbg|magunit|refl-model|refl-sld|demo|sample|tplf|subset|sqlite|math|digi|impwiz|tplb|tplsum|fftthk|reflfft|tab|transform)-/,
      );
    }
  });
});

// Component-ceiling ratchet (PROJECT_ORGANIZATION_PLAN #7 / PORT_PLAN W7).
// Convention: a .tsx component is <=400 lines; heavy features decompose via the
// workshop pattern (state hook + view + sub-components). This is a RATCHET, not
// a hard wall on day one: files that already exceed 400 get pinned at their
// CURRENT size so they can only SHRINK, never grow (identical spirit to the
// backend 500-line test and the MATLAB "never raise the ceiling" rule). A
// NEW .tsx over 400 fails. When a pinned file is extracted below 400, the
// honesty check tells you to delete its pin. Counting matches the guard below:
// src.split("\n").length.
const TSX_CEILING = 400;
// path-suffix -> grandfathered max (exact current line count). RATCHET DOWN ONLY.
// The pins have ratcheted to ZERO (MAIN_PLAN #1, 2026-07-11): App.tsx (954)
// decomposed into appCommands.ts / useGlobalShortcuts.ts / AppOverlays.tsx;
// ThinFilmTab.tsx (442) into thinfilm/ card sub-components; PlotStage.tsx's
// pin went earlier (MULTI_PLOT_PLAN #1, 2026-07-09 — PlotViewport.tsx /
// usePlotPayload.ts). Every .tsx now meets the 400 ceiling — keep it that way.
const GRANDFATHERED: Record<string, number> = {};

describe("component-ceiling ratchet (#7)", () => {
  const tsx = sources().filter(([p]) => p.endsWith(".tsx"));

  it("no .tsx component exceeds its ceiling (400, or its grandfathered pin)", () => {
    const over: string[] = [];
    for (const [p, src] of tsx) {
      const lines = src.split("\n").length;
      const pinKey = Object.keys(GRANDFATHERED).find((k) => p.endsWith(k));
      const ceiling = pinKey ? GRANDFATHERED[pinKey] : TSX_CEILING;
      if (lines > ceiling) over.push(`${p}: ${lines} > ${ceiling}`);
    }
    expect(
      over,
      "decompose via the workshop pattern (hook + view + sub-components); do NOT raise the ceiling",
    ).toEqual([]);
  });

  it("grandfathered pins stay honest — a file that dropped under 400 must lose its pin", () => {
    const stale: string[] = [];
    for (const key of Object.keys(GRANDFATHERED)) {
      const entry = tsx.find(([p]) => p.endsWith(key));
      if (!entry) {
        stale.push(`${key}: no longer exists — remove its pin`);
        continue;
      }
      if (entry[1].split("\n").length <= TSX_CEILING) {
        stale.push(`${key}: now <=${TSX_CEILING} — remove its pin (ratchet down)`);
      }
    }
    expect(stale, "the grandfathered list must shrink as files are extracted").toEqual([]);
  });
});

// Store-size ratchet (MAIN_PLAN #2). store/useApp.ts is the composed app
// store; the MDI window slice was extracted to store/windows.ts (2026-07-11),
// dropping useApp.ts to the pin below. Same iron rule as the component
// ceilings: the pin only RATCHETS DOWN — when the store grows, extract the
// next cohesive slice (windows.ts is the template), never raise the number.
const STORE_PINS: Record<string, number> = {
  // 3292 -> 3335 (MAIN_PLAN #9, undo/redo): every data-mutating action in the
  // undoable set (worksheet cell edits, formula add/remove, dataset add/
  // remove/remove-all/rename/duplicate/reorder/tag/group/notes edits,
  // corrections apply/reset, row exclusion changes + clear, channel role/
  // type changes) needs its own one-line `get().recordHistory("label")` call
  // BEFORE its `set()` so the pushed snapshot is the pre-mutation state —
  // there is no single chokepoint to hoist it to (unlike windows.ts's
  // `focusTransientReset`, these mutations don't share one call site). ~24
  // call sites, several needing an arrow-expression -> block-body rewrite
  // to fit the extra line before the existing `set(...)`. The slice itself
  // (state, undo/redo, restore guards) lives in the new store/history.ts,
  // composed in exactly like windows.ts — this is ONLY the per-action
  // recorder lines, already at the practical floor; next candidates:
  // corrections/importing slices (unchanged from the prior note).
  // 3335 -> 3312 (2026-07-12, axis-label Format menu): the .dwk restore block
  // hand-re-listed all 24 group-2 PlotView fields; replaced with a single
  // `...(restoredView ?? {})` spread (hydrateView guarantees the field set),
  // so a new view field (axisLabelStyles) LOWERED the pin instead of raising it.
  // 3312 -> 3240 (2026-07-16, ORIGIN_FILE_DECODE_PLAN #54 page-setup): the
  // ~118-line prefs block (Prefs/PREF_DEFAULTS/loadPrefs/prefsOf/syncPrefs)
  // moved to store/prefs.ts, funding #54's panelFit/pageSetup state + the
  // defaultPanelFit pref across the feature's staged commits — a net LOWERING.
  // 3240 -> 3115 (2026-07-18, headroom restore, pure refactor / zero behavior
  // change): applyCorrections/resetCorrections/applyCorrectionsToMany (the
  // whole corrections-apply pipeline) moved verbatim to the new
  // store/corrections.ts (CorrectionsSlice), composed in exactly like
  // graphBuilder.ts — it owns no state of its own, mutating the shared
  // `datasets` field through set/get the same way store/reimport.ts already
  // does. `recompute` was exported from useApp.ts (nextDatasetId/split.ts
  // precedent) so the new slice can re-derive computed columns after an
  // apply/reset. No headroom slack added deliberately — the ratchet's whole
  // point is that the NEXT feature earns its own extraction, not a buffer.
  // 3115 -> 3090 (2026-07-19, ORIGIN_FILE_DECODE_PLAN #54 pass A): the three
  // parallel `spatialPanels`/`facetPanels`/`breakPanels` nullable fields
  // collapsed into ONE discriminated union `composition` (lib/composition.ts).
  // The saving is structural, not cosmetic: seven `set()` sites each had to
  // null the other two arrays by hand to maintain a mutual exclusion the type
  // now enforces, and the field block carried ~28 lines of comment explaining
  // why three parallel fields were not a reuse of each other. A feature paying
  // for itself, not a buffer — the pin drops to what the file actually is.
  // 3090 -> 3082 (2026-07-19, channel-index staleness fix): `removeFormula`'s
  // inline remap helpers moved to the new pure lib/channelRemap.ts, which now
  // states the "what happens to index-keyed state when a column disappears"
  // rule ONCE for BOTH halves -- the dataset-scoped fields the 2026-07-05
  // round fixed AND the view-scoped ones it missed. A bug fix that pays for
  // itself by extracting the rule rather than duplicating it.
  // 3082 -> 3071 (2026-07-25, MAIN #35 copy-figure background pref): the
  // pref cost 4 lines here, so it was offset by deriving `PrefKey` from
  // `Prefs` (`keyof`) instead of restating all 18 keys as a hand-
  // maintained union — 18 lines back, and the union can no longer drift
  // out of sync with prefs.ts when a preference is added.
  // 3071 -> 3045 (2026-07-25, MAIN #34 block editing): setCellBlock would
  // have pushed useApp over the pin, so setCellValue moved out WITH it into
  // store/cellEdit.ts — a cohesive "write cells into a dataset grid" slice,
  // the same extraction store/corrections.ts got.
  // 3045 -> 3032 (2026-07-25, MAIN #32 project trash): trash capture needed
  // lines, paid for by making removeSelected DELEGATE to removeDatasets
  // instead of repeating its ~25 lines of reference pruning — that block had
  // drifted into three near-identical copies.
  // 3032 -> 2875 (2026-07-25, MAIN #31 recents slice, then MAIN #30 moved the
  // fit-recalc loop to store/recalcFits.ts — the ONE place a saved recipe is
  // replayed, so #30 recompute stamping belongs beside it): importFiles moved to
  // store/importDatasets.ts so importPaths could SHARE its Origin multi-book
  // expansion, folder planning and figures/fidelity handling rather than
  // duplicating ~90 lines of it — two copies of that branch would drift, and
  // it is exactly where drift would be expensive and hard to notice.
  // 2875 -> 2868 (2026-08-01, PLOT_WORKFLOW_PLAN item 5): `loadWorkspace`'s
  // hand-repeated transient-tool-clear block (composition/rsmPeaks..
  // gadgetCursorResult) — a field-for-field duplicate of windows.ts's
  // `focusTransientReset()` — replaced with `...focusTransientReset()`,
  // funding the new `techniqueViewMemory` restore line at a net loss.
  // 2868 -> 2835 (2026-08-14, LIBRARY_WORKBOOK_UX_PLAN PR A2): the dataset
  // notes/tags/group actions (setDatasetNotes/addDatasetTag/removeDatasetTag/
  // setDatasetGroup — a cohesive, store-free-of-closures-over-anything-else
  // block, the same shape store/cellEdit.ts was) moved verbatim to the new
  // store/datasetMeta.ts, funding the new `workbooks: WorkbookNode[]` field
  // (AppState + initial state + loadWorkspace's explicit `ws.workbooks ?? []`
  // return line — omitting that line would silently leak the PREVIOUS
  // project's workbooks into a newly opened one, since `set()` merges a
  // partial state).
  // 2835 -> 2817 (2026-08-14, LIBRARY_WORKBOOK_UX_PLAN PR C): `removeDataset`
  // was a ~25-line near-duplicate of `removeDatasets` (the same drift class
  // `removeSelected`'s own delegation was meant to head off — see that
  // action's comment) — replaced with `removeDataset: (id) =>
  // get().removeDatasets([id])`. Funded the new store/workbookActions.ts
  // slice (renameWorkbook/moveWorkbookToFolder/deleteWorkbook — the tree
  // renderer's first workbook mutations), composed in exactly like
  // datasetMeta.ts: one import line + one `WorkbookActionsSlice` word on the
  // extends clause + one spread line. Net still well down.
  // 2818 -> 2661 (2026-08-17, sprint Day-0 pre-bank, PIN LEFT AT 2818 —
  // the one deliberate exception to "no slack, tight pin" above): the
  // #152/#153 merge landed useApp.ts 2 lines over this pin, because the
  // ratchet sums line deltas across branches — two lanes can each add a
  // few lines and still collide at merge even though neither alone crossed
  // the ceiling. installBookData (lib/bookData.ts) was that incident's
  // fix; with seven lanes landing store-slice registrations in parallel
  // this week, the same collision was likely again. Moved
  // ensureBookData/resolvePendingDatasets/resolveDataset/resolveDatasets
  // (ORIGIN_FILE_DECODE_PLAN #38, around installBookData's call sites) and
  // pasteDataFromClipboard (gap #47) — each already self-contained, no
  // state of its own — to the new store/dataIntake.ts (DataIntakeSlice),
  // composed in exactly like datasetMeta.ts. The pin stays at 2818 on
  // purpose so the 157 lines of headroom are actually usable by the
  // week's lanes instead of being immediately reclaimed; the NEXT
  // extraction after the sprint should ratchet the pin back down to
  // whatever useApp.ts actually is then, per the iron rule above.
  // 2818 -> 2772 (2026-09-09, recalc determinism/auditability #331): the
  // `recalcNow` dataset loop moved to store/recalcDatasets.ts, mirroring the
  // existing recalcFits.ts split. Ratcheted DOWN with the extraction rather
  // than left at the old number — a pin kept above the real size is 47 lines
  // of silent headroom for the next feature, which is the exact drift this
  // ratchet exists to prevent. (Review round caught this; the extraction had
  // shrunk the file without lowering the pin.)
  // 2772 -> 2449 (2026-09-09, PRIMARY_SOFTWARE_AUDIT_PLAN "characterization
  // tests before moves" / store-size ratchet, zero headroom): the ROI-gadget
  // / quick-fit family — qfitRoi/qfitModel/.../gadgetCursorResult state plus
  // setQfitRoi/runQuickFit/commitQfit/setGadgetMode/runGadget*/
  // commitGadgetFft/setGadgetCursors/clearQfit (#33/#34) — moved verbatim to
  // the new store/gadget.ts (GadgetSlice), composed in exactly like
  // store/windows.ts: this slice owns its OWN state, not just shared
  // `datasets` mutation (corrections.ts's shape). Chosen by cohesion, not
  // size: before the move, grep across store/*.ts found NOTHING outside
  // useApp.ts calling any of these actions or writing any of these fields
  // (windows.ts's focusTransientReset and useApp's own addDataset reset a
  // few of them back to their initial values on a focus/dataset switch, the
  // same plain-object-literal pattern corrections.ts already uses for the
  // shared overlay fields — not a functional dependency on the slice). The
  // two pre-existing dedicated test files, store/quickfit.test.ts and
  // store/gadget.test.ts, already exercised exactly this boundary before the
  // extraction — independent evidence it was already a natural module. New
  // store/gadgetHistory.characterization.test.ts pins the one behavior
  // neither file covered: none of these actions call `recordHistory`
  // (transient tool state, per history.ts's own exclusion list) except
  // indirectly through `commitGadgetFft` -> `addDataset`, which records
  // exactly one entry attributable to `addDataset`, not to the gadget
  // action. 323 lines came out in one slice — no headroom deliberately left;
  // the whole point of the pin sitting at zero slack is that a slice this
  // size gets extracted the moment it exists, not banked for later.
  // 2449 -> 2334 (2026-09-10, BUG-009's guard half): the pin sat 2 lines above
  // the file, so adding a pending guard to the row-state actions had to EXTRACT
  // rather than append — the repo's rule (CLAUDE.md) is to move a cohesive
  // sibling out, never to shave explanatory comments to fit a ceiling. Row
  // exclusion (#50), the transient row `selection` that feeds it, and the
  // per-column data filter (#53) went to the new store/rowState.ts
  // (RowStateSlice), composed exactly like datasetMeta.ts/dataIntake.ts: one
  // import line, one word on the extends clause, one creator-spread line.
  // `worksheetOrActiveSelection` moved with them (its only two callers did).
  // Pinned TIGHT at the post-extraction size, which is what the 2818 entry
  // below said the next extraction after that sprint should do — the slack it
  // banked for seven parallel lanes is now reclaimed.
  // 2334 -> 2328 (2026-09-12, P3.3 auto dash/marker cycle): the pin sat 2 lines
  // above the file, so the new `autoSeriesStyles` pref field could not simply be
  // appended. Paid for by seeding the whole prefs block with ONE `..._initialPrefs`
  // spread instead of a hand-maintained `x: _initialPrefs.x` line per preference
  // (17 of them) — every Prefs key is already an AppState field of the same name,
  // which is exactly what `prefsOf(s)` relies on to read them back out, so the
  // list could only ever drift. Same anti-drift move as `PrefKey = keyof Prefs`.
  // 2322 -> 2122 (2026-09-17, PRIMARY_SOFTWARE_AUDIT_PLAN P4.1 "decompose
  // high-risk frontend god-modules… characterization tests first", zero
  // headroom): the singleton PlotView WRITERS — axis scales/limits/steps/tick
  // formats/titles, the legend/grid/axis-box flags, stack mode + panel fit +
  // page setup, the x/y/y2/group channel keys, reference lines, annotations,
  // per-channel series styles/labels/error pairings, draw order, hidden/solo
  // channels and the waterfall offset (43 actions, plus the `ref-`/`ann-` id
  // counters they mint from) — moved verbatim to the new
  // store/plotViewSettings.ts (PlotViewSettingsSlice), composed exactly like
  // datasetMeta.ts/gadget.ts: one import line, one word on the extends
  // clause, one creator-spread line. Chosen by COUPLING, not size: unlike
  // `setChannelRole`/`setChannelType` (which sit in the middle of the same
  // block and stay behind), nothing in the cluster writes `datasets` at all,
  // so the pending-edit ratchet above has nothing to say about it and the
  // module's promise stays exactly "PlotView state". The FIELDS stay declared
  // and initialized on AppState here, because the actions that RESET them on
  // a dataset switch (setActive/addDataset/duplicateDataset) and the ones
  // that bulk-apply them (loadWorkspace/applyOriginFigure/facetByColumn) are
  // NOT part of the cluster — the same shape corrections.ts already has for
  // the shared `datasets` field. store/plotViewSettings.characterization.test.ts
  // (119 specs) was written and run green against the PRE-extraction code and
  // passes unchanged after the move; that, not a line count, is what made the
  // extraction verifiable.
  // 2122 -> 2012 (2026-09-17, the SECOND P4.1 domain, zero headroom): the
  // report-sheet (#36) and figure-document (#12) lifecycle — addReport,
  // removeReport, renameReport, setOpenReport, addFigureDoc, removeFigureDoc,
  // renameFigureDoc, duplicateFigureDoc, openFigureDraft, openFigureDoc,
  // openFigureDocInWindow, clearFigureDocSeed (12 actions) — moved verbatim to
  // the new store/reportsFigureDocs.ts (ReportsFigureDocsSlice), composed
  // exactly like plotViewSettings.ts: one import line, one word on the extends
  // clause, one creator-spread line. Chosen by COUPLING over the two larger
  // candidates: `loadWorkspace` (170 lines) writes 40 AppState fields and is
  // where every new persisted field gets wired, and applyOriginFigure +
  // facetByColumn + breakAtGaps (336 lines) write 24 PlotView fields that
  // plotViewSettings.ts also writes; this cluster writes 15, of which the four
  // it OWNS (reports/openReportId/figureDocs/figureDocSeed) means this module
  // holds every ACTION that edits them one at a time; bulk restores write
  // them wholesale and stay outside the cluster on purpose (2026-09-17 review
  // finding F4: corrects the earlier, false "touched by nothing else outside
  // loadWorkspace" wording) — `loadWorkspace`'s `.dwk` hydrate,
  // store/trash.ts's delete delegates, store/trashRestore.ts's restore-from-
  // trash, store/workbookTransfer.ts's workbook import, and
  // store/historySnapshot.ts's undo/redo restore. The FIELDS stay declared
  // and initialized on AppState here for exactly that reason — same shape as
  // plotViewSettings.ts. The shared `<prefix>-<t36>-<n>` id counter
  // moved with them, to the leaf module store/idSeq.ts (a module-level `let`
  // cannot be incremented across a module boundary, and splitting it per
  // domain would have renumbered ids); useApp.ts re-exports nextDatasetId/
  // nextFolderId from there so no importer changed.
  // store/reportsFigureDocs.characterization.test.ts (57 specs as of the
  // 2026-09-17 review round's F3/F7 additions; 55 at the original move, each writer
  // diffing the WHOLE poisoned getState() snapshot) was written and run green
  // against the PRE-extraction code and passes byte-unchanged after the move.
  // 2012 -> 1639 (2026-09-18, the THIRD P4.1 domain, zero headroom): the BULK
  // VIEW APPLIERS — the three actions that install a WHOLE plot view in one
  // gesture from a source description rather than editing one setting at a
  // time: applyOriginFigure (an imported Origin graph window, in its four
  // branches — cross-book overlay, double-Y layer pair, spatial multi-panel
  // family, single-layer fallback), facetByColumn (a small-multiples
  // partition by a category column) and breakAtGaps (a paneled x-break
  // arrangement), 336 implementation lines (base useApp.ts 985-1320:
  // applyOriginFigure 985-1215, facetByColumn 1226-1281, breakAtGaps
  // 1288-1320) plus their 24 interface lines and the ORIGIN_FIGURE_AXIS
  // constant all three spread — moved verbatim (modulo
  // one indentation level) to the new store/viewAppliers.ts
  // (ViewAppliersSlice), composed exactly like plotViewSettings.ts and
  // reportsFigureDocs.ts: one import line, one word on the extends clause,
  // one creator-spread line. This is the larger of the two candidates the
  // 2122 -> 2012 note above deferred; the other (loadWorkspace, 170 lines) is
  // still in useApp.ts. Chosen now BECAUSE of that note's coupling objection
  // rather than despite it: these three write PlotView fields that
  // plotViewSettings.ts also writes, but they write them as one whole-view
  // install, which is a different job from a per-setting writer — the split
  // is by GESTURE, and plotViewSettings.ts's header already listed all three
  // by name as the bulk-appliers it does not own. The FIELDS stay declared
  // and initialized on AppState here, same shape as both earlier extractions.
  // The Origin-apply PREFLIGHTS stay in store/originFigureApply.ts (one of
  // the three modules grandfathered to import components/), which is what
  // lets viewAppliers.ts sit below the component layer with no new
  // grandfathered entry. store/viewAppliers.characterization.test.ts (35
  // specs pinning, per action AND per branch — including the cross-book
  // overlay branch, added 2026-09-18 review round 3 F1 — the exact set of
  // top-level store keys each call changes — a poisoned whole-getState()
  // diff — plus the applied values, undo label and macro step) was written
  // and run green
  // against the PRE-extraction code and passes byte-unchanged after the move.
  // 1639 -> 1451 (2026-09-19, the FOURTH P4.1 domain, zero headroom): WORKSPACE
  // HYDRATION — `loadWorkspace` (replace the whole library from a restored/
  // parsed .dwk; the autosave restore on startup AND an explicit File ▸ Open
  // .dwk both run it) and `appendWorkspace` (Origin's "Append Project",
  // MAIN_PLAN #16 — the additive opposite: only the flat dataset list +
  // referenced workbooks join the CURRENT library). This is exactly the
  // candidate the 2012 -> 1639 note above named as still in useApp.ts:
  // loadWorkspace, 170 lines (base useApp.ts 954-1123) plus appendWorkspace's
  // one-line delegate (1124) and their 9 interface-declaration lines — 171
  // implementation lines total, matching the plan's estimate — moved verbatim
  // (modulo one indentation level) to the new store/workspaceHydration.ts
  // (WorkspaceHydrationSlice), composed exactly like plotViewSettings.ts,
  // reportsFigureDocs.ts and viewAppliers.ts: one import line, one word on
  // the extends clause, one creator-spread line. `appendWorkspace`'s own
  // body (`runAppendWorkspace`) stays in store/workspaceIO.ts — that module
  // is not moving, it is already its own file below this pin — so only the
  // action's one-line delegate travelled. The FIELDS stay declared and
  // initialized on AppState here, same shape as all three earlier
  // extractions: `loadWorkspace` writes nearly all of them (a full-library
  // replace has to), but plenty of OTHER actions read and write them too, so
  // the fields are not this cluster's alone to own. No new store/ layering
  // grandfathered entry: workspaceHydration.ts imports only `lib/` helpers
  // and sibling store modules, never `components/`.
  // store/workspaceHydration.characterization.test.ts (20 specs pinning, for
  // both actions and every branch, the exact set of top-level store keys
  // each call changes — a poisoned whole-getState() diff covering every
  // `lib/plotview.ts` VIEW_KEY, so both the restored-plot-window branch's
  // write AND the legacy/fresh path's deliberate non-write are visible —
  // plus the toolWindowLayout key's conditional presence, the mapPaintedLimits/
  // mapViews P2.8 reset, and appendWorkspace's recordHistory-before-mutation
  // ordering) was written and run green against the PRE-extraction code and
  // passes byte-unchanged after the move.
  // 1451 -> 1386 (2026-09-19, the FIFTH P4.1 domain, zero headroom): MACRO
  // RECORDER + PIPELINE — `startMacro`/`stopMacro`/`clearMacro`/`recordMacro`
  // (the recorder; curated call sites throughout the store invoke
  // `recordMacro` unconditionally, the gate on whether it actually appends a
  // step lives in this cluster) and `updateStepParams`/`toggleStep`/
  // `removeStep`/`moveStep`/`insertStep`/`loadSteps`/`setPipelineRunning`
  // (the editable pipeline view, #6, over the same `macroSteps` list) — 11
  // actions over 3 fields (`macroRecording`, `macroSteps`, `pipelineRunning`)
  // — moved verbatim to the new store/macroPipeline.ts (MacroPipelineSlice),
  // composed exactly like plotViewSettings.ts/reportsFigureDocs.ts/
  // viewAppliers.ts/workspaceHydration.ts: one import line, one word on the
  // extends clause, one creator-spread line. Unlike the workspaceHydration
  // extraction just above, the FIELDS moved WITH the actions (declared and
  // initialized on MacroPipelineSlice, not on AppState) — this is the
  // store/gadget.ts shape (a genuine own-state slice), not the
  // corrections.ts/plotViewSettings.ts shape (a shared-field mutator):
  // grep across store/*.ts before the move found nothing outside this
  // cluster WRITING macroRecording/macroSteps/pipelineRunning except
  // store/workspaceHydration.ts's `loadWorkspace` (`ws.macroSteps ?? []`, a
  // plain-object-literal bulk restore — the same "bulk restores stay outside
  // the cluster" shape every earlier P4.1 domain already documents for its
  // own fields, not a functional dependency on this slice). Also unlike
  // every earlier P4.1 domain: none of these 11 actions call
  // `get().recordHistory` or `toast(...)` — macro/pipeline edits are simply
  // not part of the undo stack (history.ts's own exclusion list), so this
  // extraction's characterization file has no undo-label/toast half.
  // store/macroPipeline.characterization.test.ts (26 specs pinning, per
  // action AND per branch, the exact set of top-level store keys each call
  // changes — a poisoned whole-getState() diff — including the one genuine
  // short-circuit, `moveStep`'s "id not found" branch returning a literal
  // `{}` and writing nothing at all, told apart from every other unmatched-
  // id branch, which still produces a NEW `macroSteps` array reference via
  // `.map`/`.filter` even though its content is unchanged) was written and
  // run green against the PRE-extraction code and passes byte-unchanged
  // after the move.
  "/store/useApp.ts": 1386,
  // Review finding 2026-07-11: code that left App.tsx's component ratchet
  // must not become unguarded — the extracted registry + window slice get
  // their own shrink-only pins (founded at their extraction size).
  // 684 -> 56 (2026-07-17, zero headroom for upcoming features): the curated
  // command list was split by menu domain into commands/fileCommands.ts,
  // commands/dataCommands.ts, commands/analysisCommands.ts,
  // commands/plotCommands.ts (Plot + Insert), and commands/uiCommands.ts
  // (View + Edit + Help) — appCommands.ts is now just the thin composing
  // aggregator (36 lines + slack). Add a new command to its owning
  // commands/*.ts module, not here.
  "/appCommands.ts": 56,
  // 751 -> 749 (2026-07-31, PLOT_WORKFLOW_PLAN item 2): datasetViewDefaults
  // gained a `prevDs` param + the technique-defaults spread (item 1's
  // `metadata.technique` -> lib/techniqueDefaults.ts's axis-scale table),
  // paid for by consolidating tileWindows/cascadeWindows' identical relayout
  // body into `_relayoutVisible` and closeWindow/focusWindow/minimizeWindow/
  // restoreWindow's identical "hydrate + clear transient state" tail into
  // `_focusHandoff` — four call sites sharing one focus-patch shape instead
  // of repeating it.
  // 749 -> 749 (2026-08-01, PLOT_WORKFLOW_PLAN item 5, per-technique view
  // memory): `datasetViewDefaults` gained a `memory` param + the
  // capture/apply wiring at both rebind call sites (lib/techniqueViewMemory.ts
  // owns the actual logic), paid for by extracting the FIVE repeated
  // `dedupeWindowTitle(x, s.plotWindows.map(...))` call sites into one
  // `dedupeAgainstDisplayed` helper — net zero, ceiling unchanged.
  "/store/windows.ts": 749,
};

describe("store-size ratchet (MAIN_PLAN #2)", () => {
  it("pinned store modules only shrink — extract a slice, never raise the pin", () => {
    const over: string[] = [];
    for (const [key, ceiling] of Object.entries(STORE_PINS)) {
      const entry = sources().find(([p]) => p.endsWith(key));
      if (!entry) {
        over.push(`${key}: missing — update or remove its pin`);
        continue;
      }
      const lines = entry[1].split("\n").length;
      if (lines > ceiling) over.push(`${key}: ${lines} > ${ceiling}`);
    }
    expect(
      over,
      "extract another slice (see store/windows.ts for the pattern); do NOT raise the pin",
    ).toEqual([]);
  });
});

// Module-size ratchet for non-store `.ts` (JMP_GAP #14, 2026-07-29). The two
// guards above cover `.tsx` components and the store slices; everything else
// under lib/ and the workshop hooks sat in a gap, and the JMP campaign found
// it the way gaps are always found — `lib/api.ts` had reached 2,282 lines and
// `useDistribution.ts` 583, neither of which any test could see. Same iron
// rule as the other two: these numbers only ever go DOWN. A file that grows
// past its pin earns an extraction, not a bigger number.
//
// Pinned at their post-extraction size, no slack — a buffer just defers the
// next split (the useApp.ts note above says the same thing).
const MODULE_PINS: Record<string, number> = {
  // 2282 -> 1895 (2026-07-29): the transport helpers moved to lib/api/http.ts
  // and the /api/stats/* wrappers to lib/api/stats.ts, both re-exported from
  // api.ts so all 21 consumers (and their vi.mocks) are untouched. api.ts is
  // the aggregator now — the appCommands.ts/commands/ shape. J8's variability
  // wrappers are the next ones due and belong in api/stats.ts.
  // 1895 -> 1866 (P3.4 zoom-refetch residual): PlotRequest/plotSeries/
  // MapRequest/mapSeries moved to lib/api/plot.ts (the plotSeries `signal` +
  // x_min/x_max params would otherwise have pushed this back over its pin).
  // New /api/plot/* wrappers belong there, not here.
  // 1866 -> 1828 (DiraCulator expansion, two extractions composed):
  // crystalDSpacing/crystalCell moved to lib/api/crystallography.ts and
  // xrayCalc + neutronCalc/NeutronResult to lib/api/xray.ts — each wave's
  // new fields would otherwise have pushed this back over its pin. New
  // /api/crystallography/* and /api/xray/* wrappers belong there, not here.
  // 1828 -> 1782 (2026-08-07, FIGURE_AUTHORING F3.5): PagePanelSpec/
  // FigurePageSpec/exportFigurePage/renderFigurePageBlob moved to lib/
  // api/figurePage.ts — F3.5's new row_gap/col_gap/link_x/link_y/
  // align_labels/resize_mode fields would otherwise have pushed this back
  // over its pin. New figure-page fields/wrappers belong there, not here.
  // 1782 -> 1725 (RSM_CUTS_PLAN item 14): analyzeRsm/rsmStrain/rsmLinecut/
  // rsmCutSegment/rsmProjection migrated to lib/api/rsm.ts (no re-exports
  // in this file — consumers import directly). These five legacy wrappers
  // belonged in the new domain module from their first use; moving them now
  // lowers the pin (55 function lines + 2 type imports = 57 lines removed).
  // New /api/rsm/* wrappers belong in lib/api/rsm.ts.
  // lib/api.ts GRADUATED 2026-08-23 (pin was 1725; R8 bundle-diet pass):
  // the reference/units, sld, electrical, optics, vacuum, thermal,
  // diffusion, electrochemistry, semiconductor, thin-film, superconductor,
  // magnetic, baseline, curvefit (autoGuess/listFitModels/bootstrapFit/
  // validateEquation/fitEquation/findXY/scanFitModels), figures
  // (FigureSpec + export/render wrappers), datasetAlgebra, magnetometry,
  // peaks (findPeaks/fitPeak/fitMultiPeak), reflectivity, import-filter,
  // and reductions wrappers all moved to their own `api/<domain>.ts`
  // siblings — not a line-count exercise this time, but an EAGER-BYTES one
  // (see frontend/scripts/check-bundle-size.mjs's 2026-08-23 history
  // entry): every one of these was lazy-workshop-only, but co-location in
  // this file with useApp.ts's eager fftSpectral/fitModel/peaksIntegrate/
  // uploadFile imports was dragging the whole lazy set into the eager
  // bundle, since Rollup ships a module's code to wherever ANY of its
  // importers' chunks land. Dropped 1725 -> 299 lines, under this test's
  // own TSX_CEILING graduation bar, so the pin is deleted rather than
  // lowered (the "pins stay honest" check below). New wrappers for any of
  // those domains go in their sibling file, never back in lib/api.ts.
  // 583 -> 492 (2026-07-29): the J7 By-level half (per-level fetch effect,
  // its result shape, and the shared column/normality primitives) moved to
  // distribution/useDistributionByLevels.ts. The remaining oversize half is
  // the J12 fit/Compare/percentile block — the next extraction if this grows.
  "/distribution/useDistribution.ts": 492,
  // F1 document guardrails (2026-08-02): both modules had grown past the
  // general ceiling without a pin. They are intentionally pinned at their
  // exact discovered sizes; future document/persistence work must extract a
  // cohesive sibling instead of quietly extending either catch-all.
  // 754 -> 633 (RSM_CUTS_PLAN #13, named-ROI .dwk persistence): the fully
  // self-contained "Append a second workspace" section (`mergeWorkspace` +
  // `WorkspaceMergeResult`, one external caller) moved verbatim to the new
  // lib/workspaceMerge.ts, re-exported via `export * from "./workspaceMerge"`
  // so store/workspaceIO.ts's import needed no change — funding both the
  // extraction's own re-export line and the savedRois hook-in (field +
  // serialize call + parse call; the actual (de)serialize logic lives in
  // store/rois.ts, not here).
  // 633 -> 609 (2026-08-14, LIBRARY_WORKBOOK_UX_PLAN PR A2): the Origin
  // figure/fidelity parsing (`parseOriginFigures`/`parseOriginFidelity`/
  // `isOriginFidelityManifest`, plus the small shared `stringsIn` helper —
  // both functions and the helper were called only from this file, verified
  // by grep) moved verbatim to the new lib/workspaceOrigin.ts, funding the
  // new v4 `workbooks[]` wiring (WORKSPACE_VERSION bump + WorkspaceState/
  // LoadedWorkspace/WorkspaceDoc fields + the parseWorkspace
  // sanitizeWorkbooks/reconcileWorkbookRefs call site + serializer lines).
  // 609 -> 592 (2026-08-14, LIBRARY_WORKBOOK_UX_PLAN PR A3): the inline
  // genWorkbookId closure + reconcileWorkbookRefs call + membership-apply
  // loop moved verbatim to the new lib/workbooks.ts `applyWorkbookMigration`,
  // which also now applies A1's surrogate-folder conversion (dropping a
  // converted folder from folders/expandedFolders and re-homing its former
  // occupants) — a NET SHRINK even with the new conversion step folded in.
  // 592 -> 600 (2026-08-17, LIBRARY_WORKBOOK_UX_PLAN PR H): the four-site
  // additive .dwk field pattern (WorkspaceState optional field,
  // LoadedWorkspace required field, WorkspaceDoc field, serializer default +
  // parseWorkspace sanitize call + return field) for the new
  // `quickPlotTemplates` field, mirroring `savedPlotSpecs`'s existing
  // hook-in exactly. No extractable cohesive block funds this minimal
  // 8-line addition (comments trimmed to one line per site); written
  // justification per CLAUDE.md's "raise only with written justification".
  // 600 -> 421 (2026-08-22, P1.3 headroom funding): the per-dataset .dwk
  // parse/validate block (`isNumberArray`/`isDataStruct`/`parsePending` plus
  // the whole `o.datasets.map(...)` callback body — pure, only ever touched
  // `dd`/`i`, no closure over parseWorkspace's other locals) moved verbatim
  // to the new lib/workspaceDatasetParse.ts as `parseWorkspaceDataset`,
  // funding the still-unwired `plotRecipes` (P1.3) and `savedRecodeMappings`
  // (see store/recode.ts's SAVED MAPPINGS note, which names this exact
  // extraction as the intended funding move) additive-list hook-ins — an
  // extraction, not a bump, per the ratchet's own rule above.
  // 421 -> 430 (2026-08-22, P1.3 wave 2 Lane C): the `plotRecipes` project-
  // scope field wiring the note directly above pre-funded ("funding the
  // still-unwired `plotRecipes` (P1.3) ... additive-list hook-ins") — the
  // four-site additive .dwk field pattern (WorkspaceState optional field +
  // doc comment, LoadedWorkspace required field, WorkspaceDoc field,
  // serializer default + parseWorkspace sanitizeRecipes call + return field)
  // plus two new top-level imports (`PlotRecipe` type, `sanitizeRecipes`),
  // mirroring `quickPlotTemplates`'s own hook-in exactly. No extractable
  // cohesive block funds this 9-line addition; written justification per
  // CLAUDE.md's "raise only with written justification" — the pin's own
  // history comment named this exact addition as the intended spend.
  // workspace.ts GRADUATED 2026-08-30 (pin was 430; P3.5 recipe-source
  // fidelity): 429 -> 361 lines. The .dwk WRITE side — the private
  // `WorkspaceDoc` shape and `serializeWorkspace` — moved verbatim to
  // lib/workspaceSerialize.ts, re-exported from workspace.ts exactly as
  // lib/workspaceMerge.ts already was, so no importer changed. This file is
  // the READ side now; a new persisted field costs a line here and a line
  // there. The extraction is what funded the fidelity signal rather than a
  // bigger number, and it graduates the pin instead of lowering it.
  // 978 -> 981 (2026-08-23, FIGURE_AUTHORING_WORKFLOW_PLAN F4.4): `facetKey`
  // added to `PlotView` (interface field + `defaultPlotView()` +
  // `sanitizePlotView()`), mirroring `groupKey`'s own three-site pattern
  // exactly (bindings-owned, reset-on-switch, projected to/from
  // `FigureDocument.bindings.facetKey`) so a facet arrangement survives
  // focus switch/save/reopen/recipe-apply through the SAME already-correct
  // machinery `groupKey` uses — no new machinery, no extractable cohesive
  // block to fund it with. Written justification per CLAUDE.md's "raise
  // only with written justification".
  // 981 -> 980 (2026-09-17, BUG-014 round 4): the unchecked `seriesLabels`
  // cast became a one-line `sanitizeRecord.keyedRecord` call — the SAME
  // validator the recipe and technique-memory restore paths now share — so
  // a non-string rename is dropped here instead of crashing the canvas in
  // `richtext.hasMarkup`. The four-line ternary went out; the call, its
  // one-line note and the import came in: a ratchet, not a bump.
  "/lib/plotview.ts": 980,
};

describe("module-size ratchet (JMP_GAP #14)", () => {
  const ts = sources().filter(([p]) => p.endsWith(".ts"));

  it("pinned modules only shrink — extract a sibling, never raise the pin", () => {
    const over: string[] = [];
    for (const [key, ceiling] of Object.entries(MODULE_PINS)) {
      const entry = ts.find(([p]) => p.endsWith(key));
      if (!entry) {
        over.push(`${key}: missing — update or remove its pin`);
        continue;
      }
      const lines = entry[1].split("\n").length;
      if (lines > ceiling) over.push(`${key}: ${lines} > ${ceiling}`);
    }
    expect(
      over,
      "move the next cohesive block to a sibling module (lib/api/stats.ts is the template); do NOT raise the pin",
    ).toEqual([]);
  });

  it("pins stay honest — a file that dropped under the .tsx ceiling must lose its pin", () => {
    const stale = Object.keys(MODULE_PINS).filter((key) => {
      const entry = ts.find(([p]) => p.endsWith(key));
      return entry != null && entry[1].split("\n").length <= TSX_CEILING;
    });
    expect(stale, `graduated: now <=${TSX_CEILING} lines — delete the pin (ratchet down)`).toEqual(
      [],
    );
  });
});

// General .ts source-file ceiling (RSM_CUTS_PLAN item 20, 2026-08-09). The gap in
// the prior guards: `.tsx` had a 400-line ceiling and store `.ts` slices had pins,
// so every OTHER `.ts` had neither — which is exactly how `lib/api.ts` reached 2,282
// lines and `useDistribution.ts` 583 in the JMP campaign, both invisible to a green
// suite. This guard closes the gap. Ceiling: 500 lines (matching the backend's Python
// module ceiling in `tests/test_repo_integrity.py` — the two languages now agree).
// Files that already exceed it are pinned at their exact current size (verified with
// `wc -l` on 2026-08-09); they can only SHRINK, never grow. New .ts files must stay
// under 500, or earn an extraction like lib/api/http.ts and lib/api/stats.ts did.
const TS_CEILING = 500;
// path-suffix -> pinned max (exact current line count at pin time). RATCHET DOWN ONLY.
// These 16 files are the discovered overage set from the RSM/ROI campaigns. Future
// growth in any of them must fund an extraction, not a ceiling bump.
const TS_MODULE_PINS: Record<string, number> = {
  // 1446 -> 1428 (2026-09-12, PRIMARY_SOFTWARE_AUDIT_PLAN P3.3 auto dash/marker
  // cycle): `buildOpts` had to gain a `seriesCycle` argument, so THREE cohesive
  // siblings moved out rather than the pin moving up — the `DASH` table to the
  // new lib/seriesStyleCycle.ts (the dash vocabulary belongs with the cycle that
  // assigns it, and the export-parity test compares against it without pulling
  // in the plot builder), the marker `points` decision to
  // lib/markers.seriesPoints (which already owned every other marker concern),
  // and the palette (cssVar / SERIES_VARS / seriesColor) to
  // lib/seriesStyleCycle.ts as well (hue by display position beside dash and
  // glyph by display position) — which also stops lib/exportStyles.ts importing
  // the whole uPlot options builder just to resolve a colour. The palette is
  // re-exported from here, so no importer changed. Ratcheted to what the file
  // actually is.
  "/lib/uplotOpts.ts": 1428,
  "/lib/uplotOverlays.ts": 1175,
  // 1090 -> 1040 (2026-08-14, LIBRARY_WORKBOOK_UX_PLAN PR A1): the Reductions
  // wire types (WilliamsonHallResult/FftThicknessResult/SuperlatticeResult/
  // ReflectivityFftResult) — a self-contained leaf block nothing else in this
  // file references — moved verbatim to the new lib/reductionTypes.ts,
  // funding the new WorkbookNode type + Dataset.workbookId field added next.
  // 1040 -> 1053 (2026-08-14, same PR): added the `Dataset.workbookId` field
  // (see lib/workbooks.ts's `deriveWorkbooks`/`reconcileWorkbookRefs`, the
  // new pure module that derives/repairs it — not yet wired into the store
  // or .dwk; that's PR A2).
  // 1053 -> 1009 (2026-09-14, PRIMARY_SOFTWARE_AUDIT_PLAN P2.1): the four
  // /api/peaks wire types (Peak/FittedPeak/MultiFitResult/SinglePeakFit) — a
  // self-contained leaf block, the same shape as the Reductions extraction
  // above — moved verbatim to the new lib/peakTable.ts, which is now the single
  // home for the peak contract because P2.1's durable `PeakTable` is built from
  // and rehydrated into exactly those shapes. Re-exported from types.ts, so no
  // importer changed. Funds this item's own `Dataset.peakTable` field and
  // ratchets down by the balance.
  "/lib/types.ts": 1009,
  "/lib/plotspec.ts": 893,
  // originFigures.ts GRADUATED 2026-08-30 (pin was 793; BUNDLE_HEADROOM
  // slice 1): 793 -> 208 lines. The apply-only half — legend/annotation/
  // region resolution and the spatial multi-panel solver — moved to
  // lib/originFigureSelection.ts + lib/originSpatialPanels.ts, which the
  // store loads on demand via store/originApplyLibs.ts. Like lib/api.ts
  // above this was an EAGER-BYTES extraction, not a line-count one:
  // measured 890.2 -> 885.3 kB eager (local, same environment).
  // Unchanged at 791 (2026-09-12, P3.3): the spatial cells' opt-in to the
  // dash/marker cycle paid for itself — the per-cell styles/labels/legend
  // derivation moved to `lib/multipanel.spatialCellStyling`, where the spatial
  // EXPORT's own channel list already lives, so the two cannot drift.
  // 787 -> 757 (2026-09-17, BUG-014 round 4): the PLAIN STACK and paneled
  // X-BREAK render legs moved to components/Stage/stackPanelRender.ts and
  // breakPanelRender.ts, the siblings facetGridRender.ts already set the
  // pattern for — which is what funded the per-leg `seriesLabels` projection
  // (a legend rename now reaches all three multi-panel legs' y-axis labels,
  // the way the export already carried it). An extraction, not a bump: the
  // hook keeps mode selection, state and the effect lifecycle only.
  // 757 -> 753 (2026-09-17, BUG-014 round 5): the break leg's whole
  // `breakLabels` memo (a whole-dataset channel re-derivation plus a
  // series-count fail-closed guard) is gone — each `BreakPanel` now carries
  // its own `channels` list, so `breakPanelRender.ts` projects the
  // channel-keyed renames per panel with no derivation to guard. Part of the
  // saving went back into the stack leg's payload/channel snapshot (N4).
  "/components/Stage/useMultiPanelStage.ts": 753,
  // 704 -> 569 (2026-09-11, Group R), in TWO extractions, because the file had
  // exactly zero headroom against this pin and the feature needed room:
  //   * the column PICKS — mode/groupCol/group2Col/valueCol/facetCol, the
  //     per-dataset reset, the Graph Builder seed and the staleness mask —
  //     moved to components/Stage/useStatStagePicks.ts;
  //   * the whole server-side figure EXPORT path — the flat spec builder and
  //     the faceted variant, which used to be a method closing over six hook
  //     locals — moved to components/Stage/statStageExport.ts. Imported
  //     EAGERLY: a dynamic import() there was built and measured and made the
  //     eager bundle worse, see that file's header. Its column helpers went to
  //     lib/statstage.ts instead, since the render path calls them
  //     synchronously.
  "/components/Stage/useStatStage.ts": 569,
  // useCalculators.ts GRADUATED 2026-08-15 (pin was 681): the DIRACULATOR_AUDIT
  // P3 split moved each shared-state domain to its own bounded hook
  // (useUnitsCalc / useXrayCalc / useCrystalCalc / useSldCalc, all under the
  // general ceiling); the facade file keeps only tab state, the constants
  // fetch, composition, and the cross-panel handoffs.
  "/lib/roiMath.ts": 664,
  "/components/workshops/graphbuilder/useGraphBuilder.ts": 663,
  // 658 -> 650 (2026-09-14, BUG-013): `applyWaterfall`'s span/step scan moved
  // to lib/waterfallOffset.ts, where the EXPORT wire's `waterfall_offsets` builder
  // reads it too — so the canvas and the exported figure resolve the same step
  // from one implementation. A ratchet, not a bump: 11 lines freed, 1 spent.
  "/lib/plotdata.ts": 650,
  // Unchanged at 648 (BUG-009): its hand-rolled `pendingGuard` became a one-line
  // call to `store/pendingEdit.refusePendingEdit`, and dropping the duplicate paid
  // for the import exactly — net zero, so there is no ratchet to record here.
  "/components/Stage/worksheet/useWorksheetView.ts": 648,
  "/lib/roi.ts": 638,
  // 637 -> 636 (2026-09-12, P3.3): its private `MARKER_SHAPE_VALUES` set moved
  // to lib/seriesStyleCycle.ts, where it is DERIVED from the marker cycle, so
  // `publicationStyles.ts`'s wire sanitizer validates `marker_shape` against
  // the SAME list this view-style sanitizer uses instead of accepting any
  // string. (Not lib/markers.ts: that module carries the canvas path builders,
  // and the persistence layer is kept clear of them.)
  "/lib/plotspec2.ts": 636,
  // 600 -> 598 (2026-08-12): the item-1 drift check's rationale moved to
  // canonicalSession.ts's selectSessionLiveDrifted, where the subscription
  // contract it documents actually lives. Ratchet, not a bump.
  // 598 -> 570 (2026-08-12, F2.3d): the legacy-mode spec + FigureDoc builders
  // moved to legacyFigure.ts as pure functions, which is what funded F2.3d's
  // reference-line wiring — the same extract-first discipline canonicalReadiness.ts
  // used for F2.3c. Note the net is DOWN even after the new slice: 47 lines
  // freed, 28 spent. The next canonical slice extracts again; it does not bump.
  // 570 -> 552 (2026-08-12, F2.3e): the #15 graph-template block moved to
  // useGraphTemplates.ts, funding the tick-format wiring. Net down again: 37
  // freed, 19 spent. Two slices, two extractions, pin 598 -> 552.
  // 552 -> 522 (2026-08-12, F2.4d): the debounced preview render + hit-map
  // state moved to usePreviewRender.ts, funding the reference-line drag. 41
  // freed, 11 spent. Three slices, three extractions, pin 598 -> 522 — the
  // ratchet has paid for every one of them and never been raised.
  // useFigureBuilder.ts GRADUATED 2026-08-12 (pin was 522): the F2.4e+F2.3f
  // pair each funded itself with the same figureOutputConstants.ts
  // extraction, so their merge went 21 over — resolved by also moving the
  // drag-to-place dispatch whole to previewDrag.ts, which dropped the hook
  // under the general ceiling and off this list entirely.
  "/lib/uplotShapes.ts": 593,
  // 527 -> 505 (2026-09-11, Group R review finding 1): the CATEGORY axis —
  // `drawCategoryAxis` and the `truncateLabel` budget it is the only caller of
  // — moved to components/Stage/statRenderAxes.ts. The nested-label fix (two
  // stacked lines instead of one truncated one) pushed this file past the pin,
  // and the label-fitting rule is a real unit, not a convenient offcut.
  "/components/Stage/statRender.ts": 505,
};

describe("general .ts module-size ceiling (RSM_CUTS_PLAN #20)", () => {
  // lib/api/schema.d.ts is generated wholesale by `npm run api:types`
  // (openapi-typescript, from api/openapi.json) — thousands of lines of
  // machine-produced type declarations with no cohesive slice to extract.
  // Excluded from the ratchet rather than pinned: a pin implies "shrink me",
  // and this file only grows as the backend's route surface grows.
  const ts = sources().filter(([p]) => p.endsWith(".ts") && !p.endsWith("/lib/api/schema.d.ts"));

  it("no .ts module exceeds its ceiling (500, or its pin if already over)", () => {
    const over: string[] = [];
    for (const [p, src] of ts) {
      const lines = src.split("\n").length;
      // Check if this file is already in store or module pins (skip those, they have their own guards)
      const inStorePin = Object.keys(STORE_PINS).some((k) => p.endsWith(k));
      const inModulePin = Object.keys(MODULE_PINS).some((k) => p.endsWith(k));
      if (inStorePin || inModulePin) continue;

      const pinKey = Object.keys(TS_MODULE_PINS).find((k) => p.endsWith(k));
      const ceiling = pinKey ? TS_MODULE_PINS[pinKey] : TS_CEILING;
      if (lines > ceiling) over.push(`${p}: ${lines} > ${ceiling}`);
    }
    expect(
      over,
      "extract a cohesive sibling (lib/api/http.ts, lib/api/stats.ts are templates); do NOT raise the pin",
    ).toEqual([]);
  });

  it("grandfathered .ts pins stay honest — a file that dropped under 500 must lose its pin", () => {
    const stale: string[] = [];
    for (const key of Object.keys(TS_MODULE_PINS)) {
      const entry = ts.find(([p]) => p.endsWith(key));
      if (!entry) {
        stale.push(`${key}: no longer exists — remove its pin`);
        continue;
      }
      if (entry[1].split("\n").length <= TS_CEILING) {
        stale.push(`${key}: now <=${TS_CEILING} — remove its pin (ratchet down)`);
      }
    }
    expect(stale, "the pin list must shrink as files are extracted").toEqual([]);
  });
});

// lib/ layering guard (DIRACULATOR_AUDIT P3, 2026-08-15). Two tiers:
//
// 1. The TRANSPORT layer (lib/api.ts + lib/api/) must NEVER import from
//    components/ — lib/api.ts importing SubstrateInfo from SubstratesTab.tsx
//    made a UI file the owner of a wire contract. Wire types live beside
//    their wrappers (lib/api/substrates.ts is the template). Hard ban.
// 2. The rest of lib/ carries a RATCHET: eleven command/menu-glue modules
//    (discovered 2026-08-15) import UI primitives (askParams/askConfirm,
//    ContextMenuItem) — UI-adjacent orchestration that predates this guard.
//    They are grandfathered; NEW lib files must not import components/, and
//    a grandfathered file that drops the import must leave the list.
const LIB_UI_GRANDFATHERED = new Set([
  "./lib/contextActions.ts",
  "./lib/datasetRemoval.ts",
  "./lib/exportFigureCommand.ts",
  "./lib/exportPageCommand.ts",
  "./lib/menuKeyboardNav.ts",
  "./lib/pageSetupCommand.ts",
  "./lib/paletteContextActions.ts",
  "./lib/plotMenu.ts",
  "./lib/plotToolbarDefs.ts",
  "./lib/workbookContextActions.ts",
  "./lib/worksheetTransformCommands.ts",
]);

// store/ layering guard (P4.1 review F1, 2026-09-17). store/plotViewSettings.ts's
// header claims "architecture.test.ts's import-direction guards keep lib/ and
// store/ below the component layer" — that was true for lib/ (above) but not
// for store/, which had no guard at all. Same shape as the lib/ ratchet: three
// store modules already import askConfirm from components/overlays/ConfirmDialog
// (discovered 2026-09-17, predates this guard); they are grandfathered, and a
// NEW store file must not import components/. The grandfathered list only
// shrinks — a file that drops the import must leave it.
const STORE_UI_GRANDFATHERED = new Set([
  "./store/originFigureApply.ts",
  "./store/reimport.ts",
  "./store/reimportAllRun.ts",
]);

// PENDING-EDIT GUARD RATCHET (BUG-006 site 9, added review round 5).
//
// Five review rounds on one feature produced two HIGH defects per round, and the
// reason was structural, not careless: NOTHING noticed a MISSING guard. Both the
// suite and each reviewer could only see the guards that existed, so round 4 could
// extend the guard to three sites and still miss the two that CORRUPT data
// (`computedColumns.addFormula` and `recode`: the formula survives the resolve while
// the preview's labels do not, so `baseCount = labels.length - formulas.length` then
// treats a real measured channel as the computed one and overwrites its imported
// values under its own label).
//
// So: a store module whose dataset updater writes `data`, `metadata`, `cat_levels`
// or `formulas` must either route through `store/pendingEdit.refusePendingEdit` or
// be listed below with a reason. A NEW such module fails this test.
//
// SHAPES IT MATCHES, counted in-repo rather than guessed: the object-literal
// `datasets: <state>.datasets.map(` (38 uses), the assigned
// `const datasets = <state>.datasets.map(` (4 — `removeFormula`'s shape, which the
// first version of this ratchet MISSED), and the array-literal `datasets: [` (6).
//
// WHAT IT CATCHES, verified by sabotage rather than asserted:
//   * a wholly new store module with an unguarded updater in any matched shape;
//   * a SECOND unguarded action added to an already-guarded module (the first
//     version missed this — it token-matched the FILE, so deleting all four guard
//     CALLS while leaving the imports kept the whole suite green);
//   * a guard deleted from one action while its siblings keep theirs.
//
// WHAT IT DOES NOT CATCH, so nobody reads a green run as a proof. It is a REGEX
// over source text, not type-aware:
//   * a mutation routed through a `lib/` helper that RETURNS a whole Dataset which
//     the store then swaps in by identity. Live instance, benign today:
//     `useApp.ts:1142` assigns `originOverlayDataset(...)` (which writes `metadata`
//     in `lib/originOverlay.ts`) — the detector reports NOTHING for useApp.ts.
//     Widening to "replaces a whole Dataset from a variable" would flag every
//     legitimate replacement (import, reimport, restore-from-trash, overlay
//     refresh) and need an exemption list larger than the set it protects.
//   * `{ ...d, ...patch }` with the patch precomputed — `store/corrections.ts` and
//     `store/recalcDatasets.ts`'s real shape. Both safe today (corrections awaits
//     `resolveDataset`; the derived path throws on a pending source), but this net
//     contributes nothing to keeping them that way.
//   * `useApp.getState().datasets.map(` — `\w+\.datasets` cannot match `getState()`.
//   * a mutated key further than PENDING_EDIT_WINDOW past the `datasets:` match.
//     (WAS a blind spot, CLOSED 2026-09-10 with BUG-009's guard half: the key
//     list now includes `excludedRows|filter`, so the row-state writers are
//     covered by this ratchet and not only by store/rowState.test.ts. Before
//     that, `toggleRowExcluded` et al were genuinely unguarded — accepted on a
//     pending dataset, history entry pushed, wiped by `installBookData` — and
//     nothing here noticed, which is BUG-009's own stated root cause. Extending
//     the regex is what keeps a NEW row-state writer in a NEW slice from
//     repeating it.)
//   * anything outside `./store/`.
//
// Checked while writing it: the only `useApp.setState` in `store/` that mutates
// dataset data is `recode`'s, which IS matched; `relink`/`relinkCommit` set only
// `source`/`versionOf`, so they are correctly not flagged.
/** How far past a `datasets:` match to look for a mutated key. Updaters here carry
 *  20-line comment blocks, so a tight window false-NEGATIVES. */
const PENDING_EDIT_WINDOW = 1400;

const lineOf = (src: string, at: number): number => src.slice(0, at).split("\n").length;

/** Does the ACTION enclosing `at` call a pending-edit boundary?
 *
 *  Walks backward LINE by line to the nearest action boundary — a slice action
 *  (`  name: (args) =>`) or a top-level function — and looks for the guard between
 *  there and the updater.
 *
 *  Not a brace walk: the mutation always sits inside `set((s) => ({ datasets: ... }))`,
 *  so the nearest enclosing `{` is that inner arrow and the guard (earlier in the
 *  action, OUTSIDE the `set`) would never be seen. A brace walk was the first
 *  attempt and flagged all six already-guarded sites — a false positive that would
 *  have made this ratchet unusable and got it deleted. */
function hasGuardInEnclosingAction(src: string, at: number): boolean {
  const lines = src.slice(0, at).split("\n");
  // An ACTION start only. A plain local `const byRow = new Map(...)` must NOT count:
  // it does, if the `const` form is not pinned to column 0, and that cut the walk
  // short inside `setCellBlock`/`setCategoricalCell` — flagging two guarded sites.
  const boundary =
    /^(?:(?:export\s+)?(?:async\s+)?function\s|(?:export\s+)?const\s+\w[\w$]*\s*=)|^\s{2,4}\w[\w$]*\s*:\s*(?:async\s*)?\(/;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/\b(?:refuse|resolve)PendingEdit\b/.test(lines[i])) return true;
    if (boundary.test(lines[i])) return false;
  }
  return false;
}

function enclosingActionName(src: string, at: number): string | null {
  const lines = src.slice(0, at).split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = /^\s{2,4}(\w[\w$]*)\s*:\s*(?:async\s*)?\(/.exec(lines[i]);
    if (m) return m[1];
    if (/^(?:(?:export\s+)?(?:async\s+)?function\s|(?:export\s+)?const\s+\w[\w$]*\s*=)/.test(lines[i])) return null;
  }
  return null;
}

const PENDING_EDIT_EXEMPT = new Map<string, string>([
  [
    "reimport.ts",
    "REPLACES data deliberately with freshly fetched bytes and clears `pending` in " +
      "the same updater — the resolve-and-replace pattern, same as installBookData.",
  ],
]);

// Per-ACTION exemptions for the `excludedRows`/`filter` keys the list above
// gained in 2026-09-10's BUG-009 pass. Keyed by ACTION NAME, not by file: the
// first draft of this was a file-level map, and sabotage caught it excusing
// rowState.ts's five guarded WRITERS along with its two deliberate clears —
// dropping the guard from `toggleRowExcluded` left this ratchet green, which is
// precisely the hole it was added to close. An action not named here gets no
// row-state pass, however row-state-only its updater looks.
const ROW_STATE_EXEMPT = new Map<string, string>([
  [
    "clearRowExclusions",
    "clearing destroys a preference rather than recording one, and refusing it would " +
      "trap a user whose .dwk restored row state alongside `pending` (store/rowState.ts's " +
      "header). rowState.test.ts pins BOTH directions, so this is not an oversight.",
  ],
  [
    "clearDatasetFilter",
    "same as clearRowExclusions — a clear cannot lose user intent.",
  ],
  [
    "resetCorrections",
    "store/corrections.ts CLEARS index-based row state because reverting a trim " +
      "restores rows and makes it stale — the same rowsChanged rule the apply path " +
      "uses. A clear, not a write, and the action awaits `resolveDataset` first.",
  ],
]);

describe("pending-edit guard ratchet (BUG-006 site 9)", () => {
  it("every store module that mutates a dataset's data guards it, or is listed with a reason", () => {
    const offenders: string[] = [];
    for (const [path, src] of sources()) {
      if (!path.startsWith("./store/") || path.endsWith(".test.ts")) continue;
      const name = path.slice("./store/".length);
      const updaters = [
        ...src.matchAll(/datasets:\s*\w+\.datasets\.map\(/g),
        ...src.matchAll(/\w+\s*=\s*\w+\.datasets\.map\(/g),
        ...src.matchAll(/datasets:\s*\[/g),
      ];
      const touchesData = updaters.some((m) =>
        /\b(data|metadata|cat_levels|formulas|excludedRows|filter)\s*:/.test(src.slice(m.index ?? 0, (m.index ?? 0) + 1400)),
      );
      if (!touchesData) continue;
      if (PENDING_EDIT_EXEMPT.has(name)) continue;
      // PER-UPDATER, not per-FILE. `src.includes("refusePendingEdit")` was the first
      // version and it enforced almost nothing: deleting all four guard CALLS while
      // leaving the imports kept the whole suite green, so the data-corrupting fix
      // this ratchet exists for was protected by nothing but an eslint
      // unused-import error — which a PARTIAL deletion, or a reordering, defeats
      // outright. Each offending updater must have a guard in its OWN enclosing
      // block.
      for (const m of updaters) {
        const at = m.index ?? 0;
        const window = src.slice(at, at + PENDING_EDIT_WINDOW);
        if (!/\b(data|metadata|cat_levels|formulas|excludedRows|filter)\s*:/.test(window)) continue;
        // A ROW-STATE-ONLY updater inside an exempted ACTION is excused. One
        // that also touches data/metadata/cat_levels/formulas is NOT, so an
        // exemption can never smuggle a real data write past the net.
        const rowStateOnly = !/\b(data|metadata|cat_levels|formulas)\s*:/.test(window);
        const action = enclosingActionName(src, at);
        if (rowStateOnly && action != null && ROW_STATE_EXEMPT.has(action)) continue;
        if (!hasGuardInEnclosingAction(src, at)) offenders.push(`${name}:${lineOf(src, at)}`);
      }
    }
    expect(
      offenders,
      "route the mutation through store/pendingEdit's refusePendingEdit or resolvePendingEdit (a pending " +
        "dataset's `data` is replaced wholesale when its fetch lands, so anything " +
        "written into it is discarded silently), or add it to PENDING_EDIT_EXEMPT " +
        "with the reason it is safe",
    ).toEqual([]);
  });

  it("the exemption list stays honest — entries keep both their updater AND their reason", () => {
    // Scoped to ./store/ — the first version mapped ALL sources, so
    // `"./lib/foo.ts".slice("./store/".length)` became `"o.ts"`: garbage keys and
    // silently dropped collisions.
    const byName = new Map(
      [...sources()]
        .filter(([p]) => p.startsWith("./store/"))
        .map(([p, src]) => [p.slice("./store/".length), src]),
    );
    const stale = [...PENDING_EDIT_EXEMPT.keys()].filter((n) => {
      const src = byName.get(n);
      return (
        !src ||
        !(
          /datasets:\s*\w+\.datasets\.map\(/.test(src) ||
          /\w+\s*=\s*\w+\.datasets\.map\(/.test(src) ||
          /datasets:\s*\[/.test(src)
        )
      );
    });
    expect(stale, "drop the exemption; its updater is gone").toEqual([]);

    // And the REASON must still hold. `reimport.ts` is exempt because it clears
    // `pending` in the same updater that replaces `data`; deleting that clause left
    // the exemption self-asserted and every test green.
    const reimport = byName.get("reimport.ts") ?? "";
    expect(
      /pending:\s*undefined/.test(reimport),
      "reimport.ts's exemption claims it clears `pending` in the same updater — it no " +
        "longer does, so either restore that or drop the exemption",
    ).toBe(true);
  });
});

describe("lib/ layering guard (DIRACULATOR_AUDIT P3)", () => {
  const importsComponents = (src: string): boolean =>
    /from\s+["'][^"']*components\//.test(src);
  const libFiles = () => sources().filter(([p]) => p.startsWith("./lib/"));

  it("the transport layer (lib/api.ts + lib/api/) never imports from components/", () => {
    const bad = libFiles()
      .filter(([p]) => p === "./lib/api.ts" || p.startsWith("./lib/api/"))
      .filter(([, src]) => importsComponents(src))
      .map(([p]) => p);
    expect(
      bad,
      "move the wire type/contract into lib (lib/api/substrates.ts is the template)",
    ).toEqual([]);
  });

  it("no NEW lib/ module imports from components/ (grandfathered set only shrinks)", () => {
    const bad = libFiles()
      .filter(([p]) => !LIB_UI_GRANDFATHERED.has(p))
      .filter(([, src]) => importsComponents(src))
      .map(([p]) => p);
    expect(
      bad,
      "lib is the lower layer — inject the UI dependency from the caller instead",
    ).toEqual([]);
  });

  it("the grandfathered list stays honest — a file that dropped the import leaves the list", () => {
    const stale = [...LIB_UI_GRANDFATHERED].filter((key) => {
      const entry = libFiles().find(([p]) => p === key);
      return entry == null || !importsComponents(entry[1]);
    });
    expect(stale, "remove from LIB_UI_GRANDFATHERED (ratchet down)").toEqual([]);
  });
});

describe("store/ layering guard (P4.1 review F1)", () => {
  const importsComponents = (src: string): boolean =>
    /from\s+["'][^"']*components\//.test(src);
  const storeFiles = () => sources().filter(([p]) => p.startsWith("./store/"));

  it("no NEW store/ module imports from components/ (grandfathered set only shrinks)", () => {
    const bad = storeFiles()
      .filter(([p]) => !STORE_UI_GRANDFATHERED.has(p))
      .filter(([, src]) => importsComponents(src))
      .map(([p]) => p);
    expect(
      bad,
      "store is a lower layer — inject the UI dependency from the caller instead",
    ).toEqual([]);
  });

  it("the grandfathered list stays honest — a file that dropped the import leaves the list", () => {
    const stale = [...STORE_UI_GRANDFATHERED].filter((key) => {
      const entry = storeFiles().find(([p]) => p === key);
      return entry == null || !importsComponents(entry[1]);
    });
    expect(stale, "remove from STORE_UI_GRANDFATHERED (ratchet down)").toEqual([]);
  });
});

describe("row-state model guard (#50 universal linking)", () => {
  it("only the row-state model reads/writes Dataset.excludedRows", () => {
    // rowstate = the exclusion primitives; workspace = .dwk (de)serialize;
    // rowState = the store mutation actions (they lived in useApp.ts until
    // 2026-09-10's BUG-009 extraction, which is why useApp.ts is NOT here);
    // corrections = the
    // applyCorrections/resetCorrections mutation actions extracted out of
    // useApp.ts (2026-07-18, store-size ratchet) — still a store mutation
    // action, just relocated to its own slice file. Everything else goes
    // through rowstate.analysisData / droppedRows / excludedSet.
    //
    // cellEdit added 2026-07-25 (MAIN_PLAN #34, insert/delete rows) — a
    // deliberate extension, which per this guard's own contract is the review
    // checkpoint. It is a WRITER, not a new reader-of-truth: inserting or
    // deleting rows renumbers every stored row index, so it REMAPS
    // excludedRows through lib/rowShift instead of leaving them pointing at
    // the wrong rows. Clearing them (the corrections fallback) would be
    // needless damage here, because an explicit insert/delete knows exactly
    // what moved — unlike a trim, whose mapping is unrecoverable from lengths.
    const allow = [
      "/lib/rowstate.ts",
      // Lazy Origin preview resolution is the one boundary where exclusions
      // must be read directly: it translates preview indices into full-book
      // source indices before publishing the replacement dataset (BUG-009).
      "/lib/bookData.ts",
      // ("/lib/workspace.ts" LEFT this list 2026-09-10 — the new staleness
      // check below caught it on its first run: both its read and write bodies
      // moved to workspaceDatasetParse.ts / workspaceSerialize.ts, which are
      // listed just under, so the entry had been vestigial since those
      // extractions.)
      // The per-dataset .dwk parse/validate body that used to live inline in
      // workspace.ts's parseWorkspace (2026-08-22 extraction) — same .dwk
      // (de)serialize role as workspace.ts itself, just relocated.
      "/lib/workspaceDatasetParse.ts",
      // The .dwk WRITE side that used to live inline in workspace.ts
      // (2026-08-30 extraction, P3.5) — same (de)serialize role, relocated
      // for the same size-pin reason as workspaceDatasetParse.ts above.
      "/lib/workspaceSerialize.ts",
      // Row exclusion's own store slice (2026-09-10, BUG-009's guard half) —
      // the actions that used to sit inline in useApp.ts, relocated under the
      // store-size pin so a pending guard would fit. useApp.ts LEFT this list
      // in the same commit: it no longer names `.excludedRows` anywhere, and a
      // stale allow entry is exactly the dishonesty the sibling
      // "grandfathered list stays honest" test exists to prevent.
      "/store/rowState.ts",
      "/store/corrections.ts",
      "/store/cellEdit.ts",
      // recalcNow's dataset-recompute loop, extracted out of useApp.ts
      // (2026-09-09, LIBRARY_WORKBOOK_UX_PLAN recalc determinism/auditability
      // pass, same store-size-pin reason as corrections.ts's own extraction
      // above) — still calls rowsChangedGuard on the SAME
      // recompute-invalidates-excludedRows path, just relocated.
      "/store/recalcDatasets.ts",
    ];
    expect(
      offenders(/\.excludedRows\b/, allow),
      "read exclusion via lib/rowstate (analysisData/droppedRows/excludedSet), not Dataset.excludedRows directly",
    ).toEqual([]);

    // Review round L2: this allowlist had no staleness guard, so the hygiene
    // was manual and would rot — the 2026-09-10 removal of "/store/useApp.ts"
    // (which stopped naming the field when its actions moved to rowState.ts)
    // was justified by invoking the "grandfathered list stays honest" tests,
    // and those cover TS_MODULE_PINS and LIB_UI_GRANDFATHERED, NOT this list.
    // Shaped like theirs: an entry that no longer matches must leave.
    const stale = allow.filter((key) => {
      const entry = sources().find(([path]) => path.endsWith(key));
      return entry == null || !/\.excludedRows\b/.test(entry[1]);
    });
    expect(stale, "remove from the allowlist (ratchet down) — it no longer touches the field").toEqual([]);
  });

  it("only sanctioned modules reduce the local filter via filteredOutRows", () => {
    // datafilter defines it; rowstate is the chokepoint that folds it into
    // analysisData; the filter workshop uses it for its live drop-count preview.
    const allow = [
      "/lib/datafilter.ts",
      "/lib/rowstate.ts",
      "/components/workshops/datafilter/useDataFilter.ts",
    ];
    expect(
      offenders(/\bfilteredOutRows\s*\(/, allow),
      "derive dropped rows via lib/rowstate.analysisData, not filteredOutRows",
    ).toEqual([]);
  });
});

// BUG-008 (plans/BUGS_AND_ISSUES.md): `lib/datasetsplit.ts` asked the RAW
// shape heuristic `inferModelingType` whether a column is categorical, while
// `lib/byPartition.ts` asked the sanctioned accessor `channelModelingType` —
// which honours the user's `channelTypes` override, then an explicit
// `cat_levels` level table, and only THEN the heuristic. Two paths, two
// answers to the same question: a 3-sample/6-row categorical column that
// byPartition offered as categorical was gap-clustered by Split into ONE
// group, silently merging three samples into one dataset.
//
// The fix was one edit; this guard is what stops the NEXT one. Nothing in the
// suite could see a module reaching past the accessor before — the divergence
// was found by reading, not by a failing test.
describe("modeling-type accessor chokepoint (BUG-008)", () => {
  // The FIRST cut of this guard was `offenders(/\binferModelingType\s*\(/,
  // ["/lib/modeling.ts"])`, and the review round measured it inverted in all
  // three directions:
  //   * an aliased import evaded it while making the real call —
  //     `import { inferModelingType as inferType } from "./modeling"` then
  //     `inferType(...)` left the guard GREEN, which is BUG-008 verbatim;
  //   * a file whose only mention was a `//` doc comment FAILED it, because
  //     `\s*` matches the space in prose like "inferModelingType (MIN_SAMPLES
  //     =12)" — text that already exists in two test files and in
  //     `lib/statschooser.ts`'s header;
  //   * `endsWith("/lib/modeling.ts")` is directory-blind, so a
  //     `components/probe/lib/modeling.ts` was allowlisted too.
  // So: strip comments, then flag the IDENTIFIER anywhere in real code (an
  // import binding is the only way to reach a module-local function, and the
  // import statement always spells the original name even when aliased), and
  // compare the path EXACTLY.
  const MODELING = "./lib/modeling.ts";

  /** `src` with comments AND string/template literals removed, so text that
   *  merely NAMES the function — prose in a doc comment, a help string, a
   *  toast, an error message — is never mistaken for reaching it. The
   *  round-2 review measured the comments-only version flagging
   *  `export const HELP_TEXT = "… inferModelingType …"`, i.e. the round had
   *  traded a comment false-positive for a string one rather than
   *  eliminating the class. Same technique as the browser-storage guard at
   *  the top of this file, extended to literals.
   *
   *  Deliberately naive about a `//` inside a string ("https://x" eats the
   *  rest of its line) — stripping literals FIRST is what makes that
   *  harmless here, and an import statement, which is what actually matches,
   *  never shares a line with a URL. */
  function withoutCommentsOrStrings(src: string): string {
    return src
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      // Block comments become the SAME NUMBER of newlines, not nothing: the
      // marker lookup below maps an offset in this stripped text back to a line
      // in the original, and collapsing a doc comment silently shifted every
      // line after it (measured — it made the one real marker undetectable).
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
      .replace(/\/\/.*$/gm, "");
  }

  it("only lib/modeling.ts reaches the raw inferModelingType heuristic", () => {
    const reaching = sources()
      .filter(([p]) => p !== MODELING)
      .filter(([, src]) => {
        // The identifier itself catches a direct call and a named import,
        // aliased or not (the import statement spells the original name). A
        // NAMESPACE import spells nothing — `import * as M from "./modeling"`
        // then `M[someKey](col)` — so the module path is checked too. That is
        // the hole the round-1 commit wrongly claimed could not exist ("an
        // import statement always spells the original name even when
        // aliased"); a namespace import is the counterexample, measured.
        //
        // The two checks read DIFFERENT strippings, and that is load-bearing:
        // the identifier check needs literals gone (a help string naming the
        // function is not a call), while the import check needs them KEPT,
        // because the module path lives inside one. Writing both against the
        // strings-stripped text left the namespace case green — measured, on
        // this guard, while verifying it.
        const noLiterals = withoutCommentsOrStrings(src);
        const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        return (
          /\binferModelingType\b/.test(noLiterals) ||
          /import\s+\*\s+as\s+\w+\s+from\s+["'][^"']*\/modeling["']/.test(noComments)
        );
      })
      .map(([p]) => p);
    expect(
      reaching,
      "ask lib/modeling.ts's channelModelingType(dataset, channel) — it honours a channelTypes override and a cat_levels level table BEFORE the numeric-shape heuristic, which inferModelingType alone cannot see (BUG-008). Name it in a comment or a string if you need to discuss it, and import the named accessor rather than the whole module",
    ).toEqual([]);
  });

  it("the guard is not vacuous: modeling.ts defines the heuristic AND its accessor calls it", () => {
    // Without this, deleting or moving `inferModelingType` — or keeping it but
    // no longer calling it from the sanctioned accessor — would leave the guard
    // above green forever while protecting nothing. The round-2 review found
    // the first version of this test proved only that the function EXISTS,
    // because it matched `channelModelingType` anywhere in the file including
    // a comment. So: strip comments, and require the call to appear INSIDE the
    // accessor's own body.
    const modeling = withoutCommentsOrStrings(
      Object.entries(modules).find(([p]) => p === MODELING)?.[1] ?? "",
    );
    expect(modeling).toMatch(/export function inferModelingType\s*\(/);
    const accessor = modeling.slice(modeling.indexOf("export function channelModelingType"));
    expect(accessor).not.toBe("");
    // Up to the next top-level export, i.e. the accessor's own body.
    const body = accessor.slice(0, accessor.indexOf("\nexport ", 1) + 1 || undefined);
    expect(body).toMatch(/\binferModelingType\s*\(/);
  });
});

// JMP_GAP J1 (Group O-1). "The distinct finite values of this column,
// ascending" — a column's category LEVELS — had five independent
// implementations of the same five lines: `lib/barlayout.ts`,
// `lib/plotspec.ts`'s `buildXY`, `lib/plotGroupSplit.ts` twice (a list and a
// count), and the Data Filter workshop. Every order-sensitive surface in the app
// derives its order from one of them, so they must not be able to disagree —
// BUG-008 is what happens when two copies of one decision do. They now share
// `lib/categorical.ts`'s `levelsOf` / `levelCountOf` / `categoryLevels`.
//
// This guard keeps new copies out, and it matters more than a tidiness rule:
// J1's user-settable level ordering changes what "the levels, in order" MEANS,
// and a surviving private copy would silently keep ascending-by-code while
// everything else honoured the user's order.
describe("category-level accessor chokepoint (JMP_GAP J1)", () => {
  // Built on the lessons the BUG-008 ratchet cost: strip comments AND string
  // literals (prose naming a thing is not a use of it), and compare paths
  // EXACTLY (a suffix match allowlists `components/probe/lib/foo.ts`).
  function withoutCommentsOrStrings(src: string): string {
    return src
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      // Block comments become the SAME NUMBER of newlines, not nothing: the
      // marker lookup below maps an offset in this stripped text back to a line
      // in the original, and collapsing a doc comment silently shifted every
      // line after it (measured — it made the one real marker undetectable).
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
      .replace(/\/\/.*$/gm, "");
  }

  // A levels copy is a `new Set` that collects finite numbers and is then
  // ordered numerically (or merely counted). The FIRST version of this guard
  // required all of that inside ONE statement (`[^;]*?`), and the review round
  // measured four ordinary spellings walking straight past it — including the
  // real sixth copy in `lib/variability.ts`, which built its Set with a loop
  // and `.add`. So the co-occurrence is checked inside a WINDOW that spans
  // statements instead.
  // WHAT THIS DOES AND DOES NOT CATCH — measured, not assumed, because a guard
  // trusted past its reach is worse than no guard. Caught: the inline-predicate
  // spelling, `Array.from` instead of spread, different sort parameter names,
  // point-free `.filter(Number.isFinite)`, a loop with `.add`, the copy split
  // across two statements, a `.size` count, and the global `isFinite` (which is
  // ALSO semantically wrong here — `isFinite("3")` is true, so a string out of
  // a hand-edited .dwk would become a level). NOT caught: a predicate hidden
  // behind a local alias (`const isFin = v => Number.isFinite(v)` … `.filter(isFin)`)
  // — nothing textual near the `new Set` names finiteness, and chasing aliases
  // means a type-aware pass, not a regex. The mitigation is that the migration
  // left ZERO unmarked copies behind, so this guards a clean baseline rather
  // than papering over a dirty one.
  // `Set` OR `Map`, and a comparator on a bare name OR an indexed/property one.
  // Both widenings are here because this guard MISSED a real instance twice
  // over: `lib/statschooser.ts`'s `groupsByCategory` derived a column's levels
  // with `new Map<number, number[]>()` and ordered them with
  // `.sort((a, b) => a[0] - b[0])`, so neither the `new Set` anchor nor the
  // bare-`a - b` comparator matched — and box/violin/strip spent J1 sorting by
  // raw code while every other surface honoured the user's order, which is
  // verbatim the failure this guard's own message predicts. A Map keyed by a
  // column's values IS a derivation of that column's levels.
  const SET = /new (?:Set|Map)\b/g;
  const FINITE = /Number\.isFinite\b|\bisFinite\s*\(/;
  const ORDERED = /\.sort\(\s*\(?\s*\w+\s*,\s*\w+\s*\)?\s*=>\s*[\w.[\]]+\s*-\s*[\w.[\]]+|\.size\b/;

  /** How far from the `new Set|Map` an INLINE ordering may sit
   *  (`[...new Set(xs)].sort((a, b) => a - b)` names no collection at all), and
   *  the cap on the enclosing-declaration span searched for a NAMED one. */
  const NEAR = 140;
  const CAP = 600;

  /** The name bound to this `new Set|Map`, or null. Handles the spread form
   *  (`const xs = [...new Set(`) as well as a plain assignment. */
  function bindingName(code: string, at: number): string | null {
    const line = code.slice(code.lastIndexOf("\n", at) + 1, at);
    return /(?:const|let|var)\s+(\w[\w$]*)\s*(?::[^=]*)?=\s*(?:\[\s*\.\.\.\s*)?$/.exec(line)?.[1] ?? null;
  }

  /** The enclosing declaration's text from `at`, capped. */
  function declSpan(code: string, at: number): string {
    const after = code.slice(at, at + CAP);
    const end = /\n(?:\}|(?:export\s+)?(?:async\s+)?function\s|(?:export\s+)?const\s)/.exec(after);
    return end ? after.slice(0, end.index) : after;
  }

  /** Is the SAME collection that was just built also being ordered or counted?
   *
   *  This replaced a flat 400-character window, and the replacement is not
   *  tidiness — the window was measured to miss a real instance by TWO
   *  characters. `lib/statschooser.ts` carried TWO copies of exactly the defect
   *  this guard exists to catch; their `.sort(` sat at +330 and +398 characters
   *  from their `new Map`, so the window saw the first and missed the second.
   *  The file was therefore reported for one of its two instances, and a
   *  reintroduction in the index-preserving twin ALONE — the copy feeding the
   *  jitter overlay — would have passed green.
   *
   *  Simply widening the constant is the wrong lever: measured tree-wide, 600
   *  characters admits one false positive and 800 admits two, because a `.size`
   *  on an unrelated Set anywhere in a long function then matches. Tying the
   *  ordering to the collection's own NAME is what makes distance stop
   *  mattering. Measured over the 865 non-test `.ts`/`.tsx` files the guard
   *  actually scans — NOT the 1,028 `.ts` files a naive `find` reports, which
   *  counts tests it excludes and omits the `.tsx` it reads: zero false
   *  positives, all three existing exemptions still live, and BOTH
   *  `statschooser.ts` copies caught. */
  function derivesLevels(code: string, at: number): boolean {
    const span = declSpan(code, at);
    if (!FINITE.test(span)) return false;
    // An inline `[...new Set(xs)].sort(...)` binds no name; proximity is the
    // only available evidence, and it is strong at this distance.
    if (new RegExp(ORDERED.source).test(code.slice(at, at + NEAR))) return true;
    const name = bindingName(code, at);
    if (!name) return false;
    if (new RegExp(`\\b${name}\\.size\\b`).test(span)) return true;
    for (const m of span.matchAll(new RegExp(ORDERED.source, "g"))) {
      const before = span.slice(Math.max(0, (m.index ?? 0) - 160), m.index ?? 0);
      if (new RegExp(`\\b${name}\\b`).test(before)) return true;
    }
    return false;
  }

  /** Lines carrying an explicit, reasoned exemption. Function-scoped by
   *  construction: the marker sits on the copy itself, so it cannot silently
   *  cover the rest of a file the way the first version's file-level allowlist
   *  did — and that mattered, because the one file it exempted was
   *  `datasetsplit.ts`, i.e. the BUG-008 module, where a genuinely new levels
   *  copy would have gone undetected. */
  const MARKER = "levels-allowlist:";

  function levelsCopies(src: string): number[] {
    const code = withoutCommentsOrStrings(src);
    const hits: number[] = [];
    for (const m of code.matchAll(SET)) {
      const at = m.index ?? 0;
      if (derivesLevels(code, at)) hits.push(at);
    }
    return hits;
  }

  /** True when the ORIGINAL source (comments intact) carries the marker within
   *  the few lines before the hit — the exemption has to be written where the
   *  code is, not in this file. */
  function isMarked(src: string, code: string, at: number): boolean {
    const line = code.slice(0, at).split("\n").length;
    const lines = src.split("\n");
    return lines.slice(Math.max(0, line - 6), line).some((l) => l.includes(MARKER));
  }

  const HOME = "./lib/categorical.ts";

  it("only lib/categorical.ts derives a column's levels", () => {
    const offenders: string[] = [];
    for (const [path, src] of sources()) {
      if (path === HOME) continue;
      const code = withoutCommentsOrStrings(src);
      for (const at of levelsCopies(src)) {
        if (!isMarked(src, code, at)) offenders.push(path);
      }
    }
    expect(
      [...new Set(offenders)],
      `use lib/categorical.ts's categoryLevels(data, channel) — or levelsOf/levelCountOf for a bare value array. Level ORDER is becoming user-settable (JMP_GAP J1), and a private copy would keep sorting by raw code while every other surface honoured the user's order. If this genuinely is NOT a column's category levels, write "${MARKER} <why>" in a comment on the lines just above it`,
    ).toEqual([]);
  });

  it("the guard is not vacuous: it fires on the shape its own home uses", () => {
    // If `levelsOf` is rewritten so the pattern no longer describes anything
    // real, the test above goes green forever while protecting nothing.
    const home = Object.entries(modules).find(([p]) => p === HOME)?.[1] ?? "";
    expect(home).not.toBe("");
    expect(levelsCopies(home).length).toBeGreaterThan(0);
  });

  it("the exemptions that exist are marked at the code, and are still needed", () => {
    // `autoTolerance` takes the distinct values of a CONTINUOUS column to
    // measure the gaps between them for elbow detection — sample points on a
    // measurement axis, not category levels, and a user-settable level order
    // must never reach them. Assert the marker is actually there: if that code
    // is ever migrated or deleted, this fails and the marker goes with it,
    // rather than lingering as a standing exemption nobody re-reads.
    const split = Object.entries(modules).find(([p]) => p === "./lib/datasetsplit.ts")?.[1] ?? "";
    expect(split).toContain(MARKER);
    expect(levelsCopies(split).length).toBeGreaterThan(0);
  });
});

describe("FigureDocument write chokepoint (F1)", () => {
  it("routes PlotWindow.document writes through windowDocuments, except declared construction/persistence seams", () => {
    // `document: FigureDocument` is a function parameter/type annotation, not
    // a write. The remaining forms catch object-literal replacement and direct
    // assignment without pretending a raw-text guard is a TypeScript parser.
    const documentWrite = /(?:[,{]\s*document\s*:|\.document\s*=)/;
    const seams = [
      "/store/windowDocuments.ts", // canonical synchronize/replace helpers
      "/store/windowDefaults.ts", // initial main-window construction
      "/store/windows.ts", // create/duplicate construction through createPlotWindowDocument
      "/lib/windowDocumentPersistence.ts", // legacy promotion and workspace sanitization
    ];
    const writes = sources()
      .filter(([, src]) => documentWrite.test(src))
      .map(([path]) => path)
      .filter((path) => !seams.some((seam) => path.endsWith(seam)));
    expect(
      writes,
      "mutate a canonical PlotWindow.document through store/windowDocuments.ts; construction and persistence seams are explicitly reviewed above",
    ).toEqual([]);
  });
});

// Weak-wait ratchet — TEST_DETERMINISM_PLAN task 6. The pattern
// `await waitFor(() => expect(someMock).toHaveBeenCalled())` proves the mock
// was INVOKED but does NOT prove its resolved value reached component state.
// Class-B flake: on a lost race, the early-return (`if (!hitmap) return;`)
// silently no-ops, and the next assertion sees undefined. The fix is to wait
// on STATE, not the call:
//
//   // weak (race-prone):
//   await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());
//   expect(result.current.hitmap).not.toBeNull();  // can fail after a lost race
//
//   // strong (deterministic):
//   await waitFor(() => expect(result.current.hitmap).not.toBeNull());
//
// IMPORTANT: A bare `expect(mockFn).toHaveBeenCalled();` is fine and NOT
// matched by this guard — it is the standard, correct way to assert "we hit
// the API." The defect only exists when the call is used as a SYNCHRONISATION
// BARRIER: `await waitFor(...)` that returns as soon as the mock is invoked,
// while the code under test needs its RESOLVED VALUE.
//
// This guard caps the count instead of classifying sites — the semantic
// distinction (which sites are truly risky) was attempted three times and
// produced mutually inconsistent inventories. The ratchet follows the repo's
// existing size-ratchet idiom: flag EVERY waitFor-wrapped site, allowlist the
// 112 that exist today, fail on new ones, and ratchet down as sites are fixed
// (waiting on state instead). A pinned entry is NOT an assertion the site is
// buggy, only that it predates the guard. Pins are per FILE (line numbers
// churn on unrelated edits). TEST_DETERMINISM_PLAN #4 triage and #5 fixes
// follow this per-file inventory; #6 prevents new sites from landing.
const WEAK_WAIT_PINS: Record<string, number> = {
  // 22 -> 2 (2026-08-12, #5's standing rule applied while editing this file
  // for the drift-subscription fix). Every plain
  // `waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled())` became
  // `waitFor(() => expect(result.current.preview).not.toBeNull())`. That is
  // strictly STRONGER, not merely different: `preview` is null until the
  // debounced hit-map resolves AND commits to state, so no converted test can
  // settle earlier than it used to. The 2 that remain are
  // `toHaveBeenCalledTimes(1)` sites, where the COUNT is the assertion.
  "/components/workshops/figurebuilder/useFigureBuilder.test.ts": 2,
  "/components/workshops/figurepage/useFigurePage.test.ts": 12,
  "/components/workshops/multivar/MultivarPanel.test.tsx": 13,
  "/components/workshops/fityx/FitYByXPanel.test.tsx": 8,
  "/components/Inspector/CorrectionsCard.test.tsx": 9,
  "/components/workshops/graphbuilder/PlotSpecBar.test.tsx": 3,
  "/components/workshops/outliers/OutlierScreeningPanel.test.tsx": 5,
  "/components/workshops/distribution/useDistribution.test.ts": 5,
  "/components/workshops/variability/VariabilityChartPanel.test.tsx": 4,
  "/components/workshops/peakwizard/PeakWizardPanel.test.tsx": 3,
  "/components/workshops/outliers/useOutlierScreening.test.ts": 3,
  "/components/workshops/fityx/useFitYByX.test.ts": 3,
  "/components/workshops/distribution/DistributionPanel.test.tsx": 3,
  "/components/Stage/Worksheet.test.tsx": 3,
  "/store/useApp.test.ts": 2,
  "/components/workshops/rsm/RsmPanel.test.tsx": 2,
  "/components/workshops/multivar/useMultivar.test.ts": 2,
  "/components/Stage/worksheet/useWorksheetBlockOps.test.tsx": 2,
  "/components/Stage/usePlotPayload.test.ts": 2,
  "/components/Library/MultiSelectBar.test.tsx": 2,
  "/components/workshops/variability/useVariability.test.ts": 1,
  "/components/workshops/tabulate/TabulatePanel.test.tsx": 1,
  "/components/workshops/peaks/usePeaks.test.ts": 1,
  "/components/workshops/curvefit/useModelScan.test.ts": 1,
  "/components/workshops/curvefit/useCurveFit.test.ts": 2,
  "/components/workshops/calculators/UnitsTab.test.tsx": 1,
  "/components/workshops/baseline/useBaseline.test.ts": 1,
  "/components/windows/WindowCanvas.test.tsx": 1,
  "/components/Stage/worksheet/GridViewport.perf.test.tsx": 1,
  "/components/Library/PagesSection.test.tsx": 1,
  "/components/workshops/importwizard/ImportWizardPanel.test.tsx": 3,
  "/components/workshops/importwizard/useImportWizard.test.ts": 1,
};

// BUG-009: `lib/bookData.ts` keeps the reason the last lazy-book fetch failed in
// MODULE state, cleared only by a SUCCESS. A test that exercises a pending-dataset
// guard makes `refusePendingEdit` kick a real fetch, which rejects under jsdom and
// records a reason that outlives the test — so a later test in the same file, on
// the same dataset id, gets "the last attempt ... failed" where it expected
// "still loading its full data".
//
// This is not hypothetical and it is not a style rule. `cellEdit.test.ts` and
// `computedColumns.test.ts` shipped exactly this and passed, because the one test
// in each that asserts the message happened to run first; `--sequence.shuffle.tests
// --sequence.seed=1` failed both. `lib/bookData.ts` documents the rule ("CALL THIS
// in the beforeEach of any suite that exercises a pending-dataset guard") and the
// commit that wrote it applied it to two of the four files that needed it. A
// documented rule nothing enforces is how that happened, so: enforce it.
describe("pending-guard suites must reset the book-transport record (BUG-009)", () => {
  it("a test file asserting the pending-guard message also resets module state", () => {
    const asserts = /still loading its full data|last attempt to load its full data/;
    const missing: string[] = [];

    for (const [p, src] of Object.entries(modules)) {
      if (!/\.test\.(ts|tsx)$/.test(p)) continue;
      if (!asserts.test(src)) continue;
      // The CALL, not the import. The first version of this check tested
      // `src.includes("resetBookTransportForTests")`, which an unused import
      // satisfies — deleting the call from rowState.test.ts left this green. That
      // is the identical hole BUG-009's OTHER ratchet already shipped and
      // recorded once ("it token-matched the FILE ... deleting all four guard
      // CALLS while leaving the imports kept 620 files green"). Sabotage found it
      // both times; only the second time was it already written down.
      if (!/resetBookTransportForTests\s*\(\s*\)/.test(src)) missing.push(p);
    }

    expect(
      missing,
      `add \`resetBookTransportForTests()\` to the beforeEach of each file above.
Rationale: lib/bookData.ts's failure record is module state cleared only by a
success, so one test's refused action poisons the next test's expected message.
Measured 2026-09-11: cellEdit.test.ts and computedColumns.test.ts both failed
under --sequence.shuffle.tests before this guard existed.`,
    ).toEqual([]);
  });
});

describe("weak-wait ratchet (TEST_DETERMINISM_PLAN #6)", () => {
  /** Load test files only (*.test.ts, *.test.tsx). */
  function testSources(): [string, string][] {
    return Object.entries(modules).filter(([p]) => /\.test\.(ts|tsx)$/.test(p));
  }

  it("no test file exceeds its weak-wait pin — fix the site by waiting on state, not the mock", () => {
    // Pattern: waitFor(() => expect(...).toHaveBeenCalled()) — the synchronisation barrier form.
    // Matches across line breaks; does NOT match bare expect(...).toHaveBeenCalled() which is correct.
    // The defect: waitFor returns as soon as the mock is invoked, not when its value reaches state.
    // F6 (2026-09-13 round-2 review): the identifier inside expect(...) may
    // optionally be wrapped in `vi.mocked(...)` — `expect(vi.mocked(askParams))
    // .toHaveBeenCalled()` is the exact same synchronisation-barrier defect as
    // the bare form and had been slipping past the original bare-identifier-only
    // regex (exportPageCommand.test.ts's F4 test). `expect(vi.mocked(x).mock.
    // calls.length).toBeGreaterThan(...)` (useStatStage.test.ts) is unaffected:
    // it doesn't end in `.toHaveBeenCalled` right after the closing paren.
    const weakWaitPattern =
      /waitFor\s*\(\s*\(\s*\)\s*=>\s*expect\s*\(\s*(?:vi\.mocked\s*\(\s*[A-Za-z_$][\w$]*\s*\)|[A-Za-z_$][\w$]*)\s*\)\s*\.\s*toHaveBeenCalled/;
    const over: string[] = [];

    for (const [p, src] of testSources()) {
      const pinKey = Object.keys(WEAK_WAIT_PINS).find((k) => p.endsWith(k));
      if (!pinKey) {
        // This test file is not in the allowlist. Check if it has any weak waits.
        if (weakWaitPattern.test(src)) {
          over.push(`${p}: unlisted file contains weak wait (move to allowlist and count sites)`);
        }
        continue;
      }

      // Count weak-wait sites in this file
      const matches = src.match(new RegExp(weakWaitPattern.source, "g"));
      const count = matches ? matches.length : 0;
      const pinned = WEAK_WAIT_PINS[pinKey];

      if (count > pinned) {
        over.push(`${p}: ${count} weak waits > ${pinned} pinned`);
      }
    }

    expect(
      over,
      "replace `await waitFor(() => expect(mock).toHaveBeenCalled())` with `await waitFor(() => expect(state).not.toBeNull())` — wait on resolved state, not the call",
    ).toEqual([]);
  });

  it("weak-wait pins stay honest — a file that dropped below its pin must lose it", () => {
    // Kept identical to the pattern above (F6 round-2 widening included) —
    // duplicated rather than shared so each `it` reads standalone.
    const weakWaitPattern =
      /waitFor\s*\(\s*\(\s*\)\s*=>\s*expect\s*\(\s*(?:vi\.mocked\s*\(\s*[A-Za-z_$][\w$]*\s*\)|[A-Za-z_$][\w$]*)\s*\)\s*\.\s*toHaveBeenCalled/;
    const stale: string[] = [];

    for (const key of Object.keys(WEAK_WAIT_PINS)) {
      const entry = testSources().find(([p]) => p.endsWith(key));
      if (!entry) {
        stale.push(`${key}: no longer exists — remove its pin`);
        continue;
      }

      const matches = entry[1].match(new RegExp(weakWaitPattern.source, "g"));
      const count = matches ? matches.length : 0;
      const pinned = WEAK_WAIT_PINS[key];

      if (count === 0 && pinned > 0) {
        stale.push(`${key}: now 0 sites — remove its pin (ratchet down)`);
      } else if (count < pinned) {
        stale.push(`${key}: ${count} < ${pinned} pinned — lower the pin (ratchet down)`);
      }
    }

    expect(stale, "every pinned count must match the current site count in that file").toEqual([]);
  });
});

// Class A channel-remap registration ratchet (SILENT_STATE_CORRUPTION_PLAN
// #1): five column-index-keyed fields (Dataset.errorRoles, the view's
// groupKey/facetKey, Dataset.fitSpec, editableFigures' bindings, the
// composition render cache) shipped unremapped in ONE DAY (2026-08-27)
// because nothing forced a newly added channel-index-keyed field on `Dataset`
// or `PlotView` to be registered with `lib/channelRemap.ts` -- every test
// passed either way, because no test knew the field existed. This is the
// same shape of gap `HISTORY_EXCLUDED` below closes for undo coverage, and
// the fix is the same: enumerate every field on the two root types, and
// require each one to be either named by channelRemap's own registry types
// (`DatasetChannelState` / `ViewChannelState`) or explicitly excluded here
// with a one-line reason it is NOT column-index-keyed. A field that is
// neither fails this test, by name.
const DATASET_CHANNEL_REMAP_EXCLUDED: Record<string, string> = {
  id: "dataset identity string, not channel-indexed",
  name: "display name, not channel-indexed",
  data: "the DataStruct itself -- columns shift/drop inside it directly; not index-keyed METADATA about columns",
  raw: "pre-formula base DataStruct, same as data -- not index-keyed metadata",
  corrections:
    "correction-pipeline params (xOff, bgPoly, smoothWindow, ...) apply to the whole dataset, not a single channel",
  bgRef: "reference-background pick: a dataset id + interp method string, not a column index",
  notes: "free-text notes, not channel-indexed",
  tags: "free-text tag list, not channel-indexed",
  group: "legacy group label string, not channel-indexed",
  folderId: "Library organization only, not channel-indexed",
  order: "sort key among folder siblings, not channel-indexed",
  formulas:
    "computed-column list; positional shift on removal is handled by lib/formulaRename's remapSurvivingFormulas, a separate mechanism from lib/channelRemap",
  formulaErrors: "keyed by formula NAME, not column index",
  derivedFrom: "source dataset id + pipeline descriptor, not channel-indexed",
  importedAt: "timestamp, not channel-indexed",
  excludedRows:
    "ROW indices (JMP-style row state, #50), not COLUMN/channel indices -- unaffected by a column removal",
  pending: "lazy-load book-source descriptor, not channel-indexed",
  source: "re-import source path descriptor, not channel-indexed",
  versionOf: "a dataset id, not channel-indexed",
  workbookId: "Library organization only, not channel-indexed",
  peakTable:
    "fitted-peak records in the dataset's own x/y UNITS (2-theta, FWHM, intensity) plus a provenance record -- it stores no channel index at all, so a column removal cannot leave it pointing at the wrong one",
};

const PLOTVIEW_CHANNEL_REMAP_EXCLUDED: Record<string, string> = {
  yScale: "axis scale mode, not channel-indexed",
  xScale: "axis scale mode, not channel-indexed",
  showGrid: "display toggle, not channel-indexed",
  showLegend: "display toggle, not channel-indexed",
  legendPos: "legend corner preset, not channel-indexed",
  legendXY: "legend free position, plot-area FRACTIONS -- not a column index",
  legendFrameXY: "legend frame-anchored position, frame FRACTIONS -- not a column index",
  legendStatic: "display toggle, not channel-indexed",
  legendTitle: "text, not channel-indexed",
  axisLabelOffsets: "keyed by AXIS (x/y/y2), not by channel",
  axisLabelStyles: "keyed by AXIS (x/y/y2), not by channel",
  plotTemplate: "named template, not channel-indexed",
  showAxisBox: "display toggle, not channel-indexed",
  stackMode: "display toggle, not channel-indexed",
  insetMode: "display toggle, not channel-indexed",
  polarMode: "display toggle, not channel-indexed",
  statMode: "display toggle, not channel-indexed",
  xLim: "x-axis range [min, max], not a column index",
  yLim: "y-axis range [min, max], not a column index",
  xStep: "x-axis tick step, not a column index",
  yStep: "y-axis tick step, not a column index",
  xFmt: "axis tick format, not channel-indexed",
  yFmt: "axis tick format, not channel-indexed",
  y2Fmt: "axis tick format, not channel-indexed",
  plotTitle: "text, not channel-indexed",
  xAxisLabel: "text, not channel-indexed",
  yAxisLabel: "text, not channel-indexed",
  y2Lim: "y2-axis range [min, max], not a column index",
  y2Scale: "axis scale mode, not channel-indexed",
  y2Step: "y2-axis tick step, not a column index",
  y2AxisLabel: "text, not channel-indexed",
  refLines: "RefLine[] keyed by its own id + axis + value, not a column index",
  annotations: "Annotation[] pinned at data/page coordinates, not a column index",
  regionShades: "RegionShade[] pinned at data coordinates, not a column index",
  shapes: "Shape[] pinned at data/page coordinates, not a column index",
  waterfall: "numeric offset step, not a column index",
  panelFit: "layout-fit mode enum, not channel-indexed",
  pageSetup: "page geometry model, not channel-indexed",
};

/** Extract top-level field names from one `export interface <name> { ... }`
 *  block in `src` -- same technique as the HistorySnapshot/PlotView parsing
 *  below (skip comment lines, match `word:`/`word?:` with no `(` before the
 *  colon so methods never masquerade as fields). */
function interfaceFieldNames(src: string, name: string): Set<string> {
  const marker = `export interface ${name} {`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`could not find "${marker}"`);
  const end = src.indexOf("\n}", start) + 2;
  const body = src.slice(start, end);
  const fields = new Set<string>();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    const m = /^\s*(\w+)\??\s*:/.exec(line);
    if (m) fields.add(m[1]);
  }
  return fields;
}

describe("Class A: channel-index-keyed field coverage (SILENT_STATE_CORRUPTION_PLAN #1)", () => {
  const typesSrc = sources().find(([p]) => p.endsWith("/lib/types.ts"))?.[1] ?? "";
  const plotviewSrc = sources().find(([p]) => p.endsWith("/lib/plotview.ts"))?.[1] ?? "";
  const remapSrc = sources().find(([p]) => p.endsWith("/lib/channelRemap.ts"))?.[1] ?? "";

  it("every Dataset field is named by DatasetChannelState (channelRemap's registry) or explicitly excluded", () => {
    if (!typesSrc || !remapSrc) throw new Error("could not load lib/types.ts or lib/channelRemap.ts source");
    const datasetFields = interfaceFieldNames(typesSrc, "Dataset");
    if (datasetFields.size < 15) throw new Error("Dataset parse degraded — guard would silently weaken");
    const registered = interfaceFieldNames(remapSrc, "DatasetChannelState");
    if (registered.size < 3) throw new Error("DatasetChannelState parse degraded — guard would silently weaken");

    const uncovered = [...datasetFields].filter(
      (field) => !registered.has(field) && !DATASET_CHANNEL_REMAP_EXCLUDED[field],
    );
    expect(
      uncovered,
      `a new Dataset field is not registered for column-removal remapping. Either add it to
DatasetChannelState + remapDatasetChannels (lib/channelRemap.ts) so a column
removal keeps it pointing at the right channel, or add it to
DATASET_CHANNEL_REMAP_EXCLUDED (architecture.test.ts) with a one-line reason
it is NOT channel-indexed. SILENT_STATE_CORRUPTION_PLAN #1: 5 fields shipped
unremapped in one day because nothing forced this decision.`,
    ).toEqual([]);
  });

  it("every PlotView field is named by ViewChannelState (channelRemap's registry) or explicitly excluded", () => {
    if (!plotviewSrc || !remapSrc) throw new Error("could not load lib/plotview.ts or lib/channelRemap.ts source");
    const viewFields = interfaceFieldNames(plotviewSrc, "PlotView");
    if (viewFields.size < 30) throw new Error("PlotView parse degraded — guard would silently weaken");
    const registered = interfaceFieldNames(remapSrc, "ViewChannelState");
    if (registered.size < 5) throw new Error("ViewChannelState parse degraded — guard would silently weaken");

    const uncovered = [...viewFields].filter(
      (field) => !registered.has(field) && !PLOTVIEW_CHANNEL_REMAP_EXCLUDED[field],
    );
    expect(
      uncovered,
      `a new PlotView field is not registered for column-removal remapping. Either add it
to ViewChannelState + remapViewChannels (lib/channelRemap.ts) so a column
removal keeps it pointing at the right channel, or add it to
PLOTVIEW_CHANNEL_REMAP_EXCLUDED (architecture.test.ts) with a one-line reason
it is NOT channel-indexed.`,
    ).toEqual([]);
  });

  it("exclusion list entries are documented with reasons", () => {
    const missing: string[] = [];
    for (const [field, reason] of Object.entries({
      ...DATASET_CHANNEL_REMAP_EXCLUDED,
      ...PLOTVIEW_CHANNEL_REMAP_EXCLUDED,
    })) {
      if (!reason || reason.trim().length < 5) missing.push(`${field}: reason is too short ("${reason}")`);
    }
    expect(missing, "each exclusion must have a descriptive reason (>=5 chars)").toEqual([]);
  });
});

// History coverage ratchet (GUI_INTERACTION_PLAN #21): every persistent store
// field must be either in HistorySnapshot (undoable) or on an explicit
// HISTORY_EXCLUDED list with justification. The `savedRois` field was missing
// from HistorySnapshot for a day (2026-08-09–2026-08-10), making deletion of
// named ROIs unrecoverable. This guard prevents the next regression.
//
// The test dynamically parses store slice interfaces to extract state fields
// (vs methods), so new fields cannot be silently missed. Each exclusion below
// is a deliberate decision to keep the field outside undo.
const HISTORY_EXCLUDED: Record<string, string> = {
  // Slice state fields that are transient, ephemeral, or UI-only (not persistent edits).
  // These are the raw discovered fields that don't belong in HistorySnapshot.

  // graphBuilder slice: UI state (open/closed), not persisted data
  graphBuilderOpen: "Graph Builder workshop visibility; UI state, transient",
  graphBuilderSeed: "seeded spec from another workflow; consumed on use, not persistent",
  quickFigureBuilderDatasetId: "Quick Figure Builder source target; transient UI state cleared on cancel",

  recipeSourcesComplete: "workspace recipe-source fidelity (P3.5); DERIVED at project load, never user-edited — there is nothing to undo TO, and restoring a stale `true` over a genuine `false` would re-certify sources the load actually lost",

  // history slice: the undo stack itself (not a field to undo INTO)
  history: "undo stack; the history system itself, not undoable data",
  future: "redo stack; the history system itself, not undoable data",
  viewHistory: "zoom/pan navigation history; separate Back/Forward, not edit undo",
  viewFuture: "zoom/pan redo stack; separate Back/Forward, not edit undo",
  historySuppressed: "withHistoryBatch's in-flight flag; history-system control state, not undoable data",

  // libraryPanel slice: UI state only
  libraryPanelWidth: "Library panel width preference; UI layout state, not data",
  revealTarget: "scroll-to target for Library tree; ephemeral, cleared after reveal",
  activeDrag: "active drag state for Library folder drag feedback; transient",
  activeDragPress:
    "pointer press that owns the drag in activeDrag (ROUND 6 of the Tiles drag review); transient, written only by setActiveDrag alongside activeDrag itself",
  // LIBRARY_WORKBOOK_UX_PLAN PR C/E2: tree UI state. PR E2 now persists all
  // three into the .dwk (lib/workspace.ts's parseWorkspace/serializeWorkspace),
  // but persisted is not the same as undoable — they're view/navigation state
  // (which row the tree currently shows as "current", which workbooks are
  // disclosed), not an edit a user would expect Ctrl+Z to step back through,
  // the same distinction `libraryPanelWidth`/`revealTarget` above already draw
  // for their own (session-local, not .dwk-persisted) UI state.
  expandedWorkbookIds: "Library tree workbook disclosure state; persisted view state (PR E2), not an undoable edit",
  librarySelection: "Library tree folder/workbook selection; persisted view state (PR E2), not an undoable edit",
  workbookLastChild: "L0.6 remembered workbook child per workbook id; persisted view state (PR E2), not an undoable edit",
  // FU-2 (provenance-disclosure follow-ups): OriginFidelitySection's own
  // disclosure flag, same class as libraryPanelWidth/revealTarget above —
  // UI-only, session-local, and (unlike expandedWorkbookIds/librarySelection/
  // workbookLastChild) deliberately NOT persisted into `.dwk` either.
  originFidelitySectionExpanded: "Origin fidelity group disclosure; UI state, session-only, not .dwk-persisted, not an undoable edit",

  // originImport slice: ephemeral seeds
  originWorksheetSeed: "pending worksheet from Origin import; consumed on apply, not persistent",

  // pageDocuments slice: UI state and ephemeral seeds
  pageDocSeed: "seeded page document from external; consumed on use, not persistent",

  // plotdata slice: derived view state, already in view snapshot
  axisLabelOffsets: "computed axis label positions; derived from layout, not persistent",
  axisLabelStyles: "axis label appearance; captured in view snapshot block",
  legendXY: "legend position (x,y); captured in view snapshot",
  legendFrameXY: "legend frame bounds; captured in view snapshot",
  selectedAnnotationId: "active annotation for editing; transient tool state",

  // recents slice: recently opened items (UI convenience, not core data)
  recent: "recently used items cache; UI convenience, not persistent edits",

  // reductions slice: workshop UI state
  reductionsOpen: "Reductions workshop visibility; UI state, transient",
  reductionsMethod: "selected reduction method in workshop; UI state, transient",

  // roiCutsPanel slice: workshop UI state
  roiCutsOpen: "ROI Cuts panel visibility; UI state, transient",

  // shapes slice: drawing tool state
  shapes: "in-progress shape list (for drawn overlays); overlays cleared on dataset change",
  drawShapeKind: "active shape drawing tool; UI state, cleared on tool switch",
  selectedShapeId: "selected shape for editing; transient tool state",

  // regionShades slice (F2.3j): same PlotView-nested shape as shapes above --
  // undo captures it inside HistorySnapshot's `view: PlotView` field, not by
  // this raw field name, so it needs the same documented exclusion.
  regionShades: "region-shade list; captured inside the `view: PlotView` history snapshot field, like shapes/refLines",

  // split slice: dialog state
  splitDialogTargetId: "target dataset for split operation; UI dialog state, ephemeral",

  // plotRecipes slice (P1.3 wave 2 Lane B): the staged unmatched-fields
  // preview+confirm result. Transient gesture state discarded on confirm/
  // cancel -- never an edit itself (confirmPendingRecipeApplication's actual
  // figure creation is the undoable gesture, via editableFigures/plotWindows
  // already in HistorySnapshot), same class as separatePreview above.
  pendingRecipeApplication: "staged plot-recipe apply preview (unmatched fields); transient gesture state, discarded on confirm/cancel, not an undoable edit",

  // workbookSeparate slice (LIBRARY_WORKBOOK_UX_PLAN PR J, L0.51): the
  // affected-item preview plan. Transient dialog state discarded on
  // commit/cancel — never an edit itself (commitSeparateWorksheets is the
  // actual undoable gesture, via the ordinary datasets/workbooks fields
  // already in HistorySnapshot), same class as splitDialogTargetId above.
  separatePreview: "Separate-worksheet affected-item preview; transient dialog state, discarded on commit/cancel, not an undoable edit",

  // reimportAll slice (LIBRARY_WORKBOOK_UX_PLAN PR M, L0.33): the
  // transactional multi-source Reimport All / Reimport Available Sources
  // staging report. Transient dialog state discarded on commit/cancel —
  // never an edit itself (commitReimportAll's actual dataset mutation is
  // the undoable gesture, via the ordinary `datasets` field already in
  // HistorySnapshot), same class as separatePreview right above.
  reimportAllRows: "Reimport All staging/problem report; transient dialog state, discarded on commit/cancel, not an undoable edit",
  reimportAllBusy: "Reimport All staging-in-flight flag; UI state, transient",
  reimportAllCommitted: "Reimport All partial-success commit count (G2); transient dialog state, discarded on the next stage/cancel/commit, not an undoable edit",

  // libraryDetailsColumns slice (LIBRARY_WORKBOOK_UX_PLAN PR L slice 2,
  // L0.56): the Details view's selected metadata columns. Persists in
  // `.dwk` (PR E2/E's own `expandedWorkbookIds`/`librarySelection` precedent
  // right above — persisted view state is not the same as undoable) — a
  // column visibility toggle should never eat a Ctrl+Z step meant for an
  // actual data edit.
  visibleDetailsColumns: "Details view selected metadata columns; persisted view state (PR L slice 2), not an undoable edit",

  // toolwindows slice: window geometry (separate from persistent layout in plotWindows)
  toolWindowLayout: "transient tool window positions (unclear if persists, mark for review)",

  // trash slice: deleted items cache
  trash: "recently deleted items (undo happens at source, not from trash)",
  trashOpen: "Trash panel visibility; UI state, transient",

  // workshop slices: search/discovery UI
  searchOpen: "search panel visibility; UI state, transient",

  // uiStore / techniqueViewMemory: per-technique view defaults (not edit state)
  techniqueViewMemory: "remembered view settings per data technique; UI preference, not data edit",

  // Figure/image state from figureLifecycle slice
  figurePublicationSession: "in-progress figure editing session; ephemeral until published",

  // ROI slices: in-progress working geometry (see store/rois.ts docstring)
  mapRoi: "in-progress ROI box geometry; survives dataset switch but not undo",
  mapRuler: "in-progress ruler geometry; survives dataset switch but not undo",
  mapSector:
    "in-progress sector/wedge geometry; same working-scratch class as mapRoi/mapRuler " +
    "(MAIN_PLAN #41 moved it here from useRoiCuts local state so both panels share it)",
  rsmPeaks: "RSM peak markers from analysis; cleared on dataset change or analysis reset",

  // Windows slice: computed from plot DOM
  plotCanvasBounds: "plot canvas bounding box; computed at render, not persistent state",

  // Worksheet selection slice: row selection per window (UI state)
  worksheetSelections: "row selection per worksheet window; UI state, not persistent edit",

  // project slice (P1.2 box 1): the CURRENT project's name/path + dirty flag.
  // Session-local identity/status about WHERE the workspace lives and
  // whether it matches disk — not an edit to the workspace's own data, so
  // stepping Ctrl+Z through it would be meaningless (undoing to "a different
  // file is open" isn't a content edit). Never serialized into a `.dwk`
  // either (see store/project.ts's header).
  currentProject: "current project name/path identity; session-local, not an undoable data edit",
  projectDirty: "unsaved-changes flag for the current project; derived status, not an undoable data edit",

  // shell/layout UI state (retrospective-audit sweep: fields declared directly on AppState, newly visible to this guard)
  leftCollapsed: "left panel collapsed; shell layout UI",
  rightCollapsed: "right panel collapsed; shell layout UI",
  stageTab: "Plot/Worksheet stage tab; shell navigation UI",
  openReportId: "which report window is open; UI open state",
  prefsOpen: "Preferences dialog visibility; UI state",
  cmdkOpen: "Command Palette visibility; UI state",
  shortcutsOpen: "shortcuts sheet visibility; UI state",
  textFormatHelpOpen: "text-format help visibility; UI state",
  status: "status-bar text; transient announcement, not data",

  // persisted user preferences (own localStorage lifecycle via store/prefs.ts, not project edits)
  theme: "prefs",
  accent: "prefs",
  density: "prefs",
  palette: "prefs",
  autoSeriesStyles: "prefs (P3.3 auto dash/marker cycle; sits beside palette)",
  reduceMotion: "prefs",
  wheelZoom: "prefs",
  defaultTrace: "prefs",
  defaultLineWidth: "prefs",
  defaultGrid: "prefs",
  copyFigureTransparent: "prefs",
  antialias: "prefs",
  sigFigs: "prefs",
  notation: "prefs",
  confirmRemove: "prefs",
  excludedDisplay: "prefs",
  originBookClickOpens: "prefs",
  defaultPanelFit: "prefs",
  recalcMode: "prefs (manual/auto recalculation)",

  // workshop/dialog visibility flags (transient UI, all *Open)
  hysteresisOpen: "workshop/dialog visibility; UI state",
  reflectivityOpen: "workshop/dialog visibility; UI state",
  baselineOpen: "workshop/dialog visibility; UI state",
  magToolsOpen: "workshop/dialog visibility; UI state",
  rsmOpen: "workshop/dialog visibility; UI state",
  datasetMathOpen: "workshop/dialog visibility; UI state",
  distributionOpen: "workshop/dialog visibility; UI state",
  dataFilterOpen: "workshop/dialog visibility; UI state",
  statsChooserOpen: "workshop/dialog visibility; UI state",
  peakWizardOpen: "workshop/dialog visibility; UI state",
  importWizardOpen: "workshop/dialog visibility; UI state",
  pipelineOpen: "workshop/dialog visibility; UI state",
  figureBuilderOpen: "workshop/dialog visibility; UI state",
  figurePageOpen: "workshop/dialog visibility; UI state",
  waterfallOpen: "workshop/dialog visibility; UI state",
  reflViewOpen: "workshop/dialog visibility; UI state",
  columnSwitcherOpen: "workshop/dialog visibility; UI state",

  // consumed cross-workflow seeds
  figureDocSeed: "seeded figure doc; consumed on use",
  reflectivitySeed: "seeded reflectivity workshop input; consumed on use",
  statStageSeed: "seeded stat-stage input; consumed on use",

  // analysis working scratch (same class as mapRoi/mapRuler above: survives interaction, cleared on dataset switch, not edit history)
  plotTool: "analysis tool/gadget working scratch",
  regionPicked: "analysis tool/gadget working scratch",
  integral: "analysis tool/gadget working scratch",
  fwhmResult: "analysis tool/gadget working scratch",
  qfitRoi: "analysis tool/gadget working scratch",
  qfitModel: "analysis tool/gadget working scratch",
  qfitBusy: "analysis tool/gadget working scratch",
  qfitResult: "analysis tool/gadget working scratch",
  qfitError: "analysis tool/gadget working scratch",
  gadgetMode: "analysis tool/gadget working scratch",
  gadgetBusy: "analysis tool/gadget working scratch",
  gadgetError: "analysis tool/gadget working scratch",
  gadgetIntegrateResult: "analysis tool/gadget working scratch",
  gadgetStatsResult: "analysis tool/gadget working scratch",
  gadgetDerivResult: "analysis tool/gadget working scratch",
  derivOverlay: "analysis tool/gadget working scratch",
  gadgetFftPreview: "analysis tool/gadget working scratch",
  gadgetCursors: "analysis tool/gadget working scratch",
  gadgetCursorResult: "analysis tool/gadget working scratch",
  fitOverlay: "analysis tool/gadget working scratch",
  peakOverlay: "analysis tool/gadget working scratch",
  baselineOverlay: "analysis tool/gadget working scratch",
  peakWizardEdit: "analysis tool/gadget working scratch",
  baselineAnchorEdit: "analysis tool/gadget working scratch",

  // derived/dirty-tracking and runtime state
  staleDatasets: "derived recalculation dirty set; recomputed, not authored",
  staleFits: "derived fit dirty set; recomputed, not authored",
  macroRecording: "macro recorder armed flag; runtime state",
  macroSteps: "in-progress macro recording buffer; runtime state",
  pipelineRunning: "pipeline execution flag; runtime state",

  // map render settings (technique-view class, like techniqueViewMemory)
  mapPaintedLimits:
    "what each open map is currently PAINTING (store/mapView.ts) — reported BY the " +
    "renderer, never edited by the user, so there is nothing to undo TO; restoring an " +
    "older pair would only make the Inspector describe a canvas that no longer exists, " +
    "and the next repaint overwrites it anyway. Not persisted either (P2.8 review round 3)",
  mapMethod: "map interpolation method; view setting outside PlotView",
  mapRes: "map resolution; view setting outside PlotView",
  contourOn: "contour overlay toggle; view setting outside PlotView",
  contourLevelCount: "contour levels; view setting outside PlotView",
  contourScale: "contour scale; view setting outside PlotView",

  // pre-existing exclusions preserved as-is by the guard widening (status-quo; review deliberately deferred)
  composition: "multi-panel facet/break arrangement; cleared on dataset switch today — if arrangements become persistent, revisit undo coverage",

  // parser false positives (nested inline object types inside AppState)
  selection: "worksheet row selection; deliberately outside the verbatim snapshot — restorePatch liveness-filters it specially on undo/redo",
  label: "parser false positive",
  code: "parser false positive",
  typed: "parser false positive",
  // Parser false positives from interface comments / nested types.
  // The regex-based interface parser cannot reliably distinguish these from real fields.
  // They appear in comments or nested type definitions but not as top-level store fields.
  id: "parser false positive (from nested types or comments in interfaces)",
  params: "parser false positive (from nested types or comments in interfaces)",
  bg: "parser false positive (from nested types or comments in interfaces)",
};

describe("HistorySnapshot field coverage (GUI_INTERACTION_PLAN #21)", () => {
  it("every persistent store field is either in HistorySnapshot or HISTORY_EXCLUDED", () => {
    // Load the HistorySnapshot type definition. It lives in
    // store/historySnapshot.ts, which store/history.ts re-exports — the type
    // moved there (with snapshotOf/restorePatch) when history.ts crossed the
    // 500-line ceiling. This guard reads the SOURCE, so it follows the
    // definition, not the re-export.
    const historySrc = sources().find(([p]) => p.endsWith("/store/historySnapshot.ts"))?.[1] ?? "";
    if (!historySrc) {
      throw new Error("Could not find historySnapshot.ts source");
    }

    // Extract field names from HistorySnapshot interface
    const historySnapshotFieldPattern = /^\s*(\w+)\s*:/gm;
    // Narrow to just the HistorySnapshot interface by finding its start and end
    const historyStart = historySrc.indexOf("export interface HistorySnapshot");
    const historyEnd = historySrc.indexOf("}", historyStart) + 1;
    const historySection = historySrc.slice(historyStart, historyEnd);
    const historyFields = new Set<string>();
    let match;
    while ((match = historySnapshotFieldPattern.exec(historySection)) !== null) {
      historyFields.add(match[1]);
    }

    // Dynamically derive AppState fields by parsing all composed store slice files.
    // Strategy: find every XXXSlice interface, then extract field declarations (not methods).
    // A state field: `fieldName: Type;` or `fieldName?: Type;` — no `(` before `:`
    // A method: `methodName: (args) => Type;` — has `(` before `:`
    const appStateFields = new Set<string>();

    for (const [path, src] of sources()) {
      if (!path.includes("/store/") || !path.endsWith(".ts")) continue;
      if (path.endsWith(".test.ts")) continue;

      // Find all `export interface XXXSlice { ... }` blocks — AND AppState
      // itself (retrospective-audit fix: fields declared DIRECTLY on
      // AppState — datasets, activeId, folders, expandedFolders, … — were
      // invisible to this guard, so its "exhaustive" claim held only by
      // hand-maintained coincidence; `expandedFolders` slipped through
      // unclassified while folderDeletePatch mutated it under recordHistory).
      // Greedy match the interface body to capture everything until the
      // closing brace.
      const interfacePattern = /export\s+interface\s+(?:\w+Slice|AppState)\b[^{]*{([\s\S]*?)^}/gm;
      let interfaceMatch;
      while ((interfaceMatch = interfacePattern.exec(src)) !== null) {
        const interfaceBody = interfaceMatch[1];

        // Split into lines and process each one for field declarations
        const lines = interfaceBody.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comment lines and empty lines
          if (!line.trim() || line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

          // Look for pattern: `word: type;` where there's no `(` before the `:`
          // (presence of `(` before `:` indicates a method)
          const match = /^\s*(\w+)\s*\??\s*:\s*/.exec(line);
          if (!match) continue;

          const fieldName = match[1];

          // Extract the type portion (from `:` to `;` or next line if multiline)
          const colonPos = line.indexOf(":");
          let typeDecl = line.slice(colonPos + 1);
          let j = i;
          while (!typeDecl.includes(";") && j < lines.length - 1) {
            j++;
            typeDecl += " " + lines[j].trim();
          }

          // Skip if it's a method (contains `=>` or starts with `(`)
          if (typeDecl.trim().startsWith("(") || typeDecl.includes("=>")) continue;

          // Skip obvious non-field names (noise from parsing errors)
          if (/^\d+|^(do|does|if|then|else)$/.test(fieldName)) continue;

          appStateFields.add(fieldName);
        }
      }
    }

    // Retrospective-audit fix: the AppState singleton plot-view fields are
    // captured INSIDE HistorySnapshot's `view: PlotView` field (snapshotView
    // collects them; hydrateView restores them). Parse PlotView's own key
    // list so those ~46 fields are recognized as covered BY NAME instead of
    // hand-maintaining a parallel exclusion list that would rot.
    const plotviewSrc = sources().find(([p]) => p.endsWith("/lib/plotview.ts"))?.[1] ?? "";
    const plotViewBody = /export interface PlotView\s*{([\s\S]*?)^}/m.exec(plotviewSrc)?.[1] ?? "";
    const viewFields = new Set<string>();
    const viewFieldPattern = /^\s*(\w+)\??\s*:/gm;
    let viewMatch;
    while ((viewMatch = viewFieldPattern.exec(plotViewBody)) !== null) viewFields.add(viewMatch[1]);
    if (viewFields.size < 30) throw new Error("PlotView parse degraded — guard would silently weaken");

    // Classify every field
    const uncovered: string[] = [];
    for (const field of appStateFields) {
      if (historyFields.has(field)) {
        // Field is in HistorySnapshot — good.
        continue;
      }
      if (viewFields.has(field)) {
        // Captured inside the `view: PlotView` snapshot field — good.
        continue;
      }
      if (HISTORY_EXCLUDED[field as keyof typeof HISTORY_EXCLUDED]) {
        // Field is explicitly excluded with a reason — good.
        continue;
      }
      // Field is neither in HistorySnapshot nor excluded — BAD.
      uncovered.push(field);
    }

    expect(
      uncovered,
      `add each uncovered field to HistorySnapshot (for undo) or HISTORY_EXCLUDED (document why).
Rationale: every store mutation that outlives the session should be undoable or explicitly justified as transient/preference/UI state.
GUI_INTERACTION_PLAN #21 motivating incident: savedRois was missing for 24 hours, making ROI deletion unrecoverable.`,
    ).toEqual([]);
  });

  it("HISTORY_EXCLUDED list entries are documented with reasons", () => {
    const missing: string[] = [];
    for (const [field, reason] of Object.entries(HISTORY_EXCLUDED)) {
      if (!reason || reason.trim().length < 5) {
        missing.push(`${field}: reason is too short ("${reason}")`);
      }
    }
    expect(missing, "each exclusion must have a descriptive reason (≥5 chars)").toEqual([]);
  });
});

// Alert/note text must never be clipped (2026-08-12). `.qzk-ds-meta` is a
// SINGLE-LINE utility — `overflow: hidden; text-overflow: ellipsis;
// white-space: nowrap` — and it is exactly right for a dataset's
// "201 pts · 1 ch" row. Applied to a `role="alert"`/`role="note"` MESSAGE it
// hides the actionable half of the sentence. Measured case that motivated
// this guard: the Figure Page save gate rendered 988 px of "…save it (its
// title-bar Save button, or File > Save Editable Figure), then Save this page
// again" inside a 154 px column — ~84% invisible, and because the text
// overflowed a nowrap line rather than filling one, not even an ellipsis
// hinted that anything was missing. The `.qzk-msg` modifier restores wrapping.
describe("alert/note messages are not clipped", () => {
  it("every role=alert/note element using qzk-ds-meta also carries qzk-msg", () => {
    const offenders: string[] = [];
    for (const [path, src] of sources()) {
      if (!path.endsWith(".tsx")) continue;
      // Walk each `className="qzk-ds-meta"` (no qzk-msg) back to its opening
      // `<`, so a multi-line JSX tag is matched as a whole.
      const re = /className="qzk-ds-meta"/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(src)) !== null) {
        const open = src.lastIndexOf("<", match.index);
        if (open < 0) continue;
        const tag = src.slice(open, match.index + match[0].length);
        if (/role="(alert|note)"/.test(tag)) {
          offenders.push(`${path}:${src.slice(0, match.index).split("\n").length}`);
        }
      }
    }
    expect(
      offenders,
      'add the "qzk-msg" modifier (className="qzk-ds-meta qzk-msg") so the message wraps instead of being clipped mid-sentence',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Storage-key registry ratchet (P3.4 diagnostics — #268 follow-up review).
//
// `store/diagnostics.ts` may only NAME a `localStorage` slot that
// `lib/storageKeys.ts` vets; anything else is aggregated to a count and a byte
// total. That guard is only as good as the allowlist is current, and an
// allowlist maintained by habit drifts silently: a new slot would simply stop
// appearing by name, and nobody would notice until a support report was
// missing the one line that explained the quota.
//
// So the drift is made loud here. Adding a slot becomes a two-line change with
// a red build in between, which is the point — the second line is a decision
// about whether that key's NAME is safe to show a stranger.
//
// The reverse direction is deliberately NOT checked. An entry whose writer has
// been deleted still earns its place: browsers that ran the older build still
// hold the slot, and dropping it would reclassify a perfectly well-understood
// key as "unrecognised" in exactly the reports where it matters. A stale entry
// is inert (it matches nothing); a missing one is a regression.
describe("storage-key registry ratchet (P3.4)", () => {
  /** `"qz.…"` in a single- or double-quoted literal. Template literals are
   *  handled separately below — they are the dangerous shape, not this one. */
  const LITERAL = /["'](qz\.[A-Za-z0-9_.-]+)["']/g;

  function registered(): Set<string> {
    const [, src] =
      sources().find(([p]) => p.endsWith("/lib/storageKeys.ts")) ??
      ([undefined, ""] as unknown as [string, string]);
    return new Set([...src.matchAll(LITERAL)].map((m) => m[1]));
  }

  it("every qz. storage key literal in src is on the diagnostics allowlist", () => {
    const known = registered();
    expect(known.size, "lib/storageKeys.ts must be readable and non-empty").toBeGreaterThan(0);
    const missing: string[] = [];
    for (const [path, src] of sources()) {
      if (path.endsWith("/lib/storageKeys.ts")) continue;
      for (const m of src.matchAll(LITERAL)) {
        if (!known.has(m[1])) missing.push(`${path}: ${m[1]}`);
      }
    }
    expect(
      missing,
      "Add each key to KNOWN_STORAGE_KEYS in lib/storageKeys.ts — and while you " +
        "are there, decide whether its NAME is safe to print in a diagnostics " +
        "bundle a user pastes into a public issue.",
    ).toEqual([]);
  });

  it("no storage key is built by interpolation — a composed key IS user content", () => {
    // `qz.figure.${title}` puts an unpublished sample name in the key itself,
    // which the allowlist can then only suppress, never report usefully. Keep
    // per-object state inside one vetted slot's VALUE instead.
    //
    // The character class before `${` is what keeps this test honest, and it
    // is not incidental: `qz.` is ALSO the macro-recording script namespace
    // (`qz.fit("${model}")`, `qz.addColumn(${lit(name)}, …)` — see
    // store/cellEdit.ts and friends), which is emitted as user-visible code
    // and interpolates by design. A storage key is bare identifier characters
    // through to the interpolation; a macro call reaches `(` first. Matching
    // `[^`]*` instead flags all ~40 macro sites and the guard gets deleted as
    // noise within a week.
    const dynamic = sources()
      .filter(([p]) => !p.endsWith("/lib/storageKeys.ts"))
      .filter(([, src]) => /`qz\.[A-Za-z0-9_.-]*\$\{/.test(src))
      .map(([p]) => p);
    expect(dynamic).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lazy Origin-apply chunk guard (BUNDLE_HEADROOM slice 1, 2026-08-30).
//
// `lib/originFigureSelection.ts` + `lib/originSpatialPanels.ts` hold the half
// of the Origin figure library that only an APPLY needs. `store/viewAppliers.ts`
// (P4.1, formerly `store/useApp.ts`) reaches them through
// `store/originApplyLibs.ts`'s dynamic `import()`, which
// is what keeps them — and `lib/originPanels.ts`, whose only value import is
// there — out of the entry chunk (measured 890.2 -> 885.3 kB eager).
//
// Rollup ships a module to wherever ANY of its importers' chunks land, so ONE
// static import from an eagerly-reachable file silently folds all of it back
// in. `scripts/check-bundle-size.mjs` would eventually catch that as a budget
// failure, but only after the fact and without naming the cause; this guard
// names it at the import site.
describe("the Origin-apply half stays lazily reachable (BUNDLE_HEADROOM slice 1)", () => {
  const LAZY = ["originFigureSelection", "originSpatialPanels"];
  // Files allowed to import them STATICALLY, each because it is itself only
  // reachable from a lazy chunk. Adding a row here is a claim that the new
  // importer is lazy too — verify with `node scripts/profile-eager-bundle.mjs`
  // (the module must be absent from the eager table) before you add one.
  const LAZY_IMPORTERS = [
    "/lib/originSpatialPanels.ts", // the other half of the same lazy pair
    "/lib/thumbnailArtifacts.ts", // reached only via lib/thumbnailGenerators
  ];

  it("scans the modules it claims to", () => {
    // A guard whose subject has been renamed away passes vacuously.
    const paths = sources().map(([p]) => p);
    for (const name of LAZY) {
      expect(paths.some((p) => p.endsWith(`/lib/${name}.ts`)), `${name} not found`).toBe(true);
    }
  });

  it("no eagerly-reachable module statically imports them", () => {
    const pattern = new RegExp(`from "[^"]*/(${LAZY.join("|")})"`);
    const offenders = sources()
      .filter(([p]) => !LAZY_IMPORTERS.some((allowed) => p.endsWith(allowed)))
      .filter(([, src]) => pattern.test(src))
      .map(([p]) => p);
    expect(
      offenders,
      "reach these through store/originApplyLibs.ts's dynamic import(), or prove the importer is lazy and allowlist it",
    ).toEqual([]);
  });

  it("the loader itself uses a dynamic import, not a static one", () => {
    const loader = sources().find(([p]) => p.endsWith("/store/originApplyLibs.ts"));
    expect(loader, "store/originApplyLibs.ts not found").toBeDefined();
    const src = loader?.[1] ?? "";
    for (const name of LAZY) {
      expect(src).toContain(`import("../lib/${name}")`);
    }
  });
});

// ---------------------------------------------------------------------------
// Lazy action seams (bundle diet, 2026-09-14 — 919,781 -> 910,172 B eager).
//
// Four modules were taken out of the eager entry graph because every entry
// point into them is a user action that happens long after first paint: the
// four Data-menu worksheet reshapes, the Page setup dialog, the workbook
// Copy/Paste/Duplicate core, and the saved-Origin-preview window behind
// FigureRow's "▣". Each is now reached through a dynamic `import()` from the
// one file that used to import it statically.
//
// This is the same guard `LAZY`/`LAZY_IMPORTERS` above gives the Origin-apply
// split, and it exists for the same reason: Rollup ships a module to wherever
// ANY of its importers' chunks land, so ONE value import from an eagerly
// reachable file silently folds the whole seam back into the entry chunk.
// `scripts/check-bundle-size.mjs` would eventually notice as a budget failure,
// but only once the headroom is gone and without naming the cause; this names
// it at the import site.
//
// TYPE-ONLY imports are deliberately allowed: `import type`/`export type` is
// erased before the bundler sees it, and `store/workbookTransfer.ts` keeps one
// (`TransferExistingIds`/`TransferIdGenerators`) precisely because it costs
// nothing. A `typeof import("…")` type alias is likewise invisible here — it
// is not a `from "…"` clause at all.
describe("the lazy action seams stay lazily reachable (2026-09-14 bundle diet)", () => {
  const SEAMS = [
    {
      module: "/lib/worksheetTransformCommands.ts",
      loader: "/commands/dataCommands.ts",
      call: 'import("../lib/worksheetTransformCommands")',
    },
    {
      module: "/lib/pageSetupCommand.ts",
      loader: "/commands/plotCommands.ts",
      call: 'import("../lib/pageSetupCommand")',
    },
    {
      module: "/lib/workbookTransfer.ts",
      loader: "/store/workbookTransfer.ts",
      call: 'import("../lib/workbookTransfer")',
    },
    {
      module: "/components/Library/OriginSavedPreviewWindow.tsx",
      loader: "/components/Library/FigureRow.tsx",
      call: 'import("./OriginSavedPreviewWindow")',
    },
    // ── SLICE 3 (2026-09-18, plans/BUNDLE_HEADROOM.md) ────────────────────
    // Three more, same class, each with exactly one non-test importer whose
    // only entry point into it is a user action — so the static-import arm
    // below holds all three outright.
    //
    // `components/windows/PanelPlotWindow.tsx` renders `win.kind === "panel"`.
    // A panel window is composed by the user in-session, OR already present
    // on a restored `.dwk`/crash-recovery snapshot (`kind: "panel"` is a
    // persisted window field) — never on the DEFAULT first paint of a fresh
    // project either way (narrowed 2026-09-18, review round, finding 4: this
    // comment previously said "only after the user composes one",
    // unqualified, which is false for a restore). Its renderer and the two
    // modules only it reaches (PanelCell, PanelOverlayWindow, in DRAGGED_OUT
    // below) had no business in the entry chunk. Measured the largest of the
    // three by a wide margin.
    //
    // `components/Stage/PolarStage.tsx` is the third of PlotStage's runtime-
    // conditional alternate render modes and the only one that was still
    // static; MultiPanelStage and StatStage were already `lazy()`. Entered by
    // the Plot toolbar's polar toggle in-session, or already active on a
    // restored project (`polarMode` is a persisted `PlotView` field — same
    // finding 4 narrowing as above). Takes PolarStageCore + lib/polar.ts
    // with it.
    //
    // `store/plotRecipeApply.ts` is the apply/matching half of Plot Recipes
    // (`resolveApplyOrStage`, `applyResolvedRecipe`, `resolvedCandidates`,
    // `recipeLibs`). `store/plotRecipes.ts` is composed into `useApp.ts`, so
    // its static import made that module a startup cost; every action that
    // needs it was ALREADY `async` (for `recipeLibs()`, which lives inside it),
    // so nothing changed shape. The loader is the new
    // `store/plotRecipeApplyLazy.ts`, which also carries the failure contract.
    {
      module: "/components/windows/PanelPlotWindow.tsx",
      loader: "/components/windows/WindowCanvas.tsx",
      call: 'import("./PanelPlotWindow")',
    },
    {
      module: "/components/Stage/PolarStage.tsx",
      loader: "/components/Stage/PlotStage.tsx",
      call: 'import("./PolarStage")',
    },
    {
      module: "/store/plotRecipeApply.ts",
      loader: "/store/plotRecipeApplyLazy.ts",
      call: 'import("./plotRecipeApply")',
    },
    // ── SLICE 4 (2026-09-18, plans/BUNDLE_HEADROOM.md) ────────────────────
    // Nine content-gated render seams. The nine per-seam deltas sum to
    // −25,862 B; adding the +199 B honest cost of the `LibrarySections.tsx`
    // extraction below (required to stay under the ceiling) gives −25,663 B
    // — see `plans/BUNDLE_HEADROOM.md` slice 4 for both figures and for the
    // separately measured, landed-tree net delta against the real parent
    // (−25,209 B; the −25,862/−25,663 pair above is the pre-merge worktree's).
    //
    // Six of them are the flat Library sections. Every one of those already
    // returned `null` until its own store collection was non-empty, and a
    // FRESH project's collections are all empty — so on the default first
    // paint the section bodies were pure dead weight in the entry chunk.
    // `LibrarySections.tsx` (new, extracted from `Library.tsx`, which sits
    // against the 400-line component ceiling) renders those six behind
    // `lazy()` + `Suspense fallback={null}` under the SAME emptiness test the
    // section applies internally (`originFigures`/`originFidelity`/
    // `figureDocs`/`reports`/`smartFolders`/`collections` length). A seventh,
    // the multi-select bar — not a flat section, just gated the same way —
    // keeps `Library.tsx` as its loader and is gated on
    // `selectedIds.length > 1`. The chunk is therefore requested strictly
    // after the user authors that content, selects a second row, or opens a
    // project that already had it — a persisted-state restore, exactly the
    // narrowing slice 3's finding 4 had to make for the polar/panel seams,
    // stated up front here rather than after the fact.
    //
    // The eighth is the on-plot result chips (∫ Integrate · ∩ FWHM · the ROI
    // gadget family). Those results are committed by an on-canvas tool and
    // the workspace format never serializes them, so this one really is
    // user-action-only — no restore path reaches it. Its gate is the
    // component's own visibility predicate, shared through
    // `components/Stage/resultChipsVisible.ts` (the single module this slice
    // ADDS to the eager graph) so gate and component cannot drift.
    //
    // The ninth is the plot canvas's own context menu, already rendered only
    // when `menu && displayPayload` — i.e. after a right-click on the plot.
    // It takes `lib/plotMenu.ts` and `lib/plotHitTest.ts` with it and was the
    // single largest seam of the slice (−6,328 B). NOTE the cost, which is
    // real and different in kind from the others: the FIRST right-click of a
    // session waits one chunk fetch before the menu appears (later ones are
    // instant). `lib/contextActions.ts` — the shared action registry CLAUDE.md
    // pins as eager for right-click latency — is untouched and stays eager;
    // only the plot-canvas menu renderer moved.
    {
      module: "/components/Library/SavedFiguresSection.tsx",
      loader: "/components/Library/LibrarySections.tsx",
      call: 'import("./SavedFiguresSection")',
    },
    {
      module: "/components/Library/FiguresSection.tsx",
      loader: "/components/Library/LibrarySections.tsx",
      call: 'import("./FiguresSection")',
    },
    {
      module: "/components/Library/CollectionsSection.tsx",
      loader: "/components/Library/LibrarySections.tsx",
      call: 'import("./CollectionsSection")',
    },
    {
      module: "/components/Library/SmartFoldersSection.tsx",
      loader: "/components/Library/LibrarySections.tsx",
      call: 'import("./SmartFoldersSection")',
    },
    {
      module: "/components/Library/OriginFidelitySection.tsx",
      loader: "/components/Library/LibrarySections.tsx",
      call: 'import("./OriginFidelitySection")',
    },
    {
      module: "/components/Library/ReportsSection.tsx",
      loader: "/components/Library/LibrarySections.tsx",
      call: 'import("./ReportsSection")',
    },
    {
      module: "/components/Library/MultiSelectBar.tsx",
      loader: "/components/Library/Library.tsx",
      call: 'import("./MultiSelectBar")',
    },
    {
      module: "/components/Stage/PlotResultChips.tsx",
      loader: "/components/Stage/PlotStageOverlays.tsx",
      call: 'import("./PlotResultChips")',
    },
    {
      module: "/components/Stage/PlotContextMenu.tsx",
      loader: "/components/Stage/PlotStageMenus.tsx",
      call: 'import("./PlotContextMenu")',
    },
    // ── SLICE 5 (2026-09-19, plans/BUNDLE_HEADROOM.md) ────────────────────
    // One content-gated render seam, measured net −936 B.
    //
    // This slice's limit is NOT candidate scarcity. The ratchet in
    // `scripts/check-bundle-size.mjs` is two-sided: it FAILS the build below
    // `EAGER_JS_BUDGET - SLACK` (920,400 − 40,000 = 880,400 B) to force a
    // pin-down, so with the real parent (`cee0494f`, not `b10bcad3` — see the
    // plan) at 889,498 B only 9,098 B was recoverable
    // here without moving the pin. Three further seams were built and
    // measured and are recorded in the plan (`PlotToolbar` −3,644 B and
    // `CommandPalette` −2,935 B, both banked for a slice allowed to ratchet
    // the pin DOWN; `DocumentWindow` +221 B, rejected outright). A fourth,
    // `PlotLegend`, measured −5,881 B — the largest win on the tree — and was
    // rejected anyway on USER-VISIBLE COST: the legend is part of the plot's
    // meaning, and deferring it makes the first plot of a session (and every
    // restore with `showLegend` on) paint for one chunk fetch before the
    // legend appears. Bytes that the 880,400 B floor means the campaign
    // cannot bank for anything are not worth a visible first-paint artifact
    // on a core surface. Do not re-add it without that trade being re-argued.
    //
    // `components/windows/SnapshotPlotWindow.tsx` is the `win.kind ===
    // "snapshot"` branch, the same shape as `PanelPlotWindow` above: a frozen
    // snapshot window exists only after the user takes one in-session, or on
    // opening a project that already held one (`kind` is a persisted window
    // field, so that restore pays the fetch on its first paint) — never on the
    // default first paint, and nothing perceptible on either path. It drags
    // nothing out with it: −936 B against a 1,169 B bound, 80% realised,
    // which is the component-seam figure slice 4's rule predicts.
    //
    // NOTE for anyone re-deriving these numbers: −936 B is this seam's delta
    // measured ALONE against the parent. Measured instead as a marginal
    // addition on top of the (rejected) `PlotLegend` tree it reads −585 B —
    // two seams landing in the same build share chunk-boundary glue, so a
    // marginal figure is not the seam's own delta. The plan records both.
    {
      module: "/components/windows/SnapshotPlotWindow.tsx",
      loader: "/components/windows/WindowCanvas.tsx",
      call: 'import("./SnapshotPlotWindow")',
    },
    // ── SLICE 6 (2026-09-19, plans/BUNDLE_HEADROOM.md) ────────────────────
    // One seam, measured net −13,134 B — the largest single-seam win of the
    // campaign. Ranked ahead of the two candidates this slice inherited
    // (`PlotToolbar`, `CommandPalette`) under the `PlotLegend` ruling slice 5
    // left behind: both are gated on a surface the user is actively looking
    // at (plot chrome / the first ⌘K of a session) and are suspect on that
    // ground alone, independent of bytes. This one is not — see below.
    //
    // `components/Library/DatasetRow.tsx` itself cannot be the SEAMS
    // `module`: `LibraryTree.tsx` and `SmartFoldersSection.tsx` both import
    // it directly (it is the real worksheet row for the Tree and Smart
    // Folders renders), and both are themselves ALREADY-lazy chunks, so the
    // corpus-wide "no module value-imports a seam module statically" arm
    // would go red for two importers doing nothing wrong. The seam is
    // instead `components/Library/LibraryFlatRows.tsx`, a thin new wrapper
    // (the `LibrarySections.tsx` shape) around Library.tsx's OWN flat-list
    // fallback body — the `else` branch reached only when the search box is
    // empty AND the hierarchy has produced zero rows. That branch was the
    // ONLY static edge keeping DatasetRow.tsx (and everything it exclusively
    // pulls in) eager: nothing else in the entry graph reaches it.
    //
    // The gate is stronger than "runs after a user action or a persisted
    // restore" (the class every other seam in this file argues): PR C means
    // `rows.length === 0` implies `datasets.length === 0` (every dataset
    // unconditionally yields a hierarchy worksheet node —
    // `lib/libraryHierarchy.ts`'s `buildLibraryHierarchy`), which means
    // `shown` (filtered from `datasets`) is empty too — so in today's app
    // this branch never renders an actual row, on ANY path, first paint or
    // restore included. Deferring it is therefore not merely low-cost, it is
    // free: nothing a user can see or a restore can hit depends on this
    // chunk loading synchronously. See `LibraryFlatRows.tsx`'s own header for
    // the full argument; it is not deleted outright because that invariant
    // lives in a different module and this file should not assume it without
    // proof.
    {
      module: "/components/Library/LibraryFlatRows.tsx",
      loader: "/components/Library/Library.tsx",
      call: 'import("./LibraryFlatRows")',
    },
  ];

  /** Strip line and block comments FIRST (2026-09-15 review, finding 5): the
   *  type-clause stripper below used an unbounded `[\s\S]*?`, so an `import
   *  type` mentioned inside a COMMENT started a match that ate forward to the
   *  next real `from "…"` and deleted a genuine value import. Measured: a
   *  `// we deliberately keep an import type here` line above a real static
   *  import blinded the guard completely.
   *
   *  ONE left-to-right pass, string/template literals matched first and put
   *  back verbatim, so whichever of `//`, `/*` or a quote comes first at a
   *  given index wins (2026-09-15 review round 2, finding 1). The previous
   *  two-pass form ran the BLOCK pass first, so a `//` line comment that
   *  merely mentioned `/*` — this repo's headers are full of them, citing
   *  paths like `lib/api/*` and `commands/*.ts` — opened a fake block comment
   *  that ate forward to the next `*\/` and deleted every import in between.
   *  Measured on this tree: 32 shipped modules / 56 distinct static import
   *  specifiers invisible (including all five of `appCommands.ts`'s
   *  `./commands/*` edges), and the eager walk below reported 379 modules
   *  where the truth is 400 (2026-09-17 correction: the commit that shipped
   *  this comment measured itself against its own two-commits-back ancestor
   *  rather than its real parent, which had already added a module —
   *  `lib/nonFiniteCells.ts` at `0565b674` — same root cause as the bundle-
   *  bytes correction in `plans/BUNDLE_HEADROOM.md`; re-measured in-test on
   *  that commit's own tree: 901 sources, 379 of them eager with the old
   *  stripper, 400 with the new). With this form the corpus has 0 false negatives
   *  against `es-module-lexer` ground truth — scoped to the current corpus:
   *  regex literals are NOT among the preserved alternatives above, so a
   *  regex containing `/*` or `//` (e.g. `/[/*]/g`) ahead of a real import on
   *  the same line would still delete it; measured 0 occurrences of that
   *  shape on this tree, which is why the false-negative count is 0 and not
   *  a structural guarantee. Keeping the literals means the scan never
   *  mistakes a `//` inside `"https://…"` for a comment, which is what the
   *  old `[^:]` lookbehind-substitute was for. */
  const stripComments = (src: string): string =>
    src.replace(
      /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      (_m, str: string | undefined) => str ?? "",
    );

  /** Drop `import type … from "…"` / `export type … from "…"` clauses, which
   *  carry no runtime edge, so only VALUE imports are searched. Anchored to a
   *  statement start and stopped at the first `;`, so it cannot run past the
   *  clause it matched. `import { type A, b }` is NOT a type-only clause and
   *  is deliberately left in place — it does carry a runtime edge. */
  const valueImportsOnly = (src: string): string =>
    stripComments(src).replace(/^[ \t]*(?:import|export)\s+type\s[^;]*?\bfrom\s*["'][^"']+["']/gm, "");

  /** Every STATIC value-import specifier in a module: the `from "…"` clauses
   *  AND bare side-effect `import "…"` (2026-09-15 review, finding 6 — a bare
   *  import has no `from`, yet folds the module into the importer's chunk just
   *  the same, so the old `from`-only scan let `import "./workbookTransfer";`
   *  through). Dynamic `import("…")` is `import(`, never `import "`, so it is
   *  correctly not matched here.
   *
   *  Two measured residual OVER-reports: an import-looking string inside a
   *  TEMPLATE literal is counted (literals are preserved verbatim by
   *  `stripComments`, by design — measured `["./realA", "./fake",
   *  "./realB"]`), and an `import type` clause that is not the first thing
   *  on its line is counted as a value import (measured `import { b } from
   *  "x"; import type { A } from "y";` -> `["x", "y"]`; the reverse order is
   *  handled correctly by the line anchor). The `import type` case does not
   *  fire on this tree. The template-literal case DOES: 7 times across 6
   *  modules (2026-09-17 correction — a prior version of this doc claimed
   *  neither fired), all of the shape `` `… "${expr}" …` `` in a doc comment
   *  or string, e.g. `components/Inspector/ChannelsCard.tsx` and
   *  `components/Library/folderOps.ts`. Every one of the 7 is a non-relative
   *  specifier, so `resolveFrom` below drops it and the guards stay correct
   *  today — but that is a corpus fact, not a soundness property: a phantom
   *  edge is fail-safe only in the direction of hiding nothing, NOT in the
   *  other direction. A template literal that happens to spell a RELATIVE
   *  seam path (e.g. `` `copied from "../lib/workbookTransfer"` `` inside
   *  `store/workbookTransfer.ts`) resolves onto the seam and turns "no
   *  module value-imports a seam module statically" RED for a module that
   *  imports nothing — a false positive. That fails closed, which is
   *  acceptable for a guard, but it is a live trip-wire, not a hypothetical:
   *  string content, not import structure, decides whether it fires. */
  const staticSpecifiers = (src: string): string[] => {
    const v = valueImportsOnly(src);
    return [
      ...[...v.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...v.matchAll(/(?:^|[\s;}])import\s*["']([^"']+)["']/gm)].map((m) => m[1]),
    ];
  };

  it("scans the modules it claims to", () => {
    // A guard whose subject has been renamed away passes vacuously.
    const paths = sources().map(([p]) => p);
    for (const { module, loader } of SEAMS) {
      expect(paths.some((p) => p.endsWith(module)), `${module} not found`).toBe(true);
      expect(paths.some((p) => p.endsWith(loader)), `${loader} not found`).toBe(true);
    }
  });

  /** Resolve a relative import specifier against the importing module's own
   *  path, so `./workbookTransfer` from `./store/useApp.ts` is not confused
   *  with `../lib/workbookTransfer` — the false positive the first version of
   *  this guard reported (two different modules, same basename). */
  const resolveFrom = (importer: string, spec: string): string | null => {
    if (!spec.startsWith(".")) return null;
    const parts = importer.split("/").slice(0, -1).concat(spec.split("/"));
    const out: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return `/${out.join("/")}`;
  };

  it("no module value-imports a seam module statically", () => {
    const targets = new Set(SEAMS.map((s) => s.module.replace(/\.tsx?$/, "")));
    const offenders = sources().flatMap(([p, src]) => {
      const hits = staticSpecifiers(src)
        .map((spec) => resolveFrom(p, spec))
        .filter((r): r is string => r !== null && targets.has(r));
      return hits.length ? [`${p} -> ${hits.join(", ")}`] : [];
    });
    expect(
      offenders,
      "these modules are chunk-deferred — reach them through the dynamic import() in their loader, not a static one",
    ).toEqual([]);
  });

  // The two blind spots the 2026-09-15 review measured in the first version of
  // this scanner. Both are asserted on synthetic sources, because both were
  // LATENT — no shipped module triggers either today, so a corpus-wide
  // assertion would pass with the bug still present.
  it("is not blinded by a comment that merely mentions an import type clause", () => {
    // The two cases the review measured against the original unanchored
    // `[\s\S]*?` — each returned [] where a real value import was present.
    const withLineComment = '// we deliberately keep an import type here\nimport { buildTransferPackage } from "../lib/workbookTransfer";\n';
    const withDocComment = '/** see export type re-exports */\nimport { buildTransferPackage } from "../lib/workbookTransfer";\n';
    // And the case that ANCHORING alone does not fix: a commented-out clause
    // that starts its own line and has no `from` of its own, so the scan runs
    // on into the next real import and eats it. Only stripping comments first
    // holds this one.
    const withCommentedOutClause = '/*\nimport type Foo\n*/\nimport { buildTransferPackage } from "../lib/workbookTransfer";\n';
    expect(staticSpecifiers(withLineComment)).toEqual(["../lib/workbookTransfer"]);
    expect(staticSpecifiers(withDocComment)).toEqual(["../lib/workbookTransfer"]);
    expect(staticSpecifiers(withCommentedOutClause)).toEqual(["../lib/workbookTransfer"]);
  });

  it("is not blinded by a line comment that merely contains a block-comment opener", () => {
    // The round-2 regression: with the block pass running first, this `//`
    // line opened a fake block comment that ran to the next `*/` — i.e. to the
    // end of the doc comment BELOW the import — and swallowed the import.
    // This shape is everywhere in the repo's headers (`lib/api/*`,
    // `commands/*.ts`, `/api/baseline/*`), which is why it was live on 32
    // shipped modules and not latent like the two cases above.
    const src = '// the loaders live in commands/*.ts\nimport { registerFileCommands } from "./commands/fileCommands";\n/** and then a doc comment closes the fake block */\n';
    expect(staticSpecifiers(src)).toEqual(["./commands/fileCommands"]);
    // …and a `//` inside a string is still not a comment.
    expect(staticSpecifiers('const u = "https://example.com/x";\nimport { a } from "./realA";\n')).toEqual(["./realA"]);
  });

  it("sees a bare side-effect import, and still ignores a real type-only one", () => {
    expect(staticSpecifiers('import "./workbookTransfer";\n')).toEqual(["./workbookTransfer"]);
    expect(staticSpecifiers('import type { TransferIdGenerators } from "../lib/workbookTransfer";\n')).toEqual([]);
    // A dynamic import is the SANCTIONED shape and must never be reported.
    expect(staticSpecifiers('const m = await import("../lib/workbookTransfer");\n')).toEqual([]);
  });

  /** Modules that are not seams themselves but were dragged OUT of the eager
   *  graph BY one — seam 2's measured −4,675 B is mostly these two, which
   *  `OriginSavedPreviewWindow` was the only eagerly-reachable importer of.
   *  ~40 lazily-reached workshop panels import them, so the static-import
   *  grep above cannot hold this line; REACHABILITY can (2026-09-15 review,
   *  finding 7). Without it, one eager importer silently folds 4.7 kB back
   *  into the entry chunk and only the bundle budget would ever notice —
   *  the exact failure this describe block exists to prevent. */
  /** SLICE 3 (2026-09-18) adds the four modules its two component seams took
   *  with them: `PanelCell`/`PanelOverlayWindow` (PanelPlotWindow was their
   *  only eagerly-reachable importer) and `PolarStageCore`/`lib/polar.ts`
   *  (PolarStage's). Measured, not assumed: the eager walk went from 406
   *  modules to 400 across the whole slice — the three seams, these four, and
   *  the one module ADDED (`store/plotRecipeApplyLazy.ts`, the loader).
   *  Together they are most of the slice's measured bytes, and none of them is
   *  a seam itself, so only reachability can hold this line. */
  /** SLICE 4 (2026-09-18) adds the six modules its nine seams took with
   *  them, each one measured by the same eager walk this block runs rather
   *  than assumed: `FigureRow` + `lib/originPreview.ts` (FiguresSection was
   *  their only eagerly-reachable importer — note FigureRow is itself the
   *  LOADER of the `OriginSavedPreviewWindow` seam above, which is unaffected:
   *  that guard greps FigureRow's source, it does not require FigureRow to be
   *  eager), `lib/figureCompatibility.ts` (SavedFiguresSection's),
   *  `lib/originFidelity.ts` (OriginFidelitySection's), and
   *  `lib/plotMenu.ts` + `lib/plotHitTest.ts` (PlotContextMenu's — most of
   *  that seam's −6,328 B). Measured across the whole slice: the eager walk
   *  went 400 -> 387 modules, which is the nine seams, these six, minus the
   *  two modules ADDED (`components/Library/LibrarySections.tsx`, the loader
   *  the six Library-section seams share, and
   *  `components/Stage/resultChipsVisible.ts`, the shared gate predicate).
   *  None of the six is a seam itself, so only reachability can hold this
   *  line. */
  /** SLICE 5 (2026-09-19) adds nothing here: its one seam
   *  (`SnapshotPlotWindow`) is a prop-forwarding shell whose every import is
   *  kept eager by something else, so it dragged no module out with it.
   *  Measured by the same eager walk this block runs, against the real
   *  parent `cee0494f` (not `b10bcad3`, which is four commits back and
   *  misses the eagerly-reachable `store/workspaceHydration.ts` module that
   *  `4179b166` added in between): 394 -> 393 modules of a 927-module
   *  corpus, which is that seam alone. */
  /** SLICE 6 (2026-09-19) adds the eleven modules its one seam took with it —
   *  `DatasetRow.tsx` itself plus everything it (and its own row-only
   *  siblings) exclusively pulled in: `DatasetRowParts.tsx`,
   *  `DatasetRowPreview.tsx`, `Sparkline.tsx`, `datasetRowMenu.ts` (DatasetRow's
   *  own imports), `DerivedWorksheetMark.tsx` + `RecomputedMark.tsx` (rendered
   *  by DatasetRowParts), and `lib/combineSeparateActions.ts` +
   *  `lib/derivedWorksheetActions.ts` + `lib/downsample.ts` +
   *  `lib/libraryPreviewPrefs.ts` (pulled in by those, transitively). First
   *  measured with a standalone replica of this block's own
   *  `eagerlyReachable()`, then VERIFIED against the REAL guard itself
   *  (`plans/BUNDLE_HEADROOM.md` slice 6, adversarial-review round 2): a
   *  temporary dump of `eagerlyReachable()`'s own output, run unmodified in
   *  both the real parent `8f79207d`'s tree and this one, gives 393 -> 382
   *  eager modules of a 927 -> 928-module corpus (`sources().length`, this
   *  file's own function), and the SET difference between the two real-guard
   *  dumps is exactly these eleven modules — nothing missed, nothing extra.
   *  The one corpus module ADDED is `LibraryFlatRows.tsx`, the loader — which
   *  itself stays lazy, so it does not appear in either eager count. None of
   *  the eleven is a seam itself, so only reachability can hold this line. */
  const DRAGGED_OUT = [
    "/components/overlays/ToolWindow.tsx",
    "/lib/workshopHelp.ts",
    "/components/windows/PanelCell.tsx",
    "/components/windows/PanelOverlayWindow.tsx",
    "/components/Stage/PolarStageCore.tsx",
    "/lib/polar.ts",
    "/components/Library/FigureRow.tsx",
    "/lib/originPreview.ts",
    "/lib/figureCompatibility.ts",
    "/lib/originFidelity.ts",
    "/lib/plotMenu.ts",
    "/lib/plotHitTest.ts",
    "/components/Library/DatasetRow.tsx",
    "/components/Library/DatasetRowParts.tsx",
    "/components/Library/DatasetRowPreview.tsx",
    "/components/Library/Sparkline.tsx",
    "/components/Library/datasetRowMenu.ts",
    "/components/Library/DerivedWorksheetMark.tsx",
    "/components/Library/RecomputedMark.tsx",
    "/lib/combineSeparateActions.ts",
    "/lib/derivedWorksheetActions.ts",
    "/lib/downsample.ts",
    "/lib/libraryPreviewPrefs.ts",
  ];

  /** The eager chunk's module set, computed the way Rollup computes it: walk
   *  STATIC value imports from the app entry, stop at every dynamic
   *  `import()`. Unresolvable specifiers (bare packages, CSS, assets) are
   *  skipped — they cannot reach an `src/` module anyway. */
  const eagerlyReachable = (): Set<string> => {
    const byPath = new Map(sources().map(([p, src]) => [p.replace(/^\./, ""), src]));
    const resolve = (importer: string, spec: string): string | null => {
      const base = resolveFrom(importer, spec);
      if (base === null) return null;
      for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
        if (byPath.has(c)) return c;
      }
      return null;
    };
    const seen = new Set(["/main.tsx"]);
    const queue = ["/main.tsx"];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      for (const spec of staticSpecifiers(byPath.get(cur) ?? "")) {
        const next = resolve(cur, spec);
        if (next !== null && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };

  it("nothing eager reaches a seam, or the modules the seams dragged out with them", () => {
    const eager = eagerlyReachable();
    // Vacuity guard: a walk that stalls at the entry would pass everything.
    // Measured 2026-09-15 on caa10f88's tree: 400 of 901 source modules are
    // eager (corrected 2026-09-17 — see the stripper doc above for why 399/900
    // was one commit stale). Re-measured in-test 2026-09-18 after slice 3,
    // against the real parent e83c0cc8 (review round, finding 3 — the
    // 404/912 pair recorded at landing time was one commit stale, off the
    // cherry-pick source c1757fb1's chain, not this branch's actual base):
    // 400 of 914 — the corpus grew by the one module slice 3 added, and the
    // eager set went 406 -> 400 (three seams + four dragged out, minus that
    // one addition). Slice 4's real parent is b50f6602, not 3f43467b — the
    // implementer's worktree was rooted two commits back at 3f43467b and the
    // commit was merged forward (review round, finding 1); the "387 of 916"
    // first recorded here was measured against that wrong tree and was also
    // arithmetically off (review round, finding 4). Re-measured against the
    // real parent b50f6602: 402 of 920 -> 389 of 922 — the corpus grew by the
    // two modules slice 4 added (`components/Library/LibrarySections.tsx` and
    // `components/Stage/resultChipsVisible.ts`) and the eager set went
    // 402 -> 389 (nine seams + six dragged out, minus those two additions) —
    // the same shape as originally claimed, corrected absolutes. Nothing here
    // is asserted against these counts; see the `expect`s below.
    expect(eager.has("/main.tsx"), "the entry itself must be in the walk").toBe(true);
    expect(eager.size, "the eager walk collapsed — it is no longer proving anything").toBeGreaterThan(200);
    expect(
      [...SEAMS.map((s) => s.module), ...DRAGGED_OUT].filter((m) => eager.has(m)),
      "these ship inside a lazy seam's chunk; a static import from an eagerly reachable module folds them back into the entry chunk",
    ).toEqual([]);
  });

  /** The regression test the round-2 review asked for. A scanner whose
   *  failures are CORPUS-shaped cannot be protected by synthetic sources
   *  alone: every one of this block's synthetic assertions passed while the
   *  two-pass stripper was silently deleting 56 real import edges. These
   *  anchors are modules the walk provably reaches only if comment stripping
   *  survives this repo's actual file headers — `appCommands.ts` opens with a
   *  `//` line citing `commands/*.ts`, and the `lib/api/*.ts` modules open
   *  with one citing a glob path of their own (`lib/api/*` in `http.ts`,
   *  `/api/baseline/*` in `baseline.ts`, …). If the walk stops seeing them,
   *  the two guards above go quiet on the whole command and api layers.
   *
   *  Round-3 review, nit 4: the REACHABILITY arm below (the `anchors` list)
   *  is pinned to a specific module list, not to the invariant it exists to
   *  protect — a legitimate future lazification of any one of these modules
   *  (exactly the work this describe block enables) would redden it with the
   *  misleading "blinded by a comment" message. The corpus-wide invariant
   *  test right after this one is the version that cannot go red for that
   *  reason; this reachability arm stays for its more concrete failure
   *  message on the regression it was written for, and the `./commands/`
   *  count arm below is a direct scanner assertion (not reachability), which
   *  is not brittle in that way and is kept as-is. */
  it("the eager walk reaches the command and api layers (corpus anchor for the comment stripper)", () => {
    const eager = eagerlyReachable();
    const anchors = [
      "/appCommands.ts",
      "/commands/fileCommands.ts",
      "/commands/dataCommands.ts",
      "/commands/plotCommands.ts",
      "/commands/uiCommands.ts",
      "/commands/analysisCommands.ts",
      "/lib/api.ts",
      "/lib/api/http.ts",
    ];
    expect(
      anchors.filter((a) => !eager.has(a)),
      "these are eagerly reachable from main.tsx in the real graph; if the walk cannot see them the import scanner is being blinded by a comment",
    ).toEqual([]);
    // `appCommands.ts` statically imports all five command registries. A
    // stripper that eats its header comment reports zero.
    const appCommands = sources().find(([p]) => p.endsWith("/appCommands.ts"));
    expect(appCommands, "src/appCommands.ts not found").toBeDefined();
    expect(
      staticSpecifiers(appCommands?.[1] ?? "").filter((s) => s.startsWith("./commands/")).length,
      "appCommands.ts registers five command modules; a blinded scanner sees none of them",
    ).toBeGreaterThanOrEqual(5);
  });

  /** Round-3 review, nit 4's proposed fix: a corpus-wide SCANNER invariant
   *  that needs no reachability walk at all, so it cannot go red because a
   *  module was legitimately moved behind a seam — only because the scanner
   *  itself regressed. For every source module, `staticSpecifiers` must find
   *  at least as many static edges as a naive `from "…"` line regex (value
   *  imports/exports only, `type` clauses excluded) finds by itself; the
   *  naive regex has no comment- or string-awareness, so it is a lower bound
   *  a correct stripper can never fall under. Measured 2026-09-17: 0
   *  violations with the current stripper, 32 with the old two-pass one
   *  (headed by `/appCommands.ts: 0 < 5` and every `lib/api/*.ts` module). */
  it("staticSpecifiers never undercounts a naive from-clause scan, corpus-wide (comment-stripper invariant)", () => {
    // Vacuity guard: the glob must actually be reaching most of the corpus.
    expect(sources().length).toBeGreaterThanOrEqual(800);
    const naiveFromClauseCount = (src: string): number =>
      (src.match(/^(?:import|export)(?!\s+type\s)[^\n]*\bfrom\s*["'][^"']+["']/gm) ?? []).length;
    const violations = sources()
      .filter(([, src]) => staticSpecifiers(src).length < naiveFromClauseCount(src))
      .map(([p, src]) => `${p}: ${staticSpecifiers(src).length} < ${naiveFromClauseCount(src)}`);
    expect(violations, "staticSpecifiers is blind to real static imports a naive regex still finds").toEqual([]);
  });

  /** Review round, finding 7: `plotRecipeApplyLazy.ts:34` keeps a
   *  `type ApplyCore = typeof import("./plotRecipeApply")` type alias next to
   *  its real dynamic import — the exact same `call` text this test looks
   *  for, in TYPE position. A plain `.toContain(call)` cannot tell the two
   *  apart, so replacing the real `import("./plotRecipeApply")` with a
   *  static one (leaving the type alias in place) left this arm green while
   *  the other two SEAMS arms below correctly went red (measured: sabotage 3
   *  in the review). Require the match not be immediately preceded by
   *  `typeof `, which the type alias always is and a real dynamic import
   *  never is. */
  it("each loader reaches its seam through a dynamic import()", () => {
    for (const { module, loader, call } of SEAMS) {
      const found = sources().find(([p]) => p.endsWith(loader));
      expect(found, `${loader} not found`).toBeDefined();
      const src = found?.[1] ?? "";
      const escapedCall = call.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const realDynamicImport = new RegExp(`(?<!typeof )${escapedCall}`);
      expect(
        realDynamicImport.test(src),
        `${loader} must dynamically import ${module} (not merely name it in a \`typeof\` type position)`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// File-URL-to-path guard (#269 follow-up review: Windows build SHA).
//
// `new URL(".", import.meta.url).pathname` is a URL component, not a
// filesystem path. On POSIX the two happen to coincide, which is exactly what
// makes this a trap worth a build guard: it works perfectly on every machine
// in CI, and on Windows returns `/C:/Users/.../frontend/`, which Node rejects
// as a `cwd` with ENOENT. In #269 that made every Windows build stamp the
// diagnostics bundle with `unknown` instead of the commit SHA, silently,
// because the failure was swallowed by a fallback and `"unknown"` is truthy.
//
// A behavioural test cannot hold this line here: both frontend CI jobs run
// ubuntu-latest, and reverting the fix leaves the build-identity tests green
// on Linux (verified). Until a Windows frontend job exists, the only guard
// that actually runs on the failing pattern is a grep for it.
//
// Scoped to build config and scripts, where every `.pathname` is a file URL's.
// `window.location.pathname` in app code is a different thing entirely and is
// unaffected.
describe("file URLs are converted with fileURLToPath, never .pathname (#269)", () => {
  const buildFiles = {
    ...(import.meta.glob("../vite.config.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>),
    ...(import.meta.glob("../scripts/*.mjs", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>),
  };

  /** Lines with comments dropped, so prose ABOUT the trap (including the
   *  warning in vite.config.ts) does not read as an instance of it. */
  function code(src: string): string[] {
    return src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      });
  }

  it("scans the build config and scripts it claims to", () => {
    // A glob that silently matches nothing is a guard that silently passes.
    const names = Object.keys(buildFiles);
    expect(names.some((n) => n.endsWith("vite.config.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("check-bundle-size.mjs"))).toBe(true);
  });

  it("no build file derives a path from a file URL's .pathname", () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(buildFiles)) {
      for (const line of code(src)) {
        if (/\.pathname/.test(line)) offenders.push(`${path}: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      "Use fileURLToPath(new URL(…, import.meta.url)) — a file URL's pathname " +
        "keeps the drive letter behind a leading slash on Windows (/C:/…), " +
        "which Node rejects as a cwd. See this block's comment.",
    ).toEqual([]);
  });
});

// getState()-in-render ratchet (repo evaluation, 2026-09-03). An
// inventory of every `useApp.getState()` call under src/components + App*.tsx
// (rg -n 'useApp\.getState\(\)' src/components src/App*.tsx, non-test files,
// 2026-09-03: 80 files, 276 call sites) classified each site as (a) inside an
// event handler/effect/callback/async task — a legitimate imperative "read
// the latest state right now" — or (b) directly in a component's render body
// with no subscription, which silently skips React's rerender-on-change and
// is a stale-read bug. The vast majority were (a); the one confirmed (b) was
// LibraryWorkspace.tsx's module-level `selectedKey()` helper, called twice
// directly in render (the third call, inside its `close()` callback, was
// already legitimate) — fixed by making it a pure `deriveSelectedKey(selection,
// selectedIds)` that takes its two source fields as params instead of calling
// getState() itself, so the render-body call sites pass their own already-
// subscribed `useApp((s) => ...)` values. Two other render-body reads
// (FolderRow.tsx's `isDropCandidate`, PlotStage.tsx's `qfitRoi`/
// `gadgetCursors` props, and PlotContextMenu.tsx's single-shot `useMemo`
// snapshot) are NOT counted as bugs here — each carries its own comment
// explaining why a one-time non-reactive read is the deliberate, correct
// choice (folders don't change mid-drag; those two props deliberately stay
// off a dependency list to avoid rebuilding the whole plot; the context menu
// is single-shot and never needs to react to a later store change) — turning
// those into selectors would add rerenders their authors were explicitly
// avoiding, not fix a bug.
//
// The rule going forward, same iron law as every other ratchet in this file:
// prefer a selector during render; reach for `useApp.getState()` only inside
// a handler, effect, callback, or other imperative (non-render) context. This
// guard does not re-classify every site on every run (that requires reading
// the surrounding function, which a grep-only guard can't do reliably) — it
// caps the FILE COUNT so the imperative-getState() footprint can only shrink,
// the same shape as the weak-wait ratchet above.
//
// WIDENED 2026-09-14 (tiles_review7.md finding 3): `getLibraryState()`
// (store/hooks/useLibraryStore.ts) is `useApp.getState()` behind a new name
// — an alias added for the Tiles drag/drop rework so an imperative read from
// a `document` event listener (useDetailsDragDrop.ts) would not move this
// ratchet's pin for a call the ratchet was never meant to police. Filtering
// on the literal string `useApp.getState()` alone made that alias invisible
// to the ratchet: a future render-body read through `getLibraryState(` would
// go uncounted. Widened to catch both spellings. This is a file-count
// ratchet, so the file the widened filter itself newly counts moves the pin
// by exactly that many files — MEASURED (`useDetailsDragDrop.ts`, the only
// file that calls `getLibraryState(` without also calling
// `useApp.getState()`): 80 -> 81, exactly one file, and that one use is
// legitimate under the ratchet's own rule (a capture-phase `pointerdown`
// listener, not a render body — see the file's own comment at the call
// site).
const GETSTATE_IN_RENDER_FILE_COUNT_PIN = 81;

describe("getState()-in-render ratchet (repo evaluation 2026-09-03)", () => {
  it("no more files under components/ + App*.tsx call useApp.getState() than the 2026-09-03 baseline", () => {
    const withGetState = sources()
      .filter(([p]) => p.startsWith("./components/") || /^\.\/App.*\.tsx$/.test(p))
      .filter(([, src]) => src.includes("useApp.getState()") || src.includes("getLibraryState("))
      .map(([p]) => p);
    expect(
      withGetState.length,
      `${withGetState.length} files call useApp.getState() under components/+App*.tsx, ` +
        `> the ${GETSTATE_IN_RENDER_FILE_COUNT_PIN}-file baseline (2026-09-03). ` +
        "A NEW imperative getState() call is fine (handlers/effects/callbacks); " +
        "a NEW render-body getState() read is not — convert it to a selector " +
        "(see LibraryWorkspace.tsx's deriveSelectedKey for the pattern) instead " +
        "of adding to this count.",
    ).toBeLessThanOrEqual(GETSTATE_IN_RENDER_FILE_COUNT_PIN);
  });
});
