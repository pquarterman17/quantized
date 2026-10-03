// GUI audit (2026-09-29) — chrome that must fit its container at 100% and
// 125% scaling and in a narrow window. jsdom has no layout, so the real
// promises live here:
//   - the plot dock never leaves a tool unreachable: each button is either
//     inside its stage or listed in the dock's "⋯" menu (P1);
//   - the default NE legend sits below the dock, not under it;
//   - the Graph Builder window stays inside the viewport with a usable preview;
//   - a Library worksheet name keeps real width at the default 210px panel;
//   - the Quick Figure Builder grid never overflows its container.
// The dock journey is `@core` so it also runs in the 125%/200% projects.

import { expect, type Locator, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

// 1360x900 is the suite's default; 1088x720 is the same screen at 125% OS
// scaling (CSS px shrink by 1/1.25); 820x700 is a narrow window.
const SIZES = [
  { width: 1360, height: 900 },
  { width: 1088, height: 720 },
  { width: 820, height: 700 },
];

async function loadPlot(page: Page): Promise<void> {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 1);
  await page.locator("[data-ds-id]").first().click();
  await expect(page.locator(".qzk-float-tools").first()).toBeVisible();
}

/** Names of the dock's buttons that are painted inside its stage, and of
 *  every dock button at all (collapsed groups stay mounted but aria-hidden). */
async function dockState(dock: Locator) {
  return dock.evaluate((bar) => {
    const stage = bar.parentElement!.getBoundingClientRect();
    const all = [...bar.querySelectorAll<HTMLButtonElement>("button")];
    const inside = all.filter((b) => {
      if (b.closest("[aria-hidden='true']")) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.left >= stage.left - 0.5 && r.right <= stage.right + 0.5;
    });
    const name = (b: HTMLButtonElement) => b.getAttribute("aria-label") ?? "";
    return { all: all.map(name), inside: inside.map(name) };
  });
}

async function expectEveryToolReachable(page: Page, dock: Locator): Promise<void> {
  const { all, inside } = await dockState(dock);
  expect(all.length).toBeGreaterThanOrEqual(23);
  const missing = all.filter((n) => !inside.includes(n));
  if (missing.length === 0) return;
  expect(inside).toContain("Toolbar Options");
  await dock.getByRole("button", { name: "Toolbar Options" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const menuText = (await menu.innerText()).replace(/\s+/g, " ");
  for (const n of missing) {
    // The split Annotate button collapses into its "Draw <shape>" entries.
    const needle = n === "Choose drawing tool" ? "Draw Ellipse" : n;
    expect(menuText, `"${n}" is neither on screen nor in the ⋯ menu`).toContain(needle);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

function overlaps(a: DOMRect | null, b: DOMRect | null): boolean {
  if (!a || !b) return false;
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

test("the plot dock keeps every tool reachable and the default legend clears it @core", async ({ page }) => {
  test.setTimeout(60_000);
  await loadPlot(page);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const dock = page.locator(".qzk-stage > .qzk-float-tools").first();
    await expect(dock).toBeVisible();
    await expectEveryToolReachable(page, dock);

    // The default legend is "auto" (least-crowded corner); a saved view keeps "ne".
    const legend = page.locator(".qzk-stage > .qzk-legend:is(.auto,.ne)").first();
    await expect(legend).toBeVisible();
    const [l, d] = await Promise.all([
      legend.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect),
      dock.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect),
    ]);
    expect(overlaps(l, d), `legend overlaps the dock at ${size.width}x${size.height}`).toBe(false);
  }
});

test("a default Graph Window's dock keeps every tool reachable @core", async ({ page }) => {
  await loadPlot(page);
  await runPaletteCommand(page, "New Graph Window");
  const docks = page.locator(".qzk-plotwin .qzk-float-tools");
  await expect(docks.first()).toBeVisible();
  for (const dock of await docks.all()) await expectEveryToolReachable(page, dock);
});

test("the Graph Builder window fits the viewport and keeps a usable preview", async ({ page }) => {
  await loadPlot(page);
  await runPaletteCommand(page, "Graph Builder");
  const win = page.locator(".qzk-win").filter({ has: page.getByText("Graph Builder", { exact: true }) });
  await expect(win).toBeVisible();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const box = (await win.boundingBox())!;
    expect(box.y + box.height, `window bottom at ${size.width}x${size.height}`).toBeLessThanOrEqual(size.height);
    const preview = (await win.locator(".qzk-graph-preview").boundingBox())!;
    expect(preview.height, `preview height at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(140);
  }
});

test("a Library worksheet name keeps its width at the default panel size", async ({ page }) => {
  await loadPlot(page);
  const name = page.locator("[data-ds-id] .qzk-ds-name").first();
  const w = (await name.boundingBox())!.width;
  expect(w).toBeGreaterThanOrEqual(60);
  await expect(page.locator("[data-ds-id] .qzk-ds-compact-meta").first()).toHaveText(/^\d+ pts · \d+ ch/);
});

test("the Quick Figure Builder grid never overflows its container", async ({ page }) => {
  await loadPlot(page);
  const row = page.locator("[data-ds-id]").first();
  await row.hover();
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Configure Quick Plot…", exact: true }).click();
  const qfb = page.locator(".qzk-quick-builder");
  await expect(qfb.locator(".qzk-quick-builder-grid")).toBeVisible();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const m = await qfb.evaluate((el) => {
      const grid = el.querySelector(".qzk-quick-builder-grid")!;
      const cards = [...grid.children].map((c) => c.getBoundingClientRect());
      const box = grid.getBoundingClientRect();
      return { overflow: grid.scrollWidth - grid.clientWidth, maxRight: Math.max(...cards.map((c) => c.right)), right: box.right };
    });
    expect(m.overflow, `grid overflow at ${size.width}x${size.height}`).toBeLessThanOrEqual(1);
    expect(m.maxRight).toBeLessThanOrEqual(m.right + 1);
  }
});

type QzHarness = { __qz: { useApp: { setState: (s: object) => void } } };

// Round-4 chrome audit: the import toast sat bottom-centre of the WINDOW,
// which is the bottom-centre of the stage, exactly where the x-axis title is
// drawn. A toast now docks over a side panel (or the title bar when both
// panels are collapsed), so it never covers any part of the plot stage.
test("an import toast never covers the plot stage", async ({ page }) => {
  test.setTimeout(60_000);
  await loadPlot(page);
  const cases = [
    ...SIZES.map((size) => ({ size, lc: false, rc: false })),
    { size: SIZES[0], lc: false, rc: true },
    { size: SIZES[0], lc: true, rc: true },
  ];
  const files = ["two-channel.csv", "six-channel.csv", "linear-ramp.csv", "dataset-a.csv", "dataset-b.csv"];
  for (const [i, c] of cases.entries()) {
    await page.setViewportSize(c.size);
    await page.evaluate(
      ([lc, rc]) => (window as unknown as QzHarness).__qz.useApp.setState({ leftCollapsed: lc, rightCollapsed: rc }),
      [c.lc, c.rc],
    );
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath(files[i]));
    await waitForDatasetCount(page, i + 2);
    const toast = page.locator(".qzk-toast", { hasText: "imported 1 file" }).last();
    await expect(toast).toBeVisible();
    const where = `${c.size.width}x${c.size.height}${c.lc ? " no library" : ""}${c.rc ? " no inspector" : ""}`;
    const [t, s] = await Promise.all([
      toast.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect),
      page.locator(".qzk-stage").first().evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect),
    ]);
    expect(overlaps(t, s), `toast covers the plot stage at ${where}`).toBe(false);
    // A collapsed panel gives its width to the stage (both at once, too).
    if (c.lc) expect(s.left, `library still open at ${where}`).toBeLessThanOrEqual(1);
    if (c.rc) expect(s.right, `inspector still open at ${where}`).toBeGreaterThanOrEqual(c.size.width - 1);
    const inside = t.left >= 0 && t.top >= 0 && t.right <= c.size.width && t.bottom <= c.size.height;
    expect(inside, `toast clipped at ${where}`).toBe(true);
  }
});
