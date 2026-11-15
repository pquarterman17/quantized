// Error columns — Computed √Y error bars (origin gap audit 2 #14, #658), end
// to end against the real backend: the Inspector's "Error columns" card adds
// a linked sqrt(max(Y,1)) formula column and binds it as the series' Y error
// — live on the canvas (errKeys / hiddenChannels, which the plot and the fit
// weighting both read) and carried into a real figure export. See
// docs/theory/analysis.md for why the formula clamps at 1 and how it differs
// from the percent/constant alternatives in the same dialog.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface ErrorSpan {
  y?: { plus?: (number | null)[] | null; minus?: (number | null)[] | null };
}
interface FigureBody {
  dataset?: { labels?: string[] };
  y_keys?: (number | string)[];
  error_spans?: (ErrorSpan | null)[] | null;
}

type QzWindow = {
  __qz: {
    useApp: {
      getState: () => {
        activeId: string | null;
        errKeys: Record<string, number>;
        hiddenChannels: number[];
        datasets: {
          id: string;
          errorRoles?: { channel: number; target: number; axis: string; side: string }[];
          data: { labels: string[]; values: (number | null)[][] };
        }[];
      };
    };
  };
};

const activeDataset = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState();
    const d = s.datasets.find((x) => x.id === s.activeId)!;
    return {
      labels: d.data.labels,
      cols: d.data.labels.map((_l, c) => d.data.values.map((row) => Number(row[c]))),
      errorRoles: d.errorRoles ?? [],
      errKeys: s.errKeys,
      hiddenChannels: s.hiddenChannels,
    };
  });

test("Error columns ▸ Computed √Y: a linked error column, live on the plot and in the export", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 1);

  await page.getByText("Error columns", { exact: true }).click();
  const card = page.locator(".qz-card", { hasText: "Error columns" });
  await expect(card.getByText("No error columns bound.")).toBeVisible();

  // √Y is the default source; just add it for the only plotted series.
  await expect(card.getByRole("combobox", { name: "Computed error source" })).toHaveValue("sqrt");
  await card.getByRole("button", { name: "Add computed error" }).click();

  await expect
    .poll(async () => (await activeDataset(page)).labels)
    .toEqual(["Value", "√(Value)"]);
  const afterAdd = await activeDataset(page);
  expect(afterAdd.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  // Live on the canvas: bound as channel 0's error, drawn as bars rather
  // than its own curve (store/computedErrorRun.ts).
  expect(afterAdd.errKeys).toMatchObject({ "0": 1 });
  expect(afterAdd.hiddenChannels).toContain(1);

  // sqrt(max(Y, 1)): every value here is already >= 1, so no clamp engages.
  const values = afterAdd.cols[0];
  const errs = afterAdd.cols[1];
  for (let i = 0; i < values.length; i++) expect(errs[i]).toBeCloseTo(Math.sqrt(values[i]), 6);
  expect(errs[0]).toBeCloseTo(1.0, 6); // Y = 1.0
  expect(errs.at(-1)).toBeCloseTo(Math.sqrt(4.6), 6); // Y = 4.6

  // The export carries the same bound error, as a symmetric Y error span
  // (lib/figureSpecSeries.ts::exportErrorSpans) aligned to the plotted series.
  await runPaletteCommand(page, "Export figure…");
  const dialog = page.getByRole("dialog", { name: "Export figure" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Format").selectOption("svg");
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const body = (await request).postDataJSON() as FigureBody;
  await download; // the export actually completed (a download followed)

  expect(body.y_keys).toEqual([0]);
  expect(body.dataset?.labels).toEqual(["Value", "√(Value)"]);
  const span = body.error_spans?.[0];
  expect(span?.y?.plus?.[0]).toBeCloseTo(1.0, 6);
  expect(span?.y?.minus?.[0]).toBeCloseTo(1.0, 6); // "both" side: symmetric
  expect(span?.y?.plus?.at(-1)).toBeCloseTo(Math.sqrt(4.6), 6);
});
