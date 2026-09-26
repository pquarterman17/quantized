// P2.5 "Metadata → factors" — the commits through the real store: promotion
// over several datasets as ONE undo entry, recorded as a `transform` step that
// replays (after a .dwk/template save) onto another dataset; the metadata
// cleanup commit, its undo and its `raw` twin; the merge source factor and its
// replay; and the recorded params' validation.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeSteps } from "../components/workshops/pipeline/executeSteps";
import { sanitizeSteps, type PipelineStep } from "./pipeline";
import { parseTemplate, serializeTemplate, toTemplate } from "./template";
import { applyMetadataCleanup, metaParamsOf, promoteFactor } from "./metadataRun";
import { runTransform, transformParamsOf } from "./transformRun";
import type { DataStruct, Dataset } from "./types";
import { useApp } from "../store/useApp";

vi.mock("../store/toasts", () => ({ toast: vi.fn() }));

const data = (metadata: Record<string, unknown>, rows = 3): DataStruct => ({
  time: Array.from({ length: rows }, (_, i) => i),
  values: Array.from({ length: rows }, (_, i) => [i * 10]),
  labels: ["M"],
  units: ["emu"],
  metadata,
});

const A: Dataset = { id: "a", name: "a.dat", data: data({ sample: "S1", T: "300 K" }) };
const B: Dataset = { id: "b", name: "b.dat", data: data({ sample: "S2", Temp: "310 K" }, 2) };
const C: Dataset = { id: "c", name: "c.dat", data: data({ operator: "pq" }) };

beforeEach(() => {
  useApp.setState({
    datasets: [A, B, C],
    folders: [],
    activeId: "a",
    selectedIds: ["a", "b"],
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
    undoStack: [],
    redoStack: [],
  } as never);
});

const byId = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;
const column = (d: Dataset, c: number) => d.data.values.map((r) => r[c]);
/** Save → load exactly as a .dwk (sanitizeSteps) and a template do. */
const saved = (steps: PipelineStep[]) =>
  parseTemplate(serializeTemplate(toTemplate("t", sanitizeSteps(JSON.parse(JSON.stringify(steps))), []))).steps;

describe("promoteFactor", () => {
  it("adds the factor to every picked dataset as one undo entry", async () => {
    const out = await promoteFactor(useApp.getState, ["a", "b", "c"], ["sample"], "auto", "sample");
    expect(out.plan.as).toBe("categorical");
    expect(out.note).toBe("added categorical factor “sample” to 3 datasets — no value (left blank) in c.dat");
    expect(byId("a").data.labels).toEqual(["M", "sample"]);
    expect(column(byId("a"), 1)).toEqual([0, 0, 0]);
    expect(byId("a").data.cat_levels?.[1]).toEqual(["S1"]);
    expect(byId("b").data.cat_levels?.[1]).toEqual(["S2"]);
    expect(column(byId("b"), 1)).toEqual([0, 0]);
    expect(column(byId("c"), 1).every(Number.isNaN)).toBe(true); // missing: blank, not defaulted
    expect(byId("a").formulas?.[0].factor).toMatchObject({ source: "metadata", path: ["sample"], value: "S1" });

    useApp.getState().undo();
    for (const id of ["a", "b", "c"]) {
      expect(byId(id).data.labels).toEqual(["M"]);
      expect(byId(id).formulas).toBeUndefined();
    }
  });

  it("refuses (nothing changed, nothing recorded) when the plan is blocked", async () => {
    await expect(promoteFactor(useApp.getState, ["a"], ["M"], "auto", "M")).rejects.toThrow(/No picked dataset has a value/);
    await expect(promoteFactor(useApp.getState, ["a", "b"], ["sample"], "numeric", "s")).rejects.toThrow(/not a number/);
    expect(byId("a").data.labels).toEqual(["M"]);
    expect(useApp.getState().macroSteps).toEqual([]);
  });

  it("records a transform step that replays onto another dataset after a save/load", async () => {
    await promoteFactor(useApp.getState, ["a", "b"], ["sample"], "auto", "sample");
    const steps = useApp.getState().macroSteps;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "transform", params: { op: "promote", path: ["sample"], as: "categorical", name: "sample" } });
    expect(steps[0].params.datasets).toEqual([{ id: "a", name: "a.dat" }, { id: "b", name: "b.dat" }]);
    useApp.getState().stopMacro();

    useApp.setState({ datasets: [...useApp.getState().datasets, { id: "d", name: "d.dat", data: data({ sample: "S9" }) }] });
    const { log, target } = await executeSteps(saved(steps), "d");
    expect(Object.values(log)[0]).toEqual({ status: "ok", note: "added categorical factor “sample” to 1 dataset" });
    expect(target).toBe("d"); // in place: later steps continue on the same dataset
    expect(byId("d").data.labels).toEqual(["M", "sample"]);
    expect(byId("d").data.cat_levels?.[1]).toEqual(["S9"]);

    // on a file without the field the step FAILS loudly rather than adding a blank column silently
    const { log: miss } = await executeSteps(saved(steps), "c");
    expect(Object.values(miss)[0]).toMatchObject({ status: "failed", note: expect.stringMatching(/No picked dataset has a value for “sample”/) });
  });
});

describe("applyMetadataCleanup", () => {
  it("unifies and parses units on data AND raw, keeps the originals, and undoes as one entry", async () => {
    useApp.setState({ datasets: [{ ...A, raw: A.data }, B, C] });
    const out = await applyMetadataCleanup(useApp.getState, ["a", "b"], {
      unify: [{ to: "temperature", from: [["T"], ["Temp"]] }],
      normalize: [{ key: "temperature", trim: true, letterCase: "keep", units: true }],
    });
    expect(out.note).toBe("cleaned metadata: 6 changes in 2 datasets");
    for (const meta of [byId("a").data.metadata, byId("a").raw!.metadata]) {
      expect(meta).toMatchObject({ temperature: 300, temperature_unit: "K", sample: "S1" });
      expect("T" in meta).toBe(false);
      expect((meta.metadata_cleanup as { key: string; before: unknown }[]).find((e) => e.key === "T")?.before).toBe("300 K");
    }
    expect(byId("b").data.metadata).toMatchObject({ temperature: 310, temperature_unit: "K" });
    // the promoted numeric factor then carries the parsed unit
    await promoteFactor(useApp.getState, ["a", "b"], ["temperature"], "auto", "T set");
    expect(byId("a").data.units[1]).toBe("K");
    expect(column(byId("b"), 1)).toEqual([310, 310]);

    useApp.getState().undo();
    useApp.getState().undo();
    expect(byId("a").data.metadata).toEqual(A.data.metadata);
    expect(byId("a").raw!.metadata).toEqual(A.data.metadata);
    expect(byId("b").data.metadata).toEqual(B.data.metadata);
  });

  it("refuses when nothing would change, and replays a recorded cleanup", async () => {
    await expect(applyMetadataCleanup(useApp.getState, ["c"], { unify: [], normalize: [] })).rejects.toThrow(/nothing to change/);
    await applyMetadataCleanup(useApp.getState, ["a"], { unify: [{ to: "temperature", from: [["T"]] }], normalize: [] });
    const steps = useApp.getState().macroSteps;
    expect(steps.map((s) => s.params.op)).toEqual(["metaclean"]);
    useApp.getState().stopMacro();
    useApp.setState({ datasets: [...useApp.getState().datasets, { id: "e", name: "e.dat", data: data({ T: "5 K" }) }] });
    const { log } = await executeSteps(saved(steps), "e");
    expect(Object.values(log)[0].status).toBe("ok");
    expect(byId("e").data.metadata).toMatchObject({ temperature: "5 K" });
  });
});

describe("merge source factor", () => {
  it("adds a categorical column naming each row's input, recorded and replayed", async () => {
    const out = await runTransform(useApp.getState, { op: "merge", with: [{ id: "b", name: "b.dat" }], sourceFactor: "source" }, "a", async () => true);
    const merged = byId(out!.id);
    expect(merged.data.labels).toEqual(["M", "source"]);
    expect(merged.data.cat_levels?.[1]).toEqual(["a.dat", "b.dat"]);
    expect(column(merged, 1)).toEqual([0, 0, 0, 1, 1]);
    const steps = useApp.getState().macroSteps;
    expect(steps[0].params.sourceFactor).toBe("source");
    useApp.getState().stopMacro();
    const { log, target } = await executeSteps(saved(steps), "a");
    expect(Object.values(log)[0].status).toBe("ok");
    expect(byId(target).data).toEqual(merged.data);
  });

  it("carries a promoted factor through a by-name merge (so each row keeps its sample)", async () => {
    await promoteFactor(useApp.getState, ["a", "b"], ["sample"], "auto", "sample");
    const out = await runTransform(useApp.getState, { op: "merge", with: [{ id: "b", name: "b.dat" }], match: "name" }, "a", async () => true);
    const merged = byId(out!.id).data;
    const c = merged.labels.indexOf("sample");
    expect(merged.cat_levels?.[c]).toEqual(["S1", "S2"]);
    expect(merged.values.map((r) => merged.cat_levels![c][r[c]])).toEqual(["S1", "S1", "S1", "S2", "S2"]);
  });
});

describe("recorded params validation", () => {
  it("accepts well-formed steps and names what is wrong otherwise", () => {
    expect(transformParamsOf({ op: "promote", path: ["instrument", "SAMPLE"], as: "numeric", name: "m" })).toEqual({
      op: "promote",
      path: ["instrument", "SAMPLE"],
      as: "numeric",
      name: "m",
    });
    expect(() => metaParamsOf({ op: "promote", path: [], as: "numeric", name: "m" })).toThrow(/path/);
    expect(() => metaParamsOf({ op: "promote", path: ["a"], as: "text", name: "m" })).toThrow(/factor type/);
    expect(() => metaParamsOf({ op: "metaclean", unify: [{ to: "x", from: "T" }] })).toThrow(/unify rule/);
    expect(() => metaParamsOf({ op: "metaclean", normalize: [{ key: "x", letterCase: "title" }] })).toThrow(/normalize rule/);
    expect(transformParamsOf({ op: "merge", with: [{ id: "b" }], sourceFactor: "  " })).toEqual({ op: "merge", with: [{ id: "b", name: "b" }] });
  });
});
