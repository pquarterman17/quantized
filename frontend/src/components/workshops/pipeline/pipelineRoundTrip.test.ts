// The app's pipeline, its exported script and `qz run` give the SAME numbers
// (gap audit 5 #6). One recorded pipeline — import, a median filter (sigop
// transform), a formula column, corrections with a background subtraction, a
// second formula reading the first — is replayed here by the real
// `executeSteps` (store, formula evaluator, recompute-after-correction). Its
// two backend calls are answered from `__fixtures__/pipelineRoundTripBackend
// .json`, which tests/test_pipeline_round_trip.py writes from the real
// endpoints and re-checks. The app's final worksheet, the requests it sent, the
// exported script and the saved template are pinned in
// `__fixtures__/pipelineRoundTrip.json`; the Python test runs the script and
// `qz run` on the same CSVs and requires the app's worksheet.
// Rewrite with `QZ_WRITE_FIXTURES=1 npx vitest run <this file>` (after the
// Python side, when the backend file changed).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep, pipelineToPython, type PipelineStep } from "../../../lib/pipeline";
import { serializeTemplate, toTemplate } from "../../../lib/template";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { executeSteps } from "./executeSteps";

const FIX = join(__dirname, "..", "..", "..", "lib", "__fixtures__");
const BACKEND = JSON.parse(readFileSync(join(FIX, "pipelineRoundTripBackend.json"), "utf8")) as {
  csv: string;
  bgCsv: string;
  sigop: DataStruct;
  corrected: DataStruct;
};
const sent: { sigop?: unknown; corrections?: unknown } = {};

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  applyCorrections: vi.fn(async (req: unknown) => {
    sent.corrections = structuredClone(req);
    return structuredClone(BACKEND.corrected);
  }),
}));
vi.mock("../../../lib/api/sigop", () => ({
  sigopDataset: vi.fn(async (body: { dataset: DataStruct }) => {
    sent.sigop = structuredClone(body);
    return { dataset: structuredClone(BACKEND.sigop), warnings: [], flagged: {}, rows_in: body.dataset.time.length, rows_out: BACKEND.sigop.time.length };
  }),
}));

/** A plain numeric CSV (header row of names) as the app's import gives it. */
function fromCsv(text: string): DataStruct {
  const [head, ...rows] = text.trim().split("\n");
  const cells = rows.map((r) => r.split(",").map(Number));
  const labels = head.split(",").slice(1);
  return { time: cells.map((r) => r[0]), values: cells.map((r) => r.slice(1)), labels, units: labels.map(() => ""), metadata: {} };
}

const STEPS: PipelineStep[] = [
  makeStep("import", "Import data.csv", 'qz.import("data.csv")', { name: "data.csv" }),
  makeStep("transform", "Median filter · data.csv", "", { op: "sigop", method: "median", channels: [0, 1], args: { window: 3 } }),
  makeStep("expression", "Add column ratio", "", { name: "ratio", expr: "A / B + x" }),
  makeStep("correction", "Corrections → data", "", { params: { yOff: 0.5, yScale: 2 }, bg: { datasetId: "bg", interp: "linear" } }),
  makeStep("expression", "Add column sq", "", { name: "sq", expr: "C^2 - sqrt(abs(A))" }),
];

beforeEach(() => {
  useApp.setState({
    datasets: [
      { id: "in", name: "data.csv", data: fromCsv(BACKEND.csv) },
      { id: "bg", name: "bg.csv", data: fromCsv(BACKEND.bgCsv) },
    ],
    folders: [],
    activeId: "in",
    selectedIds: ["in"],
    macroRecording: false,
    macroSteps: [],
    pipelineRunning: false,
  });
});

describe("app pipeline vs exported script vs qz run", () => {
  it("pins the app's worksheet for tests/test_pipeline_round_trip.py", async () => {
    const run = await executeSteps(STEPS, "in");
    expect(Object.values(run.log).map((l) => l.status)).toEqual(["skipped", "ok", "ok", "ok", "ok"]);
    const out = useApp.getState().datasets.find((d) => d.id === run.target)!.data;
    expect(out.labels).toEqual([...BACKEND.corrected.labels, "ratio", "sq"]);
    const script = pipelineToPython(STEPS);
    expect(script).not.toContain("NOT REPRODUCED");
    const fixture = {
      csv: BACKEND.csv,
      bgCsv: BACKEND.bgCsv,
      app: { time: out.time, values: out.values, labels: out.labels },
      requests: sent,
      script,
      template: serializeTemplate(toTemplate("Round trip", STEPS, [])),
    };
    const text = JSON.stringify(fixture, null, 1) + "\n";
    if (process.env.QZ_WRITE_FIXTURES === "1") writeFileSync(join(FIX, "pipelineRoundTrip.json"), text);
    expect(text).toBe(readFileSync(join(FIX, "pipelineRoundTrip.json"), "utf8"));
  });
});
