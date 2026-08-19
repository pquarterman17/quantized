// RecodePanel — view wiring smoke test (the actual mapping/commit LOGIC is
// store/recode.test.ts's and lib/recode.test.ts's job). Uses the REAL
// useApp/useRecode stores (not mocked) since store/recode.ts's commitRecode
// calls useApp.getState()/setState() directly — the same shape
// store/relink.ts's commit does.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useRecode } from "../../../store/recode";
import { useApp } from "../../../store/useApp";
import RecodePanel from "./RecodePanel";

function catDataset(): Dataset {
  return {
    id: "d1",
    name: "grades.dat",
    data: {
      time: [0, 1, 2],
      values: [[0], [1], [2]],
      labels: ["Grade"],
      units: [""],
      metadata: {},
      cat_levels: { 0: ["Pass", "OK", "Fail"] },
    },
  };
}

beforeEach(() => {
  useApp.setState({ datasets: [catDataset()], activeId: "d1" });
  useRecode.setState({ open: false, datasetId: null, channel: null, mapping: { groups: [] }, newColumnName: "", savedMappings: [] });
});

describe("RecodePanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<RecodePanel />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the live old->new preview table and level count", () => {
    useRecode.getState().openRecode("d1", 0);
    render(<RecodePanel />);
    expect(screen.getByText(/3 levels/)).toBeInTheDocument();
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
  });

  it("editing a row's new-level field updates the draft mapping (live merge preview)", () => {
    useRecode.getState().openRecode("d1", 0);
    render(<RecodePanel />);
    fireEvent.change(screen.getByLabelText("new level for OK"), { target: { value: "Passing" } });
    fireEvent.blur(screen.getByLabelText("new level for OK"));
    expect(useRecode.getState().mapping.groups).toEqual([{ newLabel: "Passing", from: ["OK"] }]);
  });

  it("Commit appends a derived column and closes the panel", () => {
    useRecode.getState().openRecode("d1", 0);
    render(<RecodePanel />);
    fireEvent.change(screen.getByDisplayValue("Grade (recoded)"), { target: { value: "Result" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    const d = useApp.getState().datasets.find((x) => x.id === "d1")!;
    expect(d.data.labels).toEqual(["Grade", "Result"]);
    expect(useRecode.getState().open).toBe(false);
  });

  it("Find/Replace regenerates the draft mapping from the column's live levels", () => {
    useRecode.getState().openRecode("d1", 0);
    render(<RecodePanel />);
    fireEvent.change(screen.getByPlaceholderText("find"), { target: { value: "Fail" } });
    fireEvent.change(screen.getByPlaceholderText("replace with"), { target: { value: "Failed" } });
    fireEvent.click(screen.getByRole("button", { name: "Find/Replace" }));
    expect(useRecode.getState().mapping.groups).toEqual([{ newLabel: "Failed", from: ["Fail"] }]);
  });

  it("Save mapping then Apply on a matching column loads the mapping into the draft", () => {
    useRecode.getState().openRecode("d1", 0);
    render(<RecodePanel />);
    fireEvent.change(screen.getByLabelText("new level for OK"), { target: { value: "Passing" } });
    fireEvent.blur(screen.getByLabelText("new level for OK"));
    fireEvent.change(screen.getByPlaceholderText("save this mapping as…"), { target: { value: "OK->Passing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    expect(screen.getByText("OK->Passing")).toBeInTheDocument();

    // Reset the draft, then reapply the saved mapping.
    useRecode.setState({ mapping: { groups: [] } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useRecode.getState().mapping.groups).toEqual([{ newLabel: "Passing", from: ["OK"] }]);
  });
});
