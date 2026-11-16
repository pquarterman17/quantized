// The DEFAULT figure-export path (UX-H): Plot ▸ Export figure… opens the
// export view (the Publication preview); pick a format, press its one primary
// Export button, read back the request and the downloaded file, close.
// Specs that verify "what the export carries" go through here so they cover
// the path users actually take; `"Export figure (quick dialog)…"` is the
// power-user dialog and keeps its own coverage.

import { readFile } from "node:fs/promises";

import { expect, type Locator, type Page } from "@playwright/test";

import { runPaletteCommand } from "./palette";

export function exportView(page: Page): Locator {
  return page.locator('[data-tool-window="figurebuilder"]');
}

export async function exportFromView<B = Record<string, unknown>>(
  page: Page,
  fmt: "pdf" | "svg" | "png" | "tiff" | "eps",
): Promise<{ body: B; bytes: Buffer; text: string }> {
  await runPaletteCommand(page, "Export figure…");
  const view = exportView(page);
  await expect(view.getByAltText("figure preview")).toBeVisible({ timeout: 15_000 });
  await view.getByRole("radio", { name: fmt.toUpperCase(), exact: true }).click();
  const button = view.getByRole("button", { name: `Export ${fmt.toUpperCase()}…`, exact: true });
  await expect(button).toBeEnabled();
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await button.click();
  const body = (await request).postDataJSON() as B;
  const bytes = await readFile((await (await download).path())!);
  // Closing right after an export asks nothing (no discard prompt).
  await view.getByRole("button", { name: "Close", exact: true }).click();
  await expect(view).toHaveCount(0);
  return { body, bytes, text: bytes.toString("utf8") };
}
