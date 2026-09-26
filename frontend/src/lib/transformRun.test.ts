// P2.5 — the recordable transform commit path (lib/transformRun.ts): review
// before commit, warnings stamped into the derived dataset's metadata, a
// `transform` pipeline step recorded with the full parameters, and the
// "Merge selected" / append-import entry points that now go through it.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../store/useApp";
import type { DataStruct, Dataset } from "./types";

vi.mock("../store/confirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("./api/datasetAlgebra", () => ({ datasetAlgebra: vi.fn() }));

const { askConfirm } = await import("../store/confirmDialog");
const { datasetAlgebra } = await import("./api/datasetAlgebra");
const {
  reviewedAppend,
  reviewTransform,
  runMergeSelected,
  runTransform,
  transformParamsOf,
  transformStepText,
} = await import("./transformRun");

const struct = (keys: number[], vals: number[], unit = "K", label = "T"): DataStruct => ({
  time: keys.map((_, i) => i),
  values: keys.map((k, i) => [k, vals[i]]),
  labels: [label, "v"],
  units: [unit, ""],
  metadata: {},
});

const L: Dataset = { id: "L", name: "left.dat", data: struct([1, 2, 2, 3], [10, 20, 21, 30]) };
const R: Dataset = { id: "R", name: "right.dat", data: struct([1, 2, 4], [7, 8, 9]) };

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [L, R],
    activeId: "L",
    selectedIds: ["L"],
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
    status: "",
  });
});

const created = () => useApp.getState().datasets.filter((d) => d.id !== "L" && d.id !== "R");
const joinParams = { op: "join" as const, leftKey: 0, rightKey: 0, mode: "inner" as const, with: { id: "R", name: "right.dat" } };

describe("runTransform", () => {
  it("shows the review BEFORE creating anything, with counts, and declining creates nothing", async () => {
    const review = vi.fn(async () => false);
    const out = await runTransform(useApp.getState, joinParams, "L", review);
    expect(out).toBeNull();
    expect(review).toHaveBeenCalledTimes(1);
    const pv = review.mock.calls[0][0] as { summary: string; warnings: { code: string; count?: number }[] };
    expect(pv.summary).toBe("Result: 2 rows × 2 columns (plus X).");
    expect(pv.warnings.find((w) => w.code === "duplicate-keys")?.count).toBe(1);
    expect(created()).toEqual([]);
    expect(useApp.getState().macroSteps).toEqual([]);
    expect(useApp.getState().status).toContain("nothing was created");
  });

  it("stamps the warnings into metadata beside worksheet_transform and records a full-parameter step", async () => {
    const out = await runTransform(useApp.getState, joinParams, "L", async () => true);
    const ds = created();
    expect(ds).toHaveLength(1);
    expect(ds[0].id).toBe(out?.id);
    expect(ds[0].name).toBe("left.dat + right.dat (joined)");
    expect(ds[0].data.metadata.worksheet_transform).toBe("join");
    const recorded = ds[0].data.metadata.transform_warnings as string[];
    expect(recorded.some((t) => t.includes("an earlier key"))).toBe(true);
    const [step] = useApp.getState().macroSteps;
    expect(step.kind).toBe("transform");
    expect(step.params).toEqual({ ...joinParams, input: { id: "L", name: "left.dat" } });
    expect(step.code).toBe('qz.transform("join", "<active>", { leftKey: 0, rightKey: 0, mode: "inner", with: "right.dat" })');
  });

  it("a unit mismatch asks through a danger confirm whose button names the override", async () => {
    useApp.setState({ datasets: [L, { ...R, data: struct([1, 2, 4], [7, 8, 9], "mK") }] });
    vi.mocked(askConfirm).mockResolvedValue(true);
    await runTransform(useApp.getState, joinParams, "L", reviewTransform);
    expect(askConfirm).toHaveBeenCalledTimes(1);
    const [title, message, label, danger] = vi.mocked(askConfirm).mock.calls[0];
    expect(title).toBe("Join (inner): units differ");
    expect(message).toContain("Key units differ");
    expect(message).toContain("mK");
    expect(label).toBe("Create despite unit mismatch");
    expect(danger).toBe(true);
    expect(created()).toHaveLength(1);
  });

  it("the review stays silent when there is nothing actionable (info only)", async () => {
    const clean: Dataset = { id: "C", name: "c", data: struct([1, 2], [3, 4]) };
    useApp.setState({ datasets: [clean], activeId: "C" });
    // transpose of a column with a unit: `units-dropped` is info, never prompted.
    await runTransform(useApp.getState, { op: "transpose" }, "C", reviewTransform);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().status).toBe("created c (transposed)");
  });

  it("a missing recorded second input fails naming it — never a guess by name", async () => {
    const params = { ...joinParams, with: { id: "gone", name: "old.dat" } };
    await expect(runTransform(useApp.getState, params, "L")).rejects.toThrow('"old.dat" is not in this workspace');
    expect(created()).toEqual([]);
  });

  it("dataset math posts A (primary) and B (recorded) and names the result as before", async () => {
    vi.mocked(datasetAlgebra).mockResolvedValue({ time: [0], values: [[1]], labels: ["T - T"], units: ["K"], metadata: { operation: "A-B" } });
    const out = await runTransform(
      useApp.getState,
      { op: "algebra", operation: "A-B", interp: "linear", with: { id: "R", name: "right.dat" } },
      "L",
    );
    expect(datasetAlgebra).toHaveBeenCalledWith({ dataset_a: L.data, dataset_b: R.data, operation: "A-B", interp_method: "linear" });
    expect(out?.name).toBe("left − right");
    const meta = created()[0].data.metadata;
    expect(meta.algebra_operands).toEqual(["left.dat", "right.dat"]);
    expect(meta.worksheet_transform).toBe("algebra");
  });
});

describe("transformParamsOf (recorded params are user-editable JSON)", () => {
  it("round-trips every op", () => {
    const all = [
      { op: "transpose" },
      { op: "stack", channels: [0, 1] },
      { op: "unstack", key: -1, category: 0, value: 1, aggregate: "last" },
      joinParams,
      { op: "merge", with: [{ id: "R", name: "right.dat" }] },
      { op: "algebra", operation: "A/B", interp: "pchip", with: { id: "R", name: "right.dat" } },
      { op: "split", col: 0, tolerance: 0.5 },
    ];
    for (const p of all) expect(transformParamsOf({ ...p, input: { id: "L", name: "l" } })).toEqual(p);
  });

  it("rejects malformed params with a message naming the problem", () => {
    expect(() => transformParamsOf({ op: "explode" })).toThrow('unknown transform "explode"');
    expect(() => transformParamsOf({ op: "join", leftKey: 0, rightKey: 0, mode: "inner" })).toThrow("no recorded second input");
    expect(() => transformParamsOf({ op: "unstack", key: 0.5, category: 0, value: 1 })).toThrow('integer "key"');
    expect(() => transformParamsOf({ op: "join", leftKey: 0, rightKey: 0, mode: "cross", with: { id: "R" } })).toThrow("join mode");
  });

  it("the split step text matches what store/split.ts records inline", () => {
    expect(transformStepText({ op: "split", col: 2, tolerance: null }, "run.dat")).toEqual({
      label: "Split run.dat by column value",
      code: 'qz.transform("split", "<active>", { col: 2, tolerance: null })',
    });
  });
});

describe("Merge selected / append import (by column position)", () => {
  const A: Dataset = { id: "A", name: "a.dat", data: { time: [1], values: [[1]], labels: ["M"], units: ["emu"], metadata: {} } };
  const B: Dataset = { id: "B", name: "b.dat", data: { time: [2], values: [[2]], labels: ["M"], units: ["A m2"], metadata: {} } };

  it("a unit mismatch must be confirmed; declining adds nothing", async () => {
    useApp.setState({ datasets: [A, B], selectedIds: ["A", "B"] });
    vi.mocked(askConfirm).mockResolvedValue(false);
    await runMergeSelected(useApp.getState);
    expect(vi.mocked(askConfirm).mock.calls[0][3]).toBe(true);
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().macroSteps).toEqual([]);
  });

  it("confirmed: merges in selection order, records the others by id, keeps the old status", async () => {
    useApp.setState({ datasets: [A, B], selectedIds: ["B", "A"] });
    vi.mocked(askConfirm).mockResolvedValue(true);
    await runMergeSelected(useApp.getState);
    const merged = useApp.getState().datasets.find((d) => d.name === "merged (2)");
    expect(merged?.data.time).toEqual([2, 1]);
    expect(merged?.data.metadata.transform_warnings).toHaveLength(1);
    expect(useApp.getState().status).toBe("merged 2 datasets → 2 rows");
    expect(useApp.getState().macroSteps[0].params).toMatchObject({ op: "merge", with: [{ id: "A", name: "a.dat" }], input: { id: "B" } });
  });

  it("the append import returns null when declined and stamped data when accepted", async () => {
    vi.mocked(askConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await reviewedAppend([A.data, B.data], ["a", "b"])).toBeNull();
    expect(vi.mocked(askConfirm).mock.calls[0][1]).toContain("Cancel imports them as separate datasets instead.");
    const ok = await reviewedAppend([A.data, B.data], ["a", "b"]);
    expect(ok?.metadata.worksheet_transform).toBe("merge");
    expect(ok?.time).toEqual([1, 2]);
  });
});
