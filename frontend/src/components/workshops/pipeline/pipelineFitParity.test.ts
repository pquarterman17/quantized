// "Run pipeline" in the app and the exported Python script fit the SAME thing
// (gap audit 4 lane E re-review, M2). One recorded pipeline — an import and a
// Gaussian fit with user starts, bounds and a HELD σ — goes through:
//   1. the app's replay (`executeSteps`), capturing the request it sends to
//      POST /api/fitting/fit;
//   2. the exporter (`pipelineToPython`).
// Both, plus the data as a CSV, are pinned in `__fixtures__/pipelineFitParity
// .json`; tests/test_pipeline_fit_parity.py runs the script AND posts the
// app's request to the real endpoint, and requires the same parameters.
// Rewrite with `QZ_WRITE_FIXTURES=1 npx vitest run <this file>`.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep, pipelineToPython, type PipelineStep } from "../../../lib/pipeline";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { executeSteps } from "./executeSteps";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));

import { fitModel } from "../../../lib/api";

const FIXTURE = join(__dirname, "..", "..", "..", "lib", "__fixtures__", "pipelineFitParity.json");

// A peak on a sloped baseline, exact in binary (x on a 0.25 grid).
const X = Array.from({ length: 41 }, (_, i) => i * 0.25);
const Y = X.map((x) => Math.round((3 + 0.4 * x + 50 * Math.exp(-0.5 * ((x - 4.6) / 0.9) ** 2)) * 1e6) / 1e6);
const DATA: DataStruct = {
  time: X,
  values: Y.map((y) => [y]),
  labels: ["signal"],
  units: [""],
  metadata: {},
};
const CSV = ["x,signal", ...X.map((x, i) => `${x},${Y[i]}`)].join("\n") + "\n";

const STEPS: PipelineStep[] = [
  makeStep("import", "Import peak.csv", 'qz.import("peak.csv")', { name: "peak.csv" }),
  makeStep("fit", "Fit Gaussian", 'qz.fit("Gaussian")', {
    model: "Gaussian", p0: [45, 4.5, 0.6], yKey: 0, xKey: null,
    lower: [0, null, 0.05], upper: [null, null, 5], fixed: [false, false, true], statsVersion: 2,
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fitModel).mockResolvedValue({ params: [1, 2, 3], R2: 0.9 });
  useApp.setState({
    datasets: [{ id: "a", name: "peak.csv", data: DATA }],
    activeId: "a", xKey: null, yKeys: null, seriesOrder: null,
  });
});

describe("Run pipeline and the exported script", () => {
  it("send the recorded starts, bounds and held flags (pinned for the Python run)", async () => {
    await executeSteps(STEPS, "a");
    const request = vi.mocked(fitModel).mock.calls[0][0];
    expect(request).toMatchObject({ p0: [45, 4.5, 0.6], lower: [0, null, 0.05], upper: [null, null, 5], fixed: [false, false, true] });
    const fixture = { csv: CSV, request, script: pipelineToPython(STEPS) };
    const text = JSON.stringify(fixture, null, 1) + "\n";
    if (process.env.QZ_WRITE_FIXTURES === "1") writeFileSync(FIXTURE, text);
    expect(text).toBe(readFileSync(FIXTURE, "utf8"));
  });

  it("sends no held flags when none is held, as the interactive fit does", async () => {
    const free = makeStep("fit", "Fit", "", { ...STEPS[1].params, fixed: [false, false, false] });
    await executeSteps([free], "a");
    expect(vi.mocked(fitModel).mock.calls[0][0]).not.toHaveProperty("fixed");
  });
});
