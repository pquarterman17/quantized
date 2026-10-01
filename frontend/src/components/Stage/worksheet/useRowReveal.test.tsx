// "Reveal this row" (store/worksheetReveal.ts → useRowReveal → GridViewport):
// the worksheet scrolls a requested DATASET row into its virtualized window and
// selects it — including when the pane mounts after the request was filed, in a
// sorted view, on a large grid — and says so in one sentence when the
// worksheet's own filter hides the row. Every wait here is on rendered or store
// STATE, never on a mock having been called.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
import WorksheetPane from "./WorksheetPane";

function makeDs(id: string, nRows: number): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: Array.from({ length: nRows }, (_, i) => i),
      values: Array.from({ length: nRows }, (_, i) => [i * 10]),
      labels: ["A"],
      units: [""],
      metadata: {},
    },
  };
}

// jsdom never lays out, so the grid would take its unmeasured fallback window
// (the first 300 rows, scroll ignored). Give the grid's scroll container a real
// size BEFORE it mounts, as a browser would.
const realH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const realW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("qzk-grid") ? 240 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("qzk-grid") ? 600 : 0;
    },
  });
  useWorksheetReveal.setState({ rowReveal: null });
  useApp.setState({
    datasets: [makeDs("big", 500)],
    activeId: "big",
    worksheetId: null,
    selection: null,
    worksheetSelections: {},
    status: "",
  });
});
afterEach(() => {
  if (realH) Object.defineProperty(HTMLElement.prototype, "clientHeight", realH);
  if (realW) Object.defineProperty(HTMLElement.prototype, "clientWidth", realW);
});

// The row-number gutter cell (dataset row index + 1).
const gutter = (n: number) => screen.queryByRole("rowheader", { name: String(n) });
const findGutter = (n: number) => screen.findByRole("rowheader", { name: String(n) });

describe("worksheet row reveal", () => {
  it("scrolls a far row into the window and selects it when requested on a mounted pane", async () => {
    render(<WorksheetPane datasetId="big" />);
    expect(gutter(1)).not.toBeNull();
    expect(gutter(301)).toBeNull();
    act(() => useWorksheetReveal.getState().requestRowReveal({ datasetId: "big", row: 300 }));
    await findGutter(301);
    expect(gutter(1)).toBeNull();
    expect(useApp.getState().selection).toEqual({ datasetId: "big", rows: [300] });
    expect(useWorksheetReveal.getState().rowReveal).toBeNull();
  });

  it("honours a request filed BEFORE the worksheet mounted (the tab switch is the same gesture)", async () => {
    useWorksheetReveal.getState().requestRowReveal({ datasetId: "big", row: 420 });
    render(<WorksheetPane datasetId="big" />);
    await findGutter(421);
    expect(useWorksheetReveal.getState().rowReveal).toBeNull();
  });

  it("leaves a request for ANOTHER worksheet window alone", () => {
    useWorksheetReveal.getState().requestRowReveal({ datasetId: "big", row: 420, windowId: "win-a" });
    render(<WorksheetPane datasetId="big" />);
    expect(gutter(421)).toBeNull();
    expect(useWorksheetReveal.getState().rowReveal).not.toBeNull();
  });

  it("maps the dataset row through a SORTED view", async () => {
    render(<WorksheetPane datasetId="big" />);
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[2]); // channel A
    fireEvent.click(screen.getByText("Sort descending"));
    // Descending: dataset row 10 is display position 489 of 500 — far below
    // the top window (rows 500, 499, …).
    expect(gutter(11)).toBeNull();
    act(() => useWorksheetReveal.getState().requestRowReveal({ datasetId: "big", row: 10 }));
    await findGutter(11);
    expect(gutter(500)).toBeNull();
  });

  it("says in one sentence that the worksheet filter hides the row, and does not scroll", async () => {
    render(<WorksheetPane datasetId="big" />);
    fireEvent.change(screen.getByLabelText("filter column"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText("filter value"), { target: { value: "100" } });
    act(() => useWorksheetReveal.getState().requestRowReveal({ datasetId: "big", row: 5 }));
    const notice = await screen.findByText("Row 6 is hidden by the worksheet filter.");
    expect(notice).toBeInTheDocument();
    expect(useApp.getState().status).toBe("Row 6 is hidden by the worksheet filter.");
    expect(gutter(102)).not.toBeNull(); // still at the top of the filtered view
    expect(useApp.getState().selection).toBeNull();
    // Clearing the filter retires the notice.
    fireEvent.change(screen.getByLabelText("filter column"), { target: { value: "" } });
    expect(screen.queryByText(/hidden by the worksheet filter/)).toBeNull();
  });

  it("reaches a row deep in a large virtualized grid", async () => {
    useApp.setState({ datasets: [makeDs("big", 200_000)] });
    render(<WorksheetPane datasetId="big" />);
    act(() => useWorksheetReveal.getState().requestRowReveal({ datasetId: "big", row: 150_000 }));
    await findGutter(150001);
    // Still windowed: nowhere near 200k rows in the DOM.
    expect(screen.getAllByRole("row").length).toBeLessThan(60);
  });
});
