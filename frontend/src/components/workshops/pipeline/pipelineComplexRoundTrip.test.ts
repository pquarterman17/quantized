// A worksheet with complex-number formulas, exported as a script (plan item 33,
// contract C1-C6): the app's cells and the headless script's cells are the same.
// One recorded pipeline (import, then four formula columns that build complex
// values inside an expression) is replayed by the real `executeSteps`; its
// worksheet and the exported script are pinned in
// tests/fixtures/wire/pipeline_complex_round_trip.json, and
// tests/test_pipeline_complex_round_trip.py runs the script on the same CSV
// and compares it with the app's worksheet.
// Rewrite with `QZ_WRITE_FIXTURES=1 npx vitest run <this file>`.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../lib/formulaRefs"; // the lazy complex evaluator (contract C9)
import { makeStep, pipelineToPython, type PipelineStep } from "../../../lib/pipeline";
import { useApp } from "../../../store/useApp";
import { executeSteps } from "./executeSteps";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const FIXTURE = join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "wire", "pipeline_complex_round_trip.json");
const CSV = "f,R,X\n" + [10, 100, 1000, 1e4, 1e5].map((f, i) => `${f},${50 + 5 * i},${-20 + 7 * i}`).join("\n") + "\n";

const fromCsv = (text: string) => {
  const [head, ...rows] = text.trim().split("\n");
  const cells = rows.map((r) => r.split(",").map(Number));
  const labels = head.split(",").slice(1);
  return { time: cells.map((r) => r[0]), values: cells.map((r) => r.slice(1)), labels, units: labels.map(() => ""), metadata: {} };
};

const expr = (name: string, e: string) => makeStep("expression", `Add column ${name}`, "", { name, expr: e });
const STEPS: PipelineStep[] = [
  makeStep("import", "Import z.csv", 'qz.import("z.csv")', { name: "z.csv" }),
  expr("mag", "abs(complex(A, B))"),
  expr("phase", "degrees(arg(complex(A, B)))"),
  expr("lowpass", "abs(1 / (1 + 2i * pi * x * 1e-5 * A))"),
  expr("rot_re", "re(complex(A, B) * exp(complex(0, x / 1e4)) ^ 2)"),
  expr("rot_im", "im(complex(A, B) * exp(complex(0, x / 1e4)) ^ 2) + D * 0"),
  expr("blank", "complex(A, B)"), // a complex RESULT: blank in the app, blank in the script
];

beforeEach(() => {
  useApp.setState({ datasets: [{ id: "in", name: "z.csv", data: fromCsv(CSV) }], folders: [], activeId: "in", selectedIds: ["in"], macroRecording: false, macroSteps: [], pipelineRunning: false });
});

describe("complex formulas: app cells vs exported script", () => {
  it("pins the app's worksheet and the script for tests/test_pipeline_complex_round_trip.py", async () => {
    const run = await executeSteps(STEPS, "in");
    expect(Object.values(run.log).map((l) => l.status)).toEqual(["skipped", "ok", "ok", "ok", "ok", "ok", "ok"]);
    const out = useApp.getState().datasets.find((d) => d.id === run.target)!.data;
    expect(out.labels).toEqual(["R", "X", "mag", "phase", "lowpass", "rot_re", "rot_im", "blank"]);
    expect(out.values.every((r) => Number.isNaN(r[7]))).toBe(true); // the complex-result column is blank
    expect(out.values.every((r) => r.slice(2, 7).every(Number.isFinite))).toBe(true);
    const script = pipelineToPython(STEPS);
    expect(script).not.toContain("NOT REPRODUCED");
    const wire = (v: number) => (Number.isNaN(v) ? "NaN" : v);
    const fixture = { csv: CSV, app: { time: out.time, values: out.values.map((r) => r.map(wire)), labels: out.labels }, script };
    const text = JSON.stringify(fixture, null, 1) + "\n";
    if (process.env.QZ_WRITE_FIXTURES === "1") writeFileSync(FIXTURE, text);
    expect(text).toBe(readFileSync(FIXTURE, "utf8"));
  });
});
