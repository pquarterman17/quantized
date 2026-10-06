// WORKSHOP FLAGS, extracted from store/useApp.ts (audit P4.1, the sixth
// domain — "decompose high-risk frontend god-modules, characterization tests
// first"; store-size ratchet, MAIN_PLAN #2). Composed into the ONE useApp
// store exactly like ./macroPipeline: `useApp` spreads
// `createWorkshopFlagsSlice(set)` into the store, so every existing
// `useApp((s) => s.peaksOpen)` selector and `getState().setPeaksOpen(...)`
// call keeps working. A code boundary, not a second store.
//
// WHAT THIS MODULE OWNS: every workshop/dialog open flag declared on the
// store itself (Preferences, ⌘K, the analysis workshops, the figure builder
// and page composer, Help dialogs), the two one-shot cross-panel seeds
// (`reflectivitySeed`, `statStageSeed`), the three on-plot overlays the
// workshops publish, the two plot-edit bridges (peak markers, baseline
// anchors), and the 2-D map/contour settings. 38 fields, 40 one-line actions.
// An own-state slice (store/gadget.ts's shape): the fields are declared and
// initialized HERE. Flags owned by other slices (graphBuilderOpen,
// roiCutsOpen, tool windows) stay with their slices.
//
// Not exclusive write access: other slices still write these fields as part
// of their own gestures (figureLifecycle.ts/reportsFigureDocs.ts/windows.ts
// open or close the figure builder, pageDocuments.ts opens the page composer,
// gadget.ts/recalcFits.ts publish `fitOverlay`, workspaceHydration.ts clears
// the overlays on a .dwk load). This module owns the one-field setters.
//
// Contract: no action here writes `datasets`, calls `get().recordHistory`, or
// toasts. The single cross-domain write is `seedStatStage`, which also turns
// `statMode` on (without an undo step, unlike `setStatMode`).
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, no React. Only types
// from `../lib/types` and the `AppState` TYPE from ./useApp (type-only, so
// the runtime import graph stays one-directional: useApp -> here).
//
// Characterization tests: store/workshopFlags.characterization.test.ts pins
// the exact keys every action writes (a poisoned whole-getState() diff) and
// the initial values. Written green against the pre-extraction useApp.ts and
// unchanged by the move.

import type { BaselineOverlay, FitOverlay, PeakOverlay } from "../lib/types";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

/** A layer SLD handed from the calculators SLD tab to the reflectivity workshop
 *  (cross-panel hook). `sld` is in Å⁻² (the reflectivity layer unit — the SLD tab
 *  converts its ×10⁻⁶ Å⁻² display value). `label` is a short provenance note. */
export interface ReflectivitySeed {
  sld: number;
  label?: string;
}

/** The stat-stage pickers the Graph Builder hands over when it sends a box/violin
 *  spec to the stage (cross-panel hook, mirrors ReflectivitySeed). `useStatStage`
 *  consumes it once and clears it. `groupCol` = the categorical column to group
 *  by (null = per-plotted-channel fallback); `valueCol` = the value channel. */
export interface StatStageSeed {
  mode: "box" | "violin" | "bar";
  groupCol: number | null;
  valueCol: number;
  facetCol?: number | null; group2Col?: number | null; colorCol?: number | null; // #11 facet; P1.4 Color-by (lib/statColor)
}

/** Peak-workshop click-on-plot marker editing (interaction plan item 5) — the
 *  bridge PlotStage reads to wire `peakMarkerEditPlugin` (lib/peakMarkerHit.ts).
 *  Peak Analyzer or the simpler Peaks panel owns the candidate list and
 *  callbacks; this is only a THIN projection while one edit mode is live.
 *  The field/type retain their original wizard name for compatibility. Mirrors
 *  ReflectivitySeed/StatStageSeed's cross-panel-hook shape, generalized to a
 *  live bridge rather than a one-shot consume (closer in spirit to
 *  qfitRoi/onRoiChange, but the callbacks travel WITH the data since
 *  usePeakWizard — not the store — owns the compute). */
export interface PeakWizardEditBridge {
  markers: { index: number; center: number; height: number }[];
  addPeakAt: (x: number) => void;
  removePeak: (index: number) => void;
}

/** Anchor-point baseline click/drag editing (GOTO #2) — the bridge PlotStage
 *  reads to wire `anchorEditPlugin` (lib/uplotAnchors.ts). `useBaseline` owns
 *  the anchor list + mutators; published only while the workshop's "Anchor
 *  points" method is live, null otherwise. Anchors are (x, y) DATA coords.
 *  IDENTITY CONTRACT (MAIN #8f): published ONCE per activation and stable
 *  across edits — anchors flow through `getAnchors` (a ref read), because
 *  PlotViewport keys its uPlot-rebuild effect on this object's identity. */
export interface AnchorEditBridge {
  getAnchors: () => { index: number; x: number; y: number }[];
  addAnchor: (x: number, y: number) => void;
  moveAnchor: (index: number, x: number, y: number) => void;
  removeAnchor: (index: number) => void;
}

export interface WorkshopFlagsSlice {
  prefsOpen: boolean;
  cmdkOpen: boolean; curveFitOpen: boolean;
  hysteresisOpen: boolean; peaksOpen: boolean;
  reflectivityOpen: boolean;
  // A pending SLD layer seeded by the calculators SLD tab; consumed once by the
  // reflectivity workshop on open, then cleared (cross-panel hook).
  reflectivitySeed: ReflectivitySeed | null;
  baselineOpen: boolean; calculatorsOpen: boolean;
  magToolsOpen: boolean;
  rsmOpen: boolean; digitizerOpen: boolean;
  datasetMathOpen: boolean; tabulateOpen: boolean;
  distributionOpen: boolean;
  dataFilterOpen: boolean;
  statsChooserOpen: boolean; // the "which test?" front door (#26)
  peakWizardOpen: boolean; // the Peak Analyzer stepper (#31)
  importWizardOpen: boolean; // guess/preview/parse over a saved-filter (#40)
  pipelineOpen: boolean; // the editable pipeline view (#6)
  figureBuilderOpen: boolean;
  figurePageOpen: boolean; // the multi-panel figure page composer (GOTO #4)
  // One-shot pickers handed from the Graph Builder to the stat stage when a
  // box/violin spec is sent (consumed + cleared by useStatStage). null = none.
  statStageSeed: StatStageSeed | null;
  waterfallOpen: boolean;
  reflViewOpen: boolean;
  columnSwitcherOpen: boolean; // the JMP-style solo-a-channel flipper (#54)
  shortcutsOpen: boolean;
  textFormatHelpOpen: boolean; // Help ▸ Text formatting (GOTO #11)
  fitOverlay: FitOverlay | null;
  peakOverlay: PeakOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  // Peak wizard click-on-plot marker editing (item 5) — see PeakWizardEditBridge.
  peakWizardEdit: PeakWizardEditBridge | null;
  // Anchor-point baseline editing (GOTO #2) — see AnchorEditBridge.
  baselineAnchorEdit: AnchorEditBridge | null;
  mapMethod: string; // 2D-map regrid interpolation (natural/linear/nearest/idw)
  mapRes: number; // 2D-map grid resolution (nx = ny)
  // Interactive contour overlay (ORIGIN_GAP_PLAN #17 remaining half). Mirrors
  // the export side's `_contour_levels` semantics (calc/figure_map.py) so the
  // on-screen lines and the exported figure agree.
  contourOn: boolean;
  contourLevelCount: number;
  contourScale: "linear" | "log";

  setPrefsOpen: (open: boolean) => void;
  setCmdk: (open: boolean) => void;
  setCurveFitOpen: (open: boolean) => void;
  setHysteresisOpen: (open: boolean) => void;
  setPeaksOpen: (open: boolean) => void;
  setReflectivityOpen: (open: boolean) => void;
  // Send an SLD to the reflectivity workshop as a new layer + open it (SLD→refl).
  seedReflectivityLayer: (seed: ReflectivitySeed) => void;
  clearReflectivitySeed: () => void;
  setBaselineOpen: (open: boolean) => void;
  setCalculatorsOpen: (open: boolean) => void;
  setMagToolsOpen: (open: boolean) => void;
  setRsmOpen: (open: boolean) => void;
  setDigitizerOpen: (open: boolean) => void;
  setDatasetMathOpen: (open: boolean) => void;
  setTabulateOpen: (open: boolean) => void;
  setDistributionOpen: (open: boolean) => void;
  setDataFilterOpen: (open: boolean) => void;
  setStatsChooserOpen: (open: boolean) => void;
  setPeakWizardOpen: (open: boolean) => void;
  setImportWizardOpen: (open: boolean) => void;
  setPipelineOpen: (open: boolean) => void;
  setFigureBuilderOpen: (open: boolean) => void;
  setFigurePageOpen: (open: boolean) => void;
  // Send a box/violin Graph Builder spec to the stat stage: store the pickers +
  // switch statMode on; clearStatStageSeed drops the pending pickers once read.
  seedStatStage: (seed: StatStageSeed) => void;
  clearStatStageSeed: () => void;
  setWaterfallOpen: (open: boolean) => void;
  setReflViewOpen: (open: boolean) => void;
  setColumnSwitcherOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setTextFormatHelpOpen: (open: boolean) => void;
  setFitOverlay: (overlay: FitOverlay | null) => void;
  setPeakOverlay: (overlay: PeakOverlay | null) => void;
  setBaselineOverlay: (overlay: BaselineOverlay | null) => void;
  setPeakWizardEdit: (edit: PeakWizardEditBridge | null) => void;
  setBaselineAnchorEdit: (edit: AnchorEditBridge | null) => void;
  setMapMethod: (method: string) => void;
  setMapRes: (res: number) => void;
  setContourOn: (on: boolean) => void;
  setContourLevelCount: (n: number) => void;
  setContourScale: (scale: "linear" | "log") => void;
}

export function createWorkshopFlagsSlice(set: SliceSet): WorkshopFlagsSlice {
  return {
    prefsOpen: false,
    cmdkOpen: false,
    curveFitOpen: false,
    hysteresisOpen: false,
    peaksOpen: false,
    reflectivityOpen: false,
    reflectivitySeed: null,
    baselineOpen: false,
    calculatorsOpen: false,
    magToolsOpen: false,
    rsmOpen: false,
    digitizerOpen: false,
    datasetMathOpen: false,
    tabulateOpen: false,
    distributionOpen: false,
    dataFilterOpen: false,
    statsChooserOpen: false,
    peakWizardOpen: false,
    importWizardOpen: false,
    pipelineOpen: false,
    figureBuilderOpen: false,
    figurePageOpen: false,
    statStageSeed: null,
    waterfallOpen: false,
    reflViewOpen: false,
    columnSwitcherOpen: false,
    shortcutsOpen: false,
    textFormatHelpOpen: false,
    fitOverlay: null,
    peakOverlay: null,
    baselineOverlay: null,
    peakWizardEdit: null,
    baselineAnchorEdit: null,
    // 'linear' default: fast (~50 ms) and bit-exact MATLAB parity. 'natural'
    // (true Sibson) is correct but does a per-query Voronoi cavity walk (seconds
    // at 200²), so it's an opt-in quality choice, not the auto-open default.
    mapMethod: "linear",
    mapRes: 200,
    contourOn: false,
    contourLevelCount: 8,
    contourScale: "linear",

    setPrefsOpen: (prefsOpen) => set({ prefsOpen }),
    setCmdk: (cmdkOpen) => set({ cmdkOpen }),
    setCurveFitOpen: (curveFitOpen) => set({ curveFitOpen }),
    setHysteresisOpen: (hysteresisOpen) => set({ hysteresisOpen }),
    setPeaksOpen: (peaksOpen) => set({ peaksOpen }),
    setReflectivityOpen: (reflectivityOpen) => set({ reflectivityOpen }),
    seedReflectivityLayer: (reflectivitySeed) => set({ reflectivitySeed, reflectivityOpen: true }),
    clearReflectivitySeed: () => set({ reflectivitySeed: null }),
    setBaselineOpen: (baselineOpen) => set({ baselineOpen }),
    setCalculatorsOpen: (calculatorsOpen) => set({ calculatorsOpen }),
    setMagToolsOpen: (magToolsOpen) => set({ magToolsOpen }),
    setRsmOpen: (rsmOpen) => set({ rsmOpen }),
    setDigitizerOpen: (digitizerOpen) => set({ digitizerOpen }),
    setDatasetMathOpen: (datasetMathOpen) => set({ datasetMathOpen }),
    setTabulateOpen: (tabulateOpen) => set({ tabulateOpen }),
    setDistributionOpen: (distributionOpen) => set({ distributionOpen }),
    setDataFilterOpen: (dataFilterOpen) => set({ dataFilterOpen }),
    setStatsChooserOpen: (statsChooserOpen) => set({ statsChooserOpen }),
    setPeakWizardOpen: (peakWizardOpen) => set({ peakWizardOpen }),
    setImportWizardOpen: (importWizardOpen) => set({ importWizardOpen }),
    setPipelineOpen: (pipelineOpen) => set({ pipelineOpen }),
    setFigureBuilderOpen: (figureBuilderOpen) => set({ figureBuilderOpen }),
    setFigurePageOpen: (figurePageOpen) => set({ figurePageOpen }),
    seedStatStage: (statStageSeed) => set({ statStageSeed, statMode: true }),
    clearStatStageSeed: () => set({ statStageSeed: null }),
    setWaterfallOpen: (waterfallOpen) => set({ waterfallOpen }),
    setReflViewOpen: (reflViewOpen) => set({ reflViewOpen }),
    setColumnSwitcherOpen: (columnSwitcherOpen) => set({ columnSwitcherOpen }),
    setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
    setTextFormatHelpOpen: (textFormatHelpOpen) => set({ textFormatHelpOpen }),
    setFitOverlay: (fitOverlay) => set({ fitOverlay }),
    setPeakOverlay: (peakOverlay) => set({ peakOverlay }),
    setBaselineOverlay: (baselineOverlay) => set({ baselineOverlay }),
    setPeakWizardEdit: (peakWizardEdit) => set({ peakWizardEdit }),
    setBaselineAnchorEdit: (baselineAnchorEdit) => set({ baselineAnchorEdit }),
    setMapMethod: (mapMethod) => set({ mapMethod }),
    setMapRes: (mapRes) => set({ mapRes }),
    setContourOn: (contourOn) => set({ contourOn }),
    setContourLevelCount: (n) => set({ contourLevelCount: Math.max(2, Math.round(n)) }),
    setContourScale: (contourScale) => set({ contourScale }),
  };
}
