import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PeakWizardPanel from "./PeakWizardPanel";
import ToolWindow from "../../overlays/ToolWindow";
import { pushEscapeSurface } from "../../../lib/escapeStack";
import type { Dataset } from "../../../lib/types";
import { pressEscape } from "../../../test/pressEscape";
import { useApp } from "../../../store/useApp";

const { findMock, fitMock, integrateMock, emitMock, alsMock } = vi.hoisted(() => ({
  findMock: vi.fn(),
  fitMock: vi.fn(),
  integrateMock: vi.fn(),
  emitMock: vi.fn(),
  alsMock: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  peaksIntegrate: integrateMock,
  reportEmit: emitMock,
}));
// findPeaks/fitMultiPeak and baselineALS moved to their own siblings (R8
// bundle-diet pass) — mock them at their real import paths.
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
  fitMultiPeak: fitMock,
}));
vi.mock("../../../lib/api/baseline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/baseline")>()),
  baselineALS: alsMock,
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
const FIT = {
  peaks: [
    { center: 25.1, fwhm: 3.2, height: 0.98, bg: 0, eta: null, area: 3.3, status: "ok", model: "Gaussian" },
  ],
  bgCoeffs: [0],
  R2: 0.99,
  rmse: 0.01,
  nPeaks: 1,
  model: "Gaussian",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
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

describe("PeakWizardPanel", () => {
  it("walks find → fit → report and lands a #36 report", async () => {
    findMock.mockResolvedValue(FOUND);
    fitMock.mockResolvedValue(FIT);
    emitMock.mockResolvedValue({ report: { title: "t", sections: [] } });
    render(<PeakWizardPanel />);

    // ② find
    fireEvent.click(screen.getByText("Find peaks", { selector: ".qzk-wizard-step" }));
    fireEvent.click(screen.getByRole("button", { name: "Find peaks" }));
    await waitFor(() => expect(findMock).toHaveBeenCalled());
    // markers land on the plot once the candidates effect settles
    await waitFor(() => expect(useApp.getState().peakOverlay?.datasetId).toBe("d1"));

    // ③ The mixed-shape model became the default engine in audit P2.4 slice 2
    // (its own walk is PeakWizardModelFit.test.tsx); this walk pins the
    // CLASSIC multifit path, which stays one select away.
    fireEvent.click(screen.getByText("Model", { selector: ".qzk-wizard-step" }));
    fireEvent.change(screen.getByRole("combobox", { name: "fit engine" }), { target: { value: "classic" } });

    // ④ fit
    fireEvent.click(screen.getByText("Fit & review"));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await waitFor(() => expect(screen.getByText(/R² =/)).toBeInTheDocument());
    expect(fitMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "Gaussian", link_mode: "None" }),
    );

    // ⑤ report
    fireEvent.click(screen.getByText("Report", { selector: ".qzk-wizard-step" }));
    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "multipeak_fit" }),
    );
  });

  it("integrate-only path (#32) reports through the integrate emitter", async () => {
    findMock.mockResolvedValue(FOUND);
    integrateMock.mockResolvedValue({
      peaks: [
        { region: [20, 30], area: 3.1, area_pct: 100, centroid: 25, height: 1, position: 25, fwhm: 3 },
      ],
      total_area: 3.1,
      baseline: "linear",
    });
    emitMock.mockResolvedValue({ report: { title: "t", sections: [] } });
    render(<PeakWizardPanel />);

    fireEvent.click(screen.getByText("Find peaks", { selector: ".qzk-wizard-step" }));
    fireEvent.click(screen.getByRole("button", { name: "Find peaks" }));
    await waitFor(() => expect(findMock).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Report", { selector: ".qzk-wizard-step" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "integrate" } });
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await waitFor(() => expect(screen.getByText(/20–30/)).toBeInTheDocument());
    expect(integrateMock).toHaveBeenCalledWith(
      expect.objectContaining({ regions: [[expect.any(Number), expect.any(Number)]] }),
    );

    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(emitMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "integrate" }));
  });

  it("ALS baseline preview overlays on the plot", async () => {
    alsMock.mockResolvedValue({ baseline: Array.from({ length: N }, () => 0.1) });
    render(<PeakWizardPanel />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[selects.length - 1], { target: { value: "als" } });
    await waitFor(() => expect(alsMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(useApp.getState().baselineOverlay?.datasetId).toBe("d1"),
    );
  });

  it("Back/Next preserves edits (candidates survive a round-trip)", async () => {
    findMock.mockResolvedValue(FOUND);
    render(<PeakWizardPanel />);
    fireEvent.click(screen.getByText("Find peaks", { selector: ".qzk-wizard-step" }));
    fireEvent.click(screen.getByRole("button", { name: "Find peaks" }));
    await waitFor(() => expect(screen.getByText("25")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByText("25")).toBeInTheDocument(); // candidate list intact
  });

  it("close clears both overlays", () => {
    render(<PeakWizardPanel />);
    useApp.setState({
      peakOverlay: { datasetId: "d1", y: [] },
      baselineOverlay: { datasetId: "d1", y: [] },
    });
    fireEvent.click(screen.getByTitle("Close"));
    const s = useApp.getState();
    expect(s.peakWizardOpen).toBe(false);
    expect(s.peakOverlay).toBeNull();
    expect(s.baselineOverlay).toBeNull();
  });
});

// Residual R11 (PRIMARY_SOFTWARE_AUDIT_PLAN): step ②'s marker-edit pause used
// to claim Escape with a window-bubble `preventDefault()` from ANY focus, so it
// out-ranked an open menu and stole keystrokes aimed at other windows. It is
// now a registered surface on `lib/escapeStack.ts`'s ladder: a `window`-tier
// claim only while focus is inside the Analyzer, and a `selection`-tier claim
// (below every open surface) when focus is outside all of them, e.g. the plot.
describe("PeakWizardPanel — the step ② Escape pause is scoped (R11)", () => {
  const stepTwo = () => {
    const chip = screen.getByText("Find peaks", { selector: ".qzk-wizard-step" });
    fireEvent.click(chip);
    expect(useApp.getState().peakWizardEdit).not.toBeNull();
    return chip;
  };

  it("inside the Analyzer: Esc① pauses and keeps it open, Esc② closes it", async () => {
    render(<PeakWizardPanel />);
    const chip = stepTwo();
    chip.focus();
    await pressEscape(chip);
    expect(useApp.getState().peakWizardEdit).toBeNull();
    expect(useApp.getState().peakWizardOpen).toBe(true);
    await pressEscape(chip);
    expect(useApp.getState().peakWizardOpen).toBe(false);
  });

  it("an open menu owns Escape: it closes and the edit stays live", async () => {
    render(<PeakWizardPanel />);
    const chip = stepTwo();
    chip.focus();
    const closeMenu = vi.fn(() => true);
    const unregister = pushEscapeSurface("menu", closeMenu);
    try {
      await pressEscape(chip);
      expect(closeMenu).toHaveBeenCalledOnce();
      expect(useApp.getState().peakWizardEdit).not.toBeNull();
      expect(useApp.getState().peakWizardOpen).toBe(true);
    } finally {
      unregister();
    }
  });

  it("an Escape aimed at another window closes that window, not the edit", async () => {
    const closeOther = vi.fn();
    render(
      <>
        <PeakWizardPanel />
        <ToolWindow id="other-panel" title="Other" onClose={closeOther}>
          <button type="button">Other control</button>
        </ToolWindow>
      </>,
    );
    stepTwo();
    const other = screen.getByRole("button", { name: "Other control" });
    other.focus();
    await pressEscape(other);
    expect(closeOther).toHaveBeenCalledOnce();
    expect(useApp.getState().peakWizardEdit).not.toBeNull();
  });

  it("from outside every window it pauses only after the surfaces above decline", async () => {
    render(<PeakWizardPanel />);
    stepTwo();
    (document.activeElement as HTMLElement | null)?.blur();
    const closeWorkspace = vi.fn(() => true);
    const unregister = pushEscapeSurface("workspace", closeWorkspace);
    try {
      await pressEscape(document.body);
      expect(closeWorkspace).toHaveBeenCalledOnce();
      expect(useApp.getState().peakWizardEdit).not.toBeNull();
    } finally {
      unregister();
    }
    await pressEscape(document.body); // nothing above it now: the plot-side pause
    expect(useApp.getState().peakWizardEdit).toBeNull();
    expect(useApp.getState().peakWizardOpen).toBe(true);
  });
});
