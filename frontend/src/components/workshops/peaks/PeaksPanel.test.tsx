// Panel-level coverage for the UX-R6 "Label peaks" entry point (MY RULING
// 7): the button text names which peak set it will use, and clicking it
// creates one annotation per peak, matching the peak centers. The behavioral
// guts (template rendering, placement, group identity, one undo entry,
// source immutability) are covered at the hook level in usePeaks.test.ts —
// this file only exercises the actual button a user clicks.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks, fitMultiPeak, fitPeak } from "../../../lib/api/peaks";
import { askParams } from "../../overlays/ParamDialog";
import { peakDataFingerprint, peakTableFromFit, withPeakExcluded } from "../../../lib/peakTableFit";
import type { DataStruct } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({
  fetchBookData: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/peaks", () => ({
  findPeaks: vi.fn(),
  fitMultiPeak: vi.fn(),
  fitPeak: vi.fn(),
}));
vi.mock("../../overlays/ParamDialog", () => ({
  askParams: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "x.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    peakOverlay: null,
    annotations: [],
    history: [],
    future: [],
    peaksOpen: true,
  });
  vi.mocked(findPeaks).mockResolvedValue({
    peaks: [
      { center: 1, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 },
      { center: 3, height: 6, fwhm: 0.9, prominence: 1, localSNR: 10, area: null, bg: 0 },
    ],
    background: [],
  });
});

describe("PeaksPanel — Label peaks entry point", () => {
  it("labels which peak set it will use, and disables when there are none", async () => {
    vi.mocked(findPeaks).mockResolvedValue({ peaks: [], background: [] });
    render(<PeaksPanel />);
    await waitFor(() => expect(screen.getByText(/No peaks found/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Label all/ })).not.toBeInTheDocument();
  });

  it("clicking 'Label all N detected peaks…' creates N annotations matching the peak centers", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    render(<PeaksPanel />);

    const btn = await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(btn);

    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(2));
    const xs = useApp.getState().annotations.map((a) => a.x).sort((a, b) => a - b);
    expect(xs).toEqual([1, 3]);
  });

  it("once a fit result exists, the button switches to naming the FITTED set", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue({
      peaks: [
        { center: 1.1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
        { center: 3.1, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
      ],
      bgCoeffs: [1, 0],
      R2: 0.99,
      rmse: 0.02,
      nPeaks: 2,
      model: "Lorentzian",
    });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });

    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("button", { name: "Label all 2 fitted peaks…" });

    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Label all 2 fitted peaks…" }));

    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(2));
    const xs = useApp.getState().annotations.map((a) => a.x).sort((a, b) => a - b);
    expect(xs).toEqual([1.1, 3.1]);
  });
});

// UX-R6 follow-up: per-peak selection (closes the "always labels ALL peaks"
// gap PR #228 documented). Red-first evidence (RULINGS 2/3) — these fail
// against the pre-change PeaksPanel, which renders read-only DataTable rows
// with no click/keyboard selection and always labels the whole set.
describe("PeaksPanel — peak row selection (RULING 1/3)", () => {
  it("a plain click selects exactly one row (aria-selected + Label button reflects the selection)", async () => {
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });

    const table = screen.getByRole("table", { name: /detected peaks/i });
    const rows = within(table).getAllByRole("row").slice(1); // drop header row
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);

    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[1]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: "Label 1 selected detected peak…" })).toBeInTheDocument();
  });

  it("ctrl/cmd-click toggles a row into the multi-selection", async () => {
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    const table = screen.getByRole("table", { name: /detected peaks/i });
    const rows = within(table).getAllByRole("row").slice(1);

    fireEvent.click(rows[0]);
    fireEvent.click(rows[1], { ctrlKey: true });
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Label 2 selected detected peaks…" })).toBeInTheDocument();

    // ctrl-click again removes it
    fireEvent.click(rows[1], { ctrlKey: true });
    expect(rows[1]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: "Label 1 selected detected peak…" })).toBeInTheDocument();
  });

  it("shift-click extends a contiguous range from the last anchor", async () => {
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [
        { center: 1, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 },
        { center: 2, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 },
        { center: 3, height: 6, fwhm: 0.9, prominence: 1, localSNR: 10, area: null, bg: 0 },
      ],
      background: [],
    });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 3 detected peaks…" });
    const table = screen.getByRole("table", { name: /detected peaks/i });
    const rows = within(table).getAllByRole("row").slice(1);

    fireEvent.click(rows[0]);
    fireEvent.click(rows[2], { shiftKey: true });
    expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "true", "true"]);
    expect(screen.getByRole("button", { name: "Label 3 selected detected peaks…" })).toBeInTheDocument();
  });

  it("N1 (red-first): keyboard-only Shift+ArrowDown extends a range across TWO consecutive presses", async () => {
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [
        { center: 1, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 },
        { center: 2, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 },
        { center: 3, height: 6, fwhm: 0.9, prominence: 1, localSNR: 10, area: null, bg: 0 },
      ],
      background: [],
    });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 3 detected peaks…" });
    const table = screen.getByRole("table", { name: /detected peaks/i });
    const rows = within(table).getAllByRole("row").slice(1);

    // NO plain click first — a keyboard-only user who tabs in and starts
    // extending immediately must still get a growing range, not just
    // whatever single row the roving focus currently sits on.
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    // The roving stop has moved to rows[1] — the second press must fire
    // from THERE (real keyboard use: the browser's focus IS on rows[1] now).
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown", shiftKey: true });

    expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "true", "true"]);
    expect(screen.getByRole("button", { name: "Label 3 selected detected peaks…" })).toBeInTheDocument();
  });

  it("a keyboard Enter on a focused row selects it (keyboard reachable)", async () => {
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    const table = screen.getByRole("table", { name: /detected peaks/i });
    const rows = within(table).getAllByRole("row").slice(1);

    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "Enter" });
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Label 1 selected detected peak…" })).toBeInTheDocument();
  });

  it("clicking Label with a selection labels ONLY the selected peaks", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    const table = screen.getByRole("table", { name: /detected peaks/i });
    const rows = within(table).getAllByRole("row").slice(1);
    fireEvent.click(rows[1]); // select only the second peak (center=3)

    fireEvent.click(screen.getByRole("button", { name: "Label 1 selected detected peak…" }));

    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(1));
    expect(useApp.getState().annotations[0].x).toBe(3);
  });

  it("clicking Label with NO selection still labels ALL peaks (default unchanged)", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    render(<PeaksPanel />);
    const btn = await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(btn);

    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(2));
  });

  it("RULING 2: a fresh fit run resets the selection so stale indices can't mislabel", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue({
      peaks: [
        { center: 1.1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
        { center: 3.1, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
      ],
      bgCoeffs: [1, 0],
      R2: 0.99,
      rmse: 0.02,
      nPeaks: 2,
      model: "Lorentzian",
    });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    const detectedTable = screen.getByRole("table", { name: /detected peaks/i });
    const detectedRows = within(detectedTable).getAllByRole("row").slice(1);
    fireEvent.click(detectedRows[0]); // select 1 detected peak

    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("table", { name: /fitted peaks/i });

    // The FITTED table must come up with nothing selected (RULING 2) — the
    // Label button must still read "all", never "selected".
    expect(screen.getByRole("button", { name: "Label all 2 fitted peaks…" })).toBeInTheDocument();
  });

  it("RULING 2: a fresh detection run (dataset switch) resets the selection", async () => {
    const DATA2: DataStruct = {
      time: [0, 1, 2],
      values: [[1], [2], [1]],
      labels: ["I"],
      units: ["cps"],
      metadata: {},
    };
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    const table = screen.getByRole("table", { name: /detected peaks/i });
    const rows = within(table).getAllByRole("row").slice(1);
    fireEvent.click(rows[0]);
    expect(screen.getByRole("button", { name: "Label 1 selected detected peak…" })).toBeInTheDocument();

    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [{ center: 5, height: 9, fwhm: 0.5, prominence: 1, localSNR: 10, area: null, bg: 0 }],
      background: [],
    });
    useApp.setState({
      datasets: [
        { id: "d1", name: "x.dat", data: DATA },
        { id: "d2", name: "y.dat", data: DATA2 },
      ],
      activeId: "d2",
    });

    await screen.findByRole("button", { name: "Label all 1 detected peak…" });
    // A stale index-0 selection must NOT survive onto the new (unrelated) peak.
    expect(screen.queryByText(/selected detected/)).not.toBeInTheDocument();
  });

  it("K1 direction 1 (red-first): once a fit exists, the DETECTED table's stale selection is cleared AND the table stops presenting as selectable", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue({
      peaks: [
        { center: 1.1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
        { center: 3.1, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
      ],
      bgCoeffs: [1, 0],
      R2: 0.99,
      rmse: 0.02,
      nPeaks: 2,
      model: "Lorentzian",
    });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    const detectedTable = screen.getByRole("table", { name: /detected peaks/i });
    const detectedRows = within(detectedTable).getAllByRole("row").slice(1);
    fireEvent.click(detectedRows[0]);
    expect(screen.getByRole("button", { name: "Label 1 selected detected peak…" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("table", { name: /fitted peaks/i });

    // The stale selection must be gone — no attribute at all (RULING: "no
    // aria-selected"), not merely "false".
    const detectedRowsAfter = within(screen.getByRole("table", { name: /detected peaks/i })).getAllByRole("row").slice(1);
    expect(detectedRowsAfter[0]).not.toHaveAttribute("aria-selected");

    // Clicking the (now non-governing) detected table must be a total no-op —
    // it must never present a highlighted row the Label action then ignores.
    fireEvent.click(detectedRowsAfter[1]);
    expect(detectedRowsAfter[1]).not.toHaveAttribute("aria-selected");
    expect(screen.getByRole("button", { name: "Label all 2 fitted peaks…" })).toBeInTheDocument();

    // Label must act on the FITTED centers, uninfluenced by the ignored detected clicks.
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Label all 2 fitted peaks…" }));
    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(2));
    expect(useApp.getState().annotations.map((a) => a.x).sort((a, b) => a - b)).toEqual([1.1, 3.1]);
  });

  it("K1 direction 2 (red-first, mirror case): a detected selection made before a fit does NOT resurrect once the fit yields zero peaks", async () => {
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    const table = screen.getByRole("table", { name: /detected peaks/i });
    const rows = within(table).getAllByRole("row").slice(1);
    fireEvent.click(rows[0]); // select detected peak 0 BEFORE any fit exists
    expect(screen.getByRole("button", { name: "Label 1 selected detected peak…" })).toBeInTheDocument();

    // A successful fit takes governance away from the detected table.
    vi.mocked(fitMultiPeak).mockResolvedValue({
      peaks: [
        { center: 1.1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
        { center: 3.1, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
      ],
      bgCoeffs: [1, 0],
      R2: 0.99,
      rmse: 0.02,
      nPeaks: 2,
      model: "Lorentzian",
    });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("button", { name: "Label all 2 fitted peaks…" });

    // Now a SEPARATE fit run (fitEach) fails on every peak — fitResult.peaks
    // becomes an empty array, hasFit flips back to false, and the DETECTED
    // table regains governance.
    vi.mocked(fitPeak).mockResolvedValue({
      success: false,
      reason: "window-too-narrow",
      center: 0,
      fwhm: 0,
      height: 0,
      bg: 0,
      eta: null,
      area: 0,
      params: [],
      model: "Lorentzian",
      window: [0, 0],
    });
    fireEvent.click(screen.getByRole("button", { name: "Fit each" }));

    // The pre-fit detected selection must NOT resurrect — "all", not "1 selected".
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    expect(screen.queryByText(/selected detected/)).not.toBeInTheDocument();
  });

  it("the FITTED table stays selectable while it governs", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue({
      peaks: [
        { center: 1.1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
        { center: 3.1, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
      ],
      bgCoeffs: [1, 0],
      R2: 0.99,
      rmse: 0.02,
      nPeaks: 2,
      model: "Lorentzian",
    });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    const fittedTable = await screen.findByRole("table", { name: /fitted peaks/i });
    const fittedRows = within(fittedTable).getAllByRole("row").slice(1);

    fireEvent.click(fittedRows[0]);
    expect(fittedRows[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Label 1 selected fitted peak…" })).toBeInTheDocument();
  });
});

describe("PeaksPanel — manual durable fitted-peak edits", () => {
  const FIT = {
    peaks: [
      { center: 1.1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
      { center: 3.1, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
    ],
    bgCoeffs: [1, 0], R2: 0.99, rmse: 0.02, nPeaks: 2, model: "Lorentzian",
  };

  it("edits the selected fitted row and the durable table updates immediately", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    vi.mocked(askParams).mockResolvedValue({ center: 1.25, fwhm: 0.75, height: 5.5, area: 4.4 });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    const fitted = await screen.findByRole("table", { name: "fitted peaks" });
    fireEvent.click(within(fitted).getAllByRole("row")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Edit selected…" }));

    await waitFor(() =>
      expect(useApp.getState().datasets[0].peakTable?.peaks[0]).toEqual(
        expect.objectContaining({ center: 1.25, fwhm: 0.75, height: 5.5, area: 4.4, status: "manual-edit" }),
      ),
    );
    expect(within(screen.getByRole("table", { name: "fitted peaks" })).getByText("1.25")).toBeInTheDocument();
    expect(useApp.getState().datasets[0].peakTable?.provenance.R2).toBeNull();
    // A simultaneous fit whose metrics were cleared by a hand edit is not an
    // "independent fits" result, and the edited row is declared as such.
    expect(screen.getByText(/fit metrics cleared by manual changes/)).toBeInTheDocument();
    expect(screen.getByText(/1 edited by hand/)).toBeInTheDocument();
    expect(screen.queryByText(/independent fits/)).toBeNull();
  });

  it("refuses a zero-width edit without touching the durable table", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    vi.mocked(askParams).mockResolvedValue({ center: 1.25, fwhm: 0, height: 5.5, area: 4.4 });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    const fitted = await screen.findByRole("table", { name: "fitted peaks" });
    const before = useApp.getState().datasets[0].peakTable;
    fireEvent.click(within(fitted).getAllByRole("row")[1]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit selected…" }));
      await new Promise((r) => setTimeout(r, 0)); // let the dialog promise settle
    });
    expect(useApp.getState().datasets[0].peakTable).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("keeps the fitted-row selection when a peak is excluded", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    const fitted = await screen.findByRole("table", { name: "fitted peaks" });
    fireEvent.click(within(fitted).getAllByRole("row")[1]);
    expect(screen.getByRole("button", { name: "Edit selected…" })).toBeEnabled();
    fireEvent.click(within(fitted).getAllByRole("checkbox")[1]);
    await waitFor(() => expect(useApp.getState().datasets[0].peakTable?.peaks[1].excluded).toBe(true));
    expect(screen.getByRole("button", { name: "Edit selected…" })).toBeEnabled();
  });

  it("removes selected fitted rows without deleting or modifying the source dataset", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    const fitted = await screen.findByRole("table", { name: "fitted peaks" });
    fireEvent.click(within(fitted).getAllByRole("row")[2]);
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

    await waitFor(() => expect(useApp.getState().datasets[0].peakTable?.peaks).toHaveLength(1));
    expect(useApp.getState().datasets[0].data).toEqual(DATA);
    expect(within(screen.getByRole("table", { name: "fitted peaks" })).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText(/fit metrics cleared by manual changes/)).toBeInTheDocument();
  });
});

describe("PeaksPanel — durable table exclusion column (P2.1)", () => {
  const FIT = {
    peaks: [
      { center: 1.1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
      { center: 3.1, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
    ],
    bgCoeffs: [1, 0],
    R2: 0.99,
    rmse: 0.02,
    nPeaks: 2,
    model: "Lorentzian",
  };

  it("every fitted peak starts included, and unticking one excludes it in the durable table", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("button", { name: "Label all 2 fitted peaks…" });

    const box1 = screen.getByRole("checkbox", { name: "include peak 1" });
    const box2 = screen.getByRole("checkbox", { name: "include peak 2" });
    expect(box1).toBeChecked();
    expect(box2).toBeChecked();

    fireEvent.click(box2);
    await waitFor(() =>
      expect(useApp.getState().datasets[0].peakTable?.peaks.map((p) => p.excluded)).toEqual([
        false,
        true,
      ]),
    );
    expect(screen.getByRole("checkbox", { name: "include peak 2" })).not.toBeChecked();
    expect(screen.getByText(/1 excluded/)).toBeInTheDocument();
  });

  it("ticking it back re-includes the peak", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("button", { name: "Label all 2 fitted peaks…" });

    fireEvent.click(screen.getByRole("checkbox", { name: "include peak 1" }));
    await waitFor(() =>
      expect(useApp.getState().datasets[0].peakTable?.peaks[0].excluded).toBe(true),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "include peak 1" }));
    await waitFor(() =>
      expect(useApp.getState().datasets[0].peakTable?.peaks[0].excluded).toBe(false),
    );
    expect(screen.queryByText(/excluded/)).not.toBeInTheDocument();
  });

  it("ticking the box does not also move the row selection", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("button", { name: "Label all 2 fitted peaks…" });

    fireEvent.click(screen.getByRole("checkbox", { name: "include peak 1" }));
    await waitFor(() =>
      expect(useApp.getState().datasets[0].peakTable?.peaks[0].excluded).toBe(true),
    );
    // The button text names the SELECTED count once a row is selected; the
    // checkbox must leave it at "all".
    expect(screen.getByRole("button", { name: "Label all 2 fitted peaks…" })).toBeInTheDocument();
  });

  it("Space on a focused checkbox toggles it and does NOT move the row selection", async () => {
    // The row is a selection target whose own onKeyDown calls preventDefault()
    // on " " and selects, so before this fix Space cancelled the browser's own
    // checkbox activation AND moved the selection: the box was a Tab stop that
    // did nothing except the one thing the mouse path is careful to prevent.
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("button", { name: "Label all 2 fitted peaks…" });

    const box2 = screen.getByRole("checkbox", { name: "include peak 2" });
    box2.focus();
    // Not cancelled: the native activation (and therefore onChange) survives.
    expect(fireEvent.keyDown(box2, { key: " " })).toBe(true);
    fireEvent.click(box2); // jsdom does not synthesize the native activation

    await waitFor(() =>
      expect(useApp.getState().datasets[0].peakTable?.peaks.map((p) => p.excluded)).toEqual([
        false,
        true,
      ]),
    );
    // "Label all …" means no row got selected; a selection renames the button.
    expect(screen.getByRole("button", { name: "Label all 2 fitted peaks…" })).toBeInTheDocument();
  });

  it("Enter on a focused checkbox likewise leaves the row selection alone", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("button", { name: "Label all 2 fitted peaks…" });

    const box1 = screen.getByRole("checkbox", { name: "include peak 1" });
    box1.focus();
    expect(fireEvent.keyDown(box1, { key: "Enter" })).toBe(true);
    expect(screen.getByRole("button", { name: "Label all 2 fitted peaks…" })).toBeInTheDocument();
    expect(useApp.getState().datasets[0].peakTable?.peaks[0].excluded).toBe(false);
  });

  it("a row keypress still selects — the checkbox stopper must not disarm the table", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("button", { name: "Label all 2 fitted peaks…" });

    const rows = within(screen.getByRole("table", { name: "fitted peaks" })).getAllByRole("row");
    fireEvent.keyDown(rows[1], { key: " " });
    expect(
      screen.getByRole("button", { name: "Label 1 selected fitted peak…" }),
    ).toBeInTheDocument();
  });

  it("renders no checkbox rather than a MISPAIRED one when the table isn't this fit's", async () => {
    // `peakTable` is a reactive store read, `fitResult` is local state set in
    // usePeaks' effect, so on a dataset switch the paint before that effect has
    // B's table beside A's rows. Positional `peakTable.peaks[i]` then gave row i
    // the wrong durable id and `excluded` flag — a click in that frame would
    // have excluded a peak in a different dataset's table.
    vi.mocked(fitMultiPeak).mockResolvedValue(FIT);
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    fireEvent.click(screen.getByRole("button", { name: /Fit all/ }));
    await screen.findByRole("checkbox", { name: "include peak 1" });

    const mine = useApp.getState().datasets[0].peakTable!;
    act(() => {
      useApp.setState({
        datasets: [
          {
            ...useApp.getState().datasets[0],
            // A table from another dataset: same rows, different owner.
            peakTable: { ...mine, provenance: { ...mine.provenance, datasetId: "d2" } },
          },
        ],
      });
    });

    expect(screen.getByRole("table", { name: "fitted peaks" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "include peak 1" })).not.toBeInTheDocument();
  });

  it("does NOT re-present a saved fit once the data it was measured from changed", async () => {
    // The review's sharpest finding: this panel rehydrates the durable table
    // on every dataset/data change, so a cell edit used to re-show the
    // PRE-EDIT fit over the post-edit data.
    const saved = peakTableFromFit(FIT, {
      datasetId: "d1",
      datasetName: "x.dat",
      method: "simultaneous",
      bgDegree: 1,
      linkMode: "None",
      constrain: false,
      wavelengthA: null,
      fingerprint: peakDataFingerprint({
        id: "d1",
        name: "x.dat",
        data: { ...DATA, values: [[1], [5], [2], [6], [2], [99]] },
      }),
    });
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: DATA, peakTable: saved }],
      activeId: "d1",
    });
    render(<PeaksPanel />);
    await screen.findByRole("button", { name: "Label all 2 detected peaks…" });
    expect(screen.queryByRole("table", { name: "fitted peaks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "include peak 1" })).not.toBeInTheDocument();
  });

  it("shows a reopened project's saved table, checkboxes and all, with no fit", async () => {
    const saved = peakTableFromFit(FIT, {
      datasetId: "d1",
      datasetName: "x.dat",
      method: "simultaneous",
      bgDegree: 1,
      linkMode: "None",
      constrain: false,
      wavelengthA: null,
    });
    useApp.setState({
      datasets: [
        { id: "d1", name: "x.dat", data: DATA, peakTable: withPeakExcluded(saved, saved.peaks[0].id, true) },
      ],
      activeId: "d1",
    });
    render(<PeaksPanel />);
    await screen.findByRole("checkbox", { name: "include peak 1" });
    expect(screen.getByRole("checkbox", { name: "include peak 1" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "include peak 2" })).toBeChecked();
    expect(fitMultiPeak).not.toHaveBeenCalled();
  });
});
