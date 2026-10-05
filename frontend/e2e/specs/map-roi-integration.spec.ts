import { expect, test, type Page } from "@playwright/test";

import { gotoApp, waitForDatasetCount } from "../utils/harness";

type RoiRect = { x0: number; x1: number; y0: number; y1: number };

async function seedRsm(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rows: number[][] = [];
    const time: number[] = [];
    for (let j = 0; j < 21; j++) {
      for (let i = 0; i < 21; i++) {
        const qx = -1 + i / 10;
        const qz = -1 + j / 10;
        const intensity = 1 + 1000 * Math.exp(-20 * (qx * qx + qz * qz));
        time.push(30 + i / 100);
        rows.push([30 + i / 100, 15 + j / 100, intensity, qx, qz]);
      }
    }
    const useApp = (window as unknown as { __qz: { useApp: { setState: (state: object) => void } } }).__qz.useApp;
    useApp.setState({
      datasets: [{
        id: "rsm", name: "pointer-capture-rsm.xrdml",
        data: {
          time, values: rows,
          labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
          units: ["deg", "deg", "counts", "Ang^-1", "Ang^-1"],
          metadata: { is2D: true, map_shape: [21, 21], axis1_name: "Omega", technique: "xrd.rsm" },
        },
      }],
      activeId: "rsm", selectedIds: ["rsm"], stageTab: "map", mapRoi: null,
    });
  });
  await waitForDatasetCount(page, 1);
  await expect(page.locator(".qzk-stage canvas")).toBeVisible();
  await page.getByRole("button", { name: "Q-space axes" }).click();
}

async function restoreRsmMap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const useApp = (window as unknown as { __qz: { useApp: { setState: (state: object) => void } } }).__qz.useApp;
    useApp.setState({ activeId: "rsm", selectedIds: ["rsm"], stageTab: "map" });
  });
  await expect(page.locator(".qzk-stage canvas")).toBeVisible();
  await page.getByRole("button", { name: "Q-space axes" }).click();
}

test("XRD map box and sector handles drag and land visible 1-D profiles @core", async ({ page }) => {
  await gotoApp(page);
  await seedRsm(page);

  const canvas = page.locator(".qzk-stage canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas geometry unavailable");

  await page.getByRole("button", { name: "Integration box" }).click();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.62, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-roi-handle="box-4"]')).toBeVisible();

  const before = await page.evaluate(() => ({
    ...(window as unknown as { __qz: { useApp: { getState: () => { mapRoi: RoiRect } } } }).__qz.useApp.getState().mapRoi,
  }));
  const handle = await page.locator('[data-roi-handle="box-4"]').boundingBox();
  if (!handle) throw new Error("box resize handle geometry unavailable");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 70, handle.y + handle.height / 2 + 45, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => ({
    ...(window as unknown as { __qz: { useApp: { getState: () => { mapRoi: RoiRect } } } }).__qz.useApp.getState().mapRoi,
  }))).not.toEqual(before);

  await page.getByRole("button", { name: "∫ Qx" }).click();
  await waitForDatasetCount(page, 2);
  await expect(page.locator(".qzk-tab.active")).toHaveText("Plot");
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => { datasets: { id: string; data: { values: number[][]; metadata: Record<string, unknown> } }[]; activeId: string } } } }).__qz.useApp.getState();
    const active = s.datasets.find((d) => d.id === s.activeId);
    const defaults = active?.data.metadata.default_value_channels;
    return active?.data.values.some((row) => Number.isFinite(row[0]) && row[0] > 0) && Array.isArray(defaults) && defaults[0] === 0;
  })).toBe(true);

  await restoreRsmMap(page);
  const sectorTool = page.getByRole("button", { name: "Sector wedge", exact: true });
  await sectorTool.click();
  await expect(sectorTool).toHaveClass(/active/);
  const qMax = await page.locator('[data-roi-handle="sector-qMax"]').boundingBox();
  if (!qMax) throw new Error("sector qMax handle geometry unavailable");
  const sectorBefore = await page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { mapSector: { secMax: number } } } } }).__qz.useApp.getState().mapSector.secMax,
  );
  const mapBox = await canvas.boundingBox();
  if (!mapBox) throw new Error("restored map canvas geometry unavailable");
  await page.mouse.move(qMax.x + qMax.width / 2, qMax.y + qMax.height / 2);
  await page.mouse.down();
  const handleX = qMax.x + qMax.width / 2;
  const handleY = qMax.y + qMax.height / 2;
  const centerX = mapBox.x + mapBox.width / 2;
  const centerY = mapBox.y + mapBox.height / 2;
  await page.mouse.move(handleX + (centerX - handleX) * 0.15, handleY + (centerY - handleY) * 0.15, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { mapSector: { secMax: number } } } } }).__qz.useApp.getState().mapSector.secMax,
  )).not.toBe(sectorBefore);

  await page.getByRole("button", { name: "Radial", exact: true }).click();
  await waitForDatasetCount(page, 3);
  await expect(page.locator(".qzk-tab.active")).toHaveText("Plot");
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
});
