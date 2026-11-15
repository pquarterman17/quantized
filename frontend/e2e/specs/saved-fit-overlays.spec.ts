// Saved fit curves in a real browser (gap audit 5 lane C, gap audit 6 lane K,
// and the review of both): fit with a band -> the Stage export marks the fit
// series and titles Y like the screen -> a second window on another dataset
// never shows the fit, and switching back brings it -> an autosave reload
// redraws it -> a project saved without the figure's own copy redraws it from
// the saved parameters.

import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
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
const focus = (page: Page, id: string) =>
  page.evaluate((w) => ((window as unknown as Qz).__qz.useApp.getState().focusWindow as (id: string) => void)(w), id);

test("a fitted figure keeps its fit: export title, window switch, autosave reload, old project", async ({ page }) => {
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
  await page.waitForTimeout(4000); // let the autosave land
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __qz?: unknown }).__qz));
  await expect.poll(async () => (await snap(page)).fitFor, { timeout: 15_000 }).not.toBeNull();
  expect((await snap(page)).band).toBeGreaterThan(0);

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
