// Journey (G5) — the lifecycle proof: create a Quick Figure through the real
// UI, modify a normal figure property, save + close the window, reopen it
// from Editable Figures, save the complete project (.dwk) and reload it, then
// verify X/Y mappings, plot style, series configuration, and asymmetric/X
// error bindings all survive byte-exact — plus an Undo/Redo coherence check.
//
// This is deliberately ONE continuous journey (not split across specs): the
// owner's checklist is a CHAIN, and the seam most likely to break is the
// hand-off between steps (a document detaching from its window on reopen, an
// edit dropping on save, a rich error binding surviving the in-memory round
// trip but not the real .dwk file round trip) — splitting it into isolated
// specs would hide exactly that class of bug.
//
// Save/reload path: driven through the REAL File menu — "Save workspace
// (.dwk)…" triggers a real browser download (`saveBlob`, an anchor+Blob
// click, see store/workspaceIO.ts), and "Open workspace (.dwk)…" opens a
// real native `<input type="file">` (lib/openFilePicker.ts) — so the file
// dialogs ARE driveable headlessly via Playwright's `download` and
// `filechooser` events, no jsdom/store-only fallback needed. This is the
// realest path available (see figure-document-roundtrip.spec.ts's precedent
// for the individual pieces — Save Editable Figure via menu, close via
// store, reopen via Library row — extended here to the full-project save
// and the Quick Figure Builder's own real-UI creation flow).

import { expect, type Locator, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

interface ErrorBinding {
  channel: number;
  target: number;
  axis: "x" | "y";
  side: "both" | "+" | "-";
}

interface FigureDocumentLike {
  id: string;
  name: string;
  bindings: {
    datasetId: string | null;
    xKey: number | null;
    yKeys: number[] | null;
    errors: ErrorBinding[];
  };
  plot: {
    mark: string;
    view: {
      yAxisLabel: string;
      seriesStyles: Record<number, { marker?: boolean; color?: string }>;
    };
  };
}

const EXPECTED_ERRORS: ErrorBinding[] = [
  { channel: 3, target: 1, axis: "y", side: "+" },
  { channel: 4, target: 1, axis: "y", side: "-" },
  { channel: 5, target: -1, axis: "x", side: "both" },
];

function builder(page: Page): Locator {
  return page.locator(".qzk-quick-builder");
}

async function openBuilder(page: Page): Promise<Locator> {
  const row = page.locator("[data-ds-id]").first();
  await row.hover();
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Configure Quick Plot…", exact: true }).click();
  const panel = builder(page);
  await expect(panel).toBeVisible();
  return panel;
}

interface QzWindow {
  __qz: {
    useApp: {
      getState: () => {
        editableFigures: FigureDocumentLike[];
        plotWindows: { id: string; document?: FigureDocumentLike; datasetId: string | null }[];
        focusedWindowId: string | null;
        datasets: { id: string }[];
      };
    };
  };
}

async function editableFigures(page: Page): Promise<FigureDocumentLike[]> {
  return page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().editableFigures);
}

async function focusedWindowId(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().focusedWindowId);
}

async function plotWindows(page: Page) {
  return page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().plotWindows);
}

function windowFrame(page: Page, title: string): Locator {
  return page.locator(".qzk-plotwin", { hasText: title });
}

/** Open the Inspector's "Titles & labels" card and return its Y-label field.
 *  The card is a native `<details>` (components/primitives/Card.tsx) that
 *  React only ever writes an INITIAL `open` attribute onto — once a real
 *  click toggles it, later re-renders never fight that back closed. But
 *  this journey spans a window close + a full project reload, and whether
 *  the Inspector's own component instance survives those unmounted is not a
 *  contract this spec should assume either way — so this checks the actual
 *  DOM state and only clicks the summary when the field isn't already
 *  showing, instead of assuming a toggle from a possibly-stale prior step. */
async function openTitlesCard(page: Page): Promise<Locator> {
  const titlesCard = page.locator(".qz-card", { hasText: "Titles & labels" });
  const yLabelInput = titlesCard.getByPlaceholder("auto").nth(1);
  if (!(await yLabelInput.isVisible())) {
    await page.getByText("Titles & labels").click();
  }
  await expect(yLabelInput).toBeVisible();
  return yLabelInput;
}

test("Quick Figure survives create -> edit -> save/close -> reopen -> project save/reload byte-exact, with coherent Undo/Redo", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("six-channel.csv"));
  await waitForDatasetCount(page, 1);

  // ── 1. Build the mapping through the real Quick Figure Builder UI ──────
  // Channels (Time excluded): Alpha=0, Beta=1, Gamma=2, Delta=3, Epsilon=4,
  // Zeta=5. Alpha becomes the alternate X (not the acquisition axis) FIRST —
  // reassigning X after an X-error binding exists would drop it
  // (lib/quickFigureMapping.ts's dropXErrorBindings) — then Beta/Gamma stay
  // Y by default, and Delta/Epsilon/Zeta become the asymmetric Y pair + the
  // X-error binding.
  const panel = await openBuilder(page);
  await panel.getByLabel("Role for Alpha", { exact: true }).selectOption({ label: "X axis" });
  await panel.getByLabel("Role for Delta", { exact: true }).selectOption({ label: "Y error (+) for Beta" });
  await panel.getByLabel("Role for Epsilon", { exact: true }).selectOption({ label: "Y error (−) for Beta" });
  await panel.getByLabel("Role for Zeta", { exact: true }).selectOption({ label: "X error (±)" });
  // Not `getByLabel` here: "Plot style" is a wrapping `<label>` around the
  // `<select>` (QuickFigureBuilderWorkspace.tsx), and Chromium's real
  // accessible-name computation for that shape folds the select's own
  // current-option text into the label's name (unlike jsdom/Testing
  // Library's approximation, which is why the component test's
  // `getByRole("combobox", { name: "Plot style" })` passes there but an
  // exact `getByLabel` match hangs against a real browser) -- so this is
  // scoped by the field wrapper's class instead, which is unambiguous
  // regardless of accname edge cases.
  await panel
    .locator(".qzk-quick-builder-field", { hasText: "Plot style" })
    .locator("select")
    .selectOption("line-symbol");

  const create = panel.getByRole("button", { name: "Create Editable Figure", exact: true });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(panel).toBeHidden();

  // ── 2. The created window is focused; the document carries the mapping ─
  await expect.poll(() => editableFigures(page).then((figs) => figs.length)).toBe(1);
  const created = (await editableFigures(page))[0];
  const figureName = created.name;
  const docId = created.id;
  await expect.poll(() => focusedWindowId(page)).not.toBeNull();
  const originalWindowId = (await focusedWindowId(page))!;
  expect((await plotWindows(page)).find((w) => w.id === originalWindowId)?.document?.id).toBe(docId);

  expect(created.bindings.xKey).toBe(0);
  expect(created.bindings.yKeys).toEqual(expect.arrayContaining([1, 2]));
  expect(created.bindings.errors).toEqual(EXPECTED_ERRORS);
  expect(created.plot.mark).toBe("line");
  expect(created.plot.view.seriesStyles[1]?.marker).toBe(true);
  expect(created.plot.view.seriesStyles[2]?.marker).toBe(true);

  const frame = windowFrame(page, figureName);
  await expect(frame).toHaveClass(/focused/);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  await expect(page.locator(".qzk-legend .it")).toHaveCount(2);

  // ── 3. Modify a normal figure property through the real UI ─────────────
  // The Y axis label, via the Inspector's "Titles & labels" card — writes
  // straight into the document's `plot.view.yAxisLabel` on save, the same
  // real-UI path axis-title-limits.spec.ts already validates.
  const yLabelInput = await openTitlesCard(page);
  await yLabelInput.fill("Signal (edited)");
  await yLabelInput.blur();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { yAxisLabel: string } } } }).__qz.useApp.getState().yAxisLabel))
    .toBe("Signal (edited)");

  // ── Save through the window's own title-bar Save button ────────────────
  const saveButton = frame.locator(".qzk-plotwin-save");
  await expect(saveButton).toHaveText("●"); // dirty (unsaved edit) before Save
  await saveButton.click();
  await expect(saveButton).toHaveText("✓");
  await expect
    .poll(() => editableFigures(page).then((figs) => figs.find((f) => f.id === docId)?.plot.view.yAxisLabel))
    .toBe("Signal (edited)");
  const afterEdit = (await editableFigures(page)).find((f) => f.id === docId)!;
  expect(afterEdit.bindings.errors).toEqual(EXPECTED_ERRORS); // the edit didn't disturb the rich bindings

  // ── 4. Close the figure window; the document persists ──────────────────
  await frame.locator(".qzk-plotwin-close").click();
  await expect.poll(() => plotWindows(page).then((ws) => ws.some((w) => w.id === originalWindowId))).toBe(false);
  expect((await editableFigures(page)).some((f) => f.id === docId)).toBe(true);

  // ── 5. Reopen from the Editable Figures Library section ────────────────
  const row = page.locator(`[title="open editable figure \\"${figureName}\\""]`).first();
  await expect(row).toBeVisible();
  // L0.25 (PR #139): the Library TREE row (ArtifactRow.tsx) single-click
  // SELECTS and double-click OPENS -- same convention
  // figure-document-roundtrip.spec.ts already exercises.
  await row.dblclick();
  await expect
    .poll(() => plotWindows(page).then((ws) => ws.some((w) => w.document?.id === docId)))
    .toBe(true);
  const reopenedWindowId = (await plotWindows(page)).find((w) => w.document?.id === docId)!.id;
  expect(reopenedWindowId).not.toBe(originalWindowId); // a fresh MDI window, same document identity

  const reopenedDoc = (await plotWindows(page)).find((w) => w.id === reopenedWindowId)!.document!;
  expect(reopenedDoc.bindings.xKey).toBe(0);
  expect(reopenedDoc.bindings.yKeys).toEqual(expect.arrayContaining([1, 2]));
  expect(reopenedDoc.bindings.errors).toEqual(EXPECTED_ERRORS);
  expect(reopenedDoc.plot.view.yAxisLabel).toBe("Signal (edited)");
  expect(reopenedDoc.plot.view.seriesStyles[1]?.marker).toBe(true);
  expect(reopenedDoc.plot.view.seriesStyles[2]?.marker).toBe(true);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

  // ── 6. Save the complete project (.dwk) through the real File menu ─────
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByText("Save workspace (.dwk)…", { exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("workspace.dwk");
  const savedPath = await download.path();
  expect(savedPath).toBeTruthy();

  // ── Reload it through the real "Open workspace" file picker ────────────
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByText("Open workspace (.dwk)…", { exact: true }).click(),
  ]);
  await fileChooser.setFiles(savedPath!);
  // Replacing a non-empty workspace confirms first (hasWorkspaceContent).
  await page.getByRole("button", { name: "Replace", exact: true }).click();

  await expect.poll(() => page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().datasets.length)).toBe(1);
  await expect.poll(() => editableFigures(page).then((figs) => figs.some((f) => f.id === docId))).toBe(true);

  // ── 7. After reload: reopen the figure, verify everything byte-exact ───
  const reloadedDocBeforeReopen = (await editableFigures(page)).find((f) => f.id === docId)!;
  expect(reloadedDocBeforeReopen.bindings.xKey).toBe(0);
  expect(reloadedDocBeforeReopen.bindings.yKeys).toEqual(expect.arrayContaining([1, 2]));
  expect(reloadedDocBeforeReopen.bindings.errors).toEqual(EXPECTED_ERRORS);
  expect(reloadedDocBeforeReopen.plot.mark).toBe("line");
  expect(reloadedDocBeforeReopen.plot.view.yAxisLabel).toBe("Signal (edited)");
  expect(reloadedDocBeforeReopen.plot.view.seriesStyles[1]?.marker).toBe(true);
  expect(reloadedDocBeforeReopen.plot.view.seriesStyles[2]?.marker).toBe(true);

  const reloadedRow = page.locator(`[title="open editable figure \\"${figureName}\\""]`).first();
  await expect(reloadedRow).toBeVisible();
  await reloadedRow.dblclick(); // single click selects; double-click opens (L0.25)
  await expect
    .poll(() => plotWindows(page).then((ws) => ws.some((w) => w.document?.id === docId)))
    .toBe(true);
  const finalWindow = (await plotWindows(page)).find((w) => w.document?.id === docId)!;
  const finalDoc = finalWindow.document!;
  expect(finalDoc).toEqual(reloadedDocBeforeReopen); // byte-exact: reopening never rewrites the document
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  await expect(page.locator(".qzk-legend .it")).toHaveCount(2);

  // ── 8. Undo/Redo coherence spot-check ───────────────────────────────────
  // One more real-UI edit on the reopened figure, its own undo entry
  // (setYAxisLabel records "edit Y axis title" before mutating) — Ctrl+Z
  // must revert the LIVE view field, Ctrl+Shift+Z must restore it, and
  // neither must orphan or duplicate the window/document.
  const finalYLabel = await openTitlesCard(page);
  await finalYLabel.fill("Signal (final)");
  await finalYLabel.blur();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { yAxisLabel: string } } } }).__qz.useApp.getState().yAxisLabel))
    .toBe("Signal (final)");

  await page.locator(".qzk-stage").click({ position: { x: 4, y: 4 } }); // move focus off the text input
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { yAxisLabel: string } } } }).__qz.useApp.getState().yAxisLabel))
    .toBe("Signal (edited)");
  // Undo must not disturb which window/document is open.
  expect(await plotWindows(page).then((ws) => ws.filter((w) => w.document?.id === docId).length)).toBe(1);
  expect(await focusedWindowId(page)).toBe(finalWindow.id);

  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { yAxisLabel: string } } } }).__qz.useApp.getState().yAxisLabel))
    .toBe("Signal (final)");
  expect(await plotWindows(page).then((ws) => ws.filter((w) => w.document?.id === docId).length)).toBe(1);
});
