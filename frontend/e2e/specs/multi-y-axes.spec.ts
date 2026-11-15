// Gap audit 4 G11, end to end against the real backend: Origin-style
// multiple Y axes. Two series go to new Y3 / Y4 axes from the Inspector, the
// canvas stacks them outward one slot apart on the right, Y Axis Settings
// gives Y3 a title, colour and range (one undo step), a wheel zoom commits
// Y3's range and Back restores it, the SVG export carries the same axes, a
// stacked view refuses them with a status note, and an assignment to an axis
// that no longer exists draws on Y1 and says so.

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { installCanvasRecorder, type DrawOp } from "../utils/canvasRecorder";
import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface Axis { lim: [number, number] | null; label: string; color: string | null }
type Qz = {
  yAxes: Axis[];
  yAxisOf: Record<number, number>;
  history: unknown[];
  status: string;
  undo: () => void;
  backView: () => void;
  setStackMode: (on: boolean) => void;
};
type App = { getState: () => Qz; setState: (patch: Partial<Qz>) => void };
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: App } }).__qz.useApp.getState();
    return { yAxes: s.yAxes, yAxisOf: s.yAxisOf, history: s.history.length, status: s.status };
  });

/** The canvas text draws of `text`: their colour and whether rotated (an axis title). */
const drawnText = (page: Page, text: string) =>
  page.evaluate((want) => {
    const canvas = document.querySelector(".qzk-stage canvas") as HTMLCanvasElement;
    const log = (window as unknown as { __qzDraw: { log: (c: HTMLCanvasElement) => DrawOp[] } }).__qzDraw.log(canvas);
    return log.filter((op) => op.op === "text" && op.text === want).map((op) => ({ style: op.style, rotated: !!op.rotated }));
  }, text);

/** The canvas' right-hand axes, left to right (uPlot lays each out as a `.u-axis` div). */
const rightAxes = (page: Page) =>
  page.evaluate(() => {
    const over = document.querySelector(".qzk-stage .u-over")!.getBoundingClientRect();
    return [...document.querySelectorAll(".qzk-stage .u-axis")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.left >= over.right - 1 && r.height > over.height / 2)
      .map((r) => Math.round(r.left - over.right))
      .sort((a, b) => a - b);
  });

test("Y3 and Y4 axes: assign, stack, format, zoom, export, refuse and fail closed @core", async ({ page }) => {
  test.setTimeout(90_000);
  await installCanvasRecorder(page);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 1);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

  // ── Inspector ▸ Channels: Beta to a new Y3, Gamma to a new Y4 ──
  const channels = page.locator(".qz-card").filter({ has: page.locator("summary", { hasText: "Channels" }) });
  await channels.locator("summary").click();
  await channels.getByRole("combobox", { name: "Beta Y axis" }).selectOption("3");
  await channels.getByRole("combobox", { name: "Gamma Y axis" }).selectOption("4");
  await expect.poll(async () => (await state(page)).yAxisOf).toEqual({ 1: 3, 2: 4 });
  expect((await state(page)).yAxes).toHaveLength(2);

  // The canvas stacks them outward: Y3 against the frame, Y4 one 60 pt (80 px) slot out.
  await expect.poll(() => rightAxes(page)).toHaveLength(2);
  const [y3At, y4At] = await rightAxes(page);
  expect(y4At - y3At).toBe(80);
  await page.screenshot({ path: test.info().outputPath("multi-y.png") });

  // ── Plot ▸ Y Axis Settings…: Y3's title, colour and range, one undo step ──
  await runPaletteCommand(page, "Y Axis Settings…");
  const pick = page.getByRole("dialog", { name: "Y Axis Settings" });
  await pick.getByRole("combobox").selectOption("Y3");
  await pick.getByRole("button", { name: "Next" }).click();
  const dlg = page.getByRole("dialog", { name: "Y3 Axis" });
  await expect(dlg).toContainText("does not link to other windows");
  await dlg.getByRole("textbox", { name: "Title", exact: true }).fill("Beta axis");
  await dlg.getByRole("textbox", { name: "From", exact: true }).fill("0");
  await dlg.getByRole("textbox", { name: "To", exact: true }).fill("10");
  await dlg.getByRole("textbox", { name: "Colour", exact: true }).fill("#c0392b");
  await page.screenshot({ path: test.info().outputPath("y3-settings.png") });
  const before = (await state(page)).history;
  await dlg.getByRole("button", { name: "Apply" }).click();
  await expect.poll(async () => (await state(page)).yAxes[0]).toMatchObject({ label: "Beta axis", lim: [0, 10], color: "#c0392b" });
  expect((await state(page)).history).toBe(before + 1);
  // Drawn on the canvas in its own colour (the draw-call recorder reads the live fillStyle).
  await expect.poll(() => drawnText(page, "Beta axis")).toEqual([{ style: "#c0392b", rotated: true }]);
  await page.screenshot({ path: test.info().outputPath("y3-formatted.png") });

  // ── A wheel zoom moves Y3 with the plot and commits its range; Back restores it ──
  const over = (await page.locator(".qzk-stage .u-over").first().boundingBox())!;
  await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await state(page)).yAxes[0].lim?.[1] ?? 10, { timeout: 5000 }).toBeLessThan(10);
  await page.evaluate(() => (window as unknown as { __qz: { useApp: App } }).__qz.useApp.getState().backView());
  await expect.poll(async () => (await state(page)).yAxes[0].lim).toEqual([0, 10]);

  // ── The SVG export carries both axes, with Y3's look ──
  await runPaletteCommand(page, "Export figure…");
  const exportDialog = page.getByRole("dialog", { name: "Export figure" });
  await exportDialog.getByLabel("Format").selectOption("svg");
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Export", exact: true }).click();
  const body = (await request).postDataJSON() as { y_axes?: { keys: number[]; label?: string; color?: string; lim?: number[] }[] };
  expect(body.y_axes?.map((a) => a.keys)).toEqual([[1], [2]]);
  expect(body.y_axes?.[0]).toMatchObject({ label: "Beta axis", color: "#c0392b", lim: [0, 10] });
  const svg = (await readFile(await (await download).path())).toString("utf8");
  expect(svg).toContain("Beta axis");

  // ── Undo takes the settings back ──
  await page.evaluate(() => (window as unknown as { __qz: { useApp: App } }).__qz.useApp.getState().undo());
  await expect.poll(async () => (await state(page)).yAxes[0].label).toBe("");

  // ── A stacked view draws Y1 / Y2 only and says so ──
  await page.evaluate(() => (window as unknown as { __qz: { useApp: App } }).__qz.useApp.getState().setStackMode(true));
  await expect(page.locator(".qzk-statusbar")).toContainText("Y3+ axes are not drawn in a multi-panel view");
  await page.evaluate(() => (window as unknown as { __qz: { useApp: App } }).__qz.useApp.getState().setStackMode(false));

  // ── Fail closed: a series on an axis that no longer exists draws on Y1, and says so ──
  await page.evaluate(() => (window as unknown as { __qz: { useApp: App } }).__qz.useApp.setState({ yAxisOf: { 1: 3, 2: 7 } }));
  await expect(page.locator(".qzk-statusbar")).toContainText("Gamma: assigned to a Y axis that no longer exists — drawn on Y1");
  await expect.poll(() => rightAxes(page)).toHaveLength(1);
});
