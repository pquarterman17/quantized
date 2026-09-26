// Resample / align workshop — state-hook unit tests for three P2.5 review
// findings not already exercised end-to-end by ResamplePanel.test.tsx:
//  #1 previewOnly: a pending pick's preview is counted on its downsampled
//     preview rows, and the panel is told so.
//  #2 warnings: several targets never echo an identical, key-colliding
//     sentence.
//  #4 withRangeDefaults seeds from the actual TARGET (never the match
//     dataset), using its analysis rows (exclusions pruned).

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResampleRequest, ResampleResult } from "../../../lib/api/resample";
import type { DataStruct } from "../../../lib/types";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useApp } from "../../../store/useApp";
import { useResample } from "./useResample";

vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn() }));
const { resampleDataset } = await import("../../../lib/api/resample");

function fakeBackend(body: ResampleRequest): Promise<ResampleResult> {
  const { time } = body.dataset;
  return Promise.resolve({
    dataset: { time, values: time.map(() => [1]), labels: body.dataset.labels, units: body.dataset.units, metadata: {} },
    warnings: [{ code: "out-of-range", text: "1 of 4 target points lies outside the source x-range" }],
    source_range: [Math.min(...time), Math.max(...time)],
    rows_in: time.length,
    rows_out: time.length,
  });
}

const a: DataStruct = { time: [0, 1, 2, 3], values: [[0], [10], [20], [30]], labels: ["M"], units: ["emu"], metadata: {} };
const b: DataStruct = { time: [0, 2, 4, 6], values: [[5], [6], [7], [8]], labels: ["M"], units: ["emu"], metadata: {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resampleDataset).mockImplementation(fakeBackend);
  useApp.setState({
    datasets: [
      { id: "d1", name: "a.dat", data: a },
      { id: "d2", name: "b.dat", data: b },
    ],
    folders: [],
    activeId: "d1",
    selectedIds: ["d1"],
    macroRecording: true,
    macroSteps: [],
  });
});

describe("useResample — previewOnly (finding #1)", () => {
  it("is false when nothing picked (or matched) is pending", () => {
    useResampleDialog.setState({ seed: ["d1"] });
    const { result } = renderHook(() => useResample());
    expect(result.current.previewOnly).toBe(false);
  });

  it("is true when a picked target is a still-loading book", () => {
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, pending: { kind: "path", bookId: "b1", rows: 9000, cols: 1 } } : d)),
    }));
    useResampleDialog.setState({ seed: ["d1"] });
    const { result } = renderHook(() => useResample());
    expect(result.current.previewOnly).toBe(true);
  });

  it("is true when the MATCH dataset is a still-loading book", () => {
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "d2" ? { ...d, pending: { kind: "path", bookId: "b2", rows: 9000, cols: 1 } } : d)),
    }));
    useResampleDialog.setState({ seed: ["d1"] });
    const { result } = renderHook(() => useResample());
    act(() => result.current.setForm({ mode: "match", matchId: "d2" }));
    expect(result.current.previewOnly).toBe(true);
  });
});

describe("useResample — warnings across several targets (finding #2)", () => {
  it("prefixes each warning by its dataset so identical sentences read distinctly and key uniquely", async () => {
    useResampleDialog.setState({ seed: ["d1", "d2"] });
    const { result } = renderHook(() => useResample());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    await waitFor(() => expect(result.current.warnings).toHaveLength(2));
    const [w1, w2] = result.current.warnings;
    expect(w1.text).not.toBe(w2.text);
    expect(w1.text).toContain("a.dat:");
    expect(w2.text).toContain("b.dat:");
    // The key `TransformWarningList` renders each <li> with (`${code}:${text}`)
    // must now be unique across the two.
    const keys = result.current.warnings.map((w) => `${w.code}:${w.text}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not prefix when there is only one target", async () => {
    useResampleDialog.setState({ seed: ["d1"] });
    const { result } = renderHook(() => useResample());
    await waitFor(() => expect(result.current.warnings).toHaveLength(1));
    expect(result.current.warnings[0].text).not.toContain("a.dat:");
  });
});

describe("useResample — range/step defaults seed from the real target (finding #4)", () => {
  it("seeds from the first actual target's ANALYSIS rows, not from the match dataset (even when picked first)", () => {
    // "d2" is picked first (so picks[0] === "d2") and is ALSO the match
    // dataset once mode is "match" -- its raw x-range [0, 6] must never seed
    // the range defaults. "d1" is the real target; row 3 (x=3, the widest
    // point) is excluded from analysis, so the seed must come from [0, 2].
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, excludedRows: [3] } : d)),
    }));
    useResampleDialog.setState({ seed: ["d2", "d1"] });
    const { result } = renderHook(() => useResample());
    act(() => result.current.setForm({ mode: "match", matchId: "d2" }));
    act(() => result.current.setForm({ mode: "step" }));
    expect(Number(result.current.form.start)).toBe(0);
    expect(Number(result.current.form.stop)).toBe(2);
  });
});
