// The Peak Analyzer's sensible defaults (UX audit 7 #8, lane UX-I), driven
// through the panel: ① starts from SNIP on a decaying or log-Y trace (and
// never overrides a choice), ③ drops the fitted background over a subtracted
// baseline and warns on a heavy model, ④ fits on entry with a clock against
// the time limit, blocks Next while fitting, and offers "Fit the 8 strongest
// peaks". Real postJSON over a stubbed fetch; every wait is on rendered STATE.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { requestPeakFitRange, usePeakFitRange } from "../../../store/peakFitRange";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import PeakWizardPanel from "./PeakWizardPanel";

const { findMock } = vi.hoisted(() => ({ findMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));

const N = 200;
const dataset = (y: (i: number) => number): Dataset => ({
  id: "d1",
  name: "scan",
  data: {
    time: Array.from({ length: N }, (_, i) => i / 10),
    values: Array.from({ length: N }, (_, i) => [y(i)]),
    labels: ["I"],
    units: ["cts"],
    metadata: {},
  },
});
const decaying = dataset((i) => 15 + 70 * Math.exp(-i / 50) + (i % 20 === 10 ? 200 : 0));
const flat = dataset((i) => 20 + (i % 20 === 10 ? 200 : 0));
const found = (n: number) => ({
  peaks: Array.from({ length: n }, (_, k) => ({
    center: 1 + k * 2, height: 10 + k, bg: 0, fwhm: 0.2, prominence: 10, localSNR: 20, area: null,
  })),
  background: [],
});

let fits: Record<string, unknown>[] = [];
let baselines = 0;
let pendingFit: ((ok: boolean) => void) | null = null;
function stubFetch({ hold = false } = {}) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } }));
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    if (url.includes("/api/baseline/")) {
      baselines++;
      return json({ baseline: (body.y as number[]).map(() => 10) });
    }
    fits.push(body);
    if (!hold) return json(modelFitResponse());
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      pendingFit = () => void resolve(new Response(JSON.stringify(modelFitResponse()), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
  });
}

const step = (name: string) => fireEvent.click(screen.getByText(name, { selector: ".qzk-wizard-step" }));
const baselineSelect = () => screen.getByRole("combobox", { name: "Peak baseline method" });

function open(ds: Dataset, yScale: "linear" | "log" = "linear") {
  useApp.setState({ datasets: [ds], activeId: "d1", yScale });
  render(<PeakWizardPanel />);
}

beforeEach(() => {
  vi.clearAllMocks();
  fits = [];
  baselines = 0;
  pendingFit = null;
  localStorage.clear();
  usePeakFitRange.setState({ request: null });
  findMock.mockResolvedValue(found(2));
  useApp.setState({
    peakWizardOpen: true, xKey: null, yKeys: [0], seriesOrder: null, reports: [],
    peakOverlay: null, baselineOverlay: null, fitOverlay: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("step ① baseline default", () => {
  it("starts from SNIP on a decaying trace, says why, and previews it", async () => {
    stubFetch();
    open(decaying);
    await waitFor(() => expect(baselineSelect()).toHaveValue("snip"));
    expect(screen.getByText(/SNIP was chosen because the data is log-scaled or decays/)).toBeInTheDocument();
    await waitFor(() => expect(useApp.getState().baselineOverlay?.datasetId).toBe("d1"));
  });

  it("starts from SNIP on a log-Y plot even when the trace is flat", async () => {
    stubFetch();
    open(flat, "log");
    await waitFor(() => expect(baselineSelect()).toHaveValue("snip"));
  });

  it("keeps None on a flat linear trace, and never overrides the user's None", async () => {
    stubFetch();
    open(flat);
    await act(async () => {});
    expect(baselineSelect()).toHaveValue("none");
    expect(baselines).toBe(0);
  });

  it("a user's None stays None, and the note goes", async () => {
    stubFetch();
    open(decaying);
    await waitFor(() => expect(baselineSelect()).toHaveValue("snip"));
    fireEvent.change(baselineSelect(), { target: { value: "none" } });
    await act(async () => {});
    expect(baselineSelect()).toHaveValue("none");
    expect(screen.queryByText(/was chosen because/)).not.toBeInTheDocument();
  });

  it("Fit this range, asked before the panel opens, finds on the auto-baselined trace", async () => {
    stubFetch();
    requestPeakFitRange("d1", 0, 19.9); // the whole trace, asked before the panel mounts
    open(decaying);
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: /include peak/ })).toHaveLength(2));
    // Found on the subtracted trace (the stub's baseline is a flat 10), never the raw one.
    const raw0 = decaying.data.values[0]![0]!;
    expect(findMock.mock.calls.map(([b]) => (b as { y: number[] }).y[0])).toEqual(findMock.mock.calls.map(() => raw0 - 10));
    expect(baselines).toBe(1);
  });
});

describe("step ③ background and load", () => {
  it("no fitted background over a subtracted baseline; a user's pick wins", async () => {
    stubFetch();
    open(decaying);
    await waitFor(() => expect(useApp.getState().baselineOverlay?.datasetId).toBe("d1"));
    step("Find peaks");
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: /include peak/ })).toHaveLength(2));
    step("Model");
    expect(screen.getByRole("combobox", { name: "background" })).toHaveValue("none");
    expect(screen.getByText(/Background starts at None: the step-1 baseline is already subtracted/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "background" }), { target: { value: "linear" } });
    expect(screen.getByRole("combobox", { name: "background" })).toHaveValue("linear");
  });

  it("keeps the linear background without a baseline, and warns on a heavy model", async () => {
    findMock.mockResolvedValue(found(5)); // 15 free on 200 points: above N / 50
    stubFetch();
    open(flat);
    step("Find peaks");
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: /include peak/ })).toHaveLength(5));
    step("Model");
    expect(screen.getByRole("combobox", { name: "background" })).toHaveValue("linear");
    expect(screen.getByRole("note")).toHaveTextContent(/free parameters for 200 points: .*time limit/);
  });
});

describe("step ④ fits on entry", () => {
  async function toModelStep(peaks: number) {
    findMock.mockResolvedValue(found(peaks));
    open(flat);
    step("Find peaks");
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: /include peak/ })).toHaveLength(peaks));
  }

  it("runs once on entry with a clock, holds Next until it lands, and does not re-run on return", async () => {
    stubFetch({ hold: true });
    await toModelStep(2);
    step("Fit & review");
    await waitFor(() => expect(screen.getByRole("status", { name: "fit progress" })).toHaveTextContent(/s of the 10 s limit/));
    const next = screen.getByRole("button", { name: "Next →" });
    expect(next).toBeDisabled();
    expect(next).toHaveAttribute("title", "fitting — wait for it to finish, or cancel it");
    await act(async () => pendingFit?.(true));
    await screen.findByLabelText("fit metrics");
    expect(screen.getByRole("button", { name: "Next →" })).toBeEnabled();
    step("Model");
    step("Fit & review");
    expect(screen.queryByRole("status", { name: "fit progress" })).not.toBeInTheDocument();
    expect(fits).toHaveLength(1);
  });

  it("offers the 8 strongest peaks on a heavy model, and fits just those", async () => {
    stubFetch({ hold: true });
    await toModelStep(10); // 31 free on 200 points
    step("Fit & review");
    await waitFor(() => expect(screen.getByRole("status", { name: "fit progress" })).toBeInTheDocument());
    expect(screen.getByText(/free parameters may not converge in 10 s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fit the 8 strongest peaks" }));
    await waitFor(() => expect(fits).toHaveLength(2));
    expect((fits[0].shapes as unknown[]).length).toBe(10);
    expect((fits[1].shapes as unknown[]).length).toBe(8);
    await act(async () => pendingFit?.(true));
    await screen.findByLabelText("fit metrics");
    expect(screen.queryByRole("button", { name: "Fit the 8 strongest peaks" })).not.toBeInTheDocument();
    // The two weakest (the first two found, heights 10 and 11) were excluded.
    step("Find peaks");
    const boxes = screen.getAllByRole("checkbox", { name: /include peak/ });
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, false, ...Array(8).fill(true)]);
  });
});
