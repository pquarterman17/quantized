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

  // Review round P1-1: recomputeDerivedSheet must read the source's CURRENT
  // .data, never its .raw — same regression class as createDerivedWorksheet's,
  // but on the recalcNow recompute path.
  it("recomputes from the source's CURRENT .data even when the source has its own .raw/.corrections (P1-1 regression)", async () => {
    const sourceRaw = data(); // [[2],[4],[6]]
    const sourceData = { ...data(), values: [[20], [40], [60]] }; // "what the user sees"
    vi.mocked(applyCorrectionsApi).mockResolvedValue(data());
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a", { raw: sourceRaw, data: sourceData, corrections: { yOff: 18 } }),
        ds("b", { derivedFrom: { datasetId: "a", pipeline: "x" }, corrections: {} }),
      ],
      staleDatasets: ["b"],
    });

    await useApp.getState().recalcNow();

    expect(applyCorrectionsApi).toHaveBeenCalledWith(expect.objectContaining({ dataset: sourceData }));
  });

  // Two-hop chain settling: touching A marks BOTH B (derived from A) and C
  // (derived from B) stale in the SAME touch (K3's generalized graph walk,
  // slice 1); recalcNow must then recompute them in order so C ends up
  // built from B's FRESHLY recomputed output, not A's raw value.
  it("a two-hop derived chain (C from B, B from A) settles topologically in ONE recalcNow (P1-1 regression)", async () => {
    vi.mocked(applyCorrectionsApi)
      .mockResolvedValueOnce({ ...data(), values: [[50]] }) // B's recompute
      .mockResolvedValueOnce({ ...data(), values: [[70]] }); // C's recompute
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", { derivedFrom: { datasetId: "a", pipeline: "x" }, corrections: {} }),
        ds("c", { derivedFrom: { datasetId: "b", pipeline: "y" }, corrections: {} }),
      ],
    });

    useApp.getState().setCellValue("a", 0, 0, 5); // one gesture
    expect(useApp.getState().staleDatasets).toEqual(["b", "c"]); // both stale from ONE touch

    await useApp.getState().recalcNow();

    // B built from A's CURRENT (post-edit) data — value[0][0] is now 5.
    expect(applyCorrectionsApi).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ dataset: expect.objectContaining({ values: [[5], [4], [6]] }) }),
    );
    const b = useApp.getState().datasets.find((d) => d.id === "b");
    expect(b?.data.values).toEqual([[50]]);
    // C must be built from B's FRESH data ([[50]]), never A's.
    expect(applyCorrectionsApi).toHaveBeenNthCalledWith(2, expect.objectContaining({ dataset: b?.data }));
    expect(applyCorrectionsApi).not.toHaveBeenNthCalledWith(2, expect.objectContaining({ dataset: data() }));
    expect(useApp.getState().datasets.find((d) => d.id === "c")?.data.values).toEqual([[70]]);
    expect(useApp.getState().staleDatasets).toEqual([]);
  });

  // Review round P1-2: recomputeDerivedSheet bypassed corrections.ts's
  // rowsChanged guard (#50/#53) — a row-count-changing recompute must clear
  // excludedRows + the four overlays and surface a status, the SAME as an
  // in-place applyCorrections trim does.
  it("a row-count-changing recompute clears excludedRows + overlays and sets a status (P1-2 regression)", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...data(), time: [1, 2], values: [[1], [2]] }); // 2 rows, was 3
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", {
          derivedFrom: { datasetId: "a", pipeline: "x" },
          corrections: {},
          excludedRows: [2],
        }),
      ],
      staleDatasets: ["b"],
      status: "",
      fitOverlay: { datasetId: "b", y: [1, 2, 3] },
      peakOverlay: { datasetId: "b", y: [1, 2, 3] },
      baselineOverlay: { datasetId: "b", y: [1, 2, 3] },
      derivOverlay: { datasetId: "b", y: [1, 2, 3] },
    });

    await useApp.getState().recalcNow();

    const b = useApp.getState().datasets.find((d) => d.id === "b");
    expect(b?.excludedRows).toBeUndefined();
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(useApp.getState().peakOverlay).toBeNull();
    expect(useApp.getState().baselineOverlay).toBeNull();
    expect(useApp.getState().derivOverlay).toBeNull();
    expect(useApp.getState().status).toContain("Row exclusions cleared");
  });

  it("a row-count-UNCHANGED recompute leaves excludedRows/overlays untouched", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue(data()); // same 3 rows
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", { derivedFrom: { datasetId: "a", pipeline: "x" }, corrections: {}, excludedRows: [1] }),
      ],
      staleDatasets: ["b"],
      fitOverlay: { datasetId: "b", y: [1, 2, 3] },
    });
    await useApp.getState().recalcNow();
    expect(useApp.getState().datasets.find((d) => d.id === "b")?.excludedRows).toEqual([1]);
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "b", y: [1, 2, 3] });
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

  it("a still-pending source leaves the sheet stale instead of deriving from a preview (P1-1)", async () => {
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a", { pending: { kind: "path", path: "/x.opj", bookId: "b1", rows: 5000, cols: 4 } }),
        ds("b", { derivedFrom: { datasetId: "a", pipeline: "x" }, corrections: {} }),
      ],
      staleDatasets: ["b"],
    });
    await useApp.getState().recalcNow();
    expect(useApp.getState().staleDatasets).toEqual(["b"]);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
    expect(useApp.getState().status).toMatch(/hasn't fully loaded yet/);
  });

  // LIBRARY_WORKBOOK_UX_PLAN "recalculation ... order independence" —
  // the store-level integration of lib/recalc.test.ts's sortForRecalc: two
  // SEPARATE gestures (edit B directly, THEN edit A upstream of B) leave
  // staleDatasets in the WRONG append order (["c","b"]) per markStale's own
  // doc. Without sorting, recalcNow would process "c" first — reading B's
  // PRE-recompute .data via applyCorrections' live resolveDataset(bgRef) —
  // then recompute "b" too late for c to see it, silently freezing c on a
  // stale intermediate value while marking it clean.
  it("a bgRef chain (a->b->c) recomputes upstream-first even when staleDatasets accumulates in the ADVERSARIAL order (order-independence)", async () => {
    // Traceable fake: c's background input becomes visible in its OWN
    // recomputed value (bg_dataset's first value + 1), so we can tell
    // whether c was built from b's fresh output or its stale one.
    vi.mocked(applyCorrectionsApi).mockImplementation(async (req) => ({
      ...data(),
      values: [[(req.bg_dataset?.values[0]?.[0] ?? req.dataset.values[0][0]) + 1]],
    }));
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", { raw: data(), corrections: {}, bgRef: { datasetId: "a", interp: "linear" } }),
        ds("c", { raw: data(), corrections: {}, bgRef: { datasetId: "b", interp: "linear" } }),
      ],
    });

    useApp.getState().setCellValue("b", 0, 0, 40); // gesture 1: edit b directly — stales only c
    expect(useApp.getState().staleDatasets).toEqual(["c"]);
    useApp.getState().setCellValue("a", 0, 0, 5); // gesture 2: edit a — stales b too
    // The adversarial append order this bug needs: c sits BEFORE b.
    expect(useApp.getState().staleDatasets).toEqual(["c", "b"]);

    await useApp.getState().recalcNow();

    const b = useApp.getState().datasets.find((d) => d.id === "b")!;
    const c = useApp.getState().datasets.find((d) => d.id === "c")!;
    // b recomputes from its background a's POST-EDIT value (5) -> b = 6.
    expect(b.data.values[0][0]).toBe(6);
    // c MUST be built from b's FRESH post-recompute value (6 -> c = 7), never
    // b's stale PRE-recompute .data (values[0][0] === 2, the fixture default)
    // — which is exactly what a naive unsorted pass (c processed before b)
    // would read, giving c = 3 instead.
    expect(c.data.values[0][0]).toBe(7);
    expect(useApp.getState().staleDatasets).toEqual([]);
  });

  // LIBRARY_WORKBOOK_UX_PLAN "auditable ... never hide ... a stale/failed
  // state": `applyCorrections` never throws — every refusal (a write-time
  // cycle rejection included) resolves to `false` + a status message, never
  // a rejected promise. recalcNow's bgRef/corrections branch must check that
  // boolean, or a refused/failed recalculation silently goes "clean" while
  // the dataset keeps serving its OLD data as if it were current — the exact
  // prohibition this plan item names.
  //
  // The runtime cycle case: a bgRef cycle a<->b that bypassed the write-time
  // guard (e.g. loaded from an older save, or any other state mutation the
  // UI's wouldCreateCycle checks don't intercept) must terminate visibly —
  // never hang, never silently serve a's stale value as freshly recomputed.
  it("recalcNow leaves a dataset stale (never silently clears it) when applyCorrections REFUSES — a runtime bgRef cycle terminates with a visible status, not a silent success", async () => {
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        // A cycle that bypassed the write-time guard (hand-constructed state,
        // the same shape lib/recalc.test.ts's traversal-safety fixture uses):
        // a subtracts b, b subtracts a.
        ds("a", { raw: data(), corrections: {}, bgRef: { datasetId: "b", interp: "linear" } }),
        ds("b", { raw: data(), corrections: {}, bgRef: { datasetId: "a", interp: "linear" } }),
      ],
      staleDatasets: ["a"],
      status: "",
    });
    const dataBefore = useApp.getState().datasets;

    await useApp.getState().recalcNow(); // must terminate (cycle-safe BFS under the hood)

    expect(applyCorrectionsApi).not.toHaveBeenCalled(); // refused before the API call
    expect(useApp.getState().status).toMatch(/circular/); // the refusal is VISIBLE
    // "a" stays stale — the bug this regresses cleared it unconditionally.
    expect(useApp.getState().staleDatasets).toEqual(["a"]);
    // Zero mutation: the dataset's data was never silently touched.
    expect(useApp.getState().datasets).toBe(dataBefore);
  });

  // Same boolean-check bug, the OTHER refusal path through applyCorrections:
  // its own outer try/catch swallows an API-level failure (never rethrows)
  // and resolves to `false` + a status. recalcNow must honor that too.
  it("recalcNow leaves a dataset stale when the corrections API call itself fails", async () => {
    vi.mocked(applyCorrectionsApi).mockRejectedValue(new Error("backend unavailable"));
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", { raw: data(), corrections: {}, bgRef: { datasetId: "a", interp: "linear" } }),
      ],
      staleDatasets: ["b"],
      status: "",
    });
    await useApp.getState().recalcNow();
    expect(useApp.getState().staleDatasets).toEqual(["b"]); // stays stale, not silently cleared
    expect(useApp.getState().status).toMatch(/corrections failed/);
  });

  // LIBRARY_WORKBOOK_UX_PLAN idempotence: recalcNow run twice over an
  // unchanged (already-clean) dataset set produces the identical result and
  // does not keep marking anything stale or re-invoking the API.
  it("recalcNow is idempotent: a second call with nothing stale is a true no-op", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...data(), values: [[42]] });
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", { raw: data(), corrections: {}, bgRef: { datasetId: "a", interp: "linear" } }),
      ],
      staleDatasets: ["b"],
    });
    await useApp.getState().recalcNow();
    expect(applyCorrectionsApi).toHaveBeenCalledTimes(1);
    expect(useApp.getState().staleDatasets).toEqual([]);
    const afterFirst = useApp.getState().datasets;

    await useApp.getState().recalcNow(); // nothing stale — must not touch anything

    expect(applyCorrectionsApi).toHaveBeenCalledTimes(1); // NOT called again
    expect(useApp.getState().staleDatasets).toEqual([]); // still clean, not re-marked
    expect(useApp.getState().datasets).toBe(afterFirst); // byte-identical (same reference)
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

// REVIEW ROUND (#331). Clearing only the FAILING id was not enough: with
// a -> b -> c, a failure at b left c recomputed from b's stale `.data` and
// then marked CLEAN — the same "serving stale numbers with no stale mark" bug
// this file's other tests pin, moved one hop downstream.
describe("recalcNow — a failure propagates downstream (review round)", () => {
  it("leaves a dataset stale when its UPSTREAM refused, instead of rebuilding it from stale data", async () => {
    const data = { time: [0, 1], values: [[1], [2]], labels: ["v"], units: [""], metadata: {} };
    useApp.setState({
      datasets: [
        { id: "a", name: "a", data },
        {
          id: "b",
          name: "b",
          data,
          raw: data,
          corrections: {},
          bgRef: { datasetId: "a", interp: "linear" },
        },
        {
          id: "c",
          name: "c",
          data,
          raw: data,
          corrections: {},
          bgRef: { datasetId: "b", interp: "linear" },
        },
      ],
      staleDatasets: ["b", "c"],
      // b's correction is refused; c's would succeed on its own.
      applyCorrections: async (id: string) => id !== "b",
    } as never);

    await useApp.getState().recalcNow();

    const stale = useApp.getState().staleDatasets;
    expect(stale).toContain("b"); // the refusal itself
    expect(stale).toContain("c"); // and everything downstream of it
  });
});
