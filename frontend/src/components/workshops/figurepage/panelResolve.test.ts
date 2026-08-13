// FIGURE_AUTHORING_WORKFLOW_PLAN F3.6: `buildPageSpecFromDocument` — export a
// SAVED PageDocument directly (Library "Export…"), without reopening it into
// the workshop session. Reuses `resolvePagePanel`/`buildFigureSpecFromDocument`
// (the exact path a reopened session's "figure"-kind panels already resolve
// through), so this test proves the Library path and the reopened-session
// path can never silently diverge on a shared underlying document.

import { beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument, type FigureDocument } from "../../../lib/figureDocument";
import type { FigureDoc } from "../../../lib/figuredoc";
import { createPageDocument } from "../../../lib/pageDocument";
import { defaultPlotView } from "../../../lib/plotview";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { buildPageSpecFromDocument, panelFigure } from "./panelResolve";

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 9],
    [2, 8],
    [3, 7],
  ],
  labels: ["A", "B"],
  units: ["u", "v"],
  metadata: {},
};

const LIVE: FigureDocument = createFigureDocument({
  id: "figure-live",
  name: "Live loop",
  datasetId: "d1",
  view: { ...defaultPlotView(), yKeys: [1], plotTitle: "Live loop title" },
});

const FROZEN: FigureDocument = createFigureDocument({
  id: "figure-frozen",
  name: "Frozen loop",
  datasetId: null,
  view: { ...defaultPlotView(), yKeys: [0], plotTitle: "Frozen loop title" },
  data: { mode: "frozen", snapshot: DATA },
});

beforeEach(() => {
  useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: DATA }] });
});

describe("buildPageSpecFromDocument", () => {
  it("returns null when every panel is empty — nothing to export", async () => {
    const page = createPageDocument({ id: "page-1", name: "Empty page" });
    const spec = await buildPageSpecFromDocument(page, []);
    expect(spec).toBeNull();
  });

  it("builds panels from resolved figures, threading grid/label/layout/output settings", async () => {
    const page = createPageDocument({
      id: "page-1",
      name: "Two-panel page",
      rows: 1,
      cols: 2,
      panels: [
        { figureId: "figure-live", label: "(zz)", title: "custom title" },
        { figureId: "figure-frozen", label: null, title: null },
      ],
      output: { format: "svg", stylePreset: "aps", dpi: 600, labelFormat: "A)", labelPos: "outside" },
      layout: { rowGap: 0.1, colGap: 0.2, linkX: true, linkY: false, alignLabels: true, resizeMode: "tight" },
    });
    const spec = await buildPageSpecFromDocument(page, [LIVE, FROZEN]);
    expect(spec).not.toBeNull();
    expect(spec).toMatchObject({
      rows: 1,
      cols: 2,
      style: "aps",
      label_format: "A)",
      label_pos: "outside",
      row_gap: 0.1,
      col_gap: 0.2,
      link_x: true,
      link_y: false,
      align_labels: true,
      resize_mode: "tight",
    });
    expect(spec!.panels).toHaveLength(2);
    const [p0, p1] = spec!.panels;
    expect([p0.row, p0.col]).toEqual([0, 0]);
    expect(p0.label).toBe("(zz)");
    expect(p0.title).toBe("custom title");
    expect(p0.figure.title).toBe("Live loop title");
    expect(p0.figure.dataset).toEqual(DATA);
    // Frozen panel needs no dataset resolution at all.
    expect([p1.row, p1.col]).toEqual([0, 1]);
    expect(p1.figure.title).toBe("Frozen loop title");
    expect(p1.figure.dataset).toEqual(DATA);
  });

  it("fails closed on a dangling figureId, naming the panel's own previewed label", async () => {
    const page = createPageDocument({
      id: "page-1",
      name: "Stale page",
      panels: [{ figureId: "figure-gone", label: null, title: null }],
    });
    await expect(buildPageSpecFromDocument(page, [])).rejects.toThrow(
      /panel \(a\): referenced figure no longer exists/,
    );
  });

  it("fails closed when a live figure's dataset is unavailable", async () => {
    useApp.setState({ datasets: [] }); // "d1" is gone
    const page = createPageDocument({
      id: "page-1",
      name: "Orphaned page",
      panels: [{ figureId: "figure-live", label: null, title: null }],
    });
    await expect(buildPageSpecFromDocument(page, [LIVE])).rejects.toThrow(
      /"Live loop" is missing its dataset/,
    );
  });

  it("skips genuinely empty panels but still places later panels at their real grid position", async () => {
    const page = createPageDocument({
      id: "page-1",
      name: "Sparse page",
      rows: 2,
      cols: 2,
      panels: [
        { figureId: null, label: null, title: null },
        { figureId: "figure-frozen", label: null, title: null },
        { figureId: null, label: null, title: null },
        { figureId: null, label: null, title: null },
      ],
    });
    const spec = await buildPageSpecFromDocument(page, [FROZEN]);
    expect(spec!.panels).toHaveLength(1);
    expect([spec!.panels[0].row, spec!.panels[0].col]).toEqual([0, 1]);
  });
});

// Post-F3.6 follow-up (see panelResolve.ts's module header): the "figdoc"
// source kind used to be the one hand-built holdout — it built a THIRD,
// most-reduced FigureSpec by hand instead of going through
// `buildFigureSpecFromDocument` like "figure"/"window" already did. It now
// converts first via `figureDocumentFromLegacyFigureDoc` (the exact
// converter F2.1c explicit-promotion uses) and resolves through the SAME
// adapter, degrading to null on the same failure classes the other two
// kinds already degrade on, rather than throwing and crashing the page.
describe("panelFigure — figdoc kind", () => {
  const LIVE_FIGDOC: FigureDoc = {
    id: "doc-live",
    name: "Live doc",
    datasetId: "d1",
    live: true,
    config: {
      xKey: null,
      yKeys: [0],
      xScale: "linear",
      yScale: "linear",
      title: "live doc title",
      xLabel: "",
      yLabel: "",
      style: "default",
      fmt: "pdf",
      dpi: 300,
      overrides: null,
      seriesStyles: null,
    },
  };

  beforeEach(() => {
    useApp.setState({ figureDocs: [], datasets: [] });
  });

  it("resolves a live figdoc's bound dataset through the canonical adapter", async () => {
    useApp.setState({ figureDocs: [LIVE_FIGDOC], datasets: [{ id: "d1", name: "scan.dat", data: DATA }] });
    const spec = await panelFigure({ kind: "figdoc", id: "doc-live", name: "Live doc" });
    expect(spec).not.toBeNull();
    expect(spec!.dataset).toEqual(DATA);
    expect(spec!.title).toBe("live doc title");
  });

  it("degrades to null, never throws, when a live figdoc's dataset is unavailable", async () => {
    useApp.setState({ figureDocs: [LIVE_FIGDOC], datasets: [] });
    await expect(panelFigure({ kind: "figdoc", id: "doc-live", name: "Live doc" })).resolves.toBeNull();
  });

  it("degrades to null, never throws, for a frozen figdoc with no data snapshot", async () => {
    // The converter (figureDocumentFromLegacyFigureDoc) throws for this
    // shape -- panelFigure's figdoc branch must catch it, not propagate it.
    const brokenFrozen: FigureDoc = { ...LIVE_FIGDOC, id: "doc-broken", live: false, dataSnapshot: undefined };
    useApp.setState({ figureDocs: [brokenFrozen] });
    await expect(panelFigure({ kind: "figdoc", id: "doc-broken", name: "Broken doc" })).resolves.toBeNull();
  });

  it("degrades to null, never throws, when the adapter rejects an empty (no visible series) doc", async () => {
    const emptyDoc: FigureDoc = { ...LIVE_FIGDOC, id: "doc-empty", config: { ...LIVE_FIGDOC.config, yKeys: [] } };
    useApp.setState({ figureDocs: [emptyDoc], datasets: [{ id: "d1", name: "scan.dat", data: DATA }] });
    await expect(panelFigure({ kind: "figdoc", id: "doc-empty", name: "Empty doc" })).resolves.toBeNull();
  });

  // The fidelity gain this migration exists for: the pre-conversion
  // hand-built branch never read `config.errors` (the Graph Builder
  // Y-error wells) at all, so these bars silently vanished from a figdoc
  // panel's page export. Fail-before/pass-after: reverting the figdoc
  // branch to its pre-conversion hand-built return makes this fail
  // (error_spans absent).
  it("threads a Graph Builder error binding into error_spans", async () => {
    const errored: FigureDoc = {
      ...LIVE_FIGDOC,
      id: "doc-errors",
      config: { ...LIVE_FIGDOC.config, errors: [{ channel: 1, target: 0, axis: "y", side: "both" }] },
    };
    useApp.setState({ figureDocs: [errored], datasets: [{ id: "d1", name: "scan.dat", data: DATA }] });
    const spec = await panelFigure({ kind: "figdoc", id: "doc-errors", name: "Errored doc" });
    expect(spec!.error_spans).toBeDefined();
    expect(spec!.error_spans![0]).not.toBeNull();
  });
});
