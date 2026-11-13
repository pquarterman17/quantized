// "Output to worksheet" (audit #8): linked columns go through the undoable
// derived-column path; a model without a formula, or a fit not saved on the
// sheet, writes a result worksheet instead (bands only there).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBands } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { addDerivedColumn } from "../../../store/derivedColumnRun";
import { useApp } from "../../../store/useApp";
import FitOutputSection from "./FitOutputSection";

vi.mock("../../../store/derivedColumnRun", () => ({ addDerivedColumn: vi.fn(async () => ({ ok: true, message: "" })) }));
vi.mock("../../../lib/api/fitStats", () => ({ fitBands: vi.fn() }));

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  workbookId: "wb1",
  data: { time: [0, 1, 2], values: [[1], [3], [5]], labels: ["M"], units: [""], metadata: {} },
  fitSpec: { model: "Linear", params: [2, 1] },
};
const RESULT = { params: [2, 1], errors: [0.1, 0.1], covar: [[0.01, 0], [0, 0.01]], yFit: [1, 3, 5], residuals: [0, 0, 0], nPoints: 3, nFree: 2 };
const FIT = { x: [0, 1, 2], y: [1, 3, 5], xKey: null, yKey: 0, dy: null };

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [DS], activeId: "d1" });
});

describe("FitOutputSection", () => {
  it("adds linked fitted and residual formula columns to the source worksheet", async () => {
    render(<FitOutputSection dataset={DS} model="Linear" paramNames={["m", "b"]} result={RESULT} fitData={FIT} />);
    fireEvent.click(screen.getByText("Output to worksheet"));
    expect(screen.getByLabelText("Fit output destination")).toHaveValue("source");
    fireEvent.click(screen.getByRole("button", { name: "Write to worksheet" }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/^added "M fit" and "M residual" to run\.dat/));
    expect(addDerivedColumn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(addDerivedColumn).mock.calls.map((c) => c[1])).toEqual([
      { name: "M fit", expr: 'fitval("Linear", x)', propagate: false },
      { name: "M residual", expr: 'A - fitval("Linear", x)', propagate: false },
    ]);
    expect(screen.getByRole("checkbox", { name: "Confidence band" })).toBeDisabled();
  });

  it("writes a result worksheet with bands beside the source for a model without a formula", async () => {
    vi.mocked(fitBands).mockResolvedValue({ yFit: [1, 3, 5], ciLo: [0, 2, 4], ciHi: [2, 4, 6], piLo: [0, 0, 0], piHi: [9, 9, 9], level: 0.95 });
    const ds = { ...DS, fitSpec: { model: "Pseudo-Voigt", params: [1, 1, 1, 0.5] } };
    render(<FitOutputSection dataset={ds} model="Pseudo-Voigt" paramNames={["A", "x0", "w", "eta"]} result={RESULT} fitData={FIT} />);
    fireEvent.click(screen.getByText("Output to worksheet"));
    expect(screen.getByText(/has no worksheet formula/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Confidence band" }));
    fireEvent.click(screen.getByRole("button", { name: "Write to worksheet" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const added = useApp.getState().datasets[1]!;
    expect(added.workbookId).toBe("wb1");
    expect(added.data.labels).toEqual(["M", "M fit", "M residual", "95% CI low", "95% CI high"]);
    expect(vi.mocked(fitBands).mock.calls[0]![0]).toMatchObject({ model: "Pseudo-Voigt", x: [0, 1, 2], dof: 1 });
    expect(addDerivedColumn).not.toHaveBeenCalled();
  });

  it("adds the result worksheet without leaving the fitted one, as one undo step", async () => {
    const curve = { datasetId: "d1", y: [1, 3, 5] };
    const ds = { ...DS, fitSpec: { model: "Pseudo-Voigt", params: [1, 1, 1, 0.5] } };
    useApp.setState({ datasets: [ds], activeId: "d1", selectedIds: ["d1"], fitOverlay: curve, history: [], future: [] });
    render(<FitOutputSection dataset={ds} model="Pseudo-Voigt" paramNames={["A", "x0", "w", "eta"]} result={RESULT} fitData={FIT} />);
    fireEvent.click(screen.getByText("Output to worksheet"));
    fireEvent.click(screen.getByRole("button", { name: "Write to worksheet" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const s = useApp.getState();
    // Before the fix the new sheet became active: the plot rebound to it, the
    // fit curve was cleared and the panel re-targeted the sheet it had written.
    expect(s.activeId).toBe("d1");
    expect(s.selectedIds).toEqual(["d1"]);
    expect(s.fitOverlay).toBe(curve);
    expect(s.status).toBe('added the worksheet "run.dat — Pseudo-Voigt fit results" to the Library (Undo removes)');
    s.undo();
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().fitOverlay).toBe(curve);
  });
});
