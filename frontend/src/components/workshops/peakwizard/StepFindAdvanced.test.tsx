// Peak Analyzer step ② ▸ Advanced: the Peaks panel's detector settings reach
// the wizard's find AND its saved recipe, so a batch run honours them.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PeakWizardPanel from "./PeakWizardPanel";
import { loadRecipes } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

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
  peaks: [{ center: 25, height: 1, fwhm: 3, prominence: 1, bg: 0 }],
  background: Array.from({ length: N }, () => 0),
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  findMock.mockResolvedValue(FOUND);
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    peakWizardOpen: true,
    reports: [],
    openReportId: null,
    peakOverlay: null,
    baselineOverlay: null,
    peakWizardEdit: null,
  });
});

const candidateRows = () => document.querySelectorAll("table.qz-table tbody tr");

describe("Peak Analyzer step ② ▸ Advanced", () => {
  it("'Find again' sends the edited Advanced fields with the recipe's own thresholds, and the saved recipe carries them", async () => {
    render(<PeakWizardPanel />);
    fireEvent.click(screen.getByText("Find peaks", { selector: ".qzk-wizard-step" }));

    // The disclosure is a lazy chunk: wait for its fields to be on screen.
    fireEvent.change(await screen.findByLabelText("Max width"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Min separation"), { target: { value: "0.2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Background" }), { target: { value: "polynomial" } });
    fireEvent.click(screen.getByRole("button", { name: "Find again" }));

    // Wait on STATE — the candidate table lands once the find resolves.
    await waitFor(() => expect(candidateRows()).toHaveLength(1));
    expect(findMock).toHaveBeenCalledTimes(1);
    expect(findMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        snr_threshold: 3, // the wizard's recipe default, not the route's 5
        max_peaks: 20,
        max_width_deg: 0.5,
        min_separation: 0.2,
        bg_method: "polynomial",
      }),
    );

    // ⑤ Save as recipe: the stored find section carries the settings.
    fireEvent.click(screen.getByText("Report", { selector: ".qzk-wizard-step" }));
    fireEvent.change(screen.getByPlaceholderText("recipe name"), { target: { value: "adv" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(loadRecipes()).toHaveLength(1));
    expect(loadRecipes()[0]!.find).toEqual(
      expect.objectContaining({ snr_threshold: 3, max_peaks: 20, max_width_deg: 0.5, min_separation: 0.2, bg_method: "polynomial" }),
    );
  });

  it("an untouched step ② still sends only the three fields it always did", async () => {
    render(<PeakWizardPanel />);
    fireEvent.click(screen.getByText("Find peaks", { selector: ".qzk-wizard-step" }));
    fireEvent.click(screen.getByRole("button", { name: "Find peaks" }));
    await waitFor(() => expect(candidateRows()).toHaveLength(1));
    expect(Object.keys(findMock.mock.calls[0]![0]).sort()).toEqual(["max_peaks", "snr_threshold", "x", "y"]);
  });
});
