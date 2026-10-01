// P4.2 regression matrix, SCREEN-CANVAS half (PRIMARY_SOFTWARE_AUDIT_PLAN,
// "Visual (rendered-output) equivalence for the same nine fixtures"). The
// vitest matrix (`src/lib/regressionMatrix.test.ts`) proves the uPlot OPTIONS
// object agrees with the export wire and the reopened document; the export
// half of this box reads the rendered SVG/PNG back (`tests/test_export_visual_
// matrix_*.py`). Nothing checked that the canvas actually DRAWS what the
// options say. This spec does, in a real Chromium against the real backend.
//
// Each fixture is built by the SAME testkit the vitest matrix uses, opened the
// way a user reopens a saved figure (`openEditableFigure`), and compared with
// its committed golden — the structural projection both other legs already
// agree with. What is read back, and from where (see `utils/canvasRecorder.ts`
// for why draw calls rather than pixel snapshots):
//   * series lines (count, stroke colour, width, dash) and their VERTICES, mapped
//     back to data through the axis the canvas itself labelled;
//   * tick labels per axis (x / y / y2), their span, and that they sit on the
//     plotting rect's edges; axis titles; the plot title;
//   * error whiskers, markers, step, fill, annotations, reference lines,
//     shapes, region shade; break seams; facet panel count and titles;
//   * the DOM legend (labels, swatch colour, dash, marker, struck-through hidden
//     row, corner) — plus a handful of sampled pixels proving the recorded
//     strokes are what is painted.
//
// SCREEN-ONLY DIFFERENCES this spec measured and pins by value (flip the pin
// when one is fixed), each named in the test that pins it:
//   S1 facet  — the fixture binds `facetKey` with `stackMode: false`; the canvas
//               gates the facet grid on `stackMode` (`multiPanelShowing`) and
//               draws ONE overlaid plot, while the export facets on `facetKey`
//               alone. The UI's own facet gesture sets both, so the grid itself
//               is checked with `stackMode: true`.
//   S2 break  — break panels are built without the view's `seriesStyles`
//               (`useMultiPanelStage`'s break `cell`), so an explicit width 2
//               draws at the default 1.5.
//   S3 decor  — the interactive legend shows no `legendTitle`; only the static
//               (Origin) legend renders one.
// Untagged (no canvas hit-testing): runs at the 100% project only.

import { expect, test, type Page } from "@playwright/test";

import { TEST_SERIES_PALETTE, type CanonicalFigure } from "../../src/lib/regressionMatrix.testkit";
import { matrixData, matrixFixture, type MatrixFixtureName } from "../../src/lib/regressionMatrixFixtures.testkit";
import type { FigureDocument } from "../../src/lib/figureDocument";
import { installCanvasRecorder, type DrawOp } from "../utils/canvasRecorder";
import { gotoApp } from "../utils/harness";
import {
  axesOf, golden, openFixture, pixelDistance, ROWS, seriesLines, settledScreen,
  type Axes, type Panel, type Screen, type Tick,
} from "../utils/matrixScreen";

const LABELS = matrixData().labels;

/** ONE load per test: a second `gotoApp` in the same context restores the
 *  first load's autosave ("restored 1 dataset from autosave") on top. */
async function load(page: Page, name: MatrixFixtureName, edit?: (d: FigureDocument) => void): Promise<FigureDocument> {
  await installCanvasRecorder(page);
  await gotoApp(page);
  const doc = matrixFixture(name);
  edit?.(doc);
  await openFixture(page, doc);
  return doc;
}

/** value -> canvas px along an axis, from the canvas' own first/last tick. */
const toPx = (t: Tick[]) => (v: number) => t[0].at + ((v - t[0].value) * (t[t.length - 1].at - t[0].at)) / (t[t.length - 1].value - t[0].value);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** An axis' tick labels span exactly `lim`, ascending, and the end labels sit
 *  on the plotting rect's edges (so the label IS the drawn limit). */
function expectSpan(t: Tick[], lim: [number, number] | null, p: Panel, dir: "x" | "y"): void {
  expect(t.length, `${dir} tick labels drawn`).toBeGreaterThan(2);
  if (!lim) return;
  expect([t[0].value, t[t.length - 1].value], `${dir} tick span`).toEqual(lim);
  const [lo, hi] = dir === "x" ? [p.rect.left, p.rect.left + p.rect.width] : [p.rect.top + p.rect.height, p.rect.top];
  expect(near(t[0].at, lo, 1.5 * p.dpr) && near(t[t.length - 1].at, hi, 1.5 * p.dpr), `${dir} end ticks on the frame`).toBe(true);
}

function expectStyles(lines: DrawOp[], g: CanonicalFigure): void {
  expect(lines.map((l) => l.style), "stroke colours").toEqual(g.series.map((s, i) => s.color ?? lines[i]?.style));
  expect(lines.map((l) => l.width), "stroke widths").toEqual(g.series.map((s) => s.width));
  expect(lines.map((l) => l.dash), "dash patterns").toEqual(g.series.map((s) => s.dash ?? []));
}

/** Every expected (row, value) point has a drawn vertex within 1.5 px. */
function expectPoints(line: DrawOp, xs: Tick[], ys: Tick[], rows: number[], value: (r: number) => number, dpr: number, what: string): void {
  const [fx, fy] = [toPx(xs), toPx(ys)];
  for (const r of rows) {
    const hit = line.pts.some(([x, y]) => near(x, fx(r), 1.5 * dpr) && near(y, fy(value(r)), 1.5 * dpr));
    expect(hit, `${what}: vertex for row ${r} (${value(r)})`).toBe(true);
  }
}

/** Flat figures: each series' vertices are its channel's rows, on its own
 *  axis, plus the waterfall step the golden measured for that position. */
function expectData(lines: DrawOp[], ax: Axes, g: CanonicalFigure, dpr: number): void {
  const rows = ROWS.map((_r, i) => i);
  g.series.forEach((s, i) => {
    if (!s.step) expect(lines[i].pts.length, `series ${i} vertex count`).toBe(rows.length);
    expectPoints(lines[i], ax.x, s.axis === 1 ? ax.y2 : ax.y, rows, (r) => ROWS[r][s.channel] + g.waterfallOffset * i, dpr, `series ${i} (ch ${s.channel})`);
  });
}

function expectLegend(screen: Screen, g: CanonicalFigure, colors: (string | null)[]): void {
  expect(screen.legend, "legend shown").not.toBeNull();
  expect(screen.legend!.className.split(/\s+/)).toContain(g.decor.legend.position);
  const drawn = screen.legend!.rows.filter((r) => !r.struck);
  expect(drawn.map((r) => r.label), "legend labels").toEqual(g.series.map((s) => s.label));
  expect(drawn.map((r) => r.swatch), "legend swatch = stroke").toEqual(colors);
}

function expectFlatAxes(p: Panel, g: CanonicalFigure): Axes {
  const ax = axesOf(p);
  expectSpan(ax.x, g.axes.x.limits, p, "x");
  expectSpan(ax.y, g.axes.y.limits, p, "y");
  expect(ax.xTitle, "x title").toEqual([g.axes.x.label]);
  expect(ax.yTitle, "y title").toEqual([g.axes.y.label]);
  if (g.axes.y2) expectSpan(ax.y2, g.axes.y2.limits, p, "y");
  else expect(ax.y2, "no right-hand axis").toEqual([]);
  expect(ax.y2Title, "y2 title").toEqual(g.axes.y2 ? [g.axes.y2.label] : []);
  return ax;
}

/** The common flat-figure check: one panel, title, styles, axes, data, legend. */
async function checkFlat(page: Page, name: MatrixFixtureName): Promise<{ s: Screen; ax: Axes; lines: DrawOp[]; g: CanonicalFigure }> {
  const g = golden(name);
  const doc = await load(page, name);
  const s = await settledScreen(page, 1, [g.series.length]);
  const p = s.panels[0];
  expect(p.title, "plot title").toBe(doc.plot.view.plotTitle);
  const lines = seriesLines(p);
  expectStyles(lines, g);
  const ax = expectFlatAxes(p, g);
  expectData(lines, ax, g, p.dpr);
  expectLegend(s, g, lines.map((l) => l.style));
  return { s, ax, lines, g };
}

/** Distance from `color` at the midpoint of a line's first segment. */
function midSample(page: Page, line: DrawOp, color: string): Promise<number> {
  const [[x0, y0], [x1, y1]] = line.pts;
  return pixelDistance(page, 0, (x0 + x1) / 2, (y0 + y1) / 2, color);
}

test.describe("P4.2 regression matrix — screen canvas", () => {
  test("plain: two series, palette strokes, axes and legend as the golden", async ({ page }) => {
    const { lines, g } = await checkFlat(page, "plain");
    expect(await midSample(page, lines[0], g.series[0].color!), "series 1 painted in its colour").toBeLessThan(40);
  });

  test("errors: symmetric, asymmetric and x whiskers at every point", async ({ page }) => {
    const { s, ax, g } = await checkFlat(page, "errors");
    const p = s.panels[0];
    const whiskers = p.ops.filter((o) => o.op === "stroke" && o.moves === 1 && o.pts.length === 2 && o.dash.length === 0);
    const segs = whiskers.map((o) => o.pts);
    const [fx, fy] = [toPx(ax.x), toPx(ax.y)];
    const tol = 1.5 * p.dpr;
    const has = (a: [number, number], b: [number, number]) =>
      segs.some(([u, v]) => (near(u[0], a[0], tol) && near(u[1], a[1], tol) && near(v[0], b[0], tol) && near(v[1], b[1], tol)) ||
        (near(u[0], b[0], tol) && near(u[1], b[1], tol) && near(v[0], a[0], tol) && near(v[1], a[1], tol)));
    let expected = 0;
    g.series.forEach((ser, i) => {
      for (const e of g.errors[i]) {
        ROWS.forEach((row, r) => {
          const y = row[ser.channel];
          const [plus, minus] = [e.plus[r]!, e.minus[r]!];
          const seg: [[number, number], [number, number]] = e.axis === "y"
            ? [[fx(r), fy(y + plus)], [fx(r), fy(y - minus)]]
            : [[fx(r - minus), fy(y)], [fx(r + plus), fy(y)]];
          expect(has(...seg), `series ${i} ${e.axis}-error at row ${r} (+${plus} / -${minus})`).toBe(true);
          expected++;
        });
      }
    });
    expect(g.errors.flat().some((e) => !e.symmetric), "the asymmetric case is exercised").toBe(true);
    expect(whiskers.length, "one whisker per error per point").toBe(expected);
  });

  test("group: one dashed 2px line per level, in level_order, palette per level", async ({ page }) => {
    const g = golden("group");
    await load(page, "group");
    const levels = g.grouping.levelOrder!;
    const s = await settledScreen(page, 1, [levels.length]);
    const p = s.panels[0];
    const lines = seriesLines(p);
    // Colour is null in the golden by design (styleComparable("group")): each
    // level takes the palette slot at its own display position.
    expect(lines.map((l) => l.style)).toEqual(TEST_SERIES_PALETTE.slice(0, levels.length));
    expect(lines.map((l) => l.width)).toEqual(levels.map(() => g.series[0].width));
    expect(lines.map((l) => l.dash)).toEqual(levels.map(() => g.series[0].dash));
    const ax = expectFlatAxes(p, g);
    const ch = g.series[0].channel;
    levels.forEach((code, i) => {
      const rows = ROWS.map((_r, r) => r).filter((r) => ROWS[r][g.grouping.channel!] === code);
      expect(lines[i].pts.length, `level ${g.grouping.levelLabels![i]} rows`).toBe(rows.length);
      expectPoints(lines[i], ax.x, ax.y, rows, (r) => ROWS[r][ch], p.dpr, `level ${g.grouping.levelLabels![i]}`);
    });
    expect(s.legend!.rows.map((r) => r.label)).toEqual(
      g.grouping.levelLabels!.map((l) => `${LABELS[ch]} (${LABELS[g.grouping.channel!]}=${l}) (au)`),
    );
    expect(s.legend!.rows.map((r) => r.swatch)).toEqual(lines.map((l) => l.style));
    expect(s.legend!.rows.every((r) => r.dash !== null), "legend samples dashed").toBe(true);
  });

  test("facet as built (stackMode off): ONE overlaid plot on screen (S1 pinned)", async ({ page }) => {
    const g = golden("facet");
    await load(page, "facet");
    const s = await settledScreen(page, 1, [g.series.length]);
    expect(g.facet.panels!.length, "the export facets into 2 panels").toBe(2);
    expect(s.panels[0].title, "S1: no facet grid without stackMode").toBe("Matrix fixture");
  });

  test("facet: one panel per level, titled, with that level's rows", async ({ page }) => {
    const g = golden("facet");
    const panels = g.facet.panels!;
    await load(page, "facet", (d) => { d.plot.view = { ...d.plot.view, stackMode: true }; });
    const s = await settledScreen(page, panels.length, panels.map((pl) => pl.series.length));
    expect(s.panels.map((p) => p.title), "facet panel titles").toEqual(panels.map((pl) => pl.label));
    const siteLevels = [0, 1];
    s.panels.forEach((p, k) => {
      const lines = seriesLines(p);
      expect(lines.map((l) => l.style)).toEqual(TEST_SERIES_PALETTE.slice(0, lines.length));
      const ax = axesOf(p);
      expectSpan(ax.x, g.axes.x.limits, p, "x"); // shared x; y autoscales per panel on both paths
      expectSpan(ax.y, null, p, "y");
      const rows = ROWS.map((_r, r) => r).filter((r) => ROWS[r][g.facet.channel!] === siteLevels[k]);
      g.series.forEach((ser, i) => {
        expect(lines[i].pts.length).toBe(rows.length);
        expectPoints(lines[i], ax.x, ax.y, rows, (r) => ROWS[r][ser.channel], p.dpr, `${panels[k].label} series ${i}`);
      });
    });
  });

  test("y2: a right-hand axis with its own ticks, title and series", async ({ page }) => {
    const { ax, g } = await checkFlat(page, "y2");
    expect(g.y2Positions).toEqual([1]);
    expect(ax.y2.length, "y2 tick labels").toBeGreaterThan(2);
  });

  test("break: two x-panels split at the break, with a seam (S2 pinned)", async ({ page }) => {
    const g = golden("break");
    await load(page, "break");
    const s = await settledScreen(page, 2, [1, 1]);
    expect(s.seams, "one seam between the panels").toBe(1);
    expect(s.legend, "a break view mounts no legend").toBeNull();
    const [lo, hi] = g.axes.x.limits!;
    const ranges: [number, number][] = [[lo, g.xBreaks[0][0]], [g.xBreaks[0][1], hi]];
    const ser = g.series[0];
    s.panels.forEach((p, k) => {
      const [line] = seriesLines(p);
      expect(line.style).toBe(ser.color);
      expect(line.dash).toEqual(ser.dash ?? []);
      // S2: the explicit width is dropped on break panels (default 1.5).
      expect(line.width, "S2 pin").toBe(1.5);
      expect(line.width).not.toBe(ser.width);
      const ax = axesOf(p);
      expectSpan(ax.x, ranges[k], p, "x");
      expectSpan(ax.y, g.axes.y.limits, p, "y");
      const rows = ROWS.map((_r, r) => r).filter((r) => r >= ranges[k][0] && r <= ranges[k][1]);
      expect(line.pts.length).toBe(rows.length);
      expectPoints(line, ax.x, ax.y, rows, (r) => ROWS[r][ser.channel], p.dpr, `panel ${k}`);
    });
  });

  test("waterfall: the second series is drawn offset by the measured step", async ({ page }) => {
    const { g } = await checkFlat(page, "waterfall");
    expect(g.waterfallOffset, "a non-zero offset is under test").toBeGreaterThan(0);
  });

  test("decor: explicit styles, markers, step, fill, annotations, lines, shapes, shade (S3 pinned)", async ({ page }) => {
    const { s, ax, lines, g } = await checkFlat(page, "decor");
    const p = s.panels[0];
    const [fx, fy] = [toPx(ax.x), toPx(ax.y)];
    const tol = 1.5 * p.dpr;
    expect(await midSample(page, lines[0], g.series[0].color!), "explicit colour painted").toBeLessThan(40);
    // markers: one square glyph per row, stroked and filled in the series colour
    const m = g.series[0].marker!;
    const glyphs = p.ops.filter((o) => o.style === g.series[0].color && o.moves === ROWS.length);
    expect(glyphs.map((o) => o.op).sort()).toEqual(["fill", "stroke"]);
    const [a, , c] = glyphs[0].pts;
    expect(near(c[0] - a[0], m.size * p.dpr, 1) && near(c[1] - a[1], m.size * p.dpr, 1), "square of markerSize").toBe(true);
    // step: more vertices than rows (risers), still through every point
    expect(g.series[1].step).toBe("post");
    expect(lines[1].pts.length).toBeGreaterThan(ROWS.length);
    // fill under series 0: a translucent region closed along y = 0
    expect(g.series[0].fill).toBe("under");
    const base = fy(0);
    expect(p.ops.some((o) => o.op === "fill" && o.pts.some(([x, y]) => near(x, p.rect.left, tol) && near(y, base, tol)) &&
      o.pts.some(([x, y]) => near(x, p.rect.left + p.rect.width, tol) && near(y, base, tol))), "fill closed along y=0").toBe(true);
    // annotations at their data anchors
    for (const an of [{ text: "onset", x: 1, y: 0.5 }, { text: "plateau", x: 4, y: 2.5 }]) {
      const t = ax.inside.find((o) => o.text === an.text);
      expect(t, `annotation ${an.text}`).toBeDefined();
      expect(near(t!.x!, fx(an.x), 12 * p.dpr) && near(t!.y!, fy(an.y), 12 * p.dpr), `${an.text} anchored`).toBe(true);
    }
    const seg = (o: DrawOp, x0: number, y0: number, x1: number, y1: number) =>
      near(o.pts[0][0], x0, tol) && near(o.pts[0][1], y0, tol) && near(o.pts[1][0], x1, tol) && near(o.pts[1][1], y1, tol);
    const strokes = p.ops.filter((o) => o.op === "stroke" && o.moves === 1);
    const { height, width } = p.rect;
    expect(strokes.some((o) => o.dash.length > 0 && near(o.pts[0][0], fx(2.5), tol) && near(o.pts[1][0], fx(2.5), tol) && Math.abs(o.pts[1][1] - o.pts[0][1]) >= height - tol), "x ref line").toBe(true);
    expect(strokes.some((o) => o.dash.length > 0 && near(o.pts[0][1], fy(1.5), tol) && near(o.pts[1][1], fy(1.5), tol) && Math.abs(o.pts[1][0] - o.pts[0][0]) >= width - tol), "y ref line").toBe(true);
    expect(strokes.some((o) => o.pts.length === 2 && seg(o, fx(1), fy(1), fx(3), fy(2))), "arrow shape").toBe(true);
    const box = (o: DrawOp, x0: number, y0: number, x1: number, y1: number) => o.pts.length === 4 &&
      [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].every(([x, y]) => o.pts.some(([u, v]) => near(u, x, tol) && near(v, y, tol)));
    expect(strokes.some((o) => box(o, fx(2), fy(1), fx(4), fy(0))), "rect shape").toBe(true);
    expect(p.ops.some((o) => o.op === "fill" && o.style === "#334455" && box(o, fx(0.5), fy(3), fx(1.5), fy(0))), "region shade").toBe(true);
    // legend: corner, explicit swatches, dashed samples, the square marker
    expect(s.legend!.rows.map((r) => r.marker)).toEqual(["square", "none"]);
    expect(s.legend!.rows.every((r) => r.dash !== null)).toBe(true);
    // S3: the interactive legend renders no title.
    expect(g.decor.legend.title).toBe("Runs");
    expect(s.legend!.title, "S3 pin").toBeNull();
  });

  test("hidden: the hidden channel is not drawn and the others keep their slots", async ({ page }) => {
    const { s, lines, g } = await checkFlat(page, "hidden");
    expect(lines.some((l) => l.style === TEST_SERIES_PALETTE[0]), "hidden series' slot never stroked").toBe(false);
    const rows = s.legend!.rows;
    expect(rows.map((r) => r.struck), "hidden row stays listed, struck through").toEqual([true, false, false]);
    expect(rows[0].label).toBe(`${LABELS[0]} (au)`);
    expect(await midSample(page, lines[0], g.series[0].color!), "visible series painted").toBeLessThan(40);
    // Where the hidden series would run (row 0 -> 1 of Signal), its colour is absent.
    const ax = axesOf(s.panels[0]);
    const [fx, fy] = [toPx(ax.x), toPx(ax.y)];
    expect(await pixelDistance(page, 0, fx(0.5), fy(0.25), TEST_SERIES_PALETTE[0])).toBeGreaterThan(60);
  });
});
