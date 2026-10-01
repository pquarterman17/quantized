// Cell-text hits in Find in project (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4's
// booked follow-up). A hit names a (dataset, column) with how many rows match,
// and opening it reveals the first matching row in the worksheet.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import SearchPanel from "./SearchPanel";
import { useApp } from "../../../store/useApp";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
import type { Dataset } from "../../../lib/types";

const ds = (id: string, name: string, textColumns?: Record<string, unknown[]>): Dataset => ({
  id,
  name,
  data: {
    time: [0, 1, 2, 3],
    values: [[1], [2], [3], [4]],
    labels: ["Rxy"],
    units: [""],
    metadata: textColumns ? { text_columns: textColumns } : {},
  },
});

const type = (v: string) =>
  fireEvent.change(screen.getByPlaceholderText(/dataset, column/), { target: { value: v } });

beforeEach(() => {
  useApp.setState({
    datasets: [
      ds("d1", "hall.dat", { SampleID: ["Pt-1", "NbAu-7", "Pt-2", "NbAu-9"] }),
      ds("d2", "other.dat"),
    ],
    folders: [],
    reports: [],
    originFigures: [],
    activeId: "d2",
    stageTab: "plot",
    searchOpen: true,
    status: "",
    selection: null,
    revealTarget: null,
  });
  useWorksheetReveal.setState({ rowReveal: null });
});

describe("SearchPanel — text cells", () => {
  it("finds a value inside a text column, with its match count", () => {
    render(<SearchPanel />);
    type("nbau");
    const hit = screen.getByRole("button", { name: /SampleID/ });
    expect(hit).toHaveTextContent("NbAu-7");
    expect(hit).toHaveTextContent("2 rows");
  });

  it("REVEALS the first matching row: activates, shows in Library, opens the worksheet, selects the row", () => {
    render(<SearchPanel />);
    type("nbau");
    fireEvent.click(screen.getByRole("button", { name: /SampleID/ }));
    const s = useApp.getState();
    expect(s.activeId).toBe("d1");
    expect(s.revealTarget).toBe("d1");
    expect(s.stageTab).toBe("worksheet");
    expect(s.selection).toEqual({ datasetId: "d1", rows: [1] });
    // …and asks the worksheet to scroll that row (and its column) into view.
    expect(useWorksheetReveal.getState().rowReveal).toMatchObject({ datasetId: "d1", row: 1, column: "SampleID" });
    expect(s.status).toContain("row 2");
    expect(s.searchOpen).toBe(false);
  });

  it("lists EVERY matching column — the project-hit limit does not apply to cells", () => {
    const many = Array.from({ length: 60 }, (_, i) => ds(`m${i}`, `run${i}.dat`, { Note: [`sample ${i}`] }));
    useApp.setState({ datasets: many });
    render(<SearchPanel />);
    type("sample");
    expect(screen.getAllByRole("button", { name: /Note/ })).toHaveLength(60);
  });

  it("does not select a row on a still-sampled preview, whose row numbers are not real rows", () => {
    const pending = {
      ...ds("d1", "book", { A: ["x", "target"] }),
      pending: { kind: "path" as const, path: "p.opju", bookId: "b", rows: 2, cols: 1 },
    };
    useApp.setState({ datasets: [pending], ensureBookData: () => undefined });
    render(<SearchPanel />);
    type("target");
    fireEvent.click(screen.getByRole("button", { name: /A/ }));
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().selection).toBeNull();
    expect(useWorksheetReveal.getState().rowReveal).toBeNull();
  });

  it("says no matches only when cells do not match either", () => {
    render(<SearchPanel />);
    type("zzzz");
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
    type("nbau-9");
    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument();
  });
});
