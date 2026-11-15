// Gap audit 4 G17 + G19, end to end against the real backend: a probability
// Y axis with custom labelled ticks and a Y axis crossing X = 0 on a
// non-monotonic (M-H-loop shaped) X, carried to a real SVG export; the Lasso
// Mask tool masking points in one undo step; and "Link Y axis with…" putting
// two graph windows in one Y link group.

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type QzState = {
  yScale: string;
  yFmt: { prob?: string; custom?: { at: number[]; labels?: string[] }; cross?: number };
  datasets: { excludedRows?: number[] }[];
  history: unknown[];
  undo: () => void;
  plotWindows: { linkYGroup?: number | null; linkGroup: number | null }[];
};
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => QzState } } }).__qz.useApp.getState();
    return {
      yScale: s.yScale,
      yFmt: s.yFmt,
      excluded: s.datasets[0]?.excludedRows?.length ?? 0,
      history: s.history.length,
      linkY: s.plotWindows.map((w) => w.linkYGroup ?? null),
      linkX: s.plotWindows.map((w) => w.linkGroup),
    };
  });

test("probability Y with custom ticks crossing X = 0, a lasso mask, and linked Y axes", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("mh-loop-fraction.csv"));
  await waitForDatasetCount(page, 1);

  // ── Axis dialog: probability (0–1) Y, custom labelled ticks, cross X at 0 ──
  await runPaletteCommand(page, "Axis…");
  const dialog = page.getByRole("dialog", { name: "Axis" });
  await dialog.getByRole("tab", { name: "Y" }).click();
  await dialog.getByRole("combobox", { name: "Y axis Type" }).selectOption("probit");
  await dialog.getByRole("textbox", { name: "Y axis From" }).fill("0");
  await expect(dialog.getByRole("alert")).toContainText("strictly between 0 and 1");
  await dialog.getByRole("textbox", { name: "Y axis From" }).fill("");
  await dialog.getByRole("textbox", { name: "Y axis Tick positions" }).fill("0.05, 0.5, 0.95");
  await dialog.getByRole("textbox", { name: "Y axis Tick labels" }).fill("5%, median, 95%");
  await dialog.getByRole("textbox", { name: "Y axis Cross X at" }).fill("0");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => state(page)).toMatchObject({
    yScale: "linear",
    yFmt: { prob: "fraction", custom: { at: [0.05, 0.5, 0.95], labels: ["5%", "median", "95%"] }, cross: 0 },
  });
  await page.screenshot({ path: test.info().outputPath("axis-extras.png") });

  // ── The SVG export carries the same format and draws the labels ──
  await runPaletteCommand(page, "Export figure…");
  const exportDialog = page.getByRole("dialog", { name: "Export figure" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByLabel("Format").selectOption("svg");
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Export", exact: true }).click();
  const body = (await request).postDataJSON() as { y_fmt?: QzState["yFmt"] };
  expect(body.y_fmt).toMatchObject({ prob: "fraction", custom: { at: [0.05, 0.5, 0.95] }, cross: 0 });
  const svg = (await readFile(await (await download).path())).toString("utf8");
  expect(svg).toContain("median"); // the custom label, drawn at the crossing
  expect(svg).toContain("95%");

  // ── Lasso Mask: drag an outline around the upper part of the loop ──
  await page.getByRole("button", { name: "Lasso Mask" }).click();
  const over = page.locator(".qzk-stage .u-over").first();
  const box = (await over.boundingBox())!;
  const before = (await state(page)).history;
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.mouse.down();
  for (const [fx, fy] of [[0.98, 0.02], [0.98, 0.3], [0.02, 0.3]] as const) await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).excluded).toBeGreaterThan(0);
  expect((await state(page)).history).toBe(before + 1);
  await page.screenshot({ path: test.info().outputPath("lasso.png") });
  await page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => QzState } } }).__qz.useApp.getState().undo());
  await expect.poll(async () => (await state(page)).excluded).toBe(0);

  // ── Link Y axis with… a second graph window ──
  await runPaletteCommand(page, "New Graph Window");
  await expect.poll(async () => (await state(page)).linkY.length).toBe(2);
  await runPaletteCommand(page, "Link Y axis with…");
  const ask = page.getByRole("dialog", { name: /Link Y axis of/ });
  await expect(ask).toBeVisible();
  await ask.getByRole("checkbox").first().check();
  await ask.getByRole("button", { name: "Link" }).click();
  await expect.poll(async () => (await state(page)).linkY).toEqual([1, 1]);
  expect((await state(page)).linkX).toEqual([null, null]);

  // ── A linked window whose Y scale changes kind leaves the group, and says so ──
  await runPaletteCommand(page, "Axis…");
  const again = page.getByRole("dialog", { name: "Axis" });
  await again.getByRole("tab", { name: "Y" }).click();
  await again.getByRole("combobox", { name: "Y axis Type" }).selectOption("log");
  await again.getByRole("button", { name: "Apply" }).click();
  await expect.poll(async () => (await state(page)).linkY.filter((g) => g === null).length).toBe(1);
  await expect(page.getByText(/Y axis unlinked/)).toBeVisible();
});
