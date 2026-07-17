// Journey (f) — Arm a region tool (Integrate), start a drag on the canvas,
// press Esc mid-drag, verify the gesture cancelled and the HUD (ToolHud)
// behaved correctly (GUI_INTERACTION_PLAN #15 / #9). Native pointer capture
// over a live canvas mid-drag is exactly what jsdom cannot simulate —
// gestureCancel.test.ts exercises `cancelActiveGesture()` as a plain
// function call, never a real in-flight mousedown/mousemove sequence.
//
// Two behaviors, both named in the plan item:
//  1. HUD appears when a tool is armed; Esc with NO gesture in progress
//     reverts the tool to Pointer (HUD disappears).
//  2. Esc DURING a live drag cancels only the gesture (no result committed)
//     and leaves the tool armed for an immediate retry (HUD stays put) —
//     see lib/gestureCancel.ts's module doc.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

test.describe("Region-tool arm / drag / Esc-cancel @core", () => {
  test("Esc with no drag reverts the tool to Pointer", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);

    const integrateBtn = page.getByRole("button", { name: "Integrate" });
    await integrateBtn.click();
    await expect(integrateBtn).toHaveAttribute("aria-pressed", "true");

    const hud = page.getByRole("status");
    await expect(hud).toContainText("Integrate");

    await page.keyboard.press("Escape");

    await expect(integrateBtn).toHaveAttribute("aria-pressed", "false");
    await expect(hud).toHaveCount(0);
  });

  test("Esc mid-drag cancels the gesture without committing a result; tool stays armed", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);

    const integrateBtn = page.getByRole("button", { name: "Integrate" });
    await integrateBtn.click();

    const plotOver = page.locator(".qzk-stage .u-over");
    const box = (await plotOver.boundingBox())!;
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up(); // release outside any live listener — a no-op if cancel tore them down

    // No committed result chip...
    await expect(page.locator(".qzk-result-chip")).toHaveCount(0);
    // ...and the tool is still armed (first Esc during a drag only cancels
    // the gesture — see lib/gestureCancel.ts) so the HUD is still showing.
    await expect(integrateBtn).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status")).toContainText("Integrate");

    // Sanity control: completing the SAME drag without Esc commits a result
    // chip — proves the earlier absence was a real cancel, not a tool that
    // never produces a chip in this harness.
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator(".qzk-result-chip")).toHaveCount(1);
  });
});
