// The worksheet's gutter bar (ROW_RANGE_CONTRACT 3.4): the rows the focused plot's row window covers get a bar beside
// their row number, by SOURCE row. Only a window that fits this sheet shows it; another sheet's window shows nothing.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";

const n = 48;
const mk = (id: string): Dataset => ({
  id, name: `${id}.dat`,
  data: { time: Array.from({ length: n }, (_v, i) => i), values: Array.from({ length: n }, (_v, i) => [i]), labels: ["A"], units: ["V"], metadata: {} },
});
const barred = () => screen.getAllByRole("rowheader").filter((h) => h.className.includes("qzk-rownum-win")).map((h) => h.textContent);

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [mk("d"), mk("e")], activeId: "d", worksheetId: null, worksheetSelections: {}, stageTab: "worksheet", rowRange: { from: 2, to: 5 } });
});

describe("worksheet gutter bar", () => {
  it("marks exactly the window's source rows (1-based numbers) and names it in their tooltip", () => {
    render(<WorksheetPane datasetId="d" />);
    expect(barred()).toEqual(["3", "4", "5", "6"]);
    const first = screen.getAllByRole("rowheader").find((h) => h.textContent === "3")!;
    expect(first.getAttribute("title")).toContain("in the plot's row window");
  });

  it("marks nothing for a window that does not fit the sheet, or on another sheet", () => {
    useApp.setState({ rowRange: { from: 2, to: 99 } });
    const { unmount } = render(<WorksheetPane datasetId="d" />);
    expect(barred()).toEqual([]);
    unmount();
    useApp.setState({ rowRange: { from: 2, to: 5 }, activeId: "e" });
    render(<WorksheetPane datasetId="d" />);
    expect(barred()).toEqual([]);
  });

  it("has no bar without a window", () => {
    useApp.setState({ rowRange: undefined });
    render(<WorksheetPane datasetId="d" />);
    expect(barred()).toEqual([]);
  });
});
