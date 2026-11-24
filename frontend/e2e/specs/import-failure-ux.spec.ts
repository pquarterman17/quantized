// UX audit 8, lane UX8-H: a failed import says WHY in its headline, three
// failures fold into one toast, and the Import wizard shows the file's own
// lines even when the backend cannot preview it. Real drops + a real backend
// parse: the reasons come from the actual parsers' messages, which jsdom
// tests can only paraphrase.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp } from "../utils/harness";

const drop = (page: Page, name: string) => dropFileOnto(page, page.locator(".qzk-library"), fixturePath(name));
const alerts = (page: Page) => page.locator(".qzk-toast-alerts [role=alert]");

test("an empty file's toast says it is empty, and three failures fold into one toast", async ({ page }) => {
  await gotoApp(page);

  await drop(page, "import-fail-empty.csv");
  await expect(alerts(page).first()).toContainText("import-fail-empty.csv — the file is empty");
  await expect(alerts(page).first()).toHaveClass(/\brect\b/);
  await expect(alerts(page).first().getByRole("button", { name: "Dismiss notification" })).toBeVisible();

  // GROUP_AFTER is 1 (UX10-D): the second failure already folds into one toast.
  await drop(page, "import-fail-header-only.csv");
  await expect(alerts(page)).toHaveCount(1);
  await expect(alerts(page)).toContainText("2 files couldn't be read");

  await drop(page, "import-fail-comma-decimal.csv");
  await expect(alerts(page)).toHaveCount(1);
  await expect(alerts(page)).toContainText("3 files couldn't be read");

  await alerts(page).getByRole("button", { name: "Show" }).click();
  await expect(alerts(page)).toHaveCount(3);
  await expect(alerts(page).nth(1)).toContainText("has a header but no data rows");
  const eu = alerts(page).filter({ hasText: "import-fail-comma-decimal.csv" });
  await expect(eu).toContainText("commas could be decimals or thousands separators");

  // The wizard opens on that file and shows its lines although the preview
  // request is refused (the comma is ambiguous in every column).
  await eu.getByRole("button", { name: "Open import wizard" }).click();
  const wizard = page.locator(".qzk-win").filter({ has: page.getByText("Import wizard", { exact: true }) });
  await expect(wizard.getByText(/pick the decimal separator/)).toBeVisible();
  const lines = wizard.locator("[data-raw-line]");
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(1)).toHaveText(/^2\s*2,000;3,500$/);
  await expect(lines.nth(1).locator("[data-delim]")).toHaveText(";");
  await expect(wizard.getByLabel("Header line")).toHaveValue("1");
  await expect(wizard.getByLabel("Data start line")).toHaveValue("2");

  // Choosing Comma is the fix the headline named: the preview arrives.
  await wizard.getByLabel("Decimal separator").selectOption(",");
  await expect(wizard.getByText("Read with a decimal comma: T, R.")).toBeVisible();
  await expect(wizard.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
});
