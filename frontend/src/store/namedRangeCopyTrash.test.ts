// Two remainders of item 34: a worksheet restored from the Trash brings its named ranges back (under their own ids, so
// its rng() formulas read them again), and a COPIED worksheet reads its OWN ranges, never the original's block.
import { beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../lib/formulaExt";
import type { Dataset } from "../lib/types";
import { defineNamedRange } from "./namedRanges";
import { trashEntryId } from "./trash";
import { useApp } from "./useApp";

const N = 10;
const sheet = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name: `${id}.csv`,
  data: { time: Array.from({ length: N }, (_v, i) => i), values: Array.from({ length: N }, (_v, i) => [i + 1]), labels: ["A"], units: [""], metadata: {} },
  ...over,
});
const st = () => useApp.getState();

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [sheet("d1"), sheet("d2")], workbooks: [], activeId: "d1", selectedIds: [], namedRanges: [], trash: [],
    history: [], future: [], status: "", recalcMode: "auto", staleDatasets: [],
  });
});

describe("Trash restore brings back the sheet's named ranges", () => {
  it("removes the ranges with the sheet and restores them, same ids, with the sheet", async () => {
    defineNamedRange({ name: "Base", scope: "sheet", datasetId: "d1", cols: [0], rows: { from: 2, to: 5 } });
    defineNamedRange({ name: "Other", scope: "sheet", datasetId: "d2", cols: [0], rows: null });
    const id = st().namedRanges[0].id;
    st().addFormula("d1", "m", 'mean(rng("Base"))');
    st().removeDatasets(["d1"]);
    expect(st().namedRanges.map((r) => r.name)).toEqual(["Other"]); // went with the sheet
    const entry = st().trash.find((e) => e.kind === "dataset")!;
    const result = await st().restoreFromTrash(trashEntryId(entry));
    expect(result).toMatchObject({ ok: true, note: expect.stringMatching(/restored 1 named range \(Base\)/) });
    const back = st().namedRanges.find((r) => r.name === "Base")!;
    expect(back).toMatchObject({ id, scope: { kind: "sheet", datasetId: "d1" }, target: { datasetId: "d1", cols: [0], rows: { from: 2, to: 5 } } });
    // The restored sheet's own formula still holds the id, so it reads the restored block again: rows 3-6 of 1..10 -> mean 4.5.
    st().touchDataset("d1");
    const f = st().datasets.find((d) => d.id === "d1")!.formulas!.at(-1)!;
    expect(f.ranges).toEqual([{ name: "Base", id }]);
    await st().recalcNow();
    expect(st().datasets.find((d) => d.id === "d1")!.formulaErrors).toBeUndefined();
  });

  it("does not restore a range whose name was taken meanwhile, and says so", async () => {
    defineNamedRange({ name: "Base", scope: "sheet", datasetId: "d1", cols: [0], rows: null });
    st().removeDatasets(["d1"]);
    const entry = st().trash.find((e) => e.kind === "dataset")!;
    // d1 restores as a standalone sheet, so a name taken in ITS group is what clashes: put a range on a copy of its group.
    useApp.setState({ namedRanges: [{ id: "nr1:x", name: "base", scope: { kind: "sheet", datasetId: "d1" }, target: { datasetId: "d2", cols: [0], rows: null } }] });
    const result = await st().restoreFromTrash(trashEntryId(entry));
    expect(result).toMatchObject({ ok: true, note: expect.stringMatching(/named range Base not restored: the name is taken/) });
    expect(st().namedRanges).toHaveLength(1);
  });
});

describe("a copied worksheet reads its own named ranges", () => {
  it("re-binds the copy's rng() formula to a range on the copy; editing the copy never moves the original", async () => {
    defineNamedRange({ name: "Base", scope: "sheet", datasetId: "d1", cols: [0], rows: { from: 0, to: 3 } });
    const original = st().namedRanges[0];
    st().addFormula("d1", "m", 'mean(rng("Base"))');
    await st().duplicateDataset("d1");
    const copy = st().datasets.find((d) => d.name === "d1.csv (copy)")!;
    const mine = st().namedRanges.find((r) => r.target.datasetId === copy.id)!;
    expect(mine).toMatchObject({ name: "Base", scope: { kind: "sheet", datasetId: copy.id }, target: { cols: [0], rows: { from: 0, to: 3 } } });
    expect(mine.id).not.toBe(original.id);
    expect(copy.formulas!.at(-1)!.ranges).toEqual([{ name: "Base", id: mine.id }]);
    expect(st().namedRanges.find((r) => r.id === original.id)).toEqual(original); // untouched
    expect(st().status).toMatch(/copied named range Base for the copy/);
    // The original's formula still holds the ORIGINAL id (nothing shared by reference).
    expect(st().datasets.find((d) => d.id === "d1")!.formulas!.at(-1)!.ranges).toEqual([{ name: "Base", id: original.id }]);
    st().undo();
    expect(st().namedRanges).toEqual([original]);
  });

  it("a range of ANOTHER sheet that the original read stays shared (as a copied sheet() link still reads its source)", async () => {
    useApp.setState((s) => ({ workbooks: [{ id: "w1", name: "Run" }], datasets: s.datasets.map((d) => ({ ...d, workbookId: "w1" })) }));
    defineNamedRange({ name: "Elsewhere", scope: "workbook", datasetId: "d2", cols: [0], rows: null });
    const other = st().namedRanges[0];
    st().addFormula("d1", "m", 'mean(rng("Elsewhere"))');
    expect(st().datasets.find((d) => d.id === "d1")!.formulas!.at(-1)!.ranges).toEqual([{ name: "Elsewhere", id: other.id }]);
    await st().duplicateDataset("d1");
    const copy = st().datasets.find((d) => d.name === "d1.csv (copy)")!;
    expect(st().namedRanges).toEqual([other]); // no copy was made: it is not the original sheet's block
    expect(copy.formulas!.at(-1)!.ranges).toEqual([{ name: "Elsewhere", id: other.id }]);
  });
});
