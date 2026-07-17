// Shared app-shell helpers. `gotoApp` always loads with `?harness` (see
// frontend/src/main.tsx) — the SAME query-param seam `tools/visual`'s
// headless-Chrome harness uses — which exposes `window.__qz.useApp` (the
// live Zustand store) for read-only state assertions a DOM query can't reach
// cleanly (e.g. "did the series style actually change in the store", not
// just "did SOME pixel change"). No spec should navigate any other way.

import { expect, type Page } from "@playwright/test";

export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/?harness");
  await expect(page.locator(".qzk-library")).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as { __qz?: unknown }).__qz));
}

/** Wait until exactly `n` dataset rows are visible in the Library (import is
 *  async: upload -> parse -> addDataset). Scopes to `[data-ds-id]` so folder
 *  headers / figure rows never inflate the count. */
export async function waitForDatasetCount(page: Page, n: number): Promise<void> {
  await expect(page.locator("[data-ds-id]")).toHaveCount(n, { timeout: 15_000 });
}
