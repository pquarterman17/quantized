// Review #2 item 6: Duplicate (and copy/paste) of a workbook left the copy's
// sheet("Name", L) links on the ORIGINAL worksheets, so the copied reader
// silently kept reading the source book.

import { beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../lib/formulaExt";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

const ds = (id: string, name: string, workbookId: string, values: number[]): Dataset =>
  ({
    id,
    name,
    workbookId,
    data: { time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["v"], units: [""], metadata: {} },
  }) as Dataset;

const st = () => useApp.getState();
const byName = (name: string) => st().datasets.find((d) => d.name === name)!;

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [ds("t", "Target", "wb1", [1, 2, 3]), ds("r", "Reader", "wb1", [0, 0, 0]), ds("o", "Outside", "wb2", [7, 8, 9])],
    workbooks: [{ id: "wb1", name: "Book1" }, { id: "wb2", name: "Book2" }] as never,
    activeId: "r",
    recalcMode: "auto",
    history: [],
    future: [],
    status: "",
  });
});

describe("workbook Duplicate carries sheet() links", () => {
  it("a link inside the book points at the COPY (renamed on arrival); one outside is cut and reported", async () => {
    expect(st().addFormula("r", "in", 'sheet("Target", A)')).toBe(true);
    expect(st().addFormula("r", "out", 'sheet("Outside", A)')).toBe(true);
    await st().duplicateWorkbook("wb1");
    const copyTarget = byName("Target (2)");
    const copyReader = byName("Reader (2)");
    const [inLink, outLink] = copyReader.formulas!;
    expect(inLink.sheets).toEqual([{ name: "Target (2)", id: copyTarget.id }]);
    expect(inLink.expr).toBe('sheet("Target (2)", A)');
    expect(outLink.sheets).toEqual([{ name: "Outside", id: null }]);
    expect(copyReader.formulaErrors?.out).toMatch(/removed|nothing to read/);
    expect(st().status).toMatch(/reference.* to data outside the copy not carried/);
    // The original reader is untouched and still reads the original target.
    expect(byName("Reader").formulas![0].sheets).toEqual([{ name: "Target", id: "t" }]);
    // The copy now follows the copy: editing the copied target moves the copied reader only.
    st().setCellValue(copyTarget.id, 0, 0, 100);
    await new Promise((r) => setTimeout(r, 0));
    await st().recalcNow();
    expect(byName("Reader (2)").data.values[0][1]).toBe(100);
    expect(byName("Reader").data.values[0][1]).toBe(1);
  });
});
