// Gap audit 6, lane N / P10: the Peak Analyzer finds peaks on reaching step ②
// (as Origin does), refuses Next with zero peaks and says why, and a model fit
// leaves "fitted …" on the status line.

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import PeakWizardPanel from "./PeakWizardPanel";
import { usePeakWizard } from "./usePeakWizard";

const { findMock } = vi.hoisted(() => ({ findMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));

const N = 50;
const ds: Dataset = {
  id: "d1",
  name: "xrd scan",
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => [Math.exp(-((i - 25) ** 2) / 8)]),
    labels: ["I"],
    units: ["cts"],
    metadata: {},
  },
};
const FOUND = {
  peaks: [{ center: 25, height: 1, fwhm: 3, prominence: 1 }],
  background: Array.from({ length: N }, () => 0),
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useApp.setState({
    datasets: [ds], activeId: "d1", peakWizardOpen: true, xKey: null, yKeys: null, seriesOrder: null,
    peakOverlay: null, baselineOverlay: null, fitOverlay: null, peakWizardEdit: null, status: "",
  });
});
afterEach(() => vi.unstubAllGlobals());

const step = (name: string) => fireEvent.click(screen.getByText(name, { selector: ".qzk-wizard-step" }));
const next = () => screen.getByRole("button", { name: /Next/ });

describe("Peak Analyzer step 2 auto-find", () => {
  it("finds peaks on entering the step without a click", async () => {
    findMock.mockResolvedValue(FOUND);
    const { result } = renderHook(() => usePeakWizard());
    expect(findMock).not.toHaveBeenCalled();
    act(() => result.current.setStep(1));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(findMock).toHaveBeenCalledTimes(1);
  });

  it("does not re-find over existing candidates when the step is revisited", async () => {
    findMock.mockResolvedValue(FOUND);
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    act(() => result.current.setStep(2));
    act(() => result.current.setStep(1));
    expect(findMock).toHaveBeenCalledTimes(1);
  });

  it("with zero peaks, Next is disabled and says why; a found peak enables it", async () => {
    findMock.mockResolvedValue({ peaks: [], background: [] });
    render(<PeakWizardPanel />);
    step("Find peaks");
    await waitFor(() => expect(next()).toBeDisabled());
    expect(screen.getByRole("status")).toHaveTextContent(/no peaks to fit/i);
    expect(next()).toHaveAttribute("title", expect.stringMatching(/no peaks to fit/i));

    findMock.mockResolvedValue(FOUND);
    fireEvent.click(screen.getByRole("button", { name: "Find peaks" }));
    await waitFor(() => expect(next()).toBeEnabled());
  });
});

describe("Peak Analyzer step chips with no peaks", () => {
  it("the Model and Fit & review chips are disabled with the same reason until a peak exists", async () => {
    findMock.mockResolvedValue({ peaks: [], background: [] });
    render(<PeakWizardPanel />);
    step("Find peaks");
    const chip = (n: string) => screen.getByText(n, { selector: ".qzk-wizard-step" });
    await waitFor(() => expect(next()).toBeDisabled());
    for (const n of ["Model", "Fit & review"]) {
      expect(chip(n)).toBeDisabled();
      expect(chip(n)).toHaveAttribute("title", expect.stringMatching(/no peaks to fit/i));
    }
    findMock.mockResolvedValue(FOUND);
    fireEvent.click(screen.getByRole("button", { name: "Find peaks" }));
    await waitFor(() => expect(chip("Model")).toBeEnabled());
    expect(chip("Fit & review")).toBeEnabled();
  });
});

/** A find the test resolves by hand, so a result can land late. */
function deferredFind() {
  let resolve!: (v: typeof FOUND) => void;
  findMock.mockImplementationOnce(() => new Promise<typeof FOUND>((r) => (resolve = r)));
  return { resolve: (v: typeof FOUND = FOUND) => resolve(v) };
}

describe("Peak Analyzer auto-find races", () => {
  it("a late auto-find never replaces peaks the user added while it ran", async () => {
    const d = deferredFind();
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    await waitFor(() => expect(result.current.findBusy).toBe(true));
    act(() => result.current.addPeakAt(10));
    expect(result.current.candidates).toHaveLength(1);
    const manualCenter = result.current.candidates[0]!.center;
    await act(async () => d.resolve());
    await waitFor(() => expect(result.current.findBusy).toBe(false));
    expect(result.current.candidates).toHaveLength(1);
    expect(result.current.candidates[0]).toMatchObject({ manual: true, center: manualCenter });
  });

  it("leaving and re-entering step 2 while the first find is in flight does not start a second", async () => {
    const d = deferredFind();
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    await waitFor(() => expect(result.current.findBusy).toBe(true));
    act(() => result.current.setStep(2));
    act(() => result.current.setStep(1));
    await act(async () => d.resolve());
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(findMock).toHaveBeenCalledTimes(1);
  });

  it("a find that lands after the dataset changed is dropped, not committed onto the new trace", async () => {
    const d = deferredFind();
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.setStep(1));
    await waitFor(() => expect(result.current.findBusy).toBe(true));
    act(() => useApp.setState({ datasets: [ds, { ...ds, id: "d2", name: "other" }], activeId: "d2" }));
    await act(async () => d.resolve());
    await waitFor(() => expect(result.current.findBusy).toBe(false));
    expect(result.current.candidates).toHaveLength(0);
  });
});

describe("Peak Analyzer Next gate", () => {
  it("says the find failed when it did, instead of only 'no peaks'", async () => {
    findMock.mockRejectedValue(new Error("backend unreachable"));
    render(<PeakWizardPanel />);
    step("Find peaks");
    await waitFor(() => expect(next()).toHaveAttribute("title", expect.stringMatching(/peak find failed.*backend unreachable/)));
    expect(next()).toBeDisabled();
  });

  it("step 3 blocks Next too once its last peak is removed", async () => {
    findMock.mockResolvedValue(FOUND);
    render(<PeakWizardPanel />);
    step("Find peaks");
    await waitFor(() => expect(next()).toBeEnabled());
    step("Model");
    expect(next()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "remove peak 1" }));
    expect(next()).toBeDisabled();
    expect(next()).toHaveAttribute("title", expect.stringMatching(/no peaks to fit/i));
  });

  it("the Report chip stays reachable with no peaks (the integrate-only path needs none)", async () => {
    findMock.mockResolvedValue({ peaks: [], background: [] });
    render(<PeakWizardPanel />);
    step("Find peaks");
    await waitFor(() => expect(next()).toBeDisabled());
    expect(screen.getByText("Report", { selector: ".qzk-wizard-step" })).toBeEnabled();
  });
});

describe("Peak Analyzer fit status", () => {
  it("says 'fitted' on the status line after a model fit", async () => {
    findMock.mockResolvedValue(FOUND);
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(JSON.stringify(modelFitResponse()), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.addPeakAt(25));
    await act(() => result.current.model.run());
    await waitFor(() => expect(result.current.model.result).not.toBeNull());
    expect(useApp.getState().status).toMatch(/fitted 1 peak/);
  });
});
