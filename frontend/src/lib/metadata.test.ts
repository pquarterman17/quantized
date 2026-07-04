import { describe, expect, it } from "vitest";

import { formatMetaValue, metadataRows, metadataToTSV } from "./metadata";

describe("formatMetaValue", () => {
  it("passes scalars through", () => {
    expect(formatMetaValue("VSM")).toBe("VSM");
    expect(formatMetaValue(300)).toBe("300");
    expect(formatMetaValue(true)).toBe("true");
  });

  it("renders null/undefined as a dash", () => {
    expect(formatMetaValue(null)).toBe("—");
    expect(formatMetaValue(undefined)).toBe("—");
  });

  it("renders objects/arrays as compact JSON", () => {
    expect(formatMetaValue({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    expect(formatMetaValue([1, 2, 3])).toBe("[1,2,3]");
  });
});

describe("metadataRows", () => {
  it("returns sorted key/value rows", () => {
    const rows = metadataRows({ temperature: "300 K", sample: "Fe3O4", field: "1 T" });
    expect(rows.map(([k]) => k)).toEqual(["field", "sample", "temperature"]);
    expect(rows).toContainEqual(["sample", "Fe3O4"]);
  });

  it("hides the internal plot-x hint keys", () => {
    const rows = metadataRows({ x_column_name: "T", x_column_unit: "K", sample: "Si" });
    expect(rows.map(([k]) => k)).toEqual(["sample"]);
  });

  it("hides the Origin provenance keys (they have a dedicated card)", () => {
    const rows = metadataRows({
      origin_results_log: "log text",
      origin_results_log_records: [{ timestamp: "t", operation: "op", params: {} }],
      origin_notes: { Notes1: "hello" },
      origin_report_sheets: { B: ["cell://Parameters.Slope.Value"] },
      origin_text_columns: { C: ["NaN", "NaN"] },
      sample: "Si",
    });
    expect(rows.map(([k]) => k)).toEqual(["sample"]);
  });

  it("is empty for an empty metadata dict", () => {
    expect(metadataRows({})).toEqual([]);
  });
});

describe("metadataToTSV", () => {
  it("emits key\\tvalue lines in sorted order", () => {
    const tsv = metadataToTSV({ b: 2, a: 1 });
    expect(tsv).toBe("a\t1\nb\t2");
  });
});
