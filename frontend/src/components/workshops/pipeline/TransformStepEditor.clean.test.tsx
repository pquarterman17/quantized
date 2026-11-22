// Recorded Clean data steps in the Pipeline panel: their fields edit through
// the replay's own validator, a text-column key stays a name, and an invalid
// edit is refused inline.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep } from "../../../lib/pipeline";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import PipelinePanel from "./PipelinePanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const SRC: Dataset = {
  id: "src",
  name: "src.dat",
  data: { time: [0, 1], values: [[1, 2], [1, 2]], labels: ["a", "b"], units: ["", ""], metadata: { text_columns: { who: ["p", "p"] } } },
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [SRC], folders: [], activeId: "src", selectedIds: ["src"], pipelineOpen: true, macroRecording: false, macroSteps: [], pipelineRunning: false });
});

const step = (params: Record<string, unknown>, label: string) =>
  useApp.setState({ macroSteps: [makeStep("transform", label, "", { ...params, input: { id: "src", name: "src.dat" }, inputIsTarget: true })] });

describe("clean steps in the Pipeline panel", () => {
  it("dedupe: keys include X and text columns; Apply records them and the keep rule", async () => {
    step({ op: "dedupe", keys: [], keep: "first" }, "Remove duplicate rows (keep first) · src.dat");
    render(<PipelinePanel />);
    fireEvent.click(screen.getByText(/^Remove duplicate rows/));
    fireEvent.click(await screen.findByRole("checkbox", { name: "X (x)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "who (text column)" }));
    fireEvent.change(screen.getByLabelText("keep"), { target: { value: "last" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().macroSteps[0].params).toMatchObject({ op: "dedupe", keys: [-1, "who"], keep: "last" });
  });

  it("fillmissing: an emptied column list is refused inline", async () => {
    step({ op: "fillmissing", method: "linear", channels: [0] }, "Fill missing values (linear) · src.dat");
    render(<PipelinePanel />);
    fireEvent.click(screen.getByText(/^Fill missing values/));
    fireEvent.click(await screen.findByRole("checkbox", { name: "a" }));
    expect(screen.getByText(/at least one whole-number column/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "b" }));
    fireEvent.change(screen.getByLabelText("method"), { target: { value: "drop" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().macroSteps[0].params).toMatchObject({ method: "drop", channels: [1] });
  });
});
