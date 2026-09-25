// Peak Analyzer "Batch" mode end to end over a stubbed backend (audit P2.4
// slice 4): prepare → one job → poll → table; progress n/N; per-dataset
// failure isolation; cancel mid-fit through the job API; a failed job; the
// table's null-stderr reasons and SSR/χ² labels; CSV; "Add as table" with
// provenance; and the panel's mode switch keeping a batch alive. Every wait
// is on rendered STATE, never on a mock having been called.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeakBatchResult } from "../../../lib/api/peakBatch";
import { DEFAULT_RECIPE, type PeakRecipe } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import PeakBatchView from "./PeakBatchView";
import PeakWizardPanel from "./PeakWizardPanel";

const { findMock, saveMock } = vi.hoisted(() => ({ findMock: vi.fn(), saveMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));
vi.mock("../../../lib/download", () => ({ saveBlob: saveMock }));

const N = 30;
const ds = (id: string, labels: string[]): Dataset => ({
  id, name: `scan ${id}`,
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => labels.map((_, c) => (c === 0 ? 20 + i * 0.2 : 1 + Math.exp(-((i - 15) ** 2) / 4)))),
    labels, units: labels.map(() => ""), metadata: {},
  },
});
const A = ds("a", ["2theta", "I"]);
const B = ds("b", ["2theta", "Counts"]); // no "I": a prepare-stage error row
const C = ds("c", ["2theta", "I"]);
const RECIPE: PeakRecipe = { ...DEFAULT_RECIPE, name: "two peaks" };

function fitRow(id: string) {
  const { curves: _c, correlation: _r, ...fit } = modelFitResponse();
  return { id, status: "ok" as const, error: null, fit };
}

// A tiny fake of the job API: snapshots are served from `script`, the last
// one repeating; a cancel flips the job to "cancelled" on the next poll.
let posted: { items: { id: string }[] }[] = [];
let script: { status: string; progress: number; message: string; error?: string }[] = [];
let cancelled = false;
let result: PeakBatchResult;

function json(v: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  posted = [];
  cancelled = false;
  script = [{ status: "running", progress: 0.5, message: "fitting 1/2" }, { status: "done", progress: 1, message: "fitted 2/2" }];
  result = { rows: [fitRow("i0"), fitRow("i2")], n_items: 2, n_ok: 2, n_failed: 0, n_not_run: 0, stopped: null };
  findMock.mockResolvedValue({
    peaks: [
      { center: 23, height: 1, bg: 0, fwhm: 0.6, prominence: 1, localSNR: 20, area: null },
      { center: 24, height: 0.5, bg: 0, fwhm: 0.6, prominence: 0.5, localSNR: 10, area: null },
    ],
    background: [],
  });
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/peaks/model-fit-batch") {
      posted.push(JSON.parse(init!.body as string) as { items: { id: string }[] });
      return json({ job_id: "j1", n_items: 2 });
    }
    if (url === "/api/jobs/j1/cancel") {
      cancelled = true;
      return json({ status: "running", progress: 0.5, message: "fitting 1/2" });
    }
    if (url === "/api/jobs/j1/result") return json({ id: "j1", status: "done", result });
    if (url === "/api/jobs/j1") {
      if (cancelled) return json({ status: "cancelled", progress: 0.5, message: "fitting 1/2" });
      return json(script.length > 1 ? script.shift() : script[0]);
    }
    return json({ detail: `unexpected ${url}` }, 500);
  });
  useApp.setState({ datasets: [A, B, C], activeId: "a", xKey: 0, yKeys: [1], seriesOrder: null, selectedIds: ["a", "b", "c"] });
});
afterEach(() => vi.unstubAllGlobals());

const status = () => screen.getByRole("status", { name: "batch status" });

async function runAll(recipes: PeakRecipe[] = [RECIPE]) {
  render(<PeakBatchView recipes={recipes} current="two peaks" pollMs={5} />);
  fireEvent.click(screen.getByRole("button", { name: "Library selection (3)" }));
  fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
}

describe("PeakBatchView", () => {
  it("runs the recipe over every picked dataset and isolates the one that cannot be prepared", async () => {
    await runAll();
    await waitFor(() => expect(status()).toHaveTextContent("done · fitted 2/3 datasets"));
    expect(screen.getByLabelText("batch progress")).toHaveTextContent("2/2");
    // One job with the two prepared datasets; B never reached the server.
    expect(posted).toHaveLength(1);
    expect(posted[0].items.map((i) => i.id)).toEqual(["i0", "i2"]);
    const table = screen.getByRole("table", { name: "batch results" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["converged", "converged", "error", "converged", "converged"]);
    expect(rows[2]).toHaveTextContent('no column named "I"');
  });

  it("labels the objective honestly and explains every missing error", async () => {
    await runAll();
    const table = await screen.findByRole("table", { name: "batch results" });
    const objectives = [...table.querySelectorAll("[data-objective]")].map((e) => e.getAttribute("data-objective"));
    expect(new Set(objectives)).toEqual(new Set(["SSR", "red. SSR"]));
    expect(table.textContent).not.toContain("χ²");
    const dashes = [...table.querySelectorAll("[data-no-error]")];
    expect(dashes.length).toBeGreaterThan(0);
    for (const d of dashes) expect(d.getAttribute("title")).toMatch(/fixed|bound|tied|undetermined|converg/);
  });

  it("labels a weighted fit's objective χ²", async () => {
    const { curves: _c, correlation: _r, ...fit } = modelFitResponse({
      weighted: true, metrics: { objective: "chi2", chi2: 9.5, reduced_chi2: 1.1 },
    });
    result = { ...result, rows: [{ id: "i0", status: "ok", error: null, fit }, fitRow("i2")] };
    await runAll();
    const table = await screen.findByRole("table", { name: "batch results" });
    const labels = [...table.querySelectorAll("[data-objective]")].map((e) => `${e.getAttribute("data-objective")}=${e.textContent}`);
    expect(labels.slice(0, 2)).toEqual(["χ²=χ² 9.5", "red. χ²=red. χ² 1.1"]);
    expect(labels.slice(-2)).toEqual(["SSR=SSR 0.012", "red. SSR=red. SSR 0.012"]);
  });

  it("sorts by a column (missing values last)", async () => {
    await runAll();
    const table = await screen.findByRole("table", { name: "batch results" });
    fireEvent.click(within(table).getByRole("button", { name: "Center" }));
    fireEvent.click(within(table).getByRole("button", { name: /Center/ }));
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["converged", "converged", "converged", "converged", "error"]);
    expect(rows[0]).toHaveTextContent("scan a");
    expect(rows[0].querySelectorAll("td")[4]).toHaveTextContent(/^4/);
  });

  it("cancel mid-fit goes through the job API and ends as cancelled with no table", async () => {
    script = [{ status: "running", progress: 0.5, message: "fitting 1/2" }];
    await runAll();
    await waitFor(() => expect(status()).toHaveTextContent("fitting · fitting 1/2"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(status()).toHaveTextContent("cancelled · cancelled — no results were kept"));
    expect(cancelled).toBe(true);
    expect(screen.queryByRole("table", { name: "batch results" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run batch" })).toBeEnabled();
  });

  it("a failed job shows the backend's error", async () => {
    script = [{ status: "error", progress: 0.1, message: "", error: "job queue full (32 pending >= 32)" }];
    await runAll();
    await waitFor(() => expect(status()).toHaveTextContent("failed"));
    expect(screen.getByText("job queue full (32 pending >= 32)")).toBeInTheDocument();
  });

  it("exports the table as CSV", async () => {
    await runAll();
    await screen.findByRole("table", { name: "batch results" });
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const [blob, name] = saveMock.mock.calls[0] as [Blob, string];
    expect(name).toBe("peak-batch-two_peaks.csv");
    const lines = (await blob.text()).split("\n");
    expect(lines[0]).toMatch(/^dataset,peak,shape,status,error,center,center_stderr/);
    expect(lines).toHaveLength(6);
    expect(lines[3]).toContain('scan b,,,error,"no column named ""I"""');
  });

  it("adds the table to the library with the recipe and sources as provenance", async () => {
    await runAll();
    await screen.findByRole("table", { name: "batch results" });
    fireEvent.click(screen.getByRole("button", { name: "Add as table" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    const added = useApp.getState().datasets[3];
    expect(added.name).toBe("Peak batch — two peaks (3 datasets)");
    const prov = added.data.metadata.peakBatch as { recipeName: string; sources: { name: string }[]; recipe: PeakRecipe };
    expect(prov.recipeName).toBe("two peaks");
    expect(prov.recipe.fit.engine).toBe("model");
    expect(prov.sources.map((s) => s.name)).toEqual(["scan a", "scan b", "scan c"]);
    expect((added.data.metadata.text_columns as Record<string, string[]>).Dataset).toHaveLength(5);
  });

  it("says why it cannot run", () => {
    render(<PeakBatchView recipes={[]} current="" pollMs={5} />);
    expect(screen.getByRole("button", { name: "Run batch" })).toBeDisabled();
    expect(screen.getByText(/save a recipe first/)).toBeInTheDocument();
  });

  it("refuses a Classic-engine recipe", () => {
    const classic = { ...RECIPE, fit: { ...RECIPE.fit, engine: "classic" as const } };
    render(<PeakBatchView recipes={[classic]} current="two peaks" pollMs={5} />);
    expect(screen.getByRole("button", { name: "Run batch" })).toBeDisabled();
    expect(screen.getByText(/uses the Classic engine/)).toBeInTheDocument();
  });

  it("when nothing can be prepared, no job is queued and every row says why", async () => {
    findMock.mockResolvedValue({ peaks: [], background: [] });
    await runAll();
    await waitFor(() => expect(status()).toHaveTextContent("no dataset could be prepared"));
    expect(posted).toHaveLength(0);
    const rows = within(screen.getByRole("table", { name: "batch results" })).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("no peaks found");
  });

  it("cancel while preparing stops at once and queues nothing, even when the pending request lands", async () => {
    let release: (v: unknown) => void = () => undefined;
    findMock.mockReturnValueOnce(new Promise((r) => { release = r; }));
    await runAll();
    await waitFor(() => expect(status()).toHaveTextContent("preparing · preparing 0/3"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(status()).toHaveTextContent("cancelled"));
    release({ peaks: [], background: [] });
    await new Promise((r) => setTimeout(r, 30));
    expect(status()).toHaveTextContent("cancelled");
    expect(posted).toHaveLength(0);
  });

  it("closing the view mid-fit cancels the job", async () => {
    script = [{ status: "running", progress: 0.5, message: "fitting 1/2" }];
    const view = render(<PeakBatchView recipes={[RECIPE]} current="two peaks" pollMs={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Library selection (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
    await waitFor(() => expect(status()).toHaveTextContent("fitting · fitting 1/2"));
    view.unmount();
    await waitFor(() => expect(cancelled).toBe(true));
  });
});

describe("PeakWizardPanel mode switch", () => {
  it("keeps a running batch alive while the wizard is shown", async () => {
    script = [{ status: "running", progress: 0.5, message: "fitting 1/2" }];
    localStorage.clear();
    localStorage.setItem("qz.peakRecipes", JSON.stringify([RECIPE]));
    useApp.setState({ peakWizardOpen: true });
    render(<PeakWizardPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Library selection (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Run batch" }));
    await waitFor(() => expect(status()).toHaveTextContent("fitting · fitting 1/2"));
    fireEvent.click(screen.getByRole("tab", { name: "Wizard" }));
    expect(screen.getByText("Range & baseline", { selector: ".qzk-wizard-step *, .qzk-wizard-step" })).toBeInTheDocument();
    script = [{ status: "done", progress: 1, message: "fitted 2/2" }];
    fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
    await waitFor(() => expect(status()).toHaveTextContent("done · fitted 2/3 datasets"));
    expect(cancelled).toBe(false);
  });
});
