// F4.4 SPATIAL half: a spatial multi-panel composition is captured by NAME
// (dataset name + column labels) and rebuilt against a later dataset, with
// a missing dataset/column named for the apply dialog to rebind.

import { describe, expect, it } from "vitest";

import { spatialComposition } from "./composition";
import type { SpatialPanel } from "./multipanel";
import { captureRecipe } from "./plotRecipe";
import { resolveRecipe } from "./plotRecipeMatch";
import { captureMapView, capturePanels, resolvePanels } from "./plotRecipePanels";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "./types";

function ds(id: string, name: string, labels = ["2theta", "Intensity", "Ierr"]): Dataset {
  return {
    id,
    name,
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels,
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
  };
}

const source = ds("d1", "scan.xy");
const other = ds("d2", "other.xy");

function twoPanels(): SpatialPanel[] {
  return [
    {
      datasetId: "d1",
      xKey: 0,
      yKeys: [1],
      xLim: [0, 40],
      yLim: [1, 1000],
      xLog: false,
      yLog: true,
      xStep: 10,
      seriesLabels: { 1: "I" },
      seriesStyles: { 1: { color: "#ff0000" } },
      errKeys: { 1: 2 },
      hiddenChannels: [2],
      row: 0,
      col: 0,
      frameRect: { left: 0, top: 0, width: 1, height: 0.5 },
      xAxisLabel: null,
      legendTitle: "top",
    },
    { datasetId: "d2", xKey: 0, yKeys: [1, 2], xLim: [5, 35], yLim: [0, 300], xLog: false, yLog: false, row: 1, col: 0 },
  ];
}

const view = { ...defaultPlotView(), xKey: 0, yKeys: [1], stackMode: true, panelFit: "window" as const };

describe("capturePanels", () => {
  it("names every panel by dataset (null = the recipe's own) and column label, keeping axis state and geometry", () => {
    const out = capturePanels(spatialComposition(twoPanels()), "d1", [source, other], view);
    expect(out?.panelFit).toBe("window");
    expect(out?.pageSetup).toBeNull();
    expect(out?.panels).toHaveLength(2);
    expect(out?.panels[0]).toEqual({
      dataset: null,
      x: "2theta",
      y: ["Intensity"],
      y2: [],
      xLim: [0, 40],
      yLim: [1, 1000],
      y2Lim: null,
      xStep: 10,
      yStep: null,
      y2Step: null,
      xLog: false,
      yLog: true,
      y2Log: false,
      xAxisLabel: null,
      legendTitle: "top",
      seriesStyles: { Intensity: { color: "#ff0000" } },
      seriesLabels: { Intensity: "I" },
      hiddenChannels: ["Ierr"],
      errKeys: { Intensity: "Ierr" },
      annotations: [],
      regionShades: [],
      row: 0,
      col: 0,
      frameRect: { left: 0, top: 0, width: 1, height: 0.5 },
    });
    expect(out?.panels[1]).toMatchObject({ dataset: "other.xy", y: ["Intensity", "Ierr"], row: 1 });
  });

  it("is null for a non-spatial composition, and drops a panel whose dataset is not listed", () => {
    expect(capturePanels(null, "d1", [source], view)).toBeNull();
    expect(capturePanels({ kind: "facet", panels: [] }, "d1", [source], view)).toBeNull();
    const out = capturePanels(spatialComposition(twoPanels()), "d1", [source], view);
    expect(out?.panels.map((p) => p.dataset)).toEqual([null]);
  });

  it("never shares style objects with the live panel", () => {
    const panels = twoPanels();
    const out = capturePanels(spatialComposition(panels), "d1", [source, other], view);
    expect(out?.panels[0].seriesStyles.Intensity).not.toBe(panels[0].seriesStyles?.[1]);
  });
});

describe("captureMapView", () => {
  it("records only a non-default map view", () => {
    expect(captureMapView(undefined)).toBeNull();
    expect(captureMapView({ colormap: "viridis", logZ: false, colorLimits: null, slices: [], annotations: [] })).toBeNull();
    expect(captureMapView({ colormap: "magma", logZ: true, colorLimits: [1, 100], slices: [], annotations: [] })).toEqual({
      colormap: "magma",
      logZ: true,
      colorLimits: [1, 100],
    });
  });
});

describe("resolvePanels", () => {
  const recipe = capturePanels(spatialComposition(twoPanels()), "d1", [source, other], view)!;

  it("rebuilds every panel against the target (self) and the named (other) dataset by label", () => {
    const target = ds("d3", "later.xy", ["Ierr", "Intensity", "2theta"]); // reordered columns
    const out = resolvePanels(recipe, target, { datasets: [target, other] });
    expect(out.unmatched).toEqual([]);
    expect(out.issues).toEqual([]);
    expect(out.panels?.panelFit).toBe("window");
    expect(out.panels?.panels[0]).toEqual({
      datasetId: "d3",
      xKey: 2,
      yKeys: [1],
      xLim: [0, 40],
      yLim: [1, 1000],
      xLog: false,
      yLog: true,
      xStep: 10,
      yStep: null,
      xAxisLabel: null,
      legendTitle: "top",
      seriesStyles: { 1: { color: "#ff0000" } },
      seriesLabels: { 1: "I" },
      hiddenChannels: [0],
      errKeys: { 1: 0 },
      annotations: [],
      regionShades: [],
      row: 0,
      col: 0,
      frameRect: { left: 0, top: 0, width: 1, height: 0.5 },
    });
    expect(out.panels?.panels[1]).toMatchObject({ datasetId: "d2", xKey: 0, yKeys: [1, 2], row: 1 });
  });

  it("names a missing dataset as an issue + unmatched field and drops that panel", () => {
    const target = ds("d3", "later.xy");
    const out = resolvePanels(recipe, target, { datasets: [target] });
    expect(out.unmatched).toEqual(['Panel 2 dataset ("other.xy")']);
    expect(out.issues).toEqual([{ panel: 1, kind: "dataset", name: "other.xy" }]);
    expect(out.panels?.panels.map((p) => p.datasetId)).toEqual(["d3"]);
  });

  it("an explicit dataset binding overrides the name lookup", () => {
    const target = ds("d3", "later.xy");
    const stand = ds("d9", "stand-in.xy");
    const out = resolvePanels(recipe, target, { datasets: [target, stand], panelBindings: { 1: { datasetId: "d9" } } });
    expect(out.issues).toEqual([]);
    expect(out.panels?.panels[1].datasetId).toBe("d9");
  });

  it("names a missing column as a channel issue, and an explicit channel binding resolves it", () => {
    const target = ds("d3", "later.xy", ["2theta", "Signal", "Ierr"]);
    const out = resolvePanels(recipe, target, { datasets: [target, other] });
    expect(out.unmatched).toEqual(['Panel 1 Y series ("Intensity")']);
    expect(out.issues).toEqual([{ panel: 0, kind: "channel", datasetId: "d3", role: "y", label: "Intensity" }]);
    // No Y left -> the panel is dropped, the other survives.
    expect(out.panels?.panels.map((p) => p.datasetId)).toEqual(["d2"]);
    const bound = resolvePanels(recipe, target, { datasets: [target, other], panelBindings: { 0: { channels: { Intensity: 1 } } } });
    expect(bound.unmatched).toEqual([]);
    expect(bound.panels?.panels[0]).toMatchObject({ datasetId: "d3", yKeys: [1], seriesLabels: { 1: "I" } });
  });

  it("is null with no resolvable panel at all", () => {
    const target = ds("d3", "later.xy", ["a", "b"]);
    const out = resolvePanels(recipe, target, { datasets: [target] });
    expect(out.panels).toBeNull();
    // Panel 1's X and Y, panel 2's dataset -- every miss is named, not just
    // the first per panel, so the dialog can offer a rebind for each.
    expect(out.unmatched).toHaveLength(3);
  });
});

describe("resolveRecipe carries panels + map through the ordinary resolution", () => {
  it("resolved.panels/map are present, panel misses count as unmatched, and a plain recipe has neither", () => {
    const recipe = captureRecipe(source, view, spatialComposition(twoPanels()), {
      id: "r1",
      name: "two",
      appVersion: "0",
      datasets: [source, other],
      mapView: { colormap: "gray", logZ: true, colorLimits: null, slices: [], annotations: [] },
    });
    expect(recipe.panels?.panels).toHaveLength(2);
    expect(recipe.map).toEqual({ colormap: "gray", logZ: true, colorLimits: null });

    const target = ds("d3", "later.xy");
    const clean = resolveRecipe(recipe, target, { datasets: [target, other] });
    if (!("resolved" in clean)) throw new Error(clean.refused);
    expect(clean.unmatched).toEqual([]);
    expect(clean.panelIssues).toEqual([]);
    expect(clean.resolved.panels?.panels).toHaveLength(2);
    expect(clean.resolved.map).toEqual(recipe.map);

    const staged = resolveRecipe(recipe, target, { datasets: [target] });
    if (!("resolved" in staged)) throw new Error(staged.refused);
    expect(staged.unmatched).toEqual(['Panel 2 dataset ("other.xy")']);
    expect(staged.panelIssues).toHaveLength(1);

    // Without a dataset list only the recipe's own dataset is reachable.
    const bare = resolveRecipe(recipe, target);
    if (!("resolved" in bare)) throw new Error(bare.refused);
    expect(bare.resolved.panels?.panels.map((p) => p.datasetId)).toEqual(["d3"]);

    const plain = captureRecipe(source, view, null, { id: "r2", name: "plain", appVersion: "0" });
    expect(plain.panels).toBeNull();
    expect(plain.map).toBeNull();
    const res = resolveRecipe(plain, target);
    if (!("resolved" in res)) throw new Error(res.refused);
    expect(res.resolved.panels).toBeNull();
    expect(res.resolved.map).toBeNull();
  });
});
