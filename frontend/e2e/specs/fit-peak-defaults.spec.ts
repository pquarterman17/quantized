// UX audit 8 #5 (lane UX8-D): fit and peak defaults that give a right answer,
// end to end against the REAL backend on the audit's own synthetic files
// (scratch gen.py, copied into e2e/fixtures):
//   XRD_theta2theta.xy -- 6 Lorentzian peaks on a decaying 2θ background,
//     Poisson counts. The old Peak analyzer defaults marked 14 noise points at
//     10-27° as peaks (20 in all) and ran 60 parameters into the 10 s limit.
//   Raman_Si_graphite.txt -- 3 peaks (Si 520, D 1350, G 1580 cm⁻¹). Lorentzian
//     over the whole range "fitted" one broad hump at R² 0.185, status green.
// And the Curve Fit CI column, clipped in the docked Inspector at 1280 px.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type QzWindow = { __qz: { useApp: { getState: () => { status: string; statusWarn: string | null } } } };
const appStatus = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState();
    return { status: s.status, warn: s.statusWarn };
  });

const curveFit = (page: Page) => page.locator(".qzk-win").filter({ has: page.getByText("Curve fit", { exact: true }) });

test("Peak analyzer defaults find the 6 real XRD peaks and converge within the limit", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("XRD_theta2theta.xy"));
  await waitForDatasetCount(page, 1);

  await runPaletteCommand(page, "Peak analyzer");
  const panel = page.locator(".qzk-win").filter({ has: page.getByText("Peak analyzer", { exact: true }) });
  await expect(panel).toBeVisible();
  const next = panel.getByRole("button", { name: "Next →" });

  await expect(panel.getByRole("combobox", { name: "Peak baseline method" })).toHaveValue("snip");
  await next.click();
  // ② the adaptive find: 6 ± 1 peaks, none of them in the noisy 10-27° band.
  const include = panel.getByRole("checkbox", { name: /include peak/ });
  await expect(include.first()).toBeVisible({ timeout: 15_000 });
  const found = await include.count();
  expect(found).toBeGreaterThanOrEqual(5);
  expect(found).toBeLessThanOrEqual(7);
  await next.click();
  // ③ pseudo-Voigt, the XRD default
  await expect(panel.getByRole("combobox", { name: "peak 1 shape" })).toHaveValue("pseudo_voigt");
  await next.click();
  // ④ fits on entry and converges (inside the 10 s limit: no time-limit stop)
  await expect(panel.getByLabel("fit metrics")).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/^converged ·/)).toBeVisible();
  await expect(panel.getByText(/did not converge|time limit/)).toHaveCount(0);

  const rows = panel.getByTestId("peak-results").locator("tbody tr");
  await expect(rows).toHaveCount(found);
  const centres = await rows.evaluateAll((trs) => trs.map((tr) => Number(tr.querySelectorAll("td")[2]!.textContent!.split(/\s|±/)[0])));
  for (const c of [28.4, 32.9, 47.3, 56.1, 69.1, 76.4]) {
    expect(centres.some((x) => Math.abs(x - c) < 0.1), `a fitted peak at ${c}°`).toBe(true);
  }
  // The per-peak table rounds value to error as Curve Fit does: no 5-decimal
  // centre over a 2-figure error.
  const centreCell = (await rows.first().locator("td").nth(2).innerText()).split("\n");
  const [value, err] = [centreCell[0]!, centreCell[1]!.replace("± ", "")];
  expect(value.split(".")[1]?.length ?? 0).toBe(err.split(".")[1]?.length ?? 0);
});

test.describe("Curve Fit at 1280×720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("Lorentzian over the full Raman range warns; the CI column is fully visible", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("Raman_Si_graphite.txt"));
    await waitForDatasetCount(page, 1);

    await runPaletteCommand(page, "Curve fit…");
    const panel = curveFit(page);
    await expect(panel).toBeVisible();
    await panel.getByRole("combobox", { name: "Model", exact: true }).selectOption({ value: "Lorentzian" });
    // Not zoomed and a single-peak model: the drag is offered.
    await expect(panel.getByRole("button", { name: "Fit range: drag on plot" })).toBeVisible();
    await panel.getByRole("button", { name: "Fit", exact: true }).click();

    const status = panel.locator(".qz-cf-status");
    await expect(status).toHaveText(/^Fitted — poor fit \(R² 0\.\d+\); try a range$/, { timeout: 20_000 });
    expect(await status.evaluate((el) => getComputedStyle(el).color)).toBe(
      await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--warn)";
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      }),
    );
    const app = await appStatus(page);
    expect(app.warn).toBe(app.status); // the status bar's dot is warn, not green
    expect(app.status).toMatch(/poor fit/);

    // The CI: every limit's text is inside the box, nothing scrolled away.
    const box = panel.locator(".qzk-nowrap-table").first();
    await expect(box).toBeVisible();
    const fit = await box.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(fit.scroll).toBeLessThanOrEqual(fit.client);
    const limits = box.getByText(/^\[.*\]/);
    expect(await limits.count()).toBeGreaterThan(0);
    const right = (await box.boundingBox())!;
    for (const l of await limits.all()) {
      const b = (await l.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(right.x + right.width + 0.5);
    }
  });
});
