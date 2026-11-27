// Point labels with "Avoid overlaps" in a real browser (the #1039 acceptance defects): 30 clustered points,
// Top N = 30. With the option ON every label is drawn (placement moves the crowded ones, leader lines join
// them to their points, nothing is thinned away); with it OFF the grid thinning and its note are unchanged.
// The canvas recorder reads the plot's draw calls back, so this also catches stray text such as a lone glyph.

import { expect, test, type Page } from "@playwright/test";

import { installCanvasRecorder, type DrawOp } from "../utils/canvasRecorder";
import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

const ops = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector(".qzk-stage canvas") as HTMLCanvasElement;
    return (window as unknown as { __qzDraw: { log: (c: HTMLCanvasElement) => DrawOp[] } }).__qzDraw.log(canvas);
  });

const setLabels = (page: Page, avoid: boolean) =>
  page.evaluate((on) => {
    const { useApp } = (window as unknown as { __qz: { useApp: { getState: () => { setPointLabels: (v: unknown) => void; setYKeys: (k: number[]) => void } } } }).__qz;
    useApp.getState().setYKeys([0]); // Moment alone; ID is the label column, not a curve
    useApp.getState().setPointLabels({
      key: 1, mode: "top", topN: 30,
      ...(on ? { avoid: { leaderDistance: 1.5, leaderWidth: 0.75, leaderDashed: false } } : {}),
    });
  }, avoid);

const IDS = Array.from({ length: 30 }, (_, i) => String(1000 + i));

test("Avoid overlaps keeps all 30 clustered labels, draws leader lines, and leaves no stray text", async ({ page }) => {
  await installCanvasRecorder(page);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("point-labels-cluster.csv"));
  await waitForDatasetCount(page, 1);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

  await setLabels(page, false);
  await expect.poll(async () => (await ops(page)).some((o) => o.op === "text" && /crowded labels? left out/.test(o.text ?? ""))).toBe(true);
  const off = await ops(page);
  expect(off.filter((o) => o.op === "text" && IDS.includes(o.text ?? "")).length).toBeLessThan(30);

  await setLabels(page, true);
  await expect.poll(async () => (await ops(page)).filter((o) => o.op === "text" && IDS.includes(o.text ?? "")).length).toBe(30);
  const on = await ops(page);
  const texts = on.filter((o) => o.op === "text").map((o) => o.text ?? "");
  expect(texts.some((t) => /crowded/.test(t))).toBe(false);
  // No lone-glyph text anywhere on the plot (axis tick/title text is longer or numeric).
  expect(texts.filter((t) => /^[A-Za-z]$/.test(t))).toEqual([]);
  // Leader lines: two-point strokes in the theme's dim ink (not the curve's colour, which hid them under the
  // curve's own line; e10b5b863). That ink is shared with axis ticks, so count only what the option ADDED: the
  // same strokes with Avoid overlaps OFF are the baseline.
  const ink = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-dim").trim();
    return ctx.strokeStyle; // canvas-normalised, the form the recorder reads back
  });
  const inInk = (list: DrawOp[]) => list.filter((o) => o.op === "stroke" && o.pts.length === 2 && o.style === ink);
  const leaders = inInk(on).slice(inInk(off).length);
  expect(inInk(on).length - inInk(off).length).toBeGreaterThan(0);
  // Visible: never under one CSS pixel wide.
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  for (const l of leaders) expect(l.width).toBeGreaterThanOrEqual(dpr - 0.01);
  // Every label is drawn where it was placed: left-aligned and inside the plot box (right-aligned text sat a
  // full width to its left and was clipped away, leaving a lone last glyph).
  const left = await page.evaluate(() => {
    const c = document.querySelector(".qzk-stage canvas") as HTMLCanvasElement;
    const o = document.querySelector(".qzk-stage .u-over") as HTMLElement;
    return (o.getBoundingClientRect().left - c.getBoundingClientRect().left) * (c.width / c.getBoundingClientRect().width);
  });
  for (const o of on.filter((o) => o.op === "text" && IDS.includes(o.text ?? ""))) expect(o.x ?? 0).toBeGreaterThanOrEqual(left - 0.5);
});
