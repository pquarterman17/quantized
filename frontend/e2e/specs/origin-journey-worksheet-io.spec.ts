// Origin-replacement journey — worksheet import / export.
//
// The Origin user: imports an instrument file whose table sits under a
// `[DATA]` heading (the header row must be found below it, tab-separated), a
// CSV whose first column holds dates (the plot's X axis and the worksheet
// show dates, not epoch seconds), exports that worksheet as TSV with Long
// Name and Units rows and imports the file back (same names, units and text
// column), then imports two files as the sheets of ONE workbook and switches
// sheet tabs. All checks read app state or the downloaded file; nothing is
// mocked. Synthetic fixtures (e2e/fixtures/ws-io-*).

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { installCanvasRecorder } from "../utils/canvasRecorder";
import { dropFileOnto } from "../utils/dnd";
import { chooseFiles } from "../utils/fileChooser";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface Shown {
  name: string;
  labels: string[];
  units: string[];
  xName: string;
  xUnit: string;
  isDate: boolean;
  text: string[];
  workbookId: string | undefined;
}
type QzWindow = { __qz: { useApp: { getState: () => Record<string, unknown> } } };
type DrawWindow = { __qzDraw: { log: (c: HTMLCanvasElement) => { op: string; text?: string }[] } };

/** Every text the plot canvases drew in their latest frame (tick labels are
 *  canvas text, not DOM -- utils/canvasRecorder). */
const canvasTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("canvas")]
      .flatMap((c) => (window as unknown as DrawWindow).__qzDraw.log(c))
      .flatMap((o) => (o.op === "text" && o.text ? [o.text] : [])),
  );

/** The dataset at `index` (default: the last one), read-only via ?harness. */
const shown = (page: Page, index = -1): Promise<Shown> =>
  page.evaluate((i) => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState() as {
      datasets: {
        name: string;
        workbookId?: string;
        data: { labels: string[]; units: string[]; metadata: Record<string, unknown> };
      }[];
    };
    const d = s.datasets.at(i)!;
    const m = d.data.metadata;
    return {
      name: d.name,
      labels: d.data.labels,
      units: d.data.units,
      xName: String(m.x_column_name ?? ""),
      xUnit: String(m.x_column_unit ?? ""),
      isDate: m.time_is_datetime === true,
      text: Object.keys((m.text_columns as Record<string, unknown>) ?? {}),
      workbookId: d.workbookId,
    };
  }, index);

test("Origin worksheet I/O: [DATA] header, date X, export + re-import, files as sheets of one workbook", async ({ page }) => {
  test.setTimeout(90_000);
  await installCanvasRecorder(page);
  await gotoApp(page);
  const library = page.locator(".qzk-library");

  // 1. A key/value preamble, then the table under [DATA]: the header is the
  //    row below the heading, not the first preamble line.
  await dropFileOnto(page, library, fixturePath("ws-io-data-section.txt"), "text/plain");
  await waitForDatasetCount(page, 1);
  await expect.poll(async () => (await shown(page)).xName).toBe("Bias calc");
  expect(await shown(page)).toMatchObject({ labels: ["Current"], units: ["A"], xUnit: "V" });

  // 2. A date first column: the plot axis and the worksheet read as dates.
  await dropFileOnto(page, library, fixturePath("ws-io-dates.csv"));
  await waitForDatasetCount(page, 2);
  await expect.poll(async () => (await shown(page)).isDate).toBe(true);
  await runPaletteCommand(page, "Show plot");
  await expect.poll(async () => (await canvasTexts(page)).some((t) => /Mar 0?1, 2026/.test(t))).toBe(true);
  expect((await canvasTexts(page)).some((t) => /^1,?77\d/.test(t))).toBe(false); // no epoch seconds
  await runPaletteCommand(page, "Show worksheet");
  const grid = page.locator(".qzk-sheet");
  await expect(grid.getByRole("row").nth(1)).toContainText("2026-03-01 10:00:00");
  await expect(grid.getByRole("row").nth(1)).toContainText("S0");

  // 3. Export the worksheet as TSV (Long Name + Units rows), then import the
  //    file back: same names, units, text column and date X.
  await page.getByRole("button", { name: "⇩ Export…" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Export worksheet" });
  await dialog.getByLabel("Format").selectOption({ label: "TSV (tab-separated)" });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("ws-io-dates.tsv");
  const saved = test.info().outputPath(file.suggestedFilename()); // keep the .tsv name: import sniffs it
  await file.saveAs(saved);
  const tsv = (await readFile(saved)).toString("utf8").split("\n");
  expect(tsv.slice(0, 3)).toEqual(["Logged\tSample\tTemp", "\t\tC", "2026-03-01 10:00:00\tS0\t20"]);
  await dropFileOnto(page, library, saved, "text/tab-separated-values");
  await waitForDatasetCount(page, 3);
  await expect.poll(async () => (await shown(page)).isDate).toBe(true);
  expect(await shown(page)).toMatchObject({ labels: ["Temp"], units: ["C"], xName: "Logged", text: ["Sample"] });

  // 4. Two files as the sheets of ONE workbook, with sheet tabs.
  await chooseFiles(
    page,
    () => runPaletteCommand(page, "Import as sheets of one workbook…"),
    [fixturePath("ws-io-sheet-1.csv"), fixturePath("ws-io-sheet-2.csv")],
  );
  await waitForDatasetCount(page, 5);
  await expect.poll(async () => (await shown(page, -2)).workbookId).toBe((await shown(page, -1)).workbookId);
  await runPaletteCommand(page, "Show worksheet");
  const tabs = page.getByRole("tablist", { name: "Workbook sheets" }).getByRole("tab");
  await expect(tabs).toHaveText([/ws-io-sheet-1/, /ws-io-sheet-2/]);
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
});
