// Plan item 42 through the real entry points: Copy Format, "Paste format (choose parts)…", and a theme
// saved / applied from the graph-template commands. Two plain CSV datasets, the store as the user has it.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PARTS, FORMAT_PARTS } from "./formatParts";
import { loadGraphTemplates, saveGraphTemplate } from "./figuredoc";
import {
  applyGraphTemplateToGraphs, applyStageGraphTemplate, copyStageFormat, pasteStageFormat, pasteStageFormatParts, resetCopiedFormatForTests,
  saveStageGraphTemplate,
} from "./graphTemplateCommands";
import { setDefaultGraphTemplate } from "./defaultGraphTemplate";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";
import { askParams } from "../store/paramDialog";
import { useApp } from "../store/useApp";
import { newGraph, setNewGraphStyler } from "../store/windowDefaults";

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
/** The parts dialog's answer: exactly these ticked. */
const ticked = (...ids: string[]) => Object.fromEntries(FORMAT_PARTS.map((p) => [p.id, ids.includes(p.id)]));
const view = (): PlotView => defaultPlotView() && (Object.fromEntries(Object.keys(defaultPlotView()).map((k) => [k, s()[k as keyof PlotView]])) as unknown as PlotView);
const changedFields = (before: PlotView): string[] => {
  const after = view();
  return (Object.keys(after) as (keyof PlotView)[]).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])).sort();
};

beforeEach(() => {
  localStorage.clear();
  resetCopiedFormatForTests();
  setNewGraphStyler(null);
  vi.mocked(askParams).mockReset();
  useApp.setState({ ...defaultPlotView(), datasets: [csv("a", ["A", "B"]), csv("b", ["P", "Q", "R"])], activeId: "a", history: [], future: [], status: "" });
});

/** Style graph "a", copy its format, then switch to the plain "b" graph. */
function styleA(): void {
  useApp.setState({
    yScale: "log", xFmt: { mode: "sci", digits: 3, size: 15 }, axisLabelStyles: { x: { size: 20 } }, showGrid: false, xLim: [1, 9],
    seriesStyles: { 0: { color: "#ff0000", width: 3, marker: true, markerShape: "diamond" }, 1: { color: "#00ff00" } },
  });
}
function copyFromStyledA(): void {
  styleA();
  copyStageFormat(s);
  useApp.setState({ ...defaultPlotView(), activeId: "b", history: [], future: [] });
}

describe("Paste format (choose parts)…", () => {
  it("fonts and scales only: those fields change, field by field, and one Ctrl+Z restores them", async () => {
    copyFromStyledA();
    useApp.setState({ plotTitle: "B title", seriesStyles: { 0: { color: "#0000ff" } } });
    const before = view();
    vi.mocked(askParams).mockResolvedValueOnce(ticked("fontTicks", "fontTitles", "scalesX", "scalesY"));
    await pasteStageFormatParts(s);
    expect(changedFields(before)).toEqual(["axisLabelStyles", "xFmt", "yScale"]);
    expect(s().xFmt).toMatchObject({ mode: "sci", digits: 3, size: 15 });
    expect(s().axisLabelStyles).toEqual({ x: { size: 20 } });
    expect(s().seriesStyles).toEqual({ 0: { color: "#0000ff" } }); // colours not ticked
    expect(s().showGrid).toBe(true);
    expect(s().xLim).toBeNull(); // limits are never in a plain paste
    expect(s().plotTitle).toBe("B title");
    expect(s().history).toHaveLength(1);
    expect(s().status).toMatch(/4 parts applied/);
    s().undo();
    expect(changedFields(before)).toEqual([]);
  });

  it("dialog lists every part, 'everything' ticked and limits / background unticked", async () => {
    copyFromStyledA();
    vi.mocked(askParams).mockResolvedValueOnce(null);
    await pasteStageFormatParts(s);
    const fields = vi.mocked(askParams).mock.calls[0][1];
    expect(fields.map((f) => f.key)).toEqual(FORMAT_PARTS.map((p) => p.id));
    expect(fields.filter((f) => f.default === true).map((f) => f.key)).toEqual([...DEFAULT_PARTS]);
  });

  it("limits travel only when ticked, and Ctrl+Z restores them with the rest", async () => {
    copyFromStyledA();
    vi.mocked(askParams).mockResolvedValueOnce(ticked("scalesY", "limitsX"));
    await pasteStageFormatParts(s);
    expect(s().xLim).toEqual([1, 9]);
    expect(s().yScale).toBe("log");
    s().undo();
    expect(s().xLim).toBeNull();
    expect(s().yScale).toBe("linear");
  });

  it("Cancel, nothing copied and nothing ticked change nothing and record no undo step", async () => {
    await pasteStageFormatParts(s);
    expect(s().status).toMatch(/nothing copied/);
    copyFromStyledA();
    vi.mocked(askParams).mockResolvedValueOnce(null);
    await pasteStageFormatParts(s);
    vi.mocked(askParams).mockResolvedValueOnce(ticked());
    await pasteStageFormatParts(s);
    expect(s().status).toMatch(/no parts ticked/);
    expect(s().history).toHaveLength(0);
    expect(s().yScale).toBe("linear");
  });

  it("curve counts: a longer target keeps its own style past the format's last curve, and says so", async () => {
    copyFromStyledA(); // two styled curves
    useApp.setState({ seriesStyles: { 2: { color: "#222222" } } });
    vi.mocked(askParams).mockResolvedValueOnce(ticked("colorCurves"));
    await pasteStageFormatParts(s);
    expect(s().seriesStyles).toEqual({ 0: { color: "#ff0000" }, 1: { color: "#00ff00" }, 2: { color: "#222222" } });
    expect(s().status).toMatch(/1 of 3 curves/);
  });

  it("the page background is a part: set on the focused window, undone with the rest", async () => {
    s().addDataset(csv("w", ["A", "B"]));
    const win = () => s().plotWindows.find((w) => w.id === s().focusedWindowId)!;
    useApp.setState((st) => ({ plotWindows: st.plotWindows.map((w) => (w.id === st.focusedWindowId ? { ...w, bg: "dark" as const } : w)) }));
    copyStageFormat(s);
    useApp.setState((st) => ({ plotWindows: st.plotWindows.map((w) => (w.id === st.focusedWindowId ? { ...w, bg: "theme" as const } : w)), history: [], future: [] }));
    vi.mocked(askParams).mockResolvedValueOnce(ticked("colorBackground"));
    await pasteStageFormatParts(s);
    expect(win().bg).toBe("dark");
    s().undo();
    expect(win().bg).toBe("theme");
  });

  it("plain Paste Format is unchanged by the extras the clipboard now holds", () => {
    copyFromStyledA();
    pasteStageFormat(s);
    expect(s().yScale).toBe("log");
    expect(s().xLim).toBeNull();
  });
});

describe("themes", () => {
  it("saves only the chosen parts and applies only those", async () => {
    styleA();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Big fonts", parts: "Only chosen parts (a theme)…" }).mockResolvedValueOnce(ticked("fontTicks", "scalesX"));
    await saveStageGraphTemplate(s);
    const saved = loadGraphTemplates().find((t) => t.name === "Big fonts")!;
    expect(saved.parts).toEqual(["fontTicks", "scalesX"]);
    expect(saved.seriesStyles).toBeNull();

    useApp.setState({ ...defaultPlotView(), activeId: "b", history: [], future: [] });
    const before = view();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Big fonts" });
    await applyStageGraphTemplate(s);
    expect(changedFields(before)).toEqual(["xFmt"]);
    expect(s().xFmt).toMatchObject({ mode: "sci", size: 15 });
    expect(s().yScale).toBe("linear"); // scalesY not in the theme
    expect(s().seriesStyles).toEqual({});
    expect(s().history).toHaveLength(1);
  });

  it("choosing every default part saves an ordinary whole template, and Whole style saves one too", async () => {
    styleA();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "All", parts: "Only chosen parts (a theme)…" }).mockResolvedValueOnce(ticked(...DEFAULT_PARTS));
    await saveStageGraphTemplate(s);
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Whole", parts: "Whole style" });
    await saveStageGraphTemplate(s);
    for (const name of ["All", "Whole"]) expect(loadGraphTemplates().find((t) => t.name === name)?.parts).toBeUndefined();
  });

  it("a theme with a limits part applies the limits too", async () => {
    styleA();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Zoom", parts: "Only chosen parts (a theme)…" }).mockResolvedValueOnce(ticked("limitsX"));
    await saveStageGraphTemplate(s);
    useApp.setState({ ...defaultPlotView(), activeId: "b", history: [], future: [] });
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Zoom" });
    await applyStageGraphTemplate(s);
    expect(s().xLim).toEqual([1, 9]);
    s().undo();
    expect(s().xLim).toBeNull();
  });

  it("a saved theme survives a damaged parts list: unknown ids are ignored, none left = whole style", async () => {
    saveGraphTemplate({ name: "Odd", style: "default", overrides: null, seriesStyles: [{ color: "#00ff00", width: 2 }], parts: ["nope"] });
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Odd" });
    await applyStageGraphTemplate(s);
    expect(s().seriesStyles[0]).toEqual({ color: "#00ff00", width: 2 });
  });

  it("onto many graphs: the theme's parts only", async () => {
    styleA();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Y scale", parts: "Only chosen parts (a theme)…" }).mockResolvedValueOnce(ticked("scalesY"));
    await saveStageGraphTemplate(s);
    useApp.setState({ ...defaultPlotView(), activeId: "b", history: [], future: [] });
    s().addDataset(csv("c", ["X", "Y"]));
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Y scale", scope: "All open graphs" });
    await applyGraphTemplateToGraphs(s);
    expect(s().yScale).toBe("log");
    expect(s().xFmt).toEqual(defaultPlotView().xFmt);
  });

  it("as the default for new graphs, a theme seeds only its parts", async () => {
    styleA();
    vi.mocked(askParams).mockResolvedValueOnce({ name: "House", parts: "Only chosen parts (a theme)…" }).mockResolvedValueOnce(ticked("colorCurves", "fontTicks", "scalesY"));
    await saveStageGraphTemplate(s);
    setDefaultGraphTemplate("House");
    const fresh = newGraph(csv("n", ["X", "Y"]));
    expect(fresh.xFmt).toMatchObject({ size: 15, mode: "auto" }); // the tick size only, not the format
    expect(fresh.yScale).toBe("linear"); // a default template never seeds scales (lib/defaultGraphTemplate.ts)
    expect(fresh.seriesStyles[0]).toEqual({ color: "#ff0000" }); // colour only: width and marker not in the theme
    expect(fresh.axisLabelStyles).toEqual({});
    expect(fresh.xLim).toBeNull();
  });
});
