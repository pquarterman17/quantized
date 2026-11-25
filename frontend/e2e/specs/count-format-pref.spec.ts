// P0-2 (prefs audit): with Preferences > Numbers = Scientific / 3 sig figs,
// Channel statistics printed N = 201 as "2.01e+2". Counts are integers: N must
// read "201" while real statistics (Mean) still follow the pref.

import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

test("Channel statistics N stays an integer under Scientific / 3 sf", async ({ page }, testInfo) => {
  const csv = ["t,y", ...Array.from({ length: 201 }, (_, i) => `${i},${i}`)].join("\n") + "\n";
  const file = testInfo.outputPath("n201.csv");
  writeFileSync(file, csv);

  await page.addInitScript(() => {
    localStorage.setItem("qz.prefs", JSON.stringify({ sigFigs: 3, notation: "scientific" }));
  });
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), file);
  await waitForDatasetCount(page, 1);

  const card = page.locator(".qzk-inspector .qz-card").filter({
    has: page.locator(".qz-card-heading", { hasText: /^Channel statistics$/ }),
  });
  await card.locator(".qz-card-heading").click();
  await expect(card).toContainText("Mean");
  // Mean (a real value) follows the pref: Max 200 -> 2.00e+2, Mean 100 -> 1.00e+2. N does not.
  await expect(card).toContainText("2.00e+2");
  await expect(card).toContainText("201");
  await expect(card).not.toContainText("2.01e+2");
});
