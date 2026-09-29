// The Quick Figure Builder asks before applying an adjacency-only (`low`)
// error pairing and explains a unit-`blocked` one (lib/errorBindingConfidence.ts,
// QuickErrorSuggestions.tsx). The grade itself is pinned in
// lib/errorBindingConfidence.test.ts; this covers the panel and that the
// created figure honours the answer.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import QuickFigureBuilderWorkspace from "./QuickFigureBuilderWorkspace";

vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

function sheet(labels: string[], units: string[]): Dataset {
  return {
    id: "e1",
    name: "refl.dat",
    data: { time: [0, 1, 2], values: [[1, 0.1], [2, 0.2], [3, 0.3]], labels, units, metadata: {} },
  };
}

function open(ds: Dataset): void {
  useApp.setState({ datasets: [ds], quickFigureBuilderDatasetId: ds.id, editableFigures: [], plotWindows: [], quickPlotTemplates: [] });
  render(<QuickFigureBuilderWorkspace />);
}

const create = () => fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));
const role = (label: string) => screen.getByRole("combobox", { name: `Role for ${label}` });

describe("Quick Figure Builder — error-pairing confidence", () => {
  beforeEach(() => useApp.setState({ editableFigures: [] }));

  it("holds back a position-only pairing and creates the figure without it unless confirmed", () => {
    open(sheet(["R", "err"], ["", ""]));
    const review = screen.getByRole("status", { name: "Suggested error pairings" });
    expect(review).toHaveTextContent('"err" → "R" is paired by column position alone');
    expect(role("err")).toHaveValue("ignore");
    create();
    const [doc] = useApp.getState().editableFigures;
    expect(doc.bindings.errors).toEqual([]);
    expect(doc.bindings.yKeys).toEqual([0]);
  });

  it("confirming applies the pairing, clears the question, and the figure carries it", () => {
    open(sheet(["R", "err"], ["", ""]));
    fireEvent.click(screen.getByRole("button", { name: "Use as error bars" }));
    expect(screen.queryByRole("status", { name: "Suggested error pairings" })).toBeNull();
    create();
    expect(useApp.getState().editableFigures[0].bindings.errors).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("a confirmed pairing is recorded on create, so the builder does not ask next time", () => {
    open(sheet(["R", "err"], ["", ""]));
    fireEvent.click(screen.getByRole("button", { name: "Use as error bars" }));
    create();
    const ds = useApp.getState().datasets[0];
    expect(ds.data.metadata.error_roles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    cleanup();
    useApp.setState({ quickFigureBuilderDatasetId: ds.id });
    render(<QuickFigureBuilderWorkspace />);
    expect(screen.queryByRole("status", { name: "Suggested error pairings" })).toBeNull();
    expect(role("err")).toHaveValue("error:y:0:both");
  });

  it("confirming then cancelling the builder records nothing", () => {
    open(sheet(["R", "err"], ["", ""]));
    fireEvent.click(screen.getByRole("button", { name: "Use as error bars" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useApp.getState().datasets[0].data.metadata.error_roles).toBeUndefined();
  });

  it("asks nothing when the units back the pairing", () => {
    open(sheet(["R", "err"], ["counts", "counts"]));
    expect(screen.queryByRole("status", { name: "Suggested error pairings" })).toBeNull();
    create();
    expect(useApp.getState().editableFigures[0].bindings.errors).toHaveLength(1);
  });

  it("explains a blocked pairing and offers no button for it", () => {
    open(sheet(["M", "M_err"], ["emu", "K"]));
    const review = screen.getByRole("status", { name: "Suggested error pairings" });
    expect(review).toHaveTextContent('"M_err" → "M" was not paired because their units contradict');
    expect(screen.queryByRole("button", { name: "Use as error bars" })).toBeNull();
  });
});
