// Quick Figure Builder's Label and Grouping roles (LIBRARY_WORKBOOK_UX_PLAN,
// "Quick Figure Builder concept" -- X / Y / X error / Y error / label /
// grouping). Pure-layer pins: mapping actions, the point-label builder + its
// create gate, the live preview's group split, the commit converter, and the
// Quick Plot template capture/resolve/sanitize path the roles must survive.
import { describe, expect, it } from "vitest";

import { quickFigureCommit } from "./quickFigureCommit";
import { MAX_QUICK_POINT_LABELS, quickFigurePointLabels } from "./quickFigureLabels";
import { canCreateQuickFigure, pointLabelBlock, type QuickFigureMapping } from "./quickFigureMapping";
import { assignQuickFigureColumn, assignmentFor, initialQuickFigureMapping } from "./quickFigureMappingActions";
import { quickFigurePreview } from "./quickFigurePreview";
import {
  buildQuickPlotTemplateSignature,
  captureQuickPlotTemplateLabels,
  resolveTemplate,
  type QuickPlotTemplate,
} from "./quickPlotTemplates";
import { sanitizeQuickPlotTemplates } from "./quickPlotTemplatesSanitize";
import type { Dataset } from "./types";

// Channels: 0 temp (X candidate), 1 R (Y), 2 dR (Y error), 3 sample
// (categorical: codes into cat_levels), 4 id (numeric label).
function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "grouped.csv",
    data: {
      time: [0, 1, 2, 3],
      values: [
        [10, 1, 0.1, 0, 101],
        [20, 2, 0.2, 1, 102],
        [30, 3, 0.3, 0, Number.NaN],
        [40, 4, 0.4, 1, 104.123456789],
      ],
      labels: ["temp", "R", "dR", "sample", "id"],
      units: ["K", "Ω", "Ω", "", ""],
      metadata: { technique: "generic" },
      cat_levels: { 3: ["A", "B"] },
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

describe("mapping actions — Group by / Point labels are exclusive single-slot roles", () => {
  it("assigns, reads back, and moves each role; a never-used role leaves the mapping shape unchanged", () => {
    const initial = initialQuickFigureMapping(dataset());
    expect(initial).not.toHaveProperty("groupKey");
    expect(initial).not.toHaveProperty("labelKey");
    // Reassigning some OTHER role never introduces the optional keys.
    expect(assignQuickFigureColumn(initial, 0, { role: "x" })).not.toHaveProperty("groupKey");

    const grouped = assignQuickFigureColumn(initial, 3, { role: "group" });
    expect(grouped.groupKey).toBe(3);
    expect(grouped.yKeys).not.toContain(3);
    expect(assignmentFor(grouped, 3)).toEqual({ role: "group" });

    const labelled = assignQuickFigureColumn(grouped, 4, { role: "label" });
    expect(labelled.labelKey).toBe(4);
    expect(labelled.groupKey).toBe(3);
    expect(assignmentFor(labelled, 4)).toEqual({ role: "label" });

    // Single slot: grouping by another column MOVES the role.
    const moved = assignQuickFigureColumn(labelled, 4, { role: "group" });
    expect(moved.groupKey).toBe(4);
    expect(moved).not.toHaveProperty("labelKey");
    expect(assignmentFor(moved, 3)).toEqual({ role: "unassigned" });
  });

  it("assigning the group column to Y (or unassigning it) clears the Grouping role", () => {
    const grouped = assignQuickFigureColumn(mapping(), 3, { role: "group" });
    const asY = assignQuickFigureColumn(grouped, 3, { role: "y" });
    expect(asY).not.toHaveProperty("groupKey");
    expect(asY.yKeys).toEqual([1, 3]);
    const cleared = assignQuickFigureColumn(assignQuickFigureColumn(mapping(), 4, { role: "label" }), 4, { role: "unassigned" });
    expect(cleared).not.toHaveProperty("labelKey");
  });

  it("taking a Y column as the group drops the Y and its now-targetless error binding", () => {
    const grouped = assignQuickFigureColumn(mapping({ yKeys: [1, 3] }), 1, { role: "group" });
    expect(grouped.yKeys).toEqual([3]);
    expect(grouped.errorBindings).toEqual([]);
  });
});

describe("quickFigurePointLabels — the Label role as grouped data-anchored annotations", () => {
  it("one label per (plotted Y, row) at the plotted point; numeric values rounded; non-finite skipped", () => {
    const labels = quickFigurePointLabels(dataset(), mapping({ labelKey: 4 }), "g1");
    expect(labels).toEqual([
      { id: "g1-0", groupId: "g1", x: 10, y: 1, text: "101" },
      { id: "g1-1", groupId: "g1", x: 20, y: 2, text: "102" },
      // row 2: NaN label value -> no label (never a blank annotation)
      { id: "g1-2", groupId: "g1", x: 40, y: 4, text: "104.123" },
    ]);
  });

  it("a categorical label column uses its level text; X falls back to the acquisition axis", () => {
    const labels = quickFigurePointLabels(dataset(), mapping({ xKey: null, labelKey: 3 }), "g");
    expect(labels.map((a) => [a.x, a.text])).toEqual([[0, "A"], [1, "B"], [2, "A"], [3, "B"]]);
  });

  it("labels every plotted Y series, and skips rows the Stage hides (excluded / filtered)", () => {
    const labels = quickFigurePointLabels(dataset({ excludedRows: [1] }), mapping({ yKeys: [1, 2], labelKey: 3 }), "g");
    expect(labels.map((a) => [a.y, a.text])).toEqual([
      [1, "A"], [3, "A"], [4, "B"],
      [0.1, "A"], [0.3, "A"], [0.4, "B"],
    ]);
  });

  it("is empty without a Label role, and `limit` stops the scan early", () => {
    expect(quickFigurePointLabels(dataset(), mapping(), "g")).toEqual([]);
    expect(quickFigurePointLabels(dataset(), mapping({ labelKey: 3 }), "g", 2)).toHaveLength(2);
  });
});

describe("create gate — the Label role fails closed with a reason", () => {
  it("passes when it yields 1..cap labels", () => {
    expect(pointLabelBlock(dataset(), mapping({ labelKey: 4 }))).toBeNull();
    expect(canCreateQuickFigure(dataset(), mapping({ labelKey: 4, groupKey: 3 }))).toEqual({ ok: true });
  });

  it("blocks a Label column with no value on any plotted point", () => {
    const ds = dataset();
    ds.data = { ...ds.data, values: ds.data.values.map((row) => [...row.slice(0, 4), Number.NaN]) };
    const gate = canCreateQuickFigure(ds, mapping({ labelKey: 4 }));
    expect(gate).toEqual({
      ok: false,
      reason: 'Label column "id" has no values on plotted points',
      reasonId: "quick-builder-label-warning",
    });
  });

  it("blocks more labels than the cap instead of silently truncating", () => {
    const rows = MAX_QUICK_POINT_LABELS + 1;
    const big: Dataset = {
      id: "big",
      name: "big.csv",
      data: {
        time: Array.from({ length: rows }, (_, i) => i),
        values: Array.from({ length: rows }, (_, i) => [i, i]),
        labels: ["Y", "n"],
        units: ["", ""],
        metadata: {},
      },
    };
    const gate = canCreateQuickFigure(big, { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [], labelKey: 1 });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe(`Label column "n" would place over ${MAX_QUICK_POINT_LABELS} point labels`);
  });
});

describe("quickFigurePreview — the Grouping role splits the legend like the Stage does", () => {
  it("one series per level labelled `Y (group=level)`, in the dataset's level order; no error spans while grouped", () => {
    const preview = quickFigurePreview(dataset().data, mapping({ groupKey: 3 }), "line");
    expect(preview.kind).toBe("xy");
    if (preview.kind !== "xy") return;
    expect(preview.grouped).toBe(true);
    expect(preview.payload.series.map((s) => s.label)).toEqual(["R (sample=A)", "R (sample=B)"]);
    expect(preview.payload.data.slice(1)).toEqual([[1, null, 3, null], [null, 2, null, 4]]);
    expect(preview.errorSpans).toBeUndefined();
    // Ungrouped, the same mapping draws its error spans.
    const flat = quickFigurePreview(dataset().data, mapping(), "line");
    expect(flat.kind === "xy" && flat.errorSpans?.size).toBe(1);
  });
});

describe("quickFigureCommit — both roles reach the canonical view", () => {
  it("sets view.groupKey and seeds the point labels as one annotation group", () => {
    const pieces = quickFigureCommit(dataset(), mapping({ groupKey: 3, labelKey: 4 }), "line", "quick-labels-f9");
    expect(pieces.view.groupKey).toBe(3);
    expect(pieces.view.yKeys).toEqual([1]);
    expect(pieces.view.annotations.map((a) => a.text)).toEqual(["101", "102", "104.123"]);
    expect(new Set(pieces.view.annotations.map((a) => a.groupId))).toEqual(new Set(["quick-labels-f9"]));
  });

  it("without the roles the view is exactly as before (no group, no annotations)", () => {
    const pieces = quickFigureCommit(dataset(), mapping(), "line");
    expect(pieces.view.groupKey).toBeNull();
    expect(pieces.view.annotations).toEqual([]);
  });
});

describe("Quick Plot templates carry the roles (refusal-or-nothing)", () => {
  function template(ds: Dataset, m: QuickFigureMapping): QuickPlotTemplate {
    return {
      id: "t1",
      name: "T",
      createdAt: "2026-09-28T00:00:00.000Z",
      modifiedAt: "2026-09-28T00:00:00.000Z",
      scope: { kind: "schema" },
      technique: "generic",
      signature: buildQuickPlotTemplateSignature(ds),
      mapping: m,
      style: "line",
      labels: captureQuickPlotTemplateLabels(ds, m),
    };
  }

  it("re-keys Group by / Point labels by column label on a reordered dataset", () => {
    const saved = template(dataset(), mapping({ errorBindings: [], groupKey: 3, labelKey: 4 }));
    const src = dataset();
    const order = [4, 3, 2, 1, 0];
    const reordered = dataset({
      data: {
        ...src.data,
        values: src.data.values.map((row) => order.map((c) => row[c])),
        labels: order.map((c) => src.data.labels[c]),
        units: order.map((c) => src.data.units[c]),
        cat_levels: { 1: ["A", "B"] },
      },
    });
    const resolved = resolveTemplate(saved, reordered);
    expect(resolved).toEqual({
      ok: true,
      mapping: {
        xKey: 4,
        yKeys: [3],
        errorBindings: [],
        ignoredKeys: [],
        groupKey: 1,
        labelKey: 0,
      },
    });
  });

  it("refuses the whole apply when the group column is gone", () => {
    const saved = template(dataset(), mapping({ groupKey: 3 }));
    const src = dataset();
    const renamed = dataset({ data: { ...src.data, labels: ["temp", "R", "dR", "batch", "id"] } });
    const resolved = resolveTemplate(saved, renamed);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.unmatched).toEqual(['Group by ("sample")']);
  });

  it("the .dwk sanitizer keeps valid role indices and drops malformed ones", () => {
    const saved = template(dataset(), mapping({ groupKey: 3, labelKey: 4 }));
    const [kept] = sanitizeQuickPlotTemplates(JSON.parse(JSON.stringify([saved])));
    expect(kept.mapping.groupKey).toBe(3);
    expect(kept.mapping.labelKey).toBe(4);
    const [dropped] = sanitizeQuickPlotTemplates([{ ...saved, mapping: { ...saved.mapping, groupKey: "3", labelKey: -1 } }]);
    expect(dropped.mapping).not.toHaveProperty("groupKey");
    expect(dropped.mapping).not.toHaveProperty("labelKey");
    // A pre-role template (no keys at all) still parses unchanged.
    const [legacy] = sanitizeQuickPlotTemplates([template(dataset(), mapping())]);
    expect(legacy.mapping).toEqual(mapping());
  });
});
