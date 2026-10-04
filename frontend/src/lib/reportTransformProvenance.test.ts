import { describe, expect, it } from "vitest";

import type { ReportSheet } from "./report";
import {
  REPORT_TRANSFORM_PROVENANCE_KEY,
  REPORT_TRANSFORM_PROVENANCE_TRUNCATED_KEY,
  reportTransformProvenance,
  reportTransformProvenanceWasTruncated,
  stampReportTransformProvenance,
} from "./reportTransformProvenance";
import type { Dataset } from "./types";

const transformed: Dataset = {
  id: "derived", name: "derived",
  data: {
    time: [0], values: [[1]], labels: ["y"], units: [""],
    metadata: { transform_recipe: { recipe: "Normalize", revision: 2, input: { id: "raw", name: "raw.dat" }, bindings: [], steps: 1, appliedAt: "now" } },
  },
};

describe("report transform provenance", () => {
  it("snapshots transformed dataset lineage without mutating the report", () => {
    const report: ReportSheet = {
      title: "Result", sections: [],
      source_refs: [{ kind: "dataset", id: "derived", name: "derived" }],
      meta: { producer: "fit" },
    };
    const stamped = stampReportTransformProvenance(report, [transformed]);

    expect(stamped).not.toBe(report);
    expect(report.meta).toEqual({ producer: "fit" });
    expect(stamped.meta?.producer).toBe("fit");
    expect(reportTransformProvenance(stamped)).toMatchObject([{
      recipe: "Normalize", revision: 2, input: { id: "raw", name: "raw.dat" },
    }]);
  });

  it("uses the report entry's dataset fallback and deduplicates an existing snapshot", () => {
    const once = stampReportTransformProvenance({ title: "R", sections: [] }, [transformed], "derived");
    const twice = stampReportTransformProvenance(once, [transformed], "derived");
    expect(twice.meta?.[REPORT_TRANSFORM_PROVENANCE_KEY]).toHaveLength(1);
  });

  it("returns the original object when no source has transformation provenance", () => {
    const report: ReportSheet = { title: "Plain", sections: [] };
    expect(stampReportTransformProvenance(report, [transformed])).toBe(report);
  });

  it("caps persisted lineage and keeps an explicit truncation disclosure", () => {
    const report: ReportSheet = {
      title: "Many sources",
      sections: [],
      meta: {
        [REPORT_TRANSFORM_PROVENANCE_KEY]: Array.from({ length: 65 }, (_, index) => ({
          recipe: `Recipe ${index + 1}`,
          revision: 1,
        })),
      },
    };

    const stamped = stampReportTransformProvenance(report, [transformed], "derived");
    expect(reportTransformProvenance(stamped)).toHaveLength(64);
    expect(reportTransformProvenanceWasTruncated(stamped)).toBe(true);
    expect(stamped.meta?.[REPORT_TRANSFORM_PROVENANCE_TRUNCATED_KEY]).toBe(true);
  });
});
