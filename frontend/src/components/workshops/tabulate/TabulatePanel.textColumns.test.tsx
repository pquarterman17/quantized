// A plain `id,grp,sub,val` CSV: Tabulate's Group by well offers the text columns the importer left in
// `metadata.text_columns`. Driven through the real panel (the well's Assign select); the table is read
// back and compared with pandas (`df.groupby("grp")["val"].agg(["count", "mean", "std", "min", "max", "median"])`).

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { TEXT_GROUP_DS } from "../textGroupFixture";
import TabulatePanel from "./TabulatePanel";

vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ datasets: [TEXT_GROUP_DS], activeId: "tg", tabulateOpen: true, reports: [], status: "" });
});

const tableRows = (): string[][] =>
  Array.from(document.querySelectorAll(".qzk-tabulate-table tbody tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""));

describe("Tabulate groups by a CSV text column", () => {
  it("offers grp and sub, and summarises val by grp as pandas does", () => {
    render(<TabulatePanel />);
    const assign = screen.getByLabelText("Assign a channel to Group by");
    const offered = within(assign).getAllByRole("option").map((o) => o.textContent);
    expect(offered).toEqual(expect.arrayContaining(["grp", "sub"]));
    fireEvent.change(assign, { target: { value: "2" } }); // grp
    fireEvent.click(screen.getByRole("button", { name: "Remove id" }));
    // pandas: grp A -> count 6, mean 6.5, std 5.00999, min 1, max 12, median 6.5; B -> 6, 26, 5.549775, 20, 32, 26.
    const rows = tableRows();
    expect(rows.map((r) => r[0])).toEqual(["A", "B"]);
    const num = (r: string[]) => r.slice(1).map(Number);
    expect(num(rows[0])).toEqual([6, 6.5, expect.closeTo(5.00999, 3), 1, 12, 6.5]);
    expect(num(rows[1])).toEqual([6, 26, expect.closeTo(5.549775, 3), 20, 32, 26]);
  });

  it("nests a second text column under the first", () => {
    render(<TabulatePanel />);
    fireEvent.change(screen.getByLabelText("Assign a channel to Group by"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Assign a channel to Group by"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove id" }));
    // pandas df.groupby(["grp", "sub"]): (A,x) mean 2, (A,y) 11, (B,x) 21, (B,y) 31, each n = 3.
    const rows = tableRows();
    expect(rows.map((r) => [r[0], r[1], Number(r[2]), Number(r[3])])).toEqual([
      ["A", "x", 3, 2], ["A", "y", 3, 11], ["B", "x", 3, 21], ["B", "y", 3, 31],
    ]);
  });
});

// Persistence: the committed output, its reopen, and a preset all name the text column.
describe("a text-column pick persists", () => {
  const chips = () => Array.from(document.querySelectorAll(".qzk-zone-well")[0].querySelectorAll(".qzk-zone-chip")).map((c) => c.textContent ?? "");
  const exportIt = () => {
    fireEvent.change(screen.getByLabelText("Assign a channel to Group by"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove id" }));
    fireEvent.click(screen.getByRole("button", { name: "Export → dataset" }));
  };

  it("exports a worksheet of pandas' group means, keeps the source current, and records the label", () => {
    useApp.setState({ analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual" });
    render(<TabulatePanel />);
    exportIt();
    const [, out] = useApp.getState().datasets;
    expect(out.data.labels.slice(0, 3)).toEqual(["grp", "val count", "val mean"]);
    expect(out.data.values.map((r) => r[2])).toEqual([6.5, 26]); // pandas groupby("grp")["val"].mean()
    expect(useApp.getState().staleDatasets).toEqual([]);
    const result = useApp.getState().analysisResults[0];
    expect(result.sources[0].datasetId).toBe("tg");
    expect(result.parameters?.settings).toMatchObject({ groupCols: [2], groupLabels: ["grp"], valueLabels: ["val"] });
  });

  it("reopens on the text column, and not when the label at that index changed", () => {
    useApp.setState({ analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual" });
    const { unmount } = render(<TabulatePanel />);
    exportIt();
    unmount();
    const resultId = useApp.getState().analysisResults[0].id;
    expect(openCommittedResultInTool(resultId)).toBe(true);
    render(<TabulatePanel />);
    expect(chips()).toHaveLength(1);
    expect(chips()[0]).toContain("grp");
    // The text columns moved: index 2 is `sub` now. The recorded label no longer matches, so the pick is not restored.
    cleanup();
    useToolReopen.getState().end("tabulate");
    const cols = TEXT_GROUP_DS.data.metadata.text_columns as Record<string, unknown>;
    useApp.setState({ datasets: [{ ...TEXT_GROUP_DS, data: { ...TEXT_GROUP_DS.data, metadata: { text_columns: { zgrp: cols.grp, sub: cols.sub } } } }] });
    expect(openCommittedResultInTool(resultId)).toBe(true);
    render(<TabulatePanel />);
    expect(chips()).toHaveLength(1);
    expect(chips()[0]).toContain("id"); // the default, never `sub`
  });
});

describe("a preset names the text column by label", () => {
  it("saves grp, is changed, and Apply brings grp back", async () => {
    render(<TabulatePanel />);
    await screen.findByRole("region", { name: "Tabulate presets" });
    fireEvent.change(screen.getByLabelText("Assign a channel to Group by"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove id" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: "by grp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(screen.getByLabelText("Assign a channel to Group by"), { target: { value: "3" } }); // add sub
    fireEvent.click(screen.getByRole("button", { name: "Remove grp" }));
    expect(tableRows().map((r) => r[0])).toEqual(["x", "y"]);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(tableRows().map((r) => r[0])).toEqual(["A", "B"]);
  });
});
