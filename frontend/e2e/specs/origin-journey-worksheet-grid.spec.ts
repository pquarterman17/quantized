// Origin-replacement journey — typing a table into a new worksheet.
//
// The daily Origin workflow the worksheet audit found missing: File > New
// workbook, click a cell and TYPE (Enter moves down, Tab moves right, typing
// below the last row grows the sheet), edit the Long Name / Units / Comments
// header rows, add / insert / move / delete columns and move rows, paste a
// TSV block that runs off the bottom, set a column's number format, sort the
// worksheet — each one undoable. Every check reads the worksheet's state (via
// ?harness), never a timer.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "../utils/harness";

interface Sheet {
  name: string;
  x: (number | null)[];
  labels: string[];
  units: string[];
  /** Column-major: cols[c][r]. */
  cols: (number | null)[][];
  props: Record<string, { comment?: string; format?: { kind: string; digits: number } }>;
  count: number;
}
type QzWindow = { __qz: { useApp: { getState: () => Record<string, unknown> } } };

/** The worksheet on screen (worksheetId ?? activeId), read-only via ?harness. */
const sheet = (page: Page): Promise<Sheet> =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState() as {
      activeId: string | null;
      worksheetId: string | null;
      datasets: {
        id: string;
        name: string;
        columnProps?: Sheet["props"];
        data: { time: (number | null)[]; labels: string[]; units: string[]; values: (number | null)[][] };
      }[];
    };
    const d = s.datasets.find((x) => x.id === (s.worksheetId ?? s.activeId));
    // Nothing open yet: an empty sheet, so `expect.poll` keeps polling.
    if (!d) return { name: "", x: [], labels: [], units: [], cols: [], props: {}, count: s.datasets.length };
    return {
      name: d.name,
      x: d.data.time.map((v) => (Number.isFinite(v) ? v : null)),
      labels: d.data.labels,
      units: d.data.units,
      cols: d.data.labels.map((_, c) => d.data.values.map((row) => (Number.isFinite(row[c]) ? row[c] : null))),
      props: d.columnProps ?? {},
      count: s.datasets.length,
    };
  });

/** Display row `pos`, column `col` (-1 = X) of the grid. */
const cell = (page: Page, pos: number, col: number) => page.locator(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`);
const header = (page: Page, col: number) => page.locator(`[role=columnheader][data-col="${col}"]`);

test("Origin worksheet grid: new workbook, typing, headers, columns, rows, paste, format, sort", async ({ page, context, browserName }) => {
  test.setTimeout(90_000);
  await gotoApp(page);

  // File > New workbook opens an empty worksheet.
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New workbook" }).click();
  await expect.poll(async () => (await sheet(page)).name).toBe("Book1");
  expect((await sheet(page)).x).toHaveLength(32);

  // Type a 4-row table: Tab right, Enter down, Home back to X.
  await cell(page, 0, -1).click();
  for (const [x, y] of [[1, 10], [2, 20.5], [3, 31], [4, 39.9]]) {
    await page.keyboard.type(String(x));
    await page.keyboard.press("Tab");
    await page.keyboard.type(String(y));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Home");
  }
  await expect.poll(async () => (await sheet(page)).x.slice(0, 4)).toEqual([1, 2, 3, 4]);
  expect((await sheet(page)).cols[0].slice(0, 4)).toEqual([10, 20.5, 31, 39.9]);
  await expect(page.getByRole("grid")).toBeFocused();

  // A word in a numeric cell is refused; Escape cancels an F2 edit.
  await cell(page, 0, 0).click();
  await page.keyboard.type("abc");
  await page.keyboard.press("Enter");
  await expect(page.locator(".qzk-statusbar")).toContainText('"abc" is not a number');
  await page.keyboard.press("Escape");
  await page.keyboard.press("F2");
  await page.keyboard.type("999");
  await page.keyboard.press("Escape");
  expect((await sheet(page)).cols[0][0]).toBe(10);

  // Edit the header rows in place.
  await header(page, 0).dblclick();
  await page.getByRole("textbox", { name: "Long Name, A" }).fill("Signal");
  await page.getByRole("textbox", { name: "Units, A" }).fill("mV");
  await page.getByRole("textbox", { name: "Comments, A" }).fill("sample 1");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sheet(page)).labels).toEqual(["Signal"]);
  expect((await sheet(page)).units).toEqual(["mV"]);
  expect((await sheet(page)).props).toEqual({ 0: { comment: "sample 1" } });
  await expect(header(page, 0)).toContainText("sample 1");

  // Add a column, insert one before Signal, move Signal last, undo, delete.
  await header(page, 0).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add new column" }).click();
  await expect.poll(async () => (await sheet(page)).labels).toEqual(["Signal", "B"]);
  await header(page, 0).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert column" }).click();
  await expect.poll(async () => (await sheet(page)).labels).toEqual(["A", "Signal", "B"]);
  await header(page, 1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move column" }).hover();
  await page.getByRole("menuitem", { name: "Move to last" }).click();
  await expect.poll(async () => (await sheet(page)).labels).toEqual(["A", "B", "Signal"]);
  expect((await sheet(page)).props).toEqual({ 2: { comment: "sample 1" } }); // the comment moved with it
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await sheet(page)).labels).toEqual(["A", "Signal", "B"]);
  await header(page, 0).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete column" }).click();
  await expect.poll(async () => (await sheet(page)).labels).toEqual(["Signal", "B"]);

  // Paste a TSV block at the last row: the sheet grows to take it, one undo.
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("5\t50\t500\n6\t60\t600\n7\t70\t700\n"));
    await page.getByRole("grid").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Home");
    await expect(cell(page, 31, -1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await sheet(page)).x.slice(-3)).toEqual([5, 6, 7]);
    const pasted = await sheet(page);
    expect(pasted.x).toHaveLength(34);
    expect(pasted.cols[1].slice(-3)).toEqual([500, 600, 700]);
    expect(pasted.count).toBe(1); // no "pasted data" dataset on the side
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await sheet(page)).x).toHaveLength(32);
  }

  // Number format: display only.
  await header(page, 0).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Number format…" }).click();
  const fmt = page.getByRole("dialog", { name: "Number format" });
  await fmt.getByRole("combobox", { name: "Display" }).selectOption({ label: "Decimal places" });
  await fmt.getByLabel("Digits").fill("1");
  await fmt.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("grid").focus();
  await page.keyboard.press("Control+Home");
  await expect(cell(page, 1, 0)).toHaveText("20.5");
  await expect(cell(page, 2, 0)).toHaveText("31.0");
  expect((await sheet(page)).cols[0][3]).toBe(39.9);

  // Sort the worksheet by Signal, descending; undo restores the order.
  await header(page, 0).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sort worksheet…" }).click();
  const sort = page.getByRole("dialog", { name: "Sort worksheet" });
  await sort.getByRole("combobox", { name: "Sort by" }).selectOption({ label: "A — Signal" });
  await sort.getByRole("combobox", { name: "Order", exact: true }).selectOption({ label: "Descending" });
  await sort.getByRole("button", { name: "Sort" }).click();
  await expect.poll(async () => (await sheet(page)).x.slice(0, 4)).toEqual([4, 3, 2, 1]);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await sheet(page)).x.slice(0, 4)).toEqual([1, 2, 3, 4]);

  // Rows: insert one above row 2, then move row 1 down.
  await page.locator("[role=row]").nth(2).locator("[role=rowheader]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert row above" }).click();
  await expect.poll(async () => (await sheet(page)).x.slice(0, 3)).toEqual([1, null, 2]);
  await page.locator("[role=row]").nth(1).locator("[role=rowheader]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move row" }).hover();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  await expect.poll(async () => (await sheet(page)).x.slice(0, 3)).toEqual([null, 1, 2]);
});
