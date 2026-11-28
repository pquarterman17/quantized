// Journey (d) — Edit an axis title and set explicit limits through the
// X Axis popup, verify (GUI_INTERACTION_PLAN #15; item 50 moved both from
// the Inspector cards into the popup). The Axes card is a collapsed
// `<details>` by default (components/primitives/index.tsx's `Card`), so this
// also exercises real disclosure-widget interaction. Not tagged `@core` — plain text-field commits,
// not canvas/pointer-capture territory — so it runs at the 100% baseline only.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { applyPopup, openAxisPopup } from "../utils/objectPopup";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

test("edit the X axis label and set explicit X/Y limits", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);

  // ── Axis title: the X Axis popup (item 50: the popup is the only axis
  //    editor; the Axes card's "X axis…" launcher opens it). One Apply
  //    commits the title and the limits together. ─────────────────────────
  const xAxis = await openAxisPopup(page, "X");
  await xAxis.getByRole("textbox", { name: "X axis title", exact: true }).fill("Elapsed time");
  await xAxis.getByRole("textbox", { name: "X axis From", exact: true }).fill("2");
  await xAxis.getByRole("textbox", { name: "X axis To", exact: true }).fill("18");
  await applyPopup(xAxis);

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __qz: { useApp: { getState: () => { xAxisLabel: string } } } }).__qz.useApp
          .getState().xAxisLabel,
      ),
    )
    .toBe("Elapsed time");

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
