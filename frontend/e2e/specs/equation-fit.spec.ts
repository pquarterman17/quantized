// Custom-equation fit authoring (PRIMARY_SOFTWARE_AUDIT_PLAN P2.7), end to
// end against the REAL backend parser: a syntax error is underlined IN the
// equation field over the right characters, Python `**` validates, the
// before-run summary names free/held parameters, a held parameter keeps its
// value through the fit and reports "held", units sit beside fitted values,
// and a model saved with a description and units comes back in the picker.

import { expect, test, type Locator } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

test.describe("Curve Fit custom equation authoring (P2.7)", () => {
  test("inline error, ** syntax, hold, units, saved description", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);

    await runPaletteCommand(page, "Curve fit…");
    const panel = page.locator(".qzk-win").filter({ has: page.getByText("Curve Fit", { exact: true }) });
    await expect(panel).toBeVisible();
    await panel.locator("select").first().selectOption({ label: "Custom equation…" });

    // ── inline syntax feedback from the real parser ────────────────────────
    const field = panel.getByRole("textbox", { name: "Equation" });
    await field.fill("m*x + foo(b)");
    const mark = panel.getByTestId("equation-error-mark");
    await expect(mark).toHaveText("foo", { timeout: 10_000 });
    await expect(panel.getByRole("alert")).toContainText('Unknown function "foo"');
    await expect(panel.getByRole("alert")).toContainText("(column 7)");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    // The underline sits INSIDE the field, over the 7th-9th characters: to
    // the right of the field's left edge by roughly six glyph widths.
    const f = await box(field);
    const m = await box(mark);
    expect(m.x).toBeGreaterThan(f.x);
    expect(m.x + m.width).toBeLessThan(f.x + f.width);
    expect(m.y).toBeGreaterThanOrEqual(f.y - 1);
    expect(m.y + m.height).toBeLessThanOrEqual(f.y + f.height + 1);
    const glyph = m.width / 3; // "foo" is three monospace glyphs
    expect(Math.abs(m.x - (f.x + 8 + 1 + 6 * glyph))).toBeLessThan(glyph); // 8 px padding + 1 px border

    // A long equation scrolls the field; the overlay scrolls with it, so the
    // mark on an error at the END is still inside the field's box.
    await field.fill(`${"m*x + ".repeat(12)}foo(b)`);
    await expect(panel.getByRole("alert")).toContainText("(column 73)", { timeout: 10_000 });
    await expect(mark).toHaveText("foo");
    const lf = await box(field);
    const lm = await box(mark);
    expect(lm.x).toBeGreaterThan(lf.x);
    expect(lm.x + lm.width).toBeLessThanOrEqual(lf.x + lf.width);

    // ── Python ** validates; summary; hold ─────────────────────────────────
    await field.fill("m*x**1 + b");
    await expect(mark).toHaveCount(0);
    const summary = panel.getByLabel("equation summary");
    await expect(summary).toContainText("x (independent)", { timeout: 10_000 });
    await expect(summary).toContainText("m, b");
    await panel.getByRole("textbox", { name: "guess b" }).fill("0");
    await panel.getByRole("checkbox", { name: "Hold b fixed" }).check();
    await expect(summary).toContainText("held");
    await panel.getByRole("textbox", { name: "unit m" }).fill("V/s");
    // Six columns must fit the 340 px window. The first cut overflowed it:
    // the window body scrolled sideways (so BOTH edges must be checked — the
    // right one alone passed) and the hold column was clipped.
    const table = await box(panel.locator(".qzk-dense-table table"));
    const win = await box(panel);
    expect(table.x).toBeGreaterThanOrEqual(win.x);
    expect(table.x + table.width).toBeLessThanOrEqual(win.x + win.width);
    await expect(panel.getByRole("checkbox", { name: "Hold b fixed" })).toBeInViewport({ ratio: 1 });

    await panel.getByRole("button", { name: "Fit", exact: true }).click();
    const results = panel.locator("table").filter({ has: page.getByRole("columnheader", { name: "± err" }) });
    const rows = results.locator("tbody tr");
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    await expect(rows.nth(0)).toContainText("V/s");
    const slope = Number((await rows.nth(0).locator("td").nth(1).textContent())?.split(" ")[0]);
    expect(Math.abs(slope - 1)).toBeLessThan(1e-4);
    await expect(rows.nth(1).locator("td").nth(1)).toHaveText("0");
    await expect(rows.nth(1).locator("td").nth(2)).toHaveText("held");

    // ── every parameter held: Fit refuses before any request ───────────────
    await panel.getByRole("checkbox", { name: "Hold m fixed" }).check();
    await expect(panel.getByRole("button", { name: "Fit", exact: true })).toBeDisabled();
    await expect(summary.getByRole("alert")).toContainText("every parameter is held");
    await panel.getByRole("checkbox", { name: "Hold m fixed" }).uncheck();

    // ── save with a description; the picker names it ────────────────────────
    await panel.getByPlaceholder("model name").fill("Ramp");
    await panel.getByRole("textbox", { name: "model description" }).fill("straight line through zero");
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel.locator("select").first().locator("option", { hasText: "ƒ Ramp — straight line" })).toHaveCount(1);
  });
});
