// Audit P2.5 follow-up — editing a recorded `transform` step's parameters in
// the Pipeline panel. An edit is applied through the panel, re-run, and the
// result must (a) change, (b) equal running the transform directly with the
// edited parameters, (c) survive a .dwk save/reopen and (d) undo as one step.
// Structured params (a join's key mapping) get a note and an "Open in
// workshop" action instead of fields.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep } from "../../../lib/pipeline";
import { runTransform } from "../../../lib/transformRun";
import type { DataStruct, Dataset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { useTransformPreviewDialog } from "../../../store/transformPreviewDialog";
import { useApp } from "../../../store/useApp";
import { executeSteps } from "./executeSteps";
import PipelinePanel from "./PipelinePanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

// key, category, value — the last row repeats cell (1, 1), so the unstack
// aggregate decides what that cell holds: mean 54.5, last 99.
const main: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6],
  values: [
    [1, 1, 10],
    [1, 2, 20],
    [2, 1, 30],
    [2, 2, 40],
    [3, 1, 50],
    [3, 2, 60],
    [1, 1, 99],
  ],
  labels: ["key", "cat", "v"],
  units: ["", "", "emu"],
  metadata: {},
};
const SRC: Dataset = { id: "src", name: "src.dat", data: main };
const OTH: Dataset = { id: "oth", name: "oth.dat", data: { ...main, labels: ["key", "cat", "w"] } };

const UNSTACK = { op: "unstack", key: 0, category: 1, value: 2, aggregate: "mean" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [SRC, OTH],
    folders: [],
    activeId: "src",
    selectedIds: ["src"],
    pipelineOpen: true,
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
  });
});

const ids = () => new Set(useApp.getState().datasets.map((d) => d.id));
const byId = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;
const dataOf = (d: DataStruct) => ({ time: d.time, values: d.values, labels: d.labels, units: d.units });

/** Record the unstack exactly as the workshop does, then stop recording. */
async function recordUnstack(): Promise<void> {
  await runTransform(useApp.getState, UNSTACK, "src", async () => true);
  useApp.getState().stopMacro();
  useApp.setState({ activeId: "src" });
}

/** Click Run (on src) and return the ONE dataset the run created. */
async function runPanel(): Promise<Dataset> {
  act(() => useApp.setState({ activeId: "src" }));
  const before = ids();
  fireEvent.click(screen.getByRole("button", { name: /Run on src\.dat/ }));
  await waitFor(() => expect(useApp.getState().pipelineRunning).toBe(false));
  await waitFor(() => expect([...ids()].filter((id) => !before.has(id))).toHaveLength(1));
  return byId([...ids()].filter((id) => !before.has(id))[0]);
}

async function editAggregate(to: string): Promise<void> {
  fireEvent.click(screen.getByText(/^Unstack src\.dat/));
  const agg = await screen.findByLabelText("duplicate cells");
  fireEvent.change(agg, { target: { value: to } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
}

describe("PipelinePanel — editing transform step params", () => {
  it("edits an unstack's aggregate, re-runs, and the result changes to match a direct run", async () => {
    await recordUnstack();
    render(<PipelinePanel />);
    const beforeEdit = await runPanel();

    await editAggregate("last");
    const step = useApp.getState().macroSteps[0];
    expect(step.params).toMatchObject({ op: "unstack", aggregate: "last", inputIsTarget: true });
    expect(step.code).toContain('aggregate: "last"');

    const edited = await runPanel();
    expect(edited.data.values).not.toEqual(beforeEdit.data.values);
    expect(edited.data.values.flat()).toContain(99);

    // Parity: the workshop's own path with the same parameters.
    const direct = await runTransform(useApp.getState, { ...UNSTACK, aggregate: "last" }, "src", async () => true);
    expect(dataOf(edited.data)).toEqual(dataOf(byId(direct!.id).data));
  });

  it("an edit is one undo step, and redo re-applies it", async () => {
    await recordUnstack();
    render(<PipelinePanel />);
    await editAggregate("first");
    expect(useApp.getState().macroSteps[0].params.aggregate).toBe("first");
    act(() => useApp.getState().undo());
    expect(useApp.getState().macroSteps[0].params.aggregate).toBe("mean");
    act(() => useApp.getState().redo());
    expect(useApp.getState().macroSteps[0].params.aggregate).toBe("first");
  });

  it("an edited step survives a .dwk save and reopen and replays the edit", async () => {
    await recordUnstack();
    render(<PipelinePanel />);
    await editAggregate("last");
    const edited = await runPanel();

    const st = useApp.getState();
    const loaded = parseWorkspace(serializeWorkspace({ datasets: [SRC, OTH], macroSteps: st.macroSteps }));
    expect(loaded.macroSteps[0].params).toMatchObject({ aggregate: "last" });
    expect(loaded.macroSteps[0].label).toBe(st.macroSteps[0].label);

    const before = ids();
    const { log, target } = await executeSteps(loaded.macroSteps, "src");
    expect(Object.values(log)[0].status).toBe("ok");
    expect(before.has(target)).toBe(false);
    expect(dataOf(byId(target).data)).toEqual(dataOf(edited.data));
  });

  it("refuses an invalid edit inline: Apply stays disabled", async () => {
    useApp.setState({
      macroSteps: [
        makeStep("transform", "Stack src.dat", 'qz.transform("stack", "<active>", {})', {
          op: "stack",
          channels: [1],
          input: { id: "src", name: "src.dat" },
          inputIsTarget: true,
        }),
      ],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByText("Stack src.dat"));
    const cat = await screen.findByRole("checkbox", { name: "cat" });
    fireEvent.click(cat); // untick the only stacked column
    expect(screen.getByText(/needs integer "channels"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "v" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().macroSteps[0].params.channels).toEqual([2]);
  });

  it("resample shows the fields its grid needs", async () => {
    useApp.setState({
      macroSteps: [
        makeStep("transform", "Resample src.dat", 'qz.transform("resample", "<active>", {})', {
          op: "resample",
          mode: "n_points",
          nPoints: 5,
          method: "linear",
          outOfRange: "nan",
          sortUnsorted: false,
        }),
      ],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByText("Resample src.dat"));
    expect(await screen.findByLabelText("points")).toHaveValue("5");
    fireEvent.change(screen.getByLabelText("grid"), { target: { value: "step" } });
    expect(screen.queryByLabelText("points")).toBeNull();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled(); // no step yet
    fireEvent.change(screen.getByLabelText("step"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().macroSteps[0].params).toMatchObject({ mode: "step", step: 0.5 });
  });

  it("a join's key mapping is not inlined: a note and Open in workshop", async () => {
    useApp.setState({
      macroSteps: [
        makeStep("transform", "Join src.dat with oth.dat (inner)", 'qz.transform("join", "<active>", {})', {
          op: "join",
          leftKey: 0,
          rightKey: 0,
          mode: "inner",
          with: { id: "oth", name: "oth.dat" },
          input: { id: "src", name: "src.dat" },
          inputIsTarget: true,
        }),
      ],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByText("Join src.dat with oth.dat (inner)"));
    expect(await screen.findByText(/Join keys and the right dataset are set in the workshop/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in workshop" }));
    expect(useTransformPreviewDialog.getState()).toMatchObject({ op: "join", seed: ["src", "oth"] });
    // The simple part (rows to retain) is still editable here.
    fireEvent.change(screen.getByLabelText("rows to retain"), { target: { value: "full" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const step = useApp.getState().macroSteps[0];
    expect(step.params).toMatchObject({ mode: "full", with: { id: "oth" } });
    expect(step.label).toBe("Join src.dat with oth.dat (full)");
  });
});
