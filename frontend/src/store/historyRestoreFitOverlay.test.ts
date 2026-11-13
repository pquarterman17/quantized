// Undo/redo and the drawn fit curve (fitting review). The curve (`fitOverlay`)
// is not in the undo snapshot; a restore used to clear it whenever ANY dataset
// differed, so undoing the Curve Fit's own "add fit columns" — an edit the fit
// never depended on — wiped the curve while the fit, its recipe and the
// panel's numbers stayed. It now survives while its worksheet comes back with
// the same saved fit and row count, and is still cleared otherwise.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset, FitSpec } from "../lib/types";
import { useApp } from "./useApp";

const SPEC: FitSpec = { model: "Linear", params: [2, 1] };
const base = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d1",
  name: "run.dat",
  data: { time: [0, 1, 2], values: [[1], [3], [5]], labels: ["y"], units: [""], metadata: {} },
  fitSpec: SPEC,
  ...over,
});
const CURVE = { datasetId: "d1", y: [1, 3, 5] };

function editThenUndo(before: Dataset, after: Dataset): void {
  useApp.setState({ datasets: [before], activeId: "d1", history: [], future: [], fitOverlay: CURVE });
  useApp.getState().recordHistory("edit");
  useApp.setState({ datasets: [after] });
  useApp.getState().undo();
}

beforeEach(() => {
  useApp.setState({ datasets: [], history: [], future: [], fitOverlay: null });
});

describe("undo keeps a fit curve whose fit it did not touch", () => {
  it("keeps the curve when a column was added beside the fit, and on the redo", () => {
    const before = base();
    const widened = base({ data: { ...before.data, values: [[1, 1], [3, 3], [5, 5]], labels: ["y", "y fit"], units: ["", ""] } });
    editThenUndo(before, widened);
    expect(useApp.getState().datasets[0]).toBe(before);
    // Before the fix: null.
    expect(useApp.getState().fitOverlay).toBe(CURVE);
    useApp.getState().redo();
    expect(useApp.getState().fitOverlay).toBe(CURVE);
  });

  it("keeps the curve when another worksheet was added", () => {
    const before = base();
    useApp.setState({ datasets: [before], activeId: "d1", history: [], future: [], fitOverlay: CURVE });
    useApp.getState().recordHistory("add worksheet");
    useApp.setState({ datasets: [before, base({ id: "d2", name: "results", fitSpec: undefined })] });
    useApp.getState().undo();
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().fitOverlay).toBe(CURVE);
  });

  it("clears the curve when the restore changes the saved fit", () => {
    const before = base();
    editThenUndo(before, base({ fitSpec: { model: "Linear", params: [9, 9] } }));
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("clears the curve when the restore changes the row count", () => {
    const longer = base({ data: { time: [0, 1, 2, 3], values: [[1], [3], [5], [7]], labels: ["y"], units: [""], metadata: {} } });
    // The curve drawn now has three rows; the restored worksheet has four.
    editThenUndo(longer, base());
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("clears a curve with no saved fit behind it, as before", () => {
    const before = base({ fitSpec: undefined });
    editThenUndo(before, base({ fitSpec: undefined, name: "renamed" }));
    expect(useApp.getState().fitOverlay).toBeNull();
  });
});
