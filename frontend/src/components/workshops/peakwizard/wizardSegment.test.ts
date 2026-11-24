import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { wizardSegment } from "./wizardSegment";

const n = 10;
const rows = Array.from({ length: n }, (_v, i) => i);
const sheet = (over: Partial<Dataset> = {}, y: number[] = rows.map((i) => i * 2)): Dataset => ({
  id: "d", name: "scan.dat",
  data: { time: rows, values: y.map((v) => [v]), labels: ["I"], units: ["A"], metadata: { x_column_name: "2theta", x_column_unit: "deg" } },
  ...over,
});

describe("wizardSegment input line", () => {
  it("states rows used of total, the fit range and the dropped rows", () => {
    const y = rows.map((i) => (i === 5 ? Number.NaN : i * 2));
    const { segment, line } = wizardSegment(sheet({ excludedRows: [0] }, y), null, null, null, 2, 8);
    expect(segment?.x).toEqual([2, 3, 4, 6, 7, 8]);
    expect(line?.refusal).toBeNull();
    expect(line?.note).toBe(
      "Excluded and filtered-out rows are left out (1 excluded row, 0 filtered-out rows). Selected rows are not used. The plot X range is not applied; the fit range is.",
    );
    expect(line?.text).toBe(
      "Input: scan.dat · X: 2theta (deg) · Y: I (A) · 6 of 10 rows · fit range 2–8 · 1 row with gaps dropped",
    );
  });

  it("omits the range and drops clauses that do not apply", () => {
    const { line } = wizardSegment(sheet(), null, null, null, null, null);
    expect(line?.text).toBe("Input: scan.dat · X: 2theta (deg) · Y: I (A) · 10 of 10 rows");
    expect(line?.note).toMatch(/left out \(none at present\)\./);
  });

  it("counts excluded and filtered-out rows separately, an overlap once", () => {
    const both = sheet({ excludedRows: [1, 8], filter: [{ col: -1, kind: "range", max: 7.5 }] });
    const { line } = wizardSegment(both, null, null, null, null, null);
    expect(line?.text).toContain("7 of 10 rows");
    expect(line?.note).toContain("(2 excluded rows, 1 filtered-out row)");
  });

  it("names an open bound", () => {
    expect(wizardSegment(sheet(), null, null, null, 3, null).line?.text).toMatch(/fit range 3–end$/);
  });

  it("shows the resolver's refusal and no segment", () => {
    const lazy = sheet({ pending: { kind: "upload", bookId: "b", rows: n, cols: 1, previewSampled: true } });
    const r = wizardSegment(lazy, null, null, null, null, null);
    expect(r.segment).toBeNull();
    expect(r.line?.refusal).toMatch(/still loading/);
    expect(r.line?.text).toMatch(/^Input: scan\.dat · The full worksheet is still loading/);
    const none = wizardSegment(sheet({ excludedRows: rows }), null, null, null, null, null);
    expect(none.segment).toBeNull();
    expect(none.line?.refusal).toMatch(/No rows remain/);
  });

  it("refuses a fit range that holds no finite rows", () => {
    const r = wizardSegment(sheet(), null, null, null, 100, 200);
    expect(r.segment?.x).toEqual([]);
    expect(r.line?.refusal).toBe("No finite rows fall inside the fit range.");
  });

  it("has no line without a worksheet", () => {
    expect(wizardSegment(null, null, null, null, null, null)).toEqual({ segment: null, line: null });
  });
});
