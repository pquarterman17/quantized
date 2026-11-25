// PREFS_AUDIT lane 4 (workflow, safety, startup), through a real browser:
//   * Preferences ▸ General values persist across a reload and each takes
//     effect (undo depth, recents cap, autosave delay);
//   * "Confirm before replacing the workspace" (owner decision 2026-11-25, ON
//     by default): Cancel keeps the workspace; switched off in the dialog, the
//     same Open replaces without asking;
//   * the unsaved-changes guard exists only without `?harness` (a scripted
//     reload must never meet a native dialog), only while there are unsaved
//     changes and the pref is on.
// Not `@core`: DOM controls and store state, no canvas hit-testing.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { chooseFiles } from "../utils/fileChooser";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, launchPath, waitForDatasetCount } from "../utils/harness";

interface Store {
  getState: () => {
    history: unknown[];
    recent: unknown[];
    datasets: unknown[];
    recordHistory: (label: string) => void;
    pushRecent: (name: string, size: number) => void;
    setPrefsOpen: (v: boolean) => void;
  };
}
const store = (page: Page) => page.evaluateHandle(() => (window as unknown as { __qz: { useApp: Store } }).__qz.useApp);

async function openGeneral(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __qz: { useApp: Store } }).__qz.useApp.getState().setPrefsOpen(true));
  const dlg = page.getByRole("dialog", { name: "Preferences" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("tab", { name: "General" }).click();
}

const slot = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("qz.workflowPrefs") ?? "{}") as Record<string, unknown>);

test("General prefs persist across a reload and take effect", async ({ page }) => {
  await gotoApp(page);
  await openGeneral(page);
  const dlg = page.getByRole("dialog", { name: "Preferences" });
  await dlg.getByRole("textbox", { name: "Undo steps" }).fill("20");
  await dlg.getByRole("textbox", { name: "Recent files kept" }).fill("5");
  await dlg.getByRole("textbox", { name: "Autosave delay" }).fill("3");
  await dlg.getByRole("textbox", { name: "Undo steps" }).fill("5"); // refused: below 10
  await expect(dlg.getByRole("alert")).toContainText("from 10 to 200");
  await dlg.getByRole("textbox", { name: "Undo steps" }).fill("20");
  await dlg.getByRole("switch", { name: "Show first-run hints" }).click();
  await expect.poll(() => slot(page)).toMatchObject({ undoDepth: 20, recentFilesMax: 5, autosaveDebounceSec: 3, showFirstRunHints: false });

  await page.reload();
  await expect(page.locator(".qzk-library")).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as { __qz?: unknown }).__qz));
  await openGeneral(page);
  const dlg2 = page.getByRole("dialog", { name: "Preferences" });
  await expect(dlg2.getByRole("textbox", { name: "Undo steps" })).toHaveValue("20");
  await expect(dlg2.getByRole("textbox", { name: "Recent files kept" })).toHaveValue("5");
  await expect(dlg2.getByRole("textbox", { name: "Autosave delay" })).toHaveValue("3");
  await expect(dlg2.getByRole("switch", { name: "Show first-run hints" })).toHaveAttribute("aria-checked", "false");
  await page.evaluate(() => (window as unknown as { __qz: { useApp: Store } }).__qz.useApp.getState().setPrefsOpen(false));

  // Effects: undo depth and the recents cap read the saved values after the reload.
  const s = await store(page);
  await s.evaluate((u) => { for (let i = 0; i < 30; i++) u.getState().recordHistory(`step ${i}`); });
  expect(await s.evaluate((u) => u.getState().history.length)).toBe(20);
  await s.evaluate((u) => { for (let i = 0; i < 9; i++) u.getState().pushRecent(`f${i}.csv`, 1); });
  expect(await s.evaluate((u) => u.getState().recent.length)).toBe(5);
  // The first-run hints card stays hidden on a fresh load with the pref off.
  await page.evaluate(() => localStorage.removeItem("qz.interactionHints.seen"));
  await page.reload();
  await expect(page.locator(".qzk-library")).toBeVisible();
  await expect(page.getByLabel("Interaction hints")).toHaveCount(0);
});

test("autosave waits for the configured delay", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => localStorage.setItem("qz.workflowPrefs", JSON.stringify({ autosaveDebounceSec: 4 })));
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __qz?: unknown }).__qz));
  const generations = () =>
    page.evaluate(
      () =>
        new Promise<number>(async (resolve) => {
          // Never create the DB from here: opening a missing one at v1 would leave
          // it without the app's store (the app opens it at the same version).
          if (!(await indexedDB.databases()).some((d) => d.name === "qz.autosave")) return resolve(0);
          const open = indexedDB.open("qz.autosave");
          open.onerror = () => resolve(-1);
          open.onsuccess = () => {
            const db = open.result;
            // Close at once: an open connection would block the app's own upgrade.
            if (!db.objectStoreNames.contains("generations")) return (db.close(), resolve(0));
            const q = db.transaction("generations").objectStore("generations").count();
            q.onsuccess = () => (db.close(), resolve(q.result));
            q.onerror = () => (db.close(), resolve(-1));
          };
        }),
    );
  const before = await generations();
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);
  await page.waitForTimeout(1500); // well past the default 0.8 s, still inside the 4 s setting
  expect(await generations()).toBe(before);
  await expect.poll(generations, { timeout: 10_000 }).toBeGreaterThan(before);
});

test("replace-workspace confirm: Cancel keeps it; off in Preferences opens without asking", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByText("Save workspace as…", { exact: true }).click(),
  ]);
  const saved = (await download.path())!;
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 2);

  const open = async () => {
    await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
    await chooseFiles(page, () => page.getByRole("menuitem", { name: "Open workspace (.dwk)…", exact: true }).click(), saved);
  };
  // ON by default: the confirm appears; Cancel changes nothing.
  await open();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: "Replace the current workspace?" }));
  await expect(confirm.getByText("Replace the current workspace?")).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await waitForDatasetCount(page, 2);

  // Off: the same Open replaces straight away (2 datasets -> the saved 1).
  await openGeneral(page);
  const dlg = page.getByRole("dialog", { name: "Preferences" });
  await dlg.getByRole("switch", { name: "Confirm before replacing the workspace" }).click();
  await expect.poll(() => slot(page)).toMatchObject({ confirmReplaceWorkspace: false });
  await page.evaluate(() => (window as unknown as { __qz: { useApp: Store } }).__qz.useApp.getState().setPrefsOpen(false));
  await open();
  await waitForDatasetCount(page, 1);
  await expect(page.getByText("Replace the current workspace?")).toHaveCount(0);
});

test("unsaved-changes guard: absent under ?harness; armed outside it only while there is unsaved work and the pref is on", async ({ page, browser, baseURL }) => {
  const blocked = (p: Page) =>
    p.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);
  expect(await blocked(page)).toBe(false); // harness seam: scripted reloads never meet the dialog

  // A real session (no ?harness) in a fresh context, so no autosave restore: driven through the UI only.
  const ctx = await browser.newContext({ baseURL, colorScheme: "dark", viewport: { width: 1360, height: 900 } });
  try {
    // A non-harness page mirrors prefs to the server's prefs file: answer /api/prefs
    // locally so this test never writes the developer's real config.
    await ctx.route("**/api/prefs", (r) => r.fulfill({ json: { slots: {}, notice: null } }));
    const real = await ctx.newPage();
    await real.goto(launchPath("session=real"));
    await expect(real.locator(".qzk-library")).toBeVisible();
    await expect.poll(() => blocked(real)).toBe(false); // clean: nothing to lose, no listener
    await dropFileOnto(real, real.locator(".qzk-library"), fixturePath("two-channel.csv"));
    await waitForDatasetCount(real, 1);
    await expect.poll(() => blocked(real)).toBe(true);
    await real.keyboard.press("Control+,");
    const dlg = real.getByRole("dialog", { name: "Preferences" });
    await dlg.getByRole("tab", { name: "General" }).click();
    await dlg.getByRole("switch", { name: "Warn before closing with unsaved changes" }).click();
    await expect.poll(() => blocked(real)).toBe(false);
  } finally {
    await ctx.close();
  }
});
