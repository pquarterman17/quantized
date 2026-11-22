// "Open in Peak batch" (lane RO2): the table reopens in the wizard's Batch mode
// with EVERY recorded source picked, its recipe and trend X, fails closed when
// a source is missing/changed or the recipe is gone or edited, and a re-run
// replaces the old table in one undo step.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeakBatchResult } from "../../../lib/api/peakBatch";
import { DEFAULT_RECIPE, type PeakRecipe } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "../peakwizard/modelFit.testkit";
import PeakBatchView from "../peakwizard/PeakBatchView";
import { analysisResultsReset } from "../peaks/batchIntegrateTestSetup";

const { findMock } = vi.hoisted(() => ({ findMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));

const N = 30;
const ds = (id: string, tweak = 0): Dataset => ({
  id, name: `scan ${id}`,
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => [20 + i * 0.2, 1 + Math.exp(-((i - 15) ** 2) / 4) + tweak]),
    labels: ["2theta", "I"], units: ["", ""], metadata: {},
  },
});
const A = ds("a");
const B = ds("b");
const RECIPE: PeakRecipe = { ...DEFAULT_RECIPE, name: "two peaks" };

const fitRow = (id: string) => {
  const { curves: _c, correlation: _r, ...fit } = modelFitResponse();
  return { id, status: "ok" as const, error: null, fit };
};
const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } }));
const result: PeakBatchResult = { rows: [fitRow("i0"), fitRow("i1")], n_items: 2, n_ok: 2, n_failed: 0, n_not_run: 0, stopped: null };

const tables = () => useApp.getState().datasets.filter((d) => d.data.metadata.source === "peak-batch-fit");
const resultId = () => useApp.getState().analysisResults[0]!.id;

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useToolReopen.setState({ sessions: {} });
  findMock.mockResolvedValue({
    peaks: [{ center: 23, height: 1, bg: 0, fwhm: 0.6, prominence: 1, localSNR: 20, area: null }], background: [],
  });
  vi.stubGlobal("fetch", (url: string) => {
    if (url === "/api/peaks/model-fit-batch") return json({ job_id: "j1", n_items: 2 });
    if (url === "/api/jobs/j1/result") return json({ id: "j1", status: "done", result });
    if (url === "/api/jobs/j1") return json({ status: "done", progress: 1, message: "fitted 2/2" });
    return Promise.resolve(new Response("{}", { status: 500 }));
  });
  useApp.setState({
    datasets: [A, B], activeId: "a", xKey: 0, yKeys: [1], seriesOrder: null, errKeys: {}, selectedIds: ["a", "b"],
    peakWizardOpen: false, ...analysisResultsReset,
  });
});
afterEach(() => vi.unstubAllGlobals());

async function runAndAdd(recipes: PeakRecipe[] = [RECIPE]) {
  render(<PeakBatchView recipes={recipes} current="two peaks" pollMs={5} />);
  fireEvent.click(screen.getByRole("button", { name: "Library selection (2)" }));
  fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
  await screen.findByRole("table", { name: "batch results" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Add as table" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Add as table" }));
}

/** Commit a table through the view, then close it. */
async function commitTable(): Promise<void> {
  await runAndAdd();
  expect(tables()).toHaveLength(1);
  document.body.innerHTML = "";
}

describe("Peak batch: reopen, adjust, replace", () => {
  it("opens the wizard's Batch mode seeded with every recorded source and the recipe", async () => {
    await commitTable();
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(true); });
    expect(useApp.getState().peakWizardOpen).toBe(true);
    expect(useApp.getState().activeId).toBe("a");
    expect(useToolReopen.getState().sessions["peak-batch"]!.sourceIds).toEqual(["a", "b"]);
    render(<PeakBatchView recipes={[RECIPE]} current="" pollMs={5} />);
    expect(screen.getByText("Datasets (2 picked)")).toBeInTheDocument();
    expect(screen.getByLabelText("batch recipe")).toHaveValue("two peaks");
    expect(screen.getByRole("radio", { name: /Replace “Peak batch/ })).toBeChecked();
  });

  it("a re-run replaces the old table in ONE undo step; Undo restores it and its result", async () => {
    await commitTable();
    const [old] = tables();
    const oldResult = useApp.getState().analysisResults[0];
    act(() => { openCommittedResultInTool(resultId()); });
    render(<PeakBatchView recipes={[RECIPE]} current="" pollMs={5} />);
    // Edit the result: fit one scan fewer. The primary source is unchanged, so the table can replace the old one.
    fireEvent.click(screen.getByRole("checkbox", { name: "scan b" }));
    fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
    await screen.findByRole("table", { name: "batch results" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add as table" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Add as table" }));
    expect(tables()).toHaveLength(1);
    expect(tables()[0]!.id).toBe(old!.id);
    expect(tables()[0]!.name).toContain("(1 dataset)");
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0]!.id).toBe(oldResult!.id);
    expect(useApp.getState().analysisResults[0]!.sources.map((x) => x.datasetId)).toEqual(["a"]);
    expect(useApp.getState().history.filter((h) => h.label === "replace Peak batch output")).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(tables()[0]!.data).toEqual(old!.data);
    expect(useApp.getState().analysisResults).toEqual([oldResult]);
  });

  it("Add as a new output keeps the old table", async () => {
    await commitTable();
    act(() => { openCommittedResultInTool(resultId()); });
    act(() => useToolReopen.getState().setMode("peak-batch", "new"));
    render(<PeakBatchView recipes={[RECIPE]} current="" pollMs={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
    await screen.findByRole("table", { name: "batch results" });
    // The table of the SAME run was undone away from the Library by a delete: a new output is possible again.
    act(() => useApp.getState().undo());
    fireEvent.click(screen.getByRole("button", { name: "Add as table" }));
    expect(tables()).toHaveLength(1);
  });

  it("a missing source opens WITHOUT the settings, naming the count, and cannot replace", async () => {
    await commitTable();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "b") })));
    act(() => { openCommittedResultInTool(resultId()); });
    const session = useToolReopen.getState().sessions["peak-batch"]!;
    expect(session).toMatchObject({ seed: null, sourceId: null, mode: "new" });
    expect(session.notice).toMatch(/1 of the 2 recorded source worksheets/);
    render(<PeakBatchView recipes={[RECIPE]} current="" pollMs={5} />);
    expect(screen.getByText("Datasets (1 picked)")).toBeInTheDocument(); // the default pick, not the recorded two
  });

  it("a changed further source says which one", async () => {
    await commitTable();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "b" ? ds("b", 5) : d)) })));
    act(() => { openCommittedResultInTool(resultId()); });
    const session = useToolReopen.getState().sessions["peak-batch"]!;
    expect(session.seed).not.toBeNull();
    expect(session.notice).toContain("“scan b” changed after this result was computed");
  });

  it("a recipe that is no longer saved is NOT replaced by another: it says so and blocks Run", async () => {
    await commitTable();
    act(() => { openCommittedResultInTool(resultId()); });
    const other: PeakRecipe = { ...DEFAULT_RECIPE, name: "other" };
    render(<PeakBatchView recipes={[other]} current="other" pollMs={5} />);
    expect(screen.getByRole("alert")).toHaveTextContent("“two peaks” of this table is not saved any more");
    expect(screen.getByLabelText("batch recipe")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Run batch" })).toBeDisabled();
  });

  it("a recipe edited since is flagged, but still selectable", async () => {
    await commitTable();
    act(() => { openCommittedResultInTool(resultId()); });
    const edited: PeakRecipe = { ...RECIPE, name: "two peaks", minProminence: (RECIPE as { minProminence?: number }).minProminence === 7 ? 8 : 7 } as PeakRecipe;
    render(<PeakBatchView recipes={[edited]} current="two peaks" pollMs={5} />);
    expect(screen.getByRole("alert")).toHaveTextContent("changed after this table was computed");
  });

  it("a recipe edited since is flagged only until a run with the current recipe", async () => {
    await commitTable();
    act(() => { openCommittedResultInTool(resultId()); });
    const edited: PeakRecipe = { ...RECIPE, name: "two peaks", minProminence: (RECIPE as { minProminence?: number }).minProminence === 7 ? 8 : 7 } as PeakRecipe;
    render(<PeakBatchView recipes={[edited]} current="two peaks" pollMs={5} />);
    expect(screen.getByRole("alert")).toHaveTextContent("changed after this table was computed");
    fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
    await screen.findByRole("table", { name: "batch results" });
    expect(screen.queryByText(/changed after this table was computed/)).toBeNull();
  });

  // Fail-before (review finding): unpicking the first source made the commit add a
  // NEW table while the banner still offered Replace.
  it("Replace needs the same first source: when it is unpicked the banner says so and the commit adds new", async () => {
    await commitTable();
    act(() => { openCommittedResultInTool(resultId()); });
    render(<PeakBatchView recipes={[RECIPE]} current="" pollMs={5} />);
    expect(screen.getByRole("radio", { name: /Replace “Peak batch/ })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "scan a" }));
    fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
    await screen.findByRole("table", { name: "batch results" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add as table" })).toBeEnabled());
    expect(await screen.findByText(/Replace keeps the first source of the result/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Replace “Peak batch/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Add as a new output" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Add as table" }));
    expect(tables()).toHaveLength(2);
  });
});
