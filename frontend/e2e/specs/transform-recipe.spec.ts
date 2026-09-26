// Saved transformation recipe (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5 box 4), end
// to end against the real backend's CSV parser: record two transforms (stack
// two columns, then transpose the result) through the Reshape & combine
// workshop, save them as a recipe in the Pipeline workshop, and apply the
// recipe to a second file whose columns come in another order. The preflight
// binds the columns by name, and the derived output equals the recorded one
// exactly (the second file holds the same numbers, reordered) — proof the
// recipe ran on the recorded layout, not on the file's own column order. The
// output carries the recipe's name and revision, and one Undo removes the
// whole apply.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface StoreDs {
  id: string;
  name: string;
  data: { time: number[]; values: number[][]; labels: string[]; metadata: Record<string, unknown> };
}
type Api = {
  datasets: StoreDs[];
  macroSteps: { kind: string }[];
  history: { label: string }[];
  startMacro: () => void;
  stopMacro: () => void;
  setActive: (id: string) => void;
  undo: () => void;
};
const call = (page: Page, fn: string, arg?: string) =>
  page.evaluate(
    ([f, a]) => {
      const s = (window as unknown as { __qz: { useApp: { getState: () => Record<string, (x?: string) => void> } } }).__qz.useApp.getState();
      s[f as string](a as string | undefined);
    },
    [fn, arg],
  );
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => Api } } }).__qz.useApp.getState();
    return { datasets: s.datasets, macroSteps: s.macroSteps, history: s.history.map((h) => h.label) };
  });

test.describe("Saved transformation recipe (P2.5)", () => {
  test("record stack + transpose → save as a recipe → apply to a reordered file → same output, with provenance", async ({ page }) => {
    await gotoApp(page);
    const library = page.locator(".qzk-library");
    await dropFileOnto(page, library, fixturePath("recipe-reordered.csv"));
    await waitForDatasetCount(page, 1);
    await dropFileOnto(page, library, fixturePath("three-channel.csv"));
    await waitForDatasetCount(page, 2);
    const src = (await state(page)).datasets.find((d) => d.name === "three-channel.csv")!;
    await call(page, "setActive", src.id);
    await call(page, "startMacro");

    // ── Record: stack Beta + Gamma, then transpose the stacked output ────
    await runPaletteCommand(page, "Stack columns to long form…");
    const reshape = page.locator(".qzk-win").filter({ hasText: "Reshape & combine" });
    await expect(reshape).toBeVisible();
    const cols = reshape.getByRole("group", { name: "Columns to stack" });
    await cols.getByRole("checkbox", { name: "Alpha" }).setChecked(false);
    await cols.getByRole("checkbox", { name: "Beta" }).setChecked(true);
    await cols.getByRole("checkbox", { name: "Gamma" }).setChecked(true);
    const create = reshape.getByRole("button", { name: "Create", exact: true });
    await expect(create).toBeEnabled();
    await create.click();
    await waitForDatasetCount(page, 3);

    await runPaletteCommand(page, "Transpose worksheet…");
    await expect(reshape).toBeVisible();
    await expect(reshape.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
    await reshape.getByRole("button", { name: "Create", exact: true }).click();
    await waitForDatasetCount(page, 4);
    await call(page, "stopMacro");
    const recorded = await state(page);
    expect(recorded.macroSteps.map((s) => s.kind)).toEqual(["transform", "transform"]);
    const recordedOut = recorded.datasets[recorded.datasets.length - 1];

    // ── Save as a recipe (the expected input is read off the recording) ──
    await runPaletteCommand(page, "Pipeline (edit + re-run recorded steps)…");
    await expect(page.getByRole("combobox", { name: "Example dataset" })).toHaveValue(src.id);
    await expect(page.getByRole("note", { name: "Expected input" })).toContainText("Expects: columns Beta, Gamma");
    await page.getByRole("textbox", { name: "Template name" }).fill("stack+transpose");
    await page.getByRole("textbox", { name: "Recipe description" }).fill("Beta and Gamma to long form, transposed");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Template name" })).toHaveValue("");

    // ── Apply it to the reordered file: preflight first, then Apply ──────
    await page.getByRole("combobox", { name: "Saved template" }).selectOption("stack+transpose");
    await page.getByRole("button", { name: "Apply…", exact: true }).click();
    const region = page.getByRole("region", { name: "Apply recipe stack+transpose" });
    await expect(region).toContainText("2 steps");
    const picks = region.getByRole("group", { name: "Datasets to apply to" });
    for (const box of await picks.getByRole("checkbox").all()) await box.setChecked(false);
    await picks.getByRole("checkbox", { name: "recipe-reordered.csv", exact: true }).check();
    const pre = region.getByRole("group", { name: "Preflight recipe-reordered.csv" });
    await expect(pre).toContainText("recipe-reordered.csv — ready");
    // Bound by name, whatever the file's order: Beta is its column 3, Gamma its column 1.
    await expect(pre.getByRole("combobox", { name: "Bind Beta in recipe-reordered.csv" })).toHaveValue("2");
    await expect(pre.getByRole("combobox", { name: "Bind Gamma in recipe-reordered.csv" })).toHaveValue("0");
    expect((await state(page)).datasets).toHaveLength(4); // the preview created nothing
    await region.getByRole("button", { name: "Apply to 1 dataset" }).click();
    await expect(region.getByRole("list", { name: "Apply results" })).toContainText("recipe-reordered.csv: created");

    // ── The derived output: equal to the recorded one, with provenance ───
    const after = await state(page);
    const out = after.datasets.find((d) => d.data.metadata.transform_recipe)!;
    expect(out.data.time).toEqual(recordedOut.data.time);
    expect(out.data.values).toEqual(recordedOut.data.values);
    expect(out.data.labels).toEqual(recordedOut.data.labels);
    expect(out.data.metadata.transform_recipe).toMatchObject({
      recipe: "stack+transpose",
      revision: 1,
      input: { name: "recipe-reordered.csv" },
      bindings: [
        { column: "Alpha", from: "Alpha" },
        { column: "Beta", from: "Beta" },
        { column: "Gamma", from: "Gamma" },
      ],
      steps: 2,
    });
    const reordered = after.datasets.find((d) => d.name === "recipe-reordered.csv")!;
    expect(reordered.data.labels).toEqual(["Gamma", "Alpha", "Beta"]); // the source is untouched
    expect(after.history[after.history.length - 1]).toBe("apply recipe “stack+transpose”");

    // ── One undo removes the whole apply ─────────────────────────────────
    await call(page, "undo");
    await waitForDatasetCount(page, 4);
  });
});
