// Gap audit 9 G16 — text and date/time functions in worksheet formulas.
// text-date-log.csv has a text Sample column and a text Stamp column of ISO
// dates (one of them not a date). The user adds a column from a text function
// and one from a date function, and a text-valued formula is refused with a
// pointer. Checks read the worksheet's state through ?harness.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { classicLayout, gotoApp, waitForDatasetCount } from "../utils/harness";

// Owner decision 2026-11-26: the window layout is now the default. This spec drives the CLASSIC layout
// (stage tabs, side-column tool windows), so it opts in explicitly and keeps its coverage.
test.beforeEach(async ({ page }) => {
  await classicLayout(page);
});

type QzWindow = { __qz: { useApp: { getState: () => Record<string, unknown> } } };

const column = (page: Page, label: string): Promise<(number | null)[] | null> =>
  page.evaluate((name) => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState() as {
      activeId: string | null;
      datasets: { id: string; data: { labels: string[]; values: (number | null)[][] } }[];
    };
    const d = s.datasets.find((x) => x.id === s.activeId)!;
    const i = d.data.labels.indexOf(name);
    return i < 0 ? null : d.data.values.map((row) => row[i]);
  }, label);

async function addFormulaColumn(page: Page, formula: string, name: string): Promise<void> {
  await page.getByRole("textbox", { name: "Formula", exact: true }).fill(formula);
  await page.getByPlaceholder("column name").fill(name);
  await page.getByRole("button", { name: "Add column" }).click();
}

test("text and date functions make numeric columns; a text result is refused", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("text-date-log.csv"));
  await waitForDatasetCount(page, 1);
  await page.getByRole("tab", { name: "Worksheet" }).click();

  // Text: the unit in "NbFe 300K" -> 300; no unit -> blank.
  await addFormulaColumn(page, 'num(regex_extract(col("Sample"), "(\\d+)K", 1))', "Kelvin");
  await expect.poll(() => column(page, "Kelvin")).toEqual([300, 10, 77, Number.NaN]);
  await addFormulaColumn(page, 'len(col("Sample"))', "NameLen"); // Unicode: "café 77K" is 8
  await expect.poll(() => column(page, "NameLen")).toEqual([9, 14, 8, 3]);

  // Date: ISO text -> epoch seconds; weekday of it (1 = Sunday); bad date blank.
  await addFormulaColumn(page, 'parse_date(col("Stamp"))', "Epoch");
  await expect.poll(() => column(page, "Epoch")).toEqual([1772366400, 1709164800, 1773563400, Number.NaN]);
  await addFormulaColumn(page, "weekday(Epoch)", "Weekday");
  await expect.poll(() => column(page, "Weekday")).toEqual([1, 5, 1, Number.NaN]);
  await addFormulaColumn(page, 'datediff(parse_date("2026-01-01"), Epoch, "day")', "Days");
  await expect.poll(() => column(page, "Days")).toEqual([59.5, -672, 73.35416666666667, Number.NaN]);

  // A text-producing function at the top is refused, saying what to do.
  await addFormulaColumn(page, 'upper(col("Sample"))', "Shout");
  await expect(page.locator(".qzk-statusbar")).toContainText("upper() returns text");
});
