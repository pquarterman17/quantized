// LIBRARY_WORKBOOK_UX_PLAN PR K, slice 2 (L0.50): createDerivedWorksheet +
// freezeCopy — the derived-worksheet creation surface + Freeze Copy.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(),
}));

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import * as recalcModule from "../lib/recalc";
import { recomputeDerivedSheet } from "./derivedWorksheets";

const data = (): DataStruct => ({
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["A"],
  units: ["u"],
  metadata: {},
});

const ds = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name: id,
  data: data(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [],
    activeId: null,
    recalcMode: "manual",
    staleDatasets: [],
    staleFits: [],
    status: "",
    macroRecording: false,
    macroSteps: [],
  });
});

describe("createDerivedWorksheet (K2/K4, L0.50)", () => {
  it("creates a linked derived worksheet in the SAME workbook, without mutating the source", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...data(), values: [[0], [10], [20]] });
    useApp.setState({ datasets: [ds("a", { workbookId: "wb1", folderId: "f1" })] });
    const before = useApp.getState().datasets[0];

    const newId = await useApp.getState().createDerivedWorksheet("a", { yOff: -10 });

    expect(newId).not.toBeNull();
    expect(applyCorrectionsApi).toHaveBeenCalledWith({ dataset: data(), params: { yOff: -10 } });
    const created = useApp.getState().datasets.find((d) => d.id === newId);
    expect(created?.derivedFrom).toEqual({ datasetId: "a", pipeline: "Corrections: yOff=-10" });
    expect(created?.corrections).toEqual({ yOff: -10 });
    expect(created?.data.values).toEqual([[0], [10], [20]]);
    expect(created?.workbookId).toBe("wb1"); // L0.50 "inside the same workbook"
    expect(created?.folderId).toBe("f1");
    // The source itself is completely untouched (L0.13 non-destructive).
    expect(useApp.getState().datasets.find((d) => d.id === "a")).toEqual(before);
  });

  it("accepts an explicit pipeline label over the auto-summary", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue(data());
    useApp.setState({ datasets: [ds("a")] });
    const newId = await useApp.getState().createDerivedWorksheet("a", { yOff: -10 }, "My custom pipeline");
    const created = useApp.getState().datasets.find((d) => d.id === newId);
    expect(created?.derivedFrom?.pipeline).toBe("My custom pipeline");
  });

  it("refuses (zero mutation, no API call) when the source doesn't exist", async () => {
    const before = useApp.getState().datasets;
    const result = await useApp.getState().createDerivedWorksheet("ghost", {});
    expect(result).toBeNull();
    expect(useApp.getState().status).toMatch(/source dataset not found/);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toBe(before);
  });

  it("records exactly one history entry on success (via addDataset)", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue(data());
    useApp.setState({ datasets: [ds("a")] });
    const before = useApp.getState().history.length;
    await useApp.getState().createDerivedWorksheet("a", {});
    expect(useApp.getState().history.length).toBe(before + 1);
  });

  // K4: prove the wouldCreateCycle wiring is REAL (not just present in the
  // source), the same discipline the K review round's P1 established for
  // addFormula — spy the pure check and force a refusal through it, since a
  // brand-new dataset id can never construct a genuine cycle on its own
  // (see store/derivedWorksheets.ts's module header).
  it("consults wouldCreateCycle with the ds->ds edge shape and refuses when it returns non-null", async () => {
    const spy = vi.spyOn(recalcModule, "wouldCreateCycle").mockReturnValue("forced cycle for the test");
    useApp.setState({ datasets: [ds("a")] });
    const before = useApp.getState().datasets;

    const result = await useApp.getState().createDerivedWorksheet("a", { yOff: 1 });

    expect(result).toBeNull();
    expect(useApp.getState().status).toContain("forced cycle for the test");
    expect(applyCorrectionsApi).not.toHaveBeenCalled(); // refused BEFORE the API call
    expect(useApp.getState().datasets).toBe(before); // zero mutation
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: recalcModule.recalcNodes.dataset("a") }),
    );
    spy.mockRestore();
  });

  // Review round P1-1 (semantic root cause): the base is `source.data`
  // (what the user SEES), never `source.raw`. The prior test at the top of
  // this describe never caught this because its source never had `.raw`
  // set separately from `.data` — this is the regression that would have
  // caught it.
  it("derives from the source's CURRENT .data, not its stale .raw (P1-1 regression)", async () => {
    const rawData = data(); // values [[10],[20],[30]]
    const correctedData = { ...data(), values: [[100], [200], [300]] }; // "what the user sees"
    vi.mocked(applyCorrectionsApi).mockResolvedValue(correctedData);
    useApp.setState({
      datasets: [ds("a", { raw: rawData, data: correctedData, corrections: { yOff: 90 } })],
    });

    await useApp.getState().createDerivedWorksheet("a", { xOff: 1 });

    expect(applyCorrectionsApi).toHaveBeenCalledWith({ dataset: correctedData, params: { xOff: 1 } });
  });

  // Two-hop chain: C derived from B, B itself derived from A. Creating C
  // must use B's CURRENT .data (B's own pipeline output), never jump past
  // B to A's raw value — chains must compose.
  it("a chain (C from B, B itself derived from A) uses B's data, not A's (P1-1 regression)", async () => {
    const aData = data(); // [[10],[20],[30]]
    const bData = { ...data(), values: [[50], [60], [70]] }; // B's OWN pipeline output
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...data(), values: [[999], [999], [999]] });
    useApp.setState({
      datasets: [
        ds("a", { data: aData }),
        // A REAL derived worksheet's `.raw` is A's data, cached at B's last
        // recompute — this is what makes the bug reachable: reading `.raw`
        // here silently jumps past B's own pipeline to A's raw value.
        ds("b", { data: bData, raw: aData, corrections: { yOff: 1 }, derivedFrom: { datasetId: "a", pipeline: "x" } }),
      ],
    });

    await useApp.getState().createDerivedWorksheet("b", { xOff: 2 });

    expect(applyCorrectionsApi).toHaveBeenCalledWith({ dataset: bData, params: { xOff: 2 } });
  });

  it("refuses (zero mutation, no API call) when the source is a still-pending preview", async () => {
    useApp.setState({
      datasets: [ds("a", { pending: { kind: "path", path: "/x.opj", bookId: "b1", rows: 5000, cols: 4 } })],
    });
    const before = useApp.getState().datasets;
    const result = await useApp.getState().createDerivedWorksheet("a", {});
    expect(result).toBeNull();
    expect(useApp.getState().status).toMatch(/hasn't fully loaded yet/);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toBe(before);
  });

  it("leaves the dataset list unchanged when the API call fails", async () => {
    vi.mocked(applyCorrectionsApi).mockRejectedValue(new Error("boom"));
    useApp.setState({ datasets: [ds("a")] });
    const before = useApp.getState().datasets;
    const result = await useApp.getState().createDerivedWorksheet("a", { yOff: 1 });
    expect(result).toBeNull();
    expect(useApp.getState().status).toContain("create derived worksheet failed");
    expect(useApp.getState().datasets).toBe(before);
  });
});

describe("freezeCopy (L0.50)", () => {
  const derived = (): Dataset =>
    ds("sheet1", {
      data: { ...data(), values: [[1], [2], [3]] },
      raw: data(),
      corrections: { yOff: -9 },
      derivedFrom: { datasetId: "a", pipeline: "Corrections: yOff=-9" },
      workbookId: "wb1",
      folderId: "f1",
      tags: ["keep"],
      notes: "kept notes",
    });

  it("creates a permanent, independent snapshot — link severed, provenance recorded", () => {
    useApp.setState({ datasets: [ds("a", { workbookId: "wb1" }), derived()] });
    const before = useApp.getState().datasets.find((d) => d.id === "sheet1");

    const newId = useApp.getState().freezeCopy("sheet1");

    expect(newId).not.toBeNull();
    const frozen = useApp.getState().datasets.find((d) => d.id === newId);
    expect(frozen?.derivedFrom).toBeUndefined();
    expect(frozen?.corrections).toBeUndefined();
    expect(frozen?.raw).toBeUndefined();
    expect(frozen?.data.values).toEqual([[1], [2], [3]]); // the CURRENT data, frozen
    expect(frozen?.workbookId).toBe("wb1");
    expect(frozen?.tags).toEqual(["keep"]);
    expect(frozen?.data.metadata).toMatchObject({
      frozenFrom: {
        datasetId: "sheet1",
        sourceId: "a",
        pipeline: "Corrections: yOff=-9",
      },
    });
    // The derived worksheet itself is untouched — Freeze Copy never mutates it.
    expect(useApp.getState().datasets.find((d) => d.id === "sheet1")).toEqual(before);
  });

  it("refuses (zero mutation) on a dataset that isn't a derived worksheet", () => {
    useApp.setState({ datasets: [ds("plain")] });
    const before = useApp.getState().datasets;
    const result = useApp.getState().freezeCopy("plain");
    expect(result).toBeNull();
    expect(useApp.getState().status).toMatch(/only available for a derived worksheet/);
    expect(useApp.getState().datasets).toBe(before);
  });

  it("records exactly one history entry", () => {
    useApp.setState({ datasets: [ds("a"), derived()] });
    const before = useApp.getState().history.length;
    useApp.getState().freezeCopy("sheet1");
    expect(useApp.getState().history.length).toBe(before + 1);
  });
});

// SILENT_STATE_CORRUPTION_PLAN #4 (Class B): `recomputeDerivedSheet` re-runs
// the sheet's OWN pipeline against the SOURCE's current table, then used to
// route the result through `recompute` — which strips the last
// `sheet.formulas.length` columns before reapplying them. That's correct
// ONLY when the payload already carries the SHEET's own stale computed
// columns; here it's the SOURCE's freshly-corrected table, which never had
// them. With a source table ["A", "B", "C_srcComputed"] and a sheet formula
// "F1", the strip ate the source's own real computed column instead of a
// sheet-formula column that was never there.
describe("recomputeDerivedSheet — must not strip the SOURCE's own columns (#4)", () => {
  it("keeps the source's own computed column AND recomputes the sheet's own formula (VALUES, not just labels)", async () => {
    const source: Dataset = ds("src", {
      data: {
        time: [1, 2, 3],
        values: [
          [1, 10, 100],
          [2, 20, 200],
          [3, 30, 300],
        ],
        labels: ["A", "B", "C_srcComputed"],
        units: ["", "", ""],
        metadata: {},
      },
      formulas: [{ name: "C_srcComputed", expr: "B * 10" }],
    });
    const sheet: Dataset = ds("sheet1", {
      derivedFrom: { datasetId: "src", pipeline: "Corrections (no params)" },
      formulas: [{ name: "F1", expr: "A + B" }],
    });
    useApp.setState({ datasets: [source, sheet] });
    // An empty-params corrections pipeline returns the source's current
    // table verbatim — exactly what recomputeDerivedSheet does with `{}`.
    vi.mocked(applyCorrectionsApi).mockResolvedValue(source.data);

    const result = await recomputeDerivedSheet(useApp.getState, sheet);

    expect(result.data.labels).toEqual(["A", "B", "C_srcComputed", "F1"]);
    expect(result.data.values).toEqual([
      [1, 10, 100, 11],
      [2, 20, 200, 22],
      [3, 30, 300, 33],
    ]);
  });
});
