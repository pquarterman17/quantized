// Transform preview + safety (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5), end to end
// against the real backend's CSV parser: "Join datasets by key…" opens the
// Reshape & combine workshop, which previews the join LIVE — its rows, its
// size, the duplicate-key warning and the key-unit mismatch (K vs mK) — while
// NOTHING is created. The mismatch keeps Create off until it is explicitly
// acknowledged; the created join is recorded as a pipeline step that the
// Pipeline panel replays to the same output.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type Store = { getState: () => Record<string, unknown> };
const store = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: Store } }).__qz.useApp.getState() as {
      datasets: { name: string; data: { time: number[]; values: number[][]; metadata: Record<string, unknown> } }[];
      macroSteps: { kind: string; params: Record<string, unknown> }[];
    };
    return { datasets: s.datasets, macroSteps: s.macroSteps };
  });

test.describe("Transform preview + safety (P2.5)", () => {
  test("open a join → the preview shows its rows and the duplicate-key warning → create → recorded and replayed", async ({ page }) => {
    await gotoApp(page);
    const library = page.locator(".qzk-library");
    await dropFileOnto(page, library, fixturePath("join-right.csv"));
    await waitForDatasetCount(page, 1);
    await dropFileOnto(page, library, fixturePath("join-left.csv"));
    await waitForDatasetCount(page, 2);
    await page.evaluate(() =>
      ((window as unknown as { __qz: { useApp: { getState: () => { startMacro: () => void } } } }).__qz.useApp
        .getState()
        .startMacro()),
    );

    // ── Open the join: the live preview, nothing created ────────────────
    await runPaletteCommand(page, "Join datasets by key…");
    const panel = page.locator(".qzk-win").filter({ hasText: "Reshape & combine" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("combobox", { name: "Left dataset" })).toHaveValue(/.+/);
    await panel.getByRole("combobox", { name: "Left key" }).selectOption("0"); // T
    await panel.getByRole("combobox", { name: "Right key" }).selectOption("0"); // T

    const sizes = panel.getByRole("list", { name: "Preview size" });
    await expect(sizes).toContainText("Result “join-left.csv + join-right.csv (joined)”: 2 rows × 2 columns");
    await expect(sizes).toContainText("join-left.csv: 5 rows × 2 columns");
    const table = panel.getByRole("table", { name: "Preview rows" });
    await expect(table.getByRole("row")).toHaveCount(3); // header + the 2 joined rows
    const warnings = panel.getByRole("list", { name: "Transform warnings" });
    await expect(warnings.locator('[data-code="duplicate-keys"]')).toContainText("1 row repeats an earlier key");
    await expect(warnings.locator('[data-code="unit-mismatch"]')).toContainText("Key units differ");
    await expect(warnings).toContainText("2 key values have no match in join-right.csv");
    expect((await store(page)).datasets).toHaveLength(2);
    expect((await store(page)).macroSteps).toEqual([]);

    // ── The unit mismatch blocks Create until acknowledged ──────────────
    const create = panel.getByRole("button", { name: "Create", exact: true });
    await expect(create).toBeDisabled();
    await panel.getByRole("checkbox", { name: "Create despite the unit mismatch" }).check();
    await create.click();
    await waitForDatasetCount(page, 3);
    await expect(panel).toHaveCount(0);
    const after = await store(page);
    const joined = after.datasets.find((d) => d.name.endsWith("(joined)"))!;
    expect(joined.data.time).toEqual([5, 10]);
    expect(joined.data.metadata.worksheet_transform).toBe("join");
    expect((joined.data.metadata.transform_warnings as string[]).length).toBe(4);
    expect(after.macroSteps.map((s) => s.kind)).toEqual(["transform"]);

    // ── The Pipeline panel replays it on the left dataset: same output ───
    await page.evaluate(() =>
      ((window as unknown as { __qz: { useApp: { getState: () => { stopMacro: () => void } } } }).__qz.useApp
        .getState()
        .stopMacro()),
    );
    // Make the ORIGINAL left dataset the pipeline target (store seam: the
    // Library row's click routing is not what this spec is about).
    await page.evaluate(() => {
      const s = (window as unknown as {
        __qz: { useApp: { getState: () => { datasets: { id: string; name: string }[]; setActive: (id: string) => void } } };
      }).__qz.useApp.getState();
      s.setActive(s.datasets.find((d) => d.name === "join-left.csv")!.id);
    });
    await runPaletteCommand(page, "Pipeline (edit + re-run recorded steps)…");
    await page.getByRole("button", { name: "Run on join-left.csv", exact: true }).click();
    await waitForDatasetCount(page, 4);
    const replayed = (await store(page)).datasets.filter((d) => d.name.endsWith("(joined)"));
    expect(replayed).toHaveLength(2);
    expect(replayed[1].data).toEqual(replayed[0].data);
  });
});
