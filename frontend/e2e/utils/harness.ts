// Shared app-shell helpers. `gotoApp` always loads with `?harness` (see
// frontend/src/main.tsx) — the SAME query-param seam `tools/visual`'s
// headless-Chrome harness uses — which exposes `window.__qz.useApp` (the
// live Zustand store) for read-only state assertions a DOM query can't reach
// cleanly (e.g. "did the series style actually change in the store", not
// just "did SOME pixel change"). No spec should navigate any other way.

import { expect, type Page } from "@playwright/test";

/** The launch URL `qz` opens: `?token=` is traded for the API cookie and
 *  redirected away (docs/api_auth.md). playwright.config.ts sets the token. */
export function launchPath(query = "harness"): string {
  return `/?${query}&token=${process.env.QZ_API_TOKEN ?? ""}`;
}

/** Owner decision 2026-11-26: the window layout is the default. A spec that exercises the CLASSIC layout
 *  (stage tabs, the Inspector side column, tool dock) calls this BEFORE `gotoApp`: it records an explicit
 *  classic choice (store/prefs.ts LAYOUT_MODE_KEY) unless the page already has one, and cuts this page off
 *  from the server's prefs file, which wins over localStorage at hydrate and would otherwise carry the
 *  choice into (or in from) every other spec sharing the server. */
export async function classicLayout(page: Page): Promise<void> {
  await page.route("**/api/prefs", (route) => route.abort());
  await page.addInitScript(() => {
    try {
      const p = JSON.parse(localStorage.getItem("qz.prefs") ?? "{}") as Record<string, unknown>;
      if (p.layoutModeV2 === undefined) localStorage.setItem("qz.prefs", JSON.stringify({ ...p, layoutModeV2: "classic" }));
    } catch {
      /* storage blocked: the page keeps the default */
    }
  });
}

const noPicker = new WeakSet<Page>();

export async function gotoApp(page: Page): Promise<void> {
  // Lane O: a browser Save As opens Chromium's File System Access picker when
  // the page has one, and that native dialog never resolves under automation.
  // Specs assert the save through its download, so hide the picker (for every
  // load of this page, reloads included) and take the download fallback --
  // the same path Firefox/Safari users get. The picker path is unit-tested
  // (src/store/workspaceIO.browserSave.test.ts).
  if (!noPicker.has(page)) {
    noPicker.add(page);
    await page.addInitScript(() => {
      delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    });
  }
  await page.goto(launchPath());
  await expect(page.locator(".qzk-library")).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as { __qz?: unknown }).__qz));
}

/** Wait until exactly `n` dataset rows are visible in the Library (import is
 *  async: upload -> parse -> addDataset). Scopes to `[data-ds-id]` so folder
 *  headers / figure rows never inflate the count. */
export async function waitForDatasetCount(page: Page, n: number): Promise<void> {
  await expect(page.locator("[data-ds-id]")).toHaveCount(n, { timeout: 15_000 });
}

/** A launch with an autosaved session shows the welcome screen (owner decision
 *  2026-11-26) instead of loading it: click its "Restore last session" action. */
export async function restoreLastSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Restore last session/ }).click();
}
