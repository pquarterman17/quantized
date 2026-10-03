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
    history: [],
    future: [],
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

  it("escapes an expression step's name in exported script text", () => {
    render(<PipelinePanel />);
    const [nameField, exprField] = screen.getAllByRole("textbox");
    fireEvent.change(nameField, { target: { value: 'ratio "raw"' } });
    fireEvent.change(exprField, { target: { value: "A / 2" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Step" }));
    expect(useApp.getState().macroSteps[0].code).toBe('qz.addColumn("ratio \\"raw\\"", "A / 2")');
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
    expect(screen.getByRole("region", { name: "Last pipeline run" })).toHaveTextContent("2 completed · 0 warnings · 0 failed · 1 skipped");
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

  it("previews a structural edit, supports cancel, and restores the confirmed edit with undo", () => {
    useApp.setState({
      macroSteps: [
        makeStep("transform", "Stack", "qz.stack()", { op: "stack", channels: [0] }),
        makeStep("fit", "Fit Linear", 'qz.fit("Linear")', { model: "Linear" }),
      ],
    });
    render(<PipelinePanel />);
    expect(screen.getByText("Changes the pipeline dataset for 1 later enabled step.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("delete step")[0]);
    expect(screen.getByRole("group", { name: "Remove “Stack”?" })).toHaveTextContent("1 later enabled step");
    expect(useApp.getState().macroSteps).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Remove “Stack”?" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("delete step")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(useApp.getState().macroSteps.map((step) => step.label)).toEqual(["Fit Linear"]);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().macroSteps.map((step) => step.label)).toEqual(["Stack", "Fit Linear"]);
  });

  it("duplicates a step next to its source with independent params and one undo entry", () => {
    const original = makeStep("transform", "Stack", "qz.stack()", {
      op: "stack", channels: [0, 1], nested: { keep: true },
    });
    useApp.setState({ macroSteps: [original] });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByTitle("duplicate step"));

    const [source, copy] = useApp.getState().macroSteps;
    expect(copy.id).not.toBe(source.id);
    expect(copy.label).toBe("Stack copy");
    expect(copy.params).toEqual(source.params);
    expect(copy.params).not.toBe(source.params);
    expect(copy.params.nested).not.toBe(source.params.nested);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().macroSteps).toEqual([original]);
  });

  it("drops recorded output ids when duplicating a creating transform", () => {
    const original = makeStep("transform", "Split", "qz.split()", {
      op: "split", col: 0, tolerance: null,
      outputs: [{ id: "old-child", name: "old child", key: "one" }],
    });
    useApp.setState({ macroSteps: [original] });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByTitle("duplicate step"));
    expect(useApp.getState().macroSteps[0].params.outputs).toEqual(original.params.outputs);
    expect(useApp.getState().macroSteps[1].params.outputs).toBeUndefined();
  });

  it("blocks execution before an invalid step can mutate the worksheet", () => {
    useApp.setState({
      macroSteps: [makeStep("expression", "Bad", "qz.add()", { name: "bad", expr: "Q + 1" })],
    });
    render(<PipelinePanel />);
    const run = screen.getByRole("button", { name: /Run on scan/ });
    expect(run).toBeDisabled();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText('unknown variable "Q"')).toBeInTheDocument();
    expect(useApp.getState().datasets[0].data.labels).toEqual(["I"]);
  });

  it("describes a promote/metaclean transform step as in-place, others as derived (finding #7)", () => {
    useApp.setState({
      macroSteps: [
        makeStep("transform", "Promote metadata sample", 'qz.transform("promote", "<active>", {})', {
          op: "promote",
          path: ["sample"],
          as: "categorical",
          name: "sample",
        }),
        makeStep("transform", "Join scan with other (inner)", 'qz.transform("join", "<active>", {})', {
          op: "join",
          leftKey: 0,
          rightKey: 0,
          mode: "inner",
          with: { id: "x", name: "other" },
        }),
      ],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByText("Promote metadata sample"));
    expect(screen.getByText(/Edits the current dataset in place/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Promote metadata sample")); // deselect
    fireEvent.click(screen.getByText("Join scan with other (inner)"));
    expect(screen.getByText(/Derives a new dataset from the current one/)).toBeInTheDocument();
  });

  it("failure isolation: a runtime failure is logged and the run continues", async () => {
    fitMock.mockRejectedValue(new Error("backend fit failed"));
    useApp.setState({
      macroSteps: [
        makeStep("fit", "Fit Linear", 'qz.fit("Linear")', { model: "Linear" }),
        makeStep("ui", "Y axis log", "qz.setYLog(true)"),
      ],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run on scan/ }));
    await waitFor(() => expect(screen.getByText("backend fit failed")).toBeInTheDocument());
    expect(screen.getByText("ui step")).toBeInTheDocument(); // later step still ran
  });

  it("keeps per-step logs when a transform activates its newly-created output", async () => {
    useApp.setState({
      macroSteps: [
        makeStep("transform", "Transpose", "qz.transpose()", { op: "transpose" }),
        makeStep("expression", "Bad after transform", "qz.add()", { name: "bad", expr: "Q + 1" }),
      ],
    });
    render(<PipelinePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run on scan/ }));

    await waitFor(() => expect(screen.getByText(/unknown variable "Q"/)).toBeInTheDocument());
    expect(useApp.getState().activeId).not.toBe("d1");
    expect(screen.getByRole("region", { name: "Last pipeline run" })).toHaveTextContent("1 completed · 0 warnings · 1 failed");
  });
});
