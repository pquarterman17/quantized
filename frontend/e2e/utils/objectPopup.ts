// Plan item 50 (OG23): an axis, a curve and the legend are edited in their
// double-click popup, not in the right panel. These helpers reach the popup
// the way a user does without a pixel hunt: the Axes card's launchers, and the
// Selection section's Edit… button. Apply commits the popup's draft.

import { expect, type Locator, type Page } from "@playwright/test";

export type AxisName = "X" | "Y" | "Y2";

/** Open the Axes card if it is collapsed. */
async function openAxesCard(page: Page): Promise<Locator> {
  const card = page.locator(".qzk-inspector details.qz-card[data-card-id='Axes']");
  if (!(await card.evaluate((el) => (el as HTMLDetailsElement).open))) await card.locator("summary").click();
  return card;
}

/** Open an axis popup from the Axes card's "X axis…" / "Y axis…" / "Y2 axis…" launcher. */
export async function openAxisPopup(page: Page, axis: AxisName): Promise<Locator> {
  const card = await openAxesCard(page);
  await card.getByRole("button", { name: `${axis} axis…` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Select a curve in the Selection picker, press Edit…, and return its Plot details popup. */
export async function openCurvePopup(page: Page, curveLabel: string | RegExp): Promise<Locator> {
  const selection = page.getByRole("region", { name: "Selection" });
  const picker = selection.getByLabel("Select plot object");
  const option = picker.locator("option").filter({ hasText: curveLabel }).first();
  await picker.selectOption({ value: (await option.getAttribute("value")) ?? "" });
  await selection.getByRole("button", { name: "Edit…" }).click();
  const dialog = page.getByRole("dialog", { name: "Plot details" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Press Apply in a popup and wait for it to close. */
export async function applyPopup(dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
}

/** Set an axis title through its popup (the Axes card launcher, then Apply). */
export async function setAxisTitle(page: Page, axis: AxisName, title: string): Promise<void> {
  const dialog = await openAxisPopup(page, axis);
  await dialog.getByRole("textbox", { name: `${axis === "Y2" ? "Y2 (right)" : axis} axis title`, exact: true }).fill(title);
  await applyPopup(dialog);
}
