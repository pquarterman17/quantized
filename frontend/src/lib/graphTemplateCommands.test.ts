// Figures-audit B2: Stage graph templates + Copy/Paste Format (style only,
// never data) — between two plain CSV datasets, i.e. "generic" data.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadGraphTemplates, saveGraphTemplate } from "./figuredoc";
import { sanitizeGraphFormat } from "./graphFormat";
import {
  applyStageGraphTemplate,
  copyStageFormat,
  pasteStageFormat,
  resetCopiedFormatForTests,
  saveStageGraphTemplate,
} from "./graphTemplateCommands";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "./types";
import { askParams } from "../store/paramDialog";
import { useApp } from "../store/useApp";

vi.mock("../store/paramDialog", () => ({ askParams: vi.fn() }));

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
