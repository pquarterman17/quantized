import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openCombineDialog, useCombineDialog } from "../../store/combineDialog";
import { useApp } from "../../store/useApp";
import type { Dataset } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import CombineWorkbooksDialog from "./CombineWorkbooksDialog";

vi.mock("../../store/toasts", () => ({ toast: vi.fn() }));

const wb = (id: string, name: string): WorkbookNode => ({ id, name });
const ds = (id: string, name: string, workbookId: string | undefined): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
});

beforeEach(() => {
  useCombineDialog.setState({ seed: null });
  useApp.setState({
    datasets: [ds("d1", "run1_field.dat", "w1"), ds("d2", "run1_temp.dat", "w1"), ds("d3", "run2_field.dat", "w2")],
    workbooks: [wb("w1", "run1"), wb("w2", "run2")],
    folders: [],
    history: [],
    future: [],
  });
});

describe("CombineWorkbooksDialog — visibility", () => {
  it("renders nothing when the dialog is closed", () => {
    const { container } = render(<CombineWorkbooksDialog />);
    expect(container.firstChild).toBeNull();
  });
});

describe("CombineWorkbooksDialog — selection + naming", () => {
  it("pre-fills the name from suggestCombinedWorkbookName when the seed's names share a prefix", () => {
    openCombineDialog({ workbookIds: [], worksheetIds: ["d1", "d2"] });
    render(<CombineWorkbooksDialog />);
    expect(screen.getByLabelText("Workbook name")).toHaveValue("run1_");
  });

  it("leaves the name blank when the seed's names share no clear prefix", () => {
    useApp.setState({
      datasets: [ds("d1", "run1_field.dat", "w1"), ds("d2", "xyz_temp.dat", "w1")],
    });
    openCombineDialog({ workbookIds: [], worksheetIds: ["d1", "d2"] });
    render(<CombineWorkbooksDialog />);
    expect(screen.getByLabelText("Workbook name")).toHaveValue("");
  });

  it("shows the collision-suffixed worksheet names that WILL result, visibly", () => {
    useApp.setState({
      datasets: [ds("d1", "A.dat", "w1"), ds("d2", "A.dat", "w2")],
      workbooks: [wb("w1", "run1"), wb("w2", "run2")],
    });
    openCombineDialog({ workbookIds: [], worksheetIds: ["d1", "d2"] });
    render(<CombineWorkbooksDialog />);
    const preview = document.querySelector(".qzk-combine-preview")!;
    expect(preview.textContent).toContain("A.dat");
    expect(preview.textContent).toContain("A.dat (2)");
  });

  it("unchecking an item removes it from the resulting-names preview", () => {
    openCombineDialog({ workbookIds: [], worksheetIds: ["d1", "d2"] });
    render(<CombineWorkbooksDialog />);
    fireEvent.click(screen.getByLabelText("run1_field.dat"));
    // Only one item left -> not a "combine" any more, suggestion collapses too.
    expect(screen.queryByText("run1_field.dat", { selector: ".qzk-combine-preview *" })).not.toBeInTheDocument();
  });

  it("Cancel closes with zero mutation", () => {
    openCombineDialog({ workbookIds: [], worksheetIds: ["d1", "d2"] });
    render(<CombineWorkbooksDialog />);
    const before = useApp.getState();
    fireEvent.click(screen.getByText("Cancel"));
    expect(useCombineDialog.getState().seed).toBeNull();
    expect(useApp.getState().workbooks).toBe(before.workbooks);
    expect(useApp.getState().datasets).toBe(before.datasets);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("Combine commits exactly the checked selection and closes", () => {
    openCombineDialog({ workbookIds: [], worksheetIds: ["d1", "d2"] });
    render(<CombineWorkbooksDialog />);
    fireEvent.change(screen.getByLabelText("Workbook name"), { target: { value: "Merged" } });
    fireEvent.click(screen.getByText("Combine"));
    expect(useCombineDialog.getState().seed).toBeNull();
    const s = useApp.getState();
    const newWb = s.workbooks.find((w) => w.name === "Merged");
    expect(newWb).toBeDefined();
    expect(s.datasets.find((d) => d.id === "d1")?.workbookId).toBe(newWb!.id);
    expect(s.datasets.find((d) => d.id === "d2")?.workbookId).toBe(newWb!.id);
  });

  it("Combine is disabled once fewer than one item remains checked", () => {
    openCombineDialog({ workbookIds: [], worksheetIds: ["d1"] });
    render(<CombineWorkbooksDialog />);
    fireEvent.click(screen.getByLabelText("run1_field.dat"));
    expect(screen.getByText("Combine")).toBeDisabled();
  });
});
