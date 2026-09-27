// SIMS depth-profile workshop — state-hook unit tests for two 2026-09 review
// findings not already exercised end-to-end by SimsPanel.test.tsx:
//  #1 confirm gating: a calibration time-unit override's `unit-override`
//     warning (`confirm: true`) must block Create until explicitly
//     acknowledged, and the acknowledgment must re-arm when the inputs change.
//  #7 per-dataset state: the background region and the calibration time-unit
//     override are specific to the PREVIOUS dataset and must reset on a
//     dataset switch; the background's guessed `keep` default must follow
//     the reference when it changes, but never overwrite a user's own edit.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsProcessRequest, SimsProcessResult } from "../../../lib/api/sims";
import type { DataStruct } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import { useSims } from "./useSims";

vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn() }));
const { processSims } = await import("../../../lib/api/sims");

/** Stand-in backend: rate calibration (depth = rate × t); echoes calc.sims_depth's
 *  `unit-override` confirm warning whenever a `time_unit` override is sent. */
function fakeBackend(body: SimsProcessRequest): Promise<SimsProcessResult> {
  const cal = body.calibration;
  const rate = cal?.sputter_rate ?? 1;
  const time = cal ? body.dataset.time.map((t) => t * rate) : body.dataset.time;
  const metadata = cal ? { ...body.dataset.metadata, x_column_name: "Depth", x_column_unit: "nm" } : body.dataset.metadata;
  const warnings =
    cal?.time_unit != null
      ? [{ code: "unit-override", text: "x is recorded in 'nm' but was calibrated as time in 's', as you stated", confirm: true }]
      : [];
  return Promise.resolve({
    dataset: { ...body.dataset, time, metadata: { ...metadata, sims_processing: [{ stage: "calibration" }] } },
    warnings,
    stages: [{ stage: "calibration" }],
  });
}

const raw: DataStruct = {
  time: [0, 1, 2],
  values: [[10, 1000], [12, 1000], [9, 1000]],
  labels: ["B", "Si"],
  units: ["c/s", "c/s"],
  metadata: { x_column_name: "Depth", x_column_unit: "nm" },
};
// A second dataset whose columns come in another order (still has "Si").
const swapped: DataStruct = { ...raw, labels: ["Si", "B"], values: raw.values.map(([b, si]) => [si, b]) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(processSims).mockImplementation(fakeBackend);
  useApp.setState({
    datasets: [
      { id: "s1", name: "a.csv", data: raw },
      { id: "s2", name: "b.csv", data: swapped },
    ],
    folders: [],
    activeId: "s1",
    selectedIds: ["s1"],
    macroRecording: true,
    macroSteps: [],
  });
  useSimsDialog.setState({ seed: "s1" });
});

describe("useSims — confirm gating (finding 1)", () => {
  it("blocks Create on a plain OK when a stated time-unit override needs confirming, until acknowledged", async () => {
    const { result } = renderHook(() => useSims(true));
    act(() => result.current.setForm({ calOn: true, calMethod: "rate", sputterRate: "1", timeUnit: "s" }));
    await waitFor(() => expect(result.current.result).toBeTruthy());
    expect(result.current.blockedByUnits).toBe(true);
    expect(result.current.canCreate).toBe(false);

    act(() => result.current.setUnitsAcknowledged(true));
    expect(result.current.blockedByUnits).toBe(false);
    expect(result.current.canCreate).toBe(true);
  });

  it("re-arms the acknowledgment when the inputs change", async () => {
    const { result } = renderHook(() => useSims(true));
    act(() => result.current.setForm({ calOn: true, calMethod: "rate", sputterRate: "1", timeUnit: "s" }));
    await waitFor(() => expect(result.current.result).toBeTruthy());
    act(() => result.current.setUnitsAcknowledged(true));
    expect(result.current.unitsAcknowledged).toBe(true);

    act(() => result.current.setForm({ sputterRate: "2" }));
    expect(result.current.unitsAcknowledged).toBe(false);
    expect(result.current.canCreate).toBe(false);
  });

  it("never turns on canCreate from a plain OK without the confirm warning", async () => {
    const { result } = renderHook(() => useSims(true));
    act(() => result.current.setForm({ smoothOn: true }));
    await waitFor(() => expect(result.current.result).toBeTruthy());
    expect(result.current.blockedByUnits).toBe(false);
    expect(result.current.canCreate).toBe(true);
  });
});

describe("useSims — per-dataset state (finding 7)", () => {
  it("resets the background region and the time-unit override on a dataset switch", () => {
    const { result } = renderHook(() => useSims(true));
    act(() => result.current.setForm({ bgOn: true, bgLo: "10", bgHi: "20", timeUnit: "s" }));
    expect(result.current.form).toMatchObject({ bgLo: "10", bgHi: "20", timeUnit: "s" });

    act(() => result.current.setDatasetId("s2"));
    expect(result.current.form).toMatchObject({ bgLo: "", bgHi: "", timeUnit: "" });
  });

  it("re-seeds the background's guessed `keep` default when the reference changes, but keeps a user's own edit", () => {
    const { result } = renderHook(() => useSims(true));
    // Si has the larger median signal (1000 vs 10) -- the guessed default.
    expect(result.current.form.reference).toBe("Si");
    expect(result.current.form.bgKeep).toEqual(["Si"]);

    act(() => result.current.setReference("B"));
    expect(result.current.form.bgKeep).toEqual(["B"]); // the untouched default followed the reference

    act(() => result.current.setForm({ bgKeep: ["B", "Si"] })); // a deliberate user edit
    act(() => result.current.setReference("Si"));
    expect(result.current.form.bgKeep).toEqual(["B", "Si"]); // never clobbered
  });
});
