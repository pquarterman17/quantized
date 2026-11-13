// Worksheet audit #15: the batch launcher opens the Recipe Library's apply
// section on a dialog's current setup; while a run is in flight it shows the
// per-item status live and a Cancel that aborts the run.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep } from "../../../lib/pipelineStep";
import { deriveExpectations } from "../../../lib/recipeExpect";
import { toTemplate } from "../../../lib/template";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import BatchApplyLauncher from "./BatchApplyLauncher";
import type { ApplyResult } from "./runTemplate";

const { applyMock } = vi.hoisted(() => ({ applyMock: vi.fn() }));
vi.mock("./runTemplate", () => ({ applyRecipe: applyMock }));

const sheet = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["v"], units: [""], metadata: {} },
});

const stackStep = makeStep("transform", "Stack", "", { op: "stack", channels: [0] });
const recipe = () => toTemplate("recipe", [stackStep], [], { expects: deriveExpectations([stackStep], sheet("a")) });

beforeEach(() => {
  applyMock.mockReset();
  useApp.setState({ datasets: [sheet("a"), sheet("b")], selectedIds: ["a", "b"], activeId: "a", pipelineRunning: false });
});

describe("BatchApplyLauncher", () => {
  it("runs the picked sheets with live per-item status, and Cancel aborts the run", async () => {
    let signal: AbortSignal | undefined;
    let progress!: (r: readonly ApplyResult[]) => void;
    let finish!: (r: ApplyResult[]) => void;
    applyMock.mockImplementation((_recipe, _plans, opts) => {
      signal = opts.signal;
      progress = opts.onProgress;
      return new Promise((resolve) => (finish = resolve));
    });
    render(<BatchApplyLauncher build={recipe} disabledReason="" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply to selected sheets…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply to 2 datasets" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel run" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Applying 1 of 2…" })).toBeDisabled();

    const first: ApplyResult = { datasetId: "a", name: "a.dat", status: "ok", note: "created “a out”" };
    act(() => progress([first]));
    expect(screen.getByRole("list", { name: "Apply results" })).toHaveTextContent("a.dat: created “a out”");
    expect(screen.getByRole("button", { name: "Applying 2 of 2…" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(signal?.aborted).toBe(true);
    await act(async () => finish([first, { datasetId: "b", name: "b.dat", status: "cancelled", note: "cancelled — not run" }]));
    expect(screen.getByRole("list", { name: "Apply results" })).toHaveTextContent("b.dat: cancelled — not run");
    expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull();
  });

  it("is disabled with the dialog's reason, and a refused setup says why", async () => {
    const { rerender } = render(<BatchApplyLauncher build={() => toTemplate("r", [], [])} disabledReason="Set up the operation first." />);
    expect(screen.getByRole("button", { name: "Apply to selected sheets…" })).toHaveAttribute("title", "Set up the operation first.");
    rerender(<BatchApplyLauncher build={() => { throw new Error("cannot batch this"); }} disabledReason="" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply to selected sheets…" }));
    expect(screen.getByRole("alert")).toHaveTextContent("cannot batch this");
  });
});
