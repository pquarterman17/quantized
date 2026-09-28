import { expect, test } from "@playwright/test";

import { gotoApp } from "../utils/harness";

test("a legend resizes from its corner, stays inside the plot, and can fit contents again @core", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const useApp = (window as unknown as { __qz: { useApp: { setState: (state: object) => void } } }).__qz.useApp;
    useApp.setState({
      datasets: [{
        id: "d1", name: "Resize demo",
        data: { time: [0, 1, 2], values: [[1, 2], [2, 3], [3, 4]], labels: ["Alpha", "Beta"], units: ["", ""], metadata: {} },
      }],
      activeId: "d1", xKey: null, yKeys: [0, 1], plotTool: "pointer",
      showLegend: true, legendXY: [0.1, 0.1], legendFrameXY: null, legendSize: null,
    });
  });

  const legend = page.locator(".qzk-legend");
  await expect(legend).toBeVisible();
  const before = await legend.boundingBox();
  const stage = await page.locator(".qzk-stage").boundingBox();
  if (!before || !stage) throw new Error("legend/stage geometry unavailable");

  const handle = page.locator(".qzk-legend-resize-se");
  const grip = await handle.boundingBox();
  if (!grip) throw new Error("legend resize handle geometry unavailable");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2 + 40, { steps: 4 });
  await page.mouse.up();

  const after = await legend.boundingBox();
  if (!after) throw new Error("resized legend geometry unavailable");
  expect(after.width).toBeGreaterThan(before.width + 50);
  expect(after.height).toBeGreaterThan(before.height + 30);
  expect(after.x + after.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(after.y + after.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { legendSize: [number, number] | null } } } }).__qz.useApp.getState().legendSize,
  )).not.toBeNull();

  await handle.dblclick();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { legendSize: [number, number] | null } } } }).__qz.useApp.getState().legendSize,
  )).toBeNull();
  expect((await legend.boundingBox())!.width).toBeLessThan(after.width);
});
