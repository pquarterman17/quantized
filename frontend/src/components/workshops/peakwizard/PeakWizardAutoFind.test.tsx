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
