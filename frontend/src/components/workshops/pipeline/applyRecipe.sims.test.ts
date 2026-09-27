// P2.3 box 3 "saved recipe" — a recorded SIMS processing step inside a P2.5
// saved transformation recipe, through the REAL store and recipe runner:
// record → save as a recipe (a JSON round trip) → apply to another profile
// whose columns come in the other order → the output divides by the right
// species; a profile without the reference column is refused at PREFLIGHT,
// before anything runs or is created.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyRecipe } from "./runTemplate";
import type { SimsProcessRequest, SimsProcessResult } from "../../../lib/api/sims";
import { sanitizeSteps } from "../../../lib/pipeline";
import { deriveExpectations } from "../../../lib/recipeExpect";
import { defaultBindings, preflightRecipe } from "../../../lib/recipePreflight";
import { parseTemplate, serializeTemplate, toTemplate, type AnalysisTemplate } from "../../../lib/template";
import { runTransform } from "../../../lib/transformRun";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn() }));
const { processSims } = await import("../../../lib/api/sims");

/** Stand-in for calc.sims_process's normalization stage: every column but the
 *  reference divided by the reference, point by point, BY THE INDEX SENT —
 *  so a wrong binding anywhere on the way (the recipe runner's column
 *  conforming, or the step's own by-name lookup) divides by the wrong species
 *  and shows up here. */
function fakeBackend(body: SimsProcessRequest): Promise<SimsProcessResult> {
  const ref = body.normalization!.reference;
  const values = body.dataset.values.map((row) => row.map((v, c) => (c === ref ? v : (v as number) / (row[ref] as number))));
  const labels = body.dataset.labels;
  const units = labels.map((_, c) => (c === ref ? body.dataset.units[c] : `ratio to ${labels[ref]}`));
  return Promise.resolve({
    dataset: { ...body.dataset, values, units, metadata: { ...body.dataset.metadata, sims_processing: [{ stage: "normalization" }] } },
    warnings: [],
    stages: [{ stage: "normalization" }],
  });
}

const meta = { x_column_name: "Depth", x_column_unit: "nm", technique: "sims" };
const SRC: Dataset = {
  id: "src",
  name: "run1.csv",
  data: { time: [0, 10, 20], values: [[10, 1000], [20, 2000], [5, 500]], labels: ["B", "Si"], units: ["c/s", "c/s"], metadata: meta },
};
// Another profile: Si FIRST, then B — the same species in the other order.
const SWAPPED: Dataset = {
  id: "swapped",
  name: "run2.csv",
  data: { time: [0, 5], values: [[4000, 40], [2000, 30]], labels: ["Si", "B"], units: ["c/s", "c/s"], metadata: meta },
};
// A profile with no Si column at all.
const NO_REF: Dataset = {
  id: "noref",
  name: "run3.csv",
  data: { time: [0, 5], values: [[1, 2], [3, 4]], labels: ["B", "P"], units: ["c/s", "c/s"], metadata: meta },
};

const store = useApp.getState;
const ids = () => store().datasets.map((d) => d.id);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(processSims).mockImplementation(fakeBackend);
  localStorage.clear();
  useApp.setState({
    datasets: [SRC, SWAPPED, NO_REF],
    folders: [],
    activeId: "src",
    selectedIds: ["src"],
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
    history: [],
    future: [],
  });
});

/** Record "normalize to Si" on run1 and save it as a recipe, exactly as the
 *  Pipeline workshop's Save does (a JSON round trip). */
async function recordRecipe(): Promise<AnalysisTemplate> {
  await runTransform(store, { op: "sims", normalization: { reference: "Si" } }, "src");
  const steps = sanitizeSteps(JSON.parse(JSON.stringify(store().macroSteps)));
  expect(steps.map((x) => [x.kind, x.params.op])).toEqual([["transform", "sims"]]);
  const t = toTemplate("normalize to Si", steps, [], {
    description: "B / Si",
    revision: 1,
    expects: deriveExpectations(steps, SRC),
  });
  useApp.setState({ macroRecording: false, history: [] });
  return parseTemplate(serializeTemplate(t));
}

describe("a SIMS step in a saved transformation recipe", () => {
  it("declares the by-name reference as a required input column", async () => {
    const recipe = await recordRecipe();
    expect(recipe.expects?.columns.map((c) => [c.name, c.required])).toEqual([["B", false], ["Si", true]]);
  });

  it("applies to a profile with the columns in the other order: B is divided by Si, not by itself", async () => {
    const recipe = await recordRecipe();
    const bindings = defaultBindings(recipe.expects!.columns, SWAPPED.data);
    expect(bindings).toEqual([1, 0]); // B ← column 1, Si ← column 0, by name
    const [r] = await applyRecipe(recipe, [{ datasetId: "swapped", bindings }], { ackUnits: false });
    expect(r.status).toBe("ok");
    const out = store().datasets.find((d) => d.id === r.outputId)!;
    const b = out.data.labels.indexOf("B");
    const si = out.data.labels.indexOf("Si");
    expect(out.data.values.map((row) => row[b])).toEqual([40 / 4000, 30 / 2000]);
    expect(out.data.values.map((row) => row[si])).toEqual([4000, 2000]); // the reference stays raw
    expect(out.data.units[b]).toBe("ratio to Si");
    expect(out.data.metadata).toMatchObject({ transform_recipe: { recipe: "normalize to Si", input: { id: "swapped" } } });
    // The source profile is never edited.
    expect(store().datasets.find((d) => d.id === "swapped")!.data).toEqual(SWAPPED.data);
  });

  it("refuses a profile without the reference column at PREFLIGHT — nothing runs, nothing is created", async () => {
    const recipe = await recordRecipe();
    const bindings = defaultBindings(recipe.expects!.columns, NO_REF.data);
    const pf = preflightRecipe(recipe, NO_REF, bindings, new Set(ids()), false);
    expect(pf.blocked).toBe(true);
    expect(pf.issues.find((i) => i.kind === "missing-column")?.text).toContain("no column “Si”");
    const before = ids();
    const calls = vi.mocked(processSims).mock.calls.length;
    const [r] = await applyRecipe(recipe, [{ datasetId: "noref", bindings }], { ackUnits: false });
    expect(r.status).toBe("refused");
    expect(ids()).toEqual(before);
    expect(vi.mocked(processSims).mock.calls.length).toBe(calls); // the backend was never asked
  });
});
