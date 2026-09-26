// P2.5 "Metadata → factors" survives a .dwk save → reopen: the promoted factor
// column (its values, level table AND its `factor` spec, so it still
// recomputes after reopen), the cleaned metadata with its provenance log, a
// merge's source column, and the recorded steps.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyMetadataCleanup, promoteFactor } from "./metadataRun";
import { runTransform } from "./transformRun";
import type { DataStruct, Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { useApp } from "../store/useApp";

vi.mock("../store/toasts", () => ({ toast: vi.fn() }));

const data = (metadata: Record<string, unknown>): DataStruct => ({
  time: [0, 1],
  values: [[1], [2]],
  labels: ["M"],
  units: ["emu"],
  metadata,
});

beforeEach(() => {
  useApp.setState({
    datasets: [
      { id: "a", name: "a.dat", data: data({ sample: "S1", Temp: " 300 K" }) },
      { id: "b", name: "b.dat", data: data({ Temp: "10 K" }) },
    ] as Dataset[],
    folders: [],
    activeId: "a",
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
  });
});

const byName = (name: string) => useApp.getState().datasets.find((d) => d.name === name)!;

describe("metadata factors round-trip a .dwk", () => {
  it("keeps the factor column, its spec, the cleaned metadata and the recorded steps", async () => {
    await applyMetadataCleanup(useApp.getState, ["a", "b"], {
      unify: [{ to: "temperature", from: [["Temp"]] }],
      normalize: [{ key: "temperature", trim: true, letterCase: "keep", units: true }],
    });
    await promoteFactor(useApp.getState, ["a", "b"], ["sample"], "auto", "sample");
    await promoteFactor(useApp.getState, ["a", "b"], ["temperature"], "auto", "T");
    await runTransform(useApp.getState, { op: "merge", with: [{ id: "b", name: "b.dat" }], sourceFactor: "source" }, "a", async () => true);
    const before = useApp.getState();
    const beforeA = byName("a.dat");
    const beforeMerged = byName("merged (2)");

    useApp.getState().loadWorkspace(parseWorkspace(serializeWorkspace(before)));

    const a = byName("a.dat");
    expect(a.data.labels).toEqual(["M", "sample", "T"]);
    expect(a.data.units).toEqual(["emu", "", "K"]);
    expect(a.data.values).toEqual(beforeA.data.values);
    expect(a.data.cat_levels?.[1]).toEqual(["S1"]);
    expect(a.formulas).toEqual(beforeA.formulas);
    expect(a.formulas?.[1].factor).toEqual({ source: "metadata", path: ["temperature"], as: "numeric", value: 300 });
    expect(a.data.metadata).toMatchObject({ temperature: 300, temperature_unit: "K" });
    expect((a.data.metadata.metadata_cleanup as { key: string; before: unknown }[]).map((e) => [e.key, e.before])).toEqual([
      ["temperature", null],
      ["Temp", " 300 K"],
      ["temperature_unit", null],
    ]);
    // b had no `sample`: still blank after reopen, not defaulted
    expect(byName("b.dat").data.values.every((r) => Number.isNaN(r[1]))).toBe(true);
    const merged = byName("merged (2)");
    expect(merged.data.labels).toEqual(beforeMerged.data.labels);
    expect(merged.data.cat_levels?.[merged.data.labels.indexOf("source")]).toEqual(["a.dat", "b.dat"]);
    expect(useApp.getState().macroSteps.map((s) => s.params.op)).toEqual(["metaclean", "promote", "promote", "merge"]);

    // The spec, not just the baked values, came back: a recompute after
    // reopen (adding another column recomputes every computed column from
    // the base) still produces the factor.
    useApp.getState().addFormula(a.id, "twice", "A*2");
    const again = byName("a.dat");
    expect(again.data.labels).toEqual(["M", "sample", "T", "twice"]);
    expect(again.data.values.map((r) => r.slice(1, 3))).toEqual([[0, 300], [0, 300]]);
    expect(again.data.cat_levels?.[1]).toEqual(["S1"]);
  });
});
