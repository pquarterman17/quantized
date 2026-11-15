// Saved fit curves in a real browser (gap audit 5 lane C, gap audit 6 lane K,
// and the review of both): fit with a band -> the Stage export marks the fit
// series and titles Y like the screen -> a second window on another dataset
// never shows the fit, and switching back brings it -> an autosave reload
// redraws it -> a project saved without the figure's own copy redraws it from
// the saved parameters.

import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { chooseFiles } from "../utils/fileChooser";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface Snap { focused: string | null; fitFor: string | null; band: number; docFit: boolean; windows: number; firstDs: string | null }
type Qz = { __qz: { useApp: { getState: () => Record<string, unknown>; setState: (p: Record<string, unknown>) => void } } };

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const s = (window as unknown as Qz).__qz.useApp.getState() as {
      focusedWindowId: string | null; datasets: { id: string }[];
      fitOverlay: { datasetId: string; band?: unknown[] } | null;
      plotWindows: { id: string; document?: { overlays?: { fit?: unknown } } }[];
    };
    const w = s.plotWindows.find((x) => x.id === s.focusedWindowId);
    return {
      focused: s.focusedWindowId, fitFor: s.fitOverlay?.datasetId ?? null, band: s.fitOverlay?.band?.length ?? 0,
      docFit: Boolean(w?.document?.overlays?.fit), windows: s.plotWindows.length, firstDs: s.datasets[0]?.id ?? null,
    };
  });
/** What the newest autosave generation in IndexedDB holds for its focused
 *  window's figure (the real recovery slot a reload restores from). */
const autosavedFit = (page: Page): Promise<{ fit: boolean; band: boolean; background: boolean }> =>
  page.evaluate(() => new Promise((resolve) => {
    const none = { fit: false, band: false, background: false };
    const req = indexedDB.open("qz.autosave", 1);
    req.onerror = () => resolve(none);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const get = db.transaction("generations", "readonly").objectStore("generations").getAll();
        get.onsuccess = () => {
          db.close();
          const gens = (get.result as { at: number; text: string }[]).sort((a, b) => b.at - a.at);
          type W = { id: string; document?: { overlays?: { fit?: { band?: unknown[] }; background?: unknown } } };
          const ws = gens[0] ? (JSON.parse(gens[0].text) as { focusedWindowId?: string; plotWindows?: W[] }) : null;
          const o = ws?.plotWindows?.find((w) => w.id === ws.focusedWindowId)?.document?.overlays;
          resolve({ fit: Boolean(o?.fit), band: Boolean(o?.fit?.band?.length), background: Boolean(o?.background) });
        };
        get.onerror = () => { db.close(); resolve(none); };
      } catch {
        db.close();
        resolve(none);
      }
    };
  }));
const focus = (page: Page, id: string) =>
  page.evaluate((w) => ((window as unknown as Qz).__qz.useApp.getState().focusWindow as (id: string) => void)(w), id);

test("a fitted figure keeps its fit: export title, window switch, autosave reload, .dwk in a fresh context, old project", async ({ page, browser }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("decay-err.csv"));
  await waitForDatasetCount(page, 1);

  // ── Fit with a band ──
  await runPaletteCommand(page, "Curve fit…");
  const panel = page.locator(".qzk-win").filter({ has: page.getByText("Curve Fit", { exact: true }) });
  await panel.getByRole("combobox", { name: "Model", exact: true }).selectOption({ value: "Exponential Decay" });
  await panel.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(panel.getByText("reduced χ²")).toBeVisible({ timeout: 15_000 });
  await panel.getByText("Bands", { exact: true }).click();
  await expect.poll(async () => (await snap(page)).band).toBeGreaterThan(0);
  const fitted = await snap(page);
  expect(fitted.fitFor).toBe(fitted.firstDs);

  // ── Export: the fit series are marked, and the Y title is the screen's ──
  await runPaletteCommand(page, "Export figure…");
  const dialog = page.getByRole("dialog", { name: "Export figure" });
  await dialog.getByLabel("Format").selectOption("svg");
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const body = (await request).postDataJSON() as { y_keys: number[]; dataset: { labels: string[] }; analysis_overlays?: boolean[] };
  expect(body.analysis_overlays).toHaveLength(body.y_keys.length);
  expect(body.analysis_overlays?.filter(Boolean).length).toBeGreaterThanOrEqual(3); // fit + two band edges
  const svg = (await readFile(await (await download).path())).toString("utf8");
  expect(svg).not.toMatch(/signal[^<]*, fit/);
  expect(svg).not.toMatch(/fit, 95%/);

  // ── A second window: no fit there (the fit is the first window's, even on
  // the same dataset); another dataset in it; switching back restores the fit ──
  const first = fitted.focused!;
  await runPaletteCommand(page, "New Graph Window");
  await expect.poll(async () => (await snap(page)).windows).toBe(2);
  await expect.poll(async () => (await snap(page)).focused).not.toBe(first);
  expect((await snap(page)).fitFor).toBeNull();
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 2);
  expect((await snap(page)).fitFor).toBeNull();
  await focus(page, first);
  await expect.poll(async () => (await snap(page)).fitFor).toBe(fitted.firstDs);
  expect((await snap(page)).band).toBeGreaterThan(0);

  // ── Autosave reload: the focused figure's fit (with its band) comes back ──
  // Waits on the STORED autosave holding the fit, not on a timer (review L1).
  await expect.poll(() => autosavedFit(page), { timeout: 15_000 }).toMatchObject({ fit: true, band: true });
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __qz?: unknown }).__qz));
  await expect.poll(async () => (await snap(page)).fitFor, { timeout: 15_000 }).not.toBeNull();
  expect((await snap(page)).band).toBeGreaterThan(0);

  // ── Save the .dwk and open it in a FRESH browser context (lane K acceptance 2) ──
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByText("Save workspace (.dwk)…", { exact: true }).click(),
  ]);
  const savedPath = await saved.path();
  expect(savedPath, "the .dwk download completed").toBeTruthy();
  const fresh = await (await browser.newContext()).newPage();
  await gotoApp(fresh);
  await fresh.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  await chooseFiles(fresh, () => fresh.getByText("Open workspace (.dwk)…", { exact: true }).click(), savedPath!);
  await waitForDatasetCount(fresh, 2);
  await expect.poll(async () => (await snap(fresh)).fitFor, { timeout: 15_000 }).not.toBeNull();
  expect((await snap(fresh)).band).toBeGreaterThan(0);
  await fresh.context().close();

  // ── An older project (no figure copy): redrawn from the saved parameters ──
  await page.evaluate(() => {
    const app = (window as unknown as Qz).__qz.useApp;
    const s = app.getState() as { datasets: unknown[]; focusedWindowId: string; plotWindows: { document?: Record<string, unknown> }[]; loadWorkspace: (ws: unknown) => void };
    s.loadWorkspace({
      datasets: s.datasets,
      plotWindows: s.plotWindows.map((w) => (w.document ? { ...w, document: { ...w.document, overlays: undefined } } : w)),
      focusedWindowId: s.focusedWindowId,
    });
  });
  await expect.poll(async () => (await snap(page)).fitFor, { timeout: 15_000 }).not.toBeNull();
  expect((await snap(page)).band).toBe(0); // the curve only: a band is not regenerated
});

// Second review N2 / N9: a Peak Analyzer model fit changes nothing but the fit
// slot, so only the fit itself may trigger the save; it is figure content, so
// closing the panel keeps it; and its FITTED background is saved with it.
test("a Peak Analyzer fit (with its fitted background) survives a reload with no other edit", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-peaks.csv"));
  await waitForDatasetCount(page, 1);
  // Let the import's own autosave land first, so the next one is the fit's.
  await expect.poll(() => autosavedFit(page), { timeout: 15_000 }).toMatchObject({ fit: false });

  await runPaletteCommand(page, "Peak Analyzer");
  const panel = page.locator(".qzk-win").filter({ has: page.getByText("Peak Analyzer", { exact: true }) });
  await panel.locator(".qzk-wizard-step", { hasText: "Find peaks" }).click();
  await panel.getByRole("button", { name: "Find peaks", exact: true }).click();
  await expect(panel.getByRole("checkbox")).toHaveCount(2, { timeout: 15_000 });
  await panel.locator(".qzk-wizard-step", { hasText: "Fit & review" }).click();
  await panel.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(panel.getByLabel("fit metrics")).toBeVisible({ timeout: 20_000 });
  // No other edit: the fit alone triggers the autosave (review N2).
  await expect.poll(() => autosavedFit(page), { timeout: 15_000 }).toMatchObject({ fit: true, background: true });

  // Closing the panel keeps the model curve and its fitted background.
  await panel.getByTitle("Close").click();
  const kept = await page.evaluate(() => {
    const s = (window as unknown as Qz).__qz.useApp.getState() as { fitOverlay: unknown; baselineOverlay: { fitOf?: unknown } | null };
    return { fit: Boolean(s.fitOverlay), bgOfFit: Boolean(s.baselineOverlay?.fitOf) };
  });
  expect(kept).toEqual({ fit: true, bgOfFit: true });

  await expect.poll(() => autosavedFit(page), { timeout: 15_000 }).toMatchObject({ fit: true, background: true });
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __qz?: unknown }).__qz));
  await expect.poll(async () => (await snap(page)).fitFor, { timeout: 15_000 }).not.toBeNull();
  const back = await page.evaluate(() => {
    const s = (window as unknown as Qz).__qz.useApp.getState() as { fitOverlay: unknown; baselineOverlay: { fitOf?: unknown } | null };
    return Boolean(s.baselineOverlay?.fitOf && s.baselineOverlay.fitOf === s.fitOverlay);
  });
  expect(back).toBe(true);
});
