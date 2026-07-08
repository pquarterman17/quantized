// Click-on-plot marker editing (interaction plan item 5, deferred from closed
// gap #31) — wizard-hook integration + scoping. The pure hit-test math lives
// in lib/peakMarkerHit.test.ts; this file exercises the store bridge
// usePeakWizard maintains (PlotStage's `peakWizardEdit` read) and the
// EXISTING addPeakAt/removePeak handlers the interaction drives. The live
// click gesture itself (a real uPlot canvas drag) is not exercised here —
// jsdom has no canvas, same caveat as the sibling gadget plugin tests.

import { fireEvent, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { usePeakWizard } from "./usePeakWizard";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  findPeaks: vi.fn(),
  fitMultiPeak: vi.fn(),
  peaksIntegrate: vi.fn(),
  reportEmit: vi.fn(),
  baselineALS: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4],
  values: [[0], [1], [4], [9], [16]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    peakOverlay: null,
    baselineOverlay: null,
    peakWizardEdit: null,
  });
});

describe("usePeakWizard — click-on-plot marker editing scoping", () => {
  it("is inactive on mount (step ① — range & baseline)", () => {
    const { result } = renderHook(() => usePeakWizard());
    expect(result.current.step).toBe(0);
    expect(result.current.markerEditActive).toBe(false);
    expect(useApp.getState().peakWizardEdit).toBeNull();
  });

  it("activates on step ② (find peaks) and deactivates on any other step", () => {
    const { result } = renderHook(() => usePeakWizard());

    act(() => result.current.setStep(1));
    expect(result.current.markerEditActive).toBe(true);
    expect(useApp.getState().peakWizardEdit).not.toBeNull();

    act(() => result.current.setStep(2));
    expect(result.current.markerEditActive).toBe(false);
    expect(useApp.getState().peakWizardEdit).toBeNull();

    act(() => result.current.setStep(0));
    expect(result.current.markerEditActive).toBe(false);
    expect(useApp.getState().peakWizardEdit).toBeNull();
  });

  it("clears the bridge when the wizard closes (component unmounts)", () => {
    const { result, unmount } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    expect(useApp.getState().peakWizardEdit).not.toBeNull();

    unmount();
    expect(useApp.getState().peakWizardEdit).toBeNull();
  });

  it("stays inactive without an active dataset", () => {
    useApp.setState({ activeId: null });
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    expect(result.current.markerEditActive).toBe(false);
    expect(useApp.getState().peakWizardEdit).toBeNull();
  });
});

describe("usePeakWizard — click-on-plot add/remove drive the existing handlers", () => {
  it("click→add: addPeakAt appends a candidate and the store bridge sees it", () => {
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));

    act(() => result.current.addPeakAt(2));
    expect(result.current.candidates).toHaveLength(1);
    expect(result.current.candidates[0]).toMatchObject({ center: 2, included: true, manual: true });
    expect(useApp.getState().peakWizardEdit?.markers).toEqual([
      { index: 0, center: 2, height: 4 }, // nearest sample at x=2 is y=4
    ]);
  });

  it("click-near→remove: removePeak drops the candidate and re-indexes the bridge", () => {
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    act(() => result.current.addPeakAt(1));
    act(() => result.current.addPeakAt(3));
    expect(result.current.candidates).toHaveLength(2);

    act(() => result.current.removePeak(0));
    expect(result.current.candidates).toHaveLength(1);
    expect(result.current.candidates[0]).toMatchObject({ center: 3 });
    expect(useApp.getState().peakWizardEdit?.markers).toEqual([{ index: 0, center: 3, height: 9 }]);
  });

  it("the bridge's onAdd/onRemove ARE addPeakAt/removePeak (no parallel state model)", () => {
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));

    act(() => useApp.getState().peakWizardEdit?.addPeakAt(4));
    expect(result.current.candidates).toHaveLength(1);

    act(() => useApp.getState().peakWizardEdit?.removePeak(0));
    expect(result.current.candidates).toHaveLength(0);
  });
});

describe("usePeakWizard — Escape pauses click-on-plot editing", () => {
  it("Escape deactivates without changing the step; re-entering step ② re-arms it", () => {
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    expect(result.current.markerEditActive).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(result.current.markerEditActive).toBe(false);
    expect(useApp.getState().peakWizardEdit).toBeNull();
    expect(result.current.step).toBe(1); // still on step ② — Escape didn't navigate

    act(() => result.current.setStep(0));
    act(() => result.current.setStep(1));
    expect(result.current.markerEditActive).toBe(true);
    expect(useApp.getState().peakWizardEdit).not.toBeNull();
  });

  it("a non-Escape key does not pause the mode", () => {
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(result.current.markerEditActive).toBe(true);
  });
});

// Guard against the underlying vi.mock actually being invoked (it shouldn't
// be — findPeaks is only called by runFind(), never by addPeakAt/removePeak).
describe("usePeakWizard — click-on-plot editing never triggers a find/fit call", () => {
  it("addPeakAt/removePeak do not call findPeaks", async () => {
    const { findPeaks } = await import("../../../lib/api");
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    act(() => result.current.addPeakAt(1));
    act(() => result.current.removePeak(0));
    await waitFor(() => expect(findPeaks).not.toHaveBeenCalled());
  });
});
