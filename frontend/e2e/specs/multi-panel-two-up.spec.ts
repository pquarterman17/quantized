// UX audit 9 #9 (lane UX9-G): the quick two-panel journal figure. Two imported
// datasets -> Multi-panel export -> click each dataset -> APS double column ->
// Export. The page opens as 1x2 (no grid editing), the preview shows after the
// first assignment, the labels are (a)/(b), and the exported PDF page is the
// preset's 17.8 cm wide x 6.5 cm tall (1 row).

import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

test("two datasets -> 1x2 APS double-width page with (a)/(b) labels -> export", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 2);

  await runPaletteCommand(page, "Multi-panel export");
  const win = page.locator(".qzk-win").filter({ has: page.getByText(/^Multi-panel export/) });
  await expect(win).toBeVisible();
  await expect(win.locator("[data-slot-index]")).toHaveCount(2); // 1x2 by default

  const datasets = win.locator('button[title^="Click to assign"]');
  await datasets.nth(0).click();
  // The preview appears after the FIRST slot is filled, with no grid editing.
  await expect(win.getByAltText("figure page preview")).toBeVisible({ timeout: 20_000 });
  await datasets.nth(1).click();
  await expect(win.locator("[data-slot-index]")).toHaveCount(2);
  // No red wall of text displaces the controls.
  await expect(win.getByText("Cannot save yet")).toHaveCount(0);

  await win
    .locator("select")
    .filter({ has: page.locator('option[value="aps_double"]') })
    .selectOption("aps_double");

  const exportResponse = page.waitForResponse((r) => {
    if (r.request().method() !== "POST" || new URL(r.url()).pathname !== "/api/export/figure-page") return false;
    return (r.request().postDataJSON() as { fmt?: string }).fmt === "pdf";
  });
  const download = page.waitForEvent("download");
  await win.getByRole("button", { name: /^Export/ }).click();
  const [response, dl] = await Promise.all([exportResponse, download]);
  expect(response.ok()).toBe(true);
  const body = response.request().postDataJSON() as {
    rows: number;
    cols: number;
    style: string;
    label_format: string;
    panels: { row: number; col: number }[];
  };
  expect([body.rows, body.cols]).toEqual([1, 2]);
  expect(body.style).toBe("aps_double");
  expect(body.label_format).toBe("(a)");
  expect(body.panels.map((p) => [p.row, p.col])).toEqual([[0, 0], [0, 1]]);

  const pdf = await readFile((await dl.path()) as string);
  const m = /\/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
  expect(m, "PDF MediaBox").toBeTruthy();
  const cm = (pt: string) => (Number(pt) / 72) * 2.54;
  expect(cm(m![1])).toBeCloseTo(17.8, 1);
  expect(cm(m![2])).toBeCloseTo(6.5, 1);
});
