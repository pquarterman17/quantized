// First impression of an Origin project: it opens on its FIRST graph (what
// Origin itself shows), and a project without a recovered graph opens on the
// first-plot heuristics, never every column of the raw worksheet.
//
// Needs a real project file, and e2e/fixtures only holds synthetic CSVs, so
// the specimens are PUBLIC corpus files supplied by the caller (never
// committed): QZ_E2E_ORIGIN_WITH_GRAPHS (e.g. labplot's 2graphs.opj) and
// QZ_E2E_ORIGIN_NO_GRAPHS (a worksheet-only project). Each test skips when
// its variable is unset, so CI without the corpus stays green.

import fs from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { gotoApp } from "../utils/harness";

const WITH_GRAPHS = process.env.QZ_E2E_ORIGIN_WITH_GRAPHS;
const NO_GRAPHS = process.env.QZ_E2E_ORIGIN_NO_GRAPHS;

type QzWindow = { __qz: { useApp: { getState: () => Record<string, unknown> } } };
interface Snap {
  figures: string[];
  activeName: string | null;
  nCols: number;
  yKeys: number[] | null;
  toasts: string[];
}
const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState() as {
      originFigures: { figure: { name: string } }[];
      activeId: string | null;
      yKeys: number[] | null;
      datasets: { id: string; name: string; data: { labels: string[] } }[];
    };
    const a = s.datasets.find((d) => d.id === s.activeId);
    return {
      figures: s.originFigures.map((f) => f.figure.name),
      activeName: a?.name ?? null,
      nCols: a?.data.labels.length ?? 0,
      yKeys: s.yKeys,
      toasts: [...document.querySelectorAll(".qzk-toast")].map((t) => t.textContent ?? ""),
    };
  });

async function openProject(page: Page, file: string): Promise<void> {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), file, "application/octet-stream");
  await expect.poll(async () => (await snap(page)).activeName, { timeout: 30_000 }).not.toBeNull();
}

test("a project with graphs opens on its first graph and says so", async ({ page }) => {
  test.skip(!WITH_GRAPHS || !fs.existsSync(WITH_GRAPHS), "QZ_E2E_ORIGIN_WITH_GRAPHS not set");
  test.setTimeout(90_000);
  await openProject(page, WITH_GRAPHS!);
  await expect.poll(async () => (await snap(page)).figures.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const first = (await snap(page)).figures[0];
  const toast = page.locator(".qzk-toast", { hasText: `Opened ${first}` });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Origin graph");
  await expect(toast).toContainText("Library ▸ Origin figures to browse");
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
});

test("a project without graphs never plots every column of the raw book", async ({ page }) => {
  test.skip(!NO_GRAPHS || !fs.existsSync(NO_GRAPHS), "QZ_E2E_ORIGIN_NO_GRAPHS not set");
  test.setTimeout(90_000);
  await openProject(page, NO_GRAPHS!);
  const s = await snap(page);
  expect(s.figures).toHaveLength(0);
  expect(s.toasts.some((t) => t.startsWith("Opened"))).toBe(false);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  if (s.nCols > 9) expect(s.yKeys?.length ?? s.nCols).toBeLessThanOrEqual(8);
});
