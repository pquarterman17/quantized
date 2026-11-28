// A sheet restored from the Trash brings its named ranges back under their own ids (store/trashNamedRanges.ts), and the
// `rng()` formulas of OTHER sheets that errored when the ranges went read them again, in the restore's own transaction.
// The contract's "a cut formula never re-binds to a later range with the same NAME" is untouched: nothing here matches
// by name, the very range (ids are never reused) comes back.
import { beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../lib/formulaExt";
import type { Dataset } from "../lib/types";
import { defineNamedRange } from "./namedRanges";
import { trashEntryId } from "./trash";
import { useApp } from "./useApp";

const N = 10;
const sheet = (id: string): Dataset => ({
  id,
  name: `${id}.csv`,
  workbookId: "w1",
  data: { time: Array.from({ length: N }, (_v, i) => i), values: Array.from({ length: N }, (_v, i) => [i + 1]), labels: ["A"], units: [""], metadata: {} },
});
const st = () => useApp.getState();
const d2 = () => st().datasets.find((d) => d.id === "d2")!;
/** The first computed column of d2 (column index 1 after A). */
const computed = (): number => d2().data.values[0][1];

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [sheet("d1"), sheet("d2")], workbooks: [{ id: "w1", name: "W" }], activeId: "d2", selectedIds: [], namedRanges: [], trash: [],
    history: [], future: [], status: "", recalcMode: "auto", staleDatasets: [],
  });
  // rows 2-5 of d1.A are 3, 4, 5, 6: mean 4.5 (numpy.mean([3, 4, 5, 6]))
  defineNamedRange({ name: "Base", scope: "workbook", datasetId: "d1", cols: [0], rows: { from: 2, to: 5 } });
  st().addFormula("d2", "m", 'mean(rng("Base"))');
});

const trashD1 = () => {
  st().removeDatasets(["d1"]);
  return trashEntryId(st().trash.find((e) => e.kind === "dataset")!);
};

describe("Trash restore re-reads the other sheets' rng() formulas", () => {
  it("errors when the sheet goes, reads the restored range again when it comes back, and errors again if it is deleted again", async () => {
    expect(computed()).toBeCloseTo(4.5, 12);
    const id = st().namedRanges[0].id;
    const entry = trashD1();
    expect(d2().formulaErrors?.m).toMatch(/named range "Base" was removed/);
    const result = await st().restoreFromTrash(entry);
    expect(result).toMatchObject({ ok: true, note: expect.stringMatching(/restored 1 named range \(Base\); 1 formula column on other sheets read it again/) });
    expect(st().namedRanges.map((r) => r.id)).toEqual([id]); // the same id
    expect(d2().formulaErrors).toBeUndefined();
    expect(computed()).toBeCloseTo(4.5, 12);
    expect(d2().formulas![0].ranges).toEqual([{ name: "Base", id }]);
    // The restore is not an undo step (the trash sits outside history); it is reversed by deleting the sheet again,
    // which cuts the reader again.
    st().removeDatasets(["d1"]);
    expect(d2().formulaErrors?.m).toMatch(/named range "Base" was removed/);
  });

  it("a formula the user edited since is not touched (it no longer holds the restored id)", async () => {
    const entry = trashD1();
    expect(st().updateFormula("d2", 0, { expr: "max(A)" })).toBe(true); // drops rng()
    expect(d2().formulas![0].ranges).toBeUndefined();
    const result = await st().restoreFromTrash(entry);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.note).not.toMatch(/formula column/);
    expect(d2().formulas![0].expr).toBe("max(A)");
    expect(computed()).toBe(10); // max of 1..10, as on its own
  });

  it("a formula re-linked to a LATER range of the same name keeps it: the old range is not restored (the name is taken)", async () => {
    const oldId = st().namedRanges[0].id;
    const entry = trashD1();
    defineNamedRange({ name: "Base", scope: "workbook", datasetId: "d2", cols: [0], rows: { from: 0, to: 1 } });
    const later = st().namedRanges[0].id;
    expect(later).not.toBe(oldId);
    expect(st().updateFormula("d2", 0, { expr: 'mean(rng("Base"))   ' })).toBe(true); // an edit re-links by name to the range that exists
    expect(d2().formulas![0].ranges).toEqual([{ name: "Base", id: later }]);
    expect(computed()).toBeCloseTo(1.5, 12); // mean of 1, 2
    const result = await st().restoreFromTrash(entry);
    expect(result).toMatchObject({ ok: true, note: expect.stringMatching(/named range Base not restored: the name is taken/) });
    expect(st().namedRanges.map((r) => r.id)).toEqual([later]);
    expect(d2().formulas![0].ranges).toEqual([{ name: "Base", id: later }]);
    expect(computed()).toBeCloseTo(1.5, 12);
  });
});
