// Insert panel inset (#15): functional coverage of the three content kinds
// building the right PanelInsetContent and committing it to the store.
// The dialog-basics (role, focus, Escape, labels) are audited together with
// every other dialog in dialogInventory.a11y.test.tsx.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import InsertPanelInsetDialogBody from "./InsertPanelInsetDialogBody";

const ORIGINAL = useApp.getState();
afterEach(() => useApp.setState(ORIGINAL, true));

const DS: Dataset = {
  id: "d1",
  name: "VSM run",
  data: {
    time: [0, 1, 2],
    values: [[1, 4], [2, 5], [3, 6]], // row-major: row i = [A_i, B_i]
    labels: ["A", "B"],
    units: ["", ""],
    metadata: {},
  },
};

describe("InsertPanelInsetDialogBody", () => {
  it("Insert is disabled until a dataset panel's fields resolve, then adds it", () => {
    useApp.setState({ datasets: [DS] });
    render(<InsertPanelInsetDialogBody />);
    const insert = screen.getByRole("button", { name: "Insert" });
    // Default X is Time, default Y is the first channel (A) — both already
    // resolve for the first dataset, so Insert starts enabled.
    expect(insert).toBeEnabled();
    fireEvent.click(insert);
    expect(useApp.getState().panelInsets).toHaveLength(1);
    expect(useApp.getState().panelInsets[0].content).toEqual({
      kind: "dataset",
      x: [0, 1, 2],
      series: [{ label: "A", y: [1, 2, 3] }],
    });
    expect(useApp.getState().insertDialogOpen).toBe(false);
  });

  it("dataset panel: picking a Y column changes the built series", () => {
    useApp.setState({ datasets: [DS] });
    render(<InsertPanelInsetDialogBody />);
    fireEvent.change(screen.getByLabelText("Y"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    const content = useApp.getState().panelInsets[0].content;
    expect(content).toMatchObject({ series: [{ label: "B", y: [4, 5, 6] }] });
  });

  it("table panel: disabled with no rows, enabled and parsed once rows are typed", () => {
    render(<InsertPanelInsetDialogBody />);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const insert = screen.getByRole("button", { name: "Insert" });
    expect(insert).toBeDisabled();
    expect(screen.getByText("Fill in the panel's content first.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Headers/), { target: { value: "param, value" } });
    fireEvent.change(screen.getByLabelText(/Rows/), { target: { value: "x0, 1.23\nfwhm, 0.45" } });
    expect(insert).toBeEnabled();
    fireEvent.click(insert);
    expect(useApp.getState().panelInsets[0].content).toEqual({
      kind: "table",
      headers: ["param", "value"],
      rows: [["x0", "1.23"], ["fwhm", "0.45"]],
    });
  });

  it("image panel: disabled until a PNG/JPEG file is picked", async () => {
    render(<InsertPanelInsetDialogBody />);
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();

    const file = new File(["x"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/Image/), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText("Preview")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    const content = useApp.getState().panelInsets[0].content;
    expect(content.kind).toBe("image");
    expect((content as { dataUrl: string }).dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("image panel: rejects a non-image file with a visible error", () => {
    render(<InsertPanelInsetDialogBody />);
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    const file = new File(["x"], "doc.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/Image/), { target: { files: [file] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PNG or JPEG image.");
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
  });

  it("Cancel closes without adding anything", () => {
    useApp.setState({ insertDialogOpen: true });
    render(<InsertPanelInsetDialogBody />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useApp.getState().panelInsets).toEqual([]);
    expect(useApp.getState().insertDialogOpen).toBe(false);
  });
});
