// PR H (LIBRARY_WORKBOOK_UX_PLAN): Quick Plot template persistence, scopes,
// and matching -- the pure core (H1 object/sanitizer, H4 resolveTemplate).
// Store-level CRUD/apply-delegation coverage lives in
// store/quickPlotTemplates.test.ts.

import { describe, expect, it } from "vitest";

import type { QuickFigureMapping } from "./quickFigureMapping";
import {
  buildQuickPlotTemplateSignature,
  captureQuickPlotTemplateLabels,
  pruneDanglingWorkbookScopeTemplates,
  quickPlotTemplateInScope,
  resolveTemplate,
  sanitizeQuickPlotTemplates,
  type QuickPlotTemplate,
} from "./quickPlotTemplates";
import type { Dataset } from "./types";

function ds(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "d1.dat",
    data: {
      time: [0, 1, 2],
      values: [[1, 10, 0.1], [2, 20, 0.2], [3, 30, 0.3]],
      labels: ["X", "Y", "Yerr"],
      units: ["s", "Oe", "Oe"],
      metadata: { technique: "magnetometry.mvsh" },
    },
    ...overrides,
  };
}

function mapping(overrides: Partial<QuickFigureMapping> = {}): QuickFigureMapping {
  return {
    xKey: 0,
    yKeys: [1],
    errorBindings: [{ channel: 2, target: 1, axis: "y", side: "both" }],
    ignoredKeys: [],
    ...overrides,
  };
}

function template(overrides: Partial<QuickPlotTemplate> = {}): QuickPlotTemplate {
  const dataset = ds();
  const m = mapping();
  return {
    id: "tpl-1",
    name: "My Template",
    createdAt: "2026-08-17T00:00:00.000Z",
    modifiedAt: "2026-08-17T00:00:00.000Z",
    scope: { kind: "schema" },
    technique: "magnetometry.mvsh",
    signature: buildQuickPlotTemplateSignature(dataset),
    mapping: m,
    style: "line",
    labels: captureQuickPlotTemplateLabels(dataset, m),
    ...overrides,
  };
}

describe("buildQuickPlotTemplateSignature (H1)", () => {
  it("captures normalized labels, units, and error-role classification in column order", () => {
    const sig = buildQuickPlotTemplateSignature(ds());
    expect(sig.channels).toEqual([
      { label: "x", unit: "s", errorRole: "value" },
      { label: "y", unit: "Oe", errorRole: "value" },
      { label: "yerr", unit: "Oe", errorRole: "error-y" },
    ]);
  });
});

describe("captureQuickPlotTemplateLabels (H1)", () => {
  it("snapshots only the channels the mapping references, keyed by index", () => {
    const labels = captureQuickPlotTemplateLabels(ds(), mapping());
    expect(labels).toEqual({ 0: "X", 1: "Y", 2: "Yerr" });
  });

  it("excludes an X-error binding's -1 axis sentinel (not a real channel)", () => {
    const m = mapping({ xKey: null, yKeys: [], errorBindings: [{ channel: 2, target: -1, axis: "x", side: "both" }] });
    const labels = captureQuickPlotTemplateLabels(ds(), m);
    expect(labels).toEqual({ 2: "Yerr" });
  });
});

describe("sanitizeQuickPlotTemplates (H1 .dwk boundary)", () => {
  it("round-trips a well-formed template list unchanged", () => {
    const t = template();
    const out = sanitizeQuickPlotTemplates(JSON.parse(JSON.stringify([t])));
    expect(out).toEqual([t]);
  });

  it("drops malformed entries and never throws (missing mapping)", () => {
    const bad = { ...template(), mapping: undefined };
    expect(() => sanitizeQuickPlotTemplates([bad])).not.toThrow();
    expect(sanitizeQuickPlotTemplates([bad])).toEqual([]);
  });

  it("drops an entry with a corrupt nested mapping (non-array yKeys) without dropping its siblings", () => {
    const good = template({ id: "tpl-good" });
    const corrupt = { ...template({ id: "tpl-bad" }), mapping: { xKey: 0, yKeys: "not-an-array", errorBindings: [], ignoredKeys: [] } };
    const out = sanitizeQuickPlotTemplates([good, corrupt]);
    expect(out.map((t) => t.id)).toEqual(["tpl-good"]);
  });

  // Review-round P3(1): the whole-field "is it an array" check alone is not
  // enough -- a wrongly-typed ELEMENT inside an otherwise-array field must
  // also drop the entry (a prior version's `.every(...)` per-element guard
  // had no test exercising this, a none-killed mutation blind spot).
  it("drops an entry whose mapping array field holds a wrongly-typed ELEMENT (not just a wrong whole-field type)", () => {
    const good = template({ id: "tpl-good" });
    const badYKeysElement = {
      ...template({ id: "tpl-bad-y" }),
      mapping: { xKey: 0, yKeys: [0, "oops"], errorBindings: [], ignoredKeys: [] },
    };
    const badIgnoredElement = {
      ...template({ id: "tpl-bad-ignored" }),
      mapping: { xKey: 0, yKeys: [0], errorBindings: [], ignoredKeys: [1, null] },
    };
    const out = sanitizeQuickPlotTemplates([good, badYKeysElement, badIgnoredElement]);
    expect(out.map((t) => t.id)).toEqual(["tpl-good"]);
  });

  it("drops an entry with an unrecognized technique string", () => {
    const bad = { ...template(), technique: "not-a-real-technique" };
    expect(sanitizeQuickPlotTemplates([bad])).toEqual([]);
  });

  it("drops an entry with a malformed scope", () => {
    const bad = { ...template(), scope: { kind: "workbook" } }; // missing workbookId
    expect(sanitizeQuickPlotTemplates([bad])).toEqual([]);
  });

  it("is not an array -> empty list, never throws", () => {
    expect(sanitizeQuickPlotTemplates(null)).toEqual([]);
    expect(sanitizeQuickPlotTemplates(undefined)).toEqual([]);
    expect(sanitizeQuickPlotTemplates("garbage")).toEqual([]);
  });

  it("defaults an unrecognized style to line", () => {
    const withBadStyle = { ...template(), style: "pie-chart" };
    expect(sanitizeQuickPlotTemplates([withBadStyle])[0].style).toBe("line");
  });
});

describe("quickPlotTemplateInScope (H4 scope gating)", () => {
  it("a schema-scoped template matches any dataset regardless of workbook", () => {
    expect(quickPlotTemplateInScope(template({ scope: { kind: "schema" } }), ds({ workbookId: "wb-1" }))).toBe(true);
    expect(quickPlotTemplateInScope(template({ scope: { kind: "schema" } }), ds({ workbookId: undefined }))).toBe(true);
  });

  it("a workbook-scoped template matches only its own workbook", () => {
    const t = template({ scope: { kind: "workbook", workbookId: "wb-1" } });
    expect(quickPlotTemplateInScope(t, ds({ workbookId: "wb-1" }))).toBe(true);
    expect(quickPlotTemplateInScope(t, ds({ workbookId: "wb-2" }))).toBe(false);
    expect(quickPlotTemplateInScope(t, ds({ workbookId: undefined }))).toBe(false);
  });
});

describe("pruneDanglingWorkbookScopeTemplates (review-round P2, the orphan bug)", () => {
  it("drops a workbook-scoped template whose workbookId names no live workbook", () => {
    const t = template({ scope: { kind: "workbook", workbookId: "wb-gone" } });
    const out = pruneDanglingWorkbookScopeTemplates([t], new Set(["wb-1", "wb-2"]));
    expect(out).toEqual([]);
  });

  it("keeps a workbook-scoped template whose workbook is still live, even with zero worksheets today", () => {
    // Aliveness is about the WORKBOOK existing, not about it currently
    // having members -- a memberless-but-alive workbook must not be pruned.
    const t = template({ scope: { kind: "workbook", workbookId: "wb-1" } });
    const out = pruneDanglingWorkbookScopeTemplates([t], new Set(["wb-1"]));
    expect(out).toEqual([t]);
  });

  it("never touches a schema-scoped template (no workbook to dangle from)", () => {
    const t = template({ scope: { kind: "schema" } });
    const out = pruneDanglingWorkbookScopeTemplates([t], new Set());
    expect(out).toEqual([t]);
  });
});

describe("resolveTemplate (H4 matching)", () => {
  it("resolves an unchanged dataset to the identical mapping (identity case)", () => {
    const result = resolveTemplate(template(), ds());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mapping).toEqual({ xKey: 0, yKeys: [1], errorBindings: [{ channel: 2, target: 1, axis: "y", side: "both" }], ignoredKeys: [] });
    }
  });

  it("cross-technique refusal: never applies across techniques even when the schema is identical", () => {
    const t = template({ technique: "magnetometry.mvsh" });
    const other = ds({ data: { ...ds().data, metadata: { technique: "xrd.powder" } } });
    const result = resolveTemplate(t, other);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/xrd\.powder/);
  });

  it("schema evolution: a moved column re-keys by label and still applies", () => {
    // Columns reordered: X moved from 0 to 2, Y from 1 to 0, Yerr from 2 to 1.
    const moved = ds({
      data: {
        time: [0, 1, 2],
        values: [[10, 0.1, 1], [20, 0.2, 2], [30, 0.3, 3]],
        labels: ["Y", "Yerr", "X"],
        units: ["Oe", "Oe", "s"],
        metadata: { technique: "magnetometry.mvsh" },
      },
    });
    const result = resolveTemplate(template(), moved);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mapping.xKey).toBe(2);
      expect(result.mapping.yKeys).toEqual([0]);
      expect(result.mapping.errorBindings).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    }
  });

  it("schema evolution: a changed label refuses with the unmatched field named", () => {
    const renamed = ds({
      data: { ...ds().data, labels: ["X", "Moment", "Yerr"] }, // Y renamed to Moment
    });
    const result = resolveTemplate(template(), renamed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unmatched.some((u) => u.includes("Y series") && u.includes("Y"))).toBe(true);
    }
  });

  it("refuses (never partially applies) when only ONE of several mapped columns goes missing", () => {
    const t = template({ mapping: mapping({ yKeys: [1], errorBindings: [] }), labels: { 0: "X", 1: "Y" } });
    const missingX = ds({ data: { ...ds().data, labels: ["Gone", "Y", "Yerr"] } });
    const result = resolveTemplate(t, missingX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unmatched.length).toBe(1);
      expect(result.unmatched[0]).toContain("X axis");
    }
  });

  it("names EVERY unmatched field, not just the first", () => {
    const t = template({
      mapping: mapping({ xKey: 0, yKeys: [1], errorBindings: [] }),
      labels: { 0: "Gone1", 1: "Gone2" },
    });
    const result = resolveTemplate(t, ds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unmatched.length).toBe(2);
  });

  it("unit changed at the same label refuses that channel (same label, different quantity)", () => {
    const differentUnit = ds({ data: { ...ds().data, units: ["s", "Tesla", "Oe"] } });
    const result = resolveTemplate(template(), differentUnit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unmatched.some((u) => u.includes("Y"))).toBe(true);
  });

  it("scope gating refusal: a workbook-scoped template refuses a dataset outside that workbook", () => {
    const t = template({ scope: { kind: "workbook", workbookId: "wb-1" } });
    const result = resolveTemplate(t, ds({ workbookId: "wb-2" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/workbook/);
  });

  it("scope gating match: a workbook-scoped template applies inside its own workbook", () => {
    const t = template({ scope: { kind: "workbook", workbookId: "wb-1" } });
    const result = resolveTemplate(t, ds({ workbookId: "wb-1" }));
    expect(result.ok).toBe(true);
  });

  it("X-error's -1 axis sentinel passes through untouched, never treated as an unresolved channel", () => {
    const t = template({
      mapping: { xKey: null, yKeys: [1], errorBindings: [{ channel: 2, target: -1, axis: "x", side: "both" }], ignoredKeys: [] },
      labels: { 1: "Y", 2: "Yerr" },
    });
    const result = resolveTemplate(t, ds());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mapping.errorBindings).toEqual([{ channel: 2, target: -1, axis: "x", side: "both" }]);
  });

  it("a stale ignored-column index is dropped rather than blocking the whole apply", () => {
    const t = template({ mapping: mapping({ ignoredKeys: [99] }) });
    const result = resolveTemplate(t, ds());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mapping.ignoredKeys).toEqual([]);
  });
});
