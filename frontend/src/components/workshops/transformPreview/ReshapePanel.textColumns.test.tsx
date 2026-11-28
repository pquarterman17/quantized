// A plain `id,grp,sub,val` CSV: Unstack's Category picker already offers the text columns the importer left
// in `metadata.text_columns` (by name, `t:<name>`), so the Transform form needs no appended channel. Driven
// through the real panel with the SECOND text column, and the preview compared with pandas
// (`df.pivot_table(index="id", columns="sub", values="val")`).

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDataCommands } from "../../../commands/dataCommands";
import { useApp } from "../../../store/useApp";
import { TEXT_GROUP_DS } from "../textGroupFixture";
import ReshapePanel from "./ReshapePanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [TEXT_GROUP_DS], folders: [], activeId: "tg", selectedIds: [], macroRecording: false, macroSteps: [] });
});

describe("Unstack by a CSV text column", () => {
  it("offers both text columns as the category and spreads val by sub as pandas does", async () => {
    act(() => buildDataCommands(useApp.getState).find((c) => c.id === "unstack-columns")!.run());
    render(<ReshapePanel />);
    const category = screen.getByRole("combobox", { name: "Category column" });
    const labels = Array.from(category.querySelectorAll("option")).map((o) => o.textContent ?? "");
    expect(labels.some((l) => l.startsWith("grp"))).toBe(true);
    expect(labels.some((l) => l.startsWith("sub"))).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Row key" }), { target: { value: "1" } }); // id
    fireEvent.change(category, { target: { value: "t:sub" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Value column" }), { target: { value: "0" } }); // val
    const table = () => screen.getByRole("table", { name: "Preview rows" });
    await waitFor(() => expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["X", "x", "y"]));
    // pandas pivot_table: r1..r3 -> x = 1, 2, 3 (y empty); r4..r6 -> y = 10, 11, 12 (x empty).
    const rows = within(table()).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows.slice(0, 3).map((r) => r[1])).toEqual(["1", "2", "3"]);
    expect(rows.slice(3, 6).map((r) => r[2])).toEqual(["10", "11", "12"]);
  });
});
