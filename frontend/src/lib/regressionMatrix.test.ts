// P4.2 — canonical plot/project regression matrix (PRIMARY_SOFTWARE_AUDIT_PLAN).
//
// For every canonical figure: SCREEN ≡ EXPORT ≡ REOPEN on the shared structural
// payload, plus a frozen golden of that payload. See
// `regressionMatrix.testkit.ts` for what each leg reads and the (documented)
// places where a path legitimately cannot express a field.
//
// REGENERATING THE GOLDENS. They are the SCREEN projection of each fixture,
// written once. To refresh them after a deliberate change, temporarily add a
// test that writes `projectScreen(...)` for each fixture to
// `src/lib/__fixtures__/regressionMatrix/<name>.json` with `JSON.stringify(x,
// null, 2)` via `node:fs`, run it, delete it, and review the diff — never
// "update the golden because the test went red".
//
// FOUR DIVERGENCES THIS MATRIX FOUND, each pinned below as a documented
// `it.fails` (none of them is fixed here — this slice is tests-only):
//   D1 x-breaks  — a document's `plot.axisBreaks.x` reaches the export wire and
//                  survives reopen, but NOTHING on screen renders from it.
//   D2 waterfall — the canvas offsets every series by `view.waterfall`;
//                  `FigureSpec` has no waterfall field at all, so the export
//                  draws the un-offset curves.
//   D3 rename    — a legend rename replaces the whole on-screen label (unit and
//                  all) but only `dataset.labels[ch]` on the wire, so the
//                  exported legend reads "renamed (au)".
//   D4 hidden    — hiding a series shifts every later series' palette colour on
//                  the exported figure but not on the canvas.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import breakGolden from "./__fixtures__/regressionMatrix/break.json";
import decorGolden from "./__fixtures__/regressionMatrix/decor.json";
import errorsGolden from "./__fixtures__/regressionMatrix/errors.json";
import facetGolden from "./__fixtures__/regressionMatrix/facet.json";
import groupGolden from "./__fixtures__/regressionMatrix/group.json";
import pageGolden from "./__fixtures__/regressionMatrix/page.json";
import plainGolden from "./__fixtures__/regressionMatrix/plain.json";
import waterfallGolden from "./__fixtures__/regressionMatrix/waterfall.json";
import y2Golden from "./__fixtures__/regressionMatrix/y2.json";

import { buildPageSpecFromDocument } from "../components/workshops/figurepage/panelResolve";
import { useApp } from "../store/useApp";
import { createFigureDocument, type FigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import {
  MATRIX_FIXTURES,
  matrixDataset,
  matrixFixture,
  pageFigures,
  pageFixture,
  type MatrixFixtureName,
} from "./regressionMatrixFixtures.testkit";
import {
  installSeriesPalette,
  type CanonicalFigure,
} from "./regressionMatrix.testkit";
import {
  projectExport,
  projectReopen,
  projectScreen,
  reopenProject,
} from "./regressionMatrixLegs.testkit";
import {
  projectExportPage,
  projectReopenPage,
  projectScreenPage,
} from "./regressionMatrixPage.testkit";
import type { Dataset } from "./types";

const GOLDENS: Record<MatrixFixtureName, unknown> = {
  plain: plainGolden,
  errors: errorsGolden,
  group: groupGolden,
  facet: facetGolden,
  y2: y2Golden,
  break: breakGolden,
  waterfall: waterfallGolden,
  decor: decorGolden,
};

/** Fixtures on which a leg is KNOWN to disagree, naming the field and which
 *  comparisons it spoils. The narrowed equality test below drops exactly that
 *  field from those comparisons; the `it.fails` block at the bottom pins the
 *  divergence itself so it can never be "fixed" by quietly widening this table.
 *
 *  `break` spoils BOTH comparisons because the screen is the odd leg out (it
 *  renders nothing from `axisBreaks.x`); `waterfall` spoils only the export
 *  comparison, since reopen restores the offset exactly as the canvas applies
 *  it. */
type Leg = "export" | "reopen";
const DIVERGENT: Partial<Record<MatrixFixtureName, { field: keyof CanonicalFigure; legs: Leg[] }>> = {
  break: { field: "xBreaks", legs: ["export", "reopen"] },
  waterfall: { field: "waterfallOffset", legs: ["export"] },
};

function without(figure: CanonicalFigure, field: keyof CanonicalFigure): Partial<CanonicalFigure> {
  const copy: Partial<CanonicalFigure> = { ...figure };
  delete copy[field];
  return copy;
}

let restorePalette: () => void;

beforeAll(() => {
  restorePalette = installSeriesPalette();
});

afterAll(() => {
  restorePalette();
});

describe("P4.2 regression matrix: screen ≡ export ≡ reopen", () => {
  for (const name of MATRIX_FIXTURES) {
    describe(name, () => {
      const dataset: Dataset = matrixDataset();
      const document: FigureDocument = matrixFixture(name);
      const screen = () => projectScreen(document, dataset);
      const exported = () => projectExport(document, dataset);
      const reopened = () => projectReopen(reopenProject(document, dataset));
      const divergent = DIVERGENT[name];
      const spoils = (leg: Leg) => (divergent?.legs.includes(leg) ? divergent.field : undefined);

      for (const [leg, project] of [["export", exported], ["reopen", reopened]] as const) {
        const field = spoils(leg);
        if (field === undefined) {
          it(`screen ≡ ${leg}`, () => {
            expect(project()).toEqual(screen());
          });
        } else {
          it(`screen ≡ ${leg} apart from the documented "${field}" divergence`, () => {
            expect(without(project(), field)).toEqual(without(screen(), field));
          });
        }
      }

      it("matches the committed golden", () => {
        expect(screen()).toEqual(GOLDENS[name]);
      });
    });
  }
});

describe("P4.2 regression matrix: every fixture projects its distinguishing feature", () => {
  const dataset = matrixDataset();

  it("plain — two overlaid primary-axis series, no grouping/facet/y2/break/waterfall", () => {
    const p = projectScreen(matrixFixture("plain"), dataset);
    expect(p.mode).toBe("flat");
    expect(p.series.map((s) => s.channel)).toEqual([0, 1]);
    expect(p.series.every((s) => s.axis === 0)).toBe(true);
    expect(p.grouping.channel).toBeNull();
    expect(p.facet.channel).toBeNull();
    expect(p.y2Positions).toEqual([]);
    expect(p.xBreaks).toEqual([]);
    expect(p.waterfallOffset).toBe(0);
    // Non-vacuous colours: the palette-by-position slots must be distinct.
    expect(new Set(p.series.map((s) => s.color)).size).toBe(2);
  });

  it("errors — BOTH orientations, symmetric AND asymmetric, on the legs that carry spans", () => {
    const screen = projectScreen(matrixFixture("errors"), dataset);
    const exported = projectExport(matrixFixture("errors"), dataset);
    for (const p of [screen, exported]) {
      // series 0: symmetric y + the plot-wide x error; series 1: asymmetric y + x.
      expect(p.errors[0].map((e) => `${e.axis}:${e.symmetric}`)).toEqual(["y:true", "x:true"]);
      expect(p.errors[1].map((e) => `${e.axis}:${e.symmetric}`)).toEqual(["y:false", "x:true"]);
      expect(p.errors[1][0].plus[0]).toBe(0.2);
      expect(p.errors[1][0].minus[0]).toBe(0.05);
    }
  });

  it("group — the explicit non-ascending level order and its labels", () => {
    const p = projectScreen(matrixFixture("group"), dataset);
    expect(p.mode).toBe("group");
    expect(p.grouping.channel).toBe(6);
    expect(p.grouping.levelOrder).toEqual([2, 0, 1]);
    expect(p.grouping.levelLabels).toEqual(["C", "A", "B"]);
    expect(projectExport(matrixFixture("group"), dataset).grouping).toEqual(p.grouping);
  });

  it("facet — a real panel partition, one per level of the facet column", () => {
    const p = projectScreen(matrixFixture("facet"), dataset);
    expect(p.mode).toBe("facet");
    expect(p.facet.channel).toBe(7);
    expect(p.facet.panels?.map((panel) => panel.label)).toEqual(["north", "south"]);
    expect(p.facet.panels?.[0].series).toEqual(["Signal (au)", "Reference (au)"]);
    // FEATURE-001: styling is not a comparable property of a faceted figure.
    expect(p.series.every((s) => s.dash === null && s.color === null)).toBe(true);
  });

  it("y2 — one series really lands on the secondary axis, with its own label/limits", () => {
    const p = projectScreen(matrixFixture("y2"), dataset);
    expect(p.y2Positions).toEqual([1]);
    expect(p.series[1].channel).toBe(8);
    expect(p.axes.y2).toEqual({ label: "Temperature (K)", scale: "linear", limits: [270, 310] });
  });

  it("break — the elided x-range reaches the export wire and the reopened document", () => {
    const document = matrixFixture("break");
    expect(projectExport(document, dataset).xBreaks).toEqual([[2, 3]]);
    expect(projectReopen(reopenProject(document, dataset)).xBreaks).toEqual([[2, 3]]);
  });

  it("waterfall — the canvas really offsets the second series", () => {
    expect(projectScreen(matrixFixture("waterfall"), dataset).waterfallOffset).toBeGreaterThan(0);
  });

  it("decor — annotations, shapes, reference lines, a region shade and the legend title", () => {
    const p = projectScreen(matrixFixture("decor"), dataset);
    expect(p.decor.annotations.map((a) => a.text)).toEqual(["onset", "plateau"]);
    expect(p.decor.shapes.map((s) => s.kind)).toEqual(["arrow", "rect"]);
    expect(p.decor.refLines).toEqual([
      { axis: "x", value: 2.5 },
      { axis: "y", value: 1.5 },
    ]);
    expect(p.decor.regionShades).toHaveLength(1);
    expect(p.decor.legend).toEqual({ show: true, position: "se", title: "Runs" });
    // Per-series style vocabulary, so the style sabotage has something to break.
    expect(p.series[0].dash).not.toBeNull();
    expect(p.series[1].dash).not.toBeNull();
    expect(p.series[0].marker).toEqual({ shape: "square", size: 7 });
    expect(p.series[0].fill).toBe("under");
    expect(p.series[1].step).toBe("post");
  });
});

describe("P4.2 regression matrix: multi-panel page", () => {
  const dataset = matrixDataset();
  const figures = pageFigures();
  const page = pageFixture(figures);

  beforeAll(() => {
    useApp.setState({ datasets: [dataset] });
  });

  it("screen ≡ export ≡ reopen on placement, labels, titles and linked layout", async () => {
    const spec = await buildPageSpecFromDocument(page, figures);
    expect(spec).not.toBeNull();
    const screen = projectScreenPage(page, figures);
    const reopen = reopenProject(figures[0], dataset, page);
    expect(reopen.page).not.toBeNull();
    const reopenedFigures = [reopen.figure, ...figures.slice(1)];
    expect(projectExportPage(spec!, page)).toEqual(screen);
    expect(projectReopenPage(reopen.page!, reopenedFigures)).toEqual(screen);
  });

  it("the page projection is non-vacuous: a 2x2 grid, linked axes, auto + overridden labels", () => {
    const screen = projectScreenPage(page, figures);
    expect([screen.rows, screen.cols]).toEqual([2, 2]);
    expect(screen.layout.linkX).toBe(true);
    expect(screen.layout.linkY).toBe(true);
    expect(screen.panels.map((p) => [p.row, p.col])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
    expect(screen.panels.map((p) => p.figure)).toEqual(["panel 0", "panel 1", "panel 2", "panel 3"]);
    expect(screen.resolvedLabels).toEqual(["(a)", "(b)", "(c)", "(iv)"]);
    expect(screen.panels[1].title).toBe("custom panel title");
    expect(screen).toEqual(pageGolden);
  });
});

describe("P4.2 regression matrix: divergences found (documented, NOT fixed here)", () => {
  const dataset = matrixDataset();

  // D1. `FigureDocument.plot.axisBreaks.x` is the canonical home for elided
  // x-ranges. `buildFigureSpecFromDocument` emits it as `overrides.x_breaks`
  // and `parseWorkspace` restores it, but nothing on the canvas reads it: the
  // on-screen paneled break is a TRANSIENT `composition` built by the store's
  // `breakAtGaps` action, and `useEffectiveComposition`'s durable fallback
  // covers `facetKey` only. So a saved figure with breaks reopens with the
  // break in its document, exports with the break, and draws without it.
  it.fails("D1: a document's x-breaks reach export/reopen but never the screen", () => {
    const document = matrixFixture("break");
    expect(projectScreen(document, dataset).xBreaks).toEqual(
      projectExport(document, dataset).xBreaks,
    );
  });

  // D2. `composeDisplayPayload` offsets every series by `view.waterfall`
  // (`lib/plotdata.ts`'s `applyWaterfall`), and the offset round-trips through
  // the document. `FigureSpec` has NO waterfall field (see its interface in
  // `lib/api/figures.ts`), and `buildFigureSpecForView` does not pre-apply the
  // offset to the wire dataset — so exporting a waterfall view produces the
  // overlaid, un-offset curves.
  it.fails("D2: the waterfall offset the canvas applies is absent from the export wire", () => {
    const document = matrixFixture("waterfall");
    expect(projectExport(document, dataset).waterfallOffset).toBe(
      projectScreen(document, dataset).waterfallOffset,
    );
  });

  // D3. A legend rename (`view.seriesLabels[ch]`) REPLACES the whole on-screen
  // label in `lib/uplotOpts.ts` (`args.seriesLabels?.[i] ?? "label (unit)"`),
  // but on the wire it only replaces `dataset.labels[ch]`
  // (`lib/figureSpec.ts`), and the backend still appends the unit
  // (`routes/export_figures.py`'s `_resolve_figure`:
  // `f"{s.label} ({s.unit})"`). A series renamed "Loop 1" therefore appears in
  // the exported legend as "Loop 1 (au)".
  it.fails("D3: a legend rename keeps its unit on export but loses it on screen", () => {
    const renamed = createFigureDocument({
      id: "rename",
      name: "rename",
      datasetId: dataset.id,
      view: {
        ...defaultPlotView(),
        xKey: null,
        yKeys: [0],
        xAxisLabel: "Index",
        yAxisLabel: "Signal (au)",
        seriesLabels: { 0: "Loop 1" },
        seriesStyles: { 0: { width: 2 } },
      },
    });
    expect(projectExport(renamed, dataset).series[0].label).toBe(
      projectScreen(renamed, dataset).series[0].label,
    );
  });

  // D4. The canvas keeps a hidden series in its display list with `show:false`,
  // so later series keep their palette POSITION; the export wire drops hidden
  // channels entirely and `buildExportStyles` is called with `cycle: null`
  // (`buildFigureSpecFromDocument` never opts into `autoSeriesStyles`), so the
  // remaining series are coloured by their FILTERED index. Hiding the first of
  // two series therefore recolours the second one in the PDF but not on screen.
  // This is the same position-skew `SeriesCycle` was introduced to fix for the
  // live Stage export; a saved document's export does not carry it.
  it.fails("D4: hiding a series shifts the palette position of later series on export only", () => {
    const hidden = createFigureDocument({
      id: "hidden",
      name: "hidden",
      datasetId: dataset.id,
      view: {
        ...defaultPlotView(),
        xKey: null,
        yKeys: [0, 1],
        hiddenChannels: [0],
        xAxisLabel: "Index",
        yAxisLabel: "Signal (au)",
        seriesStyles: { 0: { width: 2 }, 1: { width: 1 } },
      },
    });
    expect(projectExport(hidden, dataset).series[0].color).toBe(
      projectScreen(hidden, dataset).series[0].color,
    );
  });
});
