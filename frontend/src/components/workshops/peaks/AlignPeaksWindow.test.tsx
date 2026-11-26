// Align to peak, end to end through the store: pick datasets, measure through
// /api/peaks/align, and add the shifted copies as derived datasets (X moved, Y
// untouched, originals kept, provenance recorded, ONE undo step, no duplicate).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { alignPeaks } from "../../../lib/api/peaks";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { analysisResultsReset } from "./batchIntegrateTestSetup";
import AlignPeaksWindow from "./AlignPeaksWindow";
import { shiftXData, type AlignProvenance } from "./alignPeaks";

vi.mock("../../../lib/api/peaks", () => ({ alignPeaks: vi.fn() }));

const scan = (offset: number): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5].map((t) => t + offset),
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [
      { id: "d1", name: "a.dat", data: scan(0) },
      { id: "d2", name: "b.dat", data: scan(0.5) },
    ],
    activeId: "d1",
    selectedIds: ["d1", "d2"],
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    ...analysisResultsReset,
  });
  vi.mocked(alignPeaks).mockResolvedValue({
    positions: [3, 3.5], shifts: [0, -0.5], target: 3, ok: [true, true], errors: [null, null],
    method: "parabolic fit to the top three points",
  });
});

const fill = () => {
  fireEvent.change(screen.getByLabelText("peak window low"), { target: { value: "2" } });
  fireEvent.blur(screen.getByLabelText("peak window low"));
  fireEvent.change(screen.getByLabelText("peak window high"), { target: { value: "4" } });
  fireEvent.blur(screen.getByLabelText("peak window high"));
};

describe("AlignPeaksWindow", () => {
  it("refuses to measure until the window is set", () => {
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Measure" })).toBeDisabled();
    expect(screen.getByText(/set the peak window/)).toBeInTheDocument();
  });

  it("measures, tabulates, and adds shifted copies without touching the originals", async () => {
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    const table = await screen.findByRole("region", { name: "alignment results" });
    expect(within(table).getByText("a.dat")).toBeInTheDocument();
    expect(vi.mocked(alignPeaks).mock.calls[0]![0]).toMatchObject({ lo: 2, hi: 4 });
    expect(vi.mocked(alignPeaks).mock.calls[0]![0]).not.toHaveProperty("target");

    const before = useApp.getState().datasets.map((d) => d.data);
    fireEvent.click(screen.getByRole("button", { name: "Add aligned datasets" }));
    const all = useApp.getState().datasets;
    expect(all).toHaveLength(4);
    expect(all.slice(0, 2).map((d) => d.data)).toEqual(before);
    const aligned = all.find((d) => d.name === "b (aligned)")!;
    expect(aligned.data.time).toEqual([0, 1, 2, 3, 4, 5]); // 0.5 - 0.5 ... 5.5 - 0.5
    expect(aligned.data.values).toEqual(before[1]!.values);
    expect(aligned.data.metadata.peakAlign).toMatchObject({ shift: -0.5, target: 3, targetMode: "first" });

    // A repeat adds nothing.
    fireEvent.click(screen.getByRole("button", { name: "Add aligned datasets" }));
    expect(useApp.getState().datasets).toHaveLength(4);
    expect(await screen.findByText(/already in the library/)).toBeInTheDocument();
  });

  it("sends a typed target", async () => {
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    fill();
    fireEvent.change(screen.getByLabelText("align target"), { target: { value: "typed" } });
    fireEvent.change(screen.getByLabelText("target position"), { target: { value: "3.2" } });
    fireEvent.blur(screen.getByLabelText("target position"));
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await screen.findByRole("region", { name: "alignment results" });
    expect(vi.mocked(alignPeaks).mock.calls[0]![0]).toMatchObject({ target: 3.2 });
  });

  it("sends neither follow nor min_snr by default", async () => {
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    fill();
    expect(screen.getByLabelText("minimum peak height")).toHaveValue("6");
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await screen.findByRole("region", { name: "alignment results" });
    const sent = vi.mocked(alignPeaks).mock.calls[0]![0];
    expect(sent).not.toHaveProperty("follow");
    expect(sent).not.toHaveProperty("min_snr");
  });

  it("follow and a changed threshold go to the route; each output records its own window", async () => {
    vi.mocked(alignPeaks).mockResolvedValue({
      positions: [3, 3.5], shifts: [0, -0.5], target: 3, ok: [true, true], errors: [null, null],
      method: "m", windows: [[2, 4], [2.5, 4.5]],
    });
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /Window follows each spectrum/ }));
    fireEvent.change(screen.getByLabelText("minimum peak height"), { target: { value: "3" } });
    fireEvent.blur(screen.getByLabelText("minimum peak height"));
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await screen.findByRole("region", { name: "alignment results" });
    expect(vi.mocked(alignPeaks).mock.calls[0]![0]).toMatchObject({ lo: 2, hi: 4, follow: true, min_snr: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Add aligned datasets" }));
    const aligned = useApp.getState().datasets.find((d) => d.name === "b (aligned)")!;
    expect(aligned.data.metadata.peakAlign).toMatchObject({ window: [2.5, 4.5], follow: true });
  });

  it("refuses a negative threshold", () => {
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    fill();
    fireEvent.change(screen.getByLabelText("minimum peak height"), { target: { value: "-1" } });
    fireEvent.blur(screen.getByLabelText("minimum peak height"));
    expect(screen.getByRole("button", { name: "Measure" })).toBeDisabled();
  });

  it("marks a measurement out of date when the window changes, and blocks adding", async () => {
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await screen.findByRole("region", { name: "alignment results" });
    fireEvent.change(screen.getByLabelText("peak window high"), { target: { value: "4.5" } });
    fireEvent.blur(screen.getByLabelText("peak window high"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add aligned datasets" })).toBeDisabled());
  });

  it("an unmeasurable dataset is a flagged row and gets no output", async () => {
    vi.mocked(alignPeaks).mockResolvedValue({
      positions: [3, null], shifts: [0, null], target: 3, ok: [true, false],
      errors: [null, "the highest point is at the window edge"], method: "m",
    });
    render(<AlignPeaksWindow seedPeaks={[]} onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await screen.findByText("the highest point is at the window edge");
    fireEvent.click(screen.getByRole("button", { name: "Add aligned datasets" }));
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["a.dat", "b.dat", "a (aligned)"]);
  });
});

describe("shiftXData", () => {
  const prov: AlignProvenance = { window: [0, 1], position: 1, shift: 2, target: 3, targetMode: "typed", method: "m", xLabel: "X" };
  it("moves a chosen X column only", () => {
    const src: DataStruct = { time: [0, 1], values: [[10, 1], [20, 2]], labels: ["X", "Y"], units: ["", ""], metadata: {} };
    const out = shiftXData(src, 0, 2, prov);
    expect(out.values).toEqual([[12, 1], [22, 2]]);
    expect(out.time).toEqual([0, 1]);
    expect(src.values[0]).toEqual([10, 1]);
  });
  it("refuses a non-finite shift", () => {
    expect(() => shiftXData(scan(0), null, Number.NaN, prov)).toThrow("finite");
  });
});
