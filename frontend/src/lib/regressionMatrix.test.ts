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
// a test that asserts BOTH concrete values and the fact that they differ. They
// are deliberately NOT `it.fails`: a bare `it.fails` is satisfied by ANY throw,
// so a changed `createFigureDocument` signature would have kept them "green"
// for the wrong reason, and a real fix would flip them to an unexplained
// "unexpected pass". As written, fixing the bug turns the divergence assertion
// red and the fix INVERTS it (`.not.toEqual` becomes `.toEqual`, the two
// pinned values become one) — which is exactly what D1, D2, D3 and D4 below
// now are. Keep this list and the "divergences found" describe title in step:
// the two drifted apart once already (BUG-013's fix updated one, not the other).
//   D1 / BUG-012 x-breaks  — FIXED 2026-09-14. A document's
//                  `plot.axisBreaks.x` reached the export wire and survived
//                  reopen, but nothing on screen rendered it: `PlotView` — the
//                  whole input the canvas is built from — has no field for it.
//                  `useEffectiveComposition`'s durable fallback now derives the
//                  paneled arrangement from the DOCUMENT's canonical field with
//                  the same builder `breakAtGaps` uses, so the `break` fixture
//                  is a full member of the matrix above (screen ≡ export ≡
//                  reopen) and the pin below is the inverted equality.
//   D2 / BUG-013 waterfall — FIXED 2026-09-14. The canvas offsets every series
//                  by `view.waterfall`; `FigureSpec` carried no waterfall field
//                  at all, so the export drew the un-offset curves. The wire
//                  now carries `waterfall_offsets` (resolved by
//                  `lib/waterfallOffset.ts`, applied by
//                  `calc.plotting.apply_waterfall_offsets`), the `waterfall`
//                  fixture is a full member of the matrix above, and the pin
//                  below is the inverted equality.
//   D3 / BUG-014 rename    — FIXED 2026-09-15. A legend rename replaced the
//                  whole on-screen label (unit and all) but only
//                  `dataset.labels[ch]` on the wire, which the backend re-joined
//                  with the untouched unit, so the exported legend read
//                  "Loop 1 (au)". The rename now rides its own per-series
//                  PRESENTATION field (`series_styles[i].legend`, used verbatim
//                  by `calc.figure_labels.series_display_name`) with the data's
//                  own label/unit left intact, and the pin below is the
//                  inverted equality.
//   D4 / BUG-015 hidden    — FIXED 2026-09-14. Hiding a series used to shift
//                  every later series' palette colour on the exported figure
//                  but not on the canvas; `lib/figureSpec.ts` now derives the
//                  UNFILTERED display position for every producer, so the
//                  `hidden` fixture is a full member of the matrix above
//                  (screen ≡ export ≡ reopen) and the pin below is the
//                  inverted equality.
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
import hiddenGolden from "./__fixtures__/regressionMatrix/hidden.json";
import pageGolden from "./__fixtures__/regressionMatrix/page.json";
import plainGolden from "./__fixtures__/regressionMatrix/plain.json";
import waterfallGolden from "./__fixtures__/regressionMatrix/waterfall.json";
import y2Golden from "./__fixtures__/regressionMatrix/y2.json";

import { buildPageSpecFromDocument } from "../components/workshops/figurepage/panelResolve";
import { useApp } from "../store/useApp";
import { breakPanelsOf } from "./composition";
import { durableComposition } from "./facet";
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
  hidden: hiddenGolden,
};

/** Fixtures on which a leg is KNOWN to disagree, naming the field and which
 *  comparisons it spoils. The narrowed equality test below drops exactly that
 *  field from those comparisons; the "divergences found" block at the bottom
 *  pins each divergence's two CONCRETE values, so this table can never be
 *  quietly widened to make a regression go away.
 *
 *  `break` USED to spoil both comparisons — the screen was the odd leg out,
 *  rendering nothing from `axisBreaks.x` (BUG-012) — and `waterfall` used to
 *  narrow the export comparison (BUG-013). Both are fixed, so no fixture
 *  carries any narrowing today and every one compares field-for-field like
 *  `plain`; the table stays so a future divergence has one honest place to
 *  be recorded.
 *
 *  KEPT, NOT DELETED (BUG-012 review NIT 8), because the alternative is that
 *  the next person to find a divergence has to re-derive both the narrowing
 *  shape and the rule that the concrete values get pinned separately — the
 *  thing this table exists to stop being re-litigated. With the table empty
 *  the `else` branch below is unreachable, so `without()` is exercised
 *  directly by its own test at the end of this file instead of being dead
 *  code nothing has ever run. */
type Leg = "export" | "reopen";
const DIVERGENT: Partial<Record<MatrixFixtureName, { field: keyof CanonicalFigure; legs: Leg[] }>> = {};

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

  it("hidden — the hidden channel is drawn by nobody, and the survivors keep their slots", () => {
    const p = projectScreen(matrixFixture("hidden"), dataset);
    expect(p.series.map((s) => s.channel)).toEqual([1, 2]);
    // Their WIDTHS prove the fixture really styles all three channels (so the
    // colour claim below is about position, not about there being one style).
    expect(p.series.map((s) => s.width)).toEqual([1, 3]);
    expect(p.series.map((s) => s.color)).toEqual([TEST_SERIES_PALETTE[1], TEST_SERIES_PALETTE[2]]);
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
describe("P4.2 regression matrix: divergences found (D1, D2, D3 and D4 since FIXED, see below)", () => {
  const dataset = matrixDataset();

  // BUG-012 (D1, FIXED 2026-09-14). `FigureDocument.plot.axisBreaks.x` is the
  // canonical home for elided x-ranges. `buildFigureSpecFromDocument` emits it
  // as `overrides.x_breaks` and `parseWorkspace` restores it; the canvas now
  // renders it too, through `useEffectiveComposition`'s durable fallback
  // (`lib/facet.breakCompositionFromBreaks` — the same builder the store's
  // live `breakAtGaps` gesture constructs its arrangement with). A plot
  // window's live view is still ONLY
  // `figureDocumentToPlotView(window.document)` (`store/windowDocuments.ts`)
  // and `PlotView` still has no break field — deliberately: the fix reads the
  // DOCUMENT's canonical field rather than adding a second persisted home for
  // the same ranges.
  it("BUG-012: a saved x-break reaches export, reopen AND the screen it is drawn on", () => {
    const figure = matrixFixture("break");
    expect(projectExport(figure, dataset).xBreaks).toEqual([[2, 3]]);
    expect(projectReopen(reopenProject(figure, dataset)).xBreaks).toEqual([[2, 3]]);
    expect(projectScreen(figure, dataset).xBreaks).toEqual([[2, 3]]);

    // The screen leg's value is MEASURED from the panel geometry it renders
    // (`screenXBreaks`), not read off the document — `PlotView` still cannot
    // carry a break, which is why the arrangement has to be derived from the
    // document's own canonical field.
    const rebuilt = createFigureDocument({
      id: figure.id,
      name: figure.name,
      datasetId: "matrix-ds",
      view: figureDocumentToPlotView(figure),
    });
    expect(figure.plot.axisBreaks.x).toEqual([[2, 3]]);
    expect(rebuilt.plot.axisBreaks.x).toEqual([]);
    expect(projectScreen(figure, dataset).xBreaks).toEqual(
      projectExport(figure, dataset).xBreaks,
    );
  });

  /** The `break` fixture with its endpoints moved OFF the sample grid. */
  const offGridBreakFigure = (): FigureDocument =>
    createFigureDocument({
      id: "break-off-grid",
      name: "break off-grid",
      datasetId: "matrix-ds",
      view: figureDocumentToPlotView(matrixFixture("break")),
      axisBreaks: { x: [[2.2, 2.8]] },
    });

  // BUG-012 review F2. The committed `break` fixture elides `[2, 3]` — both
  // endpoints are sample points (x runs 0..5 in steps of 1), which is the ONE
  // shape in which "the segment's own data extent" and "the break bound"
  // coincide. Every `suggestBreaks` output has that shape by construction
  // (`[finite[i], finite[i + 1]]`), so the live `breakAtGaps` gesture never
  // exposed the difference — but the Figure Builder's breaks panel and a plot
  // recipe, the only writers of `plot.axisBreaks.x`, do not constrain the
  // values at all. Measured before the fix: screen elided `(2, 3)` with panel
  // widths 2 : 2 while the export elided `(2.2, 2.8)` with widths 2.2 : 2.2.
  it("BUG-012 review F2: a break whose endpoints are NOT data points elides the same range on every leg", () => {
    const offGrid = offGridBreakFigure();
    expect(projectExport(offGrid, dataset).xBreaks).toEqual([[2.2, 2.8]]);
    expect(projectReopen(reopenProject(offGrid, dataset)).xBreaks).toEqual([[2.2, 2.8]]);
    expect(projectScreen(offGrid, dataset).xBreaks).toEqual([[2.2, 2.8]]);

    // …and the PANEL RANGES themselves, which is the quantity the two legs
    // actually disagreed on (`xBreaks` only measures the interior pair). This
    // list IS `calc/figure_break.render_breaks_impl`'s `bounds`: `lo` starts
    // at the data min (0), each break contributes `(lo, b0)` and sets
    // `lo = b1`, and the last panel runs to the data max (5). Each exported
    // panel gets it as `ax.set_xlim(lo, hi)` and is sized by `hi - lo`.
    const panels = breakPanelsOf(
      durableComposition(dataset, null, offGrid.plot.axisBreaks.x, null, [0]),
    );
    expect(panels?.map((p) => p.xRange)).toEqual([
      [0, 2.2],
      [2.8, 5],
    ]);
  });

  // BUG-012 review NIT 14. Facet-beats-break was asserted on the screen leg
  // only (`useEffectiveComposition.test.tsx`'s PRECEDENCE case); that the
  // EXPORT resolves it the same way lived in prose. No fixture carried both,
  // so this builds one: `facet`'s own view plus the `break` fixture's ranges.
  it("BUG-012: facet beats break on the EXPORT leg too, not just on screen", () => {
    const both = createFigureDocument({
      id: "facet-and-break",
      name: "facet+break",
      datasetId: "matrix-ds",
      view: figureDocumentToPlotView(matrixFixture("facet")),
      facetKey: 7,
      axisBreaks: { x: [[2, 3]] },
    });
    expect(projectExport(both, dataset)).toEqual(projectScreen(both, dataset));
    // Non-vacuous: BOTH legs report a facet grid and NO break, and the wire
    // still carries the ranges — the facet renderer simply never reads them
    // (`calc/figure_facets` applies only `lim_keys=("x_lim",)`), which is
    // exactly why the document may keep them.
    expect(projectScreen(both, dataset).facet.panels).toHaveLength(2);
    expect(projectScreen(both, dataset).xBreaks).toEqual([]);
    expect(projectExport(both, dataset).xBreaks).toEqual([]);
    expect(buildFigureSpecFromDocument(both, dataset, both.name).overrides?.x_breaks).toEqual([[2, 3]]);
  });

  // BUG-013 (D2), FIXED. `composeDisplayPayload` offsets every series by
  // `view.waterfall` (`lib/plotdata.ts`'s `applyWaterfall`, a fraction of the
  // y-range); `FigureSpec` now carries that same resolved offset per plotted
  // series (`waterfall_offsets`, built by `lib/waterfallOffset.ts` from the
  // SAME display list and the SAME unpruned values), so the exported figure
  // staggers by exactly what the screen shows.
  it("BUG-013: the export wire carries the canvas' 0.8125 waterfall offset", () => {
    const figure = matrixFixture("waterfall");
    expect(projectScreen(figure, dataset).waterfallOffset).toBeCloseTo(0.8125, 10);
    // The wire is HONEST about it: the offset is its own field and the dataset
    // values reach the backend un-shifted (`2.25`, row 1 of channel 1), so any
    // data-table/CSV path sharing this spec still sees the real numbers.
    const spec = buildFigureSpecFromDocument(figure, dataset, figure.name);
    expect(spec.waterfall_offsets).toEqual([0, 0.8125]);
    expect(spec.dataset.values[1][1]).toBe(2.25);
    expect(projectExport(figure, dataset).waterfallOffset).toBeCloseTo(
      projectScreen(figure, dataset).waterfallOffset,
      10,
    );
  });

  // BUG-014 (D3), FIXED 2026-09-15 — this is the divergence assertion INVERTED.
  // A legend rename (`view.seriesLabels[ch]`) REPLACES the whole on-screen
  // label in `lib/uplotOpts.ts` (`args.seriesLabels?.[i] ?? "label (unit)"`).
  // It used to reach the wire as a rewritten `dataset.labels[ch]` with
  // `dataset.units[ch]` untouched beside it, and the backend re-joined the two
  // (`f"{s.label} ({s.unit})"`), so "Loop 1" exported as "Loop 1 (au)". The
  // rename now rides its own per-series presentation field,
  // `series_styles[i].legend`, which `calc.figure_labels.series_display_name`
  // uses VERBATIM.
  it("BUG-014: a renamed series reads the SAME legend text on screen and in the export", () => {
    const renamed = renamedFigure();
    expect(projectScreen(renamed, dataset).series[0].label).toBe("Loop 1");
    expect(projectExport(renamed, dataset).series[0].label).toBe(
      projectScreen(renamed, dataset).series[0].label,
    );
    // The wire's own bytes, not the projection's reading of them: the DATA's
    // label and unit are both intact — a rename is a presentation choice, not
    // a data edit — and the rename itself is the presentation field.
    const spec = buildFigureSpecFromDocument(renamed, dataset, renamed.name);
    expect(spec.dataset.labels[0]).toBe("Signal");
    expect(spec.dataset.units[0]).toBe("au");
    expect(spec.series_styles?.[0]?.legend).toBe("Loop 1");
    // Non-vacuous: the derived form the backend would otherwise compose from
    // those same bytes is a DIFFERENT string, which is what the bug shipped.
    expect(projectScreen(renamed, dataset).series[0].label).not.toBe(
      `${spec.dataset.labels[0]} (${spec.dataset.units[0]})`,
    );
  });

  // BUG-015 (D4), FIXED 2026-09-14 — this is the divergence assertion INVERTED.
  // The canvas keeps a hidden series in its display list with `show:false`, so
  // later series keep their palette POSITION; the export wire drops hidden
  // channels entirely. `lib/figureSpec.ts` now derives each survivor's position
  // in the UNFILTERED display list unconditionally and hands it to
  // `buildExportStyles`, so a saved document — which never opts into
  // `autoSeriesStyles` — is coloured by display position like the canvas rather
  // than by its own filtered index.
  it("BUG-015: hiding a series leaves the survivors on palette slots 1 and 2 on BOTH screen and export", () => {
    const hidden = matrixFixture("hidden");
    // Both legs draw exactly the two survivors (channels 1 and 2).
    expect(projectScreen(hidden, dataset).series.map((s) => s.channel)).toEqual([1, 2]);
    expect(projectExport(hidden, dataset).series.map((s) => s.channel)).toEqual([1, 2]);
    // The screen leg paints the survivors on slots 1 and 2 — their ORIGINAL
    // positions, not the 0 and 1 the filtered index would give them. That
    // measured pin is what makes the leg-to-leg equality below non-vacuous.
    expect(projectScreen(hidden, dataset).series.map((s) => s.color)).toEqual([
      TEST_SERIES_PALETTE[1],
      TEST_SERIES_PALETTE[2],
    ]);
    // A FIXTURE guard, not a product one (review NIT 5): it only says the
    // palette installed above gives slots 0-2 three distinct paints, so the
    // pin one line up could have failed. It compares two literal constants
    // and can never see a product regression.
    expect([TEST_SERIES_PALETTE[1], TEST_SERIES_PALETTE[2]]).not.toEqual([
      TEST_SERIES_PALETTE[0],
      TEST_SERIES_PALETTE[1],
    ]);
    expect(projectExport(hidden, dataset).series.map((s) => s.color)).toEqual(
      projectScreen(hidden, dataset).series.map((s) => s.color),
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


// BUG-012 review NIT 8: `DIVERGENT` is empty today, so the narrowed-equality
// `else` branch above never runs and `without()` would be code nothing has
// ever executed — the next person to record a divergence would be the first
// to find out whether it works. One synthetic entry, exercised directly.
describe("the DIVERGENT narrowing machinery still works while the table is empty", () => {
  it("without() drops exactly the named field and leaves the rest identical", () => {
    const figure = projectScreen(matrixFixture("break"), matrixDataset());
    const narrowed = without(figure, "xBreaks");
    expect(figure.xBreaks).toEqual([[2, 3]]);
    expect("xBreaks" in narrowed).toBe(false);
    expect(narrowed).toEqual(without({ ...figure, xBreaks: [[9, 9]] }, "xBreaks"));
    // …and narrowing on a DIFFERENT field still sees the break, so the helper
    // is not simply dropping everything.
    expect(without(figure, "waterfallOffset").xBreaks).toEqual([[2, 3]]);
  });
});
