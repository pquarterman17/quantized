// Transform safety (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5), end to end against the
// real backend's CSV parser: a key join whose key units differ (K vs mK) and
// whose left key repeats stops at a review BEFORE anything is created — the
// counts in plain text, the unit mismatch as a named, explicit confirm — and
// the confirmed join is recorded as a pipeline step that the Pipeline panel
// replays to the same output.

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

async function joinOnFirstChannel(page: Page) {
  await runPaletteCommand(page, "Join datasets by key…");
  const step1 = page.locator(".qz-dialog").filter({ hasText: "step 1 of 2" });
  await expect(step1).toBeVisible();
  await step1.locator("select").nth(1).selectOption({ index: 1 }); // 0: T
  await step1.getByRole("button", { name: "Run" }).click();
  const step2 = page.locator(".qz-dialog").filter({ hasText: "step 2 of 2" });
  await expect(step2).toBeVisible();
  await step2.locator("select").first().selectOption({ index: 1 }); // 0: T
  await step2.getByRole("button", { name: "Run" }).click();
}

test.describe("Transform safety review + replay (P2.5)", () => {
  test("a unit-mismatched join is reviewed first, then recorded and replayed", async ({ page }) => {
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

    // ── Declining the review creates nothing ─────────────────────────────
    await joinOnFirstChannel(page);
    const review = page.locator(".qz-dialog").filter({ has: page.getByRole("heading", { name: "Join (inner): units differ" }) });
    await expect(review).toBeVisible();
    await expect(review).toContainText("Result: 2 rows");
    await expect(review).toContainText("Key units differ");
    await expect(review).toContainText("1 row repeats an earlier key");
    await expect(review).toContainText("2 key values have no match in join-right.csv");
    await review.getByRole("button", { name: "Cancel" }).click();
    await expect(review).toHaveCount(0);
    await waitForDatasetCount(page, 2);
    expect((await store(page)).macroSteps).toEqual([]);

    // ── Confirming names the override, creates, stamps and records ───────
    await joinOnFirstChannel(page);
    await page.getByRole("button", { name: "Create despite unit mismatch" }).click();
    await waitForDatasetCount(page, 3);
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
