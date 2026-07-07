import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PipelinePanel from "./PipelinePanel";
import { makeStep } from "../../../lib/pipeline";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

const { fitMock } = vi.hoisted(() => ({ fitMock: vi.fn() }));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: fitMock,
}));

const ds: Dataset = {
  id: "d1",
  name: "scan",
  data: {
    time: [1, 2, 3],
    values: [[10], [20], [30]],
    labels: ["I"],
    units: [""],
    metadata: {},
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    pipelineOpen: true,
    macroSteps: [],
    macroRecording: false,
    pipelineRunning: false,
  });
});

describe("PipelinePanel", () => {
  it("adds a validated expression step (#7) and rejects a bad one", () => {
    render(<PipelinePanel />);
    const [nameField, exprField] = screen.getAllByRole("textbox");

    fireEvent.change(nameField, { target: { value: "double" } });
    fireEvent.change(exprField, { target: { value: "A $ 2" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Step" }));
    expect(screen.getByText(/unexpected character/)).toBeInTheDocument();
    expect(useApp.getState().macroSteps).toHaveLength(0);

    fireEvent.change(exprField, { target: { value: "A * 2" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Step" }));
    const steps = useApp.getState().macroSteps;
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("expression");
    expect(steps[0].params).toEqual({ name: "double", expr: "A * 2" });
  });

  it("runs steps in order: expression applies, ui skips, edited fit re-runs", async () => {
    fitMock.mockResolvedValue({ params: [1], R2: 0.5 });
    useApp.setState({
      macroSteps: [
        makeStep("expression", "Add column d", 'qz.addColumn("d", "A * 2")', {
          name: "d",
          expr: "A * 2",
        }),
        makeStep("ui", "Y axis log", "qz.setYLog(true)"),
        makeStep("fit", "Fit Linear", 'qz.fit("Linear")', { model: "Linear" }),
      ],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run on scan/ }));

    await waitFor(() => expect(screen.getByText(/fit R²=0.5/)).toBeInTheDocument());
    // expression ran: the computed column landed on the dataset
    const d1 = useApp.getState().datasets[0];
    expect(d1.data.labels).toContain("d");
    expect(d1.data.values[0]).toEqual([10, 20]);
    // ui step skipped with a note
    expect(screen.getByText("ui step")).toBeInTheDocument();
    // fit ran with the typed model param
    expect(fitMock).toHaveBeenCalledWith(expect.objectContaining({ model: "Linear" }));
    // and the run did NOT re-record itself
    expect(useApp.getState().macroSteps).toHaveLength(3);
  });

  it("editing a fit step's model through the schema form regenerates label + code", () => {
    useApp.setState({
      macroSteps: [makeStep("fit", "Fit Linear", 'qz.fit("Linear")', { model: "Linear" })],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByText("Fit Linear")); // select the row
    const modelField = screen
      .getAllByRole("textbox")
      .find((el) => (el as HTMLInputElement).value === "Linear")!;
    fireEvent.change(modelField, { target: { value: "Gaussian" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const step = useApp.getState().macroSteps[0];
    expect(step.params.model).toBe("Gaussian");
    expect(step.label).toBe("Fit Gaussian");
    expect(step.code).toBe('qz.fit("Gaussian")');
  });

  it("toggle, reorder, and delete edit the shared step list", () => {
    useApp.setState({
      macroSteps: [
        makeStep("ui", "one", "qz.one()"),
        makeStep("ui", "two", "qz.two()"),
      ],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getAllByTitle("move down")[0]);
    expect(useApp.getState().macroSteps.map((s) => s.label)).toEqual(["two", "one"]);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(useApp.getState().macroSteps[0].enabled).toBe(false);
    fireEvent.click(screen.getAllByTitle("delete step")[1]);
    expect(useApp.getState().macroSteps.map((s) => s.label)).toEqual(["two"]);
  });

  it("failure isolation: a bad step logs failed and the run continues", async () => {
    useApp.setState({
      macroSteps: [
        makeStep("expression", "Add column bad", 'qz.addColumn("bad", "Q + 1")', {
          name: "bad",
          expr: "Q + 1", // unknown channel — fails at run time
        }),
        makeStep("ui", "Y axis log", "qz.setYLog(true)"),
      ],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run on scan/ }));
    await waitFor(() => expect(screen.getByText(/unknown variable/)).toBeInTheDocument());
    expect(screen.getByText("ui step")).toBeInTheDocument(); // later step still ran
  });
});
