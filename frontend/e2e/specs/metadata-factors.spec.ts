// Metadata → factors (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5), end to end against
// the real backend's Quantum Design parser: two synthetic MPMS files carry
// `INFO,S1,sample` / `INFO,S2,sample` header lines, which the parser keeps in
// the `instrument` metadata sidecar. Select both in the Library, open
// "Metadata → factors…" from the row's context menu, preview and promote
// `sample` to a factor column, then merge the two (with the source column):
// every merged row still says which sample — and which file — it came from.
// The two files are synthetic, a few lines each, and are WRITTEN BY THE SPEC
// (the repo's .gitignore keeps every `.dat` out of git as instrument data).

import fs from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

/** A minimal Quantum Design MPMS file whose header names its sample. */
function qdFile(name: string, sample: string): string {
  const file = test.info().outputPath(name);
  const lines = [
    "[Header]",
    "; MPMS3 Data File (default extension .dat)",
    "TITLE,",
    "BYAPP,SQUID VSM,1.0",
    `INFO,${sample},sample`,
    "[Data]",
    "Comment,Time Stamp (sec),Temperature (K),Magnetic Field (Oe),Moment (emu)",
    ",1000.0,300.0,5000.0,0.000121",
    ",1001.5,300.0,0.0,0.000001",
    ",1003.0,300.0,-5000.0,-0.000121",
  ];
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

interface DS {
  id: string;
  name: string;
  data: { labels: string[]; values: number[][]; cat_levels?: Record<string, string[]> };
}

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => Record<string, unknown> } } }).__qz.useApp.getState() as {
      datasets: DS[];
      selectedIds: string[];
    };
    return { datasets: s.datasets, selectedIds: s.selectedIds };
  });

/** A categorical column's per-row level text. */
const levelsOf = (d: DS, label: string): string[] => {
  const c = d.data.labels.indexOf(label);
  return d.data.values.map((r) => d.data.cat_levels![String(c)][r[c]]);
};

test.describe("Metadata → factors (P2.5)", () => {
  test("select 2 datasets → promote `sample` → merge → the merged rows keep their sample", async ({ page }) => {
    await gotoApp(page);
    const library = page.locator(".qzk-library");
    await dropFileOnto(page, library, qdFile("sample-s1.dat", "S1"));
    await waitForDatasetCount(page, 1);
    await dropFileOnto(page, library, qdFile("sample-s2.dat", "S2"));
    await waitForDatasetCount(page, 2);

    // ── Select both rows (click, Ctrl+click) and open the workshop from the row menu ──
    const row = (name: string) => page.locator("[data-ds-id]").filter({ hasText: name }).first();
    await row("sample-s1.dat").click(); // a plain click collapses the selection to this row
    await expect.poll(async () => (await state(page)).selectedIds.length).toBe(1);
    await row("sample-s2.dat").click({ modifiers: ["Control"] });
    await expect.poll(async () => (await state(page)).selectedIds.length).toBe(2);
    await row("sample-s1.dat").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Metadata → factors…" }).click();

    const panel = page.locator(".qzk-win").filter({ hasText: "Metadata → factors" });
    await expect(panel).toBeVisible();
    await panel.getByRole("combobox", { name: "Metadata field" }).selectOption({ label: "instrument › sample (2/2)" });
    await expect(panel.getByLabel("Column name")).toHaveValue("sample");
    const preview = panel.getByRole("table", { name: "Factor preview" });
    await expect(preview.getByRole("row")).toHaveText([/Dataset/, /sample-s1\.dat\s*S1/, /sample-s2\.dat\s*S2/]);
    expect((await state(page)).datasets.every((d) => !d.data.labels.includes("sample"))).toBe(true); // preview only

    await panel.getByRole("button", { name: "Add factor column" }).click();
    await expect
      .poll(async () => (await state(page)).datasets.map((d) => d.data.labels.includes("sample")))
      .toEqual([true, true]);

    // ── Merge the two, with the source column ──
    await row("sample-s1.dat").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Merge 2 selected" }).click();
    const reshape = page.locator(".qzk-win").filter({ hasText: "Reshape & combine" });
    await expect(reshape).toBeVisible();
    await reshape.getByRole("checkbox", { name: /naming each row's source dataset/ }).check();
    const table = reshape.getByRole("table", { name: "Preview rows" });
    await expect(table.getByRole("columnheader")).toContainText(["sample", "source"]);
    await reshape.getByRole("button", { name: "Create", exact: true }).click();
    await waitForDatasetCount(page, 3);

    const merged = (await state(page)).datasets.find((d) => d.name.startsWith("merged"))!;
    expect(merged.data.labels).toEqual(["Moment", "Temperature", "Time Stamp", "sample", "source"]); // + QD companions
    expect(levelsOf(merged, "sample")).toEqual(["S1", "S1", "S1", "S2", "S2", "S2"]);
    expect(levelsOf(merged, "source")).toEqual([
      "sample-s1.dat", "sample-s1.dat", "sample-s1.dat", "sample-s2.dat", "sample-s2.dat", "sample-s2.dat",
    ]);
  });
});
