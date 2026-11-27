// Plot setup through the real store: the role grid applies as one undo step,
// "Plot selection" plots directly when the X is unambiguous and opens the
// grid, seeded with the selection, when it is not (plan item 43).

import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import { useWorksheetView } from "../../Stage/worksheet/useWorksheetView";
import PlotSetupDialog from "./PlotSetupDialog";

const labels = ["X1", "Y1", "dY1", "X2", "Y2"];
const book = (columnDesignations: Dataset["columnDesignations"]): Dataset => ({
  id: "d1",
  name: "book",
  data: { time: [0, 1, 2], values: [1, 2, 3].map((r) => labels.map((_, c) => r * (c + 1))), labels, units: labels.map(() => ""), metadata: {} },
  errorRoles: [],
  columnDesignations,
});

function reset(ds: Dataset) {
  useFigureDialog.setState({ open: null });
  useApp.setState({ datasets: [ds], activeId: "d1", xKey: null, yKeys: null, pointLabels: null, stageTab: "worksheet", plotWindows: [], selection: null, worksheetSelections: {} });
}

const pick = (name: string) => fireEvent.click(screen.getByLabelText(name));

describe("Plot setup dialog", () => {
  beforeEach(() => reset(book({ 0: "X", 3: "X" })));

  it("starts from the plot, and Apply writes X, Y, error and label as one undo step", () => {
    const onClose = () => undefined;
    render(<PlotSetupDialog onClose={onClose} />);
    pick("X1: X");
    pick("Y1: Y");
    pick("dY1: Y err");
    pick("Y2: Y");
    pick("X2: Label");
    const before = useApp.getState().history.length;
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const s = useApp.getState();
    expect(s.xKey).toBe(0);
    expect(s.yKeys).toEqual([1, 4]);
    expect(s.datasets[0].errorRoles).toEqual([{ channel: 2, target: 1, axis: "y", side: "both" }]);
    expect(s.pointLabels).toMatchObject({ key: 3, mode: "all" });
    expect(s.datasets[0].columnDesignations).toEqual({ 0: "X", 3: "X" }); // designations untouched
    expect(s.history.length).toBe(before + 1);
    act(() => s.undo());
    expect(useApp.getState().yKeys).toBeNull();
    expect(useApp.getState().datasets[0].errorRoles).toEqual([]);
  });

  it("Apply stays disabled, with the reason shown, until an X and a Y are chosen", () => {
    render(<PlotSetupDialog seed={{ datasetId: "d1", cols: [1], mode: "replace" }} onClose={() => undefined} />);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Choose an X column (or the sheet's own X).")).toBeTruthy();
    pick("X2: X");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("the plot list shows each plot's columns and its row window", () => {
    act(() => {
      useApp.getState().focusWindow(useApp.getState().createWindow("d1"));
      useApp.setState({ xKey: 0, yKeys: [1, 4], rowRange: { from: 1, to: 2 } });
    });
    render(<PlotSetupDialog onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Plot list" }));
    expect(screen.getByText("Y1, Y2")).toBeTruthy();
    expect(screen.getByText("rows 2-3 of 3")).toBeTruthy();
  });
});

describe("Plot selection through the worksheet command", () => {
  it("one designated X: plots directly, no picker", () => {
    reset(book({ 0: "X" }));
    const ds = useApp.getState().datasets[0];
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.setColSelection([1, 4]));
    act(() => result.current.plotSelection());
    expect(useApp.getState().xKey).toBe(0);
    expect(useApp.getState().yKeys).toEqual([1, 4]);
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("competing X columns: opens the picker, seeded, and changes nothing", () => {
    reset(book({ 0: "X", 3: "X" }));
    const ds = useApp.getState().datasets[0];
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.setColSelection([1, 4]));
    act(() => result.current.plotSelection());
    expect(useApp.getState().yKeys).toBeNull();
    expect(useFigureDialog.getState().open).toEqual({ kind: "plotSetup", seed: { datasetId: "d1", cols: [1, 4], mode: "replace" } });
    render(<PlotSetupDialog seed={{ datasetId: "d1", cols: [1, 4], mode: "replace" }} onClose={() => undefined} />);
    expect((screen.getByLabelText("Y1: Y") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Y2: Y") as HTMLInputElement).checked).toBe(true);
  });
});
