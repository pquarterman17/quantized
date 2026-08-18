// Store-level recalc engine tests (#1/#4): the acceptance behaviors —
// auto mode re-runs the dependent fit on a cell edit with no user action;
// manual mode only flips staleness; the recalc's own writes never re-mark.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fitModel: vi.fn(),
  applyCorrections: vi.fn(),
}));

import { applyCorrections as applyCorrectionsApi, fitModel } from "../lib/api";

const data = (): DataStruct => ({
  time: [1, 2, 3],
  values: [[2], [4], [6]],
  labels: ["I"],
  units: [""],
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
  vi.useRealTimers();
  useApp.setState({
    datasets: [],
    activeId: null,
    recalcMode: "auto",
    staleDatasets: [],
    staleFits: [],
    fitOverlay: null,
    macroRecording: false,
    macroSteps: [],
  });
});

describe("recalc engine (#1)", () => {
  it("auto mode: a cell edit re-runs the dependent fit, debounced, no user action", async () => {
    vi.useFakeTimers();
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 0], R2: 1, yFit: [2, 4, 99] });
    useApp.setState({
      datasets: [ds("a", { fitSpec: { model: "Linear" } })],
      activeId: "a",
      fitOverlay: { datasetId: "a", y: [2, 4, 6] },
    });

    // a burst of edits → ONE downstream pass
    useApp.getState().setCellValue("a", 2, 0, 99);
    useApp.getState().setCellValue("a", 1, 0, 4.5);
    expect(useApp.getState().staleFits).toEqual(["a"]);
    expect(fitModel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(fitModel).toHaveBeenCalledTimes(1);
    expect(fitModel).toHaveBeenCalledWith(expect.objectContaining({ model: "Linear" }));
    expect(useApp.getState().staleFits).toEqual([]); // clean again
    expect(useApp.getState().fitOverlay?.y).toEqual([2, 4, 99]); // overlay refreshed
    vi.useRealTimers();
  });

  it("manual mode: the same edit only flips staleness (#4)", () => {
    useApp.setState({
      recalcMode: "manual",
      datasets: [ds("a", { fitSpec: { model: "Linear" } })],
    });
    useApp.getState().setCellValue("a", 0, 0, 5);
    expect(useApp.getState().staleFits).toEqual(["a"]);
    expect(fitModel).not.toHaveBeenCalled();
  });

  it("off mode: nothing is marked", () => {
    useApp.setState({
      recalcMode: "off",
      datasets: [ds("a", { fitSpec: { model: "Linear" } })],
    });
    useApp.getState().setCellValue("a", 0, 0, 5);
    expect(useApp.getState().staleFits).toEqual([]);
  });

  it("bg-dependent datasets re-derive their corrections on recalcNow", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue(data());
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", {
          raw: data(),
          corrections: { yOff: 1 },
          bgRef: { datasetId: "a", interp: "linear" },
        }),
      ],
    });
    useApp.getState().setCellValue("a", 0, 0, 5);
    expect(useApp.getState().staleDatasets).toEqual(["b"]);

    await useApp.getState().recalcNow();
    expect(applyCorrectionsApi).toHaveBeenCalledTimes(1); // b re-derived
    expect(useApp.getState().staleDatasets).toEqual([]);
    // and the recalc's own write did NOT re-mark b
    expect(useApp.getState().staleFits).toEqual([]);
  });

  const multi = (): DataStruct => ({
    time: [0, 1, 2],
    values: [[100, 10], [200, 20], [300, 30]],
    labels: ["field", "moment"],
    units: ["Oe", "emu"],
    metadata: {},
  });

  it("recompute reproduces the spec's RECORDED channels, not the live plot (P1 #3)", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1, 0], R2: 1, yFit: [1, 2, 3] });
    useApp.setState({
      recalcMode: "manual",
      datasets: [ds("a", { data: multi(), fitSpec: { model: "Linear", xKey: 0, yKey: 1 } })],
      // Live plot points somewhere else entirely — must be IGNORED for a spec
      // that recorded its own channels (else the recomputed fit drifts).
      xKey: null,
      yKeys: [0],
      seriesOrder: null,
      staleFits: ["a"],
    });
    await useApp.getState().recalcNow();
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [100, 200, 300], // field (recorded xKey 0), not time
      y: [10, 20, 30], // moment (recorded yKey 1), not values[0]
    });
  });

  it("recompute of a legacy {model} spec uses the live plotted selection", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [1, 2, 3] });
    useApp.setState({
      recalcMode: "manual",
      datasets: [ds("a", { data: multi(), fitSpec: { model: "Linear" } })],
      xKey: 0,
      yKeys: [1],
      seriesOrder: null,
      staleFits: ["a"],
    });
    await useApp.getState().recalcNow();
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [100, 200, 300], y: [10, 20, 30] });
  });

  it("a failing fit stays stale instead of vanishing", async () => {
    vi.mocked(fitModel).mockRejectedValue(new Error("no convergence"));
    useApp.setState({
      recalcMode: "manual",
      datasets: [ds("a", { fitSpec: { model: "Linear" } })],
      staleFits: ["a"],
    });
    await useApp.getState().recalcNow();
    expect(useApp.getState().staleFits).toEqual(["a"]);
    expect(useApp.getState().status).toContain("recalc fit failed");
  });
});

// LIBRARY_WORKBOOK_UX_PLAN PR K, K4: write-time bgRef cycle rejection.
describe("applyCorrections — write-time cycle rejection (K4)", () => {
  it("refuses (zero mutation, no API call) the A<->B bgRef cycle recalc.test.ts's traversal test documents as constructible today", async () => {
    // b already subtracts a (an already-applied bgRef, same shape the
    // lib/recalc.test.ts traversal-safety fixture uses).
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a", { raw: data(), corrections: {} }),
        ds("b", { raw: data(), corrections: {}, bgRef: { datasetId: "a", interp: "linear" } }),
      ],
    });
    const before = useApp.getState().datasets;
    // Now try to make a subtract b — closes the loop.
    const ok = await useApp.getState().applyCorrections("a", {}, { datasetId: "b", interp: "linear" });
    expect(ok).toBe(false);
    expect(useApp.getState().status).toMatch(/circular/);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toBe(before); // zero mutation
  });

  it("a non-cyclic bgRef still applies normally (no false positive)", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue(data());
    useApp.setState({
      recalcMode: "manual",
      datasets: [ds("a"), ds("b")],
    });
    const ok = await useApp.getState().applyCorrections("a", { yOff: 1 }, { datasetId: "b", interp: "linear" });
    expect(ok).toBe(true);
    expect(applyCorrectionsApi).toHaveBeenCalledTimes(1);
  });
});

// LIBRARY_WORKBOOK_UX_PLAN PR K, K5c/K5d: derived worksheets (L0.50) recalc
// only through the async stale-marked scheduler, never synchronously; a
// ds->sheet->fit chain settles in topological order inside one recalcNow.
describe("derived worksheets (K5c/K5d)", () => {
  it("a source edit marks a downstream derived worksheet stale but does NOT recompute it", () => {
    const sheet = ds("b", { derivedFrom: { datasetId: "a", pipeline: "flatten" } });
    useApp.setState({
      recalcMode: "manual",
      datasets: [ds("a"), sheet],
    });
    useApp.getState().setCellValue("a", 0, 0, 99);
    expect(useApp.getState().staleDatasets).toEqual(["b"]);
    // Not recomputed: the sheet's own data/derivedFrom are byte-identical.
    expect(useApp.getState().datasets.find((d) => d.id === "b")).toEqual(sheet);
  });

  // PR K slice 2 — the real executor happy path replaces slice 1's honest
  // no-op: recalcNow now actually re-runs the sheet's own `.corrections`
  // pipeline against its SOURCE's CURRENT raw/data (not the sheet's own
  // stale cache), via the exact `applyCorrections` API call regular
  // corrections use.
  it("recalcNow actually recomputes a stale derived sheet from its source's CURRENT data (K5c/K5d real executor)", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...data(), values: [[99]] });
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", {
          derivedFrom: { datasetId: "a", pipeline: "yOff=-1" },
          corrections: { yOff: -1 },
          data: { ...data(), values: [[1]] }, // stale — must NOT survive the recompute
        }),
      ],
      staleDatasets: ["b"],
    });

    await useApp.getState().recalcNow();

    expect(applyCorrectionsApi).toHaveBeenCalledWith(
      expect.objectContaining({ params: { yOff: -1 } }),
    );
    const sheet = useApp.getState().datasets.find((d) => d.id === "b");
    expect(sheet?.data.values).toEqual([[99]]); // freshly recomputed, not the stale cache
    expect(useApp.getState().staleDatasets).toEqual([]);
  });

  it("a ds->sheet->fit chain recomputes in topological order inside ONE recalcNow", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1, 0], R2: 1, yFit: [1, 2, 3] });
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...data(), values: [[9], [9], [9]] });
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", {
          derivedFrom: { datasetId: "a", pipeline: "flatten" },
          corrections: {},
          fitSpec: { model: "Linear" },
        }),
      ],
    });
    useApp.getState().setCellValue("a", 0, 0, 99);
    // Both the sheet AND its fit are already stale from the SAME touch.
    expect(useApp.getState().staleDatasets).toEqual(["b"]);
    expect(useApp.getState().staleFits).toEqual(["b"]);

    await useApp.getState().recalcNow();
    // The sheet's own pipeline executor runs BEFORE its fit is recomputed —
    // the existing two-phase (datasets, then fits) order, unchanged.
    expect(useApp.getState().staleDatasets).toEqual([]);
    expect(useApp.getState().datasets.find((d) => d.id === "b")?.data.values).toEqual([[9], [9], [9]]);
    expect(fitModel).toHaveBeenCalledTimes(1);
    expect(useApp.getState().staleFits).toEqual([]);
  });

  it("a source that no longer exists leaves the sheet stale instead of throwing", async () => {
    useApp.setState({
      recalcMode: "manual",
      datasets: [ds("b", { derivedFrom: { datasetId: "ghost", pipeline: "x" }, corrections: {} })],
      staleDatasets: ["b"],
    });
    await useApp.getState().recalcNow();
    expect(useApp.getState().staleDatasets).toEqual(["b"]); // stays stale
    expect(useApp.getState().status).toContain("derived worksheet recompute failed");
  });

  it("staleDatasets/staleFits accumulation is one recordHistory per triggering gesture (K5e)", () => {
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", { derivedFrom: { datasetId: "a", pipeline: "flatten" }, fitSpec: { model: "Linear" } }),
      ],
    });
    const before = useApp.getState().history.length;
    useApp.getState().setCellValue("a", 0, 0, 99); // one gesture
    // touchDataset's own stale-marking writes are NOT history entries (only
    // the triggering cell edit is) — exactly one entry for the whole
    // propagation (bgRef chain, sheet stale-marking, fit stale-marking).
    expect(useApp.getState().history.length).toBe(before + 1);
  });
});
