// Clean data in the Reshape & combine workshop: the three Data-menu commands
// open it on the right op, the live preview shows the cleaned rows and the
// warnings, Create makes ONE derived worksheet (source untouched) and records
// a replayable step, and a refusal creates nothing.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDataCommands } from "../../../commands/dataCommands";
import type { DataStruct } from "../../../lib/types";
import { useTransformPreviewDialog } from "../../../store/transformPreviewDialog";
import { useApp } from "../../../store/useApp";
import ReshapePanel from "./ReshapePanel";
import { formToRun, seedForm } from "./transformForm";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const N = Number.NaN;
const dirty: DataStruct = {
  time: [0, 0, 2, 3],
  values: [[1, 10], [1, 10], [N, 30], [4, 40]],
  labels: ["a", "b"],
  units: ["K", "emu"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d", name: "dirty.dat", data: dirty }],
    folders: [],
    activeId: "d",
    selectedIds: [],
    macroRecording: true,
    macroSteps: [],
  });
});

const run = (id: string) => act(() => buildDataCommands(useApp.getState).find((c) => c.id === id)!.run());
const sizes = () => screen.getByRole("list", { name: "Preview size" });
const create = () => screen.getByRole("button", { name: "Create" });
const derived = () => useApp.getState().datasets.filter((d) => d.id !== "d");

describe("Clean data commands", () => {
  it("each opens the workshop on its own op", () => {
    for (const [id, op] of [["remove-duplicate-rows", "dedupe"], ["fill-missing-values", "fillmissing"], ["standardize-columns", "standardize"]] as const) {
      run(id);
      expect(useTransformPreviewDialog.getState()).toMatchObject({ op, seed: ["d"] });
    }
  });
});

describe("ReshapePanel — clean data", () => {
  it("dedupe: previews the smaller result, then Create adds one dataset and records the step", async () => {
    run("remove-duplicate-rows");
    render(<ReshapePanel />);
    await waitFor(() => expect(sizes().textContent).toContain("Result “dirty (deduplicated)”: 3 rows × 2 columns"));
    expect(screen.getByRole("list", { name: "Transform warnings" }).textContent).toContain("Removed 1 duplicate row");
    expect(derived()).toEqual([]); // nothing created by previewing
    await act(async () => fireEvent.click(create()));
    await waitFor(() => expect(derived()).toHaveLength(1));
    expect(derived()[0].data.time).toEqual([0, 2, 3]);
    expect(useApp.getState().datasets.find((d) => d.id === "d")?.data).toBe(dirty);
    expect(useApp.getState().macroSteps.at(-1)?.params).toMatchObject({ op: "dedupe", keys: [], keep: "first" });
  });

  it("dedupe by a key column whose rows differ elsewhere shows the conflict warning", async () => {
    useApp.setState({ datasets: [{ id: "d", name: "dirty.dat", data: { ...dirty, values: [[1, 10], [1, 11], [N, 30], [4, 40]] } }] });
    run("remove-duplicate-rows");
    render(<ReshapePanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "a" }));
    await waitFor(() => expect(sizes().textContent).toContain("Result “dirty (deduplicated)”: 3 rows"));
    const warnings = screen.getByRole("list", { name: "Transform warnings" });
    expect(warnings.querySelector('[data-code="dedupe-conflict"]')?.textContent).toMatch(/1 duplicate group had rows that differ/);
  });

  it("fill: dropping rows previews and creates; a refusal shows an error and creates nothing", async () => {
    run("fill-missing-values");
    render(<ReshapePanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Fill method" }), { target: { value: "drop" } });
    await waitFor(() => expect(sizes().textContent).toContain("Result “dirty (missing dropped)”: 3 rows"));
    // un-tick every column: the form refuses and Create is off
    fireEvent.click(screen.getByRole("checkbox", { name: "a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "b" }));
    await waitFor(() => expect(screen.getByText("Tick at least one column.")).toBeTruthy());
    expect(create()).toBeDisabled();
    expect(derived()).toEqual([]);
  });

  it("standardize: a constant column is refused in the preview and cannot be created", async () => {
    useApp.setState({ datasets: [{ id: "d", name: "flat.dat", data: { ...dirty, values: [[1, 2], [1, 3], [1, 4], [1, 5]] } }] });
    run("standardize-columns");
    render(<ReshapePanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "b" })); // leave only constant "a"
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/constant/));
    expect(create()).toBeDisabled();
    expect(derived()).toEqual([]);
  });

  it("standardize rank: previews renamed columns", async () => {
    run("standardize-columns");
    render(<ReshapePanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Standardize method" }), { target: { value: "rank" } });
    await waitFor(() => expect(sizes().textContent).toContain("Result “dirty (rank)”: 4 rows × 2 columns"));
    expect(within(screen.getByRole("table", { name: "Preview rows" })).getAllByRole("columnheader").map((h) => h.textContent)).toContain("a (rank)");
  });
});

describe("formToRun — clean data", () => {
  const named = [{ id: "d", name: "dirty.dat", data: { ...dirty, cat_levels: { 1: ["u", "v"] } } }];
  it("does not pre-tick a categorical column, and refuses a stale key", () => {
    const form = seedForm("fillmissing", ["d"], named);
    expect(form.cleanChannels).toEqual([0]);
    expect(formToRun({ ...seedForm("dedupe", ["d"], named), dedupeKeys: ["9"] }, named)).toMatch(/no longer/);
  });
});
