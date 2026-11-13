// Figures-audit B2 — a style template saved from one plain CSV restyles a
// graph of ANOTHER plain CSV. Before the fix the only style templates lived
// in the legacy Figure Builder and Plot Recipes refused "generic" data, so
// a lab's house style could not travel between two ordinary CSV files.
//
// Journey: restyle the first CSV's curve through the real right-click menu
// (canvas hit-test), save it with Plot ▸ "Save Graph Template…", import a
// second CSV, apply the template with Plot ▸ "Apply Graph Template…", and
// read the live store to confirm the second graph carries the style.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface SeriesStyle {
  color?: string;
  marker?: boolean;
  markerShape?: string;
}

interface HarnessState {
  activeId: string | null;
  datasets: { id: string; name: string }[];
  seriesStyles: Record<number, SeriesStyle>;
}

async function harnessState(page: Page): Promise<HarnessState> {
  return page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => HarnessState } } }).__qz.useApp.getState();
    return { activeId: s.activeId, datasets: s.datasets.map((d) => ({ id: d.id, name: d.name })), seriesStyles: s.seriesStyles };
  });
}

async function activeName(page: Page): Promise<string> {
  const s = await harnessState(page);
  return s.datasets.find((d) => d.id === s.activeId)?.name ?? "";
}

test("a graph template saved from one plain CSV restyles another CSV's graph", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);

  // ── Style the first graph: colour + marker shape via the curve menu ──
  const plotOver = page.locator(".qzk-stage .u-over");
  await expect(plotOver).toBeVisible();
  await plotOver.click({ button: "right" });
  await page.getByRole("button", { name: "Series 2" }).click();
  await plotOver.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Marker" }).hover();
  await page.getByRole("menuitemcheckbox", { name: "◆ diamond" }).click();
  await expect.poll(async () => (await harnessState(page)).seriesStyles[0]?.markerShape).toBe("diamond");

  // ── Save it as a graph template from the Plot menu ──
  await runPaletteCommand(page, "Save Graph Template…");
  const saveDialog = page.getByRole("dialog", { name: "Save Graph Template" });
  await expect(saveDialog).toBeVisible();
  await saveDialog.getByRole("textbox", { name: "Template name" }).fill("Lab style");
  await saveDialog.getByRole("button", { name: "Run" }).click();
  await expect(saveDialog).toHaveCount(0);

  // ── A second, differently-shaped plain CSV ──
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 2);
  await expect.poll(() => activeName(page)).toContain("two-channel");
  expect((await harnessState(page)).seriesStyles[0]?.markerShape).toBeUndefined();

  // ── Apply the template to it ──
  await runPaletteCommand(page, "Apply Graph Template…");
  const applyDialog = page.getByRole("dialog", { name: "Apply Graph Template" });
  await expect(applyDialog).toBeVisible();
  await applyDialog.getByRole("combobox", { name: "Template" }).selectOption("Lab style");
  await applyDialog.getByRole("button", { name: "Run" }).click();

  await expect.poll(async () => (await harnessState(page)).seriesStyles[0]?.markerShape).toBe("diamond");
  const applied = (await harnessState(page)).seriesStyles[0];
  expect(applied?.color).toBe("--series-2");
  expect(applied?.marker).toBe(true);
  expect(await activeName(page)).toContain("two-channel");
});
