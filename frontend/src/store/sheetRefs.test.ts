// Cross-worksheet formula links through the REAL store (lib/sheetRefs.ts):
// `sheet("Name", A)` is bound to a worksheet by id, and that link survives —
// or visibly breaks — under every edit that used to silently re-point it.

import { beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../lib/formulaExt";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { mergeWorkspace } from "../lib/workspaceMerge";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

const ds = (id: string, name: string, values: number[], over: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: { time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["v"], units: [""], metadata: {} },
  ...over,
});
const st = () => useApp.getState();
const get = (id: string) => st().datasets.find((d) => d.id === id)!;
const column = (id: string, c: number) => get(id).data.values.map((r) => r[c]);

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [ds("t", "Target", [1, 2, 3]), ds("r", "Reader", [10, 20, 30])],
    activeId: "r",
    recalcMode: "auto",
    staleDatasets: [],
    staleFits: [],
    history: [],
    future: [],
    status: "",
    macroRecording: false,
  });
});

describe("1 — a column removed from the referenced worksheet", () => {
  it("the reader's letter follows its column; a reference to the removed column itself is an explicit error", () => {
    expect(st().addFormula("t", "double", "A * 2")).toBe(true); // B
    expect(st().addFormula("t", "triple", "A * 3")).toBe(true); // C
    expect(st().addFormula("r", "viaC", 'sheet("Target", C)')).toBe(true);
    expect(st().addFormula("r", "viaB", 'sheet("Target", B)')).toBe(true);
    expect(column("r", 1)).toEqual([3, 6, 9]);

    st().removeFormula("t", 0); // remove "double": "triple" slides from C to B
    expect(get("r").formulas!.map((f) => f.expr)).toEqual(['sheet("Target", B)', 'sheet("Target", __removed__)']);
    expect(column("r", 1)).toEqual([3, 6, 9]); // still "triple", NOT whatever now sits at C
    expect(column("r", 2)).toEqual([Number.NaN, Number.NaN, Number.NaN]);
    expect(get("r").formulaErrors).toEqual({ viaB: 'the column this formula read in worksheet "Target" was removed' });
    st().undo();
    expect(get("r").formulas!.map((f) => f.expr)).toEqual(['sheet("Target", C)', 'sheet("Target", B)']);
  });
});

describe("2 — rename and delete of the referenced worksheet", () => {
  it("a rename keeps the link and updates the formula text; values still follow the worksheet", async () => {
    st().addFormula("r", "f", 'sheet("Target", A) + 1');
    st().renameDataset("t", "Run 7");
    expect(get("r").formulas![0]).toMatchObject({ expr: 'sheet("Run 7", A) + 1', sheets: [{ name: "Run 7", id: "t" }] });
    st().setRecalcMode("manual");
    st().setCellValue("t", 0, 0, 100);
    expect(st().staleDatasets).toContain("r");
    await st().recalcNow();
    expect(column("r", 1)).toEqual([101, 3, 4]);
  });

  it("a delete cuts the link: the column errors, and a NEW worksheet with the old name is not picked up", () => {
    st().addFormula("r", "f", 'sheet("Target", A) + 1');
    st().removeDataset("t");
    expect(get("r").formulas![0].sheets).toEqual([{ name: "Target", id: null }]);
    expect(get("r").formulaErrors?.f).toMatch(/worksheet "Target" was removed/);
    expect(column("r", 1)).toEqual([Number.NaN, Number.NaN, Number.NaN]);
    st().addDataset(ds("impostor", "Target", [7, 7, 7]));
    st().setCellValue("r", 0, 0, 11); // any recompute of the reader
    expect(get("r").formulaErrors?.f).toMatch(/worksheet "Target" was removed/);
    expect(column("r", 1)).toEqual([Number.NaN, Number.NaN, Number.NaN]);
  });
});

describe("the link is saved with the project", () => {
  it("round-trips { name, id } through the .dwk, dropping a malformed entry", () => {
    st().addFormula("r", "f", 'sheet("Target", A)');
    const doc = JSON.parse(serializeWorkspace({ datasets: st().datasets })) as { datasets: { id: string; formulas: { sheets: unknown[] }[] }[] };
    const saved = doc.datasets.find((d) => d.id === "r")!.formulas[0];
    expect(saved.sheets).toEqual([{ name: "Target", id: "t" }]);
    saved.sheets.push({ name: 5, id: "x" });
    const [, reader] = parseWorkspace(JSON.stringify(doc)).datasets;
    expect(reader.formulas![0].sheets).toEqual([{ name: "Target", id: "t" }]);
  });
});

describe("3 — Append Project", () => {
  it("remaps links through the append's id table, and cuts (and counts) one whose target did not come along", () => {
    const incoming = [
      ds("t", "Target", [1, 2, 3]),
      ds("r", "Reader", [0, 0, 0], {
        formulas: [
          { name: "in", expr: 'sheet("Target", A)', sheets: [{ name: "Target", id: "t" }] },
          { name: "out", expr: 'sheet("Elsewhere", A)', sheets: [{ name: "Elsewhere", id: "not-in-file" }] },
        ],
      }),
    ];
    let n = 0;
    const merged = mergeWorkspace(st().datasets, { datasets: incoming, workbooks: [] } as never, () => `new-${++n}`, new Set(), () => "wb", []);
    const reader = merged.datasets.find((d) => d.name.startsWith("Reader") && d.formulas)!;
    const target = merged.datasets.find((d) => d.id !== "t" && d.name.startsWith("Target"))!;
    expect(reader.formulas![0].sheets).toEqual([{ name: "Target", id: target.id }]); // the APPENDED Target, not the existing "t"
    expect(reader.formulas![1].sheets).toEqual([{ name: "Elsewhere", id: null }]);
    expect(merged.droppedSheetRefs).toBe(1);
  });
});

describe("4 — circular and self references", () => {
  it("refuses a worksheet reading itself, and a chain that closes a circle, with zero mutation", () => {
    expect(st().addFormula("r", "self", 'sheet("Reader", A)')).toBe(false);
    expect(st().status).toMatch(/cannot read itself through sheet\("Reader", …\)/);
    expect(st().addFormula("r", "f", 'sheet("Target", A)')).toBe(true);
    expect(st().addFormula("t", "back", 'sheet("Reader", B)')).toBe(false);
    expect(st().status).toMatch(/Can't add column "back": This would create a circular dependency: .*Target.*Reader.*Target/);
    expect(get("t").formulas).toBeUndefined();
    // Editing an existing column into a circle is refused the same way.
    expect(st().addFormula("t", "plain", "A + 1")).toBe(true);
    expect(st().updateFormula("t", 0, { expr: 'sheet("Reader", B)' })).toBe(false);
    expect(get("t").formulas![0].expr).toBe("A + 1");
  });
});

describe("5 — ambiguous names and lazy books", () => {
  it("refuses a name two worksheets share, and a worksheet that has not loaded its full data", () => {
    useApp.setState((s) => ({ datasets: [...s.datasets, ds("t2", "Target", [9, 9, 9])] }));
    expect(st().addFormula("r", "f", 'sheet("Target", A)')).toBe(false);
    expect(st().status).toMatch(/"Target" names 2 worksheets, so sheet\("Target", …\) is ambiguous — rename one of them first/);
    st().renameDataset("t2", "Lazy");
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "t2" ? { ...d, pending: { kind: "path", path: "/b.opj", bookId: "B", rows: 300, cols: 1 } } : d)),
    }));
    expect(st().addFormula("r", "g", 'sheet("Lazy", A)')).toBe(false);
    expect(st().status).toMatch(/"Lazy" has not loaded its full data yet/);
    expect(st().addFormula("r", "f", 'sheet("Target", A)')).toBe(true); // unambiguous now
    expect(get("r").formulas![0].sheets).toEqual([{ name: "Target", id: "t" }]);
  });

  it("an edit keeps a name on the worksheet it was linked to, even once the name has become ambiguous", () => {
    st().addFormula("r", "f", 'sheet("Target", A)');
    useApp.setState((s) => ({ datasets: [...s.datasets, ds("t2", "Target", [9, 9, 9])] }));
    expect(st().updateFormula("r", 0, { expr: 'sheet("Target", A) * 2' })).toBe(true);
    expect(get("r").formulas![0].sheets).toEqual([{ name: "Target", id: "t" }]);
    expect(column("r", 1)).toEqual([2, 4, 6]);
  });
});
