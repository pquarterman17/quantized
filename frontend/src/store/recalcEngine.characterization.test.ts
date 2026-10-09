// Characterization tests for the RECALC ENGINE domain (audit P4.1, the NINTH
// store/useApp.ts domain): `setRecalcMode`, `touchDataset`, `recalcNow` and
// `setFitSpec`, plus the `recalcMode`/`staleDatasets`/`staleFits` fields and
// the module-level scheduler state (debounce timer, in-progress guard,
// pending follow-up flag).
//
// store/recalc.test.ts covers WHAT a pass recomputes. This file pins the
// scheduler around it, against a POISONED baseline:
//  1. the EXACT set of top-level keys each call changes (a whole-getState()
//     identity diff — a recordHistory call would show as a `history` change);
//  2. the 400 ms debounce: a burst of touches schedules ONE pass;
//  3. the re-entrancy contract: a touch mid-pass is ignored, and a
//     `recalcNow` mid-pass is not dropped but runs as a follow-up pass.
// The last two depend on module-level state shared by every call, so they
// are what a mis-wired slice (state per call, or a guard on the wrong flag)
// breaks first.
//
// Written and run GREEN against the pre-extraction useApp.ts; it imports the
// store only through `./useApp`, so nothing here may change when the domain
// moves out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct, FitSpec } from "../lib/types";
import { useToasts } from "./toasts";
import { useApp, type AppState } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fitModel: vi.fn(),
}));

import { fitModel } from "../lib/api";

type Snap = Record<string, unknown>;

const data = (): DataStruct => ({
  time: [1, 2, 3],
  values: [[2], [4], [6]],
  labels: ["I"],
  units: [""],
  metadata: {},
});

const ds = (id: string, over: Partial<Dataset> = {}): Dataset => ({ id, name: id, data: data(), ...over });
const LINEAR: FitSpec = { model: "Linear", xKey: null, yKey: 0 };

const snapshot = (): Snap => ({ ...(useApp.getState() as unknown as Snap) });

/** Top-level store keys whose value changed identity, sorted. */
function changedSince(before: Snap): string[] {
  const after = useApp.getState() as unknown as Snap;
  return Object.keys(after)
    .filter((k) => after[k] !== before[k])
    .sort();
}

const act = (): AppState => useApp.getState();

/** Fresh initial store; `a` has a saved fit and `b` derives its background
 *  from `a`, so touching `a` marks one dataset and one fit stale. The stale
 *  lists start POISONED with an unrelated id so a write that replaces them
 *  (rather than appending) still shows. */
function seed(over: Partial<AppState> = {}): void {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [
      ds("a", { fitSpec: LINEAR }),
      ds("b", { raw: data(), corrections: { yOff: 1 }, bgRef: { datasetId: "a", interp: "linear" } }),
      ds("lone"),
    ],
    activeId: "a",
    recalcMode: "manual",
    staleDatasets: ["zz"],
    staleFits: ["zz"],
    status: "sentinel-status",
    macroRecording: true,
    macroSteps: [],
    history: [],
    future: [],
    ...over,
  });
}

let toastsBefore: unknown;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  seed();
  toastsBefore = useToasts.getState().toasts;
});
afterEach(() => vi.useRealTimers());

/** None of the four records an undo step, toasts or records a macro step. */
function expectNoSideNotices(): void {
  expect(act().history).toEqual([]);
  expect(act().macroSteps).toEqual([]);
  expect(useToasts.getState().toasts).toBe(toastsBefore);
}

describe("recalc engine: fields", () => {
  it("initial state is auto mode with nothing stale", () => {
    const s = useApp.getInitialState();
    expect(s.recalcMode).toBe("auto");
    expect(s.staleDatasets).toEqual([]);
    expect(s.staleFits).toEqual([]);
  });
});

describe("setRecalcMode", () => {
  it("writes only recalcMode", () => {
    const before = snapshot();
    act().setRecalcMode("off");
    expect(changedSince(before)).toEqual(["recalcMode"]);
    expect(act().recalcMode).toBe("off");
    expectNoSideNotices();
  });
});

describe("touchDataset", () => {
  it("manual mode: appends the downstream dataset + fit ids and writes nothing else", () => {
    const before = snapshot();
    act().touchDataset("a");
    expect(changedSince(before)).toEqual(["staleDatasets", "staleFits"]);
    expect(act().staleDatasets).toEqual(["zz", "b"]);
    expect(act().staleFits).toEqual(["zz", "a"]);
    expectNoSideNotices();
  });

  it("nothing downstream: writes nothing (the stale arrays keep their identity)", () => {
    const before = snapshot();
    act().touchDataset("lone");
    expect(changedSince(before)).toEqual([]);
  });

  it("already-stale ids are not re-appended", () => {
    seed({ staleDatasets: ["b"], staleFits: ["a"] });
    const before = snapshot();
    act().touchDataset("a");
    expect(changedSince(before)).toEqual([]);
  });

  it("off mode: writes nothing", () => {
    seed({ recalcMode: "off" });
    const before = snapshot();
    act().touchDataset("a");
    expect(changedSince(before)).toEqual([]);
  });

  it("auto mode: a burst of touches schedules ONE recalcNow, 400 ms after the last", () => {
    vi.useFakeTimers();
    let passes = 0;
    seed({ recalcMode: "auto", recalcNow: async () => void passes++ });
    act().touchDataset("a");
    vi.advanceTimersByTime(300);
    act().touchDataset("a");
    vi.advanceTimersByTime(399);
    expect(passes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(passes).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(passes).toBe(1);
  });

  it("manual mode: marks but never schedules a pass", () => {
    vi.useFakeTimers();
    let passes = 0;
    seed({ recalcNow: async () => void passes++ });
    act().touchDataset("a");
    vi.advanceTimersByTime(2000);
    expect(passes).toBe(0);
  });
});

describe("recalcNow re-entrancy (module-level scheduler state)", () => {
  /** A fit call that stays pending until `release()` — holds a pass open.
   *  `entered` resolves once the pass is inside that call, so a test can act
   *  "mid-pass" deterministically instead of polling. */
  function holdFit(): { entered: Promise<void>; release: () => void } {
    let release = (): void => {};
    let enter = (): void => {};
    const entered = new Promise<void>((r) => (enter = r));
    vi.mocked(fitModel).mockImplementationOnce(() => {
      enter();
      return new Promise((resolve) => (release = () => resolve({ params: [2, 0], R2: 1, yFit: [2, 4, 6] })));
    });
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 0], R2: 1, yFit: [2, 4, 6] });
    return { entered, release: () => release() };
  }

  it("keeps a fit stale and its old overlay when a backend result has no finite parameters", async () => {
    seed({ staleDatasets: [], staleFits: ["a"], fitOverlay: { datasetId: "a", y: [9, 9, 9] } });
    vi.mocked(fitModel).mockResolvedValueOnce({ params: [Number.NaN], yFit: [2, 4, 6] });
    await act().recalcNow();
    expect(act().staleFits).toEqual(["a"]);
    expect(act().fitOverlay).toEqual({ datasetId: "a", y: [9, 9, 9] });
    expect(act().status).toContain("finite parameter values");
  });

  it("a touch that arrives mid-pass is ignored (the recalc's own writes never re-mark)", async () => {
    seed({ staleDatasets: [], staleFits: ["a"] });
    const held = holdFit();
    const pass = act().recalcNow();
    await held.entered;
    useApp.setState({ staleDatasets: [] });
    act().touchDataset("a");
    expect(act().staleDatasets).toEqual([]);
    held.release();
    await pass;
    expect(act().staleFits).toEqual([]);
    // ...and the guard lifts once the pass settles.
    act().touchDataset("a");
    expect(act().staleDatasets).toEqual(["b"]);
  });

  it("a recalcNow that arrives mid-pass runs as a follow-up pass, not a no-op", async () => {
    seed({
      staleDatasets: [],
      staleFits: ["a"],
      datasets: [ds("a", { fitSpec: LINEAR }), ds("c", { fitSpec: LINEAR })],
    });
    const held = holdFit();
    const pass = act().recalcNow();
    await held.entered;
    // `c` goes stale AFTER the pass took its snapshot of staleFits, so only
    // a follow-up pass can pick it up.
    useApp.setState((s) => ({ staleFits: [...s.staleFits, "c"] }));
    await act().recalcNow(); // mid-pass: returns at once, requests the follow-up
    held.release();
    await pass;
    await vi.waitFor(() => expect(act().staleFits).toEqual([]));
    expect(fitModel).toHaveBeenCalledTimes(2);
  });
});

describe("setFitSpec", () => {
  it("sets the spec while leaving other datasets by identity", () => {
    const before = snapshot();
    const spec: FitSpec = { model: "Gaussian", xKey: null, yKey: 0 };
    act().setFitSpec("lone", spec);
    expect(changedSince(before)).toEqual(["datasets"]);
    const [a, b, lone] = act().datasets;
    expect(lone!.fitSpec).toEqual(spec);
    const prev = before.datasets as Dataset[];
    expect(a).toBe(prev[0]);
    expect(b).toBe(prev[1]);
    expectNoSideNotices();
  });

  it("null clears the spec", () => {
    act().setFitSpec("a", null);
    expect(act().datasets[0]!.fitSpec).toBeUndefined();
  });

  it("does not mark anything stale (it is not a data change)", () => {
    act().setFitSpec("a", { model: "Gaussian", xKey: null, yKey: 0 });
    expect(act().staleDatasets).toEqual(["zz"]);
    expect(act().staleFits).toEqual(["zz"]);
  });

});
