// Columns added through Set Column Values (the dialog's real Add column button and its
// complex-parts button), exported as a script (plan item 33): the app's cells and units and
// the headless script's are the same. The columns are recorded as the dialog records them
// (`derived: true`, with the unit the app computed), the recorded steps go through the real
// `pipelineToPython`, and the app's worksheet and the script are pinned in
// tests/fixtures/wire/pipeline_derived_round_trip.json, which
// tests/test_pipeline_derived_round_trip.py runs headless on the same CSV.
// Rewrite with `QZ_WRITE_FIXTURES=1 npx vitest run <this file>`.
//
// Also: a propagated column is refused by the exporter, with its reason.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../../lib/formulaRefs"; // the lazy complex evaluator (contract C9)
import { COMPLEX_SPLIT_LABEL } from "../../../lib/formulaComplexNames";
import { makeStep, pipelineToPython, type PipelineStep } from "../../../lib/pipeline";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SetColumnValuesDialog from "./SetColumnValuesDialog";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const FIXTURE = join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "wire", "pipeline_derived_round_trip.json");
const CSV = "f,R,X\n" + [10, 100, 1000, 1e4, 1e5].map((f, i) => `${f},${50 + 5 * i},${-20 + 7 * i}`).join("\n") + "\n";

const book = (): Dataset => {
  const [head, ...rows] = CSV.trim().split("\n");
  const cells = rows.map((r) => r.split(",").map(Number));
  return {
    id: "in",
    name: "z.csv",
    data: { time: cells.map((r) => r[0]), values: cells.map((r) => r.slice(1)), labels: head.split(",").slice(1), units: ["Ω", "Ω"], metadata: { xUnit: "Hz" } },
  };
};
const st = () => useApp.getState();
const ds = () => st().datasets.find((d) => d.id === "in")!;
const IMPORT = makeStep("import", "Import z.csv", 'qz.import("z.csv")', { name: "z.csv" });

/** The real entry point: type a name and a formula, press Add column (or the complex-parts button). */
async function addThroughDialog(name: string, expr: string, opts: { parts?: boolean; propagate?: boolean } = {}) {
  const user = userEvent.setup();
  const before = ds().formulas?.length ?? 0;
  const view = render(<SetColumnValuesDialog ds={ds()} target={{ kind: "new" }} xName="f" onClose={() => undefined} />);
  await screen.findByRole("dialog");
  await user.type(screen.getByLabelText("Column name"), name);
  fireEvent.change(screen.getByLabelText(/=$/), { target: { value: expr } });
  if (opts.propagate) await user.click(screen.getByRole("checkbox"));
  const button = opts.parts ? await screen.findByRole("button", { name: COMPLEX_SPLIT_LABEL }) : await screen.findByRole("button", { name: "Add column" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await waitFor(() => expect(ds().formulas?.length).toBe(before + (opts.parts ? 2 : opts.propagate ? 2 : 1)));
  view.unmount();
}

beforeEach(() => {
  useApp.setState({ datasets: [book()], folders: [], activeId: "in", selectedIds: ["in"], history: [], future: [], macroRecording: true, macroSteps: [], pipelineRunning: false, status: "" });
});

const REAL = [
  ["dbl", "2 * A"],
  ["rate", "A / x"],
  ["reA", "re(A)"], // the part functions of a real column: the app's values, not a refusal
  ["imA", "im(A)"],
  ["cjB", "conj(B)"],
  ["absB", "abs(B)"],
  ["argB", "arg(B)"], // 0 or pi by sign (B changes sign down the rows)
  ["mag", "abs(complex(A, B))"],
  ["bad", "A + x"], // ohm + Hz: added WITHOUT a unit
] as const;

describe("a column added through Set Column Values, exported as a script", () => {
  it("reproduces every cell and unit (real, part-of-real and complex formulas); pins the fixture", async () => {
    for (const [name, expr] of REAL) await addThroughDialog(name, expr);
    await addThroughDialog("Z", "complex(A, B) * exp(complex(0, x / 1e4))", { parts: true });
    const recorded = st().macroSteps;
    expect(recorded.map((s) => s.params.derived)).toEqual(Array(REAL.length + 2).fill(true));
    const steps: PipelineStep[] = [IMPORT, ...recorded];
    const script = pipelineToPython(steps);
    expect(script).not.toContain("NOT REPRODUCED");
    // The app's own units travel with the formulas.
    const out = ds().data;
    const unitOf = (n: string) => out.units[out.labels.indexOf(n)];
    expect(unitOf("dbl")).toBe("Ω");
    expect(unitOf("rate")).not.toBe("");
    expect(unitOf("bad")).toBe("");
    expect(script).toContain('"unit": "Ω"');
    expect(script).toContain("WITHOUT a unit");
    const wire = (v: number) => (Number.isNaN(v) ? "NaN" : v);
    const added = out.labels.slice(2);
    const fixture = {
      csv: CSV,
      app: { time: out.time, labels: out.labels, units: out.units, values: out.values.map((r) => r.map(wire)), added },
      script,
    };
    expect(out.values.every((r) => r.every((v) => Number.isFinite(v)))).toBe(true);
    const text = JSON.stringify(fixture, null, 1) + "\n";
    if (process.env.QZ_WRITE_FIXTURES === "1") writeFileSync(FIXTURE, text);
    expect(text).toBe(readFileSync(FIXTURE, "utf8"));
  });

  it("keeps a propagated column out of the script, with its reason", async () => {
    const book0 = book();
    useApp.setState({
      datasets: [
        {
          ...book0,
          data: { ...book0.data, labels: ["R", "X", "dR"], units: ["Ω", "Ω", "Ω"], values: book0.data.values.map((r) => [...r, 1]) },
          errorRoles: [{ channel: 2, target: 0, axis: "y", side: "both" }],
        },
      ],
    });
    await addThroughDialog("twice", "2 * A", { propagate: true });
    const step = st().macroSteps[0];
    expect(step.params.propagate).toBe(true);
    const script = pipelineToPython([IMPORT, step]);
    expect(script).toContain("NOT REPRODUCED: derived column: its propagated error column is evaluated only in the app");
    expect(script).not.toContain("add_formula_columns");
  });
});
