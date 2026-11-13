import { describe, expect, it } from "vitest";

import { originImportToast } from "./originFidelity";
import { bookLosses, worksheetSummaryLine } from "./originWorksheetFidelity";
import type { OriginFidelityManifest } from "./types";

const manifest = (worksheet?: OriginFidelityManifest["worksheet"]): OriginFidelityManifest => ({
  version: 1,
  container: "opju",
  status: "best_effort",
  graph_records_total: 5,
  graph_records_actionable: 3,
  graph_records_filtered: 2,
  omissions: [],
  filtered_figures: [],
  worksheet,
});

describe("worksheet fidelity wording", () => {
  it("summarizes complete, unverified and partial imports", () => {
    const base = { version: 1 as const, unverified_columns: 0, losses: [] };
    expect(worksheetSummaryLine({ ...base, status: "complete", columns_imported: 1 })).toBe(
      "Worksheets: all 1 column imported",
    );
    expect(
      worksheetSummaryLine({ ...base, status: "unverified", columns_imported: 4, unverified_columns: 4 }),
    ).toBe("Worksheets: 4 columns imported (4 from an older Origin format, read without a length check)");
    expect(
      worksheetSummaryLine({
        ...base,
        status: "partial",
        columns_imported: 12,
        losses: [
          { code: "columns_not_decoded", count: 3, examples: [] },
          { code: "matrices_not_imported", count: 1, examples: [] },
          { code: "something_new", count: 2, examples: [] },
        ],
      }),
    ).toBe(
      "Worksheets: 12 columns imported; 3 columns could not be read; 1 matrix was not imported (shape unknown); 2 something new",
    );
  });

  it("orders book losses, skips malformed entries", () => {
    const rows = bookLosses({
      grammar_only: { count: 1, columns: ["A"] },
      undecoded: { count: 2, columns: ["B", "C"] },
      bogus: "nope",
      empty: { count: 0, columns: [] },
    });
    expect(rows.map((r) => r.kind)).toEqual(["undecoded", "grammar_only"]);
    expect(bookLosses(null)).toEqual([]);
    expect(bookLosses(["x"])).toEqual([]);
  });

  it("the import toast leads with worksheet losses and stays a plain note otherwise", () => {
    expect(originImportToast("proj", manifest())).toEqual({
      msg: "proj: 3/5 Origin graph records are editable; fidelity details saved",
      kind: "info",
    });
    const lossy = originImportToast(
      "proj",
      manifest({
        version: 1,
        status: "partial",
        columns_imported: 9,
        unverified_columns: 0,
        losses: [
          { code: "columns_not_decoded", count: 2, examples: [] },
          { code: "complex_imaginary_omitted", count: 1, examples: [] },
        ],
      }),
    );
    expect(lossy).toEqual({
      msg: "proj: 3 worksheet items could not be imported. 3/5 Origin graph records are editable",
      kind: "danger",
    });
  });
});
