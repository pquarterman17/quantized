// Global fit with one model per series (multi-output models), through the real
// Curve Fit window: pick a model for a series, tick one shared parameter, fit,
// read the per-series results and the joint statistics, refuse a share a model
// cannot honour, and reopen the saved report.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listFitModels } from "../../../lib/api/curvefit";
import { globalFitJob, type GlobalFitResult } from "../../../lib/api/globalFit";
import { reportEmit } from "../../../lib/api/report";
import { pollJob } from "../../../lib/jobs";
import type { DataStruct } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/api/report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/report")>()),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  listFitModels: vi.fn(),
}));
vi.mock("../../../lib/api/globalFit", () => ({ globalFitJob: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/jobs")>()),
  pollJob: vi.fn(),
  cancelJob: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 2],
    [3, 5],
    [5, 8],
  ],
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
};

// Series A: Linear (m, b); series B: Proportional (m). m is shared; b belongs to A only.
const FIT: GlobalFitResult = {
  paramNames: ["m", "b"],
  params: [
    [2, 1],
    [2, null],
  ],
  errors: [
    [0.25, 0.5],
    [0.25, null],
  ],
  shared: [{ name: "m", paramIdx: 0, datasets: [0, 1], value: 2, error: 0.25 }],
  yFit: [
    [1, 3, 5],
    [0, 2, 4],
  ],
  R2: [0.75, 0.5],
  RMSE: [0.1, 0.2],
  chiSqRed: 1.5,
  nTotal: 6,
  nFree: 2,
  exitFlag: 1,
  chiSqTotal: 3,
  AIC: -4.5,
  AICc: -2.5,
  BIC: -5.5,
  datasetParamNames: [["m", "b"], ["m"]],
  datasetModels: ["Linear", "Proportional"],
};

const MODEL = (name: string, paramNames: string[]) => ({
  name,
  category: "polynomial",
  paramNames,
  nParams: paramNames.length,
  p0: paramNames.map(() => 1),
  lb: paramNames.map(() => null),
  ub: paramNames.map(() => null),
});

async function openGlobalWithBOnProportional() {
  render(<CurveFitPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Global fit" }));
  await screen.findByLabelText("Fit A");
  fireEvent.change(await screen.findByLabelText("Model for B"), { target: { value: "Proportional" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [MODEL("Linear", ["m", "b"]), MODEL("Proportional", ["m"])] });
  vi.mocked(globalFitJob).mockResolvedValue({ job_id: "j1" });
  vi.mocked(pollJob).mockResolvedValue(FIT);
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: [0, 1],
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
    curveFitOpen: true,
    reports: [],
  });
});

describe("CurveFitPanel: Global fit with a model per series", () => {
  it("sends one model per series, shares only the ticked parameter and shows each series' own values", async () => {
    await openGlobalWithBOnProportional();
    // The table lists the union once; nothing is shared until it is ticked.
    expect(screen.getByLabelText("Share m across all series")).not.toBeChecked();
    expect(screen.getByLabelText("Share b across all series")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Share m across all series"));
    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));

    const table = await screen.findByRole("table", { name: "Global fit parameters" });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => r.textContent);
    // m once (shared, one error); b only for A; B has no b row.
    expect(rows).toEqual(["mshared20.25", "bA10.5"]);
    const req = vi.mocked(globalFitJob).mock.calls[0]![0];
    expect(req.dataset_models).toEqual([
      { model: "Linear", lower: [null, null], upper: [null, null] },
      { model: "Proportional", lower: [null], upper: [null] },
    ]);
    expect(req.model).toBeUndefined();
    expect(req.constraints).toEqual([{ param_name: "m", datasets: [0, 1] }]);

    const stats = screen.getByRole("table", { name: "Global fit per series" });
    const body = within(stats).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(body[0]).toContain("ALinear");
    expect(body[1]).toContain("BProportional");
    expect(screen.getByText(/joint fit: χ² 3 · AIC -4\.5 · BIC -5\.5/)).toBeInTheDocument();
    await waitFor(() => expect(useApp.getState().fitOverlay?.y).toEqual([1, 3, 5]));
  });

  it("shows the route's refusal when a model cannot honour a share", async () => {
    vi.mocked(globalFitJob).mockRejectedValue(
      new Error('cannot share "b": dataset 1 uses model "Proportional", which has no parameter "b"'),
    );
    await openGlobalWithBOnProportional();
    fireEvent.click(screen.getByLabelText("Share b across all series"));
    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));
    expect(await screen.findByText(/cannot share "b": dataset 1 uses model "Proportional"/)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Global fit parameters" })).toBeNull();
  });

  it("keeps today's single-model request when no series picks its own model", async () => {
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Global fit" }));
    await screen.findByLabelText("Fit A");
    fireEvent.click(screen.getByLabelText("Share b across all series"));
    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));
    await screen.findByRole("table", { name: "Global fit parameters" });
    const req = vi.mocked(globalFitJob).mock.calls[0]![0];
    expect(req.dataset_models).toBeUndefined();
    expect(req.model).toBe("Linear");
  });

  it("reports each series' model and reopens it from the saved workspace", async () => {
    vi.mocked(reportEmit).mockImplementation(async (req) => {
      const records = req.records as Record<string, unknown>[];
      const columns = Object.keys(records[0]!);
      return {
        report: {
          title: req.title ?? "",
          sections: [
            {
              title: "Results",
              blocks: [{ type: "table", columns, rows: records.map((r) => columns.map((c) => r[c] as number | string | null)) }],
            },
          ],
        },
      } as never;
    });
    await openGlobalWithBOnProportional();
    fireEvent.click(screen.getByLabelText("Share m across all series"));
    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));
    fireEvent.click(await screen.findByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));

    const sent = vi.mocked(reportEmit).mock.calls[0]![0];
    const records = sent.records as Record<string, unknown>[];
    expect(records.map((r) => r.model)).toEqual(["Linear", "Proportional"]);
    // One column set for every row: the report table takes its columns from the first row.
    expect(Object.keys(records[1]!)).toEqual(Object.keys(records[0]!));
    expect(records[1]!.b).toBeNull();
    expect(sent.caption).toContain("models: Linear, Proportional");

    const { datasets, reports } = useApp.getState();
    const reopened = parseWorkspace(serializeWorkspace({ datasets, reports }));
    const t = reopened.reports[0]!.report.sections[0]!.blocks[0]! as { type: string; columns: string[]; rows: unknown[][] };
    expect(t.type).toBe("table");
    const col = t.columns.indexOf("model");
    expect(t.rows.map((r) => r[col])).toEqual(["Linear", "Proportional"]);
  });
});
