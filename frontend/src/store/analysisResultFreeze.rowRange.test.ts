// Acceptance 8 U3: "Open as worksheet" on a saved ranged result's table. A repeat returns the sheet already made
// (nothing duplicated), and the sheet records the rows the result was computed on.
import { beforeEach, describe, expect, it } from "vitest";

import { readOutputRowRanges } from "../lib/inputRowRange";
import { INPUT_ROW_RANGE_KEY } from "../lib/rowSidecars";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { distribution } from "../components/workshops/analysisresults/resultBook.testkit";
import { freezeAnalysisOutputs } from "./analysisResultFreeze";
import { useApp } from "./useApp";

const SHEET: Dataset = {
  id: "source", name: "st12.csv",
  data: { time: [0, 1, 2, 3, 4, 5, 6, 7], values: [[1], [2], [4], [5], [6], [7], [8], [9]], labels: ["Signal"], units: ["V"], metadata: {} },
};

const ranged = () => {
  const r = distribution();
  return { ...r, sources: [{ ...r.sources[0], datasetId: "source" }], parameters: { ...r.parameters, rowRange: { from: 2, to: 5, rows: 8 } } };
};
const freeze = (r: ReturnType<typeof ranged>, index = 0) => freezeAnalysisOutputs(r.id, [{ key: `tbl:${index}`, ref: r.tables![index] }]);
const sheets = () => useApp.getState().datasets.filter((d) => d.id !== "source");

beforeEach(() => {
  useApp.setState({ datasets: [SHEET], activeId: "source", analysisResults: [], history: [], future: [], status: "" });
});

describe("freezing a saved ranged result's table", () => {
  it("records the input row range on the frozen sheet", () => {
    const r = ranged();
    useApp.setState({ analysisResults: [r] });
    const [id] = freeze(r);
    const sheet = useApp.getState().datasets.find((d) => d.id === id)!;
    expect(readOutputRowRanges(sheet.data.metadata)).toEqual([{ datasetId: "source", from: 2, to: 5, rows: 8 }]);
    // The private key survives a .dwk round trip (it is the same key a committed output writes).
    const back = parseWorkspace(serializeWorkspace(useApp.getState()));
    expect(JSON.stringify(back)).toContain(INPUT_ROW_RANGE_KEY);
  });

  it("an unranged result stamps nothing", () => {
    const r = distribution();
    useApp.setState({ datasets: [SHEET], analysisResults: [{ ...r, sources: [{ ...r.sources[0], datasetId: "source" }] }] });
    const [id] = freezeAnalysisOutputs(r.id, [{ key: "tbl:0", ref: r.tables![0] }]);
    expect(useApp.getState().datasets.find((d) => d.id === id)!.data.metadata).not.toHaveProperty(INPUT_ROW_RANGE_KEY);
  });

  it("a second open returns the existing sheet and says it is already added", () => {
    const r = ranged();
    useApp.setState({ analysisResults: [r] });
    const [first] = freeze(r);
    const undoDepth = useApp.getState().history.length;
    const [second] = freeze(r);
    expect(second).toBe(first);
    expect(sheets()).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(undoDepth);
    expect(useApp.getState().status).toMatch(/already added as “.+”; nothing was duplicated/);
  });

  it("another table of the same result is a new sheet, and a deleted sheet can be opened again", () => {
    const r = ranged();
    useApp.setState({ analysisResults: [r] });
    const [a] = freeze(r, 0);
    const [b] = freeze(r, 1);
    expect(b).not.toBe(a);
    expect(sheets()).toHaveLength(2);
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== a) }));
    const [again] = freeze(r, 0);
    expect(again).not.toBe(a);
    expect(sheets()).toHaveLength(2);
  });
});
