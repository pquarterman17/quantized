// Journey (d) — Edit an axis title and set explicit limits through the
// Inspector UI, verify (GUI_INTERACTION_PLAN #15). Both cards are collapsed
// `<details>` by default (components/primitives/index.tsx's `Card`), so this
// also exercises real disclosure-widget interaction jsdom renders but never
// needs a real layout pass for. Not tagged `@core` — plain text-field commits,
// not canvas/pointer-capture territory — so it runs at the 100% baseline only.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

test("edit the X axis label and set explicit X/Y limits", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);

  // ── Axis title: expand "Titles & labels", edit the X label field ──────
  // Scoped to ITS OWN `.qz-card` (not `getByPlaceholder("auto").first()` —
  // the Axes card, rendered EARLIER in the DOM, also has "auto"-placeholder
  // limit fields that exist-but-hidden while collapsed, so an unscoped
  // `.first()` silently resolves to the wrong, invisible input).
  await page.getByText("Titles & labels").click();
  const titlesCard = page.locator(".qz-card", { hasText: "Titles & labels" });
  const xLabelInput = titlesCard.getByPlaceholder("auto").first();
  await xLabelInput.fill("Elapsed time");
  await xLabelInput.blur();

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __qz: { useApp: { getState: () => { xAxisLabel: string } } } }).__qz.useApp
          .getState().xAxisLabel,
      ),
    )
    .toBe("Elapsed time");

  // ── Limits: expand "Axes", set explicit X min/max ──────────────────────
  await page.getByText("Axes", { exact: true }).click();
  const axesCard = page.locator(".qz-card", { hasText: "Axes" });
  const xMin = axesCard.getByPlaceholder("auto").nth(0);
  const xMax = axesCard.getByPlaceholder("auto").nth(1);
  await xMin.fill("2");
  await xMax.fill("18");
  await xMax.blur();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __qz: { useApp: { getState: () => { xLim: [number, number] | null } } } }).__qz
            .useApp.getState().xLim,
      ),
    )
    .toEqual([2, 18]);
});
