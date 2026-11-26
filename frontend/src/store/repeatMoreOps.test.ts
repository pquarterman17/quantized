// Repeat last action for the remaining single-input transforms (plan item 37):
// spectrogram, SIMS, transpose, stack and split, through the real commit path
// (and the real split store action), plus the input-order choice and every case
// that is refused with a reason before anything is created.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { repeatLastAction, resetLastActionForTests } from "../lib/lastAction";
import { replayRefusal } from "../lib/repeatGuards";
import type { Dataset } from "../lib/types";
import { commitTransformOutput } from "./commitTransformOutput";
import { useApp } from "./useApp";

const { algebra, spectro, sims } = vi.hoisted(() => ({ algebra: vi.fn(), spectro: vi.fn(), sims: vi.fn() }));
vi.mock("../lib/api/datasetAlgebra", () => ({ datasetAlgebra: algebra }));
vi.mock("../lib/api/spectrogram", () => ({ runSpectrogram: spectro }));
vi.mock("../lib/api/sims", () => ({ processSims: sims }));
vi.mock("./toasts", () => ({ toast: vi.fn() }));

const sheet = (id: string, labels = ["A", "B"]): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1, 2, 3, 4, 5], values: [0, 1, 2, 3, 4, 5].map((i) => labels.map((_, c) => i + c * 10)), labels, units: labels.map(() => "V"), metadata: {} },
});
const IDS = ["a", "b", "c"];
const created = () => useApp.getState().datasets.filter((d) => !IDS.includes(d.id));

beforeEach(() => {
  vi.clearAllMocks();
  resetLastActionForTests();
  let n = 0;
  algebra.mockImplementation(async () => ({ time: [0, 1], values: [[1 + n], [2 + n++]], labels: ["A+B"], units: ["V"], metadata: {} }));
  spectro.mockResolvedValue({ time: [0, 1], values: [[1], [2]], labels: ["S"], units: [""], metadata: {} });
  sims.mockImplementation(async (body: { dataset: Dataset["data"] }) => ({ dataset: body.dataset, warnings: [], stages: [] }));
  useApp.setState({
    datasets: [sheet("a"), sheet("b"), sheet("c", ["A"])],
    folders: [], activeId: "a", selectedIds: ["a"], macroRecording: false, macroSteps: [],
    analysisResults: [], history: [], future: [], staleDatasets: [], recalcMode: "manual", pipelineRunning: false,
  });
});

const spectrogram = { op: "spectrogram" as const, channel: 1, segment_len: 4, window: "hann" as const, overlap: 0, scaling: "psd" as const, detrend: "mean" as const, resample: false };

describe("repeat transpose, stack, spectrogram and SIMS", () => {
  it("transpose repeats on every selected dataset", async () => {
    await commitTransformOutput(useApp.getState, { op: "transpose" }, "a");
    useApp.setState({ selectedIds: ["b", "c"] });
    expect((await repeatLastAction()).ok).toBe(true);
    expect(created()).toHaveLength(3);
  });

  it("stack repeats with the recorded channels", async () => {
    await commitTransformOutput(useApp.getState, { op: "stack", channels: [0, 1] }, "a");
    useApp.setState({ selectedIds: ["b"] });
    expect((await repeatLastAction()).ok).toBe(true);
    expect(created()).toHaveLength(2);
  });

  it("stack refuses when a selected dataset lacks a recorded channel, and creates nothing", async () => {
    await commitTransformOutput(useApp.getState, { op: "stack", channels: [0, 1] }, "a");
    useApp.setState({ selectedIds: ["b", "c"] });
    const r = await repeatLastAction();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/"c\.dat" has no column B \(it has 1\); nothing was created/);
    expect(created()).toHaveLength(1);
  });

  it("spectrogram repeats on another sheet, and refuses a sheet without the channel", async () => {
    await commitTransformOutput(useApp.getState, spectrogram, "a");
    useApp.setState({ selectedIds: ["b"] });
    expect((await repeatLastAction()).ok).toBe(true);
    expect(spectro).toHaveBeenCalledTimes(2);
    useApp.setState({ selectedIds: ["c"] });
    expect((await repeatLastAction()).message).toMatch(/has no column B/);
    expect(spectro).toHaveBeenCalledTimes(2);
  });

  it("SIMS repeats, and refuses a profile without the recorded reference column", async () => {
    await commitTransformOutput(useApp.getState, { op: "sims", normalization: { reference: "B" } }, "a");
    useApp.setState({ selectedIds: ["b"] });
    expect((await repeatLastAction()).ok).toBe(true);
    useApp.setState({ selectedIds: ["c"] });
    expect((await repeatLastAction()).message).toMatch(/no column named "B"; nothing was created/);
    expect(sims).toHaveBeenCalledTimes(2);
  });
});

describe("repeat a split", () => {
  const split = async (id: string, col: number) => useApp.getState().splitDatasetByColumn(id, col);
  beforeEach(() => {
    const t = sheet("a");
    t.data = { ...t.data, values: [[5], [5.01], [4.99], [10], [10.01], [9.99]], labels: ["T"], units: ["K"] };
    const u = sheet("b");
    u.data = { ...u.data, values: [[1], [1.01], [0.99], [2], [2.01], [1.99]], labels: ["T"], units: ["K"] };
    useApp.setState({ datasets: [t, u, sheet("c", ["A", "B"])], selectedIds: ["a"] });
  });

  it("splitting registers a repeat that splits the next selected dataset the same way", async () => {
    expect(await split("a", 0)).toHaveLength(2);
    useApp.setState({ selectedIds: ["b"] });
    const r = await repeatLastAction();
    expect(r.ok).toBe(true);
    expect(useApp.getState().datasets.filter((d) => d.name.startsWith("b.dat ("))).toHaveLength(2);
  });

  it("refuses a selection with a dataset that lacks the column, splitting none of them", async () => {
    await split("a", 0);
    useApp.setState({
      selectedIds: ["b", "c"],
      datasets: useApp.getState().datasets.map((d) => (d.id === "c" ? { ...d, data: { ...d.data, labels: [] } } : d)),
    });
    const before = useApp.getState().datasets.length;
    const r = await repeatLastAction();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/nothing was split/);
    expect(useApp.getState().datasets).toHaveLength(before);
  });

  it("a split made while a pipeline replays is not offered for repeat", async () => {
    useApp.setState({ pipelineRunning: true });
    await split("a", 0);
    expect((await repeatLastAction()).message).toMatch(/nothing to repeat/);
  });
});

describe("input order", () => {
  const algebraOf = { op: "algebra" as const, operation: "A-B", interp: "linear", with: { id: "b", name: "b.dat" } };

  it("reversed takes the selection in the opposite order (A-B becomes B-A)", async () => {
    await commitTransformOutput(useApp.getState, algebraOf, "a");
    useApp.setState({ selectedIds: ["a", "b"] });
    const r = await repeatLastAction({ reverse: true });
    expect(r).toEqual({ ok: true, message: expect.stringContaining("with the inputs reversed") });
    expect(created().at(-1)!.name).toBe("b − a");
    useApp.setState({ selectedIds: ["a", "b"] });
    expect(await repeatLastAction()).toMatchObject({ ok: true });
    expect(created().at(-1)!.name).toBe("a − b");
  });

  it("a one-input step has nothing to reverse and creates nothing", async () => {
    await commitTransformOutput(useApp.getState, { op: "transpose" }, "a");
    const r = await repeatLastAction({ reverse: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/nothing to reverse/);
    expect(created()).toHaveLength(1);
  });
});

describe("replayRefusal", () => {
  it("names the missing column, and lets column-free settings through", () => {
    const one = sheet("c", ["A"]);
    expect(replayRefusal({ op: "transpose" }, one)).toBeNull();
    expect(replayRefusal({ op: "sims", smoothing: { method: "moving", window: 3, polyOrder: 2 } }, one)).toBeNull();
    expect(replayRefusal({ op: "stack", channels: [-1] }, one)).toMatch(/no column/);
    expect(replayRefusal({ op: "split", col: -1, tolerance: null }, one)).toBeNull();
    expect(replayRefusal({ op: "sims", background: { lo: 0, hi: 1, keep: ["Si"] } }, one)).toMatch(/named "Si"/);
  });
});
