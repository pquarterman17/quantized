// P2.5 align/interpolate — the Resample workshop previews LIVE before it
// creates anything: the overlay plot, the row counts and the backend's
// warnings are on screen first; Create then adds a derived dataset with its
// provenance, records a replayable `resample` transform step, and is undoable.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDataCommands } from "../../../commands/dataCommands";
import type { ResampleRequest, ResampleResult } from "../../../lib/api/resample";
import type { DataStruct } from "../../../lib/types";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useApp } from "../../../store/useApp";
import ResamplePanel from "./ResamplePanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn() }));
const { resampleDataset } = await import("../../../lib/api/resample");

/** Extra warnings the fake backend adds to every response. */
let extraWarnings: ResampleResult["warnings"] = [];

/** A stand-in for the backend: linear interpolation of channel 0 onto the
 *  requested grid (n points over the range, or the matched x), blank outside. */
function fakeBackend(body: ResampleRequest): Promise<ResampleResult> {
  const { time, values } = body.dataset;
  const lo = Math.min(...time);
  const hi = Math.max(...time);
  const grid =
    body.mode === "match"
      ? (body.match_x ?? []).filter((v): v is number => v !== null)
      : Array.from({ length: body.n_points ?? 2 }, (_, k) => lo + ((hi - lo) * k) / ((body.n_points ?? 2) - 1));
  const at = (x: number): number | null => {
    if (x < lo || x > hi) return null;
    const j = Math.max(1, time.findIndex((t) => t >= x));
    const [x0, x1, y0, y1] = [time[j - 1], time[j], values[j - 1][0], values[j][0]];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };
  const outside = grid.filter((x) => x < lo || x > hi).length;
  const warnings = [...extraWarnings];
  if (outside) warnings.push({ code: "out-of-range", text: `${outside} of ${grid.length} target points lie outside`, count: outside });
  return Promise.resolve({
    dataset: {
      time: grid,
      values: grid.map((x) => [at(x) as number]),
      labels: body.dataset.labels,
      units: body.dataset.units,
      metadata: { ...body.dataset.metadata, resampled: true, resampleMethod: body.method },
    },
    warnings,
    source_range: [lo, hi],
    rows_in: time.length,
    rows_out: grid.length,
  });
}

const a: DataStruct = { time: [0, 1, 2, 3], values: [[0], [10], [20], [30]], labels: ["M"], units: ["emu"], metadata: { x_column_unit: "K" } };
const b: DataStruct = { time: [0, 2, 4], values: [[5], [6], [7]], labels: ["M"], units: ["emu"], metadata: { x_column_unit: "K" } };
const grid: DataStruct = { time: [0.5, 1.5, 3.5], values: [[1], [1], [1]], labels: ["G"], units: [""], metadata: { x_column_unit: "K" } };

beforeEach(() => {
  vi.clearAllMocks();
  extraWarnings = [];
  vi.mocked(resampleDataset).mockImplementation(fakeBackend);
  useApp.setState({
    datasets: [
      { id: "d1", name: "a.dat", data: a },
      { id: "d2", name: "b.dat", data: b },
      { id: "g", name: "grid.dat", data: grid },
    ],
    folders: [],
    activeId: "d1",
    selectedIds: ["d1"],
    macroRecording: true,
    macroSteps: [],
  });
  useResampleDialog.setState({ seed: ["d1"] });
});

const results = () => screen.getByRole("list", { name: "Resample results" });
const createButton = () => screen.getByRole("button", { name: /^Create/ });

describe("ResamplePanel — previewed align/interpolate", () => {
  it("previews the overlay, counts and warnings BEFORE creating; Create adds a recorded, undoable dataset", async () => {
    extraWarnings = [{ code: "duplicate-x", text: "1 row repeats an x value already present", count: 1 }];
    render(<ResamplePanel />);
    fireEvent.change(screen.getByRole("textbox", { name: "Number of points" }), { target: { value: "7" } });

    await waitFor(() => expect(results().textContent).toContain("a.dat: 4 rows → 7 rows"));
    expect(screen.getByRole("list", { name: "Transform warnings" }).textContent).toContain("repeats an x value");
    const plot = screen.getByTestId("resample-preview-plot");
    expect(plot.querySelectorAll("[data-resampled-point]")).toHaveLength(7);
    // Previewing created nothing and recorded nothing.
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().macroSteps).toEqual([]);
    const previewBody = vi.mocked(resampleDataset).mock.calls[0][0];
    expect(previewBody).toMatchObject({ mode: "n_points", n_points: 7, method: "linear", out_of_range: "nan", unsorted: "refuse" });

    await act(async () => fireEvent.click(createButton()));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    const out = useApp.getState().datasets[3];
    expect(out.name).toBe("a (resampled)");
    expect(out.data.time).toHaveLength(7);
    expect(out.data.metadata).toMatchObject({
      worksheet_transform: "resample",
      transform_warnings: ["1 row repeats an x value already present"],
      resample_of: "a.dat",
      resample_grid: "7 points",
    });
    const [step] = useApp.getState().macroSteps;
    expect(step.kind).toBe("transform");
    expect(step.label).toBe("Resample a.dat onto 7 points (linear)");
    expect(step.params).toMatchObject({
      op: "resample",
      mode: "n_points",
      nPoints: 7,
      method: "linear",
      outOfRange: "nan",
      sortUnsorted: false,
      input: { id: "d1", name: "a.dat" },
      inputIsTarget: true,
      outputs: [{ id: out.id, key: "" }],
    });
    expect(step.params).not.toHaveProperty("acceptedXUnits");
    // The workshop closes once everything was created; undo removes it.
    expect(useResampleDialog.getState().seed).toBeNull();
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d1", "d2", "g"]);
  });

  it("an edit makes the preview stale: Create waits for the new preview", async () => {
    render(<ResamplePanel />);
    await waitFor(() => expect(results().textContent).toContain("4 rows → 500 rows"));
    expect(createButton()).not.toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Number of points" }), { target: { value: "9" } });
    // Immediately after the edit the old preview is gone and Create is off.
    expect(screen.getByText("Previewing…")).toBeTruthy();
    expect(createButton()).toBeDisabled();
    await waitFor(() => expect(results().textContent).toContain("4 rows → 9 rows"));
    expect(createButton()).not.toBeDisabled();
  });

  it("re-previews when a picked dataset changes, and never for an unrelated store change", async () => {
    render(<ResamplePanel />);
    await waitFor(() => expect(results().textContent).toContain("a.dat: 4 rows → 500 rows"));
    vi.mocked(resampleDataset).mockClear();
    // Unrelated: a new dataset (every picked object unchanged).
    act(() => useApp.setState((s) => ({ datasets: [...s.datasets, { id: "z", name: "z.dat", data: b }] })));
    await new Promise((r) => setTimeout(r, 400));
    expect(resampleDataset).not.toHaveBeenCalled();
    // Related: the picked dataset's rows change -> stale, then re-previewed.
    const longer = { ...a, time: [...a.time, 4], values: [...a.values, [40]] };
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, data: longer } : d)) })));
    expect(createButton()).toBeDisabled();
    await waitFor(() => expect(results().textContent).toContain("a.dat: 5 rows → 500 rows"));
  });

  it("an invalid grid says what to fix and asks the backend nothing", async () => {
    render(<ResamplePanel />);
    await waitFor(() => expect(results().textContent).toContain("500 rows"));
    vi.mocked(resampleDataset).mockClear();
    fireEvent.change(screen.getByRole("textbox", { name: "Number of points" }), { target: { value: "1" } });
    expect(screen.getByText("the number of points must be a whole number ≥ 2")).toBeTruthy();
    expect(createButton()).toBeDisabled();
    await new Promise((r) => setTimeout(r, 400));
    expect(resampleDataset).not.toHaveBeenCalled();
  });

  it("a refused dataset shows the backend's reason and blocks Create", async () => {
    vi.mocked(resampleDataset).mockRejectedValue(new Error("x is not monotonic: it changes direction 1 time"));
    render(<ResamplePanel />);
    await waitFor(() => expect(results().textContent).toContain("a.dat: x is not monotonic"));
    expect(createButton()).toBeDisabled();
  });

  it("aligns several datasets onto another dataset's x; the unit mismatch needs the explicit acknowledgment", async () => {
    extraWarnings = [{ code: "unit-mismatch", text: "X units differ: the source is in K but the grid is in Oe", confirm: true }];
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "g" ? { ...d, data: { ...grid, metadata: { x_column_unit: "Oe" } } } : d)),
    }));
    useResampleDialog.setState({ seed: ["d1", "d2"] });
    render(<ResamplePanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Target grid" }), { target: { value: "match" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Dataset to match" }), { target: { value: "g" } });

    await waitFor(() => expect(results().textContent).toContain("b.dat: 3 rows → 3 rows"));
    expect(within(results()).getAllByRole("listitem")).toHaveLength(2);
    // The preview asks with the mismatch allowed, so the warning can be shown.
    expect(vi.mocked(resampleDataset).mock.calls.at(-1)?.[0]).toMatchObject({
      mode: "match", match_x: [0.5, 1.5, 3.5], match_x_unit: "Oe", allow_unit_mismatch: true,
    });
    vi.mocked(resampleDataset).mockClear();
    const create = screen.getByRole("button", { name: "Create 2 resampled datasets" });
    expect(create).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Resample despite the x unit mismatch" }));
    expect(create).not.toBeDisabled();

    await act(async () => fireEvent.click(create));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(5));
    const made = useApp.getState().datasets.slice(3);
    expect(made.map((d) => d.name)).toEqual(["a (on grid x)", "b (on grid x)"]);
    expect(made[0].data.metadata).toMatchObject({ aligned_to: "grid.dat", resample_of: "a.dat" });
    expect(made[1].data.time).toEqual([0.5, 1.5, 3.5]);
    const steps = useApp.getState().macroSteps;
    // The acknowledgment is recorded as the exact accepted unit pair, and the
    // commit itself asked with it (the backend refuses a mismatch otherwise).
    expect(steps.map((s) => s.params.acceptedXUnits)).toEqual([["K", "Oe"], ["K", "Oe"]]);
    expect(vi.mocked(resampleDataset).mock.calls.map((c) => c[0].allow_unit_mismatch)).toEqual([true, true]);
    expect(steps.map((s) => s.params.with)).toEqual([{ id: "g", name: "grid.dat" }, { id: "g", name: "grid.dat" }]);
    // The active dataset's step applies to a template's target; b.dat is an
    // explicit reference.
    expect(steps.map((s) => s.params.inputIsTarget)).toEqual([true, false]);
  });

  it("the dataset being matched is the grid, not a pick", async () => {
    useResampleDialog.setState({ seed: ["d1", "g"] });
    render(<ResamplePanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Target grid" }), { target: { value: "match" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Dataset to match" }), { target: { value: "g" } });
    expect(screen.getByText("grid.dat is the grid, so it is not resampled itself.")).toBeTruthy();
    await waitFor(() => expect(results().textContent).toContain("a.dat: 4 rows → 3 rows"));
    expect(within(results()).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Create resampled dataset" })).toBeTruthy();
  });

  it("a partial failure unticks what WAS created, so pressing Create again cannot duplicate it", async () => {
    // b.dat previews fine but is refused at commit (preview asks with allow=true).
    vi.mocked(resampleDataset).mockImplementation((body) =>
      body.dataset.time.length === 3 && !body.allow_unit_mismatch
        ? Promise.reject(new Error("refused at commit"))
        : fakeBackend(body),
    );
    useResampleDialog.setState({ seed: ["d1", "d2"] });
    render(<ResamplePanel />);
    await waitFor(() => expect(within(results()).getAllByRole("listitem")).toHaveLength(2));
    await act(async () => fireEvent.click(createButton()));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("b.dat: refused at commit"));
    expect(screen.getByRole("alert").textContent).toContain("resampled a.dat (now unticked)");
    expect(useApp.getState().datasets).toHaveLength(4);
    expect(useResampleDialog.getState().seed).not.toBeNull();
    const picks = screen.getByRole("group", { name: "Datasets to resample" });
    expect(within(picks).getByRole("checkbox", { name: "a.dat" })).not.toBeChecked();
    expect(within(picks).getByRole("checkbox", { name: "b.dat" })).toBeChecked();
  });

  it("running the command again while open re-seeds the pick from the new selection (a single one included)", async () => {
    render(<ResamplePanel />);
    const picks = () => screen.getByRole("group", { name: "Datasets to resample" });
    expect(within(picks()).getByRole("checkbox", { name: "a.dat" })).toBeChecked();
    useApp.setState({ selectedIds: ["d2"] });
    act(() => buildDataCommands(useApp.getState).find((c) => c.id === "resample")!.run());
    expect(useResampleDialog.getState().seed).toEqual(["d2"]);
    expect(within(picks()).getByRole("checkbox", { name: "a.dat" })).not.toBeChecked();
    expect(within(picks()).getByRole("checkbox", { name: "b.dat" })).toBeChecked();
  });
});
