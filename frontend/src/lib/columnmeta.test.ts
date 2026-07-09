import { describe, expect, it } from "vitest";

import {
  columnMetaAt,
  columnMetaList,
  DESIGNATION_BADGE,
  hasOriginReportSheets,
  originTextColumns,
} from "./columnmeta";
import type { DataStruct } from "./types";

/** An Origin-shaped DataStruct carrying only the metadata columnmeta reads. */
function origin(
  names: string[],
  designations: Record<string, string> = {},
  comments: Record<string, string> = {},
): DataStruct {
  return {
    time: [0, 1],
    values: [names.map(() => 0), names.map(() => 0)],
    labels: [...names],
    units: names.map(() => ""),
    metadata: {
      origin_column_names: names,
      column_designations: designations,
      column_comments: comments,
    },
  };
}

const plain: DataStruct = {
  time: [0, 1],
  values: [
    [1, 2],
    [3, 4],
  ],
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
};

describe("columnMetaList", () => {
  it("is empty for non-Origin data (no origin_column_names)", () => {
    expect(columnMetaList(plain)).toEqual([]);
  });

  it("aligns short name, designation, and comment to each value-channel index", () => {
    const ds = origin(
      ["R++", "dR++"],
      { "R++": "Y", "dR++": "Y-error" },
      { "R++": "reflectivity, spin ++" },
    );
    const list = columnMetaList(ds);
    expect(list).toEqual([
      { shortName: "R++", designation: "Y", comment: "reflectivity, spin ++" },
      { shortName: "dR++", designation: "Y-error", comment: undefined },
    ]);
  });

  it("leaves designation undefined when a column has none decoded", () => {
    const ds = origin(["A", "B"], { A: "Y" }); // B has no designation entry
    expect(columnMetaList(ds)[1]?.designation).toBeUndefined();
  });

  it("leaves comment undefined for columns with no comment (the common case)", () => {
    const ds = origin(["A"], { A: "Y" }); // no column_comments entry for A
    expect(columnMetaList(ds)[0]?.comment).toBeUndefined();
  });

  it("ignores an unrecognized designation string defensively", () => {
    const ds = origin(["A"], { A: "not-a-real-designation" });
    expect(columnMetaList(ds)[0]?.designation).toBeUndefined();
  });

  it("tolerates a missing column_designations / column_comments object", () => {
    const ds: DataStruct = {
      ...plain,
      metadata: { origin_column_names: ["A", "B"] },
    };
    expect(columnMetaList(ds)).toEqual([
      { shortName: "A", designation: undefined, comment: undefined },
      { shortName: "B", designation: undefined, comment: undefined },
    ]);
  });
});

describe("columnMetaAt", () => {
  it("returns the metadata for a valid value-channel index", () => {
    const ds = origin(["A", "B"], { A: "X", B: "Y" });
    expect(columnMetaAt(ds, 1)?.designation).toBe("Y");
  });

  it("returns undefined for a negative index (the x column)", () => {
    const ds = origin(["A"], { A: "Y" });
    expect(columnMetaAt(ds, -1)).toBeUndefined();
  });

  it("returns undefined past the decoded columns (a computed formula column)", () => {
    const ds = origin(["A"], { A: "Y" });
    expect(columnMetaAt(ds, 5)).toBeUndefined();
  });

  it("returns undefined for non-Origin data", () => {
    expect(columnMetaAt(plain, 0)).toBeUndefined();
  });
});

describe("DESIGNATION_BADGE", () => {
  it("has a badge for every designation", () => {
    expect(DESIGNATION_BADGE).toEqual({
      X: "X",
      Y: "Y",
      "Y-error": "yEr",
      "X-error": "xEr",
      Label: "Label",
      Disregard: "Disregard",
    });
  });
});

describe("originTextColumns (item 8)", () => {
  it("is empty when the metadata carries no text columns", () => {
    expect(originTextColumns(plain)).toEqual([]);
  });

  it("reads short name + row strings, sorted by Origin short-name order", () => {
    const ds: DataStruct = {
      ...plain,
      metadata: { origin_text_columns: { B: ["hi", "lo"], A: ["x", "y"] } },
    };
    expect(originTextColumns(ds)).toEqual([
      { shortName: "A", rows: ["x", "y"] },
      { shortName: "B", rows: ["hi", "lo"] },
    ]);
  });

  it("a text-only book has text columns longer than the (empty) numeric row count", () => {
    const ds: DataStruct = {
      time: [],
      values: [],
      labels: [],
      units: [],
      metadata: { origin_text_columns: { A: ["NaN", "NaN", "NaN"] } },
    };
    expect(originTextColumns(ds)[0].rows).toHaveLength(3);
  });

  it("ignores a malformed origin_text_columns value defensively", () => {
    const ds: DataStruct = { ...plain, metadata: { origin_text_columns: "not an object" } };
    expect(originTextColumns(ds)).toEqual([]);
  });
});

describe("hasOriginReportSheets (item 8)", () => {
  it("is false when the metadata carries no report sheets", () => {
    expect(hasOriginReportSheets(plain)).toBe(false);
  });

  it("is false for an empty report-sheets object", () => {
    expect(hasOriginReportSheets({ ...plain, metadata: { origin_report_sheets: {} } })).toBe(false);
  });

  it("is true when at least one report-sheet column is present", () => {
    const ds: DataStruct = { ...plain, metadata: { origin_report_sheets: { C: ["cell://Notes.Equation"] } } };
    expect(hasOriginReportSheets(ds)).toBe(true);
  });
});
