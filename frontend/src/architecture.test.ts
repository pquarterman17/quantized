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

/** Modules that reference `re`, minus those whose path ends with an allowlisted
 *  suffix (the sanctioned model layers). */
function offenders(re: RegExp, allow: string[]): string[] {
  return sources()
    .filter(([, src]) => re.test(src))
    .map(([p]) => p)
    .filter((p) => !allow.some((a) => p.endsWith(a)));
}

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
  "/store/useApp.ts": 2868,
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
  "/lib/api.ts": 1725,
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
  "/lib/workspace.ts": 633,
  "/lib/plotview.ts": 978,
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
  "/lib/uplotOpts.ts": 1446,
  "/lib/uplotOverlays.ts": 1175,
  "/lib/types.ts": 1090,
  "/lib/plotspec.ts": 893,
  "/lib/originFigures.ts": 793,
  "/components/Stage/useMultiPanelStage.ts": 791,
  "/components/Stage/useStatStage.ts": 704,
  "/components/workshops/calculators/useCalculators.ts": 681,
  "/lib/roiMath.ts": 664,
  "/components/workshops/graphbuilder/useGraphBuilder.ts": 663,
  "/lib/plotdata.ts": 658,
  "/components/Stage/worksheet/useWorksheetView.ts": 649,
  "/lib/roi.ts": 638,
  "/lib/plotspec2.ts": 637,
  "/components/workshops/figurebuilder/useFigureBuilder.ts": 616,
  "/lib/uplotShapes.ts": 593,
  "/components/Stage/statRender.ts": 527,
};

describe("general .ts module-size ceiling (RSM_CUTS_PLAN #20)", () => {
  const ts = sources().filter(([p]) => p.endsWith(".ts"));

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

describe("row-state model guard (#50 universal linking)", () => {
  it("only the row-state model reads/writes Dataset.excludedRows", () => {
    // rowstate = the exclusion primitives; workspace = .dwk (de)serialize;
    // useApp = the store mutation actions; corrections = the
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
      "/lib/workspace.ts",
      "/store/useApp.ts",
      "/store/corrections.ts",
      "/store/cellEdit.ts",
    ];
    expect(
      offenders(/\.excludedRows\b/, allow),
      "read exclusion via lib/rowstate (analysisData/droppedRows/excludedSet), not Dataset.excludedRows directly",
    ).toEqual([]);
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
  "/components/workshops/figurebuilder/useFigureBuilder.test.ts": 22,
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
  "/components/Stage/useShapeDraw.test.ts": 1,
  "/components/Library/PagesSection.test.tsx": 1,
  "/components/workshops/importwizard/ImportWizardPanel.test.tsx": 3,
  "/components/workshops/importwizard/useImportWizard.test.ts": 1,
};

describe("weak-wait ratchet (TEST_DETERMINISM_PLAN #6)", () => {
  /** Load test files only (*.test.ts, *.test.tsx). */
  function testSources(): [string, string][] {
    return Object.entries(modules).filter(([p]) => /\.test\.(ts|tsx)$/.test(p));
  }

  it("no test file exceeds its weak-wait pin — fix the site by waiting on state, not the mock", () => {
    // Pattern: waitFor(() => expect(...).toHaveBeenCalled()) — the synchronisation barrier form.
    // Matches across line breaks; does NOT match bare expect(...).toHaveBeenCalled() which is correct.
    // The defect: waitFor returns as soon as the mock is invoked, not when its value reaches state.
    const weakWaitPattern = /waitFor\s*\(\s*\(\s*\)\s*=>\s*expect\s*\([A-Za-z_$][\w$]*\)\s*\.\s*toHaveBeenCalled/;
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
    const weakWaitPattern = /waitFor\s*\(\s*\(\s*\)\s*=>\s*expect\s*\([A-Za-z_$][\w$]*\)\s*\.\s*toHaveBeenCalled/;
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

// History coverage ratchet (GUI_INTERACTION_PLAN #21): every persistent store
// field must be either in HistorySnapshot (undoable) or on an explicit
// HISTORY_EXCLUDED list with justification. The `savedRois` field was missing
// from HistorySnapshot for a day (2026-08-09–2026-08-10), making deletion of
// named ROIs unrecoverable — the same structural analogue to `savedPlotSpecs`
// was undoable on a different path. This guard prevents the next slice from
// repeating it silently. The test enumerates store fields by static text
// parsing (grepping for field: type; in interfaces) and cross-references them
// against both HistorySnapshot members AND an explicit exclusion list with
// reasons. Any field that is neither -> test fails, forcing a decision: add to
// undo or document why it stays outside.
const HISTORY_EXCLUDED: Record<string, string> = {
  // Transient tool/working state — NOT committed edits, survive across dataset
  // switches by design (see store/rois.ts's header for mapRoi/mapRuler contract).
  mapRoi: "in-progress ROI geometry; survives dataset switch but not undo",
  mapRuler: "in-progress ruler geometry; survives dataset switch but not undo",

  // RSM analysis results (markers on the 2D map); cleared on dataset change or
  // explicitly removed. Kept live during the analysis session but not a saved/durable edit.
  rsmPeaks: "RSM peak markers from analysis; cleared on dataset change",

  // Worksheet row selection (per-window). Transient UI state separate from the plot's
  // persistent selection (store/worksheetSelection.ts). Cleared on window close/dataset change.
  worksheetSelections: "worksheet row selections per window; UI state, not data",

  // Gadget overlays and live-analysis results — cleared on dataset change or tool
  // switch. Kept live while drawing but never written as a durable edit.
  fitOverlay: "live curve-fit preview; cleared on gesture cancel or dataset switch",
  peakOverlay: "live peak-detection preview; cleared on dataset change",
  baselineOverlay: "live baseline preview; cleared on dataset change",
  qfitRoi: "quick-fit drag ROI; cleared on tool switch",
  qfitModel: "quick-fit model name; cleared on tool switch",
  qfitBusy: "quick-fit async state; cleared on tool switch",
  qfitResult: "quick-fit preview result; cleared on tool switch",
  qfitError: "quick-fit error message; cleared on tool switch",
  gadgetMode: "ROI gadget mode selector; cleared on dataset change",
  gadgetBusy: "gadget async state; cleared on dataset change",
  gadgetError: "gadget error message; cleared on dataset change",
  gadgetIntegrateResult: "gadget integrate preview; cleared on dataset change",
  gadgetStatsResult: "gadget stats preview; cleared on dataset change",
  gadgetDerivResult: "gadget derivative preview; cleared on dataset change",
  derivOverlay: "derivative axis overlay; cleared on dataset change",
  gadgetFftPreview: "live FFT preview; cleared on dataset change",
  gadgetCursors: "paired-cursors position; cleared on dataset change",
  gadgetCursorResult: "cursors measurement result; cleared on dataset change",

  // Peak wizard editing temporary state
  peakWizardEdit: "peak wizard edit bridge (ephemeral); cleared on gesture end",

  // Baseline editing temporary state
  baselineAnchorEdit: "baseline anchor edit bridge (ephemeral); cleared on gesture end",

  // UI-only preferences and transient state
  theme: "UI theme (light/dark); user preference, not data",
  accent: "UI accent colour; user preference, not data",
  density: "UI density/spacing; user preference, not data",
  palette: "series colour-cycle preset; user preference, not data",
  prefsOpen: "Preferences dialog visibility; UI state, not data",
  cmdkOpen: "Command palette visibility; UI state, not data",
  curveFitOpen: "Curve Fit workshop visibility; UI state, not data",
  hysteresisOpen: "Hysteresis workshop visibility; UI state, not data",
  peaksOpen: "Peaks workshop visibility; UI state, not data",
  reflectivityOpen: "Reflectivity workshop visibility; UI state, not data",
  reflectivitySeed: "pending SLD layer from calculator (ephemeral); consumed on workshop open",
  baselineOpen: "Baseline workshop visibility; UI state, not data",
  calculatorsOpen: "Calculators visibility; UI state, not data",
  magToolsOpen: "Magnetometry tools visibility; UI state, not data",
  rsmOpen: "RSM tools visibility; UI state, not data",
  digitizerOpen: "Digitizer visibility; UI state, not data",
  datasetMathOpen: "Dataset Math workshop visibility; UI state, not data",
  tabulateOpen: "Tabulate workshop visibility; UI state, not data",
  distributionOpen: "Distribution workshop visibility; UI state, not data",
  dataFilterOpen: "Data Filter workshop visibility; UI state, not data",
  statsChooserOpen: "Stats chooser visibility; UI state, not data",
  peakWizardOpen: "Peak Analyzer stepper visibility; UI state, not data",
  importWizardOpen: "Import wizard visibility; UI state, not data",
  pipelineOpen: "Pipeline view visibility; UI state, not data",
  figureBuilderOpen: "Figure Builder visibility; UI state, not data",
  figurePageOpen: "Figure page composer visibility; UI state, not data",
  waterfallOpen: "Waterfall mode visibility; UI state, not data",
  reflViewOpen: "Reflection view visibility; UI state, not data",
  columnSwitcherOpen: "Column switcher visibility; UI state, not data",
  shortcutsOpen: "Shortcuts dialog visibility; UI state, not data",
  textFormatHelpOpen: "Text format help visibility; UI state, not data",

  // View/navigation state — zoom/pan/autoscale limits; separate Back/Forward
  // view history (viewHistory/viewFuture) handles these.
  xLim: "plot X range (zoom); navigated via Back/Forward, not edit undo",
  yLim: "plot Y range (zoom); navigated via Back/Forward, not edit undo",
  xStep: "X-axis tick increment (Origin decoded); metadata, not edit state",
  yStep: "Y-axis tick increment (Origin decoded); metadata, not edit state",
  y2Lim: "secondary Y range; navigated via Back/Forward, not edit undo",
  y2Step: "Y2-axis tick increment; metadata, not edit state",

  // Plot rendering parameters (view state) — NOT persistent edits, derived from
  // active dataset and the PlotView. HistorySnapshot already captures `view`,
  // which includes these; re-listing them in snapshot fields would be redundant.
  showGrid: "grid visibility toggle; captured in view snapshot",
  showLegend: "legend visibility; captured in view snapshot",
  legendPos: "legend position; captured in view snapshot",
  legendStatic: "read-only legend mode; captured in view snapshot",
  legendTitle: "legend header text; captured in view snapshot",
  xScale: "plot X scale (linear/log); captured in view snapshot",
  yScale: "plot Y scale; captured in view snapshot",
  y2Scale: "secondary Y scale; captured in view snapshot",
  showAxisBox: "axis frame rendering; captured in view snapshot",
  stackMode: "multi-panel stacked mode; captured in view snapshot",
  panelFit: "panel fit mode (aspect/fill); captured in view snapshot",
  pageSetup: "physical page model; captured in view snapshot",
  composition: "multi-panel arrangement (spatial/facet/break); ephemeral, recomputed per action",
  insetMode: "magnifier inset visibility; captured in view snapshot",
  polarMode: "polar rendering mode; captured in view snapshot",
  statMode: "Statistics stage mode; captured in view snapshot",
  waterfall: "waterfall offset; captured in view snapshot",
  plotTemplate: "on-screen publication template; captured in view snapshot",
  xAxisLabel: "X-axis label override; captured in view snapshot",
  yAxisLabel: "Y-axis label override; captured in view snapshot",
  y2AxisLabel: "secondary Y-axis label; captured in view snapshot",
  plotTitle: "chart title; captured in view snapshot",
  xKey: "X-axis channel index; captured in view snapshot",
  yKeys: "plotted Y channels; captured in view snapshot",
  y2Keys: "secondary Y channels; captured in view snapshot",
  xFmt: "X-axis tick format; captured in view snapshot",
  yFmt: "Y-axis tick format; captured in view snapshot",
  y2Fmt: "secondary Y-axis format; captured in view snapshot",
  refLines: "fixed reference lines; captured in view snapshot",
  annotations: "text annotations; captured in view snapshot",
  regionShades: "Origin region bands; captured in view snapshot",
  seriesStyles: "per-channel style overrides; captured in view snapshot",
  seriesLabels: "per-channel display names; captured in view snapshot",
  errKeys: "channel error-bar mappings; captured in view snapshot",
  seriesOrder: "plotted-channel draw order; captured in view snapshot",
  hiddenChannels: "toggled-off channels; captured in view snapshot",
  plotTool: "active plot tool (pointer/zoom/etc); captured in view snapshot",

  // Macro & pipeline automation state
  macroRecording: "macro recorder on/off; automation state, not data edit",
  macroSteps: "recorded macro steps; automation steps, not data edits (no undo needed)",
  pipelineRunning: "pipeline executor state; automation state, not data",

  // Region/measure results (analyzed data, not source edits)
  regionPicked: "last x-range from region tool; UI transient, cleared on dataset change",
  integral: "integration result overlay; cleared on dataset change",
  fwhmResult: "FWHM measurement; cleared on dataset change",

  // Dynamic/derived app state
  status: "status message (for toasts/logs); ephemeral UI feedback",
  recalcMode: "recalc engine mode (auto/manual/off); execution preference, not data",
  staleDatasets: "datasets awaiting recalculation; derived from data graph, not persistent",
  staleFits: "fits awaiting recalculation; derived from data graph, not persistent",

  // Expanded/collapsed tree state (Library view)
  expandedFolders: "expanded folder ids in tree; UI view state, not data",

  // Plot-window-specific navigation/view tracking (separate from edit history)
  plotCanvasBounds: "plot rendering bounds (for hit-testing); computed, not stored",

  // Selection state (already has dedicated store/worksheetSelection.ts slice)
  selection: "active worksheet row selection; managed by worksheetSelection slice",
  selectedIds: "multi-selection for bulk ops; captured in history snapshot",

  // Worksheet override (separate from plot's activeId)
  worksheetId: "worksheet dataset override; captured in history snapshot",
  activeId: "focused plot window dataset; captured in history snapshot",

  // Open report/seed state (UI panels)
  openReportId: "open report viewer id; UI state, not data",
  figureDocSeed: "pending figure from seeded editor; ephemeral, consumed on open",
  statStageSeed: "stat stage box/violin spec seed; ephemeral, consumed on open",
  leftCollapsed: "left library panel collapse state; UI view state, not data",
  rightCollapsed: "right inspector panel collapse state; UI view state, not data",
  stageTab: "active Stage tab (Plot/Worksheet/Stats); UI view state, not data",

  // Analysis selections and preferences
  excludedDisplay: "excluded-row display mode (eye/strikethrough); user preference",
  originBookClickOpens: "Origin book double-click target; user preference",
  defaultGrid: "default grid-on preference; user preference",
  defaultPanelFit: "default panel fit (aspect/fill); user preference",
  defaultTrace: "default trace/line style; user preference",
  defaultLineWidth: "default line width; user preference",
  copyFigureTransparent: "copy-to-clipboard transparency pref; user preference",
  antialias: "antialiasing preference; user preference",
  reduceMotion: "reduce-motion accessibility pref; user preference",
  wheelZoom: "wheel zoom direction pref; user preference",
  sigFigs: "significant figures display pref; user preference",
  notation: "number notation (exp/fixed); user preference",
  confirmRemove: "destructive-action confirm pref; user preference",

  // 2D map rendering
  mapMethod: "map regrid interpolation (natural/linear/etc); user preference",
  mapRes: "map grid resolution; user preference",
  contourOn: "contour overlay visibility; UI state, not data",
  contourLevelCount: "contour level count; user preference",
  contourScale: "contour scale (linear/log); user preference",
};

describe("HistorySnapshot field coverage (GUI_INTERACTION_PLAN #21)", () => {
  it("every persistent store field is either in HistorySnapshot or HISTORY_EXCLUDED", () => {
    // Load the HistorySnapshot type definition
    const historySrc = sources().find(([p]) => p.endsWith("/store/history.ts"))?.[1] ?? "";
    if (!historySrc) {
      throw new Error("Could not find history.ts source");
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

    // Manually enumerate AppState fields that are persistent data/config (not transient UI state
    // or methods). These are drawn from the AppState interface comments in useApp.ts and store/*.ts,
    // which define what persists across sessions or gets loaded from .dwk workspaces.
    // Methods are excluded (recordHistory, setActive, etc.); composed slices' fields are included.
    const appStateFields = [
      // Direct AppState fields (useApp.ts lines ~321-546, state not methods)
      "datasets",
      "activeId",
      "selectedIds",
      "worksheetId",
      "reports",
      "openReportId",
      "figureDocs",
      "figureDocSeed",
      "recalcMode",
      "staleDatasets",
      "staleFits",
      "folders",
      "expandedFolders",
      "smartFolders",
      "leftCollapsed",
      "rightCollapsed",
      "stageTab",
      "theme",
      "accent",
      "density",
      "palette",
      "reduceMotion",
      "wheelZoom",
      "defaultTrace",
      "defaultLineWidth",
      "defaultGrid",
      "copyFigureTransparent",
      "antialias",
      "sigFigs",
      "notation",
      "confirmRemove",
      "excludedDisplay",
      "originBookClickOpens",
      "defaultPanelFit",
      "prefsOpen",
      "yScale",
      "xScale",
      "showGrid",
      "showLegend",
      "legendPos",
      "legendStatic",
      "legendTitle",
      "plotTemplate",
      "showAxisBox",
      "stackMode",
      "panelFit",
      "pageSetup",
      "composition",
      "insetMode",
      "polarMode",
      "statMode",
      "xLim",
      "yLim",
      "xStep",
      "yStep",
      "xFmt",
      "yFmt",
      "y2Fmt",
      "plotTitle",
      "xAxisLabel",
      "yAxisLabel",
      "xKey",
      "yKeys",
      "y2Keys",
      "y2Lim",
      "y2Scale",
      "y2Step",
      "y2AxisLabel",
      "refLines",
      "annotations",
      "regionShades",
      "seriesStyles",
      "seriesLabels",
      "errKeys",
      "seriesOrder",
      "hiddenChannels",
      "waterfall",
      "plotTool",
      "regionPicked",
      "integral",
      "fwhmResult",
      "qfitRoi",
      "qfitModel",
      "qfitBusy",
      "qfitResult",
      "qfitError",
      "gadgetMode",
      "gadgetBusy",
      "gadgetError",
      "gadgetIntegrateResult",
      "gadgetStatsResult",
      "gadgetDerivResult",
      "derivOverlay",
      "gadgetFftPreview",
      "gadgetCursors",
      "gadgetCursorResult",
      "cmdkOpen",
      "curveFitOpen",
      "hysteresisOpen",
      "peaksOpen",
      "reflectivityOpen",
      "reflectivitySeed",
      "baselineOpen",
      "calculatorsOpen",
      "magToolsOpen",
      "rsmOpen",
      "digitizerOpen",
      "datasetMathOpen",
      "tabulateOpen",
      "distributionOpen",
      "dataFilterOpen",
      "statsChooserOpen",
      "peakWizardOpen",
      "importWizardOpen",
      "pipelineOpen",
      "figureBuilderOpen",
      "figurePageOpen",
      "statStageSeed",
      "waterfallOpen",
      "reflViewOpen",
      "columnSwitcherOpen",
      "shortcutsOpen",
      "textFormatHelpOpen",
      "fitOverlay",
      "peakOverlay",
      "baselineOverlay",
      "peakWizardEdit",
      "baselineAnchorEdit",
      "mapMethod",
      "mapRes",
      "contourOn",
      "contourLevelCount",
      "contourScale",
      "macroRecording",
      "macroSteps",
      "pipelineRunning",
      "status",
      // Slices composed into AppState (from store/*.ts files)
      "plotWindows",
      "focusedWindowId",
      "plotCanvasBounds",
      "selection",
      "originFigures",
      "originFidelity",
      "editableFigures",
      "pages",
      "savedPlotSpecs",
      "activePlotSpecId",
      "savedRois",
      "rsmPeaks",
      "mapRoi",
      "mapRuler",
      "worksheetSelections",
    ];

    // Classify every field
    const uncovered: string[] = [];
    for (const field of appStateFields) {
      if (historyFields.has(field)) {
        // Field is in HistorySnapshot — good.
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
