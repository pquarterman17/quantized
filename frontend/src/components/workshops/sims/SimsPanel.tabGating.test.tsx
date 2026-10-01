// P2.3 review finding 9 — a workshop tab stays MOUNTED (hidden) once visited
// so its half-filled form survives a tab switch (SimsPanel.tsx's `pane`),
// but that must not mean its debounced live preview keeps firing full-
// dataset POSTs in the background while another tab is showing. Each hook
// (useSims/useSimsCompare/useSimsRegion) now takes an `active` flag that
// gates its preview key to `""` -- exercised here end to end through the
// real SimsPanel + tab switching, with fake timers so "did NOT fire" is a
// deterministic claim about elapsed debounce time, not a hopeful wait.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SimsCompareRequest,
  SimsCompareResult,
  SimsProcessRequest,
  SimsProcessResult,
  SimsRegionRequest,
  SimsRegionResult,
} from "../../../lib/api/sims";
import type { DataStruct } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import SimsPanel from "./SimsPanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn(), compareSims: vi.fn(), measureSimsRegion: vi.fn() }));
const { processSims, compareSims, measureSimsRegion } = await import("../../../lib/api/sims");

function fakeProcess(body: SimsProcessRequest): Promise<SimsProcessResult> {
  return Promise.resolve({ dataset: body.dataset, warnings: [], stages: [{ stage: "calibration" }] });
}
function fakeCompare(body: SimsCompareRequest): Promise<SimsCompareResult> {
  const p0 = body.profiles[0]!;
  return Promise.resolve({
    dataset: { time: p0.dataset.time, values: p0.dataset.values.map((r) => [r[0]]), labels: ["B"], units: ["c/s"], metadata: {} },
    warnings: [],
    traces: [],
  });
}
function fakeRegion(body: SimsRegionRequest): Promise<SimsRegionResult> {
  return Promise.resolve({
    region: [body.lo, body.hi], x_name: "Depth", x_unit: "nm", rows_in_region: body.dataset.time.length,
    method: { threshold_mode: body.threshold_mode, threshold: body.threshold }, species: [], warnings: [],
    csv: "# SIMS region measures\n",
  });
}

const profile: DataStruct = {
  time: [0, 10, 20],
  values: [[1e18, 5e22], [3e18, 5e22], [5e18, 5e22]],
  labels: ["B", "Si"],
  units: ["atoms/cm3", "atoms/cm3"],
  metadata: { x_column_name: "Depth", x_column_unit: "nm" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(processSims).mockImplementation(fakeProcess);
  vi.mocked(compareSims).mockImplementation(fakeCompare);
  vi.mocked(measureSimsRegion).mockImplementation(fakeRegion);
  useApp.setState({
    datasets: [{ id: "s1", name: "implant.csv", data: profile }],
    folders: [],
    activeId: "s1",
    selectedIds: ["s1"],
    macroRecording: true,
    macroSteps: [],
  });
  useSimsDialog.setState({ seed: "s1", opened: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("SimsPanel — hidden tabs stop firing their debounced preview (finding 9)", () => {
  it("Process's preview goes silent once Compare is the visible tab, and resumes when it is visible again", async () => {
    render(<SimsPanel />);
    // Turn on a stage so Process's form is valid and previews.
    fireEvent.click(screen.getByRole("checkbox", { name: "Depth calibration (time → depth)" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Calibration method" }), { target: { value: "rate" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Sputter rate" }), { target: { value: "2" } });
    await tick(300);
    expect(processSims).toHaveBeenCalledTimes(1);

    // Switch to Compare — Process is now hidden (still mounted, per `pane`).
    fireEvent.click(screen.getByRole("radio", { name: "Compare" }));
    await tick(300);
    expect(compareSims).toHaveBeenCalledTimes(1);

    // Edit the HIDDEN Process form (its checkbox is still in the DOM).
    fireEvent.change(screen.getByRole("textbox", { name: "Sputter rate", hidden: true }), { target: { value: "3" } });
    await tick(300);
    // Finding 9: no background POST for the edit made while hidden.
    expect(processSims).toHaveBeenCalledTimes(1);
    expect(compareSims).toHaveBeenCalledTimes(1); // Compare's own preview is unaffected either way

    // Switch back to Process — it becomes the visible tab again and its
    // (now-stale) form previews for real.
    fireEvent.click(screen.getByRole("radio", { name: "Process" }));
    await tick(300);
    expect(processSims).toHaveBeenCalledTimes(2);
  });

  it("Region's preview does not fire while Compare is the visible tab", async () => {
    render(<SimsPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Region" }));
    await tick(300);
    expect(measureSimsRegion).toHaveBeenCalledTimes(1); // Region defaults to a valid whole-profile request

    fireEvent.click(screen.getByRole("radio", { name: "Compare" }));
    await tick(300);
    const afterSwitch = vi.mocked(measureSimsRegion).mock.calls.length;

    // Edit the HIDDEN Region form.
    fireEvent.change(screen.getByRole("textbox", { name: "Region from", hidden: true }), { target: { value: "5" } });
    await tick(300);
    expect(measureSimsRegion).toHaveBeenCalledTimes(afterSwitch); // unchanged while hidden
  });
});
