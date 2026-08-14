// Acceptance journey A2 ("Mouse editing: Change line/scatter mode, colors,
// widths, errors, scales, limits, legend, and labels through direct
// manipulation/properties") from FIGURE_AUTHORING_WORKFLOW_PLAN's "Required
// acceptance journeys" section. This is the AUTOMATED half — the owner's
// live desktop run still gates the checkbox, exactly like A1/A3/A4/A5.
//
// WHAT'S ALREADY COVERED, and why this spec does NOT re-click the same
// things (per the task brief: "go BEYOND them or reuse their journeys by
// reference, not re-test the same clicks"):
//   - `curve-restyle.spec.ts` already exercises series COLOR and MARKER
//     SHAPE through the canvas right-click context menu (direct
//     manipulation on `.u-over`). This spec still touches color and width —
//     the plan's checklist requires them — but through the OTHER surface
//     the plan names, "properties": the Inspector's Series style card
//     (`SeriesStyleCard.tsx`), a completely different component tree, not a
//     second click on the same swatch button.
//   - `axis-title-limits.spec.ts` already exercises the X axis label
//     (Titles & labels card) and explicit X min/max (Axes card). This spec
//     deliberately edits the Y counterparts of both — new fields, same
//     cards — plus Y-axis SCALE (log/linear), which neither existing spec
//     touches at all.
// What NEITHER existing spec covers, and what actually elevates this one:
// line/scatter MODE, error bars, a legend rename, and — the part that makes
// this more than a features tour — SAVE, CLOSE, and REOPEN, asserting every
// edit above SURVIVED the round trip. curve-restyle and axis-title-limits
// each check the store right after their own click; neither ever closes the
// window and reopens it.
//
// THE FIXTURE'S ERROR COLUMN (`mouse-edit-series.csv`: Time, Signal,
// "Signal Error"): investigated directly against the running app before
// writing this spec — a plain drag-drop import DOES infer a canonical
// `dataset.errorRoles` binding from the column name (`errorRoles.ts`'s
// `inferErrorBindings`/`classifyErrorLabel`, the same convention A1 reads
// about), but that binding does NOT by itself turn error bars on: the LIVE
// per-channel `errKeys` map that actually draws whiskers is seeded only
// from `defaultErrKeys` (`lib/errorbars.ts`), which is Origin-designation-
// only and stays `{}` for a plain CSV. So bars start OFF even though the
// binding metadata exists — confirmed directly (`errKeys: {}` after a plain
// drop) — which is exactly the real "off" starting state this journey needs
// before it can demonstrate turning them on, off, and on again through the
// Channels card's "±" picker (`ChannelsCard.tsx`).
//
// THE LINE/SCATTER SEQUENCE (Scatter -> Both, not Scatter -> Line): verified
// directly against `SeriesStyleCard.tsx`'s trace-mode preset before writing
// this spec — "Scatter" forces `width: 0`; leaving via "Line" additionally
// RESETS `width` to `undefined` (it only exists to represent "no line"), so
// a later explicit width edit must land in a mode the width-setter can't
// see coming and clobber. "Both" (Line + Symbol) only sets `marker: true`
// and, same as "Line", clears width ONLY while leaving scatter — so
// Scatter -> Both -> (explicit width) leaves a stable, non-default
// "line+symbol, custom width, custom colour" state to carry into save.
//
// HARNESS SEAM (justified exactly like `figure-document-roundtrip.spec.ts`'s
// A3/A4 spec): a fresh app always starts with exactly one plot window, and
// closing the LAST window is deliberately blocked (the ≥1-window
// invariant) — so before this journey can close the window it edited, a
// spare needs to exist. `figure-document-roundtrip.spec.ts` solves this by
// creating a second, dataset-bound window via the harness store
// (`createWindow`/`focusWindow`) and doing so BEFORE any of the interesting
// state exists — the same shape here. This is pure window-plumbing, not
// part of the journey under test: every edit below, and the save/close/
// reopen sequence itself, is driven through real menus/panels/clicks, never
// through `setState`.

import { expect, type Locator, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

/** A collapsed Inspector `<details class="qz-card">`, found by its EXACT
 *  heading text. Mirrors the fix `arbitrary-data-journey.spec.ts` had to
 *  land for this same lookup: `.filter({ hasText: "..." })` string matching
 *  is a case-insensitive SUBSTRING test over the whole card's rendered text
 *  (body copy included) — "Channels" alone false-matched "Channel
 *  statistics" AND "Error columns" (whose helper copy says "...pair one per
 *  series in Channels."). Scoping to `.qz-card-heading` specifically, and
 *  passing that locator UNPREFIXED to `.filter({ has })` (a prefixed one
 *  would require a second nested `.qzk-inspector` inside the card and match
 *  nothing — `.filter({ has })` resolves as a descendant search rooted at
 *  each candidate), reproduces reliably. */
function cardByHeading(page: Page, exactTitle: string): Locator {
  return page.locator(".qzk-inspector .qz-card").filter({
    has: page.locator(".qz-card-heading", { hasText: new RegExp(`^${exactTitle}$`) }),
  });
}

async function openCard(page: Page, exactTitle: string): Promise<Locator> {
  const card = cardByHeading(page, exactTitle);
  await card.locator(".qz-card-heading").click();
  await expect(card).toBeVisible();
  return card;
}

interface SavedDocument {
  id: string;
  name: string;
  bindings: { errors: { channel: number; target: number; axis: string; side: string }[] };
  plot: {
    view: {
      yScale: string;
      yLim: [number, number] | null;
      yAxisLabel: string;
      seriesLabels: Record<number, string>;
      seriesStyles: Record<number, { color?: string; width?: number; marker?: boolean }>;
    };
  };
}

test("line/scatter, color, width, errors, scale, limits, legend, and label edits all survive save, close, and reopen", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("mouse-edit-series.csv"));
  await waitForDatasetCount(page, 1);

  // ── Window plumbing (harness — see header) ──────────────────────────────
  await page.evaluate(() => {
    const app = (window as unknown as {
      __qz: { useApp: { getState: () => { createWindow: (id: string | null) => string; focusWindow: (id: string) => void; activeId: string | null } } };
    }).__qz.useApp;
    const id = app.getState().createWindow(app.getState().activeId);
    app.getState().focusWindow(id);
  });
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

  // ── Line/scatter mode, width, color — Inspector "Series style" card,
  //    the PROPERTIES surface (curve-restyle.spec.ts already covers the
  //    DIRECT-MANIPULATION context-menu route to the same store fields). ──
  await openCard(page, "Series style");
  const row0 = page.locator("#series-style-0"); // StyleRow's own id, channel 0 ("Signal")
  await row0.locator("summary").click();
  await expect(row0).toBeVisible();

  await row0.getByRole("tab", { name: "Scatter" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { seriesStyles: Record<number, { width?: number; marker?: boolean }> } } } }).__qz.useApp.getState().seriesStyles[0]))
    .toEqual({ width: 0, marker: true }); // line -> scatter really happened

  await row0.getByRole("tab", { name: "Both" }).click(); // scatter -> line+symbol (see header)
  const widthField = row0.locator('input[placeholder="1.5"]');
  await widthField.fill("4");
  await widthField.blur();
  await row0.getByTitle("Series 6", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { seriesStyles: Record<number, { width?: number; marker?: boolean; color?: string }> } } } }).__qz.useApp.getState().seriesStyles[0]))
    .toEqual({ width: 4, marker: true, color: "--series-6" });

  // ── Error bars on -> off -> on — Inspector "Channels" card's "±" picker.
  //    `.first()` is channel 0 ("Signal"): both channels render a ± select
  //    (identical title text, no per-row aria-label), in `data.labels`
  //    order, verified directly before writing this spec. ─────────────────
  await openCard(page, "Channels");
  const errSelect = page
    .locator(".qzk-inspector .qz-card")
    .filter({ has: page.locator(".qz-card-heading", { hasText: /^Channels$/ }) })
    .getByTitle("Channel holding this series' ± error (draws error bars)")
    .first();
  const readErrKeys = () =>
    page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { errKeys: Record<number, number> } } } }).__qz.useApp.getState().errKeys);

  await errSelect.selectOption({ label: "± Signal Error" });
  await expect.poll(readErrKeys).toEqual({ 0: 1 }); // ON
  await errSelect.selectOption({ label: "± none" });
  await expect.poll(readErrKeys).toEqual({}); // OFF
  await errSelect.selectOption({ label: "± Signal Error" });
  await expect.poll(readErrKeys).toEqual({ 0: 1 }); // ON again — the state carried into save

  // ── Y scale (log) and explicit Y limits — Inspector "Axes" card. X label
  //    + X limits are axis-title-limits.spec.ts's territory; these are the
  //    Y counterparts, untested there. `getByLabel("Y scale")` WITHOUT
  //    `exact` — verified directly: `<label>Y scale<select>…</select>
  //    </label>` implicit wrapping computes an accessible name that
  //    concatenates the select's OWN option text too ("Y scaleLinearLog"),
  //    so `exact: true` never matches; non-exact substring matching does,
  //    and "X scale"/"Y scale" don't collide with each other. ─────────────
  const axesCard = await openCard(page, "Axes");
  await axesCard.getByLabel("Y scale").selectOption("log");
  const yLimFields = axesCard.getByPlaceholder("auto");
  await yLimFields.nth(2).fill("0.5"); // Y min (X row renders first: 0=Xmin,1=Xmax,2=Ymin,3=Ymax)
  await yLimFields.nth(3).fill("5"); // Y max
  await yLimFields.nth(3).blur();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { yScale: string; yLim: [number, number] | null } } } }).__qz.useApp.getState().yScale))
    .toBe("log");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { yLim: [number, number] | null } } } }).__qz.useApp.getState().yLim))
    .toEqual([0.5, 5]);

  // ── Y axis label — Inspector "Titles & labels" card. X label is
  //    axis-title-limits.spec.ts's territory; this is the untested Y one. ──
  const titlesCard = await openCard(page, "Titles & labels");
  const yLabelField = titlesCard.getByPlaceholder("auto").nth(1); // X row first, Y row second
  await yLabelField.fill("Custom Signal Label");
  await yLabelField.blur();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { yAxisLabel: string } } } }).__qz.useApp.getState().yAxisLabel))
    .toBe("Custom Signal Label");

  // ── Legend rename — double-click the live Stage legend entry (real
  //    direct manipulation on the plot itself, not a properties panel). ───
  const legendRow0 = page.locator(".qzk-legend .it").first();
  await expect(legendRow0).toContainText("Signal (V)");
  await legendRow0.dblclick();
  const legendInput = page.locator(".qzk-legend input.qz-input");
  await expect(legendInput).toBeVisible();
  await legendInput.fill("Renamed Signal");
  await legendInput.press("Enter");
  await expect(legendRow0).toContainText("Renamed Signal");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { seriesLabels: Record<number, string> } } } }).__qz.useApp.getState().seriesLabels[0]))
    .toBe("Renamed Signal");

  // ── Save through the real File menu (same path A3/A4 use) ──────────────
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  await page.getByText("Save Editable Figure", { exact: true }).click();

  const saved = await page.evaluate(() =>
    JSON.stringify(
      (window as unknown as { __qz: { useApp: { getState: () => { editableFigures: unknown[] } } } })
        .__qz.useApp.getState().editableFigures[0],
    ),
  );
  const savedDocument = JSON.parse(saved) as SavedDocument;

  // Every A2 construct really is IN the saved document — same "prove it's
  // not an empty-object pass" discipline A3/A4/A5 use.
  expect(savedDocument.plot.view.seriesStyles[0]).toEqual({ width: 4, marker: true, color: "--series-6" });
  expect(savedDocument.bindings.errors).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  expect(savedDocument.plot.view.yScale).toBe("log");
  expect(savedDocument.plot.view.yLim).toEqual([0.5, 5]);
  expect(savedDocument.plot.view.yAxisLabel).toBe("Custom Signal Label");
  expect(savedDocument.plot.view.seriesLabels[0]).toBe("Renamed Signal");

  // ── Close the edited window through the real UI (title-bar context menu,
  //    the same path group-facet-journey.spec.ts and window-arrange.spec.ts
  //    use) — the harness-created spare window from setup keeps ≥1 window
  //    open, so this never trips the invariant. ──────────────────────────
  const editedWindowId = await page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { focusedWindowId: string | null } } } })
      .__qz.useApp.getState().focusedWindowId,
  );
  const focusedTitlebar = page.locator(".qzk-plotwin.focused .qzk-plotwin-titlebar");
  await expect(focusedTitlebar).toBeVisible();
  await focusedTitlebar.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close Window", exact: true }).click();
  await expect
    .poll(() => page.evaluate(
      (id) => (window as unknown as { __qz: { useApp: { getState: () => { plotWindows: { id: string }[] } } } })
        .__qz.useApp.getState().plotWindows.some((w) => w.id === id),
      editedWindowId,
    ))
    .toBe(false);

  // ── Reopen from the Library (real UI) ──────────────────────────────────
  const row = page.getByTitle(`open editable figure "${savedDocument.name}"`);
  await expect(row, "the saved figure has a Library row to reopen from").toBeVisible();
  await row.click();
  await expect
    .poll(() => page.evaluate(
      (id) => (window as unknown as { __qz: { useApp: { getState: () => { plotWindows: { document?: { id: string } }[] } } } })
        .__qz.useApp.getState().plotWindows.some((w) => w.document?.id === id),
      savedDocument.id,
    ))
    .toBe(true);

  // ── Every edit SURVIVED — read off the reopened window's LIVE view facade
  //    (not just the stored document blob: this proves the reactive app
  //    actually restored it), then re-confirm the two edits that are also
  //    visible on the real Stage canvas without opening any panel. ────────
  const reopenedView = await page.evaluate(() => {
    const s = (window as unknown as {
      __qz: {
        useApp: {
          getState: () => {
            seriesStyles: Record<number, { color?: string; width?: number; marker?: boolean }>;
            errKeys: Record<number, number>;
            yScale: string;
            yLim: [number, number] | null;
            yAxisLabel: string;
            seriesLabels: Record<number, string>;
          };
        };
      };
    }).__qz.useApp.getState();
    return {
      seriesStyles: s.seriesStyles,
      errKeys: s.errKeys,
      yScale: s.yScale,
      yLim: s.yLim,
      yAxisLabel: s.yAxisLabel,
      seriesLabels: s.seriesLabels,
    };
  });
  expect(reopenedView.seriesStyles[0], "line-mode + width + color survived reopen").toEqual({
    width: 4,
    marker: true,
    color: "--series-6",
  });
  expect(reopenedView.errKeys, "error-bar binding survived reopen").toEqual({ 0: 1 });
  expect(reopenedView.yScale, "log scale survived reopen").toBe("log");
  expect(reopenedView.yLim, "explicit Y limits survived reopen").toEqual([0.5, 5]);
  expect(reopenedView.yAxisLabel, "Y axis label survived reopen").toBe("Custom Signal Label");
  expect(reopenedView.seriesLabels[0], "legend rename survived reopen").toBe("Renamed Signal");

  // Real-canvas confirmation: the legend still reads the renamed text after
  // a full close/reopen cycle, not just in the store.
  await expect(page.locator(".qzk-legend .it").first()).toContainText("Renamed Signal");
});
