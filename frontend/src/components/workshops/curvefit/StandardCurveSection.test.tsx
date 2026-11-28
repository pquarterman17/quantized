// StandardCurveSection through the real store and hook: the plotted X / Y are
// the standards, the typed responses are the unknowns, a changed selection marks
// the readings out of date, and the copied table is what the table shows.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitStandardCurve, type StandardCurveResult } from "../../../lib/api/standardCurve";
import { copyText } from "../../../lib/clipboard";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import StandardCurveSection from "./StandardCurveSection";
import { parseResponses, standardCurveTable } from "./standardCurveTable";

vi.mock("../../../lib/api/standardCurve", () => ({ fitStandardCurve: vi.fn() }));
vi.mock("../../../lib/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(true) }));

const DATA: DataStruct = {
  time: [0, 1, 2, 4], values: [[0, 0.05], [1, 0.31], [2, 0.58], [4, 1.09]],
  labels: ["x", "y"], units: ["", ""], metadata: {},
};
const RESULT: StandardCurveResult = {
  model: "linear", paramNames: ["a", "b"], params: [0.05, 0.26], paramSE: [0.01, 0.005], n: 4, dof: 2,
  residualSE: 0.02, r2: 0.999, xRange: [0, 4], tCrit: 4.3, confidence: 0.95,
  unknowns: [
    { y: 0.5, x: 1.7, se: 0.1, lower: 1.2, upper: 2.2, status: "ok", reason: null },
    { y: 9, x: 34.6, se: null, lower: null, upper: null, status: "extrapolated", reason: "outside the range of the standards" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fitStandardCurve).mockResolvedValue(RESULT);
  useApp.setState({ datasets: [{ id: "d1", name: "std.dat", data: DATA }], activeId: "d1", xKey: 0, yKeys: [1], seriesOrder: null });
});

describe("parseResponses", () => {
  it("splits on commas, semicolons, spaces and new lines, and names the first bad token", () => {
    expect(parseResponses("0.5, 1;2\n3")).toEqual({ values: [0.5, 1, 2, 3] });
    expect(parseResponses("")).toEqual({ values: [] });
    expect(parseResponses("1 abc 2")).toEqual({ bad: "abc" });
    expect(parseResponses("1 Infinity")).toEqual({ bad: "Infinity" });
  });
});

describe("StandardCurveSection", () => {
  it("posts the plotted standards with the typed responses and shows each reading", async () => {
    render(<StandardCurveSection />);
    fireEvent.change(screen.getByLabelText("unknown responses"), { target: { value: "0.5 9" } });
    fireEvent.change(screen.getByLabelText("standard curve model"), { target: { value: "4pl" } });
    fireEvent.click(screen.getByRole("button", { name: "Read unknowns" }));
    await screen.findByRole("region", { name: "Standard curve results" });
    expect(fitStandardCurve).toHaveBeenCalledWith({
      x: [0, 1, 2, 4], y: [0.05, 0.31, 0.58, 1.09], unknowns: [0.5, 9], model: "4pl",
      replicates: 1, confidence: 0.95,
    });
    expect(screen.getByText("extrapolated")).toBeInTheDocument();
    expect(screen.getByText(/1\.2.* to .*2\.2/)).toBeInTheDocument();
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it("refuses text that is not a number or no responses, without calling the backend", async () => {
    render(<StandardCurveSection />);
    fireEvent.click(screen.getByRole("button", { name: "Read unknowns" }));
    expect(await screen.findByRole("alert")).toHaveAttribute("data-kind", "refusal");
    fireEvent.change(screen.getByLabelText("unknown responses"), { target: { value: "1 two" } });
    fireEvent.click(screen.getByRole("button", { name: "Read unknowns" }));
    expect(await screen.findByText(/"two" is not a number/)).toBeInTheDocument();
    expect(fitStandardCurve).not.toHaveBeenCalled();
  });

  it("a backend failure is an error alert", async () => {
    vi.mocked(fitStandardCurve).mockRejectedValue(new Error("the linear curve needs more standards"));
    render(<StandardCurveSection />);
    fireEvent.change(screen.getByLabelText("unknown responses"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Read unknowns" }));
    expect(await screen.findByRole("alert")).toHaveAttribute("data-kind", "error");
  });

  it("changing the settings after a fit marks it out of date and withholds the copy", async () => {
    render(<StandardCurveSection />);
    fireEvent.change(screen.getByLabelText("unknown responses"), { target: { value: "0.5 9" } });
    fireEvent.click(screen.getByRole("button", { name: "Read unknowns" }));
    await screen.findByRole("region", { name: "Standard curve results" });
    fireEvent.change(screen.getByLabelText("unknown responses"), { target: { value: "0.5 9 3" } });
    expect(await screen.findByText(/Out of date/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy standard-curve readings" })).toBeDisabled();
  });

  it("copies the readings as the table shows them", async () => {
    render(<StandardCurveSection />);
    fireEvent.change(screen.getByLabelText("unknown responses"), { target: { value: "0.5 9" } });
    fireEvent.click(screen.getByRole("button", { name: "Read unknowns" }));
    await screen.findByRole("region", { name: "Standard curve results" });
    fireEvent.click(screen.getByRole("button", { name: "Copy standard-curve readings" }));
    await vi.waitFor(() => expect(useApp.getState().status).toBe("copied 2 standard-curve readings"));
    expect(copyText).toHaveBeenCalledWith(standardCurveTable(RESULT, "tsv"));
    const tsv = standardCurveTable(RESULT, "tsv");
    expect(tsv).toContain("Response\tConcentration\tLower 95%\tUpper 95%\tNote");
    expect(tsv).toContain("0.5\t1.7\t1.2\t2.2");
    expect(tsv).toContain("extrapolated: outside the range of the standards");
  });
});
