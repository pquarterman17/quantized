// lib/report — schema guards + .dwk sanitizers for report sheets (#36).

import { describe, expect, it } from "vitest";

import {
  isReportSheet,
  pruneReportRefs,
  sanitizeReports,
  type ReportEntry,
  type ReportSheet,
} from "./report";

const SHEET: ReportSheet = {
  title: "Curve fit",
  sections: [
    {
      title: "Fit results",
      blocks: [
        { type: "text", text: "Model: Linear" },
        {
          type: "params",
          params: [{ name: "slope", value: 2, error: 0.1 }],
          caption: "Fitted parameters",
        },
        {
          type: "table",
          columns: ["Metric", "Value"],
          rows: [["R²", 0.998]],
        },
        { type: "figure", name: "fig-1" },
      ],
    },
  ],
  source_refs: [{ kind: "dataset", id: "ds-1" }],
  created: "2026-07-07T00:00:00+00:00",
};

const entry = (over: Partial<ReportEntry> = {}): ReportEntry => ({
  id: "rep-1",
  name: "Curve fit",
  datasetId: "ds-1",
  report: SHEET,
  ...over,
});

describe("isReportSheet", () => {
  it("accepts a full emitted sheet", () => {
    expect(isReportSheet(SHEET)).toBe(true);
  });

  it("rejects non-objects, missing titles, and unknown block types", () => {
    expect(isReportSheet(null)).toBe(false);
    expect(isReportSheet({ sections: [] })).toBe(false);
    expect(
      isReportSheet({
        title: "x",
        sections: [{ title: "s", blocks: [{ type: "nope" }] }],
      }),
    ).toBe(false);
  });

  it("rejects a table whose row width disagrees with its columns", () => {
    expect(
      isReportSheet({
        title: "x",
        sections: [
          {
            title: "s",
            blocks: [{ type: "table", columns: ["a", "b"], rows: [[1]] }],
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("sanitizeReports", () => {
  it("round-trips valid entries and clamps dead dataset refs to null", () => {
    const out = sanitizeReports(
      [entry(), entry({ id: "rep-2", datasetId: "gone" })],
      new Set(["ds-1"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].datasetId).toBe("ds-1");
    expect(out[1].datasetId).toBeNull();
  });

  it("drops malformed entries (bad id, invalid sheet) and non-arrays", () => {
    expect(sanitizeReports("nope", new Set())).toEqual([]);
    const out = sanitizeReports(
      [{ id: 7, name: "x", report: SHEET }, { id: "ok", name: "x", report: { bad: 1 } }, entry()],
      new Set(["ds-1"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("rep-1");
  });

  // P3.6 migration guard: `spec` postdates persisted reports.
  it("keeps a valid figure spec, returning the SAME sheet object when nothing is stripped", () => {
    const withSpec: ReportSheet = {
      title: "F",
      sections: [{ title: "Figures", blocks: [{ type: "figure", name: "s", spec: { fmt: "svg" } }] }],
    };
    const out = sanitizeReports([entry({ report: withSpec })], new Set());
    expect(out[0].report).toBe(withSpec);
  });

  it("a report dropped as unreadable gets ONE 'dropped' warning, never a strip warning", () => {
    const warnings: string[] = [];
    const bad = {
      title: 7, // fails isReportSheet
      sections: [{ title: "F", blocks: [{ type: "figure", name: "n", spec: null }] }],
    };
    const out = sanitizeReports([{ id: "r", name: "Broken", datasetId: null, report: bad }], new Set(), warnings);
    expect(out).toEqual([]);
    expect(warnings).toEqual(['report "Broken" could not be read and was dropped']);
  });

  it("strips a null/array/scalar spec without mutating the input, with or without a warnings sink", () => {
    const raw = {
      title: "F",
      sections: [
        { title: "A", blocks: [{ type: "text", text: "kept as is" }] },
        { title: "B", blocks: [{ type: "figure", name: "n", spec: null }, { type: "figure", name: "a", spec: [] }] },
      ],
    };
    const frozen = JSON.stringify(raw);
    const warnings: string[] = [];
    const out = sanitizeReports([{ id: "r", name: "Figs", datasetId: null, report: raw }], new Set(), warnings);
    expect(out[0].report.sections[1].blocks).toEqual([
      { type: "figure", name: "n" },
      { type: "figure", name: "a" },
    ]);
    expect(out[0].report.sections[0]).toBe(raw.sections[0]);
    expect(JSON.stringify(raw)).toBe(frozen);
    expect(warnings).toHaveLength(2);
    // no sink: still strips, never throws
    expect(sanitizeReports([{ id: "r", name: "Figs", datasetId: null, report: raw }], new Set())[0].report.sections[1].blocks[0]).toEqual({ type: "figure", name: "n" });
  });
});

describe("pruneReportRefs", () => {
  it("nulls refs to removed datasets but keeps the reports", () => {
    const out = pruneReportRefs([entry()], new Set(["ds-1"]));
    expect(out).toHaveLength(1);
    expect(out[0].datasetId).toBeNull();
    expect(out[0].report.title).toBe("Curve fit");
  });

  it("leaves unrelated entries untouched (same reference)", () => {
    const e = entry();
    const out = pruneReportRefs([e], new Set(["other"]));
    expect(out[0]).toBe(e);
  });
});
