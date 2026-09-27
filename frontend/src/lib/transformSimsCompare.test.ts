// P2.3 box 3 — the recordable `simscompare` transform: validation of a
// recorded step, the commit through lib/transformRun (one undo entry, one
// replayable step), a replay whose target has its columns in another order,
// a missing recorded profile refused by name, the stagger helper, and the
// comparison (with its blanks) surviving a .dwk round trip.

import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsCompareRequest, SimsCompareResult } from "./api/sims";
import { inputColumnRefs } from "./recipeExpect";
import { makeStep } from "./pipeline";
import { runTransform, transformParamsOf, transformStepText } from "./transformRun";
import { simsCompareParamsOf, staggerComparison, type SimsCompareParams } from "./transformSimsCompare";
import type { DataStruct } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { useApp } from "../store/useApp";

vi.mock("./api/sims", () => ({ compareSims: vi.fn(), processSims: vi.fn() }));
const { compareSims } = await import("./api/sims");

/** Stand-in for calc.sims_compare (row blocks, by-name species, null blanks). */
function fakeCompare(body: SimsCompareRequest): Promise<SimsCompareResult> {
  const cols: { label: string; block: number; v: number[] }[] = [];
  body.profiles.forEach((p, blk) => {
    for (const s of body.species) {
      const c = p.dataset.labels.indexOf(s);
      if (c >= 0) cols.push({ label: `${s} — ${p.name}`, block: blk, v: p.dataset.values.map((r) => r[c]) });
    }
  });
  const time = body.profiles.flatMap((p) => p.dataset.time);
  const starts = body.profiles.map((_, blk) => body.profiles.slice(0, blk).reduce((n, p) => n + p.dataset.time.length, 0));
  const values = time.map((_, row) => cols.map((c) => c.v[row - starts[c.block]] ?? null)) as number[][];
  return Promise.resolve({
    dataset: { time, values, labels: cols.map((c) => c.label), units: cols.map(() => "c/s"), metadata: { technique: "sims" } },
    warnings: [{ code: "x-converted", text: "depth converted", info: true }],
    traces: [],
  });
}

const p = (labels: string[], values: number[][]): DataStruct => ({
  time: values.map((_, i) => i), values, labels, units: labels.map(() => "c/s"), metadata: { x_column_unit: "nm" },
});
const A = p(["B", "Si"], [[1, 100], [2, 100]]);
const B = p(["Si", "B"], [[100, 7]]);
const C = p(["Si", "B"], [[100, 9], [100, 8]]); // a second "file" for the replay

const PARAMS: SimsCompareParams = { op: "simscompare", species: ["B"], with: [{ id: "b", name: "b.csv" }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(compareSims).mockImplementation(fakeCompare);
  useApp.setState({
    datasets: [
      { id: "a", name: "a.csv", data: A },
      { id: "b", name: "b.csv", data: B },
      { id: "c", name: "c.csv", data: C },
    ],
    folders: [],
    activeId: "a",
    selectedIds: ["a"],
    macroRecording: true,
    macroSteps: [],
    history: [],
    future: [],
    seriesStyles: {},
  });
});

const store = useApp.getState;

describe("simsCompareParamsOf", () => {
  it("round-trips and refuses malformed steps", () => {
    expect(simsCompareParamsOf(JSON.parse(JSON.stringify(PARAMS)))).toEqual(PARAMS);
    expect(() => simsCompareParamsOf({ species: [] })).toThrow("column names");
    expect(() => simsCompareParamsOf({ species: ["B"], with: "b" })).toThrow("other profiles");
    expect(() => simsCompareParamsOf({ species: ["B"], with: [{ name: "x" }] })).toThrow("no id");
  });

  it("declares its species as input columns read by name", () => {
    const step = makeStep("transform", "SIMS compare", "", { ...PARAMS, inputIsTarget: true });
    expect([...inputColumnRefs([step], ["Si", "B"]).cols]).toEqual([1]);
  });
});

describe("runTransform(simscompare)", () => {
  it("creates one undoable, recorded comparison; its replay picks B by NAME on a reordered file", async () => {
    const out = await runTransform(store, PARAMS, "a");
    const made = store().datasets.find((d) => d.id === out?.id)!;
    expect(made.name).toBe("a + 1 (SIMS comparison)");
    expect(made.data.labels).toEqual(["B — a.csv", "B — b.csv"]);
    expect(made.data.values.map((r) => r[1])).toEqual([Number.NaN, Number.NaN, 7]);
    expect(made.data.metadata).toMatchObject({ worksheet_transform: "simscompare", transform_warnings: ["depth converted"] });
    const [step] = store().macroSteps;
    expect(step.label).toBe("SIMS compare B across 2 profiles (a.csv, …)");
    expect(transformStepText(PARAMS, "a.csv").code).toContain('qz.transform("simscompare"');

    // Replay onto c (Si first): B is still B.
    const replayed = await runTransform(store, transformParamsOf(step.params as Record<string, unknown>), "c");
    const second = store().datasets.find((d) => d.id === replayed?.id)!;
    expect(second.data.values.map((r) => r[0]).slice(0, 2)).toEqual([9, 8]);
    act(() => store().undo());
    act(() => store().undo());
    expect(store().datasets.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("refuses a recorded profile that is no longer in the workspace, by name", async () => {
    await expect(
      runTransform(store, { ...PARAMS, with: [{ id: "gone", name: "old.csv" }] }, "a"),
    ).rejects.toThrow('the recorded input "old.csv" is not in this workspace');
  });

  it("the comparison, its blanks and its step survive a .dwk round trip", async () => {
    const out = await runTransform(store, PARAMS, "a");
    const back = parseWorkspace(serializeWorkspace({ datasets: store().datasets, macroSteps: store().macroSteps }));
    const made = back.datasets.find((d) => d.id === out?.id)!;
    expect(Number.isNaN(made.data.values[0][1])).toBe(true);
    const step = back.macroSteps?.find((s) => s.kind === "transform");
    expect(transformParamsOf(step?.params as Record<string, unknown>)).toEqual(PARAMS);
  });
});

describe("staggerComparison", () => {
  it("offsets trace c by c·k decades on a log axis, as one undo entry; a no-op off the plot", async () => {
    const out = await runTransform(store, PARAMS, "a");
    const h = store().history.length;
    const m = store().macroSteps.length;
    expect(staggerComparison(store, useApp.setState, out!.id, -1)).toBe(true);
    expect(store().seriesStyles).toEqual({ 0: { logOffset: 0 }, 1: { logOffset: -1 } });
    expect(store().yScale).toBe("log");
    expect(store().history).toHaveLength(h + 1);
    // Finding 7: the raw `set()` that flips `yScale` must still record the
    // SAME macro step `setYScale("log")` would, so a replay switches the
    // axis too, not just the offsets -- without pushing a SECOND history
    // entry (still exactly h + 1 above).
    const steps = store().macroSteps;
    expect(steps).toHaveLength(m + 1);
    expect(steps[steps.length - 1].code).toBe('qz.setYScale("log")');
    expect(staggerComparison(store, useApp.setState, out!.id, 0)).toBe(false);
    expect(staggerComparison(store, useApp.setState, "a", 2)).toBe(false); // not the plot's dataset
  });
});
