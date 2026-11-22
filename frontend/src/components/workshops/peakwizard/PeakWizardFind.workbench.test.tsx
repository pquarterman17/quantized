// Peak analyzer step 2 on the workbench shell (lane WB3): Find peaks stays a
// button (plus the one automatic find on entering the step), keeps its defaults,
// and now says the candidate list is OUT OF DATE once the find settings or the
// working trace change after a find; its failures render as WorkbenchMessage
// (a refusal apart from a backend error). The candidates are a hand-edited
// working list, so out of date is a visible marker, never an automatic re-find
// that would discard the user's edits.

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import PeakWizardPanel from "./PeakWizardPanel";
import { usePeakWizard } from "./usePeakWizard";

const { findMock } = vi.hoisted(() => ({ findMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));

const N = 50;
const ds: Dataset = {
  id: "d1", name: "xrd scan",
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => [Math.exp(-((i - 25) ** 2) / 8)]),
    labels: ["I"], units: ["cts"], metadata: {},
  },
};
const FOUND = { peaks: [{ center: 25, height: 1, fwhm: 3, prominence: 1 }], background: Array.from({ length: N }, () => 0) };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  findMock.mockResolvedValue(FOUND);
  useApp.setState({
    datasets: [ds], activeId: "d1", peakWizardOpen: true, xKey: null, yKeys: null, seriesOrder: null,
    peakOverlay: null, baselineOverlay: null, fitOverlay: null, peakWizardEdit: null, status: "",
  });
});

async function found() {
  const hook = renderHook(() => usePeakWizard());
  act(() => hook.result.current.setStep(1));
  await waitFor(() => expect(hook.result.current.candidates).toHaveLength(1));
  return hook;
}

describe("characterization: Find is a button", () => {
  it("changing a find setting does not re-find or touch the list", async () => {
    const h = await found();
    act(() => h.result.current.patchRecipe({ find: { snr_threshold: 9 } }));
    await act(async () => {});
    expect(findMock).toHaveBeenCalledTimes(1);
    expect(h.result.current.candidates).toHaveLength(1);
  });
});

describe("shell: out of date", () => {
  it("a find is current right after it ran, out of date after a setting changes, current again after Find", async () => {
    const h = await found();
    expect(h.result.current.findStale).toBe(false);
    act(() => h.result.current.patchRecipe({ find: { snr_threshold: 9 } }));
    expect(h.result.current.findStale).toBe(true);
    await act(async () => { await h.result.current.runFind(); });
    expect(findMock).toHaveBeenCalledTimes(2);
    expect(h.result.current.findStale).toBe(false);
  });

  it("hand edits to the list are not a settings change", async () => {
    const h = await found();
    act(() => h.result.current.addPeakAt(10));
    act(() => h.result.current.togglePeak(0));
    expect(h.result.current.findStale).toBe(false);
  });

  it("Find again with new settings in one gesture is current, not stale", async () => {
    const h = await found();
    const next = { ...h.result.current.recipe.find, snr_threshold: 9 };
    await act(async () => {
      h.result.current.patchRecipe({ find: next });
      await h.result.current.runFind(next);
    });
    expect(h.result.current.findStale).toBe(false);
  });

  it("the panel shows the shared marker beside Find peaks", async () => {
    render(<PeakWizardPanel />);
    fireEvent.click(screen.getByText("Find peaks", { selector: ".qzk-wizard-step" }));
    await screen.findByRole("checkbox", { name: "include peak 1" });
    expect(screen.queryByText(/Out of date/)).toBeNull();
    fireEvent.change(screen.getByLabelText("SNR ≥"), { target: { value: "9" } });
    expect(await screen.findByText(/Out of date/)).toBeInTheDocument();
  });
});

describe("shell: messages", () => {
  it("a backend failure is an error alert", async () => {
    findMock.mockRejectedValue(new Error("detector exploded"));
    render(<PeakWizardPanel />);
    fireEvent.click(screen.getByText("Find peaks", { selector: ".qzk-wizard-step" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("detector exploded");
    expect(alert).toHaveAttribute("data-kind", "error");
  });
});
