// The worksheet's "Extract rows…" (ROW_RANGE_CONTRACT section 4): the one-click "Extract selected rows to a new sheet" is
// unchanged, and a variant beside it asks which series and which workbook, as the plot's "Create subset from region"
// does. Driven through the real worksheet (toolbar button and gutter menu), the real dialog store and the real commit.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { readSourceRowLink } from "../../../lib/sourceRowLink";
import type { Dataset } from "../../../lib/types";
import { useParamDialog } from "../../../store/paramDialog";
import { useApp } from "../../../store/useApp";
import { clickMenuItem } from "../../../test/contextMenuNav";
import WorksheetPane from "./WorksheetPane";

const ds = (meta: Record<string, unknown> = {}): Dataset => ({
  id: "d", name: "rr.csv", workbookId: "wb1",
  data: { time: [1, 2, 3, 4, 5, 6], values: [[1, 10], [2, Number.NaN], [3, 30], [4, 40], [5, 50], [6, 60]], labels: ["A", "B"], units: ["", ""], metadata: meta },
});
const gutter = (row: number): HTMLElement => [...document.querySelectorAll<HTMLElement>("[role=rowheader]")].find((e) => e.textContent === String(row + 1))!;
const subsets = () => useApp.getState().datasets.filter((d) => d.id !== "d");

function open(meta: Record<string, unknown> = {}) {
  useApp.setState({
    datasets: [ds(meta)], activeId: "d", worksheetId: null, selection: null, selectedIds: [], worksheetSelections: {}, history: [], future: [], status: "",
    workbooks: [{ id: "wb1", name: "Run 1" }, { id: "wb2", name: "Archive" }],
  });
  render(<WorksheetPane datasetId="d" />);
  fireEvent.click(gutter(1));
  fireEvent.click(gutter(3), { shiftKey: true }); // source rows 1..3
}
async function dialog() {
  await waitFor(() => expect(useParamDialog.getState().resolve).not.toBeNull());
  const { fields, resolve, close } = useParamDialog.getState();
  return {
    fields,
    answer: (over: Record<string, boolean | string> = {}) => { resolve?.({ ...Object.fromEntries(fields.map((f) => [f.key, f.default])), ...over }); close(); },
    cancel: () => { resolve?.(null); close(); },
  };
}

beforeEach(() => useParamDialog.getState().close());

describe("worksheet Extract rows…", () => {
  it("the one-click Extract is unchanged: no question, every column, beside the source", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Extract selected rows to a new sheet" }));
    expect(useParamDialog.getState().resolve).toBeNull();
    expect(subsets()).toHaveLength(1);
    expect(subsets()[0].data.labels).toEqual(["A", "B"]);
    expect(subsets()[0].data.time).toEqual([2, 3, 4]);
  });

  it("the toolbar button asks, listing each series with the rows it holds, every one ticked", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Extract rows…" }));
    const { fields, cancel } = await dialog();
    expect(fields.filter((f) => f.type === "boolean").map((f) => [f.label, f.default])).toEqual([["A (3 rows)", true], ["B (2 rows)", true]]); // B is blank at source row 1
    cancel();
    expect(subsets()).toHaveLength(0);
  });

  it("ticking one series and a destination workbook puts those rows and that series there, linked to the source rows", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Extract rows…" }));
    const d = await dialog();
    const where = d.fields.find((f) => f.key === "where");
    d.answer({ s1: false, where: where!.options!.find((o) => o.startsWith("wb:"))! });
    await waitFor(() => expect(subsets()).toHaveLength(1));
    const sub = subsets()[0];
    expect(sub.data.labels).toEqual(["A"]);
    expect(sub.data.values).toEqual([[2], [3], [4]]);
    expect(sub.workbookId).toBe("wb2");
    expect(readSourceRowLink(sub.data.metadata)?.source).toBe("d"); // Go to Source finds these rows
    expect(useApp.getState().activeId).toBe(sub.id); // like the one-click Extract, the new sheet opens
  });

  it("unticking a series on a plain CSV works: its name leaves the file's column list and the label rows follow", async () => {
    // What a CSV import records: the file's own columns (x first, here a text column too) and its header rows.
    open({
      x_column_name: "t", all_column_names: ["t", "A", "note", "B (K)"], all_column_units: ["", "", "", "K"],
      label_rows: [{ index: 0, role: "header", x: "t", cells: ["A", "B"] }, { index: 1, role: "label", x: "", cells: ["s1", "s2"] }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Extract rows…" }));
    (await dialog()).answer({ s0: false });
    await waitFor(() => expect(subsets()).toHaveLength(1));
    const sub = subsets()[0];
    expect(sub.data.labels).toEqual(["B"]);
    expect(sub.data.metadata["all_column_names"]).toEqual(["t", "note", "B (K)"]);
    expect(sub.data.metadata["all_column_units"]).toEqual(["", "", "K"]);
    expect(sub.data.metadata["label_rows"]).toEqual([
      { index: 0, role: "header", x: "t", cells: ["B"] }, { index: 1, role: "label", x: "", cells: ["s2"] },
    ]);
  });

  it("is offered on the gutter menu of a selected row, and refuses to drop a series from a sheet it cannot renumber", async () => {
    open({ error_roles: [{ channel: 1, target: 0 }] });
    fireEvent.contextMenu(gutter(2), { clientX: 10, clientY: 10 });
    clickMenuItem("Extract rows…");
    (await dialog()).answer({ s1: false });
    await waitFor(() => expect(useApp.getState().status).toMatch(/subset not created.*error_roles/));
    expect(subsets()).toHaveLength(0);
  });
});
