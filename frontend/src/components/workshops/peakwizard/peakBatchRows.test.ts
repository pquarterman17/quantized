// The batch result table (audit P2.4 slice 4), pure: merge of preparations +
// job rows, one row per (dataset, peak), null-stderr reasons, the honest
// objective label (SSR vs χ²), bound / undetermined flags, sorting, the CSV,
// and the derived dataset's provenance — including that it survives a
// workspace save + reopen (the persistence path).

import { describe, expect, it } from "vitest";

import type { PeakBatchFit, PeakBatchResult } from "../../../lib/api/peakBatch";
import { parseWorkspace } from "../../../lib/workspace";
import { serializeWorkspace } from "../../../lib/workspaceSerialize";
import { modelFitResponse } from "./modelFit.testkit";
import {
  batchCsv,
  batchDataStruct,
  batchTableRows,
  mergeBatch,
  sortRows,
  type PrepOutcome,
} from "./peakBatchRows";

function fit(over: Parameters<typeof modelFitResponse>[0] = {}): PeakBatchFit {
  const { curves: _c, correlation: _r, ...rest } = modelFitResponse(over);
  return rest;
}

const PREPS: PrepOutcome[] = [
  { datasetId: "d1", name: "scan A", ok: true, itemId: "i0", notes: ["2 gap rows in range were excluded"] },
  { datasetId: "d2", name: "scan B", ok: false, error: 'no column named "I"' },
  { datasetId: "d3", name: "scan C", ok: true, itemId: "i2", notes: [] },
  { datasetId: "d4", name: "scan D", ok: true, itemId: "i3", notes: [] },
];

const JOB: PeakBatchResult = {
  rows: [
    { id: "i0", status: "ok", error: null, fit: fit() },
    { id: "i2", status: "error", error: "p0.fwhm: min > max", fit: null },
    {
      id: "i3", status: "ok", error: null,
      fit: fit({ weighted: true, metrics: { objective: "chi2", chi2: 11.5, reduced_chi2: 1.2 } }),
    },
  ],
  n_items: 3, n_ok: 2, n_failed: 1, n_not_run: 0, stopped: null,
};

describe("mergeBatch + batchTableRows", () => {
  const results = mergeBatch(PREPS, JOB);
  const rows = batchTableRows(results);

  it("keeps every dataset in order: fitted ones per peak, failures as one row with the reason and stage", () => {
    expect(results.map((r) => [r.name, r.status, r.stage])).toEqual([
      ["scan A", "ok", null], ["scan B", "error", "prepare"], ["scan C", "error", "fit"], ["scan D", "ok", null],
    ]);
    expect(rows.map((r) => [r.dataset, r.peak, r.status])).toEqual([
      ["scan A", 1, "converged"], ["scan A", 2, "converged"],
      ["scan B", null, "error"], ["scan C", null, "error"],
      ["scan D", 1, "converged"], ["scan D", 2, "converged"],
    ]);
    expect(rows[2].error).toBe('no column named "I"');
    expect(rows[3].error).toBe("p0.fwhm: min > max");
  });

  it("a prepared dataset the job did not return is 'not run', never dropped", () => {
    const partial = mergeBatch(PREPS, { ...JOB, rows: JOB.rows.slice(1) });
    expect(partial[0]).toMatchObject({ status: "not_run", error: "no result was returned for this dataset" });
  });

  it("values carry their stderr, and a null stderr carries its reason", () => {
    const a1 = rows[0];
    expect(a1.shape).toBe("Pseudo-Voigt");
    expect(a1.center).toEqual({ value: 2.01, err: 0.004, reason: null });
    // p0's area depends on eta, which ended on a bound.
    expect(a1.area?.err).toBeNull();
    expect(a1.area?.reason).toMatch(/#1 η on a bound/);
    // p1's centre is fixed.
    expect(rows[1].center?.reason).toBe("fixed: every parameter it depends on is fixed");
  });

  it("labels the objective from metrics.objective — SSR unweighted, χ² only when weighted", () => {
    expect(rows[0]).toMatchObject({ objectiveLabel: "SSR", objective: 0.012, reducedObjective: 0.012, chi2: null });
    expect(rows[4]).toMatchObject({ objectiveLabel: "χ²", objective: 11.5, reducedObjective: 1.2, ssr: 0.012 });
  });

  it("flags this peak's (and the background's) at-bound and undetermined parameters", () => {
    expect(rows[0].atBound).toEqual(["#1 η"]);
    expect(rows[1].atBound).toEqual([]);
    const undetermined = batchTableRows(mergeBatch(PREPS.slice(0, 1), {
      ...JOB,
      rows: [{
        id: "i0", status: "ok", error: null,
        fit: fit({ parameters: fit().parameters.map((p) => (p.name === "p1.height" ? { ...p, stderr: null } : p)) }),
      }],
    }));
    expect(undetermined[1].undetermined).toEqual(["#2 height"]);
    expect(undetermined[0].undetermined).toEqual([]);
  });

  it("lists client notes before the fit's warnings", () => {
    expect(rows[0].warnings).toEqual([
      "2 gap rows in range were excluded",
      "parameters ended on a bound (errors not reported): p0.eta",
    ]);
  });

  it("a non-converged fit says so and reports no undetermined flags (nothing has errors)", () => {
    const r = batchTableRows(mergeBatch(PREPS.slice(0, 1), {
      ...JOB, rows: [{ id: "i0", status: "ok", error: null, fit: fit({ success: false }) }],
    }));
    expect(r[0].status).toBe("not converged");
    expect(r[0].undetermined).toEqual([]);
  });
});

describe("sortRows", () => {
  const rows = batchTableRows(mergeBatch(PREPS, JOB));
  it("sorts numerically either way with missing values always last", () => {
    const asc = sortRows(rows, "center", "asc").map((r) => [r.dataset, r.center?.value ?? null]);
    expect(asc).toEqual([
      ["scan A", 2.01], ["scan D", 2.01], ["scan A", 4], ["scan D", 4], ["scan B", null], ["scan C", null],
    ]);
    const desc = sortRows(rows, "center", "desc").map((r) => r.center?.value ?? null);
    expect(desc).toEqual([4, 4, 2.01, 2.01, null, null]);
  });
  it("sorts text and warning counts", () => {
    expect(sortRows(rows, "dataset", "desc")[0].dataset).toBe("scan D");
    expect(sortRows(rows, "warnings", "desc")[0].warnings).toHaveLength(2);
  });
});

describe("batchCsv", () => {
  const csv = batchCsv(batchTableRows(mergeBatch(PREPS, JOB)));
  const lines = csv.split("\n");
  const header = lines[0].split(",");
  const col = (line: string, name: string) => line.split(",")[header.indexOf(name)];

  it("has one line per row, quoted where needed, empty cells for missing numbers", () => {
    expect(lines).toHaveLength(7);
    expect(lines[3]).toContain('"no column named ""I"""');
    expect(col(lines[1], "center")).toBe("2.01");
    expect(col(lines[1], "center_stderr")).toBe("0.004");
    expect(col(lines[1], "area_stderr")).toBe("");
    expect(lines[1]).toContain("area: not available: #1 η on a bound");
  });

  it("writes SSR and χ² under their own names — χ² empty for an unweighted fit", () => {
    expect(col(lines[1], "objective")).toBe("ssr");
    expect(col(lines[1], "ssr")).toBe("0.012");
    expect(col(lines[1], "chi2")).toBe("");
    expect(col(lines[5], "objective")).toBe("chi2");
    expect(col(lines[5], "chi2")).toBe("11.5");
    expect(col(lines[5], "reduced_chi2")).toBe("1.2");
  });
});

describe("batchDataStruct (the library table)", () => {
  const rows = batchTableRows(mergeBatch(PREPS, JOB));
  const prov = {
    recipeName: "two peaks", recipe: { name: "two peaks", version: 2 },
    sources: PREPS.map((p) => ({ id: p.datasetId, name: p.name })), ranAt: "2026-09-25T12:00:00.000Z",
  };
  const data = batchDataStruct(rows, prov);

  it("numbers are channels (missing = NaN), text is text_columns, provenance names recipe + sources", () => {
    expect(data.values).toHaveLength(6);
    const at = (label: string) => data.labels.indexOf(label);
    expect(data.values[0][at("Center")]).toBe(2.01);
    expect(data.values[0][at("Area SE")]).toBeNaN();
    expect(data.values[0][at("χ²")]).toBeNaN();
    expect(data.values[4][at("χ²")]).toBe(11.5);
    const text = data.metadata.text_columns as Record<string, string[]>;
    expect(text.Dataset).toEqual(["scan A", "scan A", "scan B", "scan C", "scan D", "scan D"]);
    expect(text.Objective).toEqual(["SSR", "SSR", "", "", "χ²", "χ²"]);
    expect(text.Status[2]).toBe('error: no column named "I"');
    expect(data.metadata.source).toBe("peak-batch-fit");
    expect(data.metadata.peakBatch).toEqual(prov);
  });

  it("survives a workspace save and reopen", () => {
    const saved = serializeWorkspace({
      datasets: [{ id: "t1", name: "Peak batch — two peaks (4 datasets)", data }], activeId: "t1",
    });
    const back = parseWorkspace(saved).datasets[0];
    expect(back.data.metadata.peakBatch).toEqual(prov);
    expect((back.data.metadata.text_columns as Record<string, string[]>).Dataset).toHaveLength(6);
    expect(back.data.values[0][data.labels.indexOf("Area SE")]).toBeNaN();
    expect(back.data.values[0][data.labels.indexOf("Center")]).toBe(2.01);
  });
});
