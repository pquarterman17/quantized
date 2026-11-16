// UX8-C ("Many datasets: select, overlay, panels"). The audit imported ten
// same-shape M(H) loops and found three breaks in a row: no batch offer (the
// files are "generic"), Shift-click in the Tree selected ONE row (it anchored
// on the plotted dataset, which a Tree click never moves), and the bar's
// Plot opened a legend-less composite window titled "MH_010K.csv: Moment,
// MH_040K.csv: Moment, …". This journey drives the fixed path end to end.

import fs from "node:fs";
import path from "node:path";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { gotoApp, waitForDatasetCount } from "../utils/harness";

type Store = {
  getState: () => {
    selectedIds: string[];
    activeId: string | null;
    yAxisLabel: string;
    datasets: { id: string; name: string; linkedCurves?: unknown[]; data: { labels: string[]; units: string[] } }[];
  };
};
const store = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __qz: { useApp: Store } }).__qz.useApp.getState();
  const graph = s.datasets.find((d) => d.linkedCurves);
  return {
    selected: s.selectedIds.length,
    yTitle: s.yAxisLabel,
    graph: graph ? { id: graph.id, labels: graph.data.labels, units: graph.data.units, active: s.activeId === graph.id } : null,
  };
});

const TEMPS = [10, 40, 70, 100, 130, 160, 190, 220, 250, 280];
const name = (t: number) => `MH_${String(t).padStart(3, "0")}K.csv`;

/** Ten `Field (Oe), Moment (emu)` loops, written for this run. */
function writeLoops(dir: string): string[] {
  fs.mkdirSync(dir, { recursive: true });
  return TEMPS.map((t) => {
    const rows = Array.from({ length: 41 }, (_, i) => {
      const h = -60000 + i * 3000;
      return `${h},${(1e-3 * Math.tanh(h / (2000 + 20 * t))).toExponential(6)}`;
    });
    const file = path.join(dir, name(t));
    fs.writeFileSync(file, ["Field (Oe),Moment (emu)", ...rows].join("\n") + "\n");
    return file;
  });
}

/** Drop several files in ONE gesture (one import batch, one outcome toast). */
async function dropFiles(page: Page, target: Locator, files: string[]): Promise<void> {
  const payload = files.map((f) => ({ name: path.basename(f), text: fs.readFileSync(f, "utf8") }));
  const dataTransfer = await page.evaluateHandle((items) => {
    const dt = new DataTransfer();
    for (const it of items) dt.items.add(new File([it.text], it.name, { type: "text/csv" }));
    return dt;
  }, payload);
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
}

test("ten same-shape files: batch offer, Shift-range of 10, Plot = one graph with a 10-entry legend", async ({ page }, info) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await dropFiles(page, page.locator(".qzk-library"), writeLoops(info.outputPath("loops")));
  await waitForDatasetCount(page, 10);

  // (7) generic files with one column shape still get the overlay offer.
  const offer = page.locator(".qzk-toast", { hasText: "10 files imported — overlay in one plot?" });
  await expect(offer).toBeVisible();
  await expect(offer.getByRole("button", { name: "Overlay" })).toBeVisible();

  // (1) click the first row, Shift-click the last: all ten are selected.
  const rows = page.locator("[data-ds-id]");
  await rows.first().click();
  await expect.poll(async () => (await store(page)).selected).toBe(1);
  await rows.last().click({ modifiers: ["Shift"] });
  await expect.poll(async () => (await store(page)).selected).toBe(10);
  const bar = page.locator(".qzk-multiselect-bar");
  await expect(bar.getByText("10 selected")).toBeVisible();

  // (3)+(4) the bar's Plot lands ONE live graph: legend by file stem, no
  // per-entry unit on screen, the unit on the Y title -- and still on the data.
  await bar.getByRole("button", { name: "Plot" }).click();
  await expect.poll(async () => (await store(page)).graph?.active ?? false).toBe(true);
  const { graph, yTitle } = await store(page);
  expect(graph!.labels).toEqual(TEMPS.map((t) => name(t).replace(".csv", "")));
  expect(graph!.units).toEqual(TEMPS.map(() => "emu"));
  expect(yTitle).toBe("Moment (emu)");
  const legend = page.locator(".qzk-legend .qzk-legend-label");
  await expect(legend).toHaveCount(10);
  await expect(legend.first()).toHaveText("MH_010K");
  await expect(page.locator(".qzk-panel-grid, .qzk-panel-overlay")).toHaveCount(0);
});
