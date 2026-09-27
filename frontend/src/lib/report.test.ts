// lib/report — schema guards + .dwk sanitizers for report sheets (#36).

import { describe, expect, it } from "vitest";

import {
  isReportSheet,
  pruneReportRefs,
  sanitizeReports,
  type ReportEntry,
  type ReportSheet,
} from "./report";
import { encodePersistedCells } from "./nonFiniteCells";

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

  it("accepts an object figure spec and rejects array/null impostors", () => {
    const withSpec = (spec: unknown) => ({
      title: "x", sections: [{ title: "Figures", blocks: [{ type: "figure", name: "f", spec }] }],
    });
    expect(isReportSheet(withSpec({ dataset: { time: [1], values: [[2]], labels: ["y"], units: [""] } }))).toBe(true);
    expect(isReportSheet(withSpec([]))).toBe(false);
    expect(isReportSheet(withSpec(null))).toBe(false);
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

  it("decodes non-finite cells inside a persisted report figure spec", () => {
    const report = entry({
      report: {
        title: "Figure",
        sections: [{
          title: "Figures",
          blocks: [{
            type: "figure", name: "f",
            spec: {
              dataset: {
                time: [0, Number.NaN], values: [[Infinity, -Infinity, -0]],
                labels: ["y"], units: [""], metadata: {},
              },
            },
          }],
        }],
      },
    });
    const wire = JSON.parse(JSON.stringify([report], encodePersistedCells));
    const out = sanitizeReports(wire, new Set(["ds-1"]));
    const block = out[0].report.sections[0].blocks[0];
    if (block.type !== "figure") throw new Error("expected figure block");
    expect(block.spec?.dataset.time[1]).toBeNaN();
    expect(block.spec?.dataset.values[0][0]).toBe(Infinity);
    expect(block.spec?.dataset.values[0][1]).toBe(-Infinity);
    expect(Object.is(block.spec?.dataset.values[0][2], -0)).toBe(true);
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
