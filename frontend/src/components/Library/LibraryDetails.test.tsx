import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import LibraryDetails from "./LibraryDetails";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

function dataset(id: string, name: string, order: number): Dataset {
  return {
    id,
    name,
    workbookId: "w",
    order,
    data: { time: [0, 1], values: [[1], [2]], labels: ["signal"], units: ["V"], metadata: {} },
  };
}

const datasets = [dataset("b", "beta.csv", 0), dataset("a", "alpha.csv", 1)];
const hierarchy = buildLibraryHierarchy({
  folders: [],
  workbooks: [{ id: "w", name: "Run" }],
  datasets,
});

beforeEach(() => {
  useApp.setState({
    datasets,
    workbooks: [{ id: "w", name: "Run" }],
    folders: [],
    selectedIds: [],
    librarySelection: null,
    activeId: null,
    expandedWorkbookIds: [],
  });
});

describe("LibraryDetails", () => {
  it("selects and opens the same canonical worksheet represented by its row", () => {
    render(<LibraryDetails hierarchy={hierarchy} />);
    const row = screen.getByText("beta.csv").closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(useApp.getState().selectedIds).toEqual(["b"]);
    expect(row).toHaveAttribute("aria-selected", "true");

    fireEvent.doubleClick(row!);
    expect(useApp.getState().activeId).toBe("b");
  });

  it("sorts visibly without losing the explicit route back to manual order", () => {
    render(<LibraryDetails hierarchy={hierarchy} />);
    const body = screen.getAllByRole("rowgroup")[1];
    expect(within(body).getAllByRole("row").map((row) => row.getAttribute("data-lib-row"))).toEqual([
      "workbook:w", "worksheet:b", "worksheet:a",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(within(body).getAllByRole("row").map((row) => row.getAttribute("data-lib-row"))).toEqual([
      "worksheet:a", "worksheet:b", "workbook:w",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Manual order" }));
    expect(within(body).getAllByRole("row").map((row) => row.getAttribute("data-lib-row"))).toEqual([
      "workbook:w", "worksheet:b", "worksheet:a",
    ]);
  });

  it("keeps location and dimensions in the compact Name cell for narrow panels", () => {
    render(<LibraryDetails hierarchy={hierarchy} />);
    const row = screen.getByText("beta.csv").closest("tr")!;
    const compact = row.querySelector(".qzk-details-name small");
    expect(compact).toHaveTextContent("Run · 2 × 1");
    expect(row.querySelectorAll(".qzk-details-medium")).toHaveLength(2);
    expect(row.querySelectorAll(".qzk-details-wide")).toHaveLength(4);
  });
});
