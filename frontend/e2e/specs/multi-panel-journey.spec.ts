// Acceptance journey A6 ("Multi-panel: Build a 2×2 page, link then unlink
// axes, rearrange, save/reopen, edit one panel, and preserve layout") from
// FIGURE_AUTHORING_WORKFLOW_PLAN's "Required acceptance journeys" section.
// This is the AUTOMATED half — the owner's live desktop run still gates the
// checkbox, exactly like A3/A4/A5 (figure-document-roundtrip.spec.ts,
// group-facet-journey.spec.ts).
//
// SCOPE — which "multi-panel" feature this journey is actually about, read
// from source rather than assumed: this repo has TWO unrelated multi-panel
// mechanisms, and A6 (F3 "Make multi-panel figures durable") names only one
// of them:
//
//   1. `store/panels.ts`'s `createPanelWindow` (the Library's "Panel: side by
//      side/stacked/grid" and "Overlay in one plot" multi-select quick picks,
//      MAIN_PLAN #19) opens ONE `kind:"panel"` WINDOW that composites several
//      datasets' own sub-plots inside it. It has no PageDocument, no Save/
//      reopen of its own, and no `/api/export/figure-page` wire — it is a
//      session-only window layout, not the durable artifact F3/A6 describe.
//   2. `lib/pageDocument.ts`'s `PageDocument` (the "Figure Page" workshop,
//      `components/workshops/figurepage/`, palette command "Multi-panel
//      export…") is the one F3.1-F3.6 actually built: a versioned, saved,
//      reopenable multi-panel PAGE whose slots reference canonical
//      `editableFigures` BY ID, with its own row/col grid, F3.5 layout
//      controls (link X/Y, gaps, resize mode), and a real
//      `/api/export/figure-page` export. `lib/pageDocument.ts`'s own doc
//      names `linkX`/`linkY` "the acceptance journey's (A6) sufficient
//      core" — this journey exercises exactly that.
//
// This spec drives mechanism 2 throughout. Panels are built as four
// separately SAVED editable figures (two per imported dataset) assigned into
// a 2×2 grid via the composer's real "click a slot, click a source" flow
// (SourceList's own title reads "Drag onto a slot, or click to assign") —
// not native HTML5 drag, which this composer also supports but click-assign
// exercises the identical store action (`assignToNext`) with far less flake
// surface for a journey already this long.
//
// "Link then unlink axes" — read from source, not assumed: FigurePageView
// renders a single static, server-rendered `<img>` preview
// (usePagePreviewExport.ts's debounced PNG blob); SlotGrid has no live
// pan/zoom canvas per panel to gesture on, and `PageLayoutSettings.linkX`/
// `linkY` are RENDER-TIME flags the backend's matplotlib composer consumes
// at export/preview time (`calc.figure_page_layout`), not a live sync
// mechanism between two interactive views. So "a zoom on one panel
// propagates" cannot be driven in the current UI — see the `test.fixme`
// below, which names exactly this. What IS real and driven here: checking/
// unchecking Link X and Link Y and observing the flag flip in the real
// export request the composer's own Export button sends — the load-bearing
// half of "link/unlink" this UI can actually make a claim about.
//
// "Rearrange" uses F3.5's Shift+Arrow keyboard swap (`SlotGrid`'s own
// keyboard convention, `gridNeighborIndex`) rather than the mouse drag-swap
// it also supports — both call the identical `onMoveSlot`, and keyboard is
// the more deterministic driver for an already-long journey.
//
// "Save/reopen" is checked at TWO levels, matching A3/A5's discipline: the
// PAGE itself (F3.3's Save, `store.pages`) AND the whole PROJECT (.dwk) round
// trip through the real File menu (quick-figure-lifecycle.spec.ts's own
// precedent for driving "Save workspace (.dwk)…" / "Open workspace (.dwk)…"
// headlessly via Playwright's `download`/`filechooser` events) — a page that
// only survived the in-memory store, not the actual file format, would be a
// false pass.

import { expect, type Locator, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface FigurePanelSpecLike {
  figure: { title?: string };
  row: number;
  col: number;
  label?: string;
  title?: string;
}

interface FigurePageRequestBody {
  panels: FigurePanelSpecLike[];
  link_x?: boolean;
  link_y?: boolean;
}

interface SavedFigureRef {
  id: string;
  name: string;
}

interface PagePanelLike {
  figureId: string | null;
  label: string | null;
  title: string | null;
}

interface SavedPageLike {
  id: string;
  name: string;
  modifiedAt: string;
  panels: PagePanelLike[];
}

interface QzWindow {
  __qz: {
    useApp: {
      getState: () => {
        editableFigures: { id: string; name: string }[];
        pages: SavedPageLike[];
      };
      setState: (patch: Record<string, unknown>) => void;
    };
  };
}

function editableFiguresState(page: Page): Promise<{ id: string; name: string }[]> {
  return page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().editableFigures);
}

function pagesState(page: Page): Promise<SavedPageLike[]> {
  return page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().pages);
}

/** Seed the FOCUSED window's plot title (a distinguishing fingerprint each
 *  panel carries all the way into `figure.title` of an exported request —
 *  see `buildFigureSpecFromDocument`'s `title: overrides.title ?? view.
 *  plotTitle`), then save it as an editable figure through the real File
 *  menu (figure-document-roundtrip.spec.ts's own "Save Editable Figure"
 *  path) and return the newly saved figure's id/name. */
async function saveFocusedWindowAsFigure(page: Page, plotTitle: string): Promise<SavedFigureRef> {
  await page.evaluate(
    (title) => (window as unknown as QzWindow).__qz.useApp.setState({ plotTitle: title }),
    plotTitle,
  );
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  await page.getByText("Save Editable Figure", { exact: true }).click();
  const figs = await editableFiguresState(page);
  const last = figs.at(-1);
  expect(last, `"Save Editable Figure" stored a document for "${plotTitle}"`).toBeTruthy();
  return last!;
}

function figurePageWindow(page: Page): Locator {
  return page.locator(".qzk-win").filter({ has: page.getByText(/^Multi-panel export/) });
}

function slot(win: Locator, i: number): Locator {
  return win.locator(`[data-slot-index="${i}"]`);
}

/** The k-th item under the composer's "Editable figures" SourceList
 *  specifically — scoped via the XPath `following-sibling` axis from that
 *  section's own heading so the "Plot windows" list (which precedes it in
 *  DOM order and stays populated throughout this journey, since none of the
 *  four windows are ever closed) can never be miscounted into the index.
 *  `figureSources`' filter preserves `editableFigures`' own insertion order
 *  (useFigurePage.ts), so index k here is always the k-th figure SAVED. */
function editableFigureSource(win: Locator, index: number): Locator {
  return win
    .locator("label.qzk-field-lbl", { hasText: "Editable figures" })
    .locator('xpath=following-sibling::div[@title="Drag onto a slot, or click to assign"]')
    .nth(index);
}

/** Click-select slot `slotIndex`, then click-assign the source-list figure
 *  at `sourceIndex` into it — the composer's real "click a slot, click a
 *  source" flow (`useFigurePage.ts`'s `assign`/`assignToNext`). */
async function assignPanel(win: Locator, slotIndex: number, sourceIndex: number): Promise<void> {
  await slot(win, slotIndex).click();
  await editableFigureSource(win, sourceIndex).click();
}

// The composer's debounced live preview (usePagePreviewExport.ts's
// `renderFigurePageBlob`, re-fired on every slots/layout/output change,
// 400ms after the last one) POSTs to this EXACT SAME URL as the real Export
// button (`exportFigurePage`) — lib/api/figurePage.ts's own header names
// both as sharing "/api/export/figure-page", and the backend route
// (routes/export_page.py's `export_figure_page`) sets an identical
// `Content-Disposition: attachment` on every response regardless of which
// caller's intent produced it, so there is no method/URL/header signal that
// tells a real Export click's response apart from a stray in-flight preview
// render's. The two are distinguishable only by REQUEST BODY: the preview
// (and the Copy button's clipboard render) always force `fmt: "png"`
// (usePagePreviewExport.ts's PREVIEW_DPI/COPY_PAGE_DPI paths), while a real
// Export click sends the page's own chosen format — "pdf" by default, and
// never changed to "png" anywhere in this journey. Without this filter, a
// still-in-flight preview response (queued by an EARLIER edit's debounce,
// e.g. the "Edit ONE panel" step below) can arrive inside a LATER
// exportPageNow() call's `waitForResponse` window and get mistaken for that
// call's own response — forced deterministically in a probe (scratchpad
// a6_flake/probe.spec.ts, held-route reproduction, 3/5 runs corrupted
// `finalBody` this way before this filter existed). Filtering on the
// request body — the actual state this assertion cares about — rather than
// adding a settle-time wait closes the race at its source instead of just
// narrowing the window.
function figurePageExportResponse(page: Page) {
  return page.waitForResponse((response) => {
    if (response.request().method() !== "POST") return false;
    if (new URL(response.url()).pathname !== "/api/export/figure-page") return false;
    const body = response.request().postDataJSON() as { fmt?: string };
    return body.fmt !== "png";
  });
}

/** Click the composer's Export button and return the real export request's
 *  JSON body — a genuine backend round trip (real download event included),
 *  the same pattern group-facet-journey.spec.ts's SVG export step uses. */
async function exportPageNow(page: Page, win: Locator): Promise<FigurePageRequestBody> {
  const exportResponse = figurePageExportResponse(page);
  const download = page.waitForEvent("download");
  await win.getByRole("button", { name: /^Export/ }).click();
  const [response] = await Promise.all([exportResponse, download]);
  expect(response.ok()).toBe(true);
  return response.request().postDataJSON() as FigurePageRequestBody;
}

test("build a 2×2 page from four saved figures, link then unlink axes, rearrange panels, save/reopen the page, edit one panel, and export it", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await gotoApp(page);

  // ── Two fixture datasets, four SAVED editable figures (two per dataset) ──
  // (see saveFocusedWindowAsFigure's own doc for why each gets a distinct
  // plotTitle fingerprint). Window handling deliberately never touches a
  // Library row after the first import — a Library click / a fresh import
  // both rebind whichever window is CURRENTLY FOCUSED (store/useApp.ts's
  // `setActive`/`addDataset`), so switching dataset B in only AFTER both
  // "A" windows already exist (and are no longer focused-to-be-stolen) is
  // what keeps two clean windows on each dataset instead of one flipping.
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);
  const figA1 = await saveFocusedWindowAsFigure(page, "Panel A1"); // the default window, bound to dataset A

  await runPaletteCommand(page, "New Graph Window"); // window #2, bound to the still-active dataset A
  const figA2 = await saveFocusedWindowAsFigure(page, "Panel A2");

  await runPaletteCommand(page, "New Graph Window"); // window #3, bound to A for now — about to become B
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 2); // rebinds the FOCUSED window (#3) to dataset B
  const figB1 = await saveFocusedWindowAsFigure(page, "Panel B1");

  await runPaletteCommand(page, "New Graph Window"); // window #4, bound to the now-active dataset B
  const figB2 = await saveFocusedWindowAsFigure(page, "Panel B2");

  expect(new Set([figA1.id, figA2.id, figB1.id, figB2.id]).size, "four distinct saved figures").toBe(4);

  // ── Open the composer, build the 2×2 grid via the real click-assign flow ─
  await runPaletteCommand(page, "Multi-panel export");
  const win = figurePageWindow(page);
  await expect(win).toBeVisible();

  await assignPanel(win, 0, 0); // slot 0 <- figA1 (source-list position 0, insertion order)
  await assignPanel(win, 1, 1); // slot 1 <- figA2
  await assignPanel(win, 2, 2); // slot 2 <- figB1
  await assignPanel(win, 3, 3); // slot 3 <- figB2

  await expect(slot(win, 0)).toContainText(figA1.name);
  await expect(slot(win, 1)).toContainText(figA2.name);
  await expect(slot(win, 2)).toContainText(figB1.name);
  await expect(slot(win, 3)).toContainText(figB2.name);

  // ── Link X/Y: check the boxes, then a REAL export request carries the
  //    flag through — the propagation this UI can actually demonstrate (see
  //    the module header + the fixme test below for the live-zoom claim it
  //    cannot). Also captures the PRE-rearrange panel order as a baseline. ──
  const linkXBox = win.locator("label.qz-check", { hasText: "Link X" }).locator('input[type="checkbox"]');
  const linkYBox = win.locator("label.qz-check", { hasText: "Link Y" }).locator('input[type="checkbox"]');
  await linkXBox.check();
  await linkYBox.check();

  const linkOnBody = await exportPageNow(page, win);
  expect(linkOnBody.link_x, "Link X reached the export request").toBe(true);
  expect(linkOnBody.link_y, "Link Y reached the export request").toBe(true);
  expect(linkOnBody.panels).toHaveLength(4);
  expect(linkOnBody.panels.map((p) => [p.row, p.col])).toEqual([
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]);
  expect(linkOnBody.panels.map((p) => p.figure.title)).toEqual([
    "Panel A1",
    "Panel A2",
    "Panel B1",
    "Panel B2",
  ]);

  // ── Unlink: uncheck both — the very next export no longer carries them ──
  await linkXBox.uncheck();
  await linkYBox.uncheck();

  const linkOffBody = await exportPageNow(page, win);
  expect(linkOffBody.link_x, "Link X no longer propagates once unchecked").toBe(false);
  expect(linkOffBody.link_y, "Link Y no longer propagates once unchecked").toBe(false);

  // ── Rearrange (F3.5 "manual rearrangement"): Shift+Arrow swaps the
  //    FOCUSED panel with its grid neighbor. Swap (0,1) and (2,3) — a fully
  //    reshuffled page, [A2, A1, B2, B1], proving BOTH swaps really landed. ─
  await slot(win, 0).click();
  await page.keyboard.press("Shift+ArrowRight");
  await slot(win, 2).click();
  await page.keyboard.press("Shift+ArrowRight");

  await expect(slot(win, 0)).toContainText(figA2.name);
  await expect(slot(win, 1)).toContainText(figA1.name);
  await expect(slot(win, 2)).toContainText(figB2.name);
  await expect(slot(win, 3)).toContainText(figB1.name);

  // ── Save the page (F3.3) ────────────────────────────────────────────────
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => pagesState(page).then((p) => p.length)).toBe(1);
  const savedPage = (await pagesState(page))[0];
  expect(savedPage.panels.map((p) => p.figureId), "the SAVED page carries the rearranged order").toEqual([
    figA2.id,
    figA1.id,
    figB2.id,
    figB1.id,
  ]);

  // ── Close the composer through the store's own toggle (F3.3's page is
  //    already saved above, so nothing is discarded) — every floating
  //    ToolWindow in this app opens at the SAME default screen position, and
  //    a real click on this one's own × would otherwise sit on top of the
  //    workspace-replace confirm dialog below (reproduced: "element
  //    intercepts pointer events" on the Replace button). group-facet-
  //    journey.spec.ts's Graph Builder step hits the identical collision and
  //    uses the same fix. ───────────────────────────────────────────────────
  await page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { setFigurePageOpen: (open: boolean) => void } } } })
      .__qz.useApp.getState().setFigurePageOpen(false),
  );
  await expect(win).toBeHidden();

  // ── Save/reopen the WHOLE PROJECT (.dwk) through the real File menu —
  //    quick-figure-lifecycle.spec.ts's own precedent for driving the real
  //    download/filechooser events headlessly, extended to the page library
  //    (F3.1's `pages` field — lib/workspace.ts/workspaceSerialize.ts). ─────
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByText("Save workspace (.dwk)…", { exact: true }).click(),
  ]);
  const savedPath = await download.path();
  expect(savedPath, "the .dwk download completed").toBeTruthy();

  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByText("Open workspace (.dwk)…", { exact: true }).click(),
  ]);
  await fileChooser.setFiles(savedPath!);
  await page.getByRole("button", { name: "Replace", exact: true }).click(); // replacing non-empty content confirms first

  await waitForDatasetCount(page, 2);
  await expect.poll(() => pagesState(page).then((p) => p.length)).toBe(1);

  // ── The layout survived byte-for-byte: four panels, same order ──────────
  const reloadedPage = (await pagesState(page))[0];
  expect(reloadedPage.id).toBe(savedPage.id);
  expect(
    reloadedPage.panels.map((p) => p.figureId),
    "panel order survived the real .dwk file round trip",
  ).toEqual(savedPage.panels.map((p) => p.figureId));

  // ── Reopen the PAGE itself from the Library (real UI). Read from source
  //    before writing this (traced live — a plain single click reliably left
  //    `figurePageOpen` false with NO store call at all, even invoking the
  //    row's own React `onClick` prop directly): the default Tree view
  //    renders every artifact kind (editable figure, publication figure,
  //    PAGE, report) through `ArtifactRows.tsx`'s shared `ArtifactRow` —
  //    NOT `PagesSection.tsx`'s flat, single-click-opens section (that one
  //    is search-mode-only) — and `ArtifactRow`'s own L0.25 convention is
  //    single-click SELECTS (`setLibrarySelection`), double-click (or Enter)
  //    OPENS (`openLibraryNode`), the identical convention every other
  //    artifact-kind journey in this suite already drives (figure-document-
  //    roundtrip.spec.ts / group-facet-journey.spec.ts's `.dblclick()` on
  //    "open editable figure ..." rows) — this row's title text is
  //    deliberately IDENTICAL between the two renderings (ArtifactRows.tsx's
  //    own doc comment), which is exactly what made the single-click
  //    assumption look plausible from title text alone. ───────────────────
  const pageRow = page.locator(`[title="open saved page \\"${reloadedPage.name}\\""]`);
  await expect(pageRow, "the saved page has a Library row to reopen from").toBeVisible();
  await pageRow.dblclick();

  const reopenedWin = figurePageWindow(page);
  await expect(reopenedWin).toBeVisible();
  await expect(slot(reopenedWin, 0)).toContainText(figA2.name);
  await expect(slot(reopenedWin, 1)).toContainText(figA1.name);
  await expect(slot(reopenedWin, 2)).toContainText(figB2.name);
  await expect(slot(reopenedWin, 3)).toContainText(figB1.name);

  // ── Edit ONE panel (slot 1, the reopened "Panel A1"): only its own
  //    per-panel title override changes — the other three stay untouched. ──
  await slot(reopenedWin, 1).click();
  await reopenedWin.getByPlaceholder("title (from source)").fill("Edited solo panel");

  await reopenedWin.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => pagesState(page).then((p) => p[0]?.modifiedAt)).not.toBe(reloadedPage.modifiedAt);
  const editedPage = (await pagesState(page))[0];
  expect(editedPage.panels[1].title, "the edited panel's own title changed").toBe("Edited solo panel");
  expect(editedPage.panels[0].title, "panel 0 untouched").toBeNull();
  expect(editedPage.panels[2].title, "panel 2 untouched").toBeNull();
  expect(editedPage.panels[3].title, "panel 3 untouched").toBeNull();

  // ── Export the page (real backend): four panels, same rearranged order,
  //    the edited panel's title override present, the others' absent. ──────
  const finalBody = await exportPageNow(page, reopenedWin);
  expect(finalBody.panels).toHaveLength(4);
  expect(finalBody.panels.map((p) => [p.row, p.col])).toEqual([
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]);
  expect(finalBody.panels.map((p) => p.figure.title), "same rearranged figure order reached the export").toEqual([
    "Panel A2",
    "Panel A1",
    "Panel B2",
    "Panel B1",
  ]);
  expect(finalBody.panels[1].title, "the edited panel's override reached the export").toBe("Edited solo panel");
  expect(finalBody.panels[0].title, "an untouched panel carries no override").toBeUndefined();
  expect(finalBody.panels[2].title).toBeUndefined();
  expect(finalBody.panels[3].title).toBeUndefined();
});

// A6 names "link then unlink axes" as a live capability to exercise. Read
// from source before writing anything here (see the module header's mechanism
// #2 section): FigurePageView.tsx's preview is ONE static server-rendered
// `<img>` (usePagePreviewExport.ts), and SlotGrid.tsx has no interactive
// uPlot canvas per panel — there is no live pan/zoom gesture anywhere in this
// composer to drive, and therefore nothing that could "propagate" between
// two panels on screen. `PageLayoutSettings.linkX`/`linkY`
// (lib/pageDocument.ts) are consumed only by the backend's matplotlib
// composer at render time (`calc.figure_page_layout`), which the main test
// above already proves reaches a real export request and flips off again —
// the load-bearing half of "link/unlink" available today. Faking a canvas
// zoom gesture against a plain `<img>` would prove nothing real, so this is
// left as a named gap rather than a passing assertion with no mechanism
// behind it.
test.fixme(
  "a live zoom on one panel propagates to its linked sibling panel, and stops once unlinked",
  async () => {
    // No interactive per-panel canvas exists to gesture on — see the comment
    // immediately above (FigurePageView.tsx / SlotGrid.tsx / usePagePreviewExport.ts).
  },
);
