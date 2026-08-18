// Acceptance journey A5 ("Group/facet: Build with Group/Facet, edit on
// Stage, save/reopen, and export with the same series and labels") from
// FIGURE_AUTHORING_WORKFLOW_PLAN's "Required acceptance journeys" section.
// This is the AUTOMATED half — the owner's live desktop run still gates the
// checkbox, exactly like A3/A4 (figure-document-roundtrip.spec.ts).
//
// GROUPING ONLY — no facet assertion. That is a deliberate scope decision,
// confirmed by reading the source rather than assumed, not an oversight:
//
//   1. `FigureDocument.bindings.facetKey` (the canonical editable-figure-
//      document's facet field) has NO writer and NO render-request wire
//      anywhere in the app today — GroupingPanel.tsx's own doc comment and
//      useFigureBuilder.ts's `setGroupKey` doc both say so explicitly, and
//      FIGURE_AUTHORING_WORKFLOW_PLAN tracks it as BLOCKED (F2.3i).
//   2. The Graph Builder's "Facet" well IS wired to something real
//      (useGraphBuilder.ts's `commitToPlot` calls `facetByColumn`, a live
//      Stage small-multiples feature) — but that mechanism writes
//      `AppState.facetCol` (store/useApp.ts), a field that lives OUTSIDE
//      `PlotView` and therefore outside `FigureDocument` entirely (neither
//      type has a "facet" field at all). It has no wire into
//      `createFigureDocument`/`updateFigureDocumentFromPlotView`, so it
//      cannot survive save -> close -> reopen -> export — precisely the
//      journey A5 asks for. Exercising it here would decorate the spec with
//      a feature this journey structurally cannot verify.
//
// Group, by contrast, rides `FigureDocument.bindings.groupKey` end to end:
// Graph Builder's Group well -> `plotSpecToFigureDoc`'s `groupCol` ->
// `figureDocumentFromLegacyFigureDoc` -> `bindings.groupKey`, which survives
// every document rebuild (`createFigureDocument`, `updateFigureDocumentFrom
// PlotView`, `withPlotWindowDocument`) and drives the REAL backend series
// split (`calc.plotting.build_grouped_series`) at both preview-render and
// export time.
//
// A second architectural fact used to shape the "edit on Stage" step below:
// until PRIMARY_SOFTWARE_AUDIT_PLAN's P1.5 ("Live Graph Builder grouping
// parity"), the interactive uPlot Stage canvas had NO live rendering for a
// group split at all — `commitToPlot` toasted "series-split by group is
// preview-only in v1" the moment a grouped spec was committed to a plot
// window. P1.5 closed that gap: `store.groupKey` (a durable, focused-window
// facade field alongside `xKey`/`yKeys`, projected through
// `FigureDocument.bindings.groupKey` <-> `PlotView.groupKey` exactly like
// every other binding) now drives the SAME client-side split
// (`lib/plotGroupSplit.ts`'s `applyGroupSplit`, algorithm-identical to the
// backend's `build_grouped_series` and this file's own Publication Preview
// path) on the live Stage canvas too — see the SEPARATE "live Stage" test
// below for that coverage (drag-to-Group -> live canvas renders one series
// per level -> undo -> reopen -> export parity, GROUP_LEVELS.length legend
// rows throughout). This test keeps exercising the canonical Publication
// Preview surface specifically (property panels + preview click-to-select)
// -- both surfaces are real and both are covered, in two separate tests
// rather than overloading one.
//
// Verifying "one series per group with the expected labels" without OCR:
// `/api/export/figure-hitmap` returns per-element PIXEL boxes only (no
// label text), so this spec counts them (`[data-element^="series:"]`,
// rendered 1:1 from the hitmap's real `elements` array) for the
// series-COUNT half, and reads the exported SVG's raw bytes for the
// label-TEXT half: matplotlib's SVG writer embeds each text artist's
// original string as an XML comment (`<!-- Value (Run=1) -->`) immediately
// before its glyph paths, even under the default `svg.fonttype: path`
// (verified independently, both interactively and by querying this exact
// repo's `/api/export/figure` route directly, before this spec was
// written) — so a plain substring search on the downloaded bytes is real
// content verification, not OCR or pixel-diffing.

import { readFile } from "node:fs/promises";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface FigureRequestBody {
  y_keys?: number[];
  group_col?: number;
  title?: string;
}

interface SavedDocument {
  id: string;
  name: string;
  bindings: { groupKey: number | null; yKeys: number[] | null };
  plot: { view: { plotTitle: string; seriesStyles: Record<number, { color?: string }> } };
}

/** The fixture's three `Run` levels, ascending — `grouped-runs.csv` has 1/2/3. */
const GROUP_LEVELS = ["1", "2", "3"] as const;
/** Exact legend text `calc.plotting.build_grouped_series` builds per level:
 *  `${yLabel} (${groupLabel}=${level})`. The fixture's `Value`/`Run` columns
 *  carry no parenthesised unit, so `_figure_series` adds no trailing
 *  `(unit)` wrap (see the module header) — verified directly against the
 *  real backend route before this spec was written. */
const EXPECTED_SERIES_LABELS = GROUP_LEVELS.map((level) => `Value (Run=${level})`);

function figureHitmapRequest(page: Page) {
  return page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/export/figure-hitmap",
  );
}

async function openGraphBuilder(page: Page): Promise<Locator> {
  await runPaletteCommand(page, "Graph Builder");
  const builder = page.locator(".qzk-win").filter({ has: page.getByText("Graph Builder", { exact: true }) });
  await expect(builder).toBeVisible();
  return builder;
}

function publicationPreviewWindow(page: Page): Locator {
  return page.locator(".qzk-win").filter({ has: page.getByText(/^Publication preview —/) });
}

async function readEditableFigures(page: Page): Promise<SavedDocument[]> {
  const json = await page.evaluate(() =>
    JSON.stringify(
      (window as unknown as { __qz: { useApp: { getState: () => { editableFigures: unknown[] } } } })
        .__qz.useApp.getState().editableFigures,
    ),
  );
  return JSON.parse(json) as SavedDocument[];
}

async function focusedWindowId(page: Page): Promise<string> {
  const id = await page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { focusedWindowId: string | null } } } })
      .__qz.useApp.getState().focusedWindowId,
  );
  expect(id).toBeTruthy();
  return id as string;
}

async function windowDocumentFor(page: Page, documentId: string): Promise<SavedDocument | undefined> {
  const json = await page.evaluate((id) => {
    const state = (window as unknown as {
      __qz: { useApp: { getState: () => { plotWindows: { document?: unknown }[] } } };
    }).__qz.useApp.getState();
    const win = state.plotWindows.find((w) => (w.document as { id?: string } | undefined)?.id === id);
    return win ? JSON.stringify(win.document) : null;
  }, documentId);
  return json ? (JSON.parse(json) as SavedDocument) : undefined;
}

test("Group well builds one series per level, survives Stage edit + save/reopen, and exports the same series and labels", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("grouped-runs.csv"));
  await waitForDatasetCount(page, 1);

  // ── Build via the Graph Builder's Group well (real UI) ──────────────────
  const graphBuilder = await openGraphBuilder(page);
  // exact: true — "Assign a channel to Y error" is a substring superset of
  // "Assign a channel to Y" (same guard export-roundtrip.spec.ts documents).
  await graphBuilder.getByLabel("Assign a channel to Y", { exact: true }).selectOption({ label: "Value" });
  await graphBuilder.getByLabel("Assign a channel to Group", { exact: true }).selectOption({ label: "Run" });
  const groupChip = page
    .locator(".qzk-zone-well")
    .filter({ has: page.getByText("Group", { exact: true }) })
    .locator(".qzk-zone-chip");
  await expect(groupChip).toContainText("Run");

  // ── Open Publication Preview (real UI) — the request itself proves Group
  //    actually reached the render, group_col and all. ────────────────────
  const initialHitmap = figureHitmapRequest(page);
  await graphBuilder.getByRole("button", { name: "Publication Preview" }).click();
  const initialBody = (await initialHitmap).postDataJSON() as FigureRequestBody;
  expect(initialBody.y_keys).toEqual([0]);
  expect(initialBody.group_col).toBe(1);

  const preview = publicationPreviewWindow(page);
  await expect(preview).toBeVisible();

  // Graph Builder has done its job (Publication Preview opened from it).
  // Close it through the store's own toggle rather than clicking its
  // title-bar × — every floating ToolWindow in this app opens at the SAME
  // default screen position, so Publication Preview now sits directly on
  // top of Graph Builder's close button (reproduced: a real click there
  // times out on "element intercepts pointer events"). This is exactly the
  // "harness seam where the UI path is flaky" case CLAUDE.md calls out —
  // Graph Builder's own visibility isn't a thing this journey is testing.
  await page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { setGraphBuilderOpen: (open: boolean) => void } } } })
      .__qz.useApp.getState().setGraphBuilderOpen(false),
  );
  await expect(graphBuilder).toBeHidden();

  // ── "one series per group" — the hitmap's OWN element list (rendered 1:1
  //    as `[data-element]` boxes), not an assumption about the image. ─────
  const seriesHitboxes = preview.locator('[data-element^="series:"]');
  await expect(seriesHitboxes).toHaveCount(GROUP_LEVELS.length);

  // ── Edit on Stage (real UI): rename the plot title, then recolor the
  //    series via the property panel a click on the preview reveals (F2.3b —
  //    selecting a "series:N" hitbox force-opens the Series group). ───────
  await preview.getByPlaceholder("(none)").first().fill("Grouped rich figure");
  await preview.locator('[data-element="series:0"]').click();
  const recolorPreview = figureHitmapRequest(page);
  await preview.getByRole("button", { name: "series 1 color preset 5" }).click();
  const editedBody = (await recolorPreview).postDataJSON() as FigureRequestBody;
  expect(editedBody.title).toBe("Grouped rich figure");
  expect(editedBody.group_col).toBe(1); // the edit did not disturb the group binding

  // ── Save via "Create Editable Figure" (real UI) — the `new-editable`
  //    session's equivalent of A3/A4's "Save Editable Figure". ────────────
  await preview.getByRole("button", { name: "Create Editable Figure" }).click();
  await expect.poll(async () => (await readEditableFigures(page)).length).toBe(1);

  const saved = (await readEditableFigures(page))[0];
  // The A5 constructs really are IN the saved document — same "prove it's
  // not an empty-object pass" discipline A3/A4 uses.
  expect(saved.bindings.groupKey, "group binding reached the saved document").toBe(1);
  expect(saved.bindings.yKeys).toEqual([0]);
  expect(saved.plot.view.plotTitle).toBe("Grouped rich figure");
  expect(saved.plot.view.seriesStyles[0]?.color, "the Stage recolor reached the saved document").toBe("--series-5");

  // ── Reopen from the Library (real UI) ────────────────────────────────────
  const row = page.getByTitle(`open editable figure "${saved.name}"`);
  await expect(row, "the saved figure has a Library row to reopen from").toBeVisible();
  await row.dblclick(); // L0.25 (PR #139): single click selects; double-click opens
  await expect
    .poll(() => page.evaluate(
      (id) => (window as unknown as { __qz: { useApp: { getState: () => { plotWindows: { document?: { id: string } }[] } } } })
        .__qz.useApp.getState().plotWindows.some((w) => w.document?.id === id),
      saved.id,
    ))
    .toBe(true);

  // ── The reopened window's document equals the saved one — same group
  //    binding, same channels, same title, same recolor. ──────────────────
  const reopened = await windowDocumentFor(page, saved.id);
  expect(reopened).toEqual(saved);

  // ── Close the reopened window through the real UI (title-bar context
  //    menu's "Close Window" — the same path window-arrange.spec.ts uses).
  //    No spare window needed: the app's original default window is still
  //    open, so this never trips the ≥1-window invariant. ─────────────────
  const reopenedWindowId = await focusedWindowId(page);
  const focusedTitlebar = page.locator(".qzk-plotwin.focused .qzk-plotwin-titlebar");
  await expect(focusedTitlebar).toBeVisible();
  await focusedTitlebar.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close Window", exact: true }).click();
  await expect
    .poll(() => page.evaluate(
      (id) => (window as unknown as { __qz: { useApp: { getState: () => { plotWindows: { id: string }[] } } } })
        .__qz.useApp.getState().plotWindows.some((w) => w.id === id),
      reopenedWindowId,
    ))
    .toBe(false);

  // ── Reopen a second time, and re-derive Publication Preview from the
  //    reopened WINDOW (target: "window", not "new-editable" this time —
  //    the same palette-command path export-roundtrip.spec.ts exercises). ──
  await row.dblclick(); // L0.25 (PR #139): single click selects; double-click opens
  await expect
    .poll(() => page.evaluate(
      (id) => (window as unknown as { __qz: { useApp: { getState: () => { plotWindows: { document?: { id: string } }[] } } } })
        .__qz.useApp.getState().plotWindows.some((w) => w.document?.id === id),
      saved.id,
    ))
    .toBe(true);
  const reopenedHitmap = figureHitmapRequest(page);
  await runPaletteCommand(page, "Publication preview");
  const reopenedBody = (await reopenedHitmap).postDataJSON() as FigureRequestBody;
  // Same series set + same group binding survived close -> reopen -> a FRESH
  // Publication Preview session, not just the raw stored document.
  expect(reopenedBody.y_keys).toEqual(initialBody.y_keys);
  expect(reopenedBody.group_col).toBe(initialBody.group_col);
  expect(reopenedBody.title).toBe("Grouped rich figure");

  const reopenedPreview = publicationPreviewWindow(page);
  await expect(reopenedPreview).toBeVisible();
  await expect(reopenedPreview.locator('[data-element^="series:"]')).toHaveCount(GROUP_LEVELS.length);

  // ── Export (real UI, real backend, real download) — the same series set
  //    and the same per-group labels appear in the exported artifact. ─────
  await reopenedPreview.locator("select").first().selectOption("svg");
  const exportResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/export/figure",
  );
  const download = page.waitForEvent("download");
  await reopenedPreview.getByRole("button", { name: "Export SVG" }).click();
  const [response, file] = await Promise.all([exportResponse, download]);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  const exportBody = response.request().postDataJSON() as FigureRequestBody;
  expect(exportBody.y_keys).toEqual([0]);
  expect(exportBody.group_col).toBe(1);

  const path = await file.path();
  expect(path).not.toBeNull();
  const svg = (await readFile(path!)).toString("utf8");
  expect(svg.slice(0, 200)).toContain("<svg");
  for (const label of EXPECTED_SERIES_LABELS) {
    expect(svg, `exported SVG carries the "${label}" series label`).toContain(label);
  }
});

// P1.5 (PRIMARY_SOFTWARE_AUDIT_PLAN): "Durable live grouped series" — the
// SAME Group well now also drives the INTERACTIVE Stage canvas, not just
// Publication Preview. drag-to-Group -> live legend shows one row per level
// -> undo/redo -> close/reopen (via undo-of-close, the same real-UI pattern
// window-arrange journeys use) -> export parity, all through the real uPlot
// canvas + store, no mocks.
async function legendSeriesLabels(page: Page): Promise<string[]> {
  return page.locator(".qzk-legend .it").filter({ hasText: /\(Run=/ }).allTextContents();
}

function storeGroupKey(page: Page): Promise<number | null> {
  return page.evaluate(
    () => (window as unknown as { __qz: { useApp: { getState: () => { groupKey: number | null } } } })
      .__qz.useApp.getState().groupKey,
  );
}

test("Group well renders live on the interactive Stage, undoes, survives a window close/reopen, and exports the same group binding", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("grouped-runs.csv"));
  await waitForDatasetCount(page, 1);

  // ── Drag-to-Group via the Graph Builder's real UI, then commit to a NEW
  //    interactive plot window (not Publication Preview this time). ────────
  const graphBuilder = await openGraphBuilder(page);
  await graphBuilder.getByLabel("Assign a channel to Y", { exact: true }).selectOption({ label: "Value" });
  await graphBuilder.getByLabel("Assign a channel to Group", { exact: true }).selectOption({ label: "Run" });
  await graphBuilder.getByRole("button", { name: "Create New Plot" }).click();

  // ── Live canvas renders one legend row per group level (P1.5 item 1) ────
  await expect.poll(() => legendSeriesLabels(page)).toHaveLength(GROUP_LEVELS.length);
  expect(await legendSeriesLabels(page)).toEqual(expect.arrayContaining(EXPECTED_SERIES_LABELS));
  expect(await storeGroupKey(page)).toBe(1);

  // ── Edit: undo the group commit -> the live canvas collapses back to ONE
  //    ordinary series (the grouping binding is a first-class undoable edit,
  //    same as X/Y channel selection always was). ─────────────────────────
  await page.locator(".qzk-stage").click({ position: { x: 4, y: 4 } }); // move focus off any input
  await page.keyboard.press("Control+z");
  await expect.poll(() => storeGroupKey(page)).toBeNull();
  await expect.poll(() => legendSeriesLabels(page)).toHaveLength(0);

  // ── Redo restores the split. ─────────────────────────────────────────────
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => storeGroupKey(page)).toBe(1);
  await expect.poll(() => legendSeriesLabels(page)).toHaveLength(GROUP_LEVELS.length);

  // ── Close/reopen: close the grouped window via the real title-bar context
  //    menu (window-arrange.spec.ts's own path), then undo the close — a
  //    genuine close-then-restore round trip, not a fabricated one (the
  //    original default window stays open throughout, so the ≥1-window
  //    invariant is never at risk). The restored window's groupKey and live
  //    legend must read back exactly as they did before closing. ──────────
  const focusedTitlebar = page.locator(".qzk-plotwin.focused .qzk-plotwin-titlebar");
  await expect(focusedTitlebar).toBeVisible();
  await focusedTitlebar.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close Window", exact: true }).click();
  await expect.poll(() => storeGroupKey(page)).toBeNull(); // the OTHER (default) window is now focused, ungrouped
  await page.keyboard.press("Control+z"); // undo the close
  await expect.poll(() => storeGroupKey(page)).toBe(1);
  await expect.poll(() => legendSeriesLabels(page)).toEqual(expect.arrayContaining(EXPECTED_SERIES_LABELS));

  // ── Export parity: the reopened window's OWN canonical document carries
  //    the SAME group binding into a real export request. ─────────────────
  const exportDialog = page.locator(".qz-dialog").filter({ has: page.getByRole("heading", { name: "Export figure" }) });
  const exportResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/export/figure",
  );
  await graphBuilder.getByRole("button", { name: "Export" }).click();
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole("button", { name: "Run" }).click();
  const response = await exportResponse;
  expect(response.ok()).toBe(true);
  const body = response.request().postDataJSON() as { group_col?: number; y_keys?: number[] };
  expect(body.y_keys).toEqual([0]);
  expect(body.group_col, "the reopened window's export carries the same group binding").toBe(1);
});
