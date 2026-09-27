// P2.3 SIMS depth profiles — the workshop previews LIVE before it creates
// anything (log plot, x range after calibration, the backend's warnings);
// Create adds one recorded, undoable derived dataset; the Analyze menu opens it.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import type { SimsProcessRequest, SimsProcessResult } from "../../../lib/api/sims";
import type { DataStruct } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import SimsPanel from "./SimsPanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn() }));
const { processSims } = await import("../../../lib/api/sims");

/** Stand-in backend: rate calibration only (depth = rate × t), like calc.sims_depth. */
function fakeBackend(body: SimsProcessRequest): Promise<SimsProcessResult> {
  const rate = body.calibration?.sputter_rate ?? 1;
  const cal = Boolean(body.calibration);
  const time = cal ? body.dataset.time.map((t) => t * rate) : body.dataset.time;
  const metadata = cal ? { ...body.dataset.metadata, x_column_name: "Depth", x_column_unit: "nm" } : body.dataset.metadata;
  return Promise.resolve({
    dataset: { ...body.dataset, time, metadata: { ...metadata, sims_processing: [{ stage: "calibration" }] } },
    warnings: [{ code: "reordered", text: "time does not increase monotonically; depth keeps the row order" }],
    stages: [{ stage: "calibration" }],
  });
}

const raw: DataStruct = {
  time: [0, 10, 20, 30],
  values: [[1e3, 1e5], [1e4, 1e5], [1e2, 2e5], [50, 2e5]],
  labels: ["B", "Si"],
  units: ["c/s", "c/s"],
  metadata: { x_column_name: "Time", x_column_unit: "s" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(processSims).mockImplementation(fakeBackend);
  useApp.setState({
    datasets: [{ id: "s1", name: "barrier.csv", data: raw }],
    folders: [],
    activeId: "s1",
    selectedIds: ["s1"],
    macroRecording: true,
    macroSteps: [],
  });
  useSimsDialog.setState({ seed: "s1" });
});

const createButton = () => screen.getByRole("button", { name: /^Create/ });

describe("SimsPanel", () => {
  it("opens from the Analyze menu on the active dataset", () => {
    useSimsDialog.setState({ seed: null });
    buildAnalysisCommands(useApp.getState).find((a) => a.id === "sims")!.run();
    expect(useSimsDialog.getState().seed).toBe("s1");
  });

  it("previews the calibrated profile BEFORE creating; Create adds a recorded, undoable dataset", async () => {
    render(<SimsPanel />);
    expect(screen.getByText("Turn on at least one step.")).toBeTruthy();
    expect(createButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Depth calibration (time → depth)" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Calibration method" }), { target: { value: "rate" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Sputter rate" }), { target: { value: "2" } });

    await waitFor(() => expect(screen.getByText("Depth: 0 … 60 nm")).toBeTruthy());
    expect(screen.getByTestId("sims-preview-plot").querySelectorAll("polyline")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Transform warnings" }).textContent).toContain("monotonically");
    expect(vi.mocked(processSims).mock.calls.at(-1)?.[0].calibration).toMatchObject({
      method: "rate",
      sputter_rate: 2,
      rate_unit: "nm/s",
      depth_unit: "nm",
      time_unit: null,
    });
    // Previewing created and recorded nothing.
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().macroSteps).toEqual([]);

    await act(async () => fireEvent.click(createButton()));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const out = useApp.getState().datasets[1];
    expect(out.name).toBe("barrier (SIMS processed)");
    expect(out.data.time).toEqual([0, 20, 40, 60]);
    expect(out.data.metadata).toMatchObject({
      x_column_unit: "nm",
      sims_source: { id: "s1", name: "barrier.csv" },
      worksheet_transform: "sims",
      transform_warnings: ["time does not increase monotonically; depth keeps the row order"],
    });
    expect(useApp.getState().macroSteps[0]).toMatchObject({ kind: "transform", label: "SIMS barrier.csv: depth (rate)" });
    expect(useSimsDialog.getState().seed).toBeNull();
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["s1"]);
  });

  it("an edit makes the preview stale; a refused input shows the backend's reason and blocks Create", async () => {
    render(<SimsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Smooth" }));
    await waitFor(() => expect(createButton()).not.toBeDisabled());
    vi.mocked(processSims).mockRejectedValue(new Error("the x axis is in 'nm', which is a length unit"));
    fireEvent.change(screen.getByRole("textbox", { name: "Half-width (points)" }), { target: { value: "3" } });
    expect(createButton()).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("length unit"));
    expect(createButton()).toBeDisabled();
  });

  it("states the reference and sends RSFs by column name", async () => {
    render(<SimsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Normalize to a reference species" }));
    expect((screen.getByRole("combobox", { name: "Reference species" }) as HTMLSelectElement).value).toBe("Si");
    fireEvent.change(screen.getByRole("textbox", { name: "RSF for B" }), { target: { value: "3e22" } });
    await waitFor(() =>
      expect(vi.mocked(processSims).mock.calls.at(-1)?.[0].normalization).toEqual({ reference: 1, rsf: [3e22, null], rsf_unit: "atoms/cm3" }),
    );
  });
});
