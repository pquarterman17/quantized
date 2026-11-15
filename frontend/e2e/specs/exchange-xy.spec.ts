// Plot > Exchange X-Y axes, end to end against the real backend: the command
// turns the live canvas on its side (X title up the left, Y title along the
// bottom) and the SVG export of the SAME view agrees on which axis title sits
// where (lib/exchangeXY.ts <-> calc/figure_orient.py). Toggling twice is the
// identity on screen, and it is one undo step.

import { expect, test, type Page } from "@playwright/test";

import { installCanvasRecorder } from "../utils/canvasRecorder";
import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type QzWindow = { __qz: { useApp: { getState: () => { exchangeXY: boolean; undo: () => void } } } };
const exchanged = (page: Page) => page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().exchangeXY);

const X_TITLE = "Time (s)";
const Y_TITLE = "B, Si (c/s)";

type Placed = { side: "left" | "bottom" | "other"; rotated: boolean } | undefined;

/** Where the plot's canvas draws each axis title, relative to the plot area:
 *  recorded fillText calls (e2e/utils/canvasRecorder.ts), since rich titles are
 *  canvas text, not DOM. */
async function screenTitles(page: Page, texts: string[]): Promise<Record<string, Placed>> {
  return page.evaluate((want) => {
    type Op = { op: string; text?: string; x?: number; y?: number; rotated?: boolean };
    const canvas = document.querySelector(".qzk-stage canvas") as HTMLCanvasElement;
    const draws = (window as unknown as { __qzDraw: { log: (c: HTMLCanvasElement) => Op[] } }).__qzDraw.log(canvas);
    const c = canvas.getBoundingClientRect();
    const over = document.querySelector(".qzk-stage .u-over")!.getBoundingClientRect();
    const k = canvas.width / c.width; // device px per CSS px
    const out: Record<string, Placed> = {};
    for (const text of want) {
      const op = draws.filter((o) => o.op === "text" && o.text === text).pop();
      if (!op) {
        out[text] = undefined;
        continue;
      }
      const x = c.left + op.x! / k;
      const y = c.top + op.y! / k;
      out[text] = { side: x <= over.left ? "left" : y >= over.bottom ? "bottom" : "other", rotated: !!op.rotated };
    }
    return out;
  }, texts);
}
const titleSide = async (page: Page, text: string) => (await screenTitles(page, [text]))[text]?.side;

/** `{text: [rotation, x, y]}` for every <text> of an SVG. */
function svgText(svg: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  const re = /<text[^>]* x="([\d.]+)" y="([\d.]+)" transform="rotate\((-?[\d.]+)[^"]*"[^>]*>([^<]*)<\/text>/g;
  for (const m of svg.matchAll(re)) out[m[4]] = [Number(m[3]), Number(m[1]), Number(m[2])];
  return out;
}

async function exportSvg(page: Page): Promise<{ svg: string; body: { overrides?: { exchange_xy?: boolean } } }> {
  await runPaletteCommand(page, "Export figure…");
  const dialog = page.getByRole("dialog", { name: "Export figure" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Format").selectOption("svg");
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const body = (await request).postDataJSON() as { overrides?: { exchange_xy?: boolean } };
  const bytes = await (await import("node:fs/promises")).readFile(await (await download).path());
  return { svg: bytes.toString("utf8"), body };
}

test("Exchange X-Y axes: the screen and the exported SVG put the same title on the same side", async ({ page }) => {
  test.setTimeout(90_000);
  await installCanvasRecorder(page);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("sims-time-profile.csv"));
  await waitForDatasetCount(page, 1);

  // Upright first: X title along the bottom.
  await expect.poll(() => titleSide(page, X_TITLE)).toBe("bottom");

  await runPaletteCommand(page, "Exchange X–Y axes");
  await expect.poll(() => exchanged(page)).toBe(true);
  // Screen: the X title is rotated up the left; the Y title runs along the bottom.
  await expect.poll(async () => (await screenTitles(page, [X_TITLE]))[X_TITLE]).toEqual({ side: "left", rotated: true });
  expect((await screenTitles(page, [Y_TITLE]))[Y_TITLE]).toEqual({ side: "bottom", rotated: false });

  // Export: the SAME view, vector.
  const { svg, body } = await exportSvg(page);
  expect(body.overrides?.exchange_xy).toBe(true);
  const text = svgText(svg);
  const x = text[X_TITLE];
  const y = text[Y_TITLE];
  expect(x, "the X title is drawn in the SVG").toBeTruthy();
  expect(y, "the Y title is drawn in the SVG").toBeTruthy();
  expect(x[0]).toBe(-90); // rotated, as on screen
  expect(Math.abs(y[0])).toBe(0);
  const ticks = Object.entries(text).filter(([k]) => k !== X_TITLE && k !== Y_TITLE);
  expect(x[1]).toBeLessThan(Math.min(...ticks.map(([, v]) => v[1]))); // left of every tick label
  expect(y[2]).toBeGreaterThan(Math.max(...ticks.map(([, v]) => v[2]))); // below every tick label

  // Toggling twice is the identity; the toggle is ONE undo step.
  await runPaletteCommand(page, "Exchange X–Y axes");
  await expect.poll(() => exchanged(page)).toBe(false);
  await expect.poll(() => titleSide(page, X_TITLE)).toBe("bottom");
  await runPaletteCommand(page, "Exchange X–Y axes");
  await expect.poll(() => exchanged(page)).toBe(true);
  await page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().undo());
  await expect.poll(() => exchanged(page)).toBe(false);
});
