// UX9-H: landmarks, menubar roles, keyboard-resizable Library splitter, and
// the Curve Fit model search showing a real multi-row list.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

test.describe("accessibility structure (UX9-H)", () => {
  test("main landmark, h1, menubar items, splitter keyboard", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const bar = page.getByRole("menubar", { name: "Application menu" });
    await expect(bar.getByRole("menuitem").first()).toBeVisible();

    const sep = page.getByRole("separator", { name: "Resize Library panel" });
    await sep.focus();
    const before = Number(await sep.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowRight");
    await expect(sep).toHaveAttribute("aria-valuenow", String(before + 16));
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(sep).toHaveAttribute("aria-valuenow", String(before - 16));
    await sep.dblclick();
    await expect(sep).not.toHaveAttribute("aria-valuenow", String(before - 16));
  });

  test("typing a model search shows a real list", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);
    await runPaletteCommand(page, "Curve fit…");
    const panel = page.locator(".qzk-win").filter({ has: page.getByText("Curve Fit", { exact: true }) });
    await panel.getByRole("searchbox", { name: "Search models" }).fill("exp");
    const list = panel.getByRole("listbox", { name: "Model" });
    await expect(list).toBeVisible();
    expect(await list.getByRole("option").count()).toBeGreaterThanOrEqual(5);
    const box = await list.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(100);
  });
});
