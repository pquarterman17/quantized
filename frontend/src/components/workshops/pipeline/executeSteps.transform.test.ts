// P2.5 — transform steps replay. Every combine/reshape op is performed once
// through its recording path, the recorded step is SAVED (JSON round-trip
// through the .dwk/template sanitizers) and replayed by the pipeline executor
// on the same inputs: the replayed output must equal the original. Plus the
// executor's retarget (later steps act on the transform's output), a missing
// second input failing with its name, and old pipelines still loading.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep, sanitizeSteps, type PipelineStep } from "../../../lib/pipeline";
import { parseTemplate, serializeTemplate, toTemplate } from "../../../lib/template";
import { runTransform, type TransformParams } from "../../../lib/transformRun";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { executeSteps } from "./executeSteps";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(async () => ({ params: [1, 0], R2: 1 })),
}));
// Dataset math is a backend call; a deterministic stand-in (A - B on A's grid,
// B looked up by x) keeps the replay comparison meaningful offline.
vi.mock("../../../lib/api/datasetAlgebra", () => ({
  datasetAlgebra: vi.fn(async (body: { dataset_a: DataStruct; dataset_b: DataStruct; operation: string }) => ({
    time: [...body.dataset_a.time],
    values: body.dataset_a.time.map((x, i) => {
      const j = body.dataset_b.time.indexOf(x);
      return [j < 0 ? Number.NaN : body.dataset_a.values[i][0] - body.dataset_b.values[j][0]];
    }),
    labels: ["A - B"],
    units: ["K"],
    metadata: { operation: body.operation },
  })),
}));

// 14 rows, a two-setpoint column (5 K / 10 K) plus a blank one for split.
const main: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6],
  values: [
    [1, 5.0, 10],
    [2, 5.01, 20],
    [2, 10.0, 21],
    [3, 9.99, 30],
    [4, Number.NaN, 40],
    [5, 5.0, 50],
    [Number.NaN, 10.01, 60],
  ],
  labels: ["key", "T", "v"],
  units: ["", "K", "emu"],
  metadata: { x_column_unit: "s" },
};
const other: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[1, 5, 7], [2, 5, 8], [4, 10, 9], [4, 10, 11]],
  labels: ["key", "T", "w"],
  units: ["", "K", "emu"],
  metadata: { x_column_unit: "s" },
};

const SRC: Dataset = { id: "src", name: "src.dat", data: main };
const OTH: Dataset = { id: "oth", name: "oth.dat", data: other };

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [SRC, OTH],
    folders: [],
    activeId: "src",
    selectedIds: ["src"],
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
  });
});

const ids = () => new Set(useApp.getState().datasets.map((d) => d.id));
const byId = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;

/** Save → load exactly as a .dwk (sanitizeSteps) and a template do. */
function saved(steps: PipelineStep[]): PipelineStep[] {
  const viaDwk = sanitizeSteps(JSON.parse(JSON.stringify(steps)));
  const viaTemplate = parseTemplate(serializeTemplate(toTemplate("t", viaDwk, []))).steps;
  return viaTemplate;
}

async function recordThenReplay(record: () => Promise<string[]>) {
  const before = ids();
  const firstOut = await record();
  expect(firstOut.length).toBeGreaterThan(0);
  const steps = useApp.getState().macroSteps;
  expect(steps).toHaveLength(1);
  expect(steps[0].kind).toBe("transform");
  useApp.getState().stopMacro();

  const mid = ids();
  const { log } = await executeSteps(saved(steps), "src");
  const entry = Object.values(log)[0];
  expect(entry.status, entry.note).toBe("ok");
  const replayed = [...ids()].filter((id) => !mid.has(id));
  expect(replayed).toHaveLength(firstOut.length);
  firstOut.forEach((id, k) => {
    expect(before.has(id)).toBe(false);
    expect(byId(replayed[k]).name).toBe(byId(id).name);
    expect(byId(replayed[k]).data).toEqual(byId(id).data);
  });
}

const cases: [string, TransformParams][] = [
  ["transpose", { op: "transpose" }],
  ["stack", { op: "stack", channels: [1, 2] }],
  ["unstack", { op: "unstack", key: 0, category: 1, value: 2, aggregate: "mean" }],
  ["join", { op: "join", leftKey: 0, rightKey: 0, mode: "full", with: { id: "oth", name: "oth.dat" } }],
  ["merge", { op: "merge", with: [{ id: "oth", name: "oth.dat" }] }],
  ["algebra", { op: "algebra", operation: "A-B", interp: "linear", with: { id: "oth", name: "oth.dat" } }],
];

describe("transform steps replay to the same output", () => {
  it.each(cases)("%s", async (_name, params) => {
    await recordThenReplay(async () => {
      const out = await runTransform(useApp.getState, params, "src", async () => true);
      return out ? [out.id] : [];
    });
  });

  it("split (recorded by the store action itself)", async () => {
    await recordThenReplay(() => useApp.getState().splitDatasetByColumn("src", 1, 1));
    // the blank split value was warned about on every child
    const child = useApp.getState().datasets.find((d) => d.name === "src.dat ((other))");
    expect(child?.data.metadata.transform_warnings).toEqual([
      '1 row has no value in "T" and goes to a separate "(other)" dataset.',
    ]);
  });
});

describe("executeSteps with transform steps", () => {
  it("later steps continue on the transform's output, as recording did", async () => {
    await runTransform(useApp.getState, { op: "stack", channels: [1, 2] }, "src", async () => true);
    useApp.getState().stopMacro();
    const [stack] = useApp.getState().macroSteps;
    const addCol = makeStep("expression", "Add column dbl", "qz.addColumn()", { name: "dbl", expr: "B*2" });
    const before = ids();
    const { log } = await executeSteps([stack, addCol], "src");
    expect(log[addCol.id].status).toBe("ok");
    const out = [...ids()].filter((id) => !before.has(id));
    expect(out).toHaveLength(1);
    expect(byId(out[0]).formulas?.map((f) => f.name)).toEqual(["dbl"]);
    expect(byId("src").formulas).toBeUndefined();
  });

  it("a second input that is no longer in the workspace fails that step by name", async () => {
    await runTransform(
      useApp.getState,
      { op: "join", leftKey: 0, rightKey: 0, mode: "inner", with: { id: "oth", name: "oth.dat" } },
      "src",
      async () => true,
    );
    useApp.getState().stopMacro();
    const steps = useApp.getState().macroSteps;
    useApp.setState({ datasets: [SRC] });
    const { log } = await executeSteps(steps, "src");
    expect(log[steps[0].id]).toEqual({ status: "failed", note: 'the recorded input "oth.dat" is not in this workspace' });
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("steps after a FAILED transform are skipped, never run on the input", async () => {
    const join = makeStep("transform", "Join src with gone.dat (inner)", "qz.transform()", {
      op: "join", leftKey: 0, rightKey: 0, mode: "inner", with: { id: "gone", name: "gone.dat" },
    });
    const addCol = makeStep("expression", "Add column dbl", "qz.addColumn()", { name: "dbl", expr: "B*2" });
    const { log, target } = await executeSteps([join, addCol], "src");
    expect(log[join.id].status).toBe("failed");
    expect(log[addCol.id]).toEqual({
      status: "skipped",
      note: "not run — an earlier transform failed (Join src with gone.dat (inner))",
    });
    expect(byId("src").formulas).toBeUndefined();
    expect(target).toBe("src");
  });

  it("reports which dataset each fit ran on (a fit after a transform ran on its output)", async () => {
    const { fitModel } = await import("../../../lib/api");
    const stack = makeStep("transform", "Stack", "qz.transform()", { op: "stack", channels: [1, 2] });
    const fit = makeStep("fit", "Fit linear", "qz.fit()", { model: "linear" });
    const before = ids();
    const { fitTargets, target } = await executeSteps([stack, fit], "src");
    const out = [...ids()].filter((id) => !before.has(id));
    expect(fitTargets).toEqual(out);
    expect(target).toBe(out[0]);
    expect(fitModel).toHaveBeenCalledTimes(1);
  });

  it("logs the recorded warnings on replay", async () => {
    const step = makeStep("transform", "Join", "qz.transform()", {
      op: "join", leftKey: 0, rightKey: 0, mode: "inner", with: { id: "oth", name: "oth.dat" },
    });
    const { log } = await executeSteps([step], "src");
    expect(log[step.id].status).toBe("ok");
    expect(log[step.id].note).toContain("an earlier key");
  });
});

describe("old pipelines still load", () => {
  it("a pre-P2.5 step list sanitizes to the same content", () => {
    const legacy = [
      { id: "step-1", kind: "expression", label: "Add column y2", code: 'qz.addColumn("y2", "A*2")', params: { name: "y2", expr: "A*2" }, enabled: true },
      { id: "step-2", kind: "correction", label: "Corrections", code: "qz.applyCorrections()", params: { params: { yOff: 1 } }, enabled: false },
      { id: "step-3", kind: "fit", label: "Fit linear", code: 'qz.fit("linear")', params: { model: "linear" }, enabled: true },
    ];
    const out = sanitizeSteps(legacy);
    expect(out.map(({ kind, label, code, params, enabled }) => ({ kind, label, code, params, enabled }))).toEqual(
      legacy.map(({ kind, label, code, params, enabled }) => ({ kind, label, code, params, enabled })),
    );
  });
});
