// B1 (acceptance pass 13): clicking a Name or Unit field bubbled to the row's pick handler, which
// opened the worksheet and moved focus there, so the first real key typed went to the grid. Driven with
// real focus and keystrokes (user-event), not fireEvent.change.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
import ColumnList from "./ColumnList";

const DS: Dataset = {
  id: "w", name: "Run 1",
  data: { time: [0, 1, 2], values: [[3, 30], [1, 10], [2, 20]], labels: ["Temp", "Field"], units: ["K", "Oe"], metadata: {} },
};

beforeEach(() => {
  useApp.setState({ datasets: [DS], activeId: "w", history: [], future: [], status: "" } as Partial<ReturnType<typeof useApp.getState>>);
  useWorksheetReveal.setState({ rowReveal: null });
});
afterEach(() => useWorksheetReveal.setState({ rowReveal: null }));

describe("Column list fields keep focus", () => {
  it("types a whole name after one click, keeping focus, and does not pick the row", async () => {
    render(<ColumnList datasetId="w" onClose={() => {}} />);
    const name = screen.getByLabelText("Name, column A");
    await userEvent.click(name);
    await userEvent.keyboard("{Control>}a{/Control}Renamed");
    expect(name).toHaveFocus();
    expect(name).toHaveValue("Renamed");
    expect(useWorksheetReveal.getState().rowReveal).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(useApp.getState().datasets[0].data.labels[0]).toBe("Renamed");
  });

  it("the unit field and the designation menu do not pick the row either", async () => {
    render(<ColumnList datasetId="w" onClose={() => {}} />);
    await userEvent.click(screen.getByLabelText("Unit, column B"));
    await userEvent.click(screen.getByLabelText("Designation, column B"));
    expect(useWorksheetReveal.getState().rowReveal).toBeNull();
  });

  it("a click on the row's own cells still selects the column in the worksheet", async () => {
    render(<ColumnList datasetId="w" onClose={() => {}} />);
    await userEvent.click(screen.getByLabelText("Name, column B").closest("tr")!.querySelector("td")!);
    expect(useWorksheetReveal.getState().rowReveal).toMatchObject({ datasetId: "w", column: 1, selectColumn: true });
  });
});
