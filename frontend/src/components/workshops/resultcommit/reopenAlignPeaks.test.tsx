// "Open in Align to peak": an aligned output reopens the dialog on its recorded
// source with the recorded peak window and target, plots the recorded channel,
// replaces the old output in place (one undo step) or adds a new one, and fails
// closed on a missing source or a record that does not read back.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { planReopen } from "../../../lib/committedOutputReopen";
import { alignPeaks } from "../../../lib/api/peaks";
import type { DataStruct } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { analysisResultsReset } from "../peaks/batchIntegrateTestSetup";
import AlignPeaksWindow from "../peaks/AlignPeaksWindow";

vi.mock("../../../lib/api/peaks", () => ({ alignPeaks: vi.fn() }));

const scan = (offset: number): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5].map((t) => t + offset),
  values: [[1, 9], [5, 9], [2, 9], [6, 9], [2, 9], [1, 9]],
  labels: ["I", "J"], units: ["cps", "cps"], metadata: {},
});
const outputs = () => useApp.getState().datasets.filter((d) => d.data.metadata.peakAlign !== undefined);
const resultFor = (sourceId: string) => useApp.getState().analysisResults.find((r) => r.sources[0]?.datasetId === sourceId)!;
const reply = (shifts: number[], target = 3) => ({
  positions: shifts.map((s) => 3 - s), shifts, target, ok: shifts.map(() => true), errors: shifts.map(() => null), method: "m",
});

beforeEach(() => {
  vi.clearAllMocks();
  useToolReopen.setState({ sessions: {} });
  useApp.setState({
    datasets: [{ id: "d1", name: "a.dat", data: scan(0) }, { id: "d2", name: "b.dat", data: scan(0.5) }],
    activeId: "d1", selectedIds: ["d1", "d2"], xKey: null, yKeys: [0], seriesOrder: null, peaksOpen: false,
    ...analysisResultsReset,
  });
  vi.mocked(alignPeaks).mockResolvedValue(reply([0, -0.5]));
});

/** Align both spectra on the window 2..4 through the dialog, then close it. */
async function alignBoth(): Promise<void> {
  const view = render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
  for (const [label, v] of [["peak window low", "2"], ["peak window high", "4"]] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
    fireEvent.blur(screen.getByLabelText(label));
  }
  fireEvent.click(screen.getByRole("button", { name: "Measure" }));
  await screen.findByRole("region", { name: "alignment results" });
  fireEvent.click(screen.getByRole("button", { name: "Add aligned datasets" }));
  expect(outputs()).toHaveLength(2);
  view.unmount();
}

describe("Align to peak: reopen, adjust, replace", () => {
  it("records the alignment parameters as provenance and the plotted channels for a reopen", async () => {
    await alignBoth();
    const r = resultFor("d2");
    expect(r.producer).toMatchObject({ id: "peak-align", version: 2 });
    expect(outputs().find((d) => d.name === "b (aligned)")!.data.metadata.peakAlign).toMatchObject({ window: [2, 4], shift: -0.5, target: 3 });
    const plan = planReopen(r, useApp.getState().datasets);
    expect(plan.ok && plan.seed).toMatchObject({ window: [2, 4], target: 3, shift: -0.5 });
    expect(plan.ok && plan.extra).toMatchObject({ channels: { yLabel: "I", yIndex: 0 } });
  });

  it("reopens on the recorded source with the recorded window and target typed, ready to replace", async () => {
    await alignBoth();
    act(() => useApp.setState({ yKeys: [1] })); // another channel is plotted
    act(() => { expect(openCommittedResultInTool(resultFor("d2").id)).toBe(true); });
    expect(useApp.getState().peaksOpen).toBe(true);
    expect(useApp.getState().activeId).toBe("d2");
    expect(useApp.getState().yKeys).toEqual([0]); // the recorded channel is plotted again
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    expect(screen.getByText("Datasets (1 picked)")).toBeInTheDocument();
    expect(screen.getByLabelText("peak window low")).toHaveValue("2");
    expect(screen.getByLabelText("peak window high")).toHaveValue("4");
    expect(screen.getByLabelText("align target")).toHaveValue("typed");
    expect(screen.getByLabelText("target position")).toHaveValue("3");
    expect(screen.getByRole("radio", { name: /Replace “b \(aligned\)/ })).toBeChecked();
  });

  it("a re-run replaces the old output in place, in one undo step; the target is the recorded position", async () => {
    await alignBoth();
    const old = outputs().find((d) => d.name === "b (aligned)")!;
    const oldResult = resultFor("d2");
    act(() => { openCommittedResultInTool(oldResult.id); });
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    vi.mocked(alignPeaks).mockResolvedValue(reply([-0.4]));
    fireEvent.change(screen.getByLabelText("peak window high"), { target: { value: "4.5" } });
    fireEvent.blur(screen.getByLabelText("peak window high"));
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await screen.findByRole("region", { name: "alignment results" });
    expect(vi.mocked(alignPeaks).mock.calls.at(-1)![0]).toMatchObject({ lo: 2, hi: 4.5, target: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Add aligned datasets" }));
    expect(outputs()).toHaveLength(2); // nothing added
    const now = outputs().find((d) => d.id === old.id)!;
    expect(now.data.time[0]).toBeCloseTo(0.1, 12); // 0.5 - 0.4
    expect(now.data.metadata.peakAlign).toMatchObject({ window: [2, 4.5], shift: -0.4 });
    expect(resultFor("d2").id).toBe(oldResult.id);
    expect(await screen.findByText(/replaced 1 aligned dataset in place/)).toBeInTheDocument();
    act(() => useApp.getState().undo());
    expect(outputs().find((d) => d.id === old.id)!.data).toEqual(old.data);
    expect(resultFor("d2")).toEqual(oldResult);
  });

  it("Add as a new output keeps the old one", async () => {
    await alignBoth();
    act(() => { openCommittedResultInTool(resultFor("d2").id); });
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Add as a new output" }));
    vi.mocked(alignPeaks).mockResolvedValue(reply([-0.4]));
    fireEvent.change(screen.getByLabelText("peak window high"), { target: { value: "4.5" } });
    fireEvent.blur(screen.getByLabelText("peak window high"));
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await screen.findByRole("region", { name: "alignment results" });
    fireEvent.click(screen.getByRole("button", { name: "Add aligned datasets" }));
    expect(outputs()).toHaveLength(3);
  });

  it("fails closed: a deleted source reopens without settings; an unreadable record is not guessed", async () => {
    await alignBoth();
    const result = resultFor("d2");
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "d2") }));
    const plan = planReopen(result, useApp.getState().datasets);
    expect(plan.ok && plan.seed).toBeNull();
    expect(plan.ok && plan.notice).toMatch(/no longer exists/);
    // A record whose window does not read back: the dialog opens on the source, says so, and Replace is off.
    useApp.setState((s) => ({
      datasets: [...s.datasets, { id: "d2", name: "b.dat", data: scan(0.5) }],
      analysisResults: s.analysisResults.map((r) => r.id === result.id
        ? { ...r, parameters: { ...r.parameters, settings: { ...(r.parameters!["settings"] as object), window: "bad" } } } : r),
    }));
    act(() => { openCommittedResultInTool(result.id); });
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    expect(screen.getByRole("radio", { name: "Add as a new output" })).toBeChecked();
    expect(screen.getByText(/could not be restored/)).toBeInTheDocument();
  });

  it("an output saved before channels were recorded (version 1) does not reopen", async () => {
    await alignBoth();
    const old = { ...resultFor("d2"), producer: { id: "peak-align", label: "Align to peak", version: 1 } };
    const plan = planReopen(old, useApp.getState().datasets);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toMatch(/before its settings were recorded/);
  });
});
