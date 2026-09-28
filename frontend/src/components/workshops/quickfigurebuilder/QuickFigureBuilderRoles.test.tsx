// Quick Figure Builder UI for the Label and Grouping roles (the six-role
// builder: X / Y / X error / Y error / label / grouping). The pure and store
// halves are pinned in lib/quickFigureRoles.test.ts and
// store/quickFigureRoles.test.ts; this file covers the panel wiring, the
// preview readout, the blocked-Label notice, and create-through-the-button.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import QuickFigureBuilderWorkspace from "./QuickFigureBuilderWorkspace";

vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const dataset: Dataset = {
  id: "g1",
  name: "samples.csv",
  data: {
    time: [0, 1, 2, 3],
    values: [[1, 0, 11, 0.1], [2, 1, 12, 0.2], [3, 0, 13, 0.3], [4, 1, Number.NaN, 0.4]],
    labels: ["R", "sample", "run", "R_err"],
    units: ["Ω", "", "", "Ω"],
    metadata: {},
    cat_levels: { 1: ["A", "B"] },
  },
};

beforeEach(() => {
  useApp.setState({
    datasets: [dataset],
    quickFigureBuilderDatasetId: "g1",
    editableFigures: [],
    plotWindows: [],
    quickPlotTemplates: [],
    cmdkOpen: false,
  });
});

const role = (label: string) => screen.getByRole("combobox", { name: `Role for ${label}` });

describe("QuickFigureBuilderWorkspace — Group by and Point labels roles", () => {
  it("every column's role menu offers Group by and Point labels", () => {
    render(<QuickFigureBuilderWorkspace />);
    const values = Array.from(role("sample").querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(["x", "y", "group", "label", "ignore", "error:x:-1:both"]));
  });

  it("assigning both roles updates the zones and the preview readout, and Create carries them into the figure", () => {
    render(<QuickFigureBuilderWorkspace />);
    fireEvent.change(role("sample"), { target: { value: "group" } });
    fireEvent.change(role("run"), { target: { value: "label" } });
    expect(role("sample")).toHaveValue("group");
    expect(role("run")).toHaveValue("label");

    const zones = screen.getByLabelText("Column role drop zones");
    expect(zones).toHaveTextContent("Group bysample");
    expect(zones).toHaveTextContent("Point labelsrun");
    expect(screen.getByText(/Grouped by "sample": 2 levels per Y series in the legend/)).toBeInTheDocument();
    expect(screen.getByText(/Error bars are not drawn while a Group by column is set/)).toBeInTheDocument();
    // Row 3's NaN run value gets no label: 3 labels, first three shown.
    expect(screen.getByText('3 point labels from "run" (11, 12, 13)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));
    const [doc] = useApp.getState().editableFigures;
    expect(doc.bindings.groupKey).toBe(1);
    expect(doc.bindings.yKeys).toEqual([0]);
    expect(doc.plot.view.annotations.map((a) => a.text)).toEqual(["11", "12", "13"]);
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
  });

  it("columns can be dragged into the Group by and Point labels zones", () => {
    render(<QuickFigureBuilderWorkspace />);
    const values = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };
    const zone = (name: string) =>
      Array.from(screen.getByLabelText("Column role drop zones").querySelectorAll(".qzk-quick-builder-zone"))
        .find((el) => el.querySelector("span")?.textContent === name)!;
    fireEvent.dragStart(screen.getByText("sample").closest("li")!, { dataTransfer });
    fireEvent.drop(zone("Group by"), { dataTransfer });
    fireEvent.dragStart(screen.getByText("run").closest("li")!, { dataTransfer });
    fireEvent.drop(zone("Point labels"), { dataTransfer });
    expect(role("sample")).toHaveValue("group");
    expect(role("run")).toHaveValue("label");
  });

  it("a Label column with nothing to label blocks Create with a named, described reason", () => {
    useApp.setState({
      datasets: [{ ...dataset, data: { ...dataset.data, values: dataset.data.values.map(([r, s, , e]) => [r, s, Number.NaN, e]) } }],
    });
    render(<QuickFigureBuilderWorkspace />);
    fireEvent.change(role("run"), { target: { value: "label" } });
    const create = screen.getByRole("button", { name: "Create Editable Figure" });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute("title", 'Label column "run" has no values on plotted points');
    expect(create).toHaveAttribute("aria-describedby", "quick-builder-label-warning");
    expect(document.getElementById("quick-builder-label-warning")).toHaveTextContent('Label column "run" has no values on plotted points.');
    expect(screen.getByRole("button", { name: "Save Quick Plot Template…" })).toBeDisabled();
    fireEvent.click(create);
    expect(useApp.getState().editableFigures).toEqual([]);
  });
});
