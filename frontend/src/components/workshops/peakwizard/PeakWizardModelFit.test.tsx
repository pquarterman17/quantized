// The Peak Analyzer's mixed-shape model engine, driven through the panel
// (audit P2.4 slice 2): per-peak shapes, background, the parameter table
// (vary / min / max / tie), share-FWHM, the request that reaches the backend
// (real postJSON over a stubbed fetch), result rendering (null-error reasons,
// SSR vs chi-square, warnings), the ASCII error, and the report hand-off.
// Every wait is on rendered STATE, never on a mock having been called.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import PeakWizardPanel from "./PeakWizardPanel";

const { findMock, emitMock } = vi.hoisted(() => ({ findMock: vi.fn(), emitMock: vi.fn() }));
vi.mock("../../../lib/api/peaks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/peaks")>()),
  findPeaks: findMock,
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  reportEmit: emitMock,
}));

const N = 60;
const ds: Dataset = {
  id: "d1",
  name: "xrd scan",
  data: {
    time: Array.from({ length: N }, (_, i) => i / 10),
    values: Array.from({ length: N }, (_, i) => [
      0.2 + Math.exp(-((i - 20) ** 2) / 8) + 0.6 * Math.exp(-((i - 40) ** 2) / 8),
    ]),
    labels: ["I"],
    units: ["cts"],
    metadata: {},
  },
};
const FOUND = {
  peaks: [
    { center: 2, height: 1, bg: 0.2, fwhm: 0.5, prominence: 1, localSNR: 20, area: null },
    { center: 4, height: 0.6, bg: 0.2, fwhm: 0.5, prominence: 0.6, localSNR: 12, area: null },
  ],
  background: [],
};

let bodies: Record<string, unknown>[] = [];
function stubModelFit(status: number, payload: unknown) {
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status, headers: { "Content-Type": "application/json" },
    }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bodies = [];
  localStorage.clear();
  findMock.mockResolvedValue(FOUND);
  emitMock.mockResolvedValue({ report: { title: "t", sections: [] } });
  useApp.setState({
    datasets: [ds], activeId: "d1", peakWizardOpen: true, reports: [], openReportId: null,
    peakOverlay: null, baselineOverlay: null, fitOverlay: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

const step = (name: string) => fireEvent.click(screen.getByText(name, { selector: ".qzk-wizard-step" }));

async function findTwoPeaks() {
  render(<PeakWizardPanel />);
  step("Find peaks");
  fireEvent.click(screen.getByRole("button", { name: "Find peaks" }));
  await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
}

async function fitWith(res: PeakModelFitResponse | { detail: string }, status = 200) {
  stubModelFit(status, res);
  step("Fit & review");
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
}

describe("Peak Analyzer — model engine setup (step 3)", () => {
  it("seeds from the found peaks and sends the edited table to /api/peaks/model-fit", async () => {
    await findTwoPeaks();
    step("Model");
    expect(screen.getByRole("combobox", { name: "fit engine" })).toHaveValue("model");
    // default shape = the recipe's global choice (Gaussian)
    expect(screen.getByRole("combobox", { name: "peak 1 shape" })).toHaveValue("gaussian");
    fireEvent.change(screen.getByRole("combobox", { name: "peak 2 shape" }), { target: { value: "lorentzian" } });
    fireEvent.change(screen.getByRole("combobox", { name: "background" }), { target: { value: "constant" } });
    // seeded starts: centre from detection, bounded to the window
    expect(screen.getByRole("textbox", { name: "#1 center start" })).toHaveValue("2");
    expect(screen.getByRole("textbox", { name: "#1 center min" })).toHaveValue("0");

    fireEvent.click(screen.getByRole("button", { name: "Share FWHM across peaks" }));
    expect(screen.getByRole("combobox", { name: "#2 FWHM tie" })).toHaveValue("p0.fwhm");
    expect(screen.getByRole("textbox", { name: "#2 FWHM start" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unshare FWHM" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "#1 height vary" }));
    fireEvent.change(screen.getByRole("textbox", { name: "#1 center min" }), { target: { value: "1.5" } });
    fireEvent.change(screen.getByRole("textbox", { name: "#2 center max" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "#2 height tie" }), { target: { value: "" } });

    await fitWith(modelFitResponse());
    await waitFor(() => expect(screen.getByLabelText("fit metrics")).toBeInTheDocument());
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    expect(body.shapes).toEqual(["gaussian", "lorentzian"]);
    expect(body.background).toBe("constant");
    const params = body.parameters as { name: string; vary: boolean; min: number | null; max: number | null; tie: string | null }[];
    const get = (n: string) => params.find((p) => p.name === n)!;
    expect(params.map((p) => p.name)).toEqual([
      "p0.center", "p0.height", "p0.fwhm", "p1.center", "p1.height", "p1.fwhm", "bg.c0",
    ]);
    expect(get("p1.fwhm").tie).toBe("p0.fwhm");
    expect(get("p0.height").vary).toBe(false);
    expect(get("p0.center").min).toBe(1.5);
    expect(get("p1.center").max).toBeNull();
    expect(get("p1.height").tie).toBeNull();
  });

  it("cannot fix a parameter others are tied to, and blocks Fit on a table the backend would reject", async () => {
    await findTwoPeaks();
    step("Model");
    fireEvent.click(screen.getByRole("button", { name: "Share FWHM across peaks" }));
    const rootVary = screen.getByRole("checkbox", { name: "#1 FWHM vary" });
    expect(rootVary).toBeDisabled();
    expect(rootVary).toHaveAttribute("title", "#2 FWHM is tied to this — untie first to fix it");
    // a bad bound is caught before any request is made
    fireEvent.change(screen.getByRole("textbox", { name: "#1 center min" }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("textbox", { name: "#1 center max" }), { target: { value: "4" } });
    expect(screen.getByRole("list", { name: "parameter problems" })).toHaveTextContent("#1 center: min is greater than max");
    stubModelFit(200, modelFitResponse());
    step("Fit & review");
    expect(screen.getByRole("button", { name: "Fit" })).toBeDisabled();
    expect(bodies).toHaveLength(0);
  });

  it("a table edit after a fit blocks the report until a re-fit, with the reason", async () => {
    await findTwoPeaks();
    await fitWith(modelFitResponse());
    await waitFor(() => expect(screen.getByLabelText("fit metrics")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start from fit" }));
    expect(screen.getByText(/cannot be\s+integrated or reported until you Re-fit/)).toBeInTheDocument();
    expect(useApp.getState().fitOverlay).toBeNull();
    step("Report");
    expect(screen.getByText(/re-fit in step 4 before integrating or reporting/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "→ Report" })).toBeDisabled();
  });

  it("the tie dropdown lists only same-kind parameters", async () => {
    await findTwoPeaks();
    step("Model");
    const tie = screen.getByRole("combobox", { name: "#1 FWHM tie" });
    const options = within(tie).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["", "p1.fwhm"]);
  });
});

describe("Peak Analyzer — model fit results (step 4)", () => {
  it("renders derived values ± errors, reasons for missing errors, SSR (never χ²) and warnings", async () => {
    await findTwoPeaks();
    await fitWith(modelFitResponse());
    await waitFor(() => expect(screen.getByLabelText("fit metrics")).toBeInTheDocument());
    const metrics = screen.getByLabelText("fit metrics");
    expect(within(metrics).getByText("SSR")).toBeInTheDocument();
    expect(within(metrics).getByText("reduced SSR")).toBeInTheDocument();
    expect(metrics.textContent).not.toMatch(/χ/);
    const warnings = screen.getByRole("list", { name: "fit warnings" });
    expect(warnings).toHaveTextContent("parameters ended on a bound (errors not reported): p0.eta");
    // p0's area error is null because eta sits on a bound; p1's centre is fixed
    expect(screen.getByTitle("not available: #1 η on a bound: the error is not reported there")).toHaveTextContent("± —");
    expect(screen.getByTitle("fixed: every parameter it depends on is fixed")).toBeInTheDocument();
    expect(screen.getAllByText("± 0.004").length).toBeGreaterThan(0);
    // parameter rows: at-bound and tied reasons
    expect(screen.getByTitle("on a bound: the error is not reported there")).toBeInTheDocument();
    expect(screen.getByText("tied → #1 FWHM")).toBeInTheDocument();
  });

  it("labels a weighted fit's objective χ²", async () => {
    await findTwoPeaks();
    await fitWith(modelFitResponse({ weighted: true, metrics: { objective: "chi2", chi2: 5.5, reduced_chi2: 1.1 } }));
    await waitFor(() => expect(screen.getByLabelText("fit metrics")).toBeInTheDocument());
    const metrics = screen.getByLabelText("fit metrics");
    expect(within(metrics).getByText("χ²")).toBeInTheDocument();
    expect(within(metrics).getByText("reduced χ²")).toBeInTheDocument();
    expect(metrics.textContent).not.toMatch(/SSR/);
  });

  it("a non-converged fit says so and explains every missing error", async () => {
    await findTwoPeaks();
    const res = modelFitResponse({ success: false, message: "the fit ran past its deadline", warnings: [] });
    res.parameters.forEach((p) => { p.stderr = null; });
    await fitWith(res);
    await waitFor(() => expect(screen.getByText(/did not converge/)).toBeInTheDocument());
    expect(screen.getAllByTitle(/stopped without converging/).length).toBeGreaterThan(0);
  });

  it("shows the backend's ASCII error detail", async () => {
    await findTwoPeaks();
    const detail = "p0.center: start value 9 is outside [0, 5.9]";
    await fitWith({ detail }, 422);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(detail));
  });

  it("reports the model fit through the peak_model_fit emitter, without curves", async () => {
    await findTwoPeaks();
    await fitWith(modelFitResponse());
    await waitFor(() => expect(screen.getByLabelText("fit metrics")).toBeInTheDocument());
    expect(useApp.getState().fitOverlay?.datasetId).toBe("d1");
    step("Report");
    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    const sent = emitMock.mock.calls[0][0] as { kind: string; result: Record<string, unknown> };
    expect(sent.kind).toBe("peak_model_fit");
    expect(sent.result).not.toHaveProperty("curves");
    expect(sent.result).toHaveProperty("metrics.objective", "ssr");
  });

  it("switching to the classic engine, or closing the panel, takes the model curve off the plot", async () => {
    await findTwoPeaks();
    await fitWith(modelFitResponse());
    await waitFor(() => expect(useApp.getState().fitOverlay?.datasetId).toBe("d1"));
    step("Model");
    fireEvent.change(screen.getByRole("combobox", { name: "fit engine" }), { target: { value: "classic" } });
    expect(useApp.getState().fitOverlay).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "fit engine" }), { target: { value: "model" } });
    await fitWith(modelFitResponse());
    await waitFor(() => expect(useApp.getState().fitOverlay?.datasetId).toBe("d1"));
    fireEvent.click(screen.getByTitle("Close"));
    expect(useApp.getState().peakWizardOpen).toBe(false);
    expect(useApp.getState().fitOverlay).toBeNull();
  });
});
