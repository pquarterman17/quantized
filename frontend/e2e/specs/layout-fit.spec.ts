// GUI audit (2026-09-29) — chrome that must fit its container at 100% and
// 125% scaling and in a narrow window. jsdom has no layout, so the real
// promises live here:
//   - the plot dock never leaves a tool unreachable: each button is either
//     inside its stage or listed in the dock's "⋯" menu (P1);
//   - the default NE legend sits below the dock, not under it;
//   - the Graph Builder window stays inside the viewport with a usable preview;
//   - a Library worksheet name keeps real width at the default 210px panel;
//   - the Quick Figure Builder grid never overflows its container;
//   - round 4 (transient chrome): toasts, the hints card, the legend, the
//     tool readout, result chips and the HUD keep off the plot's axes and
//     inside their container; tooltips, tool windows and menus fit the window.
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

test("application menus and their flyouts stay compact and inside scaled viewports @core", async ({ page }) => {
  await gotoApp(page);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
    const root = page.getByRole("menu").first();
    await expect(root).toBeVisible();
    const rootBox = (await root.locator("xpath=..").boundingBox())!;
    expect(rootBox.x).toBeGreaterThanOrEqual(0);
    expect(rootBox.y).toBeGreaterThanOrEqual(0);
    expect(rootBox.x + rootBox.width).toBeLessThanOrEqual(size.width);
    expect(rootBox.y + rootBox.height).toBeLessThanOrEqual(size.height);
    expect(rootBox.height, "root menu should be grouped rather than a scrolling command wall").toBeLessThan(360);

    await root.getByRole("menuitem", { name: "XRD & reflectivity", exact: true }).hover();
    const flyout = page.getByRole("menu").last();
    await expect(flyout).toBeVisible();
    const flyoutBox = (await flyout.locator("xpath=..").boundingBox())!;
    expect(flyoutBox.x).toBeGreaterThanOrEqual(0);
    expect(flyoutBox.y).toBeGreaterThanOrEqual(0);
    expect(flyoutBox.x + flyoutBox.width).toBeLessThanOrEqual(size.width);
    expect(flyoutBox.y + flyoutBox.height).toBeLessThanOrEqual(size.height);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
});

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

const rectOf = (l: Locator) => l.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);

async function plotFile(page: Page, file: string): Promise<void> {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath(file));
  await waitForDatasetCount(page, 1);
  await page.locator("[data-ds-id]").first().click();
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
}

// Round-4 chrome audit: in a narrow window the auto legend grew left past the
// frame, over the y tick labels and title and off the stage; past eight
// series the outside column took 260px of a ~300px stage and covered the plot.
test("the auto legend stays inside the plot frame at every window size", async ({ page }) => {
  await plotFile(page, "long-labels.csv");
  const legend = page.locator(".qzk-stage > .qzk-legend.auto");
  for (const size of SIZES) {
    await page.setViewportSize(size);
    // The frame vars follow the resize on the next draw; wait for the legend to settle inside.
    await expect
      .poll(async () => {
        const [l, f] = await Promise.all([rectOf(legend), rectOf(page.locator(".qzk-stage .u-over"))]);
        return l.left >= f.left - 0.5 && l.right <= f.right + 0.5 && l.top >= f.top - 0.5 && l.bottom <= f.bottom + 0.5;
      }, { message: `legend leaves the frame at ${size.width}x${size.height}` })
      .toBe(true);
  }
});

test("an outside legend column never covers the plot frame", async ({ page }) => {
  await plotFile(page, "long-labels-many.csv");
  const legend = page.locator(".qzk-stage > .qzk-legend.out");
  await expect(legend).toBeVisible();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => {
        const [l, f] = await Promise.all([rectOf(legend), rectOf(page.locator(".qzk-stage .u-over"))]);
        return !overlaps(l, f);
      }, { message: `outside legend covers the frame at ${size.width}x${size.height}` })
      .toBe(true);
  }
});

// Round-4 chrome audit: the data-cursor readout sat at the STAGE's bottom right,
// the x-axis band; in a narrow window that is right on the x-axis title. It now
// takes a corner inside the frame.
test("the data-cursor readout stays inside the plot frame @core", async ({ page }) => {
  await plotFile(page, "linear-ramp.csv");
  await page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { setPlotTool: (t: string) => void } } } }).__qz.useApp
      .getState()
      .setPlotTool("cursor"),
  );
  const over = page.locator(".qzk-stage .u-over");
  const readout = page.locator(".qzk-stage > .qzk-readout");
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await over.hover({ position: { x: 20, y: 20 } });
    await over.hover(); // the centre lies on the ramp
    await expect(readout).toBeVisible();
    await expect
      .poll(async () => {
        const [r, f] = await Promise.all([rectOf(readout), rectOf(over)]);
        return r.left >= f.left - 0.5 && r.right <= f.right + 0.5 && r.top >= f.top - 0.5 && r.bottom <= f.bottom + 0.5;
      }, { message: `readout leaves the frame at ${size.width}x${size.height}` })
      .toBe(true);
  }
});

// Round-4 chrome audit: the ∫ / ∩ result chips sat at the STAGE's bottom
// centre, on the x-axis title, and (each chip being .qzk-glass, i.e.
// absolute) piled up on each other instead of stacking.
test("the ∫ and ∩ result chips stack inside the plot frame", async ({ page }) => {
  await plotFile(page, "two-peaks.csv");
  const over = page.locator(".qzk-stage .u-over");
  const f = await rectOf(over);
  for (const tool of ["integ", "fwhm"]) {
    await page.evaluate(
      (t) =>
        (window as unknown as { __qz: { useApp: { getState: () => { setPlotTool: (t: string) => void } } } }).__qz.useApp
          .getState()
          .setPlotTool(t),
      tool,
    );
    await page.mouse.move(f.left + f.width * 0.2, f.top + f.height / 2);
    await page.mouse.down();
    await page.mouse.move(f.left + f.width * 0.45, f.top + f.height / 2, { steps: 6 });
    await page.mouse.up();
  }
  const chips = page.locator(".qzk-result-chips > .qzk-result-chip");
  await expect(chips).toHaveCount(2);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => {
        const [a, b, fr] = await Promise.all([rectOf(chips.nth(0)), rectOf(chips.nth(1)), rectOf(over)]);
        const inFrame = (r: DOMRect) => r.left >= fr.left - 0.5 && r.right <= fr.right + 0.5 && r.bottom <= fr.bottom + 0.5;
        return inFrame(a) && inFrame(b) && !overlaps(a, b);
      }, { message: `result chips at ${size.width}x${size.height}` })
      .toBe(true);
  }
});

// Round-4 chrome audit: in a narrow stage the active-tool HUD ran past the
// stage edge and was cut off, "Esc cancels" included; now only its hint shrinks.
test("the active-tool HUD stays inside the stage", async ({ page }) => {
  await loadPlot(page);
  await page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { setPlotTool: (t: string) => void } } } }).__qz.useApp
      .getState()
      .setPlotTool("stats"),
  );
  const esc = page.locator(".qzk-stage > .qzk-tool-hud .esc");
  await expect(esc).toBeVisible();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const [e, s] = await Promise.all([rectOf(esc), rectOf(page.locator(".qzk-stage").first())]);
    expect(e.right, `HUD cut off at ${size.width}x${size.height}`).toBeLessThanOrEqual(s.right);
  }
});

// Round-4 chrome audit: a tooltip is centred on its control, so the tips of
// the Inspector's "?" buttons and the search pill ran off the right edge.
test("tooltips at the window's right edge stay inside it", async ({ page }) => {
  await loadPlot(page);
  for (const size of [SIZES[0], { width: 800, height: 600 }]) {
    await page.setViewportSize(size);
    for (const target of [page.locator("[data-tip='Open related help']").first(), page.locator(".qzk-menubar [data-tip]").last()]) {
      await target.hover();
      const tip = page.getByRole("tooltip");
      await expect(tip).toBeVisible();
      const t = await rectOf(tip);
      expect(t.left >= 0 && t.right <= size.width, `tip cut off at ${size.width}x${size.height}`).toBe(true);
      await page.mouse.move(1, size.height - 2);
      await expect(tip).toBeHidden();
    }
  }
});

// Round-4 chrome audit: reopened from Help over a plot, the 310px hints card
// stuck 30px out of the 296px Inspector column, over the x-axis ticks and title.
test("the interaction-hints card stays in the side column, clear of the plot", async ({ page }) => {
  await loadPlot(page);
  await page.evaluate(() => window.dispatchEvent(new Event("qz:show-interaction-hints")));
  const card = page.getByRole("complementary", { name: "Interaction hints" });
  await expect(card).toBeVisible();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const [c, s] = await Promise.all([rectOf(card), rectOf(page.locator(".qzk-stage").first())]);
    expect(overlaps(c, s), `hints card covers the plot stage at ${size.width}x${size.height}`).toBe(false);
  }
});

// Round-4 chrome audit: sweeping every palette command at 800x600, the only
// window that left the viewport was the 840px Multi-panel export panel.
test("a tool window wider than the window is capped to it", async ({ page }) => {
  await loadPlot(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await runPaletteCommand(page, "Multi-panel export…");
  const win = page.locator(".qzk-win").filter({ hasText: "Multi-panel export" });
  await expect(win).toBeVisible();
  const r = await rectOf(win);
  expect(r.left >= 0 && r.right <= 800, `window spans ${r.left}..${r.right}`).toBe(true);
});

// Round-4 chrome audit: the File, Plot and Analyze menus are 720-780px tall,
// so in a 700px-high window their last items sat below the window edge.
test("a menubar menu taller than the window scrolls instead of running off it", async ({ page }) => {
  await loadPlot(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  for (const name of ["File", "Plot", "Analyze"]) {
    await page.locator(".qzk-menubar .qzk-menu-wrap > :first-child", { hasText: name }).first().click();
    const pop = page.locator(".qzk-menu-wrap > .qzk-menu-pop");
    await expect(pop).toBeVisible();
    expect((await rectOf(pop)).bottom, `${name} menu bottom`).toBeLessThanOrEqual(700);
    const last = pop.locator(".qzk-menu-item").last();
    await last.scrollIntoViewIfNeeded();
    const r = await rectOf(last);
    expect(r.top >= 0 && r.bottom <= 700, `${name}'s last item unreachable`).toBe(true);
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden();
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
    await toast.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished))); // the slide-in
    const where = `${c.size.width}x${c.size.height}${c.lc ? " no library" : ""}${c.rc ? " no inspector" : ""}`;
    const [t, s, box] = await Promise.all([
      rectOf(toast),
      rectOf(page.locator(".qzk-stage").first()),
      rectOf(page.locator(".qzk-toaster")),
    ]);
    expect(overlaps(t, s), `toast covers the plot stage at ${where}`).toBe(false);
    // A collapsed panel gives its width to the stage (both at once, too).
    if (c.lc) expect(s.left, `library still open at ${where}`).toBeLessThanOrEqual(1);
    if (c.rc) expect(s.right, `inspector still open at ${where}`).toBeGreaterThanOrEqual(c.size.width - 1);
    // Inside the window AND the stack's own box (a full chip row clips at its edge).
    const inside = t.left >= Math.max(0, box.left - 0.5) && t.right <= Math.min(c.size.width, box.right + 0.5);
    expect(inside && t.top >= 0 && t.bottom <= c.size.height, `newest toast clipped at ${where}`).toBe(true);
  }
});

// Round-4 chrome audit: the plot's right-click menu is ~640px tall; in a
// 600px-high window its export and Help rows sat below the window edge.
test("the plot's right-click menu fits a 600px-high window", async ({ page }) => {
  await plotFile(page, "linear-ramp.csv");
  await page.setViewportSize({ width: 800, height: 600 });
  // The frame centre lies on the diagonal ramp, so this opens the (taller) series menu.
  await page.locator(".qzk-stage .u-over").click({ button: "right" });
  const menu = page.locator(".qzk-ctx").first();
  await expect(menu.getByRole("menuitem", { name: "Marker" })).toBeVisible();
  const [m, last] = await Promise.all([rectOf(menu), rectOf(menu.getByRole("menuitem").last())]);
  expect(m.top, "menu top").toBeGreaterThanOrEqual(0);
  expect(last.bottom, "last menu row below the window").toBeLessThanOrEqual(600);
});

// Round-4 follow-up: a NEW graph/panel window opened at its fixed default
// size (480x360; panels 760x560) whatever the stage size, so at 1000x700 part
// of it was clipped by the stage. New windows now fit the live stage.
type QzBounds = { __qz: { useApp: { getState: () => { plotCanvasBounds: { width: number } | null } } } };

for (const size of [{ width: 1000, height: 700 }, { width: 800, height: 600 }]) {
  test(`a new graph or panel window fits a ${size.width}x${size.height} stage`, async ({ page }) => {
    await loadPlot(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
    await waitForDatasetCount(page, 2);
    await page.setViewportSize(size);
    // The store's stage size follows a ResizeObserver (on the tab panel while the
    // sole window is maximized); create only once it has caught up.
    await expect
      .poll(() =>
        page.locator("#qz-stage-panel").evaluate((el) => {
          const b = (window as unknown as QzBounds).__qz.useApp.getState().plotCanvasBounds;
          return b?.width === Math.round(el.getBoundingClientRect().width);
        }),
      )
      .toBe(true);
    await runPaletteCommand(page, "New Graph Window");
    const rows = page.locator("[data-ds-id]");
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ["Control"] });
    await runPaletteCommand(page, "Panel: grid");
    const frames = page.locator(".qzk-plotwin");
    const panels = frames.filter({ has: page.locator(".qzk-plotwin-title", { hasText: /^Panel: / }) });
    await expect(panels).toHaveCount(1);
    await expect(frames).toHaveCount(3); // the main window, the new graph window, the panel
    const c = await rectOf(page.locator(".qzk-wincanvas-frames"));
    for (const f of await frames.all()) {
      const r = await rectOf(f);
      const at = `frame ${r.left}..${r.right} x ${r.top}..${r.bottom}, stage ${c.left}..${c.right} x ${c.top}..${c.bottom}`;
      expect(r.left >= c.left - 0.5 && r.right <= c.right + 0.5, at).toBe(true);
      expect(r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5, at).toBe(true);
    }
  });
}
