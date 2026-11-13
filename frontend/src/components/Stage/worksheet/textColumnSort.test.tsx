// Review #2 item 8: a text column's header (Sample, Date) had no menu at all,
// so a worksheet could not be sorted by its text. It now offers Sort by text.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";

const sheet: Dataset = {
  id: "w",
  name: "w.csv",
  data: {
    time: [1, 2, 3],
    values: [[10], [20], [30]],
    labels: ["v"],
    units: [""],
    metadata: { text_columns: { Sample: ["S2", "", "S1"] } },
  },
};

beforeEach(() => useApp.setState({ datasets: [sheet], activeId: "w", history: [], future: [], status: "" }));

describe("text column header", () => {
  it("right-click offers Sort by text, which sorts the rows (blanks last) as one undo step", async () => {
    render(<WorksheetPane datasetId="w" />);
    const header = screen.getAllByRole("columnheader").find((h) => h.textContent?.startsWith("Sample"))!;
    fireEvent.contextMenu(header);
    fireEvent.click(screen.getByText("Sort ascending (by text)"));
    await waitFor(() => expect(useApp.getState().status).toMatch(/sorted 3 rows by "Sample" \(ascending\)/));
    expect(useApp.getState().datasets[0].data.time).toEqual([3, 1, 2]);
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["sort rows"]);
  });
});
