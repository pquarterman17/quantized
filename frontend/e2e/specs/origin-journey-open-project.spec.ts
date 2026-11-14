// Origin-replacement journey 1 — open an Origin project (.opj).
//
// An Origin user's first move is File > Open on a project. This spec makes a
// real .opj with the app's OWN writer (File > Export Origin project, the
// /api/export/opj route), then opens that file again exactly as a user would,
// and checks what an Origin user checks first: one Library row per book, the
// columns' long names and units, the yErr designation still bound as error
// bars (not drawn as a curve), and that picking a book retitles the window.
//
// Synthetic data only (e2e/fixtures); no corpus file is ever read here.

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface DatasetView {
  name: string;
  labels: string[];
  units: string[];
  xName: string | null;
  xUnit: string | null;
  rows: number;
}
interface Snapshot {
  activeName: string | null;
  datasets: DatasetView[];
  errKeys: Record<string, number>;
  hiddenChannels: number[];
}
type QzWindow = { __qz: { useApp: { getState: () => Record<string, unknown> } } };

/** Read-only store snapshot (?harness), for what the DOM can't say cleanly. */
const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState() as {
      activeId: string | null;
      errKeys: Record<string, number>;
      hiddenChannels: number[];
      datasets: {
        id: string;
        name: string;
        data: { time: number[]; labels: string[]; units: string[]; metadata?: Record<string, unknown> };
      }[];
    };
    return {
      activeName: s.datasets.find((d) => d.id === s.activeId)?.name ?? null,
      errKeys: s.errKeys,
      hiddenChannels: s.hiddenChannels,
      datasets: s.datasets.map((d) => ({
        name: d.name,
        labels: d.data.labels,
        units: d.data.units,
        // Origin's X long name (x_column_name is its short name, "A").
        xName: (d.data.metadata?.x_column_long as string | undefined) ?? null,
        xUnit: (d.data.metadata?.x_column_unit as string | undefined) ?? null,
        rows: d.data.time.length,
      })),
    };
  });

test("a project written by the Origin exporter opens again as books with names, units and yErr", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  const library = page.locator(".qzk-library");
  await dropFileOnto(page, library, fixturePath("decay-err.csv"));
  await waitForDatasetCount(page, 1);
  await dropFileOnto(page, library, fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 2);

  // File > Export Origin project (.opj)… with nothing multi-selected writes
  // every loaded dataset, one workbook each.
  const download = page.waitForEvent("download");
  await runPaletteCommand(page, "Export Origin project (.opj)…");
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.opj$/);
  const opjPath = testInfo.outputPath("journey.opj");
  await file.saveAs(opjPath);
  await expect(page.locator(".qzk-statusbar")).toContainText("exported Origin project (2 books)");
  // A real Origin project file, not an error page.
  const head = (await readFile(opjPath)).subarray(0, 4).toString("latin1");
  expect(head).toBe("CPYA");

  // Open it: the two books come back next to the originals. (Counted in the
  // store: the Library folds a project's non-active books, so their rows are
  // not all in the DOM.)
  await dropFileOnto(page, library, opjPath, "application/octet-stream");
  await expect.poll(async () => (await snapshot(page)).datasets.length, { timeout: 15_000 }).toBe(4);
  const reopened = (await snapshot(page)).datasets.slice(2);
  const decay = reopened.find((d) => d.labels.includes("signal"));
  const twoChannel = reopened.find((d) => d.labels.includes("Resistance"));
  expect(decay, JSON.stringify(reopened)).toBeDefined();
  expect(twoChannel, JSON.stringify(reopened)).toBeDefined();
  // Long names, units, X column and every row survive the round trip.
  expect(decay!.labels).toEqual(["signal", "err"]);
  expect(decay!.rows).toBe(41);
  expect(twoChannel!.labels).toEqual(["Resistance", "Voltage"]);
  expect(twoChannel!.units).toEqual(["ohm", "V"]);
  expect(twoChannel!.xName).toBe("Temperature");
  expect(twoChannel!.xUnit).toBe("K");
  expect(twoChannel!.rows).toBe(11);
  // Each reopened book is an Origin book row in the Library, under the
  // project's book family. The family card and the Origin-fidelity section
  // arrive after the books land (they used to be inserted ABOVE the rows and
  // move them under the pointer; since re-audit #9 they render below), so
  // wait for both before clicking a row. The "Origin book" badge is ATTACHED,
  // not visible: a Library this narrow hides it so the name keeps the room
  // (re-audit #10), and the row's name tooltip carries it instead.
  await expect(library.getByText("Origin book").first()).toBeAttached();
  await expect(library.getByRole("button", { name: "Manage…" })).toBeVisible();
  await expect(library.getByText("Origin fidelity", { exact: true })).toBeVisible();

  // Opening a project shows its first book: the yErr column is whiskers on
  // signal, not a second curve.
  await expect.poll(async () => (await snapshot(page)).activeName).toBe(decay!.name);
  const opened = await snapshot(page);
  expect(opened.errKeys).toEqual({ 0: 1 });
  expect(opened.hiddenChannels).toEqual([1]);
  await expect(page.locator(".qzk-statusbar")).toContainText(decay!.name);

  // Switch the plot to another sheet, then double-click the reopened decay
  // sheet: like Origin, that opens the workbook — its worksheet, with the
  // designations in the header — and the title and status bars name it.
  const rows = page.locator("[data-ds-id]");
  await rows.filter({ hasText: "two-channel.csv" }).first().dblclick();
  await expect.poll(async () => (await snapshot(page)).activeName).toBe("two-channel.csv");
  await expect(page.locator(".qzk-statusbar")).toContainText("two-channel.csv");
  await rows.filter({ hasText: decay!.name }).first().dblclick();
  await expect(page.getByRole("tab", { name: "Worksheet" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".qzk-statusbar")).toContainText(decay!.name);
  await expect(page.locator(".qzk-titlebar")).toContainText(decay!.name);
  const headers = page.locator("[role=columnheader]");
  await expect(headers.filter({ hasText: "signal" }).first()).toContainText("Y");
  await expect(headers.filter({ hasText: "err" }).first()).toContainText("yEr"); // shown upper-cased by CSS
  // The X column: its name, then its designation ("t" + "X" in textContent).
  await expect(headers.filter({ hasText: /^tX/ })).toHaveCount(1);
});
