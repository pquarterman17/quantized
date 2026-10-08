// Characterization tests for the WORKSHOP FLAGS domain (audit P4.1, the
// SIXTH store/useApp.ts domain): every workshop/dialog open flag, the two
// one-shot cross-panel seeds (`reflectivitySeed`, `statStageSeed`), the three
// on-plot overlays, the two plot-edit bridges, and the 2-D map/contour
// settings — 38 fields, 40 actions, none of which writes `datasets` or
// records history.
//
// What each spec pins: the EXACT set of top-level store keys a call changes,
// diffing the WHOLE `getState()` snapshot by identity against a POISONED
// baseline (every domain field seeded to a non-default value first, so a
// write that "resets" a field to its default still shows up). The same
// harness as macroPipeline.characterization.test.ts. A recordHistory call
// would show up here as a changed history key, so "writes ONLY x" also
// proves "records no undo step".
//
// Written and run GREEN against the pre-extraction useApp.ts; it imports only
// `./useApp`, so nothing here may change when the domain moves out.

import { beforeEach, describe, expect, it } from "vitest";

import type { AppState } from "./useApp";
import { useApp } from "./useApp";

type Snap = Record<string, unknown>;

const snapshot = (): Snap => ({ ...(useApp.getState() as unknown as Snap) });

/** Top-level store keys whose value changed identity, sorted. */
function changedSince(before: Snap): string[] {
  const after = useApp.getState() as unknown as Snap;
  return Object.keys(after)
    .filter((k) => after[k] !== before[k])
    .sort();
}

const act = (): AppState => useApp.getState();

// [action, field] for every plain boolean open-flag setter.
const FLAG_SETTERS: [keyof AppState, keyof AppState][] = [
  ["setPrefsOpen", "prefsOpen"],
  ["setCmdk", "cmdkOpen"],
  ["setCurveFitOpen", "curveFitOpen"],
  ["setHysteresisOpen", "hysteresisOpen"],
  ["setPeaksOpen", "peaksOpen"],
  ["setReflectivityOpen", "reflectivityOpen"],
  ["setBaselineOpen", "baselineOpen"],
  ["setCalculatorsOpen", "calculatorsOpen"],
  ["setMagToolsOpen", "magToolsOpen"],
  ["setRsmOpen", "rsmOpen"],
  ["setDigitizerOpen", "digitizerOpen"],
  ["setDatasetMathOpen", "datasetMathOpen"],
  ["setTabulateOpen", "tabulateOpen"],
  ["setDistributionOpen", "distributionOpen"],
  ["setSignalProcessingOpen", "signalProcessingOpen"],
  ["setDataFilterOpen", "dataFilterOpen"],
  ["setStatsChooserOpen", "statsChooserOpen"],
  ["setPeakWizardOpen", "peakWizardOpen"],
  ["setImportWizardOpen", "importWizardOpen"],
  ["setPipelineOpen", "pipelineOpen"],
  ["setFigureBuilderOpen", "figureBuilderOpen"],
  ["setFigurePageOpen", "figurePageOpen"],
  ["setWaterfallOpen", "waterfallOpen"],
  ["setReflViewOpen", "reflViewOpen"],
  ["setColumnSwitcherOpen", "columnSwitcherOpen"],
  ["setShortcutsOpen", "shortcutsOpen"],
  ["setTextFormatHelpOpen", "textFormatHelpOpen"],
];

const ov = (tag: string) => ({ datasetId: `ds-${tag}`, y: [1, null, 3] });
const peakEdit = () => ({ markers: [{ index: 0, center: 1, height: 2 }], addPeakAt: () => {}, removePeak: () => {} });
const anchorEdit = () => ({ getAnchors: () => [], addAnchor: () => {}, moveAnchor: () => {}, removeAnchor: () => {} });

// [action, field, factory] for every nullable-object setter (overlays + bridges).
const OBJECT_SETTERS: [keyof AppState, keyof AppState, () => unknown][] = [
  ["setFitOverlay", "fitOverlay", () => ov("fit")],
  ["setPeakOverlay", "peakOverlay", () => ov("peak")],
  ["setBaselineOverlay", "baselineOverlay", () => ov("base")],
  ["setPeakWizardEdit", "peakWizardEdit", peakEdit],
  ["setBaselineAnchorEdit", "baselineAnchorEdit", anchorEdit],
];

/** POISON every domain field to a non-default value. Booleans go `true`
 *  (default false); objects get a stale instance; map/contour settings get
 *  values no spec writes. Each spec arranges its own starting value where the
 *  call targets a hardcoded value, so a no-op write is told apart. */
function poison(): void {
  const flags = Object.fromEntries(FLAG_SETTERS.map(([, f]) => [f, true]));
  const objects = Object.fromEntries(OBJECT_SETTERS.map(([, f, mk]) => [f, mk()]));
  useApp.setState({
    ...flags,
    ...objects,
    reflectivitySeed: { sld: 9.9e-6, label: "STALE" },
    statStageSeed: { mode: "violin", groupCol: 7, valueCol: 8 },
    mapMethod: "STALE",
    mapRes: 17,
    contourOn: true,
    contourLevelCount: 3,
    contourScale: "log",
  } as Partial<AppState>);
}

beforeEach(() => {
  poison();
});

describe("initial state (moves with the slice)", () => {
  it("every domain field starts at its pre-extraction default", () => {
    const init = useApp.getInitialState();
    for (const [, f] of FLAG_SETTERS) expect(init[f], f).toBe(false);
    for (const [, f] of OBJECT_SETTERS) expect(init[f], f).toBeNull();
    expect(init.reflectivitySeed).toBeNull();
    expect(init.statStageSeed).toBeNull();
    expect(init.mapMethod).toBe("linear");
    expect(init.mapRes).toBe(200);
    expect(init.contourOn).toBe(false);
    expect(init.contourLevelCount).toBe(8);
    expect(init.contourScale).toBe("linear");
  });
});

describe("boolean open-flag setters", () => {
  it.each(FLAG_SETTERS)("%s(false) writes ONLY %s", (action, field) => {
    const before = snapshot();
    (act()[action] as (v: boolean) => void)(false);
    expect(changedSince(before)).toEqual([field]);
    expect(act()[field]).toBe(false);
  });

  it.each(FLAG_SETTERS)("%s(true) from false writes ONLY %s", (action, field) => {
    useApp.setState({ [field]: false } as Partial<AppState>);
    const before = snapshot();
    (act()[action] as (v: boolean) => void)(true);
    expect(changedSince(before)).toEqual([field]);
    expect(act()[field]).toBe(true);
  });

  it.each(FLAG_SETTERS)("%s with the current value: no observable diff", (action) => {
    const before = snapshot();
    (act()[action] as (v: boolean) => void)(true); // poisoned to true already
    expect(changedSince(before)).toEqual([]);
  });
});

describe("overlay + bridge setters", () => {
  it.each(OBJECT_SETTERS)("%s(obj) stores that exact object and writes ONLY %s", (action, field, mk) => {
    const next = mk();
    const before = snapshot();
    (act()[action] as (v: unknown) => void)(next);
    expect(changedSince(before)).toEqual([field]);
    expect(act()[field]).toBe(next);
  });

  it.each(OBJECT_SETTERS)("%s(null) clears and writes ONLY %s", (action, field) => {
    const before = snapshot();
    (act()[action] as (v: unknown) => void)(null);
    expect(changedSince(before)).toEqual([field]);
    expect(act()[field]).toBeNull();
  });
});

describe("reflectivity seed", () => {
  it("seedReflectivityLayer stores the seed AND opens the workshop", () => {
    useApp.setState({ reflectivityOpen: false });
    const seed = { sld: 2.07e-6, label: "Si" };
    const before = snapshot();
    act().seedReflectivityLayer(seed);
    expect(changedSince(before)).toEqual(["reflectivityOpen", "reflectivitySeed"]);
    expect(act().reflectivitySeed).toBe(seed);
    expect(act().reflectivityOpen).toBe(true);
  });

  it("seedReflectivityLayer with the workshop already open: only the seed changes", () => {
    const before = snapshot();
    act().seedReflectivityLayer({ sld: 1e-6 });
    expect(changedSince(before)).toEqual(["reflectivitySeed"]);
  });

  it("clearReflectivitySeed nulls the seed only (the workshop stays open)", () => {
    const before = snapshot();
    act().clearReflectivitySeed();
    expect(changedSince(before)).toEqual(["reflectivitySeed"]);
    expect(act().reflectivitySeed).toBeNull();
    expect(act().reflectivityOpen).toBe(true);
  });
});

describe("stat-stage seed", () => {
  it("seedStatStage stores the seed AND turns statMode on, with no undo step", () => {
    useApp.setState({ statMode: false });
    const seed = { mode: "box" as const, groupCol: 1, valueCol: 2 };
    const before = snapshot();
    act().seedStatStage(seed);
    expect(changedSince(before)).toEqual(["statMode", "statStageSeed"]);
    expect(act().statStageSeed).toBe(seed);
    expect(act().statMode).toBe(true);
  });

  it("seedStatStage with statMode already on: only the seed changes", () => {
    useApp.setState({ statMode: true });
    const before = snapshot();
    act().seedStatStage({ mode: "bar", groupCol: null, valueCol: 0 });
    expect(changedSince(before)).toEqual(["statStageSeed"]);
  });

  it("clearStatStageSeed nulls the seed only (statMode untouched)", () => {
    useApp.setState({ statMode: true });
    const before = snapshot();
    act().clearStatStageSeed();
    expect(changedSince(before)).toEqual(["statStageSeed"]);
    expect(act().statStageSeed).toBeNull();
  });
});

describe("map + contour settings", () => {
  it("setMapMethod stores the string verbatim and writes ONLY mapMethod", () => {
    const before = snapshot();
    act().setMapMethod("natural");
    expect(changedSince(before)).toEqual(["mapMethod"]);
    expect(act().mapMethod).toBe("natural");
  });

  it("setMapRes stores the number verbatim (no clamp) and writes ONLY mapRes", () => {
    const before = snapshot();
    act().setMapRes(0.5);
    expect(changedSince(before)).toEqual(["mapRes"]);
    expect(act().mapRes).toBe(0.5);
  });

  it("setContourOn(false) writes ONLY contourOn", () => {
    const before = snapshot();
    act().setContourOn(false);
    expect(changedSince(before)).toEqual(["contourOn"]);
    expect(act().contourOn).toBe(false);
  });

  it("setContourScale writes ONLY contourScale", () => {
    const before = snapshot();
    act().setContourScale("linear");
    expect(changedSince(before)).toEqual(["contourScale"]);
    expect(act().contourScale).toBe("linear");
  });

  it.each([
    [7.4, 7],
    [7.5, 8],
    [4.5, 5],
    [1, 2],
    [-5, 2],
    [40, 40],
  ])("setContourLevelCount(%s) rounds then floors at 2 -> %s, writing ONLY contourLevelCount", (n, want) => {
    const before = snapshot();
    act().setContourLevelCount(n);
    expect(changedSince(before)).toEqual(["contourLevelCount"]);
    expect(act().contourLevelCount).toBe(want);
  });

  it("setContourLevelCount(NaN) stores NaN (Math.max does not clamp NaN; pinned as-is)", () => {
    act().setContourLevelCount(Number.NaN);
    expect(act().contourLevelCount).toBeNaN();
  });

  it("setContourLevelCount landing on the current value: no observable diff", () => {
    const before = snapshot();
    act().setContourLevelCount(3.2); // poisoned to 3
    expect(changedSince(before)).toEqual([]);
  });
});
