// Figures-audit B2: Stage graph templates + Copy/Paste Format (style only,
// never data) — between two plain CSV datasets, i.e. "generic" data.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDefaultGraphTemplateName, setDefaultGraphTemplate } from "./defaultGraphTemplate";
import { loadGraphTemplates, saveGraphTemplate } from "./figuredoc";
import { sanitizeGraphFormat } from "./graphFormat";
import {
  applyStageGraphTemplate,
  copyStageFormat,
  pasteStageFormat,
  resetCopiedFormatForTests,
  saveStageGraphTemplate,
  setStageGraphAsDefault,
} from "./graphTemplateCommands";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "./types";
import { askParams } from "../store/paramDialog";
import { useApp } from "../store/useApp";
import { askConfirm } from "../store/confirmDialog";
import { newGraph, setNewGraphStyler, templateSeeds } from "../store/windowDefaults";
import { windowHasUserEdits } from "../store/windowUserEdits";

vi.mock("../store/paramDialog", () => ({ askParams: vi.fn() }));
vi.mock("../store/confirmDialog", () => ({ askConfirm: vi.fn() }));

function csv(id: string, labels: string[]): Dataset {
  return {
    id,
    name: `${id}.csv`,
    data: { time: [0, 1, 2], values: [[1, 2, 3], [2, 3, 4], [3, 4, 5]].map((r) => r.slice(0, labels.length)), labels, units: labels.map(() => ""), metadata: {} },
  };
}

const s = useApp.getState;

beforeEach(() => {
  localStorage.clear();
  resetCopiedFormatForTests();
  vi.mocked(askParams).mockReset();
  vi.mocked(askConfirm).mockReset();
  useApp.setState({
    ...defaultPlotView(),
    datasets: [csv("a", ["A", "B"]), csv("b", ["P", "Q", "R"])],
    activeId: "a",
    history: [],
    future: [],
    status: "",
  });
});

/** Style the "a" graph, then switch the live graph to the unstyled "b". */
function styleThenSwitch(): void {
  useApp.setState({ seriesStyles: { 0: { color: "#ff0000", width: 3 }, 1: { marker: true, markerShape: "diamond" } }, yScale: "log", showGrid: false });
}
function switchToB(): void {
  useApp.setState({ ...defaultPlotView(), activeId: "b" });
}

describe("Copy Format / Paste Format", () => {
  it("pastes style (series by position + axis chrome) onto another dataset's graph, as one undo step", () => {
    styleThenSwitch();
    copyStageFormat(s);
    switchToB();
    pasteStageFormat(s);
    expect(s().seriesStyles).toEqual({ 0: { color: "#ff0000", width: 3 }, 1: { marker: true, markerShape: "diamond" } });
    expect(s().yScale).toBe("log");
    expect(s().showGrid).toBe(false);
    expect(s().yKeys).toBeNull(); // data binding untouched
    expect(s().history).toHaveLength(1);
  });

  it("Paste Format with nothing copied says so and changes nothing", () => {
    pasteStageFormat(s);
    expect(s().status).toMatch(/nothing copied/);
    expect(s().history).toHaveLength(0);
  });
});

describe("Stage graph templates", () => {
  it("save on one CSV, apply on another", async () => {
    styleThenSwitch();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Lab style" });
    await saveStageGraphTemplate(s);
    const saved = loadGraphTemplates().find((t) => t.name === "Lab style");
    expect(sanitizeGraphFormat(saved?.format)?.series).toHaveLength(2);

    switchToB();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Lab style" });
    await applyStageGraphTemplate(s);
    expect(s().seriesStyles[0]).toEqual({ color: "#ff0000", width: 3 });
    expect(s().seriesStyles[1]).toEqual({ marker: true, markerShape: "diamond" });
    expect(s().yScale).toBe("log");
    expect(s().status).toMatch(/applied/);
  });

  it("applies a Publication-preview template that has no Stage format, from its series styles", async () => {
    saveGraphTemplate({ name: "Old", style: "default", overrides: null, seriesStyles: [{ color: "#00ff00", width: 2 }] });
    switchToB();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Old" });
    await applyStageGraphTemplate(s);
    expect(s().seriesStyles[0]).toEqual({ color: "#00ff00", width: 2 });
  });

  it("with no saved templates, Apply explains instead of opening an empty picker", async () => {
    await applyStageGraphTemplate(s);
    expect(askParams).not.toHaveBeenCalled();
    expect(s().status).toMatch(/no saved templates/);
  });
});

// Gap audit 5 #1: Plot ▸ "Set as Default for New Graphs…".
describe("Set as Default for New Graphs", () => {
  afterEach(() => setNewGraphStyler(null));

  it("saves this graph's style as a template and makes it the default for new graphs", async () => {
    styleThenSwitch();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "House" });
    await setStageGraphAsDefault(s);
    expect(vi.mocked(askParams).mock.calls[0][1][0]).toMatchObject({ default: "Default graph" });
    expect(loadGraphTemplates().map((t) => t.name)).toContain("House");
    expect(loadDefaultGraphTemplateName()).toBe("House");
    expect(newGraph(csv("c", ["X", "Y"])).seriesStyles[0]).toEqual({ color: "#ff0000", width: 3 });
    expect(s().status).toMatch(/new graphs open with it/);
  });

  it("does nothing on Cancel, or without a plotted dataset", async () => {
    vi.mocked(askParams).mockResolvedValueOnce(null);
    await setStageGraphAsDefault(s);
    expect(loadDefaultGraphTemplateName()).toBeNull();
    useApp.setState({ activeId: null });
    await setStageGraphAsDefault(s);
    expect(askParams).toHaveBeenCalledTimes(1);
    expect(loadGraphTemplates()).toEqual([]);
  });

  /** A fresh store with one imported, focused graph of "a". */
  function importA(): void {
    templateSeeds.clear();
    useApp.setState(useApp.getInitialState(), true);
    s().addDataset(csv("a", ["A", "B"]));
  }
  const focusedWin = () => s().plotWindows.find((w) => w.id === s().focusedWindowId)!;

  it("review F1: the source graph stays protected, so the next import opens a new window", async () => {
    importA();
    useApp.setState({ plotTemplate: "aps", seriesStyles: { 0: { color: "#000080", width: 3 } } });
    const source = s().focusedWindowId;
    vi.mocked(askParams).mockResolvedValueOnce({ name: "House" });
    await setStageGraphAsDefault(s);
    expect(windowHasUserEdits(s(), focusedWin())).toBe(true);
    s().addDataset(csv("b", ["P", "Q"]));
    expect(s().plotWindows).toHaveLength(2);
    expect(s().plotWindows.find((w) => w.id === source)?.datasetId).toBe("a");
  });

  it("review F1: a source that was itself a templated new graph stays protected too", async () => {
    importA();
    saveGraphTemplate({ name: "House", style: "default", overrides: null, seriesStyles: null, format: { version: 1, series: [{ color: "#000080" }], plotTemplate: "aps" } });
    setDefaultGraphTemplate("House");
    s().setPlotTitle("t"); // the startup graph is edited, so the import opens a NEW templated graph
    s().addDataset(csv("b", ["P", "Q"]));
    const seeded = s().focusedWindowId!;
    expect(templateSeeds.has(seeded)).toBe(true);
    vi.mocked(askParams).mockResolvedValueOnce({ name: "House 2" });
    await setStageGraphAsDefault(s);
    expect(templateSeeds.has(seeded)).toBe(false);
    s().addDataset(csv("c", ["X", "Y"]));
    expect(s().plotWindows.find((w) => w.id === seeded)?.datasetId).toBe("b");
  });

  it("review F9: asks before replacing a saved template, and keeps it on No", async () => {
    styleThenSwitch();
    saveGraphTemplate({ name: "Default graph", style: "keep", overrides: null, seriesStyles: null });
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Default graph" });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await setStageGraphAsDefault(s);
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(loadGraphTemplates().find((t) => t.name === "Default graph")?.style).toBe("keep");
    expect(loadDefaultGraphTemplateName()).toBeNull();
  });
});
