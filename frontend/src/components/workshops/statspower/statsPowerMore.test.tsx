// Power and sample size: the exact binomial, chi-square (Cohen's w) and
// correlation tests in the form and the answer sentence.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PowerSolveResult } from "../../../lib/api/statsPower";
import { buildBody, defaultForm, describe as sentence, hasAlternative, nAxisLabel, reportText, withTest } from "./powerModel";
import PowerPanel from "./PowerPanel";

const api = vi.hoisted(() => ({ statsPowerSolve: vi.fn() }));
vi.mock("../../../lib/api/statsPower", () => api);

const BASE: PowerSolveResult = {
  test: "correlation", solve: "n", alpha: 0.05, tails: 2, effect_name: "correlation r", effect: 0.3, effect_alt: null,
  p0: null, p1: null, p1_alt: null, n: 85, n2: null, n_total: 85, ratio: 1, groups: null, power: 0.8003,
  target_power: 0.8, notes: [], curve: { n: [20, 85, 170], power: [0.3, 0.8, 0.97] },
};

describe("power model: the three added tests", () => {
  it("asks for df only for the chi-square test", () => {
    const f = defaultForm();
    expect(buildBody({ ...f, test: "chi-square", effect: 0.3 })).toMatchObject({ body: { test: "chi-square", effect: 0.3, df: 3 } });
    expect(buildBody({ ...f, test: "chi-square", df: undefined })).toEqual({ missing: "df" });
    const cor = buildBody({ ...f, test: "correlation", effect: 0.3 });
    expect("body" in cor && cor.body.df).toBeUndefined();
  });

  it("the exact binomial takes p0 and p1 like the other proportion tests", () => {
    const b = buildBody({ ...defaultForm(), test: "prop-exact", p0: 0.5, p1: 0.8 });
    expect(b).toMatchObject({ body: { test: "prop-exact", p0: 0.5, p1: 0.8 } });
    expect("body" in b && b.body.effect).toBeUndefined();
  });

  it("resets the effect to each test's usual size", () => {
    expect(withTest(defaultForm(), "chi-square").effect).toBe(0.3);
    expect(withTest(defaultForm(), "correlation").effect).toBe(0.3);
  });

  it("words the sizes", () => {
    expect(sentence(BASE)).toContain("test of a correlation needs n = 85 pairs for 80% power to detect correlation r = 0.3");
    expect(sentence({ ...BASE, test: "chi-square", effect_name: "Cohen's w", n: 122, n_total: 122, df: 3 })).toContain("n = 122 in all (df = 3)");
  });
});

describe("PowerPanel with the added tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.statsPowerSolve.mockResolvedValue(BASE);
  });

  it("shows the degrees-of-freedom field for chi-square only and sends it", async () => {
    render(<PowerPanel />);
    await screen.findByRole("status", { name: "Result" });
    expect(screen.queryByLabelText("Degrees of freedom")).toBeNull();
    fireEvent.change(screen.getByLabelText("Test"), { target: { value: "chi-square" } });
    expect(screen.getByLabelText("Degrees of freedom")).toBeInTheDocument();
    expect(screen.getByLabelText("Effect size w")).toBeInTheDocument();
    await waitFor(() => expect(api.statsPowerSolve.mock.calls.at(-1)![0]).toMatchObject({ test: "chi-square", df: 3, effect: 0.3 }));
  });

  it("shows the exact binomial's refusal to solve for the effect", async () => {
    render(<PowerPanel />);
    await screen.findByRole("status", { name: "Result" });
    fireEvent.change(screen.getByLabelText("Test"), { target: { value: "prop-exact" } });
    api.statsPowerSolve.mockRejectedValue(new Error("the exact binomial power is not monotone in the effect: solve for power or sample size"));
    fireEvent.click(screen.getByRole("radio", { name: "Detectable effect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not monotone");
  });
});

// Acceptance 5 C8: only the alternatives a test has, and the n the curve's axis counts.
describe("power: alternatives and the n axis", () => {
  it("offers an alternative only to the tests that have one", () => {
    for (const t of ["t-one-sample", "t-two-sample", "t-paired", "prop-one", "prop-two", "variance", "prop-exact", "correlation"] as const) expect(hasAlternative(t)).toBe(true);
    expect(hasAlternative("chi-square")).toBe(false);
    expect(hasAlternative("anova")).toBe(false);
  });

  it("never sends one-sided for a test without an alternative, and words it without a side", () => {
    expect(buildBody({ ...defaultForm(), test: "chi-square", tails: 1 })).toMatchObject({ body: { tails: 2 } });
    expect(buildBody({ ...defaultForm(), test: "correlation", tails: 1 })).toMatchObject({ body: { tails: 1 } });
    const chi = { ...BASE, test: "chi-square" as const, effect_name: "Cohen's w", n: 122, n_total: 122, df: 3 };
    expect(sentence(chi)).toMatch(/^A chi-square test needs/);
    expect(reportText(chi)).toContain("Test: Chi-square test (Cohen's w)");
    expect(sentence(BASE)).toMatch(/^A two-sided test of a correlation/);
  });

  it("labels the curve axis with what n counts for each test", () => {
    const lab = (test: PowerSolveResult["test"], n2: number | null = null, n = 20) => nAxisLabel({ test, n, n2 });
    expect(lab("prop-exact")).toBe("n");
    expect(lab("t-one-sample")).toBe("n");
    expect(lab("chi-square")).toBe("total N");
    expect(lab("correlation")).toBe("pairs");
    expect(lab("t-paired")).toBe("pairs");
    expect(lab("anova")).toBe("n per group");
    expect(lab("t-two-sample", 20)).toBe("n per group");
    expect(lab("t-two-sample", 40)).toBe("n (first group)");
  });

  it("the panel shows a fixed upper-tail alternative for chi-square and the test's own n on the curve", async () => {
    vi.clearAllMocks();
    api.statsPowerSolve.mockResolvedValue(BASE);
    render(<PowerPanel />);
    await screen.findByRole("status", { name: "Result" });
    expect(screen.getByLabelText("Alternative")).toHaveDisplayValue("two-sided");
    expect(screen.getByRole("img", { name: "Power curve" })).toHaveTextContent("pairs"); // BASE is a correlation result
    api.statsPowerSolve.mockResolvedValue({ ...BASE, test: "chi-square", effect_name: "Cohen's w", n: 122, n_total: 122, df: 3 });
    fireEvent.change(screen.getByLabelText("Test"), { target: { value: "chi-square" } });
    await waitFor(() => expect(screen.getByRole("img", { name: "Power curve" })).toHaveTextContent("total N"));
    const alt = screen.getByLabelText("Alternative");
    expect(alt).toBeDisabled();
    expect(alt).toHaveDisplayValue("upper tail only");
    expect(screen.queryByRole("option", { name: "two-sided" })).toBeNull();
  });
});
