// The rank table's Akaike-weight column, through the real Curve Fit window: the weights shown are the
// payload's, only converged rows have one, and the column sorts (first click puts the largest first).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanEntry } from "../../../lib/api/curvefit";
import { listFitModels } from "../../../lib/api/curvefit";
import { scanFitModelsJob } from "../../../lib/fitscan";
import * as jobs from "../../../lib/jobs";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
}));
vi.mock("../../../lib/fitscan", () => ({ scanFitModelsJob: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/jobs")>()),
  pollJob: vi.fn(),
  cancelJob: vi.fn(),
}));

const DATA: DataStruct = { time: [0, 1, 2, 3, 4, 5], values: [[1], [3], [9], [3], [1], [0]], labels: ["y"], units: [""], metadata: {} };

// Hand computation: converged AICc 10, 12, 15 give delta 0, 2, 5 and w = exp(-d/2) / sum = 1/S, e^-1/S, e^-2.5/S with S = 1 + e^-1 + e^-2.5.
const E1 = Math.exp(-1);
const E25 = Math.exp(-2.5);
const SUM = 1 + E1 + E25;
const row = (name: string, over: Partial<ScanEntry>): ScanEntry => ({
  name, kind: "registry", error: null, k: 3, params: [1], paramNames: ["a"], R2: 0.99, RMSE: 0.1, AIC: -10, AICc: -9,
  deltaAICc: 0, weight: null, adjR2: 0.98, chiSqRed: 0.02, BIC: -8, converged: true, ...over,
});

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [{ name: "Linear", category: "Linear", paramNames: ["a"], nParams: 1, p0: [1], lb: [], ub: [] }] });
  vi.mocked(scanFitModelsJob).mockResolvedValue({ job_id: "j1" });
  vi.mocked(jobs.pollJob).mockResolvedValue({
    results: [
      row("Unconverged", { converged: false, AICc: 7, deltaAICc: null, weight: null }),
      row("Alpha", { AICc: 10, deltaAICc: 0, weight: 1 / SUM }),
      row("Beta", { AICc: 12, deltaAICc: 2, weight: E1 / SUM }),
      row("Gamma", { AICc: 15, deltaAICc: 5, weight: E25 / SUM }),
    ],
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", xKey: null, yKeys: [0], seriesOrder: null,
    errKeys: {}, fitOverlay: null, analysisResults: [], curveFitOpen: true, toolWindowLayout: {},
  });
});

const names = (table: HTMLElement) => within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("td")!.textContent!.replace("best", ""));

describe("Akaike weight column of the rank table", () => {
  it("shows the weights, none for an unconverged fit, and sorts on them", async () => {
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("tab", { name: "Advanced" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rank models" }));
    const table = await screen.findByRole("table", { name: "Model ranking" });
    const head = within(table).getByRole("columnheader", { name: "w" });
    const cell = (name: string) => {
      const tds = within(within(table).getByText(name, { exact: false }).closest("tr")!).getAllByRole("cell");
      return tds[tds.length - 3]!.textContent; // w, conv., dAICc
    };
    expect(cell("Alpha")).toBe(String(Number((1 / SUM).toPrecision(6))));
    expect(cell("Beta")).toBe(String(Number((E1 / SUM).toPrecision(6))));
    expect(cell("Unconverged")).toBe("—");
    // the weights of the converged rows add to 1 (they are exp(-d/2) / sum over the converged rows)
    expect(1 / SUM + E1 / SUM + E25 / SUM).toBeCloseTo(1, 12);

    expect(head).toHaveAttribute("aria-sort", "none");
    fireEvent.click(within(head).getByRole("button"));
    expect(head).toHaveAttribute("aria-sort", "descending"); // the largest weight first
    expect(names(table)).toEqual(["Alpha", "Beta", "Gamma", "Unconverged"]); // no weight sorts last
    fireEvent.click(within(head).getByRole("button"));
    expect(head).toHaveAttribute("aria-sort", "ascending");
    expect(names(table)).toEqual(["Gamma", "Beta", "Alpha", "Unconverged"]);
  });
});
