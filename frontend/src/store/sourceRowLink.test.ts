// A subset's link to its source rows (ROW_RANGE_CONTRACT section 4, slice R3) through the REAL store: Extract a
// noncontiguous selection, sort / insert / delete in the source, Go to Source, save and reopen.

import { beforeEach, describe, expect, it } from "vitest";

import { fitRowIdentities } from "../lib/fitRowIdentity";
import { planExtract } from "../components/Stage/worksheet/extractRows";
import { commitExtract } from "../components/Stage/worksheet/extractRowsCommit";
import { readSourceRowLink, SOURCE_LINK_CAP } from "../lib/sourceRowLink";
import { FIT_ROW_IDENTITIES, SOURCE_ROWS_KEY } from "../lib/rowSidecars";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { goToSourceRows } from "./sourceRowLink";
import { sortWorksheetRows } from "./sortRows";
import { useApp } from "./useApp";
import { STAGE_WORKSHEET_SELECTION_KEY } from "./worksheetOpen";

const N = 8;
const SRC: Dataset = {
  id: "src",
  name: "run.csv",
  // Y is descending in X, so sorting by Y reverses the sheet.
  data: { time: Array.from({ length: N }, (_, i) => i), values: Array.from({ length: N }, (_, i) => [100 - i * 10]), labels: ["Y"], units: [""], metadata: {} },
};
const st = () => useApp.getState();
const get = (id: string) => st().datasets.find((d) => d.id === id)!;
const child = () => st().datasets.find((d) => d.id !== "src")!;
/** The rows Go to Source selected in the source sheet. */
const selected = (): number[] => [...(st().selection?.datasetId === "src" ? st().selection!.rows : st().worksheetSelections[STAGE_WORKSHEET_SELECTION_KEY]?.rows ?? [])].sort((a, b) => a - b);

function extract(rows: number[]) {
  const source = get("src");
  const plan = planExtract(source.data, rows)!;
  return commitExtract(source, plan, () => undefined);
}

beforeEach(() => {
  useApp.setState({
    datasets: [SRC], activeId: "src", worksheetId: null, stageTab: "plot", staleDatasets: [], staleFits: [],
    history: [], future: [], status: "", macroRecording: false, analysisResults: [], worksheetSelections: {}, selection: null,
  });
});

describe("Extract records its link", () => {
  it("the child holds one source identity per row, the source holds those identities, and nothing else changed", () => {
    expect(extract([1, 4, 6])).toBeNull();
    const link = readSourceRowLink(child().data.metadata)!;
    expect(link.source).toBe("src");
    expect(Object.keys(link.rows)).toEqual(["0", "1", "2"]);
    const ids = fitRowIdentities(get("src").data.metadata, N)!;
    expect([...ids.keys()].sort()).toEqual([1, 4, 6]);
    expect(Object.values(link.rows)).toEqual([ids.get(1), ids.get(4), ids.get(6)]);
    expect(get("src").data.values).toEqual(SRC.data.values); // data untouched
  });

  it("a second Extract keeps the first one's identities (they are added, not replaced)", () => {
    extract([1, 4]);
    const first = new Map(fitRowIdentities(get("src").data.metadata, N)!);
    extract([2, 4]);
    const all = fitRowIdentities(get("src").data.metadata, N)!;
    expect(all.get(1)).toBe(first.get(1));
    expect([...all.keys()].sort()).toEqual([1, 2, 4]);
  });

  it("Undo removes the child (the identities left on the source are inert)", () => {
    extract([1, 4]);
    expect(st().datasets).toHaveLength(2);
    st().undo();
    expect(st().datasets).toHaveLength(1);
    expect(goToSourceRows("src")).toBe(false); // the source holds no link of its own
  });

  it("above the cap the subset is unlinked and the status says so", () => {
    const rows = Array.from({ length: SOURCE_LINK_CAP + 1 }, (_, i) => i);
    const big: Dataset = { id: "src", name: "big", data: { time: rows, values: rows.map((i) => [i]), labels: ["Y"], units: [""], metadata: {} } };
    useApp.setState({ datasets: [big] });
    const stopped = commitExtract(big, planExtract(big.data, rows)!, () => undefined);
    expect(stopped?.status).toContain("row link not kept: more than 100,000 rows");
    expect(child().data.metadata[SOURCE_ROWS_KEY]).toBeUndefined();
    expect(get("src").data.metadata[FIT_ROW_IDENTITIES]).toBeUndefined(); // no identity was minted for it either
  });
});

describe("Go to Source", () => {
  it("selects the ORIGINAL rows after the source was sorted", () => {
    extract([1, 4, 6]);
    sortWorksheetRows("src", 0, 1); // ascending Y: the sheet reverses, source row r moves to N-1-r
    expect(get("src").data.values[0]).toEqual([30]);
    expect(goToSourceRows(child().id)).toBe(true);
    expect(selected()).toEqual([N - 1 - 6, N - 1 - 4, N - 1 - 1]); // 1, 3, 6
    expect(st().status).toMatch(/selected 3 rows of “run.csv”/);
    // ...and they are the SAME measurements the child holds.
    const ys = selected().map((r) => get("src").data.values[r]![0]).sort((a, b) => a - b);
    expect(ys).toEqual(child().data.values.map((r) => r[0]).sort((a, b) => a - b));
  });

  it("follows rows inserted above", () => {
    extract([1, 4]);
    st().insertRows("src", 0, 2);
    expect(goToSourceRows(child().id)).toBe(true);
    expect(selected()).toEqual([3, 6]);
  });

  it("states how many rows no longer exist after two were deleted, and selects the rest", () => {
    extract([1, 4, 6]);
    st().deleteRows("src", [1, 6]);
    expect(goToSourceRows(child().id)).toBe(true);
    expect(selected()).toEqual([3]); // old row 4, after one row above it went
    expect(st().status).toContain("2 of 3 rows no longer exist in the source");
  });

  it("selects nothing and says so when every linked row is gone", () => {
    extract([1, 4]);
    st().deleteRows("src", [1, 4]);
    expect(goToSourceRows(child().id)).toBe(false);
    expect(selected()).toEqual([]);
    expect(st().status).toContain("none of the 2 linked rows exist");
  });

  it("says so when the source worksheet is deleted, and when the sheet has no link", () => {
    extract([1, 4]);
    expect(goToSourceRows("src")).toBe(false);
    expect(st().status).toContain("no row link");
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "src") }));
    expect(goToSourceRows(child().id)).toBe(false);
    expect(st().status).toContain("source worksheet no longer exists");
  });

  it("does not select a different row when the source lost its identities and minted new ones", () => {
    extract([1, 4]);
    // A re-import replaces the metadata: the old identities are gone. A new fit-style install mints NEW tokens.
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "src" ? { ...d, data: { ...d.data, metadata: {} } } : d)) }));
    st().setFitSpec("src", { model: "x", xKey: null, yKey: 0 } as never, { "1": "r1:0", "4": "r1:1" });
    expect(goToSourceRows(child().id)).toBe(false);
    expect(selected()).toEqual([]);
  });

  it("survives save and reopen", () => {
    extract([1, 4, 6]);
    const reopened = parseWorkspace(serializeWorkspace({ datasets: st().datasets }));
    useApp.setState({ datasets: reopened.datasets.map((d) => d) });
    expect(readSourceRowLink(child().data.metadata)?.source).toBe("src");
    expect(goToSourceRows(child().id)).toBe(true);
    expect(selected()).toEqual([1, 4, 6]);
  });

  it("a child that was sorted keeps each link on its own row", () => {
    extract([1, 4, 6]);
    sortWorksheetRows(child().id, 0, 1); // child Y ascending: reversed
    expect(goToSourceRows(child().id)).toBe(true);
    expect(selected()).toEqual([1, 4, 6]);
  });
});
