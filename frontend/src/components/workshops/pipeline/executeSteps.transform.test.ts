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

// Resample is a backend call too: a deterministic stand-in (n points over the
// source range, or the matched x; each value = the row's grid x) that echoes
// what the request asked for into metadata, so the replay must ask the same.
vi.mock("../../../lib/api/resample", () => ({
  resampleDataset: vi.fn(async (body: import("../../../lib/api/resample").ResampleRequest) => {
    const t = body.dataset.time.filter(Number.isFinite);
    const [lo, hi] = [Math.min(...t), Math.max(...t)];
    const n = body.n_points ?? 2;
    const grid = body.mode === "match" ? (body.match_x ?? []).filter((v): v is number => v !== null)
      : Array.from({ length: n }, (_, k) => lo + ((hi - lo) * k) / (n - 1));
    const { dataset: _d, match_x: _m, ...asked } = body;
    return {
      dataset: { time: grid, values: grid.map((x) => [x]), labels: ["v"], units: [""], metadata: { asked } },
      warnings: [{ code: "duplicate-x", text: "1 row repeats an x value already present" }],
      source_range: [lo, hi],
      rows_in: body.dataset.time.length,
      rows_out: grid.length,
    };
  }),
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
  ["resample (points)", { op: "resample", mode: "n_points", nPoints: 5, method: "linear", outOfRange: "nan", sortUnsorted: false }],
  ["resample (range)", { op: "resample", mode: "range", start: 0, stop: 6, step: 0.5, method: "makima", outOfRange: "clip", sortUnsorted: false }],
  ["resample (match)", { op: "resample", mode: "match", with: { id: "oth", name: "oth.dat" }, method: "pchip", outOfRange: "clip", sortUnsorted: true, acceptedXUnits: ["s", "Oe"] }],
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

  it("a resample onto a dataset's x that is no longer in the workspace fails by name, never guesses a grid", async () => {
    const step = makeStep("transform", "Resample src onto gone.dat's x", "qz.transform()", {
      op: "resample", mode: "match", with: { id: "gone", name: "gone.dat" }, method: "linear",
      outOfRange: "nan", sortUnsorted: false,
    });
    const { log } = await executeSteps(saved([step]), "src");
    expect(Object.values(log)[0]).toEqual({ status: "failed", note: 'the recorded input "gone.dat" is not in this workspace' });
    expect(useApp.getState().datasets).toHaveLength(2);
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
      note: "not run — an earlier transform did not run (Join src with gone.dat (inner) failed)",
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

  it("a disabled transform blocks the later steps too — they never edit the input in place", async () => {
    const stack = { ...makeStep("transform", "Stack src", "qz.transform()", { op: "stack", channels: [1, 2] }), enabled: false };
    const addCol = makeStep("expression", "Add column dbl", "qz.addColumn()", { name: "dbl", expr: "B*2" });
    const { log } = await executeSteps([stack, addCol], "src");
    expect(log[stack.id]).toEqual({ status: "skipped", note: "disabled" });
    expect(log[addCol.id]).toEqual({
      status: "skipped",
      note: "not run — an earlier transform did not run (Stack src is disabled)",
    });
    expect(byId("src").formulas).toBeUndefined();
    expect(useApp.getState().datasets).toHaveLength(2);
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

describe("recorded references replay to the right datasets (PR #431 review)", () => {
  const THIRD: Dataset = {
    id: "third",
    name: "third.dat",
    data: { ...other, values: other.values.map((r) => [r[0], r[1], r[2] * 10]) },
  };

  it("a primary input that was NOT the active dataset replays on that input, not the run's target", async () => {
    // Active = src; Dataset Math computes oth − third (A is not active).
    useApp.setState({ datasets: [SRC, OTH, THIRD], activeId: "src" });
    const first = await runTransform(
      useApp.getState,
      { op: "algebra", operation: "A-B", interp: "linear", with: { id: "third", name: "third.dat" } },
      "oth",
    );
    const [step] = useApp.getState().macroSteps;
    expect(step.params).toMatchObject({ input: { id: "oth" }, inputIsTarget: false });
    useApp.getState().stopMacro();
    const before = ids();
    const { log } = await executeSteps(saved([step]), "src");
    expect(log[Object.keys(log)[0]].status).toBe("ok");
    const [replayed] = [...ids()].filter((id) => !before.has(id));
    expect(byId(replayed).data).toEqual(byId(first!.id).data);

    // ...and refuses, naming it, when that input is gone.
    useApp.setState({ datasets: [SRC, THIRD] });
    const again = await executeSteps(saved([step]), "src");
    expect(Object.values(again.log)[0]).toEqual({ status: "failed", note: 'the recorded input "oth.dat" is not in this workspace' });
  });

  /** Record "split X by T", then "X(5 K) − X(10 K)" on the split's children. */
  async function recordSplitThenSubtract(x: string) {
    const kids = await useApp.getState().splitDatasetByColumn(x, 1, 1);
    const name = (id: string) => byId(id).name;
    // Dataset Math on the two children: A = first child (active after split).
    await runTransform(
      useApp.getState,
      { op: "algebra", operation: "A-B", interp: "linear", with: { id: kids[1], name: name(kids[1]) } },
      kids[0],
    );
    useApp.getState().stopMacro();
    return useApp.getState().macroSteps;
  }

  it("a reference to an earlier step's output follows that step's REPLAY output", async () => {
    // B: same shape as src, different numbers, so A's children and B's differ.
    const B: Dataset = {
      id: "b", name: "b.dat",
      data: { ...main, values: main.values.map((r) => [r[0], r[1], r[2] + 1000]) },
    };
    useApp.setState({ datasets: [SRC, OTH, B] });
    const steps = await recordSplitThenSubtract("src");
    expect(steps.map((s) => s.kind)).toEqual(["transform", "transform"]);
    const { datasetAlgebra } = await import("../../../lib/api/datasetAlgebra");
    vi.mocked(datasetAlgebra).mockClear();

    const { log } = await executeSteps(saved(steps), "b");
    expect(Object.values(log).map((l) => l.status)).toEqual(["ok", "ok"]);
    const [body] = vi.mocked(datasetAlgebra).mock.calls[0];
    const bKids = useApp.getState().datasets.filter((d) => d.name.startsWith("b.dat ("));
    // Both operands are B's children — never src's.
    expect(body.dataset_a).toEqual(bKids.find((d) => d.name === "b.dat (5 K)")!.data);
    expect(body.dataset_b).toEqual(bKids.find((d) => d.name === "b.dat (10 K)")!.data);
  });

  it("fails when the earlier step did not reproduce the referenced output (a missing group)", async () => {
    // C has only the 5 K setpoint: its split cannot produce the "10 K" child.
    const C: Dataset = {
      id: "c", name: "c.dat",
      data: { ...main, values: main.values.map((r, i) => [r[0], i % 2 ? 5 : Number.NaN, r[2]]) },
    };
    useApp.setState({ datasets: [SRC, OTH, C] });
    const steps = await recordSplitThenSubtract("src");
    const { log } = await executeSteps(saved(steps), "c");
    const [split, math] = Object.values(log);
    expect(split.status).toBe("ok");
    expect(math.status).toBe("failed");
    expect(math.note).toContain("was created by an earlier step that did not produce it in this run");
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
