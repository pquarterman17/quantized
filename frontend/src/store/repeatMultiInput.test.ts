// Repeat last action (plan item 37) through the real commit path: a single-input
// clean step re-runs on the selection, and a multi-input step (dataset math, an
// append) re-runs on the CURRENT selection when its shape matches and refuses
// with the count it needs when it does not. Reopen last dialog for menu-opened
// dialogs: the same-target check.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { noteDialog } from "../lib/dialogReopen";
import { lastOpenedDialog, noteCommand, repeatLastAction, resetLastActionForTests } from "../lib/lastAction";
import { runReopenLastDialog } from "../lib/repeatActions";
import { withInputs } from "../lib/repeatTransform";
import type { Dataset } from "../lib/types";
import { commitTransformOutput } from "./commitTransformOutput";
import { useApp } from "./useApp";

const { algebra } = vi.hoisted(() => ({ algebra: vi.fn() }));
vi.mock("../lib/api/datasetAlgebra", () => ({ datasetAlgebra: algebra }));

const sheet = (id: string, ys: number[]): Dataset => ({
  id, name: `${id}.dat`, data: { time: ys.map((_, i) => i), values: ys.map((y) => [y, y * 2]), labels: ["A", "B"], units: ["V", "V"], metadata: {} },
});
const created = () => useApp.getState().datasets.filter((d) => !["a", "b", "c", "d"].includes(d.id));

beforeEach(() => {
  vi.clearAllMocks();
  resetLastActionForTests();
  let n = 0;
  algebra.mockImplementation(async () => ({ time: [0, 1], values: [[3 + n], [4 + n++]], labels: ["A+B"], units: ["V"], metadata: {} }));
  useApp.setState({
    datasets: [sheet("a", [1, 2]), sheet("b", [3, 4]), sheet("c", [5, 6]), sheet("d", [7, 8])],
    activeId: "a", selectedIds: ["a"], macroRecording: false, macroSteps: [],
    analysisResults: [], history: [], future: [], staleDatasets: [], recalcMode: "manual", pipelineRunning: false,
  });
});

const algebraOf = (withId: string) => ({ op: "algebra" as const, operation: "A+B", interp: "linear", with: { id: withId, name: `${withId}.dat` } });

describe("repeat a single-input clean step", () => {
  it("registers through the commit path and re-runs on every selected dataset", async () => {
    await commitTransformOutput(useApp.getState, { op: "standardize", method: "zscore", channels: [0] }, "a");
    expect(created()).toHaveLength(1);
    useApp.setState({ selectedIds: ["b", "c"] });
    expect(await repeatLastAction()).toEqual({ ok: true, message: expect.stringMatching(/^repeated /) });
    expect(created()).toHaveLength(3);
  });
});

describe("repeat a multi-input step", () => {
  it("dataset math re-runs on the current two selected datasets, first = A", async () => {
    await commitTransformOutput(useApp.getState, algebraOf("b"), "a");
    expect(algebra).toHaveBeenCalledTimes(1);
    useApp.setState({ selectedIds: ["c", "d"], activeId: "c" });
    const r = await repeatLastAction();
    expect(r.ok).toBe(true);
    expect(algebra).toHaveBeenCalledTimes(2);
    const last = created().at(-1)!;
    expect(last.name).toContain("c");
    expect(last.name).toContain("d");
    expect(useApp.getState().history).toHaveLength(2); // one undo step each
  });

  it("refuses a selection of the wrong shape, with the count it needs, and creates nothing", async () => {
    await commitTransformOutput(useApp.getState, algebraOf("b"), "a");
    for (const ids of [["c"], ["b", "c", "d"]]) {
      useApp.setState({ selectedIds: ids });
      const r = await repeatLastAction();
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/combines 2 datasets: select exactly 2 .* not \d/);
    }
    expect(created()).toHaveLength(1);
    expect(algebra).toHaveBeenCalledTimes(1);
  });

  it("an append of three re-runs only on three", async () => {
    await commitTransformOutput(useApp.getState, { op: "merge", with: [{ id: "b", name: "b.dat" }, { id: "c", name: "c.dat" }] }, "a");
    useApp.setState({ selectedIds: ["d", "a"] });
    expect((await repeatLastAction()).message).toMatch(/select exactly 3/);
    useApp.setState({ selectedIds: ["d", "c", "b"] });
    expect((await repeatLastAction()).ok).toBe(true);
    expect(created()).toHaveLength(2);
  });

  it("a command run afterwards drops the repeat, as for single-input steps", async () => {
    await commitTransformOutput(useApp.getState, algebraOf("b"), "a");
    noteCommand({ id: "peaks", group: "Analyze", label: "Find peaks…", run: () => {} });
    expect((await repeatLastAction()).ok).toBe(false);
  });

  it("withInputs swaps every kind of recorded second input", () => {
    const x = { id: "x", name: "x" };
    const y = { id: "y", name: "y" };
    expect(withInputs({ op: "join", leftKey: -1, rightKey: -1, mode: "inner", with: y } as never, [x])).toMatchObject({ with: x });
    expect(withInputs({ op: "merge", with: [x, y] }, [y, x])).toMatchObject({ with: [y, x] });
    expect(withInputs({ op: "resample", mode: "match", method: "linear", with: y } as never, [x])).toMatchObject({ with: x });
    const spectral = { op: "signal", recipe: { kind: "spectral", secondarySource: { datasetId: "y", datasetName: "y", channel: { label: "R" }, xUnit: "" } } } as never;
    expect(withInputs(spectral, [x])).toMatchObject({ recipe: { secondarySource: { datasetId: "x", datasetName: "x", channel: { label: "R" } } } });
  });
});

describe("reopen a menu-opened dialog", () => {
  it("registers, then reopens only on the same sheet with the same column labels", () => {
    const open = vi.fn(async () => {});
    const ds = useApp.getState().datasets[0];
    noteDialog("Number format", ds, [0, 1], open);
    const entry = lastOpenedDialog()!;
    expect(entry.reopen()).toBeUndefined();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), [0, 1]);

    useApp.setState({ activeId: "b" });
    expect(entry.reopen()).toMatch(/select that sheet first/);

    useApp.setState({ activeId: "a", datasets: useApp.getState().datasets.map((d) => (d.id === "a" ? { ...d, data: { ...d.data, labels: ["A", "Z"] } } : d)) });
    expect(entry.reopen()).toMatch(/columns it was opened on have changed/);

    useApp.setState({ datasets: useApp.getState().datasets.filter((d) => d.id !== "a") });
    expect(entry.reopen()).toMatch(/no longer open/);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("a dialog command opened afterwards takes over, and the reverse", () => {
    noteDialog("Number format", useApp.getState().datasets[0], [0], async () => {});
    noteCommand({ id: "curvefit", group: "Analyze", label: "Curve fit…", run: () => {} });
    expect(lastOpenedDialog()).toBeNull();
    noteDialog("Set row count", useApp.getState().datasets[0], [], async () => {});
    expect(lastOpenedDialog()?.label).toBe("Set row count");
  });

  it("the Reopen action opens it, or says why it can't", () => {
    const open = vi.fn(async () => {});
    noteDialog("Number format", useApp.getState().datasets[0], [0], open);
    runReopenLastDialog();
    expect(open).toHaveBeenCalledTimes(1);
    useApp.setState({ activeId: "b" });
    runReopenLastDialog();
    expect(open).toHaveBeenCalledTimes(1);
    expect(useApp.getState().status).toMatch(/can't reopen Number format: it was opened on “a.dat”/);
  });
});
