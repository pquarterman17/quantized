// Pure PageDocument tests (FIGURE_AUTHORING_WORKFLOW_PLAN F3.1) — schema,
// sanitization/migration, serialization round-trip, and the fail-closed
// missing-reference contract (F3.2).

import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import {
  PAGE_DOCUMENT_SCHEMA,
  PAGE_DOCUMENT_VERSION,
  createPageDocument,
  deserializePageDocument,
  emptyPagePanels,
  pagePanelLabels,
  pagePanelLifecycle,
  pagesReferencingFigure,
  resolvePagePanel,
  sanitizePageDocument,
  sanitizePageDocuments,
  serializePageDocument,
  type PageDocument,
} from "./pageDocument";

const FIGURE = createFigureDocument({
  id: "figure-1",
  name: "MvsH loop",
  datasetId: "d1",
  view: defaultPlotView(),
});

const FROZEN_FIGURE = createFigureDocument({
  id: "figure-frozen",
  name: "frozen snapshot fig",
  datasetId: null,
  view: defaultPlotView(),
  data: {
    mode: "frozen",
    snapshot: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
  },
});

describe("createPageDocument", () => {
  it("builds a rows x cols grid of empty panels by default", () => {
    const doc = createPageDocument({ id: "p1", name: "Untitled page" });
    expect(doc.schema).toBe(PAGE_DOCUMENT_SCHEMA);
    expect(doc.version).toBe(PAGE_DOCUMENT_VERSION);
    expect(doc.rows).toBe(2);
    expect(doc.cols).toBe(2);
    expect(doc.panels).toEqual(emptyPagePanels(2, 2));
    expect(doc.output).toMatchObject({ format: "pdf", stylePreset: "default", dpi: 300 });
  });

  it("pads/truncates a supplied panel list to rows*cols", () => {
    const doc = createPageDocument({
      id: "p1",
      name: "Two panels",
      rows: 1,
      cols: 3,
      panels: [{ figureId: "figure-1", label: null, title: null }],
    });
    expect(doc.panels).toHaveLength(3);
    expect(doc.panels[0].figureId).toBe("figure-1");
    expect(doc.panels[1]).toEqual({ figureId: null, label: null, title: null });
  });

  it("floors rows/cols at 1 (never a degenerate empty grid)", () => {
    const doc = createPageDocument({ id: "p1", name: "x", rows: 0, cols: -3 });
    expect(doc.rows).toBe(1);
    expect(doc.cols).toBe(1);
  });
});

describe("serialize / sanitize round trip", () => {
  it("round-trips an equivalent page through JSON", () => {
    const doc = createPageDocument({
      id: "p1",
      name: "Figure 1",
      rows: 2,
      cols: 2,
      panels: [
        { figureId: "figure-1", label: "(i)", title: "custom title" },
        { figureId: null, label: null, title: null },
        { figureId: "figure-2", label: null, title: null },
        { figureId: null, label: null, title: null },
      ],
      output: { format: "svg", stylePreset: "aps", dpi: 600, labelFormat: "A)", labelPos: "outside" },
    });
    const restored = deserializePageDocument(serializePageDocument(doc));
    expect(restored).toEqual(doc);
  });

  it("drops a bad envelope/identity outright", () => {
    expect(sanitizePageDocument(null)).toBeNull();
    expect(sanitizePageDocument({})).toBeNull();
    expect(sanitizePageDocument({ schema: PAGE_DOCUMENT_SCHEMA, version: 1, id: "", name: "x" })).toBeNull();
    expect(sanitizePageDocument({ schema: "other", version: 1, id: "p1", name: "x" })).toBeNull();
  });

  it("rejects a future schema version rather than silently coercing it", () => {
    const doc = createPageDocument({ id: "p1", name: "x" });
    expect(sanitizePageDocument({ ...doc, version: 2 })).toBeNull();
  });

  it("degrades malformed nested fields to safe defaults instead of rejecting the document", () => {
    const restored = sanitizePageDocument({
      schema: PAGE_DOCUMENT_SCHEMA,
      version: 1,
      id: "p1",
      name: "x",
      rows: 99, // over PAGE_MAX_GRID -> clamped
      cols: "two", // not an integer -> defaults to 1
      panels: [{ figureId: 5, label: null, title: null }, "junk"],
      output: { dpi: -1, labelFormat: "bogus" },
    });
    expect(restored).not.toBeNull();
    expect(restored!.rows).toBe(1); // 99 fails the <=PAGE_MAX_GRID check
    expect(restored!.cols).toBe(1);
    expect(restored!.panels).toEqual([{ figureId: null, label: null, title: null }]);
    expect(restored!.output.dpi).toBe(300);
    expect(restored!.output.labelFormat).toBe("(a)");
  });
});

describe("sanitizePageDocuments (migration)", () => {
  it("an absent field loads as [] without crashing (pre-F3.1 workspace)", () => {
    expect(sanitizePageDocuments(undefined)).toEqual([]);
    expect(sanitizePageDocuments(null)).toEqual([]);
  });

  it("drops malformed entries and de-dupes ids, keeping order", () => {
    const good = createPageDocument({ id: "p1", name: "Good" });
    const dupe = { ...good, name: "Duplicate id" };
    const result = sanitizePageDocuments([good, "junk", null, dupe]);
    expect(result.map((d) => d.id)).toEqual(["p1"]);
    expect(result[0].name).toBe("Good");
  });

  it("skips a future-version document while keeping valid siblings", () => {
    const valid = createPageDocument({ id: "p1", name: "Valid" });
    const future = { ...createPageDocument({ id: "p2", name: "Future" }), version: 2 };
    expect(sanitizePageDocuments([valid, future]).map((d) => d.id)).toEqual(["p1"]);
  });
});

describe("resolvePagePanel (F3.2 fail-closed)", () => {
  it("reports an unassigned panel as empty", () => {
    expect(resolvePagePanel({ figureId: null, label: null, title: null }, [FIGURE])).toEqual({
      status: "empty",
    });
  });

  it("resolves a live reference to its FigureDocument", () => {
    const result = resolvePagePanel({ figureId: "figure-1", label: null, title: null }, [FIGURE]);
    expect(result).toEqual({ status: "ok", figure: FIGURE });
  });

  it("reports a deleted/unavailable reference as missing — never silently empty", () => {
    const panel = { figureId: "gone", label: null, title: null };
    const result = resolvePagePanel(panel, [FIGURE]);
    expect(result).toEqual({ status: "missing", figureId: "gone" });
    // Specifically NOT collapsed to "empty" — a missing reference must stay
    // visibly distinct so a renderer/export/editor can surface it.
    expect(result.status).not.toBe("empty");
  });
});

describe("pagePanelLifecycle (F3.2 — inherited from the referenced FigureDocument, no second mechanism)", () => {
  it("is null for an empty panel", () => {
    expect(pagePanelLifecycle({ status: "empty" })).toBeNull();
  });

  it("is null for a missing (dangling) reference — nothing to classify", () => {
    expect(pagePanelLifecycle({ status: "missing", figureId: "gone" })).toBeNull();
  });

  it("reads live/frozen straight off the resolved FigureDocument's own data.mode", () => {
    expect(pagePanelLifecycle({ status: "ok", figure: FIGURE })).toBe("live");
    expect(pagePanelLifecycle({ status: "ok", figure: FROZEN_FIGURE })).toBe("frozen");
  });
});

describe("pagesReferencingFigure (F3.2 item 3 — referential integrity at the delete site)", () => {
  it("returns [] when no page references the figure", () => {
    const page = createPageDocument({ id: "p1", name: "Untitled page" });
    expect(pagesReferencingFigure([page], "figure-1")).toEqual([]);
  });

  it("names every page and slot (by previewed label) referencing the figure", () => {
    const page = createPageDocument({
      id: "p1",
      name: "Results page",
      rows: 1,
      cols: 3,
      panels: [
        { figureId: "figure-1", label: null, title: null },
        { figureId: "figure-2", label: null, title: null },
        { figureId: "figure-1", label: null, title: null },
      ],
    });
    const refs = pagesReferencingFigure([page], "figure-1");
    expect(refs).toHaveLength(1);
    expect(refs[0].page.id).toBe("p1");
    expect(refs[0].slots).toEqual([0, 2]);
    // Row-major auto sequence: slot 0 -> (a), slot 1 -> (b) [not a match],
    // slot 2 -> (c) -- the labels named are the ones the user actually sees.
    expect(refs[0].labels).toEqual(["(a)", "(c)"]);
  });

  it("does not cross-match a different figure's id", () => {
    const page = createPageDocument({
      id: "p1",
      name: "x",
      panels: [{ figureId: "figure-2", label: null, title: null }],
    });
    expect(pagesReferencingFigure([page], "figure-1")).toEqual([]);
  });

  it("covers multiple pages independently", () => {
    const a = createPageDocument({ id: "a", name: "A", panels: [{ figureId: "figure-1", label: null, title: null }] });
    const b = createPageDocument({ id: "b", name: "B", panels: [{ figureId: "figure-9", label: null, title: null }] });
    const c = createPageDocument({ id: "c", name: "C", panels: [{ figureId: "figure-1", label: null, title: null }] });
    const refs = pagesReferencingFigure([a, b, c], "figure-1");
    expect(refs.map((r) => r.page.id)).toEqual(["a", "c"]);
  });
});

describe("pagePanelLabels", () => {
  it("counts every occupied panel through the auto sequence, including a missing reference", () => {
    const doc: PageDocument = createPageDocument({
      id: "p1",
      name: "x",
      rows: 1,
      cols: 3,
      panels: [
        { figureId: "figure-1", label: null, title: null },
        { figureId: null, label: null, title: null },
        { figureId: "gone", label: null, title: null }, // occupies its place even though unresolved
      ],
    });
    expect(pagePanelLabels(doc.panels, "(a)")).toEqual(["(a)", "", "(b)"]);
  });

  it("lets an explicit override win without consuming the sequence position", () => {
    const doc = createPageDocument({
      id: "p1",
      name: "x",
      rows: 1,
      cols: 2,
      panels: [
        { figureId: "figure-1", label: "(i)", title: null },
        { figureId: "figure-2", label: null, title: null },
      ],
    });
    expect(pagePanelLabels(doc.panels, "(a)")).toEqual(["(i)", "(b)"]);
  });
});
