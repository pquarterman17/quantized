// A plain `id,grp,sub,val` CSV: "Split by column value" offers the text columns the importer left in
// `metadata.text_columns`. Driven through the real dialog (pick the column, Split into N datasets); the
// children's rows are compared with pandas (`df.groupby("grp")`), named by the text, and carry the
// sheet's own columns (no appended text channel). "Facet by column" lists them too and says why it
// cannot facet by one.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runFacetByColumn } from "../../commands/plotLayoutCommands";
import { useApp } from "../../store/useApp";
import { toast } from "../../store/toasts";
import { GRP, SUB, TEXT_GROUP_DS, VAL } from "../workshops/textGroupFixture";
import SplitDatasetDialog from "./SplitDatasetDialog";

vi.mock("../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("./ParamDialog", () => ({ askParams: vi.fn() }));
const { askParams } = await import("./ParamDialog");

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [TEXT_GROUP_DS], folders: [], expandedFolders: [], activeId: "tg", selectedIds: ["tg"],
    worksheetId: null, history: [], future: [], splitDialogTargetId: "tg", composition: null,
  });
});

describe("Split by column value on a CSV text column", () => {
  it("offers grp and sub, previews the text groups, and splits into pandas' rows", async () => {
    render(<SplitDatasetDialog />);
    const select = screen.getByLabelText("Split column");
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(["grp", "sub"]));
    fireEvent.change(select, { target: { value: String(labels.indexOf("grp") - 1) } }); // option 0 is the x column (-1)
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B").length).toBeGreaterThan(0);
    expect(screen.getAllByText("6 rows")).toHaveLength(2);
    fireEvent.click(screen.getByText("Split into 2 datasets"));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    const [, a, b] = useApp.getState().datasets;
    expect([a!.name, b!.name]).toEqual(["tg.csv (A)", "tg.csv (B)"]);
    // pandas: df[df.grp == "A"] -- the rows, in file order, with the sheet's own columns.
    for (const [child, level] of [[a!, "A"], [b!, "B"]] as const) {
      const rows = GRP.flatMap((g, i) => (g === level ? [i] : []));
      expect(child.data.values.map((r) => r[0])).toEqual(rows.map((i) => VAL[i]));
      expect(child.data.time).toEqual(rows.map((i) => i + 1)); // SOURCE rows, not positions in the child
      expect(child.data.labels).toEqual(["val", "id"]);
      expect((child.data.metadata.text_columns as Record<string, string[]>).sub).toEqual(rows.map((i) => SUB[i]));
    }
  });

  it("refuses with a reason when the text column is no longer on the sheet", async () => {
    await useApp.getState().splitDatasetByColumn("tg", 7);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("no column 8"), "danger");
  });
});

describe("Facet by column on a CSV text column", () => {
  it("lists grp and sub and refuses the pick with the reason, never faceting by another column", async () => {
    vi.mocked(askParams).mockResolvedValue({ column: "grp" });
    await runFacetByColumn(useApp.getState);
    const field = vi.mocked(askParams).mock.calls[0]![1][0] as { options: string[] };
    expect(field.options).toEqual(["val", "id", "grp", "sub"]);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("text column"), "info");
    expect(useApp.getState().composition).toBeNull();
    expect(useApp.getState().facetKey ?? null).toBeNull();
  });
});
