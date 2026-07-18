// Real-browser publication-export round trip (GUI_INTERACTION #15): Graph
// Builder intent -> Figure Builder preview -> real FastAPI/matplotlib download
// -> saved FigureDoc reopen -> identical request. No mocked fetch/downloads.

import { readFile } from "node:fs/promises";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface FigureBody {
  x_key?: number;
  y_keys?: number[];
  title?: string;
  x_label?: string;
  y_label?: string;
  fmt?: string;
  filename?: string;
  series_styles?: ({ color?: string; width?: number; line?: string; marker?: boolean; marker_size?: number } | null)[];
}

const MIME = { pdf: "application/pdf", svg: "image/svg+xml", png: "image/png" } as const;

function wellByTitle(page: Page, title: string): Locator {
  return page.locator(".qzk-zone-well").filter({ has: page.getByText(title, { exact: true }) });
}

async function openGraphBuilder(page: Page): Promise<Locator> {
  // Curated action (commands/analysisCommands.ts) — immune to the registry-
  // publish race `runPaletteCommand` guards against, but shares the driver
  // for consistency; see utils/palette.ts.
  await runPaletteCommand(page, "Graph Builder");
  const builder = page.locator(".qzk-win").filter({ has: page.getByText("Graph Builder", { exact: true }) });
  await expect(builder).toBeVisible();
  return builder;
}

async function buildOrderedXY(page: Page): Promise<Locator> {
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);
  const builder = await openGraphBuilder(page);
  await builder.getByLabel("Assign a channel to X").selectOption({ label: "Resistance" });
  await builder.getByLabel("Assign a channel to Y").selectOption({ label: "Voltage" });
  await builder.getByLabel("Assign a channel to Y").selectOption({ label: "Resistance" });
  await builder.getByRole("button", { name: "Move Resistance earlier" }).click();
  const chips = wellByTitle(page, "Y").locator(".qzk-zone-chip");
  await expect(chips.nth(0)).toContainText("Resistance");
  await expect(chips.nth(1)).toContainText("Voltage");
  return builder;
}

function figureRequest(page: Page, path: "figure" | "figure-hitmap") {
  return page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === `/api/export/${path}`,
  );
}

async function exportFormat(
  page: Page,
  builder: Locator,
  fmt: keyof typeof MIME,
): Promise<{ body: FigureBody; bytes: Buffer; filename: string }> {
  await builder.locator("select").first().selectOption(fmt);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/export/figure",
  );
  const downloadPromise = page.waitForEvent("download");
  await builder.getByRole("button", { name: `Export ${fmt.toUpperCase()}` }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain(MIME[fmt]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const filename = download.suggestedFilename();
  expect(filename).toBe(`two-channel.${fmt}`);
  return { body: response.request().postDataJSON() as FigureBody, bytes, filename };
}

function expectSignature(fmt: keyof typeof MIME, bytes: Buffer): void {
  if (fmt === "pdf") expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  else if (fmt === "png") expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  else expect(bytes.subarray(0, 500).toString("utf8")).toContain("<svg");
}

test("ordered scatter survives Figure Builder save/reopen and real PDF/SVG/PNG downloads", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  const graphBuilder = await buildOrderedXY(page);

  // Add visible style evidence before the Graph Builder creates its ephemeral
  // FigureDoc. Scatter must override only connection mode, not width/colour.
  await page.evaluate(() => {
    const qz = (window as unknown as { __qz: { useApp: { setState: (v: unknown) => void } } }).__qz;
    qz.useApp.setState({
      seriesStyles: {
        0: { color: "#3366cc", width: 3 },
        1: { color: "#cc6633", marker: true, markerSize: 7 },
      },
    });
  });

  const initialPreview = figureRequest(page, "figure-hitmap");
  await graphBuilder.getByRole("button", { name: "Figure Builder" }).click();
  const initialBody = (await initialPreview).postDataJSON() as FigureBody;
  expect(initialBody.x_key).toBe(0);
  expect(initialBody.y_keys).toEqual([0, 1]);
  expect(initialBody.series_styles?.[0]).toMatchObject({ color: "#3366cc", width: 3, line: "none", marker: true });
  expect(initialBody.series_styles?.[1]).toMatchObject({ color: "#cc6633", line: "none", marker: true, marker_size: 7 });

  const figureBuilder = page.locator(".qzk-win").filter({ has: page.getByText("Figure builder", { exact: true }) });
  await expect(figureBuilder).toBeVisible();
  await figureBuilder.getByPlaceholder("(none)").fill("Round-trip figure");
  const autoLabels = figureBuilder.getByPlaceholder("auto");
  await autoLabels.nth(0).fill("Applied field");
  const labeledPreview = figureRequest(page, "figure-hitmap");
  await autoLabels.nth(1).fill("Response");
  await labeledPreview;

  const firstPdf = await exportFormat(page, figureBuilder, "pdf");
  expectSignature("pdf", firstPdf.bytes);
  expect(firstPdf.body).toMatchObject({
    x_key: 0,
    y_keys: [0, 1],
    title: "Round-trip figure",
    x_label: "Applied field",
    y_label: "Response",
    fmt: "pdf",
    filename: "two-channel",
  });

  const name = figureBuilder.getByPlaceholder("name");
  await name.fill("Saved round trip");
  await name.locator("..").getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { figureDocs: unknown[] } } } }).__qz.useApp.getState().figureDocs.length,
  )).toBe(1);
  await figureBuilder.getByTitle("Close").click();

  const reopenedPreview = figureRequest(page, "figure-hitmap");
  await page.getByTitle('open figure "Saved round trip"').click();
  await reopenedPreview;
  const reopenedBuilder = page.locator(".qzk-win").filter({ has: page.getByText("Figure builder", { exact: true }) });
  const reopenedPdf = await exportFormat(page, reopenedBuilder, "pdf");
  expectSignature("pdf", reopenedPdf.bytes);
  expect(reopenedPdf.body).toEqual(firstPdf.body);

  for (const fmt of ["svg", "png"] as const) {
    const out = await exportFormat(page, reopenedBuilder, fmt);
    expectSignature(fmt, out.bytes);
    expect(out.body).toMatchObject({ ...firstPdf.body, fmt });
  }
});

test("connected line and line-plus-marker styles remain connected", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  const graphBuilder = await buildOrderedXY(page);
  await page.evaluate(() => {
    const qz = (window as unknown as { __qz: { useApp: { setState: (v: unknown) => void } } }).__qz;
    qz.useApp.setState({ seriesStyles: { 0: { line: "dashed", marker: true, markerSize: 6 } } });
  });
  await graphBuilder.getByRole("button", { name: /cycle/ }).click(); // scatter -> line
  const preview = figureRequest(page, "figure-hitmap");
  await graphBuilder.getByRole("button", { name: "Figure Builder" }).click();
  const body = (await preview).postDataJSON() as FigureBody;
  expect(body.y_keys).toEqual([0, 1]);
  expect(body.series_styles?.[0]).toMatchObject({ line: "dashed", marker: true, marker_size: 6 });
  expect(body.series_styles?.[0]?.line).not.toBe("none");
  expect(body.series_styles?.[1]?.line).not.toBe("none");
});
