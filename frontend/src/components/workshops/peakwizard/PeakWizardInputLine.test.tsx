// The wizard's input line names its own fit range and dropped rows, and shows
// the resolver's refusal instead of a silently empty wizard.
import { act, renderHook, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import PeakWizardPanel from "./PeakWizardPanel";
import { usePeakWizard } from "./usePeakWizard";

const N = 20;
const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d1", name: "xrd scan",
  data: {
    time: Array.from({ length: N }, (_v, i) => i),
    values: Array.from({ length: N }, (_v, i) => [i === 3 ? Number.NaN : i]),
    labels: ["I"], units: ["cts"], metadata: {},
  },
  ...over,
});

const reset = (dataset: Dataset) => {
  localStorage.clear();
  useApp.setState({
    datasets: [dataset], activeId: "d1", peakWizardOpen: true, reports: [], openReportId: null,
    peakOverlay: null, baselineOverlay: null, peakWizardEdit: null, xKey: null, yKeys: null, seriesOrder: null,
  });
};

const line = () => screen.getByLabelText("Analysis input");

beforeEach(() => reset(ds({ excludedRows: [0, 1] })));

describe("Peak wizard input line", () => {
  it("states rows used of total, exclusions and the gap-row drop", () => {
    render(<PeakWizardPanel />);
    expect(line().textContent).toContain("Input: xrd scan");
    expect(line().textContent).toContain("17 of 20 rows");
    expect(line().textContent).toContain("2 rows excluded or filtered out");
    expect(line().textContent).toContain("1 row with gaps dropped");
    expect(line()).not.toHaveAttribute("data-refusal");
  });

  it("follows the fit range as it changes", () => {
    const { result } = renderHook(() => usePeakWizard());
    expect(result.current.inputLine?.text).not.toContain("fit range");
    act(() => result.current.patchRecipe({ range: { lo: 5, hi: 15 } }));
    expect(result.current.inputLine?.text).toContain("fit range 5–15");
    expect(result.current.inputLine?.text).toContain("11 of 20 rows");
    act(() => result.current.patchRecipe({ range: { lo: 500, hi: 600 } }));
    expect(result.current.inputLine?.refusal).toBe("No finite rows fall inside the fit range.");
  });

  it("shows the refusal when the resolver refuses a lazy preview", () => {
    reset(ds({ pending: { kind: "upload", bookId: "b", rows: N, cols: 1, previewSampled: true } }));
    render(<PeakWizardPanel />);
    expect(line()).toHaveAttribute("data-refusal");
    expect(line().textContent).toMatch(/The full worksheet is still loading/);
  });

  it("shows the refusal when every row is excluded", () => {
    reset(ds({ excludedRows: Array.from({ length: N }, (_v, i) => i) }));
    render(<PeakWizardPanel />);
    expect(line().textContent).toMatch(/No rows remain/);
  });
});
