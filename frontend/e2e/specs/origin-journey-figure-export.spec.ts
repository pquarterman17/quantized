// Origin-replacement journey 2 — style a graph and export a publication
// figure (vector PDF / SVG) that matches the screen.
//
// The Origin user's path: type the axis titles with Origin's rich-text
// escapes (\-( ) subscript, \+( ) superscript, \g( ) Greek), set a line width,
// then File > Export figure with an explicit size. Checked: the escapes render
// on screen, the export request carries exactly what the screen shows, the
// SVG is the requested physical size with the escapes rendered (not literal
// backslashes) and its text kept as editable text, and the PDF is a real PDF
// carrying the same title and axis titles. A second import must not wipe the
// first graph's styling (figures audit B1).

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface FigureBody {
  title?: string;
  x_label?: string;
  y_label?: string;
  fmt?: string;
  y_keys?: number[];
  series_styles?: ({ width?: number } | null)[];
}

type QzWindow = { __qz: { useApp: { getState: () => Record<string, unknown> } } };
const activeName = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState() as {
      activeId: string | null;
      datasets: { id: string; name: string }[];
    };
    return s.datasets.find((d) => d.id === s.activeId)?.name ?? null;
  });

const TITLE = "Decay of signal";
const X_LABEL = "t\\-(w) (s)"; // Origin: subscript w
const Y_LABEL = "\\g(m)\\-(0)M\\+(2) (mV)"; // Origin: Greek mu, subscript 0, superscript 2

async function exportAs(page: Page, fmt: "pdf" | "svg"): Promise<{ body: FigureBody; bytes: Buffer }> {
  await runPaletteCommand(page, "Export figure…");
  const dialog = page.getByRole("dialog", { name: "Export figure" });
  await expect(dialog).toBeVisible();
  // The dialog starts from the screen's own titles.
  await expect(dialog.getByLabel("Title")).toHaveValue(TITLE);
  await expect(dialog.getByLabel("X label")).toHaveValue(X_LABEL);
  await expect(dialog.getByLabel("Y label")).toHaveValue(Y_LABEL);
  await dialog.getByLabel("Format").selectOption(fmt);
  await dialog.getByLabel("Unit").selectOption("in");
  await dialog.getByLabel("Width").fill("3.4");
  await dialog.getByLabel("Height").fill("2.6");
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const body = (await request).postDataJSON() as FigureBody;
  const file = await download;
  expect(file.suggestedFilename()).toBe(`decay-err.${fmt}`);
  return { body, bytes: await readFile(await file.path()) };
}

test("a styled graph exports to PDF and SVG exactly as shown", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  const library = page.locator(".qzk-library");
  await dropFileOnto(page, library, fixturePath("decay-err.csv"));
  await waitForDatasetCount(page, 1);

  // Titles & labels, typed the Origin way.
  await page.getByText("Titles & labels", { exact: true }).click();
  for (const [name, value] of [
    ["Plot title", TITLE],
    ["Plot X label", X_LABEL],
    ["Plot Y label", Y_LABEL],
  ] as const) {
    const box = page.getByRole("textbox", { name, exact: true });
    await box.fill(value);
    await box.press("Enter");
  }
  // The escapes render on screen, never as literal backslash codes. The
  // axis titles are drawn on the plot canvas, so the DOM evidence is the
  // inspector's live preview under each box, which shares the renderer.
  const plotArea = page.locator(".qzk-stage");
  await expect(plotArea.getByText(TITLE, { exact: true }).first()).toBeVisible();
  const preview = page.getByRole("complementary");
  await expect(preview.getByText("μ", { exact: true })).toBeVisible();
  await expect(preview.locator("sub", { hasText: "w" })).toBeVisible();
  await expect(preview.locator("sup", { hasText: "2" })).toBeVisible();

  // Series style: a 3 px line for "signal".
  await page.getByText("Series style", { exact: true }).click();
  await page.getByText("signal", { exact: true }).last().click();
  const width = page.getByLabel("Line width").first();
  await width.fill("3");
  await width.press("Enter");

  // SVG: the requested size, the screen's titles and style, escapes rendered.
  const svg = await exportAs(page, "svg");
  expect(svg.body).toMatchObject({ fmt: "svg", title: TITLE, x_label: X_LABEL, y_label: Y_LABEL, y_keys: [0] });
  expect(svg.body.series_styles?.[0]).toMatchObject({ width: 3 });
  const text = svg.bytes.toString("utf8");
  expect(text).toMatch(/<svg[^>]*width="244\.8pt"[^>]*height="187\.2pt"/); // 3.4 in x 2.6 in at 72 pt/in
  expect(text).toContain(TITLE);
  expect(text).toContain("μ"); // \g(m) became mu
  expect(text).not.toContain("\\g(");
  expect(text).toMatch(/<text[\s>]/); // text stays editable text, not outlines
  // The error column is whiskers on signal, never its own legend entry.
  expect(text).not.toMatch(/<!-- err -->/);

  // PDF: a real vector PDF of the same figure.
  const pdf = await exportAs(page, "pdf");
  expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect({ ...pdf.body, fmt: "svg" }).toEqual(svg.body);

  // A second import, then back: the first graph keeps its styling.
  await dropFileOnto(page, library, fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 2);
  await expect.poll(() => activeName(page)).toBe("two-channel.csv");
  await page.locator("[data-ds-id]").filter({ hasText: "decay-err.csv" }).dblclick();
  await expect.poll(() => activeName(page)).toBe("decay-err.csv");
  await expect(page.getByRole("textbox", { name: "Plot title", exact: true })).toHaveValue(TITLE);
  await expect(plotArea.getByText(TITLE, { exact: true }).first()).toBeVisible();
});
