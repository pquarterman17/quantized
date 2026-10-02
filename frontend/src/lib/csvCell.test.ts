// CSV formula injection (security hardening, 2026-10-01). Exported CSVs carry
// dataset names and labels taken from imported files; a name such as
// `=HYPERLINK(...)` turns into a live formula in a spreadsheet. Every
// client-side CSV writer runs its TEXT cells through `csvTextCell` (OWASP:
// prefix `'` on a leading = + - @ tab CR). Numeric cells are never altered.

import { describe, expect, it } from "vitest";

import { csvTextCell, neutralizeFormula } from "./csvCell";
import { outputToCSV } from "./statsTestsResults";
import { waterfallToCSV } from "./waterfall";
import { batchIntegrateCsv, type BatchIntegrateRow } from "../components/workshops/peaks/batchIntegrate";
import { summaryToCsv } from "../components/workshops/roicuts/useRoiBatch";

const EVIL = '=HYPERLINK("http://evil.invalid","x")';

describe("neutralizeFormula / csvTextCell", () => {
  it.each([EVIL, "+SUM(A1)", "-2+3", "@SUM(1)", "\t=1", "\r=1", "-"])("prefixes %j", (text) => {
    expect(neutralizeFormula(text)).toBe(`'${text}`);
  });

  it.each(["-1.5", "+2", "-3e-4", "Moment", "T (K)", ""])("leaves %j untouched", (text) => {
    expect(neutralizeFormula(text)).toBe(text);
  });

  it("quotes after neutralizing", () => {
    expect(csvTextCell("=1,2")).toBe(`"'=1,2"`);
    expect(csvTextCell("plain")).toBe("plain");
  });
});

describe("client CSV writers", () => {
  it("waterfall escapes dataset labels and keeps negative numbers", () => {
    const csv = waterfallToCSV(
      [{ id: "a", label: "=evil", x: [1, 2], y: [-1.5, 2], range: 3.5 }],
      { spacing: 1, mode: "add", reverse: false },
      "M",
      false,
    );
    const [header, row1] = csv.split("\n");
    expect(header).toBe("'=evil x,'=evil M");
    expect(row1).toBe("1,-1.5");
  });

  it("waterfall leaves a plain label untouched", () => {
    const csv = waterfallToCSV(
      [{ id: "a", label: "run1", x: [1], y: [2], range: 0 }],
      { spacing: 1, mode: "add", reverse: false },
      "M",
      false,
    );
    expect(csv.split("\n")[0]).toBe("run1 x,run1 M");
  });

  it("stats tests escape text cells, never number cells", () => {
    const csv = outputToCSV({
      sentence: "result",
      tables: [{ columns: ["group", "mean"], rows: [["@grp", -1.5], ["-1.5", 2]] }],
    });
    const lines = csv.split("\n");
    expect(lines).toContain("'@grp,-1.5");
    expect(lines).toContain("-1.5,2");
  });

  it("ROI batch summary escapes the dataset name", () => {
    const stats = { integrated_intensity: -1.5, centroid_x: 0, centroid_y: 0, peak_x: 0, peak_y: 0, max_intensity: 0, n_points: 1 };
    const csv = summaryToCsv([{ name: EVIL, stats } as Parameters<typeof summaryToCsv>[0][number]]);
    const row = csv.split("\n")[1];
    expect(row.startsWith(`"'=HYPERLINK(`)).toBe(true);
    expect(row).toContain(",-1.5,");
  });

  it("peak batch-integrate escapes dataset and error text", () => {
    const row: BatchIntegrateRow = {
      dataset: "+evil", datasetId: "d", window: 1, lo: -1, hi: 1, status: "error", error: "-bad",
      area: -1.5, areaPct: null, centroid: null, fwhm: null, height: null, shiftX: null,
    };
    const line = batchIntegrateCsv([row]).split("\n")[1];
    expect(line.startsWith("'+evil,1,-1,1,error,-1.5,")).toBe(true);
    expect(line.endsWith(",'-bad")).toBe(true);
  });
});
