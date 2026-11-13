// Journey — graph windows are independent (publication-figures audit B1,
// 2026-11-13). The audit imported a file, styled its plot (error columns, a
// y2 curve, axis titles, a log axis, a reference line, a plot title), then
// imported a second file: the import rebound the single plot window and
// silently wiped all of it. Double-clicking another Library row did the same.
// The A1–A8 specs pre-created spare windows, so the import always had an
// unstyled window to land in and the bug never showed.
//
// Real file drops onto the Library (the real import pipeline, real backend);
// the styling goes through the store's own actions (the same ones the
// Inspector calls) and is read back from the store, since the assertion is
// about state surviving, not about pixels.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

interface Win {
  id: string;
  kind: string;
  title: string;
  datasetId: string | null;
}
interface ViewState {
  plotTitle: string;
  xAxisLabel: string;
  yScale: string;
  y2Keys: number[] | null;
  errKeys: Record<number, number>;
  refLines: unknown[];
}
type Store = {
  plotWindows: Win[];
  focusedWindowId: string | null;
  datasets: { id: string; name: string }[];
  setPlotTitle: (t: string) => void;
  setXAxisLabel: (t: string) => void;
  setYScale: (s: string) => void;
  setY2Keys: (k: number[] | null) => void;
  setErrKey: (c: number, e: number | null) => void;
  addRefLine: (axis: "x" | "y", v: number) => void;
  focusWindow: (id: string) => void;
} & ViewState;

const store = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => Store } } }).__qz.useApp.getState();
    return {
      windows: s.plotWindows.map(({ id, kind, title, datasetId }) => ({ id, kind, title, datasetId })),
      focused: s.focusedWindowId,
      datasets: s.datasets.map(({ id, name }) => ({ id, name })),
      view: { plotTitle: s.plotTitle, xAxisLabel: s.xAxisLabel, yScale: s.yScale, y2Keys: s.y2Keys, errKeys: s.errKeys, refLines: s.refLines },
    };
  });

/** The audit's styling, through the store's own actions. */
async function styleFocused(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => Store } } }).__qz.useApp.getState();
    s.setErrKey(0, 1);
    s.setY2Keys([1]);
    s.setXAxisLabel("$T$ (K)");
    s.setYScale("log");
    s.addRefLine("x", 20);
    s.setPlotTitle("Sample A: chi and rho");
  });
}

function expectStyled(view: ViewState): void {
  expect(view.plotTitle).toBe("Sample A: chi and rho");
  expect(view.xAxisLabel).toBe("$T$ (K)");
  expect(view.yScale).toBe("log");
  expect(view.y2Keys).toEqual([1]);
  expect(view.errKeys).toEqual({ 0: 1 });
  expect(view.refLines).toHaveLength(1);
}

test.describe("Graph windows are independent of new data", () => {
  test("importing twice never rebinds or restyles the styled window", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
    await waitForDatasetCount(page, 1);

    let s = await store(page);
    expect(s.windows.filter((w) => w.kind === "plot")).toHaveLength(1);
    const styledId = s.focused!;
    const firstData = s.datasets[0].id;
    await styleFocused(page);

    // ── Second import: lands in a NEW window, the styled one is untouched ──
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
    await waitForDatasetCount(page, 2);
    await expect.poll(async () => (await store(page)).windows.length).toBe(2);
    s = await store(page);
    expect(s.focused).not.toBe(styledId);
    expect(s.windows.find((w) => w.id === styledId)!.datasetId).toBe(firstData);
    expect(s.view.plotTitle).toBe(""); // the title of "Sample A" did not follow the new data
    const second = s.focused!;

    // ── Third import: reuses the unstyled window, never the styled one ──
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 3);
    await expect.poll(async () => (await store(page)).windows.find((w) => w.id === second)?.title).toBe("linear-ramp.csv");
    s = await store(page);
    expect(s.windows).toHaveLength(2);
    expect(s.windows.find((w) => w.id === styledId)!.datasetId).toBe(firstData);

    // ── Back on the styled window: every edit survived ──
    await page.evaluate((id) => (window as unknown as { __qz: { useApp: { getState: () => Store } } }).__qz.useApp.getState().focusWindow(id), styledId);
    s = await store(page);
    expectStyled(s.view);
    // Its window title still names its own data, not the last import.
    await expect(page.locator(".qzk-plotwin.focused .qzk-plotwin-title")).toHaveText("two-channel.csv");
  });

  test("double-clicking another Library row opens it beside the styled window", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
    await waitForDatasetCount(page, 1);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
    await waitForDatasetCount(page, 2);

    let s = await store(page);
    const styledId = s.focused!;
    const shown = s.windows.find((w) => w.id === styledId)!.datasetId;
    const other = s.datasets.find((d) => d.id !== shown)!;
    await styleFocused(page);

    await page.locator(`[data-ds-id="${other.id}"]`).dblclick();
    await expect.poll(async () => (await store(page)).focused).not.toBe(styledId);
    s = await store(page);
    expect(s.windows.find((w) => w.id === s.focused)!.datasetId).toBe(other.id);
    expect(s.windows.find((w) => w.id === styledId)!.datasetId).toBe(shown);

    await page.evaluate((id) => (window as unknown as { __qz: { useApp: { getState: () => Store } } }).__qz.useApp.getState().focusWindow(id), styledId);
    expectStyled((await store(page)).view);
  });
});
