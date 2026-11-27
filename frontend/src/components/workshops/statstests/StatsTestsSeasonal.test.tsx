// Statistical tests: the seasonal Mann-Kendall trend test through the real panel
// and store. Time defaults to the X column, the season comes from a column or a
// period, the request is built from the ANALYSIS view (an excluded row is left
// out), the answer shows the per-season table and the seasons left out, and a
// refusal shows the backend's reason. Its settings survive a saved-result reopen.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statisticalTestRecipe } from "../../../lib/statisticalTestAnalysisResult";
import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));

// 3 years x 2 seasons (month 1 and 2), time = the year, one Y; row 7 (year 4, month 1) is excluded.
const monthly: Dataset = {
  id: "m1", name: "monthly",
  data: {
    time: [1, 1, 2, 2, 3, 3, 4], values: [[1, 1], [3, 2], [2, 1], [1, 2], [3, 1], [2, 2], [99, 1]],
    labels: ["y", "month"], units: ["", ""], metadata: { x_column_name: "year" },
  },
  excludedRows: [6],
};

const answer = {
  n: 6, n_seasons: 2, n_pairs: 6, S: 2, var_S: 7.3333, Z: 0.3693, p: 0.712, sen_slope: 1, sen_ci_low: -2, sen_ci_high: 1, sen_intercept: 0,
  seasons: [
    { season: 1, n: 3, S: 3, var_S: 3.6667, tie_groups: 0, sen_slope: 1 },
    { season: 2, n: 3, S: -1, var_S: 3.6667, tie_groups: 0, sen_slope: -0.5 },
  ],
  skipped_seasons: [{ season: 5, n: 1, reason: "fewer than 2 observations (needs at least 2 years)" }],
  alpha: 0.05, significant: false, trend: "no trend", method: "Seasonal Mann-Kendall",
};

function load(ds: Dataset): void {
  useApp.setState({ datasets: [ds], activeId: ds.id, status: "", analysisResults: [], history: [], future: [], recalcMode: "manual" });
  useStatsTestsStore.setState({ open: true, request: null });
}
function pickTest(): void {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: "seasonal-mann-kendall" } });
}
const shown = (label: string): string => {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return select.options[select.selectedIndex]!.text;
};

beforeEach(() => vi.clearAllMocks());

describe("Seasonal Mann-Kendall in the Statistical tests panel", () => {
  it("is offered by name and defaults time to X and the values to the first Y", () => {
    load(monthly);
    render(<StatsTestsPanel />);
    pickTest();
    expect((screen.getByLabelText("Test") as HTMLSelectElement).selectedOptions[0]!.text).toBe("Seasonal Mann-Kendall trend");
    expect([shown("Time (x)"), shown("Values (y)")]).toEqual(["year", "y"]);
  });

  it("sends the season column from the analysis view (the excluded row is left out)", async () => {
    load(monthly);
    runMock.mockResolvedValue({ id: "seasonal-mann-kendall", data: answer });
    render(<StatsTestsPanel />);
    pickTest();
    fireEvent.change(screen.getByLabelText("Season column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await waitFor(() => expect(runMock.mock.calls.length).toBe(1));
    const req = runMock.mock.calls[0]![0] as { id: string; body: Record<string, unknown> };
    expect(req.id).toBe("seasonal-mann-kendall");
    expect(req.body).toMatchObject({
      x: [1, 1, 2, 2, 3, 3], y: [1, 3, 2, 1, 3, 2], season: [1, 2, 1, 2, 1, 2], alpha: 0.05,
    });
    expect(req.body).not.toHaveProperty("period");
  });

  it("shows the sentence, the per-season table and the seasons left out", async () => {
    load(monthly);
    runMock.mockResolvedValue({ id: "seasonal-mann-kendall", data: answer });
    render(<StatsTestsPanel />);
    pickTest();
    fireEvent.change(screen.getByLabelText("Season column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/no evidence of a monotonic trend in y over year, within each month/)).toBeInTheDocument();
    expect(screen.getByText(/1 season was left out for having fewer than 2 observations/)).toBeInTheDocument();
    expect(screen.getByText("tied value groups")).toBeInTheDocument(); // the per-season table
    expect(screen.getByText("Seasons left out")).toBeInTheDocument();
    expect(screen.getByText("fewer than 2 observations (needs at least 2 years)")).toBeInTheDocument();
  });

  it("a period replaces the season column in the request, and a bad period is refused before sending", async () => {
    load(monthly);
    runMock.mockResolvedValue({ id: "seasonal-mann-kendall", data: answer });
    render(<StatsTestsPanel />);
    pickTest();
    fireEvent.change(screen.getByLabelText("Season from"), { target: { value: "period" } });
    expect(screen.queryByLabelText("Season column")).toBeNull();
    const period = screen.getByLabelText("Period") as HTMLInputElement;
    expect(period.value).toBe("12");
    fireEvent.change(period, { target: { value: "2" } });
    fireEvent.blur(period);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await waitFor(() => expect(runMock.mock.calls.length).toBe(1));
    expect(runMock.mock.calls[0]![0].body).toMatchObject({ period: 2 });
    expect(runMock.mock.calls[0]![0].body).not.toHaveProperty("season");
  });

  it("shows the backend's reason inline when the run is refused", async () => {
    load(monthly);
    runMock.mockRejectedValue(new Error("no season has at least 2 observations; a seasonal trend needs at least 2 years of each season"));
    render(<StatsTestsPanel />);
    pickTest();
    fireEvent.change(screen.getByLabelText("Season column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/a seasonal trend needs at least 2 years of each season/)).toBeInTheDocument();
  });

  it("the saved result records the season settings and reads back exactly", async () => {
    load(monthly);
    runMock.mockResolvedValue({ id: "seasonal-mann-kendall", data: answer });
    render(<StatsTestsPanel />);
    pickTest();
    fireEvent.change(screen.getByLabelText("Season from"), { target: { value: "period" } });
    const period = screen.getByLabelText("Period") as HTMLInputElement;
    fireEvent.change(period, { target: { value: "4" } });
    fireEvent.blur(period);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await screen.findByText(/within each period 4/);
    await waitFor(() => expect(useApp.getState().analysisResults.length).toBe(1));
    const recipe = statisticalTestRecipe(useApp.getState().analysisResults[0]!);
    expect(recipe?.testId).toBe("seasonal-mann-kendall");
    expect(recipe?.params.rowt).toMatchObject({ seasonFrom: "period", period: 4 });
    // an older record (no season settings) reads back as the defaults, never as invalid
    const old = useApp.getState().analysisResults[0]!;
    const rowt = { ...(old.parameters!["params"] as { rowt: Record<string, unknown> }).rowt };
    delete rowt["seasonFrom"]; delete rowt["period"];
    const stripped = { ...old, parameters: { ...old.parameters, params: { ...(old.parameters!["params"] as object), rowt } } };
    expect(statisticalTestRecipe(stripped as never)?.params.rowt).toMatchObject({ seasonFrom: "column", period: 12 });
    // an invalid period is not guessed
    const bad = { ...old, parameters: { ...old.parameters, params: { ...(old.parameters!["params"] as object), rowt: { ...rowt, period: 1 } } } };
    expect(statisticalTestRecipe(bad as never)).toBeNull();
  });
});
