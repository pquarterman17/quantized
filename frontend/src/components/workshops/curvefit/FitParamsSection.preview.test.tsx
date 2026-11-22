// The initial-guess preview in the Curve Fit's start-value table: opt-in, drawn
// from the CURRENT start values, nudged by steppers, never a fit result, gone
// when a real fit lands, when it is switched off or when the panel closes.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autoGuess } from "../../../lib/api/curvefit";
import { rowsFromModel } from "../../../lib/fitParams";
import { getFitPreview, setFitPreview } from "../../../lib/fitPreviewSlot";
import type { Dataset, FitModel } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import FitParamsSection from "./FitParamsSection";
import type { FitPreviewInput } from "./useFitPreview";

vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
}));

const gaussian: FitModel = { name: "Gaussian", category: "peak", paramNames: ["A", "μ", "σ"], nParams: 3, p0: [1, 0, 1], lb: [], ub: [] };
const langevin: FitModel = { name: "Langevin", category: "magnetic", paramNames: ["Ms", "a"], nParams: 2, p0: [1, 1], lb: [], ub: [] };
const active = { id: "d1", name: "s", data: { time: [], values: [], labels: [], units: [], metadata: {} } } as unknown as Dataset;
const xy = { x: [0, 1, 2, 3], y: [0, 1, 2, 1], xKey: null };

const startOf = (name: string) => (screen.getByLabelText(`Start value of ${name}`) as HTMLInputElement).value;
function Harness({ model, input, previewProps = true }: { model: FitModel; input: Partial<FitPreviewInput>; previewProps?: boolean }) {
  const [rows, setRows] = useState(() => rowsFromModel(model));
  return (
    <FitParamsSection
      rows={rows}
      setRow={(i, patch) => setRows((r) => r.map((row, k) => (k === i ? { ...row, ...patch } : row)))}
      reset={() => setRows(rowsFromModel(model))}
      {...(previewProps ? { preview: { active, model, modelName: model.name, xy, landed: null, ...input } } : {})}
    />
  );
}
const open = () => fireEvent.click(screen.getByText(/Start values & bounds/));
const toggle = () => fireEvent.click(screen.getByLabelText("Preview initial guess on the plot"));
// The auto-start request is debounced: wait on the state it produces, not on time.
const drawn = () => waitFor(() => expect(getFitPreview()).not.toBeNull());

beforeEach(() => {
  vi.mocked(autoGuess).mockReset();
  vi.mocked(autoGuess).mockResolvedValue({ p0: [2, 1.5, 0.7] });
  useApp.setState({ xKey: null });
});
afterEach(() => setFitPreview(null));

describe("initial-guess preview", () => {
  it("is off by default: nothing is drawn and nothing is requested", async () => {
    render(<Harness model={gaussian} input={{}} />);
    open();
    expect(screen.getByLabelText("Preview initial guess on the plot")).not.toBeChecked();
    expect(getFitPreview()).toBeNull();
    expect(autoGuess).not.toHaveBeenCalled();
  });

  it("draws the model at the data-driven start for untouched rows, then at what the user types", async () => {
    render(<Harness model={gaussian} input={{}} />);
    open();
    toggle();
    await drawn();
    expect(getFitPreview()).toMatchObject({ datasetId: "d1", xKey: null, params: [2, 1.5, 0.7] });
    expect(getFitPreview()!.expr).toContain("exp(");
    fireEvent.change(screen.getByLabelText("Start value of μ"), { target: { value: "2.5" } });
    expect(getFitPreview()!.params).toEqual([2, 2.5, 0.7]); // typed start wins; the others stay auto
  });

  it("steppers nudge the start value (fine and coarse) and the curve follows", async () => {
    render(<Harness model={gaussian} input={{}} />);
    open();
    toggle();
    await drawn();
    fireEvent.click(screen.getByLabelText("Increase A (coarse)"));
    expect(startOf("A")).toBe("2.2");
    expect(getFitPreview()!.params[0]).toBeCloseTo(2.2, 12);
    fireEvent.click(screen.getByLabelText("Decrease A (fine)"));
    expect(startOf("A")).toBe("2.178");
  });

  it("says so, and draws nothing, for a model with no evaluable expression", async () => {
    render(<Harness model={langevin} input={{}} />);
    open();
    toggle();
    expect(screen.getByRole("status")).toHaveTextContent("No preview for Langevin");
    expect(getFitPreview()).toBeNull();
    expect(autoGuess).not.toHaveBeenCalled();
  });

  it("refuses an invalid start table instead of drawing from it", async () => {
    render(<Harness model={gaussian} input={{}} />);
    open();
    toggle();
    await drawn();
    fireEvent.change(screen.getByLabelText("Start value of A"), { target: { value: "oops" } });
    expect(getFitPreview()).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/No preview/);
  });

  it("is not drawn when the plot's X is not the fitted X", async () => {
    useApp.setState({ xKey: 4 });
    render(<Harness model={gaussian} input={{}} />);
    open();
    toggle();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/plot's X/));
    expect(getFitPreview()).toBeNull();
  });

  it("clears when a real fit lands, and returns on the next edit of a start value", async () => {
    const fit1 = { params: [1, 1, 1] };
    const { rerender } = render(<Harness model={gaussian} input={{ landed: null }} />);
    open();
    toggle();
    await drawn();
    expect(getFitPreview()).not.toBeNull();
    rerender(<Harness model={gaussian} input={{ landed: fit1 }} />);
    expect(getFitPreview()).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/fit landed/i);
    fireEvent.change(screen.getByLabelText("Start value of σ"), { target: { value: "0.9" } });
    expect(getFitPreview()!.params[2]).toBe(0.9);
  });

  it("is gone when switched off and when the panel closes", async () => {
    const { unmount } = render(<Harness model={gaussian} input={{}} />);
    open();
    toggle();
    await drawn();
    expect(getFitPreview()).not.toBeNull();
    toggle();
    expect(getFitPreview()).toBeNull();
    toggle();
    expect(getFitPreview()).not.toBeNull();
    unmount();
    expect(getFitPreview()).toBeNull();
  });

  it("never becomes a fit result: the store's fit overlay, fit recipe and results are untouched", async () => {
    useApp.setState({ fitOverlay: null, analysisResults: [] });
    const before = useApp.getState();
    render(<Harness model={gaussian} input={{}} />);
    open();
    toggle();
    await drawn();
    fireEvent.click(screen.getByLabelText("Increase A (fine)"));
    const after = useApp.getState();
    expect(after.fitOverlay).toBeNull();
    expect(after.analysisResults).toBe(before.analysisResults);
    expect(after.datasets).toBe(before.datasets);
  });

  it("a table without preview inputs never clears another instance's preview", async () => {
    render(<Harness model={gaussian} input={{}} />);
    open();
    toggle();
    await drawn();
    const other = render(<Harness model={gaussian} input={{}} previewProps={false} />);
    other.unmount();
    expect(getFitPreview()).not.toBeNull();
  });

  it("says why nothing is drawn while a waterfall offsets the plotted data", async () => {
    useApp.setState({ waterfall: 0.5 });
    render(<Harness model={gaussian} input={{}} />);
    open();
    toggle();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/waterfall/));
    expect(getFitPreview()).toBeNull();
    useApp.setState({ waterfall: 0 });
  });

  it("offers no control at all without preview inputs (other callers of the table)", () => {
    render(<Harness model={gaussian} input={{}} previewProps={false} />);
    open();
    expect(screen.queryByLabelText("Preview initial guess on the plot")).toBeNull();
  });
});
