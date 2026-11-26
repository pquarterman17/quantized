// Owner decision 2026-11-26: "When I open Quantized it always opens a
// magnetometry project. I want it to open to the welcome menu." The cause was
// the autosave restore loading the previous session unconditionally. Now a
// launch with an autosaved session shows the welcome screen with a
// "Restore last session" action (nothing is loaded, nothing is deleted); the
// Preferences ▸ General ▸ On startup = Reopen last session brings the old
// behaviour back. Not `@core`: DOM and store state, no canvas hit-testing.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, restoreLastSession, waitForDatasetCount } from "../utils/harness";

const generations = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("qz.autosave", 1);
        req.onerror = () => resolve(0);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const get = db.transaction("generations", "readonly").objectStore("generations").getAll();
            get.onsuccess = () => (db.close(), resolve((get.result as unknown[]).length));
            get.onerror = () => (db.close(), resolve(0));
          } catch {
            db.close();
            resolve(0);
          }
        };
      }),
  );

/** Open a magnetometry fixture and wait until autosave has stored it. */
async function seedSession(page: Page): Promise<void> {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("mh-vsm-300K.txt"));
  await waitForDatasetCount(page, 1);
  await expect.poll(() => generations(page), { timeout: 15_000 }).toBeGreaterThan(0);
}

test("a fresh start shows the welcome screen, and Restore brings the session back", async ({ page }) => {
  await seedSession(page);

  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __qz?: unknown }).__qz));
  // Welcome screen: nothing loaded, the usual start actions, and the restore action naming the session.
  await expect(page.getByRole("heading", { name: "No data loaded" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import data…" })).toBeVisible();
  const restore = page.getByRole("button", { name: /Restore last session \(mh-vsm-300K/ });
  await expect(restore).toBeVisible();
  await expect(page.locator("[data-ds-id]")).toHaveCount(0);
  await expect(page.getByText("⚠ previous session not restored")).toBeVisible(); // status bar keeps it visible
  expect(await generations(page)).toBeGreaterThan(0); // nothing deleted

  // A second launch without answering still finds it (the pin keeps it out of the rotation).
  await page.reload();
  await expect(page.getByRole("button", { name: /Restore last session/ })).toBeVisible();

  await restoreLastSession(page);
  await waitForDatasetCount(page, 1);
  await expect(page.locator("[data-ds-id]").first()).toContainText("mh-vsm-300K");
  await expect(page.getByRole("button", { name: /Restore last session/ })).toHaveCount(0);
});

test("On startup = Reopen last session restores without the welcome screen", async ({ page }) => {
  await seedSession(page);
  await page.evaluate(() => localStorage.setItem("qz.workflowPrefs", JSON.stringify({ onStartup: "reopen" })));
  await page.reload();
  await waitForDatasetCount(page, 1);
  await expect(page.getByRole("button", { name: /Restore last session/ })).toHaveCount(0);
});

test("Preferences ▸ General ▸ On startup writes the pref", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Control+,");
  const dlg = page.getByRole("dialog", { name: "Preferences" });
  await dlg.getByRole("tab", { name: "General" }).click();
  await expect(dlg.getByRole("radio", { name: "Welcome screen" })).toHaveAttribute("aria-checked", "true");
  await dlg.getByRole("radio", { name: "Reopen last session" }).click();
  await expect
    .poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("qz.workflowPrefs") ?? "{}") as { onStartup?: string }).onStartup))
    .toBe("reopen");
});
