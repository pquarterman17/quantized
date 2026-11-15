// Gap audit 3 N1: Layer Contents in one dialog — remove, reorder, re-bind
// (fail closed: a new source's Y must be picked) and add, applied as one
// undo step; Cancel changes nothing; "Add curve from…" opens it.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { buildPlotCommands } from "../../../commands/plotCommands";
import { plotSelectedTogether } from "../../../lib/plotSelectedTogether";
import type { Dataset } from "../../../lib/types";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import FigureDialogs from "./FigureDialogs";

const sheet = (id: string): Dataset => ({
  id,
  name: `S${id}`,
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["Y", "Z"], units: ["", ""], metadata: {} },
});

const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;
const curveIds = () => graph().linkedCurves!.map((k) => `${k.datasetId}${k.yKey}`);

function openFromCommand() {
  const cmd = buildPlotCommands(useApp.getState).find((c) => c.id === "add-curve-from")!;
  void cmd.run();
  render(<FigureDialogs />);
}

beforeEach(async () => {
  useFigureDialog.setState({ open: null });
  useApp.setState({ datasets: [sheet("a"), sheet("b"), sheet("c")], selectedIds: [], history: [], future: [] });
  await plotSelectedTogether(["a", "b"]);
  useApp.setState({ history: [], future: [] });
});

describe("Layer Contents dialog (N1)", () => {
  it("“Add curve from…” opens one dialog listing the graph's curves", () => {
    openFromCommand();
    expect(screen.getByRole("dialog", { name: "Layer Contents" })).toBeInTheDocument();
    const curves = within(screen.getAllByRole("list")[0]).getAllByRole("listitem");
    expect(curves.map((li) => li.textContent?.replace(/[↑↓✕]|Data…/g, ""))).toEqual(["Sa", "Sb"]);
  });

  it("removes, reorders and adds, then Apply commits one undo step", () => {
    openFromCommand();
    fireEvent.click(screen.getByRole("button", { name: "Move Curve 1 down" }));
    fireEvent.change(screen.getByLabelText("New curve dataset"), { target: { value: "c" } });
    // A new curve starts on the picked dataset's main channel, ready to add.
    expect((screen.getByLabelText("New curve Y") as HTMLSelectElement).value).toBe("0");
    fireEvent.change(screen.getByLabelText("New curve Y"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add curve" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Curve 2" })); // Sa, now second
    expect(curveIds()).toEqual(["a0", "b0"]); // nothing before Apply
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(curveIds()).toEqual(["b0", "c1"]);
    expect(useApp.getState().history).toHaveLength(1);
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("re-binding to another dataset clears Y and holds Apply until one is picked", () => {
    openFromCommand();
    fireEvent.click(screen.getByRole("button", { name: "Change data of Curve 1" }));
    fireEvent.change(screen.getByLabelText("Curve 1 dataset"), { target: { value: "c" } });
    expect((screen.getByLabelText("Curve 1 Y") as HTMLSelectElement).value).toBe("-1");
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
    expect(screen.getByText(/Curve 1: choose a Y column of “Sc”/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Curve 1 Y"), { target: { value: "1" } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(curveIds()).toEqual(["c1", "b0"]);
  });

  it("Cancel leaves the graph untouched", () => {
    openFromCommand();
    fireEvent.click(screen.getByRole("button", { name: "Remove Curve 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(curveIds()).toEqual(["a0", "b0"]);
    expect(useApp.getState().history).toHaveLength(0);
  });
});
