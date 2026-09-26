// P2.5 box 4 — applying a saved transformation recipe through the REAL store:
// record two transforms, save them as a recipe, apply it to other datasets.
// Pins the derived output (equal to running the same transforms on a dataset
// laid out like the recording), its provenance, the rebinding, the preflight
// refusal, the rollback of a failed run and ONE undo entry per apply.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyRecipe, asOneUndoStep, type RecipeProvenance } from "./runTemplate";
import { makeStep, sanitizeSteps } from "../../../lib/pipeline";
import { deriveExpectations } from "../../../lib/recipeExpect";
import { parseTemplate, serializeTemplate, toTemplate, type AnalysisTemplate } from "../../../lib/template";
import { runTransform } from "../../../lib/transformRun";
import type { DataStruct, Dataset } from "../../../lib/types";
import { stackWorksheet, transposeWorksheet } from "../../../lib/worksheetTransforms";
import { useApp } from "../../../store/useApp";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const SRC: Dataset = {
  id: "src",
  name: "src.dat",
  data: {
    time: [0, 1, 2],
    values: [[1, 5, 10], [2, 6, 20], [3, 7, 30]],
    labels: ["key", "T", "v"],
    units: ["", "K", "emu"],
    metadata: {},
  },
};
// The same quantities in another column order, with other values.
const B: Dataset = {
  id: "b",
  name: "b.dat",
  data: {
    time: [0, 1],
    values: [[100, 50, 9], [200, 60, 8]],
    labels: ["v", "T", "key"],
    units: ["emu", "K", ""],
    metadata: {},
  },
};
// T is named differently: needs a rebinding.
const D: Dataset = {
  id: "d",
  name: "d.dat",
  data: { time: [0, 1], values: [[1, 3, 7], [2, 4, 8]], labels: ["key", "Temp", "v"], units: ["", "K", "emu"], metadata: {} },
};

const store = () => useApp.getState();
const byId = (id: string) => store().datasets.find((x) => x.id === id);
const ids = () => store().datasets.map((x) => x.id);

beforeEach(() => {
  localStorage.clear();
  useApp.setState({
    datasets: [SRC, B, D],
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

/** Record stack(T, v) then transpose on SRC, and save them as a recipe
 *  exactly as the Pipeline workshop's Save does (a JSON round trip). */
async function recordRecipe(): Promise<AnalysisTemplate> {
  const s1 = await runTransform(store, { op: "stack", channels: [1, 2] }, "src");
  await runTransform(store, { op: "transpose" }, s1!.id);
  const steps = sanitizeSteps(JSON.parse(JSON.stringify(store().macroSteps)));
  expect(steps.map((x) => x.kind)).toEqual(["transform", "transform"]);
  const t = toTemplate("stack+transpose", steps, [], {
    description: "stack T and v, then transpose",
    revision: 3,
    expects: deriveExpectations(steps, SRC),
  });
  useApp.setState({ macroRecording: false, history: [] });
  return parseTemplate(serializeTemplate(t));
}

/** What the recipe must produce from `d` laid out as [key, T, v]. */
const expected = (d: DataStruct): DataStruct => transposeWorksheet(stackWorksheet(d, [1, 2]));

describe("applyRecipe", () => {
  it("applies to a dataset with another column order: the output equals the recipe on the recorded layout, with provenance", async () => {
    const recipe = await recordRecipe();
    expect(recipe.expects?.columns.map((c) => [c.name, c.required])).toEqual([["key", false], ["T", true], ["v", true]]);
    const before = ids();
    const [r] = await applyRecipe(recipe, [{ datasetId: "b", bindings: [2, 1, 0] }], { ackUnits: false });
    expect(r).toMatchObject({ status: "ok", datasetId: "b" });
    const out = byId(r.outputId!)!;
    const conformedB: DataStruct = { ...B.data, values: [[9, 50, 100], [8, 60, 200]], labels: ["key", "T", "v"], units: ["", "K", "emu"] };
    const want = expected(conformedB);
    expect(out.data.time).toEqual(want.time);
    expect(out.data.values).toEqual(want.values);
    expect(out.data.labels).toEqual(want.labels);
    const prov = out.data.metadata.transform_recipe as RecipeProvenance;
    expect(prov).toMatchObject({
      recipe: "stack+transpose",
      revision: 3,
      input: { id: "b", name: "b.dat" },
      bindings: [{ column: "key", from: "key" }, { column: "T", from: "T" }, { column: "v", from: "v" }],
      steps: 2,
    });
    // The source is untouched; the working copy + two derived datasets exist.
    expect(byId("b")!.data).toEqual(B.data);
    expect(ids().filter((x) => !before.includes(x))).toHaveLength(3);
    expect(store().macroSteps).toHaveLength(2); // an apply records nothing
  });

  it("runs straight on the dataset when it is laid out like the recording (no working copy)", async () => {
    const recipe = await recordRecipe();
    const before = ids();
    const [r] = await applyRecipe(recipe, [{ datasetId: "src", bindings: [0, 1, 2] }], { ackUnits: false });
    expect(r.status).toBe("ok");
    expect(ids().filter((x) => !before.includes(x))).toHaveLength(2);
    expect(byId(r.outputId!)!.data.values).toEqual(expected(SRC.data).values);
  });

  it("is ONE undo entry for the whole apply, and undo removes every dataset it created", async () => {
    const recipe = await recordRecipe();
    const before = ids();
    const results = await applyRecipe(
      recipe,
      [
        { datasetId: "b", bindings: [2, 1, 0] },
        { datasetId: "d", bindings: [0, 1, 2] }, // rebinding: Temp → T
      ],
      { ackUnits: false },
    );
    expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect((byId(results[1].outputId!)!.data.metadata.transform_recipe as RecipeProvenance).bindings[1]).toEqual({ column: "T", from: "Temp" });
    expect(store().history.map((h) => h.label)).toEqual(["apply recipe “stack+transpose”"]);
    store().undo();
    expect(ids()).toEqual(before);
    expect(store().history).toHaveLength(0);
    store().redo();
    // b: working copy + 2 outputs; d: bound in place (identity) → 2 outputs.
    expect(ids()).toHaveLength(before.length + 5);
  });

  it("refuses a dataset that fails preflight — nothing created, no undo entry", async () => {
    const recipe = await recordRecipe();
    const before = ids();
    // D's "Temp" does not match "T" by name: unbound until rebound.
    const [r] = await applyRecipe(recipe, [{ datasetId: "d", bindings: [0, null, 2] }], { ackUnits: false });
    expect(r.status).toBe("refused");
    expect(r.note).toContain("no column “T” (K)");
    expect(ids()).toEqual(before);
    expect(store().history).toHaveLength(0);
  });

  it("refuses a unit mismatch unless acknowledged", async () => {
    const recipe = await recordRecipe();
    useApp.setState({ datasets: [...store().datasets, { ...D, id: "mk", name: "mk.dat", data: { ...D.data, labels: ["key", "T", "v"], units: ["", "mK", "emu"] } }] });
    const [no] = await applyRecipe(recipe, [{ datasetId: "mk", bindings: [0, 1, 2] }], { ackUnits: false });
    expect(no.status).toBe("refused");
    expect(no.note).toContain("mK");
    const [yes] = await applyRecipe(recipe, [{ datasetId: "mk", bindings: [0, 1, 2] }], { ackUnits: true });
    expect(yes.status).toBe("ok");
  });

  it("rolls back a run whose step fails: the working copy and any output are removed", async () => {
    const bad: AnalysisTemplate = toTemplate("bad", [makeStep("expression", "Add column z", "", { name: "z", expr: "Q * 2" })], [], { revision: 1 });
    const before = ids();
    const [r] = await applyRecipe(bad, [{ datasetId: "b", bindings: [] }], { ackUnits: false });
    expect(r.status).toBe("failed");
    expect(r.note).toContain("nothing kept");
    expect(ids()).toEqual(before);
    expect(byId("b")!.data).toEqual(B.data);
    expect(store().activeId).toBe("src"); // the view goes back to what it showed
  });

  it("refuses a fit-only template instead of running a fit it would throw away", async () => {
    const fitOnly = toTemplate("fit", [makeStep("fit", "Fit Linear", "", { model: "Linear", yKey: 0, xKey: null })], ["R2"]);
    const [r] = await applyRecipe(fitOnly, [{ datasetId: "b", bindings: [] }], { ackUnits: false });
    expect(r).toMatchObject({ status: "refused", note: expect.stringContaining("derives no dataset") });
  });
});

describe("asOneUndoStep", () => {
  it("keeps the entries that were there, and pushes nothing when nothing was recorded", async () => {
    store().recordHistory("earlier");
    const earlier = store().history[0];
    await asOneUndoStep("noop", async () => undefined);
    expect(store().history).toEqual([earlier]);
    await asOneUndoStep("two", async () => {
      store().recordHistory("a");
      store().recordHistory("b");
    });
    expect(store().history.map((h) => h.label)).toEqual(["earlier", "two"]);
    expect(store().history[0]).toBe(earlier);
  });
});
