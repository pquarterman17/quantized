// R12 — what the background `inert` of an open modal actually DOES, measured
// in real Chromium.
//
// WHY THIS SPEC EXISTS. The unit suite (`components/overlays/modalInert*.test
// .tsx`) can only pin where the attribute lands: jsdom implements no `inert`
// (measured 2026-09-19 and 2026-09-25 — no property, `isInaccessible` ignores
// it, `focus()` lands inside one). Every behavioural claim R12 makes — the
// background refuses focus, Tab and the pointer, and leaves the accessibility
// tree; a live region raised meanwhile does not; the one active modal is the
// one painted on top — is therefore pinned here, where the browser enforces
// it. The accessibility tree is read from Chromium itself over CDP
// (`Accessibility.getFullAXTree`): Playwright's own ARIA snapshot is computed
// from the DOM and is inert-BLIND (measured 2026-09-19: it still listed the
// background "Tiles" button with Preferences open).

import { expect, test, type Locator, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type HarnessWindow = Window & {
  __qz: { useApp: { getState: () => { setPrefsOpen: (v: boolean) => void }; setState: (p: object) => void } };
};

const setPrefs = (page: Page, open: boolean) =>
  page.evaluate((v) => (window as unknown as HarnessWindow).__qz.useApp.getState().setPrefsOpen(v), open);

/** Can this element actually take focus? `inert` is enforced by the browser,
 *  so a refused `focus()` is the real, unfakeable signal. */
const canFocus = (target: Locator) =>
  target.evaluate((el: HTMLElement) => {
    el.focus();
    return document.activeElement === el;
  });

const inertAncestor = (target: Locator) => target.evaluate((el) => el.closest("[inert]") !== null);

/** Chromium's own accessibility tree: is there a NON-ignored node whose name
 *  matches? Ignored nodes (an inert subtree among them) are what AT skips. */
async function inAxTree(page: Page, name: RegExp, role?: string): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
    nodes: { ignored: boolean; role?: { value?: string }; name?: { value?: string } }[];
  };
  await cdp.detach();
  return nodes.some(
    (n) => !n.ignored && name.test(String(n.name?.value ?? "")) && (role === undefined || n.role?.value === role),
  );
}

/** The accessible name of the dialog holding focus ("" when none does). */
const focusedDialog = (page: Page) =>
  page.evaluate(() => {
    const d = document.activeElement?.closest("[role='dialog']");
    return d ? (document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent ?? "") : "";
  });

/** Stacked dialogs by accessible name, each with whether it is inert. */
const dialogStates = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[role='dialog']")).map((d) => ({
      name: document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent ?? "",
      inert: d.closest("[inert]") !== null,
    })),
  );

async function openHelpFromPalette(page: Page): Promise<void> {
  await runPaletteCommand(page, "Help topics…");
  await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
}

test("an open dialog takes the background out of focus, Tab, pointer and the accessibility tree", async ({ page }) => {
  await gotoApp(page);
  const tiles = page.getByRole("button", { name: "Tiles" });
  await expect(tiles).toBeVisible();
  expect(await canFocus(tiles)).toBe(true);
  expect(await inAxTree(page, /^Tiles$/, "button")).toBe(true);

  await setPrefs(page, true);
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await expect(prefs).toBeVisible();

  // Focus: the browser refuses it.
  expect(await canFocus(tiles)).toBe(false);
  // Tab: forty presses never leave the dialog, let alone reach the Library.
  await prefs.getByRole("button").first().focus();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")))).toBe(true);
  }
  // Pointer: with the backdrop made click-through, a real click lands on the
  // Library control itself — and does nothing, because it is inert.
  await page.addStyleTag({ content: ".qz-overlay-backdrop { pointer-events: none !important; }" });
  const box = (await tiles.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tiles).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Library workspace")).toHaveCount(0);
  // Accessibility tree: the background control is gone, the status bar's
  // live region is not.
  expect(await inAxTree(page, /^Tiles$/, "button")).toBe(false);
  expect(await inAxTree(page, /^Background operations$/)).toBe(true);

  await setPrefs(page, false);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.locator("[inert]").count()).toBe(0);
  expect(await canFocus(tiles)).toBe(true);
  expect(await inAxTree(page, /^Tiles$/, "button")).toBe(true);
});

test("a toast raised while a dialog is open is announced: not inert, and in the accessibility tree", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);

  await setPrefs(page, true);
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await expect(prefs).toBeVisible();
  // A real user path to a toast from INSIDE a dialog: the global Delete key
  // removes the active dataset (Preferences ▸ Interaction's confirm is off by
  // default) and says so in a toast.
  await prefs.getByRole("button").first().focus();
  await page.keyboard.press("Delete");
  await waitForDatasetCount(page, 0);

  const toastMsg = page.locator(".qzk-toast", { hasText: "removed 1 dataset" });
  await expect(toastMsg).toBeVisible();
  expect(await inertAncestor(toastMsg)).toBe(false);
  expect(await inAxTree(page, /removed 1 dataset/)).toBe(true);
  // ...while the background around it really is inert.
  expect(await inertAncestor(page.locator(".qzk-library"))).toBe(true);
  expect(await inAxTree(page, /^Tiles$/, "button")).toBe(false);

  await setPrefs(page, false);
  expect(await page.locator("[inert]").count()).toBe(0);
});

test("Preferences reopened over Help: the one painted on top is the one active modal, and closing it hands Help back its focus", async ({ page }) => {
  await gotoApp(page);
  // Mount Preferences once and close it — it stays mounted, which is the
  // shape that used to rank it BELOW a dialog opened after its first mount.
  await setPrefs(page, true);
  await expect(page.getByRole("dialog", { name: "Preferences" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openHelpFromPalette(page);
  const help = page.getByRole("dialog", { name: "Help" });
  const helpTab = help.getByRole("tab").first();
  await helpTab.focus();
  await expect(helpTab).toBeFocused();

  await page.keyboard.press("Control+,");
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await expect(prefs).toBeVisible();
  expect(await dialogStates(page)).toEqual([
    { name: "Help", inert: true },
    { name: "Preferences", inert: false },
  ]);
  // Preferences is the dialog painted on top, and it is the live one: the
  // pointer reaches it and Tab stays inside it.
  const pbox = (await prefs.boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => {
      const d = document.elementFromPoint(x, y)?.closest("[role='dialog']");
      return d ? document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent : null;
    },
    [pbox.x + pbox.width / 2, pbox.y + 30],
  );
  expect(hit).toBe("Preferences");
  expect(await canFocus(helpTab)).toBe(false);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await focusedDialog(page)).toBe("Preferences");
  }

  // Close the top one: Help is interactive again and focus is back on the
  // control inside it that was focused when Preferences opened.
  await page.keyboard.press("Escape");
  await expect(prefs).toHaveCount(0);
  expect(await dialogStates(page)).toEqual([{ name: "Help", inert: false }]);
  await expect(helpTab).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.locator("[inert]").count()).toBe(0);
});

test("a confirmation asked over Preferences paints on top and is the active modal", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);
  await page.evaluate(() => (window as unknown as HarnessWindow).__qz.useApp.setState({ confirmRemove: true }));

  await setPrefs(page, true);
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  const opener = prefs.getByRole("button").first();
  await opener.focus();
  await page.keyboard.press("Delete");

  const ask = page.getByRole("dialog", { name: "Remove 1 dataset?" });
  await expect(ask).toBeVisible();
  expect(await dialogStates(page)).toEqual([
    { name: "Preferences", inert: true },
    { name: "Remove 1 dataset?", inert: false },
  ]);
  // Painted on top: its own centre hits it (it used to render UNDER
  // Preferences, which covered it completely).
  const abox = (await ask.boundingBox())!;
  const onTop = await page.evaluate(
    ([x, y]) => {
      const d = document.elementFromPoint(x, y)?.closest("[role='dialog']");
      return d ? document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent : null;
    },
    [abox.x + abox.width / 2, abox.y + 20],
  );
  expect(onTop).toBe("Remove 1 dataset?");

  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  await waitForDatasetCount(page, 1);
  expect(await dialogStates(page)).toEqual([{ name: "Preferences", inert: false }]);
  await expect(opener).toBeFocused();
  await setPrefs(page, false);
  expect(await page.locator("[inert]").count()).toBe(0);
});

test("a window opened by a shortcut while a dialog is open mounts inert and cannot take focus", async ({ page }) => {
  await gotoApp(page);
  await setPrefs(page, true);
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await prefs.getByRole("button").first().focus();
  // `f` is the curve-fit workshop's global shortcut; it still fires from a
  // focused dialog button. The window mounts AFTER the dialog's walk — the
  // DOM-mutation gap — and must still be background.
  await page.keyboard.press("f");
  const win = page.locator(".qzk-win").first();
  await expect(win).toBeAttached();
  expect(await inertAncestor(win)).toBe(true);
  // The window tries to take focus on mount; the browser refused it.
  expect(await page.evaluate(() => document.activeElement?.closest("[role='dialog']") !== null)).toBe(true);

  await setPrefs(page, false);
  expect(await page.locator("[inert]").count()).toBe(0);
});
