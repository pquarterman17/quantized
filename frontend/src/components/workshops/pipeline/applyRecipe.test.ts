// P2.5 box 4 — applying a saved transformation recipe through the REAL store:
// record two transforms, save them as a recipe, apply it to other datasets.
// Pins the derived output (equal to running the same transforms on a dataset
// laid out like the recording), its provenance, the rebinding, the preflight
// refusal, the rollback of a failed run and ONE undo entry per apply.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyRecipe, asOneUndoStep, type RecipeProvenance } from "./runTemplate";
import { fitModel } from "../../../lib/api";
import { makeStep, sanitizeSteps } from "../../../lib/pipeline";
import { deriveExpectations } from "../../../lib/recipeExpect";
import { parseTemplate, serializeTemplate, toTemplate, type AnalysisTemplate } from "../../../lib/template";
import { runTransform } from "../../../lib/transformRun";
import type { DataStruct, Dataset } from "../../../lib/types";
import { stackWorksheet, transposeWorksheet } from "../../../lib/worksheetTransforms";
import { HISTORY_DEPTH } from "../../../store/history";
import { removeDatasetsWithTrash } from "../../../store/removeDatasets";
import { useApp } from "../../../store/useApp";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
// Only `fitModel` is ever exercised through this mock (a single test below,
// finding #3) — nothing here calls `reportEmit`.
vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), reportEmit: vi.fn() }));

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
  it("replays a serialized recipe deterministically on equivalent inputs", async () => {
    const recipe = await recordRecipe();
    useApp.setState({
      datasets: [...store().datasets, { ...B, id: "b-copy", name: "b-copy.dat", data: structuredClone(B.data) }],
    });
    const roundTripped = parseTemplate(serializeTemplate(recipe));
    const results = await applyRecipe(
      roundTripped,
      [
        { datasetId: "b", bindings: [2, 1, 0] },
        { datasetId: "b-copy", bindings: [2, 1, 0] },
      ],
      { ackUnits: false },
    );
    expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
    const first = byId(results[0].outputId!)!.data;
    const second = byId(results[1].outputId!)!.data;
    expect({ time: second.time, values: second.values, labels: second.labels, units: second.units }).toEqual({
      time: first.time,
      values: first.values,
      labels: first.labels,
      units: first.units,
    });
  });

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
    const madeByThisRun = ids().filter((x) => !before.includes(x));
    expect(madeByThisRun).toHaveLength(3);
    // Regression guard (finding #7's own fix): ONLY the chain's final step
    // (transpose) — not the stack's now-superseded intermediate output, and
    // not the working copy — carries provenance.
    expect(madeByThisRun.filter((id) => byId(id)!.data.metadata.transform_recipe)).toEqual([r.outputId]);
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

  // Finding #1: record on [T, M] with an expression that appends M2, then a
  // stack of [M, M2] (channels [1, 2]); applying to a target with an EXTRA
  // column must still stack M2, not the target's own extra column.
  it("replays a recorded index correctly when the target has an extra column the recipe never sees", async () => {
    useApp.setState({
      datasets: [
        ...store().datasets,
        { id: "tm", name: "tm.dat", data: { time: [0, 1], values: [[10, 3], [20, 4]], labels: ["T", "M"], units: ["K", "emu"], metadata: {} } },
        { id: "tx", name: "tx.dat", data: { time: [0, 1], values: [[10, 3, 999], [20, 4, 888]], labels: ["T", "M", "X"], units: ["K", "emu", "V"], metadata: {} } },
      ],
      activeId: "tm",
      selectedIds: ["tm"],
    });
    store().addFormula("tm", "M2", "B*2"); // M2 = [6, 8]
    await runTransform(store, { op: "stack", channels: [1, 2] }, "tm");
    const steps = sanitizeSteps(JSON.parse(JSON.stringify(store().macroSteps)));
    expect(steps.map((s) => s.kind)).toEqual(["expression", "transform"]);
    const example = byId("tm")!;
    const template = toTemplate("add-M2-then-stack", steps, [], { revision: 1, expects: deriveExpectations(steps, example) });
    useApp.setState({ macroRecording: false, history: [] });

    const [r] = await applyRecipe(template, [{ datasetId: "tx", bindings: [0, 1] }], { ackUnits: false });
    expect(r.status).toBe("ok");
    const out = byId(r.outputId!)!;
    // The stack ran on [M, M2] = [3, 6] / [4, 8], never on X's [999, 888].
    expect(out.data.values).toEqual([[1, 3], [2, 6], [1, 4], [2, 8]]);
  });

  // Finding #5: a disabled first step (blocking the second, recorded to run
  // on its output) leaves the working copy untouched — that must be a
  // FAILURE, not a successful, provenanced output.
  it("reports an untouched working copy as failed, not a success, when its first step is disabled", async () => {
    const recipe = await recordRecipe(); // [stack, transpose]
    const disabled: AnalysisTemplate = { ...recipe, steps: recipe.steps.map((s, i) => (i === 0 ? { ...s, enabled: false } : s)) };
    const before = ids();

    const [r] = await applyRecipe(disabled, [{ datasetId: "b", bindings: [2, 1, 0] }], { ackUnits: false }); // a rebinding: forces a working copy
    expect(r.status).toBe("failed");
    expect(r.note).toContain("nothing kept");
    expect(ids()).toEqual(before); // the working copy was rolled back, nothing leaked
    expect(byId("b")!.data).toEqual(B.data);
  });

  // Finding #7: a recipe that SPLITS must stamp provenance on every child it
  // creates, not just the first (the one `target` continues on).
  it("stamps provenance on every child a split creates, and names them all", async () => {
    useApp.setState({
      datasets: [
        ...store().datasets,
        {
          id: "grp",
          name: "grp.dat",
          data: { time: [0, 1, 2, 3], values: [[1, 10], [1, 20], [2, 30], [2, 40]], labels: ["group", "val"], units: ["", ""], metadata: {} },
        },
      ],
      activeId: "grp",
      selectedIds: ["grp"],
    });
    await runTransform(store, { op: "split", col: 0, tolerance: null }, "grp");
    const steps = sanitizeSteps(JSON.parse(JSON.stringify(store().macroSteps)));
    expect(steps.map((s) => s.kind)).toEqual(["transform"]);
    const template = toTemplate("split-by-group", steps, [], { revision: 2, expects: deriveExpectations(steps, byId("grp")!) });
    useApp.setState({ macroRecording: false, history: [] });

    const before = ids();
    const [r] = await applyRecipe(template, [{ datasetId: "grp", bindings: [0, 1] }], { ackUnits: false });
    expect(r.status).toBe("ok");
    const createdIds = ids().filter((id) => !before.includes(id));
    expect(createdIds).toHaveLength(2); // both split children
    for (const id of createdIds) {
      const prov = byId(id)!.data.metadata.transform_recipe as RecipeProvenance;
      expect(prov).toMatchObject({ recipe: "split-by-group", revision: 2 });
    }
    const names = createdIds.map((id) => byId(id)!.name);
    expect(names.every((n) => r.note.includes(n))).toBe(true);
  });

  // Finding #3: rollback removes exactly what THIS run created — never a
  // dataset an unrelated concurrent import adds while a step awaits the
  // backend.
  it("rollback spares a dataset a concurrent import adds while a step is awaiting the backend", async () => {
    useApp.setState({
      datasets: [
        ...store().datasets,
        { id: "tm3", name: "tm3.dat", data: { time: [0, 1], values: [[1, 5], [2, 6]], labels: ["T", "M"], units: ["K", "emu"], metadata: {} } },
      ],
      activeId: "tm3",
      selectedIds: ["tm3"],
    });
    await runTransform(store, { op: "stack", channels: [1] }, "tm3"); // succeeds, derives a new dataset
    const steps = sanitizeSteps(JSON.parse(JSON.stringify(store().macroSteps)));
    steps.push(makeStep("fit", "Fit", "", { model: "Linear", yKey: 0, xKey: null })); // will fail below
    const template = toTemplate("stack-then-fit", steps, [], { revision: 1, expects: deriveExpectations([steps[0]], byId("tm3")!) });
    useApp.setState({ macroRecording: false, history: [] });

    vi.mocked(fitModel).mockImplementationOnce(async () => {
      // Simulate a concurrent import landing while this step awaits the backend.
      useApp.setState((s) => ({
        datasets: [...s.datasets, { id: "concurrent", name: "concurrent.dat", data: { time: [0], values: [[1]], labels: ["x"], units: [""], metadata: {} } }],
      }));
      throw new Error("fit backend down");
    });

    const before = ids();
    const [r] = await applyRecipe(template, [{ datasetId: "tm3", bindings: [0, 1] }], { ackUnits: false });
    expect(r.status).toBe("failed");
    // Only the stack's own output was rolled back; the concurrent import survives.
    expect(ids()).toEqual([...before, "concurrent"]);
    expect(byId("concurrent")).toBeDefined();
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

  // Finding #2: the pre-apply top entry is found by `seq`, not by object
  // identity — an identity lookup breaks the moment something REWRITES that
  // entry in place instead of evicting it.
  it("a coalesceKey top entry rewritten (closeRun) at full depth still folds correctly, losing nothing", async () => {
    for (let i = 0; i < HISTORY_DEPTH - 1; i++) store().recordHistory(`filler ${i}`);
    store().recordHistoryCoalesced("coalesced", "key1"); // the pre-apply top, with a coalesceKey
    expect(store().history).toHaveLength(HISTORY_DEPTH);

    await asOneUndoStep("apply", async () => {
      // Something unrelated closes the open coalescing run mid-apply — the
      // SAME entry slot, but a NEW object (finding #2's `closeRun`).
      store().endHistoryRun();
      store().recordHistory("mutation A");
      store().recordHistory("mutation B");
    });

    const labels = store().history.map((h) => h.label);
    // The buggy identity lookup could not find the rewritten top entry, and
    // — since the stack was already at HISTORY_DEPTH — fell through to "wipe
    // everything", collapsing the whole stack down to just ["apply"]. The
    // fix folds only "mutation A"/"mutation B" away, keeping every filler.
    expect(labels[0]).toBe("filler 2"); // filler 0 and 1 evicted by the two pushes above
    expect(labels[labels.length - 2]).toBe("coalesced");
    expect(labels[labels.length - 1]).toBe("apply");
    expect(labels).toHaveLength(HISTORY_DEPTH - 1);
  });

  it("a permanent delete mid-apply (scrubDatasetsFromHistory) still folds the apply into one entry", async () => {
    store().recordHistory("filler");
    const preLabel = store().history[0].label;

    await asOneUndoStep("apply", async () => {
      // A permanent delete elsewhere rewrites EVERY history entry's snapshot
      // (finding #2's `scrubDatasetsFromHistory`) while this apply is still
      // running — a new object per entry, same content.
      removeDatasetsWithTrash(store, useApp.setState, ["not-a-real-dataset"], { permanent: true });
      store().recordHistory("actual apply mutation");
    });

    const labels = store().history.map((h) => h.label);
    // The buggy identity lookup could not find the rewritten pre-apply top
    // and (below HISTORY_DEPTH) silently folded NOTHING — "actual apply
    // mutation" landed as its own, separate entry instead of being absorbed
    // into one "apply" step.
    expect(labels).not.toContain("actual apply mutation");
    expect(labels).toEqual([preLabel, "apply"]);
  });
});
