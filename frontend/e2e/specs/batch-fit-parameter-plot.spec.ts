// UX9-C ("Batch fit -> plot a parameter vs X"). The audit's job: five decays
// at five temperatures -> tau vs T. Before: Fit fitted only the active sheet,
// the batch hid under a collapsed Advanced section, ran active-first, and the
// summary plotted all eight columns on one axis. Now: select 5, "Fit 5
// worksheets", Run, "Plot ▸ τ" -- tau (R² on the right axis) against
// "Temperature (K)", in Library order.

import fs from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

const TEMPS = [10, 50, 100, 200, 300];
const name = (t: number) => `decay_${String(t).padStart(3, "0")}K.csv`;

function writeDecays(dir: string): { name: string; text: string }[] {
  fs.mkdirSync(dir, { recursive: true });
  return TEMPS.map((t) => {
    const tau = 2 + t / 50;
    const rows = Array.from({ length: 60 }, (_, i) => {
      const x = i * 0.25;
      return `${x},${(3 * Math.exp(-x / tau) + 0.2).toFixed(6)}`;
    });
    const text = ["t (s),signal (a.u.)", ...rows].join("\n") + "\n";
    fs.writeFileSync(path.join(dir, name(t)), text);
    return { name: name(t), text };
  });
}

type Plot = { active: string | null; y: string[]; y2: string[]; xKey: number | null; xName: unknown; xUnit: unknown; names: string[] };
const plotState = (page: Page): Promise<Plot> => page.evaluate(() => {
  const s = (window as unknown as { __qz: { useApp: { getState: () => {
    activeId: string | null; yKeys: number[] | null; y2Keys: number[] | null; xKey: number | null;
    datasets: { id: string; name: string; data: { labels: string[]; metadata: Record<string, unknown> } }[];
  } } } }).__qz.useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  const label = (k: number) => ds?.data.labels[k] ?? "";
  return {
    active: ds?.name ?? null,
    y: (s.yKeys ?? []).map(label), y2: (s.y2Keys ?? []).map(label), xKey: s.xKey,
    xName: ds?.data.metadata["x_column_name"], xUnit: ds?.data.metadata["x_column_unit"],
    names: s.datasets.map((d) => d.name),
  };
});

test("five decays -> Fit 5 worksheets -> Run -> Plot tau: tau (R² on Y2) vs Temperature (K)", async ({ page }, info) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  const files = writeDecays(info.outputPath("decays"));
  const dataTransfer = await page.evaluateHandle((items) => {
    const dt = new DataTransfer();
    for (const it of items) dt.items.add(new File([it.text], it.name, { type: "text/csv" }));
    return dt;
  }, files);
  const lib = page.locator(".qzk-library");
  await lib.dispatchEvent("dragenter", { dataTransfer });
  await lib.dispatchEvent("dragover", { dataTransfer });
  await lib.dispatchEvent("drop", { dataTransfer });
  await waitForDatasetCount(page, 5);

  // Select all five with the LAST row active (the batch must still list them in Library order).
  const rows = page.locator("[data-ds-id]");
  await rows.first().click();
  await rows.last().click({ modifiers: ["Shift"] });
  await expect(page.locator(".qzk-multiselect-bar").getByText("5 selected")).toBeVisible();

  await runPaletteCommand(page, "Curve fit…");
  const panel = page.locator(".qzk-win").filter({ has: page.getByText("Curve Fit", { exact: true }) });
  await expect(panel).toBeVisible();
  await panel.getByRole("combobox", { name: "Model", exact: true }).selectOption({ value: "Exponential Decay" });

  // Action 1: the primary button names the batch and opens it.
  await panel.getByRole("button", { name: "Fit 5 worksheets" }).click();
  // The batch table lists the files in Library order.
  const listed = panel.locator(".qzk-analysis-batch-table tbody tr td:first-child");
  await expect(listed).toHaveText(TEMPS.map(name));
  // Action 2: Run.
  await panel.getByRole("button", { name: /^Run Curve Fit .* batch$/ }).click();
  // Action 3: Plot ▸ tau.
  await panel.getByRole("group", { name: /Plot a fitted parameter/ }).getByRole("button", { name: "τ", exact: true }).click();

  await expect.poll(async () => (await plotState(page)).y).toEqual(["τ"]);
  const p = await plotState(page);
  expect(p.active).toContain("Curve Fit summary");
  expect(p.y2).toEqual(["R²"]);
  expect(p.xKey).toBeNull();
  expect(p.xName).toBe("Temperature");
  expect(p.xUnit).toBe("K");
  // The axis title is canvas-drawn from this metadata (plotdata.buildColumns; unit-tested).
});
