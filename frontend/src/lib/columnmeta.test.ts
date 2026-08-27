import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  columnMetaAt,
  columnMetaList,
  DESIGNATION_BADGE,
  hasOriginReportSheets,
  ORIGIN_DESIGNATIONS,
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
      label: "Label",
      disregard: "Disregard",
      Z: "Z",
    });
  });

  it("has exactly one badge per ORIGIN_DESIGNATIONS entry (no missing/stray keys)", () => {
    expect(Object.keys(DESIGNATION_BADGE).sort()).toEqual([...ORIGIN_DESIGNATIONS].sort());
  });
});

// Booked finding: the backend emits lowercase "label"/"disregard" and a "Z"
// designation (src/quantized/io/origin_project/windows.py's `_DESIGNATION`
// enum) that this module's set never accepted — every such column silently
// parsed to `designation: undefined`, which (for a book designated ENTIRELY
// out of these three) made lib/originBookRoles.ts's "no usable designation
// info at all" guard misfire and fall back to the label-name guesser instead
// of Origin's own authoritative answer.
describe("columnMetaList — the full backend designation set (booked finding)", () => {
  it.each(["label", "disregard", "Z"] as const)("parses a %s-designated column, not undefined", (raw) => {
    const ds = origin(["A"], { A: raw });
    expect(columnMetaList(ds)[0]?.designation).toBe(raw);
  });

  it("does NOT parse the old (wrong) capitalized 'Label'/'Disregard' spellings", () => {
    const ds = origin(["A", "B"], { A: "Label", B: "Disregard" });
    expect(columnMetaList(ds)[0]?.designation).toBeUndefined();
    expect(columnMetaList(ds)[1]?.designation).toBeUndefined();
  });
});

// Pins frontend/backend agreement on the designation SET itself, so a future
// change to either side's enum (e.g. windows.py growing an 8th designation)
// fails a test instead of silently drifting — derived from ONE shared
// fixture (tests/fixtures/wire/origin_designations.json) rather than two
// hand-typed lists; tests/test_io_origin_project.py pins the Python side of
// the same fixture against `windows._DESIGNATION`.
describe("ORIGIN_DESIGNATIONS — frontend/backend parity (shared fixture)", () => {
  it("matches the backend's windows.py _DESIGNATION value set exactly", () => {
    const fixturePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../tests/fixtures/wire/origin_designations.json",
    );
    const backendSet: string[] = JSON.parse(readFileSync(fixturePath, "utf-8"));
    expect([...ORIGIN_DESIGNATIONS].sort()).toEqual([...backendSet].sort());
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

describe("generic query text columns", () => {
  it("renders database text metadata through the worksheet text-column path", () => {
    const ds: DataStruct = { ...plain, metadata: { text_columns: { sample: ["A", "B", "C"] } } };
    expect(originTextColumns(ds)).toEqual([{ shortName: "sample", rows: ["A", "B", "C"] }]);
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
