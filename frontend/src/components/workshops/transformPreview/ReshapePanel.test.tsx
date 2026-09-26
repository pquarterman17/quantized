// P2.5 "previewed append, keyed join, reshape" — the Reshape & combine
// workshop shows, for every op, the result's first rows (names + units), its
// size against the inputs' and the warnings BEFORE anything is created; the
// Data-menu commands open it on the right op and inputs.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDataCommands } from "../../../commands/dataCommands";
import { PREVIEW_ROWS } from "../../overlays/TransformPreviewTable";
import type { DataStruct } from "../../../lib/types";
import { useTransformPreviewDialog } from "../../../store/transformPreviewDialog";
import { useApp } from "../../../store/useApp";
import ReshapePanel from "./ReshapePanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const wide: DataStruct = {
  time: Array.from({ length: 30 }, (_, i) => i),
  values: Array.from({ length: 30 }, (_, i) => [i * 10, 300 - i]),
  labels: ["M", "T"],
  units: ["emu", "K"],
  metadata: { x_column_name: "Field", x_column_unit: "Oe" },
};
const keyed = (keys: number[], unit: string, label: string): DataStruct => ({
  time: keys.map((_, i) => i),
  values: keys.map((k, i) => [k, i + 0.5]),
  labels: ["key", label],
  units: [unit, ""],
  metadata: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [
      { id: "w", name: "wide.dat", data: wide },
      { id: "L", name: "left.dat", data: keyed([1, 2, 2, 3], "K", "a") },
      { id: "R", name: "right.dat", data: keyed([1, 2, 4], "K", "b") },
    ],
    folders: [],
    activeId: "w",
    selectedIds: [],
    macroRecording: true,
    macroSteps: [],
  });
});

const run = (id: string) => act(() => buildDataCommands(useApp.getState).find((c) => c.id === id)!.run());
const table = () => screen.getByRole("table", { name: "Preview rows" });
const sizes = () => screen.getByRole("list", { name: "Preview size" });
const create = () => screen.getByRole("button", { name: "Create" });

describe("ReshapePanel — live data preview", () => {
  it("transpose: the first rows with names and units, the size against the input, and nothing created", async () => {
    run("transpose");
    expect(useTransformPreviewDialog.getState()).toMatchObject({ op: "transpose", seed: ["w"] });
    render(<ReshapePanel />);
    await waitFor(() => expect(table()).toBeTruthy());
    expect(sizes().textContent).toContain("wide.dat: 30 rows × 2 columns");
    expect(sizes().textContent).toContain("Result “wide.dat (transposed)”: 2 rows × 30 columns (plus X)");
    const head = within(table()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(head.slice(0, 2)).toEqual(["X", "Row 1 (x=0)"]);
    expect(screen.getByRole("list", { name: "Transform warnings" }).textContent).toContain("2 column units cannot be carried");
    expect(useApp.getState().datasets).toHaveLength(3);
  });

  it("stack: only the first rows are shown, and a unit mismatch keeps Create off until acknowledged", async () => {
    run("stack-columns");
    render(<ReshapePanel />);
    await waitFor(() => expect(table()).toBeTruthy());
    // The LIVE preview is bounded (P2.5 review finding 5): wide.dat's 30 rows
    // are capped to 20 before stacking, so the previewed long form is
    // 20 x 2 channels = 40 rows (the table shows the first 20 of those), with
    // a note that the created result (60 long rows) will be bigger.
    expect(within(table()).getAllByRole("row")).toHaveLength(PREVIEW_ROWS + 1);
    expect(screen.getByText(`First ${PREVIEW_ROWS} of 40 rows.`)).toBeTruthy();
    expect(screen.getByText(/Preview shows the first 20 rows/)).toBeTruthy();
    const head = within(table()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(head).toEqual(["X", "Source channel", "Value (mixed)", "Source"]);
    const first = within(table()).getAllByRole("row")[1];
    expect(within(first).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0", "0", "0", "M"]);
    expect(create()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Create despite the unit mismatch" }));
    expect(create()).not.toBeDisabled();
    await act(async () => fireEvent.click(create()));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(useApp.getState().datasets[3].name).toBe("wide.dat (stacked)");
    expect(useTransformPreviewDialog.getState().op).toBeNull();
  });

  it("unstack: the pivot's columns and the aggregation warning", async () => {
    run("unstack-columns");
    render(<ReshapePanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Dataset" }), { target: { value: "L" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Row key" }), { target: { value: "0" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Category column" }), { target: { value: "-1" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Value column" }), { target: { value: "1" } });
    await waitFor(() => expect(sizes().textContent).toContain("Result “left.dat (unstacked)”: 3 rows × 4 columns"));
    expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "X", "Category 0", "Category 1", "Category 2", "Category 3",
    ]);
    expect(screen.queryByRole("list", { name: "Transform warnings" })).toBeNull();
  });

  it("join: N rows, the duplicate-key warning, both inputs' sizes; the key-unit mismatch needs the acknowledgment", async () => {
    useApp.setState({ activeId: "L", selectedIds: ["L", "R"] });
    run("join-by-key");
    expect(useTransformPreviewDialog.getState().seed).toEqual(["L", "R"]);
    render(<ReshapePanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Left key" }), { target: { value: "0" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Right key" }), { target: { value: "0" } });
    await waitFor(() => expect(sizes().textContent).toContain("Result “left.dat + right.dat (joined)”: 2 rows × 2 columns"));
    expect(sizes().textContent).toContain("left.dat: 4 rows × 2 columns");
    expect(sizes().textContent).toContain("right.dat: 3 rows × 2 columns");
    const warnings = screen.getByRole("list", { name: "Transform warnings" });
    expect(within(warnings).getAllByRole("listitem").map((li) => li.getAttribute("data-code"))).toEqual([
      "duplicate-keys", "unmatched-dropped", "unmatched-dropped",
    ]);
    expect(create()).not.toBeDisabled();
    // Now make the right key's unit differ: the preview says so and blocks.
    act(() => useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "R" ? { ...d, data: keyed([1, 2, 4], "mK", "b") } : d)),
    })));
    expect(create()).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/Key units differ/)).toBeTruthy());
    expect(create()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Create despite the unit mismatch" }));
    await act(async () => fireEvent.click(create()));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(useApp.getState().datasets[3].data.time).toEqual([1, 2]);
  });

  it("append: by position refuses differing columns and says to match by name; by name previews the NaN-filled column", async () => {
    useApp.setState({ selectedIds: ["w", "L"] });
    await act(async () => useApp.getState().mergeSelected());
    expect(useTransformPreviewDialog.getState()).toMatchObject({ op: "merge", seed: ["w", "L"] });
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "L" ? { ...d, data: { ...d.data, labels: ["M", "Q"], units: ["emu", ""] } } : d)),
    }));
    render(<ReshapePanel />);
    // Same count here (2 and 2), so by position it previews — with the
    // column-name mismatch it would silently paper over.
    await waitFor(() => expect(screen.getByText(/Column names differ at the same position/)).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox", { name: "Match columns" }), { target: { value: "name" } });
    // The LIVE preview is bounded (P2.5 review finding 5): wide.dat's 30 rows
    // are over the cap, so the previewed merge is only 20 + 4 = 24 rows, with
    // a note saying so — the WARNING below still counts wide.dat's real 30.
    await waitFor(() => expect(sizes().textContent).toContain("Result “merged (2)”: 24 rows × 3 columns"));
    expect(screen.getByText(/Preview shows the first 20 rows/)).toBeTruthy();
    expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Field (Oe)", "M (emu)", "T (K)", "Q",
    ]);
    expect(within(table()).getAllByRole("row")[1].textContent).toContain("NaN");
    const warnings = screen.getByRole("list", { name: "Transform warnings" }).textContent;
    expect(warnings).toContain('wide.dat has no "Q" column; its 30 rows are left blank (NaN) there.');
    expect(warnings).toContain('left.dat has no "T" column; its 4 rows are left blank (NaN) there.');
  });

  it("a still-loading book's preview is labelled preview-only", async () => {
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === "w" ? { ...d, pending: { kind: "path", path: "/w.opj", bookId: "B", rows: 300, cols: 2 } } : d,
      ),
    }));
    run("transpose");
    render(<ReshapePanel />);
    await waitFor(() => expect(screen.getByText(/^Preview only:/)).toBeTruthy());
  });
});
