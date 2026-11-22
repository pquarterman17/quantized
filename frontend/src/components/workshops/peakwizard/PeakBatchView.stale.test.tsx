// Peak analyzer batch, lane WB5: a finished table says "Out of date" once a
// dataset it fitted is edited (rows, data, error / channel roles), and Export
// CSV and Add as table are withheld until the batch is run again. The existing
// recipe reset (PeakBatchView.reset.test) is unchanged; renaming a dataset, or
// picking other datasets / channels, is not an input. Same stubbed job API.

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

vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: vi.fn().mockResolvedValue({
    peaks: [{ center: 23, height: 1, bg: 0, fwhm: 0.6, prominence: 1, localSNR: 20, area: null }],
    background: [],
  }),
}));

const N = 30;
const ds = (id: string): Dataset => ({
  id, name: `scan ${id}`,
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => [20 + i * 0.2, 1 + Math.exp(-((i - 15) ** 2) / 4)]),
    labels: ["2theta", "I"], units: ["", ""], metadata: {},
  },
});
const R1: PeakRecipe = { ...DEFAULT_RECIPE, name: "one" };

let release: (() => void) | null = null;
let hold = false;
const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  hold = false;
  release = null;
  const { curves: _c, correlation: _r, ...fit } = modelFitResponse();
  const result: PeakBatchResult = { rows: [{ id: "i0", status: "ok", error: null, fit }], n_items: 1, n_ok: 1, n_failed: 0, n_not_run: 0, stopped: null };
  vi.stubGlobal("fetch", (url: string) => {
    if (url === "/api/peaks/model-fit-batch") return json({ job_id: "j1", n_items: 1 });
    if (url === "/api/jobs/j1/result") return json({ id: "j1", status: "done", result });
    if (url === "/api/jobs/j1") {
      if (!hold) return json({ status: "done", progress: 1, message: "fitted 1/1" });
      return new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify({ status: "done", progress: 1, message: "fitted 1/1" }), { status: 200, headers: { "Content-Type": "application/json" } })); });
    }
    return Promise.resolve(new Response("{}", { status: 500 }));
  });
  useApp.setState({ datasets: [ds("a")], activeId: "a", xKey: 0, yKeys: [1], seriesOrder: null, errKeys: {}, selectedIds: ["a"], ...analysisResultsReset });
});
afterEach(() => vi.unstubAllGlobals());

const status = () => screen.getByRole("status", { name: "batch status" });
const ran = async () => {
  render(<PeakBatchView recipes={[R1]} current="one" pollMs={5} />);
  fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
  await waitFor(() => expect(status()).toHaveTextContent("done"));
};
const edit = () => act(() => { useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [3] })) })); });

describe("Peak analyzer batch out of date", () => {
  it("characterization: a fresh table offers Export CSV and Add as table, unmarked; a rename is not an input", async () => {
    await ran();
    act(() => { useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, name: "renamed" })) })); });
    expect(screen.queryByText(/Out of date/)).toBeNull();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add as table" })).toBeInTheDocument();
  });

  it("an edit to a fitted dataset marks the table and withholds Export CSV and Add as table", async () => {
    await ran();
    edit();
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add as table" })).toBeNull();
    expect(screen.getByRole("table", { name: "batch results" })).toBeInTheDocument(); // still readable, marked
  });

  it("running again clears the mark", async () => {
    await ran();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
    await waitFor(() => expect(screen.queryByText(/Out of date/)).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add as table" })).toBeInTheDocument());
  });

  it("forced race: a dataset edited while the batch fits leaves the landed table out of date", async () => {
    hold = true;
    render(<PeakBatchView recipes={[R1]} current="one" pollMs={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
    await waitFor(() => expect(release).not.toBeNull());
    edit();
    act(() => { release!(); });
    await waitFor(() => expect(status()).toHaveTextContent("done"));
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add as table" })).toBeNull();
  });
});
