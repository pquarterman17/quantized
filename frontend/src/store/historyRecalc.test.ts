// Undo/redo restore datasets wholesale; they must also notify the recalc engine
// (`touchDataset`) for every dataset whose data or row state changed, so a
// linked derived worksheet follows the recalc mode instead of reading "Current"
// for data that no longer exists. Lane UH.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";
import { restoredChangedIds } from "./historyTouch";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(),
}));
import { applyCorrections } from "../lib/api";

const data = (values = [1, 2, 3, 4]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata: {},
});
const SRC: Dataset = { id: "src", name: "Film", data: data() };
const SHEET: Dataset = {
  id: "sheet", name: "Film (processed)", data: data([1, 2, 3, 4]),
  derivedFrom: { datasetId: "src", pipeline: "yOff=-1" }, corrections: { yOff: -1 },
};
const st = () => useApp.getState();
const src = () => st().datasets.find((d) => d.id === "src")!;
const sheetValues = () => st().datasets.find((d) => d.id === "sheet")!.data.values.map((r) => r[0]);
// The mocked pipeline mirrors the source's CURRENT included rows into the sheet.
const mirrorSource = () => vi.mocked(applyCorrections).mockImplementation(async () => {
  const s = src();
  const skip = new Set(s.excludedRows ?? []);
  return data(s.data.values.map((r) => r[0]).filter((_, i) => !skip.has(i)));
});

const EDITS: [string, () => void, number[], number[]][] = [
  ["a cell edit", () => st().setCellValue("src", 1, 0, 500), [1, 2, 3, 4], [1, 500, 3, 4]],
  ["a row exclusion", () => st().toggleRowExcluded("src", 1), [1, 2, 3, 4], [1, 3, 4]],
];

beforeEach(() => {
  vi.mocked(applyCorrections).mockReset();
  useApp.setState({
    datasets: [SRC, SHEET], activeId: "src", analysisResults: [], history: [], future: [], selection: null,
    staleDatasets: [], staleFits: [], recalcMode: "auto",
  });
});
afterEach(() => vi.useRealTimers());

describe.each(EDITS)("auto: %s", (_n, edit, before, after) => {
  it("Undo recalculates the output to the pre-edit view; Redo recalculates again; redo survives", async () => {
    mirrorSource();
    edit();
    await vi.waitFor(() => expect(sheetValues()).toEqual(after), { timeout: 3000 });
    expect(st().staleDatasets).toEqual([]);

    st().undo();
    expect(st().staleDatasets).toEqual(["sheet"]); // marked at once, never "Current"
    await vi.waitFor(() => expect(st().staleDatasets).toEqual([]), { timeout: 3000 });
    expect(sheetValues()).toEqual(before);
    // The recalc's own write recorded no history and kept the redo stack.
    expect(st().history).toHaveLength(0);
    expect(st().future).toHaveLength(1);

    st().redo();
    await vi.waitFor(() => expect(st().staleDatasets).toEqual([]), { timeout: 3000 });
    expect(sheetValues()).toEqual(after);
    expect(st().history).toHaveLength(1);
    expect(st().future).toHaveLength(0);
  });
});

describe.each(EDITS)("manual: %s", (_n, edit) => {
  it("Undo marks the output stale and does not recalculate; Redo likewise", () => {
    useApp.setState({ recalcMode: "manual" });
    edit();
    useApp.setState({ staleDatasets: [] }); // the user recalculated, or cleared marks
    st().undo();
    expect(st().staleDatasets).toEqual(["sheet"]);
    useApp.setState({ staleDatasets: [] });
    st().redo();
    expect(st().staleDatasets).toEqual(["sheet"]);
    expect(applyCorrections).not.toHaveBeenCalled();
  });
});

describe.each(EDITS)("off: %s", (_n, edit) => {
  it("Undo and Redo track nothing", () => {
    useApp.setState({ recalcMode: "off" });
    edit();
    st().undo();
    st().redo();
    expect(st().staleDatasets).toEqual([]);
    expect(applyCorrections).not.toHaveBeenCalled();
  });
});

describe("filter and untouched datasets", () => {
  it("manual: undoing a data filter marks the sheet stale", () => {
    useApp.setState({ recalcMode: "manual" });
    st().setDatasetFilter("src", [{ col: 0, kind: "range", min: 2 }]);
    useApp.setState({ staleDatasets: [] });
    st().undo();
    expect(st().staleDatasets).toEqual(["sheet"]);
  });

  it("a restore that changes only an unrelated dataset marks nothing", () => {
    const other: Dataset = { id: "other", name: "Other", data: data([7, 7]) };
    useApp.setState({ recalcMode: "manual", datasets: [SRC, SHEET, other] });
    st().setCellValue("other", 0, 0, 8);
    useApp.setState({ staleDatasets: [] });
    st().undo();
    expect(st().staleDatasets).toEqual([]);
  });

  it("an empty undo stack touches nothing", () => {
    useApp.setState({ recalcMode: "manual" });
    st().undo();
    expect(st().staleDatasets).toEqual([]);
  });
});

describe("restoredChangedIds", () => {
  it("lists changed, brought-back and nothing else (reference comparison)", () => {
    const a: Dataset = { id: "a", name: "a", data: data() };
    const b: Dataset = { id: "b", name: "b", data: data() };
    expect(restoredChangedIds([a, b], [a, b])).toEqual([]);
    expect(restoredChangedIds([a, b], [a, { ...b, name: "renamed" }])).toEqual([]);
    expect(restoredChangedIds([a, b], [a, { ...b, excludedRows: [0] }])).toEqual(["b"]);
    expect(restoredChangedIds([a], [a, b])).toEqual(["b"]);
  });
});
