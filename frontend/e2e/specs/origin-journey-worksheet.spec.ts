// Origin-replacement journey 4 — worksheet operations.
//
// origin-quoted-long.csv is long-form data the way instruments and Excel
// write it: a text Sample column, quoted numbers with thousands separators,
// and an uncertainty column whose name does not say "err". The Origin user:
// imports it, sets the uncertainty column As Y Error, sorts the worksheet and
// undoes it, adds formula columns (col() by long name, and sheet() reading
// another worksheet), sees a bad reference reported, adds row statistics and
// unstacks Sample into one column per sample. All checks read the worksheet's
// state, not mock calls.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface Sheet {
  name: string;
  labels: string[];
  /** Column-major: values[c][r] for column c (labels[c]). */
  cols: (number | null)[][];
  designations: Record<string, string>;
  errKeys: Record<string, number>;
  count: number;
}
type QzWindow = { __qz: { useApp: { getState: () => Record<string, unknown> } } };

/** The active worksheet, read-only via ?harness. */
const sheet = (page: Page): Promise<Sheet> =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState() as {
      activeId: string | null;
      errKeys: Record<string, number>;
      datasets: {
        id: string;
        name: string;
        columnDesignations?: Record<string, string>;
        data: { labels: string[]; values: (number | null)[][] };
      }[];
    };
    const d = s.datasets.find((x) => x.id === s.activeId)!;
    return {
      name: d.name,
      labels: d.data.labels,
      cols: d.data.labels.map((_, c) => d.data.values.map((row) => row[c])),
      designations: d.columnDesignations ?? {},
      errKeys: s.errKeys,
      count: s.datasets.length,
    };
  });

/** One column's values by long name; `null` while it does not exist yet (so
 *  `expect.poll` keeps polling instead of failing on the first read). */
const col = async (page: Page, label: string): Promise<(number | null)[] | null> => {
  const s = await sheet(page);
  const i = s.labels.indexOf(label);
  return i < 0 ? null : s.cols[i];
};

async function addFormulaColumn(page: Page, formula: string, name: string): Promise<void> {
  await page.getByRole("textbox", { name: "Formula", exact: true }).fill(formula);
  await page.getByPlaceholder("column name").fill(name);
  await page.getByRole("button", { name: "Add column" }).click();
}

const MOMENT = [1000.5, 2000.25, 1500, 2500.75, 1250, 3100];

test("Origin worksheet operations: Set As, sort + undo, formulas, row statistics, unstack", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  const library = page.locator(".qzk-library");
  await dropFileOnto(page, library, fixturePath("origin-offsets.csv"));
  await waitForDatasetCount(page, 1);
  await dropFileOnto(page, library, fixturePath("origin-quoted-long.csv"));
  await waitForDatasetCount(page, 2);
  await expect.poll(async () => (await sheet(page)).name).toBe("origin-quoted-long.csv");

  // Quoted "1,000.5" cells are numbers, and the import says so.
  expect(await col(page, "Moment")).toEqual(MOMENT);
  await expect(page.locator(".qzk-statusbar")).toContainText("thousands separators");

  await page.getByRole("tab", { name: "Worksheet" }).click();
  const header = (text: string) => page.locator("[role=columnheader]").filter({ hasText: text }).first();

  // Column > Set As > Y Error on "Noise": it becomes Moment's error bar.
  await header("Noise").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Set As", exact: true }).hover();
  await page.getByRole("menuitemcheckbox", { name: "Y Error", exact: true }).click();
  await expect.poll(async () => (await sheet(page)).designations).toMatchObject({ 2: "Y-error" });
  await expect.poll(async () => (await sheet(page)).errKeys).toEqual({ 1: 2 });
  await expect(header("Noise")).toContainText("yEr");

  // Sort the worksheet (rows move) by Moment, descending; Undo puts it back.
  await header("Moment").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sort descending", exact: true }).click();
  await expect.poll(() => col(page, "Moment")).toEqual([...MOMENT].sort((a, b) => b - a));
  expect((await col(page, "Noise"))?.[0]).toBe(9); // whole rows moved, not one column
  await page.keyboard.press("Control+z");
  await expect.poll(() => col(page, "Moment")).toEqual(MOMENT);

  // Set Column Values: col() by long name, then sheet() reading another book.
  await addFormulaColumn(page, 'col("Moment") * 2', "Double");
  await expect.poll(() => col(page, "Double")).toEqual(MOMENT.map((m) => m * 2));
  await addFormulaColumn(page, 'col("Moment") - sheet("origin-offsets.csv", A)', "Corrected");
  await expect.poll(() => col(page, "Corrected")).toEqual(MOMENT.map((m, i) => m - 10 * (i + 1)));

  // A reference to a column that does not exist is reported, not silent.
  await addFormulaColumn(page, 'sheet("origin-offsets.csv", Z)', "Broken");
  await expect(page.locator(".qzk-statusbar")).toContainText('worksheet "origin-offsets.csv" has no column Z');
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await sheet(page)).labels).not.toContain("Broken");

  // Row statistics across Temp and Moment.
  await runPaletteCommand(page, "Row statistics");
  const rowStats = page.getByRole("dialog", { name: "Row statistics" });
  await expect(rowStats).toBeVisible();
  for (const name of [/Temp/, /Moment/, /Row mean/, /Row max/]) {
    await rowStats.getByRole("checkbox", { name }).check();
  }
  await rowStats.getByRole("button", { name: "Add columns" }).click();
  const temp = [100, 100, 200, 200, 300, 300];
  await expect.poll(() => col(page, "Row mean")).toEqual(MOMENT.map((m, i) => (m + temp[i]) / 2));
  expect(await col(page, "Row max")).toEqual(MOMENT);

  // Unstack: one Moment column per Sample, keyed by Temp.
  const before = (await sheet(page)).count;
  await runPaletteCommand(page, "Unstack / pivot to wide form…");
  const reshape = page.locator(".qzk-win").filter({ has: page.getByText("Reshape & combine", { exact: true }) });
  await expect(reshape).toBeVisible();
  await reshape.getByRole("combobox", { name: "Row key" }).selectOption({ label: "Temp" });
  await reshape.getByRole("combobox", { name: "Category column" }).selectOption({ label: "Sample (text levels)" });
  await reshape.getByRole("combobox", { name: "Value column" }).selectOption({ label: "Moment" });
  await expect(reshape).toContainText("3 rows × 2 columns");
  await reshape.getByRole("button", { name: "Create" }).click();
  await expect.poll(async () => (await sheet(page)).count).toBe(before + 1);
  const wide = await sheet(page);
  expect(wide.name).toContain("unstacked");
  expect(wide.cols).toEqual([
    [1000.5, 1500, 1250],
    [2000.25, 2500.75, 3100],
  ]);
});
