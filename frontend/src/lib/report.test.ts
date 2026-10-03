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
    const wire = JSON.parse(JSON.stringify([report], encodePersistedCells)) as unknown[];
    const out = sanitizeReports(wire, new Set(["ds-1"]));
    const block = out[0].report.sections[0].blocks[0];
    if (block.type !== "figure") throw new Error("expected figure block");
    const dataset = block.spec?.dataset as { time: number[]; values: number[][] };
    expect(dataset.time[1]).toBeNaN();
    expect(dataset.values[0][0]).toBe(Infinity);
    expect(dataset.values[0][1]).toBe(-Infinity);
    expect(Object.is(dataset.values[0][2], -0)).toBe(true);
  });

  // Finding #5 (P3.6 review round 2): the old guard decoded `time`/`values`
  // only when the WHOLE dataset (including labels/units/metadata) was
  // well-formed, so a bad label left "NaN"/"Infinity"/… sentinel STRINGS
  // sitting in the plotted numbers with no warning at all.
  it("decodes time/values even when labels/units/metadata are malformed, and warns naming the report and figure", () => {
    const warnings: string[] = [];
    const report = entry({
      id: "rep-bad",
      name: "Odd figure",
      report: {
        title: "Figure",
        sections: [{
          title: "Figures",
          blocks: [{
            type: "figure", name: "f1",
            spec: {
              dataset: {
                // Encoded exactly like a real .dwk would (sentinel strings for
                // the non-finite cells), but `labels` is malformed (a number,
                // not a string) — the part that used to block ANY decoding.
                time: [0, "NaN"], values: [[1, "-Infinity"]],
                labels: [1], units: [""], metadata: {},
              },
            },
          }],
        }],
      },
    });
    const out = sanitizeReports([report], new Set(["ds-1"]), warnings);
    const block = out[0].report.sections[0].blocks[0];
    if (block.type !== "figure") throw new Error("expected figure block");
    const dataset = block.spec?.dataset as { time: number[]; values: number[][] };
    // time/values decoded despite the malformed labels field.
    expect(dataset.time[1]).toBeNaN();
    expect(dataset.values[0][1]).toBe(-Infinity);
    expect(warnings).toEqual(['report "Odd figure": figure "f1" has a malformed embedded dataset']);
  });

  it("leaves an undecodable cell in time/values untouched (never partially decoded), with no warning when nothing else decoded", () => {
    // An unrecognized string is a cell `lib/nonFiniteCells.ts` refuses to
    // guess at (ANY report figure's `spec.dataset` is opaque data, not
    // necessarily ours) — so the row stays untouched and, with nothing else
    // decoded, silent. (A legacy `null` cell is read as NaN since the
    // 2026-10-03 ruling; see workspaceLegacyNullCells.test.ts.)
    const warnings: string[] = [];
    const report = entry({
      id: "rep-bad2",
      name: "Broken cells",
      report: {
        title: "Figure",
        sections: [{
          title: "Figures",
          blocks: [{
            type: "figure", name: "f2",
            spec: {
              // Finding #10: a REAL sentinel ("NaN") precedes the
              // undecodable cell in the SAME row, so a decode that mutates
              // as it walks (rather than discarding the whole row on
              // failure) would leak a partially-decoded array here.
              dataset: { time: [0, 1], values: [["NaN", "not-a-sentinel"]], labels: ["y"], units: [""], metadata: {} },
            },
          }],
        }],
      },
    });
    const out = sanitizeReports([report], new Set(), warnings);
    const block = out[0].report.sections[0].blocks[0];
    if (block.type !== "figure") throw new Error("expected figure block");
    // The whole row is left EXACTLY as it was — the leading "NaN" is never
    // decoded on its own once a later cell in the same row fails.
    expect((block.spec?.dataset as { values: unknown[][] }).values).toEqual([["NaN", "not-a-sentinel"]]);
    expect(warnings).toEqual([]);
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
