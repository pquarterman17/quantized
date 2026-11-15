// Gap-audit-2 #13: a graph template / Paste Format applied to every graph of
// a folder or the Library selection -- background windows included -- as ONE
// undo step.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveGraphTemplate } from "./figuredoc";
import { graphTargets } from "./graphFormatBulk";
import { applyGraphTemplateToGraphs, copyStageFormat, pasteFormatToGraphs, resetCopiedFormatForTests } from "./graphTemplateCommands";
import { captureGraphFormat } from "./graphFormat";
import type { Dataset } from "./types";
import { askParams } from "../store/paramDialog";
import { useApp } from "../store/useApp";
import { plotWindowView } from "../store/windowDocuments";

vi.mock("../store/paramDialog", () => ({ askParams: vi.fn() }));

const csv = (id: string, folderId?: string): Dataset => ({
  id,
  name: `${id}.csv`,
  ...(folderId ? { folderId } : {}),
  data: { time: [0, 1, 2], values: [[1, 2], [2, 3], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
});

const s = useApp.getState;
const FOLDER_SCOPE = "All graphs in this graph's folder";
const view = (id: string) => plotWindowView(s().plotWindows.find((w) => w.id === id)!);

let a = "", b = "", c = "";
beforeEach(() => {
  localStorage.clear();
  resetCopiedFormatForTests();
  vi.mocked(askParams).mockReset();
  useApp.setState({ datasets: [csv("da", "f1"), csv("db", "f1"), csv("dc", "f2")], plotWindows: [], focusedWindowId: null, history: [], future: [], status: "", selectedIds: [], librarySelection: null });
  c = s().createWindow("dc");
  b = s().createWindow("db");
  a = s().createWindow("da");
  s().focusWindow(a);
  useApp.setState({ history: [], future: [] });
});

describe("graph format on many graphs", () => {
  it("the folder scope is the focused graph's folder; the selection scope follows the Library", () => {
    expect(graphTargets(s(), "folder").map((t) => t.window.id)).toEqual([a, b]);
    expect(graphTargets(s(), "all")).toHaveLength(3);
    useApp.setState({ selectedIds: ["dc"] });
    expect(graphTargets(s(), "selection").map((t) => t.window.id)).toEqual([c]);
    useApp.setState({ selectedIds: [], librarySelection: { kind: "folder", id: "f1" } });
    expect(graphTargets(s(), "selection").map((t) => t.window.id)).toEqual([a, b]);
  });

  it("Paste Format restyles the focused AND a background graph of the folder, in one undo step", async () => {
    useApp.setState({ yScale: "log", yFmt: { mode: "auto", digits: 2, reverse: true }, seriesStyles: { 0: { color: "#ff0000" } } });
    copyStageFormat(s);
    useApp.setState({ yScale: "linear", yFmt: { mode: "auto", digits: 2 }, seriesStyles: {} });
    vi.mocked(askParams).mockResolvedValueOnce({ scope: FOLDER_SCOPE });
    await pasteFormatToGraphs(s);
    expect(s().history).toHaveLength(1);
    expect(s().yScale).toBe("log");
    expect(view(b).yScale).toBe("log");
    expect(view(b).yFmt.reverse).toBe(true);
    expect(view(b).seriesStyles[0]).toEqual({ color: "#ff0000" });
    expect(view(c).yScale).toBe("linear"); // another folder: untouched
    s().undo();
    expect(view(b).yScale).toBe("linear");
    expect(s().yScale).toBe("linear");
  });

  it("a template reaches every open graph with the 'all' scope", async () => {
    saveGraphTemplate({ name: "Paper", style: "default", overrides: null, seriesStyles: [], format: { ...captureGraphFormat({ ...s(), showGrid: false }, [0, 1]) } });
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Paper", scope: "All open graphs" });
    await applyGraphTemplateToGraphs(s);
    expect([s().showGrid, view(b).showGrid, view(c).showGrid]).toEqual([false, false, false]);
    expect(s().history).toHaveLength(1);
    expect(s().status).toMatch(/3 graphs restyled/);
  });
});
