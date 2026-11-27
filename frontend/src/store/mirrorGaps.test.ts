// Gaps left by the first mirror-column slice, through the REAL store: a
// categorical source's level table follows into the mirror (and a rename on the
// source reaches it), every edit entry point refuses a mirror with the same
// reason, and Go to Source in the window layout names the source's worksheet
// window.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { categoricalLevels } from "../lib/categorical";
import { loadFormulaExtension } from "../lib/formulaExt";
import { mirrorEditReason } from "../lib/mirrorColumn";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";
import { createMirror, detachMirror, goToMirrorSource } from "./mirrorColumn";
import { renameLevel } from "./levelRename";
import { useToasts } from "./toasts";
import { applySetColumnValues } from "./setColumnValuesRun";
import { pasteGrowing } from "./worksheetGrow";
import { setWorksheetWindowHandler } from "./worksheetOpen";
import { openWorksheetWindowFor } from "./windowLayoutWorksheet";
import { useWorksheetReveal } from "./worksheetReveal";

const base = (id: string, name: string, rows: number[][], labels: string[], over: Partial<Dataset["data"]> = {}): Dataset => ({
  id,
  name,
  data: { time: rows.map((_, i) => i), values: rows, labels, units: labels.map(() => ""), metadata: {}, ...over },
});
const st = () => useApp.getState();
const get = (id: string) => st().datasets.find((d) => d.id === id)!;
const WHY = "T (mirror) follows Run 2 > A: edit it there (Go to Source), or Detach to make it ordinary values";

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [
      base("src", "Run 2", [[10, 0], [20, 1], [30, 2]], ["T", "grade"], { cat_levels: { 1: ["lo", "hi", "mid"] } }),
      base("mir", "Summary", [[100], [200], [300]], ["Q"]),
    ],
    activeId: "mir",
    recalcMode: "auto",
    staleDatasets: [],
    staleFits: [],
    history: [],
    future: [],
    status: "",
    statusDanger: null,
    macroRecording: false,
    plotWindows: [],
    layoutMode: "classic",
  } as Partial<ReturnType<typeof useApp.getState>>);
  useToasts.setState({ toasts: [] });
  useWorksheetReveal.setState({ rowReveal: null });
});

describe("a categorical source column", () => {
  it("carries its level table into the mirror, so the mirror shows the same labels", () => {
    createMirror("mir", "src", 1);
    const mir = get("mir");
    expect(mir.data.labels).toEqual(["Q", "grade"]);
    expect(categoricalLevels(mir.data, 1)).toEqual(["lo", "hi", "mid"]);
    expect(categoricalLevels(mir.data, 0)).toBeNull();
    // A copy, not the source's array: editing one table can never edit the other.
    expect(mir.data.cat_levels![1]).not.toBe(get("src").data.cat_levels![1]);
  });

  it("follows a level rename on the source", async () => {
    createMirror("mir", "src", 1);
    expect(renameLevel("src", 1, 1, "high")).toBe(true);
    await vi.waitFor(() => expect(categoricalLevels(get("mir").data, 1)).toEqual(["lo", "high", "mid"]));
    expect(categoricalLevels(get("src").data, 1)).toEqual(["lo", "high", "mid"]);
  });

  it("follows a level added to the source", async () => {
    createMirror("mir", "src", 1);
    st().setCategoricalCell("src", 0, 1, "brand new");
    await vi.waitFor(() => expect(categoricalLevels(get("mir").data, 1)).toEqual(["lo", "hi", "mid", "brand new"]));
    expect(get("mir").data.values.map((r) => r[1])).toEqual([3, 1, 2]);
  });

  it("an ordinary numeric source gives the mirror no level table", () => {
    createMirror("mir", "src", 0);
    expect(get("mir").data.cat_levels).toBeUndefined();
  });

  it("a deleted source leaves a blank column and no stale table", () => {
    createMirror("mir", "src", 1);
    st().removeDataset("src");
    expect(categoricalLevels(get("mir").data, 1)).toBeNull();
  });
});

describe("every edit entry point refuses a mirror with the same reason", () => {
  const expectRefused = () => {
    expect(st().status).toBe(WHY);
    expect(useToasts.getState().toasts.map((t) => t.msg)).toContain(WHY);
  };
  const values = () => get("mir").data.values.map((r) => r[1]);

  beforeEach(() => void createMirror("mir", "src", 0));

  it("the reason names the mirror and its source", () => {
    expect(mirrorEditReason(get("mir"), 1)).toBe(WHY);
    expect(mirrorEditReason(get("mir"), 0)).toBeNull();
  });

  it("a cell edit", () => {
    st().setCellValue("mir", 0, 1, 5);
    expectRefused();
    expect(values()).toEqual([10, 20, 30]);
  });

  it("a block write aimed only at the mirror column", () => {
    st().setCellBlock("mir", [{ row: 0, col: 1, value: 5 }, { row: 1, col: 1, value: 6 }], "clear cells");
    expectRefused();
    expect(values()).toEqual([10, 20, 30]);
  });

  it("a paste that starts in the mirror column", () => {
    pasteGrowing("mir", "5\n6", 0, 1, [0, 1, 2], false);
    expectRefused();
    expect(values()).toEqual([10, 20, 30]);
  });

  it("Set Column Values replacing the mirror's formula", async () => {
    const r = await applySetColumnValues("mir", { target: { kind: "column", col: 1 }, name: "T", expr: "A * 2", range: { from: 1, to: 3 } });
    expect(r.ok).toBe(false);
    expectRefused();
    expect(get("mir").formulas![0].expr).toBe('sheet("Run 2", A)');
    expect(values()).toEqual([10, 20, 30]);
  });

  it("a rename or a unit change stays allowed", () => {
    expect(st().updateFormula("mir", 0, { name: "Temperature", unit: "mK" })).toBe(true);
    expect(get("mir").formulas![0]).toMatchObject({ name: "Temperature", unit: "mK", expr: 'sheet("Run 2", A)' });
  });
});

describe("Go to Source in the window layout", () => {
  it("names the source's worksheet window, opened for it", () => {
    createMirror("mir", "src", 1);
    useApp.setState({ layoutMode: "windows" } as Partial<ReturnType<typeof useApp.getState>>);
    const off = setWorksheetWindowHandler((intent) => void openWorksheetWindowFor(intent));
    goToMirrorSource("mir", 0, 2);
    off();
    const win = st().plotWindows.find((w) => w.kind === "worksheet" && w.datasetId === "src")!;
    expect(win).toBeDefined();
    expect(useWorksheetReveal.getState().rowReveal).toMatchObject({ datasetId: "src", windowId: win.id, column: 1, row: 2, selectColumn: true });
  });

  it("in the classic layout the request names no window (the Stage tab shows it)", () => {
    createMirror("mir", "src", 1);
    goToMirrorSource("mir", 0);
    expect(useWorksheetReveal.getState().rowReveal?.windowId).toBeUndefined();
    expect(st().worksheetId).toBe("src");
  });
});

describe("the recorder", () => {
  beforeEach(() => useApp.setState({ macroRecording: true, macroSteps: [] } as Partial<ReturnType<typeof useApp.getState>>));

  it("records Create as the addColumn it is, and Detach as qz.detachMirror with the column", () => {
    createMirror("mir", "src", 0);
    detachMirror("mir", 0);
    const steps = st().macroSteps.map((m) => m.code);
    expect(steps).toEqual([`qz.addColumn("T", ${JSON.stringify('sheet("Run 2", A)')})`, 'qz.detachMirror("Summary", 1)']);
  });

  it("records nothing for a Detach that was refused", () => {
    detachMirror("mir", 0); // no formulas on the sheet
    expect(st().macroSteps).toEqual([]);
  });
});
