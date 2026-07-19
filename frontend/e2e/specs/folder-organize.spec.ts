// Journey (b) — Folder create/nest/reorder + drag a dataset into one via its
// grip handle, verifying the 3-zone drop (GUI_INTERACTION_PLAN #15). Native
// HTML5 drag-and-drop over a real pointer-capture sequence — the exact gap
// jsdom leaves uncovered (FolderRow.test.tsx / DatasetRow.test.tsx exercise
// the onDrop HANDLER directly with a synthetic dataTransfer stub, never a
// real drag gesture end to end).
//
// `.qzk-drag-handle` (aria-label "Drag to move") is the ONE draggable
// element on a row (GUI_INTERACTION_PLAN #13) — the rest of the row keeps
// its plain click behaviour. Store reads go through the `?harness` seam
// (folders/datasets are plain data, not store actions, so they round-trip
// through page.evaluate cleanly).

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

interface FolderSnapshot {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}
interface DatasetSnapshot {
  id: string;
  name: string;
  folderId?: string | null;
}

async function readFolders(page: import("@playwright/test").Page): Promise<FolderSnapshot[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __qz: { useApp: { getState: () => { folders: FolderSnapshot[] } } } }).__qz.useApp
        .getState().folders,
  );
}
async function readDatasets(page: import("@playwright/test").Page): Promise<DatasetSnapshot[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __qz: { useApp: { getState: () => { datasets: DatasetSnapshot[] } } } }).__qz.useApp
        .getState().datasets,
  );
}
async function readHistoryLabels(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __qz: { useApp: { getState: () => { history: { label: string }[] } } } }).__qz.useApp
        .getState().history.map((entry) => entry.label),
  );
}

test.describe("Library folder organization @core", () => {
  test("create, nest, reorder folders and drag a dataset into one", async ({ page }) => {
    await gotoApp(page);

    // ── Import one dataset (the drag-into-folder target payload) ──────────
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
    await waitForDatasetCount(page, 1);

    // ── Create two root folders (the "create" half of the journey) ────────
    // The icon-only toolbar buttons here (Library.tsx) carry a `title` but no
    // `aria-label` and DO have visible glyph text ("▦") — the glyph, not the
    // title, is the computed accessible name, so `getByTitle` (a direct DOM
    // `title`-attribute lookup, not accessible-name computation) is the
    // right locator rather than `getByRole('button', {name})`.
    const newFolderBtn = page.getByTitle("New folder", { exact: true });
    await newFolderBtn.click();
    await newFolderBtn.click();
    await expect(page.locator(".qzk-folder-head")).toHaveCount(2);

    // Rename them via double-click -> inline edit (deterministic names to
    // assert on, instead of relying on "New Folder"/"New Folder (2)" wording).
    const heads = page.locator(".qzk-folder-head");
    await heads.nth(0).getByTitle(/double-click to rename/).dblclick();
    await page.locator(".qzk-folder-rename").fill("Alpha");
    await page.keyboard.press("Enter");
    await heads.nth(1).getByTitle(/double-click to rename/).dblclick();
    await page.locator(".qzk-folder-rename").fill("Beta");
    await page.keyboard.press("Enter");

    let folders = await readFolders(page);
    const alpha = folders.find((f) => f.name === "Alpha")!;
    const beta = folders.find((f) => f.name === "Beta")!;
    expect(alpha).toBeTruthy();
    expect(beta).toBeTruthy();
    expect(alpha.order).toBeLessThan(beta.order); // Alpha created first

    // ── Reorder: drag Beta's grip handle onto Alpha's TOP edge band ───────
    // (dropZoneAt: top ~25% of the row height = "above" -> Beta becomes a
    // sibling positioned before Alpha).
    const alphaHandle = page.locator(".qzk-folder-head", { hasText: "Alpha" }).locator(".qzk-drag-handle");
    const betaHandle = page.locator(".qzk-folder-head", { hasText: "Beta" }).locator(".qzk-drag-handle");
    await betaHandle.dragTo(page.locator(".qzk-folder-head", { hasText: "Alpha" }), {
      targetPosition: { x: 40, y: 2 },
    });

    await expect
      .poll(async () => {
        folders = await readFolders(page);
        const a = folders.find((f) => f.name === "Alpha")!;
        const b = folders.find((f) => f.name === "Beta")!;
        return a.parentId === b.parentId && b.order < a.order;
      })
      .toBe(true);
    // ── Nest: create a third folder "Gamma", drag it into Alpha's MIDDLE
    //    band ("into" zone) so it becomes Alpha's child ────────────────────
    await newFolderBtn.click();
    const gammaHead = page.locator(".qzk-folder-head", { hasText: "New Folder" }).first();
    await gammaHead.getByTitle(/double-click to rename/).dblclick();
    await page.locator(".qzk-folder-rename").fill("Gamma");
    await page.keyboard.press("Enter");

    const gammaHandle = page.locator(".qzk-folder-head", { hasText: "Gamma" }).locator(".qzk-drag-handle");
    await gammaHandle.dragTo(page.locator(".qzk-folder-head", { hasText: "Alpha" }), {
      targetPosition: { x: 40, y: 14 }, // vertical middle -> "into"
    });

    await expect
      .poll(async () => {
        folders = await readFolders(page);
        const g = folders.find((f) => f.name === "Gamma")!;
        const a = folders.find((f) => f.name === "Alpha")!;
        return g.parentId === a.id;
      })
      .toBe(true);

    const gammaId = (await readFolders(page)).find((f) => f.name === "Gamma")!.id;

    // ── Drag the dataset into Alpha via its own grip handle (whole-row
    //    "into" target, no split — FolderRow.tsx's dataset branch) ────────
    const dsHandle = page.locator("[data-ds-id]", { hasText: "dataset-a" }).locator(".qzk-drag-handle");
    await dsHandle.dragTo(page.locator(".qzk-folder-head", { hasText: "Alpha" }));

    await expect
      .poll(async () => {
        const datasets = await readDatasets(page);
        const alphaId = (await readFolders(page)).find((f) => f.name === "Alpha")!.id;
        return datasets[0]?.folderId === alphaId;
      })
      .toBe(true);

    const historyCount = (await readHistoryLabels(page)).length;
    expect((await readHistoryLabels(page)).slice(-3)).toEqual(["rename folder", "move folder", "move dataset"]);
    expect(await page.evaluate((id) => {
      const h = (window as unknown as { __qz: { useApp: { getState: () => { history: { label: string; snapshot: { folders: FolderSnapshot[] } }[] } } } }).__qz.useApp.getState().history;
      return h.at(-2)?.snapshot.folders.some((f) => f.id === id) ?? false;
    }, gammaId)).toBe(true);

    // Edit history is organization-aware: one Ctrl+Z reverses one committed
    // drop, never the drag's intermediate pointer events.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await readHistoryLabels(page)).length).toBe(historyCount - 1);
    await expect.poll(async () => (await readDatasets(page))[0]?.folderId ?? null).toBeNull();

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await readHistoryLabels(page)).length).toBe(historyCount - 2);
    await expect
      .poll(async () => {
        const fs = await readFolders(page);
        const gamma = fs.find((f) => f.id === gammaId);
        return gamma ? gamma.parentId : "missing";
      })
      .toBeNull();

    // Step back past Gamma's rename/create, then the next undo reverses the
    // earlier Beta-before-Alpha reorder.
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => {
        const fs = await readFolders(page);
        const a = fs.find((f) => f.name === "Alpha")!;
        const b = fs.find((f) => f.name === "Beta")!;
        return a.order < b.order;
      })
      .toBe(true);
  });
});
