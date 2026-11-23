// Peak analyzer batch: a finished table is dropped when the recipe changes
// (lane BY3) or the plotted channel changes (lane BY4), and kept when only the
// picked datasets change or the batch's own table is added and activated. Same stubbed job API as PeakBatchView.test.tsx.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeakBatchResult } from "../../../lib/api/peakBatch";
import { DEFAULT_RECIPE, type PeakRecipe } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import { analysisResultsReset } from "../peaks/batchIntegrateTestSetup";
import { modelFitResponse } from "./modelFit.testkit";
import PeakBatchView from "./PeakBatchView";

const { findMock } = vi.hoisted(() => ({ findMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));

const N = 30;
const ds = (id: string): Dataset => ({
  id, name: `scan ${id}`,
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => [20 + i * 0.2, 1 + Math.exp(-((i - 15) ** 2) / 4), 3 + Math.exp(-((i - 15) ** 2) / 4)]),
    labels: ["2theta", "I", "J"], units: ["", "", ""], metadata: {},
  },
});
const R1: PeakRecipe = { ...DEFAULT_RECIPE, name: "one" };
const R2: PeakRecipe = { ...DEFAULT_RECIPE, name: "two" };

let release: (() => void) | null = null;
let hold = false;

const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } }));
const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useApp.setState({ resolveDataset: realResolve });
  hold = false;
  release = null;
  const { curves: _c, correlation: _r, ...fit } = modelFitResponse();
  const result: PeakBatchResult = { rows: [{ id: "i0", status: "ok", error: null, fit }], n_items: 1, n_ok: 1, n_failed: 0, n_not_run: 0, stopped: null };
  findMock.mockResolvedValue({
    peaks: [{ center: 23, height: 1, bg: 0, fwhm: 0.6, prominence: 1, localSNR: 20, area: null }],
    background: [],
  });
  vi.stubGlobal("fetch", (url: string) => {
    if (url === "/api/peaks/model-fit-batch") return json({ job_id: "j1", n_items: 1 });
    if (url === "/api/jobs/j1/result") return json({ id: "j1", status: "done", result });
    if (url === "/api/jobs/j1") {
      if (!hold) return json({ status: "done", progress: 1, message: "fitted 1/1" });
      return new Promise((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ status: "done", progress: 1, message: "fitted 1/1" }), { status: 200, headers: { "Content-Type": "application/json" } }));
      });
    }
    return Promise.resolve(new Response("{}", { status: 500 }));
  });
  useApp.setState({ datasets: [ds("a"), ds("b")], activeId: "a", xKey: 0, yKeys: [1], seriesOrder: null, errKeys: {}, selectedIds: ["a", "b"], ...analysisResultsReset });
});
afterEach(() => vi.unstubAllGlobals());

const status = () => screen.getByRole("status", { name: "batch status" });
const start = () => {
  fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
};

describe("Peak analyzer batch reset", () => {
  it("drops it when another recipe is chosen, but keeps it when only the picked datasets change", async () => {
    render(<PeakBatchView recipes={[R1, R2]} current="one" pollMs={5} />);
    start();
    await waitFor(() => expect(status()).toHaveTextContent("done"));
    fireEvent.click(screen.getByRole("button", { name: "Library selection (2)" }));
    expect(screen.getByRole("table", { name: "batch results" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("batch recipe"), { target: { value: "two" } });
    await waitFor(() => expect(screen.queryByRole("table", { name: "batch results" })).toBeNull());
  });

  // Fail-before: the table of channel "I" stayed under a plot of channel "J".
  it("drops it when the plotted channel changes", async () => {
    render(<PeakBatchView recipes={[R1, R2]} current="one" pollMs={5} />);
    start();
    await waitFor(() => expect(status()).toHaveTextContent("done"));
    expect(screen.getByRole("table", { name: "batch results" })).toBeInTheDocument();
    act(() => { useApp.setState({ yKeys: [2] }); });
    await waitFor(() => expect(screen.queryByRole("table", { name: "batch results" })).toBeNull());
    expect(screen.queryByRole("status", { name: "batch status" })).toBeNull();
  });

  // Fail-before: an undo clears xKey / yKeys, the view falls back to the first
  // column ("2theta"), and that default was taken for a channel change.
  it("keeps it when the plot selection is cleared (undo), which only falls back to a default column", async () => {
    render(<PeakBatchView recipes={[R1, R2]} current="one" pollMs={5} />);
    start();
    await waitFor(() => expect(status()).toHaveTextContent("done"));
    act(() => { useApp.setState({ xKey: null, yKeys: null }); });
    expect(screen.getByRole("table", { name: "batch results" })).toBeInTheDocument();
    act(() => { useApp.setState({ xKey: 0, yKeys: [2] }); });
    await waitFor(() => expect(screen.queryByRole("table", { name: "batch results" })).toBeNull());
  });

  it("keeps it when another worksheet with the same columns becomes active", async () => {
    render(<PeakBatchView recipes={[R1, R2]} current="one" pollMs={5} />);
    start();
    await waitFor(() => expect(status()).toHaveTextContent("done"));
    act(() => { useApp.setState({ activeId: "b" }); });
    expect(screen.getByRole("table", { name: "batch results" })).toBeInTheDocument();
  });

  it("keeps it when adding its own table activates the new worksheet", async () => {
    render(<PeakBatchView recipes={[R1, R2]} current="one" pollMs={5} />);
    start();
    await waitFor(() => expect(status()).toHaveTextContent("done"));
    fireEvent.click(screen.getByRole("button", { name: "Add as table" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(useApp.getState().activeId).not.toBe("a");
    expect(screen.getByRole("table", { name: "batch results" })).toBeInTheDocument();
  });

  it("a run in flight lands dropped when the channel changed meanwhile", async () => {
    hold = true;
    render(<PeakBatchView recipes={[R1, R2]} current="one" pollMs={5} />);
    start();
    await waitFor(() => expect(release).not.toBeNull());
    act(() => { useApp.setState({ yKeys: [2] }); });
    act(() => { release!(); });
    await waitFor(() => expect(screen.queryByRole("status", { name: "batch status" })).toBeNull());
    expect(screen.queryByRole("table", { name: "batch results" })).toBeNull();
  });

  it("lets a run in flight finish, then drops its table when the recipe changed meanwhile", async () => {
    hold = true;
    render(<PeakBatchView recipes={[R1, R2]} current="one" pollMs={5} />);
    start();
    await waitFor(() => expect(release).not.toBeNull());
    fireEvent.change(screen.getByLabelText("batch recipe"), { target: { value: "two" } });
    act(() => { release!(); });
    await waitFor(() => expect(screen.queryByRole("status", { name: "batch status" })).toBeNull());
    expect(screen.queryByRole("table", { name: "batch results" })).toBeNull();
    expect(usePendingOps.getState().ops).toEqual([]);
  });
});
