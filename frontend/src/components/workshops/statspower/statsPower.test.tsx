// Power and sample size, and the probability calculator: the request each form
// makes, the answer on screen, the linked worksheet a column commits, and both
// panels reachable from their commands (Statistics menu and palette search).

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import type { PowerSolveResult, ProbabilityResult } from "../../../lib/api/statsPower";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useApp } from "../../../store/useApp";
import AnalysisExtrasHost from "../analysisextras/AnalysisExtrasHost";
import { buildBody, defaultForm, describe as sentence, reportText, withTest } from "./powerModel";
import PowerPanel from "./PowerPanel";
import ProbabilityPanel from "./ProbabilityPanel";
import { probabilityWorksheet } from "./useProbability";

const api = vi.hoisted(() => ({ statsPowerSolve: vi.fn(), statsProbability: vi.fn(), statsDistributions: vi.fn() }));
vi.mock("../../../lib/api/statsPower", () => api);

const SOLVED: PowerSolveResult = {
  test: "t-two-sample", solve: "n", alpha: 0.05, tails: 2, effect_name: "Cohen's d", effect: 0.5, effect_alt: null,
  p0: null, p1: null, p1_alt: null, n: 64, n2: 64, n_total: 128, ratio: 1, groups: null, power: 0.8014595579,
  target_power: 0.8, notes: [], curve: { n: [16, 32, 64, 128], power: [0.28, 0.5, 0.8, 0.98] },
};

describe("power model", () => {
  it("asks only for what the question leaves open", () => {
    const f = defaultForm();
    expect(buildBody(f)).toEqual({ body: { test: "t-two-sample", solve: "n", alpha: 0.05, tails: 2, power: 0.8, effect: 0.5, ratio: 1 } });
    expect(buildBody({ ...f, solve: "power" })).toEqual({ body: { test: "t-two-sample", solve: "power", alpha: 0.05, tails: 2, n: 20, effect: 0.5, ratio: 1 } });
    expect(buildBody({ ...f, solve: "effect" })).toEqual({ body: { test: "t-two-sample", solve: "effect", alpha: 0.05, tails: 2, n: 20, power: 0.8, ratio: 1 } });
    expect(buildBody({ ...f, test: "anova", effect: 0.25 })).toMatchObject({ body: { groups: 3 } });
    const prop = buildBody({ ...f, test: "prop-one", p0: 0.4, p1: 0.6 });
    expect(prop).toMatchObject({ body: { p0: 0.4, p1: 0.6 } });
    expect("body" in prop && prop.body.effect).toBeUndefined();
    expect("body" in prop && prop.body.ratio).toBeUndefined();
  });

  it("names the first empty field instead of sending a request", () => {
    expect(buildBody({ ...defaultForm(), effect: undefined })).toEqual({ missing: "effect" });
    expect(buildBody({ ...defaultForm(), test: "prop-two", p1: undefined })).toEqual({ missing: "p1" });
    expect(buildBody({ ...defaultForm(), alpha: undefined })).toEqual({ missing: "alpha" });
  });

  it("resets the effect to the new test's usual size", () => {
    expect(withTest(defaultForm(), "anova").effect).toBe(0.25);
    expect(withTest(defaultForm(), "variance").effect).toBe(2);
    expect(withTest({ ...defaultForm(), effect: 0.9 }, "t-paired").effect).toBe(0.5);
  });

  it("words the answer with the achieved power at the whole sizes", () => {
    expect(sentence(SOLVED)).toBe(
      "A two-sided two-sample t-test needs n = 64 per group (128 in all) for 80% power to detect d = 0.5 at the 5% level. Achieved power at n = 64 per group: 80.1%.",
    );
    expect(sentence({ ...SOLVED, solve: "power", n: 30, n2: 60, n_total: 90, ratio: 2, power: 0.6, target_power: null })).toBe(
      "With n1 = 30, n2 = 60 (90 in all), a two-sided two-sample t-test has 60% power to detect d = 0.5 at the 5% level.",
    );
    expect(sentence({ ...SOLVED, solve: "effect", test: "variance", effect_name: "variance ratio", effect: 2.03, effect_alt: 0.457, n: 30, n2: null, n_total: 30 })).toContain(
      "effects of variance ratio = 2.03 (or 0.457 the other way)",
    );
    expect(reportText(SOLVED)).toContain("Target power: 80%");
  });
});

describe("PowerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.statsPowerSolve.mockResolvedValue(SOLVED);
  });

  it("solves as the form changes and shows the answer and the curve", async () => {
    render(<PowerPanel />);
    expect(await screen.findByRole("status", { name: "Result" })).toHaveTextContent("needs n = 64 per group");
    expect(api.statsPowerSolve.mock.calls[0]![0]).toMatchObject({ test: "t-two-sample", solve: "n", effect: 0.5, power: 0.8 });
    expect(screen.getByRole("img", { name: "Power curve" })).toBeInTheDocument();
    api.statsPowerSolve.mockResolvedValue({ ...SOLVED, test: "anova", effect_name: "Cohen's f", effect: 0.25, n: 45, n2: null, n_total: 180, groups: 4, power: 0.804 });
    fireEvent.change(screen.getByLabelText("Test"), { target: { value: "anova" } });
    await waitFor(() => expect(screen.getByRole("status", { name: "Result" })).toHaveTextContent("n = 45 per group (180 in all, 4 groups)"));
    const last = api.statsPowerSolve.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ test: "anova", effect: 0.25, groups: 3 });
  });

  it("shows the solver's refusal and a missing field, never a stale answer", async () => {
    render(<PowerPanel />);
    await screen.findByRole("status", { name: "Result" });
    api.statsPowerSolve.mockRejectedValue(new Error("power must be greater than alpha and less than 1"));
    const power = screen.getByLabelText("Target power");
    fireEvent.change(power, { target: { value: "0.01" } });
    fireEvent.blur(power);
    expect(await screen.findByRole("alert")).toHaveTextContent("greater than alpha");
    expect(screen.queryByRole("status", { name: "Result" })).toBeNull();
    fireEvent.change(power, { target: { value: "" } });
    fireEvent.blur(power);
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter power.");
  });

  it("hides the fields a question does not use", async () => {
    render(<PowerPanel />);
    await screen.findByRole("status", { name: "Result" });
    expect(screen.queryByLabelText("n (first group)")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Detectable effect" }));
    expect(screen.queryByLabelText("Effect size d")).toBeNull();
    expect(screen.getByLabelText("n (first group)")).toBeInTheDocument();
  });

  it("copies the report", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PowerPanel />);
    await screen.findByRole("status", { name: "Result" });
    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    await waitFor(() => expect(useApp.getState().status).toContain("copied"));
    expect(writeText.mock.calls[0]![0]).toContain("Achieved power at n = 64 per group: 80.1%");
  });
});

const DISTS = [
  { id: "normal", label: "Normal", params: ["mu", "sigma"], defaults: [0, 1], discrete: false },
  { id: "binomial", label: "Binomial", params: ["n", "p"], defaults: [10, 0.5], discrete: true },
];
const NORMAL: ProbabilityResult = {
  dist: "normal", label: "Normal", params: { mu: 0, sigma: 1 }, discrete: false,
  formulas: { pdf: "normpdf(A, 0, 1)", cdf: "normcdf((A - 0) / 1)", sf: "normcdf((A - 0) / 1, 1)", quantile: "0 + 1 * norminv(A)" },
  x: [0], pdf: [0.3989422804], cdf: [0.5], sf: [0.5], p: [0.975], quantile: [1.959963985],
};

describe("ProbabilityPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.statsDistributions.mockResolvedValue(DISTS);
    api.statsProbability.mockResolvedValue(NORMAL);
    useApp.setState({
      datasets: [{ id: "s", name: "xs.dat", data: { time: [0, 1, 2], values: [[0.5], [1.5], [2.5]], labels: ["z"], units: [""], metadata: { x_column_name: "X" } } }],
      activeId: "s",
      analysisResults: [],
      status: "",
    });
  });

  it("evaluates one value with the formula's parameter names", async () => {
    render(<ProbabilityPanel />);
    expect(await screen.findByLabelText("mu")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: "Result" })).toHaveTextContent("1.959963985");
    expect(api.statsProbability.mock.calls[0]![0]).toEqual({ dist: "normal", params: { mu: 0, sigma: 1 }, x: [0], p: [0.975] });
    expect(screen.getByText("cdf P(X ≤ x)").closest("tr")).toHaveAttribute("title", expect.stringContaining("normcdf((A - 0) / 1)"));
  });

  it("switches distribution and shows a refusal", async () => {
    render(<ProbabilityPanel />);
    await screen.findByLabelText("mu");
    api.statsProbability.mockRejectedValue(new Error("invalid parameters for Binomial"));
    fireEvent.change(screen.getByLabelText("Distribution"), { target: { value: "binomial" } });
    expect(await screen.findByLabelText("n")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid parameters");
  });

  it("commits a column as a NEW linked worksheet, once", async () => {
    api.statsProbability.mockResolvedValue({ ...NORMAL, x: [0, 1, 2], pdf: [0.4, 0.24, 0.05], cdf: [0.5, 0.84, 0.98], sf: [0.5, 0.16, 0.02], p: undefined, quantile: undefined });
    render(<ProbabilityPanel />);
    await screen.findByLabelText("mu");
    fireEvent.click(screen.getByRole("radio", { name: "Worksheet column" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Add as linked worksheet/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const body = api.statsProbability.mock.calls.at(-1)![0];
    expect(body).toEqual({ dist: "normal", params: { mu: 0, sigma: 1 }, x: [0.5, 1.5, 2.5] });
    const out = useApp.getState().datasets[1]!;
    expect(out.data.labels).toEqual(["pdf", "cdf", "survival"]);
    expect(out.data.time).toEqual([0, 1, 2]);
    expect(useApp.getState().analysisResults.some((r) => r.producer.id === "prob-calc")).toBe(true);
    expect(useApp.getState().datasets[0]!.data.values).toEqual([[0.5], [1.5], [2.5]]);
    // The commit activates its output; go back to the source and repeat the same computation.
    act(() => useApp.setState({ activeId: "s" }));
    fireEvent.click(screen.getByRole("button", { name: /Add as linked worksheet/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Add as linked worksheet/ })).toBeEnabled());
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("builds the quantile and discrete worksheets from the answer", () => {
    expect(probabilityWorksheet({ ...NORMAL, p: [0.5, 0.9], quantile: [0, null] }, "p", "p col")).toMatchObject({
      time: [0.5, 0.9], labels: ["quantile"], values: [[0], [NaN]], metadata: { x_column_name: "p col" },
    });
    expect(probabilityWorksheet({ ...NORMAL, discrete: true, x: [1], pdf: [0.1], cdf: [0.2], sf: [0.8] }, "x", "k").labels).toEqual(["pmf", "cdf", "survival"]);
  });
});

describe("launchers", () => {
  it("open each panel lazily from the Statistics menu commands", async () => {
    useAnalysisExtras.setState({ open: [] });
    const cmds = buildAnalysisCommands(useApp.getState as never);
    for (const [id, label] of [["stats-power", "Power and sample size…"], ["prob-calc", "Probability calculator…"]] as const) {
      const c = cmds.find((a) => a.id === id)!;
      expect([c.group, c.section, c.label]).toEqual(["Analyze", "Statistics", label]);
      expect(c.paletteOnly).toBeUndefined();
    }
    api.statsPowerSolve.mockResolvedValue(SOLVED);
    api.statsDistributions.mockResolvedValue(DISTS);
    api.statsProbability.mockResolvedValue(NORMAL);
    cmds.find((a) => a.id === "stats-power")!.run();
    render(<AnalysisExtrasHost />);
    expect(await screen.findByText("Power and sample size")).toBeInTheDocument();
    cmds.find((a) => a.id === "prob-calc")!.run();
    expect(await screen.findByText("Probability calculator")).toBeInTheDocument();
    expect(useAnalysisExtras.getState().open).toEqual(["stats-power", "prob-calc"]);
  });
});
