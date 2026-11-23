// P4.2 regression matrix, SCREEN-CANVAS PIXELS (PRIMARY_SOFTWARE_AUDIT_PLAN,
// "Visual (rendered-output) equivalence for the same nine fixtures"). The
// sibling `regression-matrix-screen.spec.ts` proves what the canvas was TOLD to
// draw (recorded draw calls). This spec proves what ended up PAINTED: for every
// fixture it reads `getImageData` back at positions computed from the committed
// golden's own axis limits (`src/lib/__fixtures__/regressionMatrix/<name>.json`,
// the one truth the vitest matrix, the export tests
// `tests/test_export_visual_matrix_*.py` and the screen spec all agree with)
// and the live plotting rect, and asserts the expected series colour is there.
//
// No production hook: the live uPlot instance is not exposed anywhere (adding
// one would cost eager bytes, and the eager bundle has ~0.3 kB of headroom).
// What uPlot actually APPLIED is recovered from the DOM (`.u-over` = plotting
// rect) plus the golden's limits; the recorder-based sibling cross-checks the
// same limits against the canvas' own tick labels. Positions are exact maps of
// the applied scale onto the rect, so a wrong scale, a wrong axis binding or a
// missing offset moves the expected pixel off the stroke and fails.
//
// Determinism: no pixel-threshold tuning (alpha >= 96 and RGB within 40 of a
// palette colour whose nearest neighbour is > 60 away), no fixed sleeps (the
// screen settles on state via `settledScreen`: panel count, series count, two
// identical consecutive reads).
// Untagged: runs at the 100% project only.

import { expect, test } from "@playwright/test";

import { TEST_SERIES_PALETTE, type CanonicalFigure } from "../../src/lib/regressionMatrix.testkit";
import type { MatrixFixtureName } from "../../src/lib/regressionMatrixFixtures.testkit";
import {
  axesOf, golden, ROWS, seriesLines, settledScreen,
  type Panel, type Screen,
} from "../utils/matrixScreen";
import {
  COLOR_TOL, countColors, distToPolyline, linMap, loadFixture, probe, xMap, yMap,
  type Map1, type Probe,
} from "../utils/matrixPixels";

const PALETTE = [...TEST_SERIES_PALETTE];
const rowIdx = ROWS.map((_r, i) => i);

/** Dashed or hairline strokes can leave a gap or sit between pixel rows: look
 *  a little wider (still << the ~100 px between rows). */
const radiusFor = (s: { width: number | null; dash: number[] | null }) => (s.dash?.length ? 6 : (s.width ?? 1.5) < 2 ? 3 : 2);

/** The y map of a panel: golden limits when the figure pins them, otherwise the
 *  line through the canvas' own first/last y tick (autoscaled facet panels). */
function yMapOf(p: Panel, lim: [number, number] | null): Map1 {
  if (lim) return yMap(p, lim);
  const t = axesOf(p).y;
  return linMap(t[0].value, t[t.length - 1].value, t[0].at, t[t.length - 1].at);
}

async function expectPainted(page: Parameters<typeof probe>[0], probes: Probe[]): Promise<void> {
  const d = await probe(page, probes);
  probes.forEach((p, i) => expect(d[i], `painted ${p.color} at ${p.what}`).toBeLessThan(COLOR_TOL));
}

/** True when (x, y) lies inside the plotting rect: uPlot clips every series
 *  and whisker to it, so a point outside (a whisker end past x = 0, a waterfall
 *  trace offset above the y limit) is legitimately NOT painted. */
const inRect = (p: Panel, x: number, y: number) =>
  x >= p.rect.left && x <= p.rect.left + p.rect.width && y >= p.rect.top && y <= p.rect.top + p.rect.height;

/** One probe per (series, row) at the data point's computed pixel (points the
 *  clip removes are left out; callers assert how many remain). */
function seriesProbes(
  g: CanonicalFigure, colors: (string | null)[], panel: number, p: Panel, fx: Map1,
  fyOf: (axis: number) => Map1, rows: number[], offset: number,
): Probe[] {
  return g.series.flatMap((s, i) => rows.map((r): Probe => {
    const color = s.color ?? colors[i]!;
    return {
      panel, color, radius: radiusFor(s),
      x: fx(r), y: fyOf(s.axis)(ROWS[r][s.channel] + offset * i),
      what: `series ${i} (${s.label}) row ${r} panel ${panel}`,
    };
  })).filter((q) => inRect(p, q.x, q.y));
}

/** Colours of unused palette slots never appear on any panel's canvas. */
async function expectNoStrays(page: Parameters<typeof probe>[0], screen: Screen, used: string[], ignore: string[] = []): Promise<void> {
  const stray = PALETTE.filter((c) => !used.includes(c) && !ignore.includes(c));
  for (let k = 0; k < screen.panels.length; k++) {
    const n = await countColors(page, k, stray, 12);
    stray.forEach((c, i) => expect(n[i], `panel ${k}: unused palette colour ${c} must not be painted`).toBe(0));
  }
}

/** The common flat check: every series painted at every row, nothing extra. */
async function checkFlat(page: Parameters<typeof probe>[0], name: MatrixFixtureName, ignoreStray: string[] = []) {
  const g = golden(name);
  await loadFixture(page, name);
  const screen = await settledScreen(page, 1, [g.series.length]);
  const p = screen.panels[0];
  const fx = xMap(p, g.axes.x.limits!);
  const yL = yMap(p, g.axes.y.limits!);
  const yR = g.axes.y2 ? yMap(p, g.axes.y2.limits!) : yL;
  const probes = seriesProbes(g, PALETTE, 0, p, fx, (a) => (a === 1 ? yR : yL), rowIdx, g.waterfallOffset);
  // At most the rows the clip removes (waterfall: one point above the y limit).
  expect(probes.length, "data points probed").toBeGreaterThanOrEqual(g.series.length * rowIdx.length - 1);
  await expectPainted(page, probes);
  const colors = g.series.map((s, i) => s.color ?? PALETTE[i]);
  const counts = await countColors(page, 0, colors, COLOR_TOL);
  colors.forEach((c, i) => expect(counts[i], `series ${i} colour has area`).toBeGreaterThan(rowIdx.length));
  await expectNoStrays(page, screen, colors, ignoreStray);
  return { g, screen, p, fx, yL, yR, colors };
}

test.describe("P4.2 regression matrix — screen canvas pixels", () => {
  test("plain: both series painted at every data point, in their colours", async ({ page }) => {
    await checkFlat(page, "plain");
  });

  test("errors: series and every whisker end painted in the series colour", async ({ page }) => {
    const { g, p, fx, yL, colors } = await checkFlat(page, "errors");
    const probes: Probe[] = [];
    g.series.forEach((s, i) => g.errors[i].forEach((e) => rowIdx.forEach((r) => {
      const v = ROWS[r][s.channel];
      const [plus, minus] = [e.plus[r]!, e.minus[r]!];
      const ends = e.axis === "y" ? [[fx(r), yL(v + plus)], [fx(r), yL(v - minus)]] : [[fx(r + plus), yL(v)], [fx(r - minus), yL(v)]];
      ends.filter(([x, y]) => inRect(p, x, y)).forEach(([x, y], k) => probes.push({ panel: 0, x, y, color: colors[i], radius: 2, what: `series ${i} ${e.axis}-error end ${k} row ${r}` }));
    })));
    // 4 whisker ends per row, minus the x-whisker ends the clip removes (row 0 - dX, row 5 + dX).
    expect(probes.length, "whisker ends probed").toBeGreaterThanOrEqual(rowIdx.length * 4 - 2);
    await expectPainted(page, probes);
  });

  // S4 (SCREEN-ONLY DIFFERENCE, measured here, pinned by value; flip the pin
  // when fixed). The group fixture's levels interleave (rows A B C A B C), so
  // each level's series is non-null only at isolated rows with nulls between.
  // The canvas ISSUES one stroke per level (the draw-call sibling sees 3 dashed
  // 2 px lines) but uPlot clips the stroke to the non-null runs, and a run of
  // one point has no length: NO series pixel is painted anywhere (measured:
  // zero pixels of any palette colour; the page screenshot shows an empty
  // plot, legend only). The export draws the three connected dashed lines
  // (tests/test_export_visual_matrix_split.py). Product behaviour, not changed
  // here (owner to confirm: connect across other levels' rows, as the export
  // does, or accept the gap). Provisional, owner to confirm.
  test("group (S4 pinned): the three level strokes are issued but paint no pixel", async ({ page }) => {
    const g = golden("group");
    await loadFixture(page, "group");
    const levels = g.grouping.levelOrder!;
    const screen = await settledScreen(page, 1, [levels.length]);
    const p = screen.panels[0];
    expect(seriesLines(p).map((l) => l.style), "strokes issued, palette per level").toEqual(PALETTE.slice(0, levels.length));
    expect(seriesLines(p).every((l) => l.dash.length === 2), "dashed").toBe(true);
    const n = await countColors(page, 0, PALETTE, COLOR_TOL);
    expect(n, "S4: no palette colour painted on the group canvas").toEqual(PALETTE.map(() => 0));
    // the probe machinery itself is sound on this canvas: a grid crossing IS found
    const [fx, fy] = [xMap(p, g.axes.x.limits!), yMap(p, g.axes.y.limits!)];
    const d = await probe(page, [{ panel: 0, color: "#2d2d32", radius: 2, x: fx(2), y: fy(1), what: "grid crossing" }]);
    expect(d[0], "grid crossing found by the same probe").toBeLessThan(COLOR_TOL);
    // the legend (DOM) still lists every level with its dashed swatch in the stroke colour
    expect(screen.legend!.rows.map((r) => r.swatch)).toEqual(seriesLines(p).map((l) => l.style));
  });

  for (const stackMode of [false, true]) test(`facet (stackMode ${stackMode}): each panel paints its own level's rows`, async ({ page }) => {
    const g = golden("facet");
    const panels = g.facet.panels!;
    await loadFixture(page, "facet", (d) => { d.plot.view = { ...d.plot.view, stackMode }; });
    const screen = await settledScreen(page, panels.length, panels.map((pl) => pl.series.length));
    const probes: Probe[] = [];
    screen.panels.forEach((p, k) => {
      const rows = rowIdx.filter((r) => ROWS[r][g.facet.channel!] === k);
      const fx = xMap(p, g.axes.x.limits!);
      const fy = yMapOf(p, null); // y autoscales per panel, on screen and export alike
      probes.push(...seriesProbes(g, PALETTE, k, p, fx, () => fy, rows, 0));
    });
    await expectPainted(page, probes);
    await expectNoStrays(page, screen, PALETTE.slice(0, 2));
  });

  test("y2: the right-hand series is painted on the y2 scale (not the left one)", async ({ page }) => {
    const { g, p, fx, yL, yR, colors } = await checkFlat(page, "y2");
    const s = g.series[1];
    expect(s.axis).toBe(1);
    // Had it been drawn on the left scale (-1..4) a 270..310 K trace would be off-canvas.
    const wrong = await probe(page, rowIdx.map((r): Probe => ({
      panel: 0, color: colors[1], radius: 3, x: fx(r), y: yL(ROWS[r][s.channel]), what: `y2 series on the LEFT scale, row ${r}`,
    })));
    wrong.forEach((d, r) => expect(d, `y2 series colour not painted at its left-scale position, row ${r}`).toBeGreaterThan(COLOR_TOL));
    expect(yR(ROWS[0][s.channel]), "y2 rows map inside the rect").toBeGreaterThan(p.rect.top);
  });

  test("break: both x-panels paint their own rows with the series colour", async ({ page }) => {
    const g = golden("break");
    await loadFixture(page, "break");
    const screen = await settledScreen(page, 2, [1, 1]);
    const [lo, hi] = g.axes.x.limits!;
    const ranges: [number, number][] = [[lo, g.xBreaks[0][0]], [g.xBreaks[0][1], hi]];
    const ser = g.series[0];
    const y0 = yMap(screen.panels[0], g.axes.y.limits!); // panels share panel 0's y axis
    const probes: Probe[] = [];
    screen.panels.forEach((p, k) => {
      const rows = rowIdx.filter((r) => r >= ranges[k][0] && r <= ranges[k][1]);
      expect(rows.length, `panel ${k} has rows`).toBeGreaterThan(0);
      const fx = xMap(p, ranges[k]);
      rows.forEach((r) => probes.push({ panel: k, color: ser.color!, radius: 2, x: fx(r), y: y0(ROWS[r][ser.channel]), what: `break panel ${k} row ${r}` }));
    });
    await expectPainted(page, probes);
    await expectNoStrays(page, screen, [ser.color!]);
  });

  test("waterfall: series 1 is painted at its offset position and absent at the un-offset one", async ({ page }) => {
    const { g, screen, fx, yL, colors } = await checkFlat(page, "waterfall");
    expect(g.waterfallOffset).toBeGreaterThan(0);
    const ser = g.series[1];
    const line = seriesLines(screen.panels[0])[1];
    // Rows whose un-offset position is clear of series 1's own drawn path by
    // > 8 px: there its colour must be absent (the offset really shifted it).
    const clear = rowIdx.filter((r) => distToPolyline(line.pts, fx(r), yL(ROWS[r][ser.channel])) > 8);
    expect(clear.length, "the offset separates the un-offset point from the path").toBeGreaterThanOrEqual(3);
    const d = await probe(page, clear.map((r): Probe => ({
      panel: 0, color: colors[1], radius: 2, x: fx(r), y: yL(ROWS[r][ser.channel]), what: `un-offset row ${r}`,
    })));
    d.forEach((v, i) => expect(v, `series 1 colour absent at its un-offset row ${clear[i]}`).toBeGreaterThan(COLOR_TOL));
  });

  // decor: its annotations / reference lines / shapes are inked in a neutral
  // grey that lands within 12 RGB of palette slot 7 (#c9c9c9), so that one slot
  // is exempt from the no-stray-colour check there (and only there).
  test("decor: markers, dashed lines, step risers and the fill are painted", async ({ page }) => {
    const { g, screen, p, fx, yL, colors } = await checkFlat(page, "decor", [PALETTE[7]]);
    const base = yL(0);
    // fill under series 0: translucent, so painted (alpha > 0) but at lower coverage than the stroke
    // x = 4.5: clear of the rect shape (x 2..4), arrow, region shade (x 0.5..1.5) and ref lines
    const [px, py] = [fx(4.5), (yL((ROWS[4][0] + ROWS[5][0]) / 2) + base) / 2];
    const fill = await page.evaluate(({ x, y }) => {
      const c = document.querySelectorAll<HTMLElement>(".qzk-stage .uplot")[0].querySelector("canvas")!;
      return Array.from(c.getContext("2d")!.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    }, { x: px, y: py });
    expect(fill[3], "fill under series 0 is painted").toBeGreaterThan(0);
    expect(fill[3], "fill is translucent").toBeLessThan(200);
    // the filled colour is series 0's hue (not the series-1 or a palette colour)
    const want = [1, 3, 5].map((i) => parseInt(colors[0].slice(i, i + 2), 16));
    expect(Math.hypot(fill[0] - want[0], fill[1] - want[1], fill[2] - want[2]), `fill hue = series 0 (px ${fill})`).toBeLessThan(COLOR_TOL);
    // step "post": the horizontal run at row r's value is painted halfway to r+1
    const ser = g.series[1];
    const steps = rowIdx.slice(0, -1).map((r): Probe => ({
      panel: 0, color: colors[1], radius: 6, x: fx(r + 0.5), y: yL(ROWS[r][ser.channel]), what: `step run after row ${r}`,
    }));
    await expectPainted(page, steps);
    // ...and a straight diagonal would NOT be (the riser/run shape, not interpolation)
    const line = seriesLines(p)[1];
    const diag = rowIdx.slice(0, -1).map((r) => ({ r, x: fx(r + 0.5), y: yL((ROWS[r][ser.channel] + ROWS[r + 1][ser.channel]) / 2) }))
      .filter((q) => distToPolyline(line.pts, q.x, q.y) > 8);
    expect(diag.length, "interpolated midpoints are clear of the step path").toBeGreaterThanOrEqual(3);
    const dd = await probe(page, diag.map((q): Probe => ({ panel: 0, color: colors[1], radius: 2, x: q.x, y: q.y, what: `interpolated midpoint ${q.r}` })));
    dd.forEach((v, i) => expect(v, `no series-1 stroke on the interpolated midpoint after row ${diag[i].r}`).toBeGreaterThan(COLOR_TOL));
    expect(screen.legend, "legend present").not.toBeNull();
  });

  test("hidden: the hidden channel's colour appears nowhere; the visible ones are painted", async ({ page }) => {
    const { g, screen, colors } = await checkFlat(page, "hidden");
    expect(g.series.map((s) => s.channel), "channel 0 is hidden").toEqual([1, 2]);
    const hidden = PALETTE[0];
    expect(colors, "hidden slot is not among the drawn colours").not.toContain(hidden);
    const [n] = await countColors(page, 0, [hidden], COLOR_TOL);
    expect(n, "hidden series' slot colour painted nowhere on the canvas").toBe(0);
    expect(screen.legend!.rows.map((r) => r.struck)).toEqual([true, false, false]);
  });
});
