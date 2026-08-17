// Journey (G5) — Configure Quick Plot through the Library's real row menu,
// exercise the native role selects, prove cancel/Escape are non-mutating, and
// create one editable figure with a complete asymmetric Y-error pair.
//
// Persistence/save/reload intentionally stays out of this journey; that is the
// later document-lifecycle handoff. The existing three-channel fixture is
// enough to build a rich pair without adding a fixture: Alpha is the value,
// Beta supplies +, and Gamma supplies −.

import { expect, type Locator, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

function builder(page: Page): Locator {
  return page.locator(".qzk-quick-builder");
}

async function openBuilder(page: Page): Promise<Locator> {
  const row = page.locator("[data-ds-id]").first();
  await row.hover();
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Configure Quick Plot…", exact: true }).click();
  const panel = builder(page);
  await expect(panel).toBeVisible();
  return panel;
}

async function editableFigureCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __qz: { useApp: { getState: () => { editableFigures: unknown[] } } };
        }
      ).__qz.useApp.getState().editableFigures.length,
  );
}

test("Quick Figure Builder cancel/Escape are safe and complete asymmetric errors create one editable figure", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 1);

  const beforeFigures = await editableFigureCount(page);

  // Cancel is a real Library-menu -> builder -> button journey and must not
  // leave a figure behind (or alter the imported worksheet).
  const first = await openBuilder(page);
  await first.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(first).toBeHidden();
  expect(await editableFigureCount(page)).toBe(beforeFigures);

  // Escape owns the focused builder transaction, not the Stage underneath it.
  const second = await openBuilder(page);
  await page.keyboard.press("Escape");
  await expect(second).toBeHidden();
  expect(await editableFigureCount(page)).toBe(beforeFigures);

  // Start again for the actual mapping. Alpha is initially a Y series. Moving
  // Beta into its + error slot leaves an intentionally incomplete pair, which
  // must be visible and must disable Create.
  const panel = await openBuilder(page);
  await panel
    .getByLabel("Role for Beta", { exact: true })
    .selectOption({ label: "Y error (+) for Alpha" });
  await expect(panel.getByRole("status").filter({ hasText: "missing −" })).toBeVisible();
  const create = panel.getByRole("button", { name: "Create Editable Figure", exact: true });
  await expect(create).toBeDisabled();

  // Completing the pair through the other native <select> unlocks creation.
  await panel
    .getByLabel("Role for Gamma", { exact: true })
    .selectOption({ label: "Y error (−) for Alpha" });
  await expect(panel.getByRole("status").filter({ hasText: "missing −" })).toHaveCount(0);
  await expect(create).toBeEnabled();

  await create.click();
  await expect(panel).toBeHidden();
  await expect.poll(() => editableFigureCount(page)).toBe(beforeFigures + 1);

  const created = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __qz: { useApp: { getState: () => { editableFigures: { bindings?: { errors?: unknown[] }; name: string }[] } } };
      }
    ).__qz.useApp.getState();
    return state.editableFigures[state.editableFigures.length - 1];
  });
  expect(created.name).toBe("Quick Figure — three-channel.csv");
  expect(created.bindings?.errors).toEqual([
    { channel: 1, target: 0, axis: "y", side: "+" },
    { channel: 2, target: 0, axis: "y", side: "-" },
  ]);
});

test("Quick Figure Builder remains usable with long scientific labels on a laptop viewport", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 900, height: 700 });
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 1);

  // Reuse the normal import path, then make the labels realistic enough to
  // exercise wrapping/truncation without adding a special fixture or app API.
  await page.evaluate(() => {
    const app = (
      window as unknown as {
        __qz: {
          useApp: {
            getState: () => { datasets: { name: string; data: { labels: string[] } }[] };
            setState: (patch: unknown) => void;
          };
        };
      }
    ).__qz.useApp;
    const state = app.getState();
    app.setState({
      datasets: state.datasets.map((dataset) => ({
        ...dataset,
        name: "Cryogenic transport sweep — sample-2026-08-17 — ΔR/R uncertainty validation (instrument-A).csv",
        data: {
          ...dataset.data,
          labels: [
            "Longitudinal resistance Rxx (normalized, four-terminal measurement)",
            "Upper confidence bound σRxx (+, bootstrap 95 percent interval)",
            "Lower confidence bound σRxx (−, bootstrap 95 percent interval)",
          ],
        },
      })),
    });
  });

  const panel = await openBuilder(page);
  const roleSelect = panel.getByLabel(/Role for Longitudinal resistance/).first();
  await expect(roleSelect).toBeVisible();
  // A real select commit proves the long-label row is not merely painted but
  // remains keyboard/native-form usable at the constrained width.
  await roleSelect.selectOption("y");
  await expect(roleSelect).toHaveValue("y");

  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);

  for (const name of ["Cancel", "Create Editable Figure"]) {
    const button = panel.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    const inViewport = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(inViewport, `${name} should be reachable after scrolling`).toBe(true);
  }
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
});
