// P2.3 SIMS depth profiles — the workshop previews LIVE before it creates
// anything (log plot, x range after calibration, the backend's warnings);
// Create adds one recorded, undoable derived dataset; the Analyze menu opens it.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import type { SimsProcessRequest, SimsProcessResult } from "../../../lib/api/sims";
import type { DataStruct } from "../../../lib/types";
import { useConfirm } from "../../../store/confirmDialog";
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
  const override = body.calibration?.time_unit
    ? [{ code: "unit-override", text: `x is treated as ${body.calibration.time_unit} (stated)`, confirm: true }]
    : [];
  return Promise.resolve({
    dataset: { ...body.dataset, time, metadata: { ...metadata, sims_processing: [{ stage: "calibration" }] } },
    warnings: [{ code: "reordered", text: "time does not increase monotonically; depth keeps the row order" }, ...override],
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
    history: [],
    future: [],
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

    fireEvent.click(screen.getByRole("checkbox", { name: "Calibrate / rescale x to depth" }));
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

  it("previews an explicit divide-and-offset calibration without claiming x is time", async () => {
    render(<SimsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Calibrate / rescale x to depth" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Calibration method" }), { target: { value: "scale" } });
    expect(screen.queryByRole("combobox", { name: "Time unit of x" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Scale operation" }), { target: { value: "divide" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Scale value" }), { target: { value: "1000" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Depth offset" }), { target: { value: "-2" } });
    await waitFor(() =>
      expect(vi.mocked(processSims).mock.calls.at(-1)?.[0].calibration).toMatchObject({
        method: "scale",
        scale_factor: 0.001,
        offset: -2,
        depth_unit: "nm",
        time_unit: null,
      }),
    );
    expect(screen.getByText(/Depth \(nm\) = x \(s\) ÷ 1000 − 2/)).toBeTruthy();
  });

  it("lists an incompatible profile disabled WITH its reason and never sends it", async () => {
    const alreadyDepth = { ...raw, metadata: { ...raw.metadata, x_column_name: "Depth", x_column_unit: "nm" } };
    useApp.setState({
      datasets: [
        { id: "s1", name: "counts.csv", data: raw },
        { id: "s2", name: "depth.csv", data: alreadyDepth },
      ],
      activeId: "s1",
      selectedIds: ["s1", "s2"],
    });
    render(<SimsPanel />);
    expect(screen.getByRole("checkbox", { name: "Apply these settings to several loaded profiles" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Calibrate / rescale x to depth" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Calibration method" }), { target: { value: "scale" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Scale value" }), { target: { value: "0.5" } });
    const depthBox = screen.getByRole("checkbox", { name: "depth.csv" });
    expect(depthBox).toBeDisabled();
    expect(depthBox).not.toBeChecked();
    expect(screen.getByText("not compatible: this SIMS scale calibration was made for x in s, not nm")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create 1 processed dataset" })).not.toBeDisabled());

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create 1 processed dataset" })));
    await waitFor(() => expect(screen.getByLabelText("SIMS batch results")).toHaveTextContent("1 created"));
    expect(vi.mocked(processSims).mock.calls.every(([body]) => body.dataset.metadata.x_column_unit === "s")).toBe(true);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["counts.csv", "depth.csv", "counts (SIMS processed)"]);
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["counts.csv", "depth.csv"]);
  });

  it("shows the other profiles' warnings in ONE review before creating; declining creates nothing", async () => {
    useApp.setState({
      datasets: [
        { id: "s1", name: "one.csv", data: raw },
        { id: "s2", name: "two.csv", data: raw },
      ],
      activeId: "s1",
      selectedIds: ["s1", "s2"],
    });
    render(<SimsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Smooth" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create 2 processed datasets" })).not.toBeDisabled());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create 2 processed datasets" })));
    // Only two.csv is listed: one.csv's warnings were already in the preview.
    await waitFor(() => expect(useConfirm.getState().title).toBe("SIMS batch: 1 profile has warnings"));
    expect(useConfirm.getState().message).toBe("two.csv\n  • time does not increase monotonically; depth keeps the row order");
    expect(useConfirm.getState().danger).toBe(false);
    act(() => useConfirm.getState().resolve?.(false));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("nothing was created"));
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("a stated time-unit override goes to the danger review for the other profiles, then creates them", async () => {
    const blank = { ...raw, metadata: { x_column_name: "Time" } };
    useApp.setState({
      datasets: [
        { id: "s1", name: "one.csv", data: blank },
        { id: "s2", name: "two.csv", data: blank },
      ],
      activeId: "s1",
      selectedIds: ["s1", "s2"],
    });
    render(<SimsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Calibrate / rescale x to depth" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Calibration method" }), { target: { value: "rate" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Sputter rate" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Time unit of x" }), { target: { value: "s" } });
    const ack = await screen.findByRole("checkbox", { name: "Calibrate despite the stated x unit override" });
    fireEvent.click(ack);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create 2 processed datasets" })).not.toBeDisabled());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create 2 processed datasets" })));
    await waitFor(() => expect(useConfirm.getState().confirmLabel).toBe("Create despite unit override"));
    expect(useConfirm.getState().danger).toBe(true);
    expect(useConfirm.getState().message).toContain("x is treated as s (stated)");
    act(() => useConfirm.getState().resolve?.(true));
    await waitFor(() => expect(screen.getByLabelText("SIMS batch results")).toHaveTextContent("2 created"));
    expect(useApp.getState().datasets.map((d) => d.data.time)).toEqual([raw.time, raw.time, [0, 20, 40, 60], [0, 20, 40, 60]]);
  });

  it("keeps each successful async batch output independently undoable", async () => {
    useApp.setState({
      datasets: [
        { id: "s1", name: "one.csv", data: raw },
        { id: "s2", name: "two.csv", data: raw },
      ],
      activeId: "s1",
      selectedIds: ["s1", "s2"],
    });
    render(<SimsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Smooth" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create 2 processed datasets" })).not.toBeDisabled());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create 2 processed datasets" })));
    await waitFor(() => expect(useConfirm.getState().title).toBe("SIMS batch: 1 profile has warnings"));
    act(() => useConfirm.getState().resolve?.(true));
    await waitFor(() => expect(screen.getByLabelText("SIMS batch results")).toHaveTextContent("2 created"));
    expect(screen.getByLabelText("SIMS batch results")).toHaveTextContent("two.csv: time does not increase monotonically");
    expect(useApp.getState().datasets).toHaveLength(4);
    expect(useApp.getState().history).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Smooth" }));
    expect(screen.queryByLabelText("SIMS batch results")).toBeNull();
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["one.csv", "two.csv", "one (SIMS processed)"]);
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["one.csv", "two.csv"]);
  });
});
