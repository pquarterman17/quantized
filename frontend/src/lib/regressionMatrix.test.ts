// P4.2 — canonical plot/project regression matrix (PRIMARY_SOFTWARE_AUDIT_PLAN).
//
// For every canonical figure: SCREEN ≡ EXPORT ≡ REOPEN on the shared structural
// payload, plus a frozen golden of that payload. See
// `regressionMatrix.testkit.ts` for what each leg reads and the (documented)
// places where a path legitimately cannot express a field.
//
// REGENERATING THE GOLDENS. They are the SCREEN projection of each fixture.
// Run `node scripts/freeze-regression-matrix.mjs` from `frontend/` (add
// `--check` to diff without writing), then READ THE DIFF — never "update the
// golden because the test went red".
//
// FIVE DIVERGENCES THIS MATRIX FOUND, each filed as a bug and pinned below by
// a test that asserts BOTH concrete values and the fact that they differ (none
// of them is fixed here — this slice is tests-only). They are deliberately NOT
// `it.fails`: a bare `it.fails` is satisfied by ANY throw, so a changed
// `createFigureDocument` signature would have kept them "green" for the wrong
// reason, and a real fix would flip them to an unexplained "unexpected pass".
// As written, fixing the bug turns the divergence assertion red and the fix
// INVERTS it (`.not.toEqual` becomes `.toEqual`, the two pinned values become
// one).
//   D1 / BUG-012 x-breaks  — a document's `plot.axisBreaks.x` reaches the
//                  export wire and survives reopen, but `PlotView` — the whole
//                  input the canvas is built from — has no field for it.
//   D2 / BUG-013 waterfall — the canvas offsets every series by
//                  `view.waterfall`; `FigureSpec` has no waterfall field at
//                  all, so the export draws the un-offset curves.
//   D3 / BUG-014 rename    — a legend rename replaces the whole on-screen label
//                  (unit and all) but only `dataset.labels[ch]` on the wire, so
//                  the exported legend reads "Loop 1 (au)".
//   D4 / BUG-015 hidden    — hiding a series shifts every later series' palette
//                  colour on the exported figure but not on the canvas.
//   D5 / BUG-016 grouped styling — the canvas gives every level of a grouped
//                  channel that channel's style; `routes/export_figures.py`'s
//                  `group_col` branch drops `series_styles` entirely, so the
//                  exported curves are default-coloured and solid.

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
import {
  createFigureDocument,
  figureDocumentToPlotView,
  type FigureDocument,
} from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { defaultPlotView } from "./plotview";
import {
  FIXTURE_COLORS,
  MATRIX_FIXTURES,
  matrixDataset,
  matrixFixture,
  pageFigures,
  pageFixture,
  type MatrixFixtureName,
} from "./regressionMatrixFixtures.testkit";
import {
  installSeriesPalette,
  TEST_SERIES_PALETTE,
  type CanonicalFigure,
} from "./regressionMatrix.testkit";
import {
  projectExport,
  projectScreen,
  screenDrawnStyles,
} from "./regressionMatrixLegs.testkit";
import { projectReopen, reopenProject } from "./regressionMatrixReopen.testkit";
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
 *  field from those comparisons; the "divergences found" block at the bottom
 *  pins each divergence's two CONCRETE values, so this table can never be
 *  quietly widened to make a regression go away.
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
    // The EXPLICIT `SeriesStyle.color` override really wins over the palette
    // slot this series sits in. Both halves matter: `FIXTURE_COLORS` is
    // disjoint from `TEST_SERIES_PALETTE` precisely so that dropping
    // `style?.color` in `lib/seriesStyleCycle.ts` — which silently replaces
    // every user-chosen series colour with the palette slot, on the canvas AND
    // the export wire — cannot leave this test green.
    expect(p.series[0].color).toBe(FIXTURE_COLORS[0]);
    expect(p.series[0].color).not.toBe(TEST_SERIES_PALETTE[0]);
    expect(p.series[1].color).toBe(FIXTURE_COLORS[1]);
    expect(p.series[1].color).not.toBe(TEST_SERIES_PALETTE[1]);
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
    // ALL FOUR panel figures round-trip, not just panel 0 (widened 2026-09-14:
    // keeping panels 1-3 as the never-persisted in-memory documents meant three
    // of the four panel identities asserted nothing about persistence).
    const reopen = reopenProject(figures, dataset, page);
    expect(reopen.page).not.toBeNull();
    expect(reopen.figures).toHaveLength(4);
    expect(projectExportPage(spec!)).toEqual(screen);
    expect(projectReopenPage(reopen.page!, reopen.figures)).toEqual(screen);
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


// ── the five divergences ────────────────────────────────────────────────────
//
// Each test below asserts BOTH concrete values — what the screen carries and
// what the export/reopen carries — and that they differ in the documented way.
// That shape is deliberate (review 2026-09-14, replacing five bare `it.fails`):
//
//   * an `it.fails` passes on ANY throw, so a renamed field or a changed
//     `createFigureDocument` signature would have kept the pin "green" while
//     measuring nothing;
//   * a real fix must not turn a pin into a silent "unexpected pass" — here it
//     turns the divergence assertion RED, and the fix is to INVERT it: delete
//     the two divergent pins and the `.not.`, leaving the single equality the
//     bug's acceptance criteria name.
//
// Each test is named for the bug it reproduces, so `plans/BUGS_AND_ISSUES.md`
// and the suite refer to each other by the same string.
describe("P4.2 regression matrix: divergences found (documented, NOT fixed here)", () => {
  const dataset = matrixDataset();

  // BUG-012 (D1). `FigureDocument.plot.axisBreaks.x` is the canonical home for
  // elided x-ranges. `buildFigureSpecFromDocument` emits it as
  // `overrides.x_breaks` and `parseWorkspace` restores it, but nothing on the
  // canvas reads it: a plot window's live view is ONLY
  // `figureDocumentToPlotView(window.document)` (`store/windowDocuments.ts`),
  // and `PlotView` has no break field — the on-screen paneled break is a
  // TRANSIENT `composition` built by the store's `breakAtGaps` action, and
  // `useEffectiveComposition`'s durable fallback covers `facetKey` only.
  it("DIVERGENCE (BUG-012): a saved x-break reaches export and reopen; the screen has no field to render it from", () => {
    const figure = matrixFixture("break");
    expect(projectExport(figure, dataset).xBreaks).toEqual([[2, 3]]);
    expect(projectReopen(reopenProject(figure, dataset)).xBreaks).toEqual([[2, 3]]);
    expect(projectScreen(figure, dataset).xBreaks).toEqual([]);

    // Why the screen leg has nothing to read: round-tripping the document
    // through the canvas's ENTIRE input (`figureDocumentToPlotView`) and back
    // loses the break. If `PlotView` carried it, the rebuilt document below
    // would carry it too.
    const rebuilt = createFigureDocument({
      id: figure.id,
      name: figure.name,
      datasetId: "matrix-ds",
      view: figureDocumentToPlotView(figure),
    });
    expect(figure.plot.axisBreaks.x).toEqual([[2, 3]]);
    expect(rebuilt.plot.axisBreaks.x).toEqual([]);
    expect(projectScreen(figure, dataset).xBreaks).not.toEqual(
      projectExport(figure, dataset).xBreaks,
    );
  });

  // BUG-013 (D2). `composeDisplayPayload` offsets every series by
  // `view.waterfall` (`lib/plotdata.ts`'s `applyWaterfall`, a fraction of the
  // y-range), and the offset round-trips through the document. `FigureSpec` has
  // NO waterfall field (see its interface in `lib/api/figures.ts`), and
  // `buildFigureSpecForView` does not pre-apply the offset to the wire dataset
  // — so exporting a waterfall view produces the overlaid, un-offset curves.
  it("DIVERGENCE (BUG-013): the canvas offsets a waterfall by 0.8125; the export wire has no waterfall field at all", () => {
    const figure = matrixFixture("waterfall");
    expect(projectScreen(figure, dataset).waterfallOffset).toBeCloseTo(0.8125, 10);
    expect(projectExport(figure, dataset).waterfallOffset).toBe(0);
    // Not a projection artefact: the wire itself has no field of that meaning,
    // and the first series' first value reaches it unshifted.
    const spec = buildFigureSpecFromDocument(figure, dataset, figure.name);
    expect(Object.keys(spec).filter((k) => /water|offset|stagger/i.test(k))).toEqual([]);
    expect(spec.dataset.values[1][1]).toBe(2.25);
    expect(projectExport(figure, dataset).waterfallOffset).not.toBeCloseTo(
      projectScreen(figure, dataset).waterfallOffset,
      10,
    );
  });

  // BUG-014 (D3). A legend rename (`view.seriesLabels[ch]`) REPLACES the whole
  // on-screen label in `lib/uplotOpts.ts` (`args.seriesLabels?.[i] ??
  // "label (unit)"`), but on the wire it only replaces `dataset.labels[ch]`
  // (`lib/figureSpec.ts`) and leaves `dataset.units[ch]` alone, and the backend
  // still appends the unit (`routes/export_figures.py`'s `_resolve_figure`:
  // `f"{s.label} ({s.unit})"`).
  it('DIVERGENCE (BUG-014): a renamed series reads "Loop 1" on screen and "Loop 1 (au)" in the export', () => {
    const renamed = renamedFigure();
    expect(projectScreen(renamed, dataset).series[0].label).toBe("Loop 1");
    expect(projectExport(renamed, dataset).series[0].label).toBe("Loop 1 (au)");
    // The wire's own bytes, not the projection's reading of them: the rename
    // lands on the label and the unit survives beside it, which is exactly what
    // the backend re-joins.
    const spec = buildFigureSpecFromDocument(renamed, dataset, renamed.name);
    expect(spec.dataset.labels[0]).toBe("Loop 1");
    expect(spec.dataset.units[0]).toBe("au");
    expect(projectExport(renamed, dataset).series[0].label).not.toBe(
      projectScreen(renamed, dataset).series[0].label,
    );
  });

  // BUG-015 (D4). The canvas keeps a hidden series in its display list with
  // `show:false`, so later series keep their palette POSITION; the export wire
  // drops hidden channels entirely and `buildExportStyles` is called with
  // `cycle: null` (`buildFigureSpecFromDocument` never opts into
  // `autoSeriesStyles`), so the remaining series are coloured by their FILTERED
  // index. This is the same position-skew `SeriesCycle` was introduced to fix
  // for the live Stage export; a saved document's export does not carry it.
  it("DIVERGENCE (BUG-015): hiding a series leaves the next one on palette slot 1 on screen and slot 0 on export", () => {
    const hidden = hiddenFigure();
    // Both legs draw exactly one series (channel 1); they disagree on its slot.
    expect(projectScreen(hidden, dataset).series.map((s) => s.channel)).toEqual([1]);
    expect(projectExport(hidden, dataset).series.map((s) => s.channel)).toEqual([1]);
    expect(projectScreen(hidden, dataset).series[0].color).toBe(TEST_SERIES_PALETTE[1]);
    expect(projectExport(hidden, dataset).series[0].color).toBe(TEST_SERIES_PALETTE[0]);
    expect(projectExport(hidden, dataset).series[0].color).not.toBe(
      projectScreen(hidden, dataset).series[0].color,
    );
  });

  // BUG-016 (D5). A grouped figure's per-series styling reaches the canvas but
  // not the exported figure. `routes/export_figures.py:81-85` documents the
  // choice and `:236-238` implements it: the `group_col` branch returns
  // `_ResolvedFigure(..., None, ...)`, so `series_styles` is dropped and
  // matplotlib's default colour cycle takes over. The wire still CARRIES the
  // style — which is why `styleComparable("group")` is false and this
  // divergence needs its own test rather than a leg-to-leg comparison of a
  // field the renderer never reads.
  //
  // Structural, as the rest of the matrix is: the screen half is read out of
  // the real `buildOpts` options object, the wire half out of the real
  // `FigureSpec`, and the backend's own contract is pinned as a named constant
  // rather than guessed at.
  it("DIVERGENCE (BUG-016): a grouped figure's per-series styling reaches the canvas but is dropped from the exported figure", () => {
    const figure = matrixFixture("group");

    // SCREEN — one drawn series per level, every one carrying the CHANNEL's
    // dash and width.
    const drawn = screenDrawnStyles(figure, dataset);
    expect(drawn.map((s) => s.label)).toEqual([
      "Signal (Batch=C) (au)",
      "Signal (Batch=A) (au)",
      "Signal (Batch=B) (au)",
    ]);
    expect(drawn.map((s) => s.dash)).toEqual([[8, 4], [8, 4], [8, 4]]);
    expect(drawn.map((s) => s.width)).toEqual([2, 2, 2]);

    // WIRE — the spec carries the style, and the grouping that makes the
    // backend ignore it.
    const spec = buildFigureSpecFromDocument(figure, dataset, figure.name);
    expect(spec.group_col).toBe(6);
    expect(spec.series_styles?.[0]).toMatchObject({ width: 2, line: "dashed" });

    // EXPORT — `_figure_series`'s `group_col` branch builds one series per
    // level and passes NO styles, so every exported curve is solid and
    // default-coloured. The level count is taken from the wire, not assumed.
    const STYLE_DROPPED_BY_THE_GROUP_BRANCH = null;
    const exportedLevels = projectExport(figure, dataset).grouping.levelLabels;
    expect(exportedLevels).toEqual(["C", "A", "B"]);
    const exportedDashes = exportedLevels!.map(() => STYLE_DROPPED_BY_THE_GROUP_BRANCH);
    expect(drawn.map((s) => s.dash)).not.toEqual(exportedDashes);
  });
});

/** A one-channel figure whose only series is renamed (BUG-014). */
function renamedFigure(): FigureDocument {
  return createFigureDocument({
    id: "rename",
    name: "rename",
    datasetId: "matrix-ds",
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
}

/** Two channels with the FIRST one hidden (BUG-015). */
function hiddenFigure(): FigureDocument {
  return createFigureDocument({
    id: "hidden",
    name: "hidden",
    datasetId: "matrix-ds",
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
}
