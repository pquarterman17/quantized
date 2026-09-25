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
//
// ENGINES. Written against Chromium; also runs in Firefox and WebKit through
// the opt-in cross-browser projects (playwright.config.ts, the
// `e2e-xbrowser` CI job). Every assertion runs on all three engines EXCEPT
// the accessibility-tree ones, which need CDP: `expectInAxTree` skips them
// outside Chromium and says so in a `ax-tree-unmeasured` test annotation.

import { expect, test, type Locator, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type HarnessState = {
  setPrefsOpen: (v: boolean) => void;
  setCurveFitOpen: (v: boolean) => void;
  activeId: string | null;
};
type HarnessWindow = Window & {
  __qz: {
    useApp: { getState: () => HarnessState; setState: (p: object) => void };
    requestDatasetRemoval: (ids: readonly string[]) => void;
  };
};

const setPrefs = (page: Page, open: boolean) =>
  page.evaluate((v) => (window as unknown as HarnessWindow).__qz.useApp.getState().setPrefsOpen(v), open);

/** Ask to remove the active dataset through the app's one removal path (the
 *  one Delete uses), from outside any key event. Since R15 a key pressed
 *  inside a dialog no longer reaches that path, so this is how a toast or a
 *  confirm is raised WHILE a dialog is open. */
const requestRemoveActive = (page: Page) =>
  page.evaluate(() => {
    const qz = (window as unknown as HarnessWindow).__qz;
    const id = qz.useApp.getState().activeId;
    if (id) qz.requestDatasetRemoval([id]);
  });

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

/** Assert the accessibility-tree half, where it can be measured. CDP exists
 *  only in Chromium; Firefox and WebKit expose no engine AX tree to
 *  Playwright, and its DOM-computed ARIA snapshot is inert-blind (above). So
 *  on those engines this assertion is NOT faked or approximated: it is
 *  skipped, and the skip is recorded as a test annotation so the report says
 *  so. The focus, Tab, pointer and inert-placement assertions around each
 *  call run on every engine. */
async function expectInAxTree(page: Page, name: RegExp, role: string | undefined, present: boolean): Promise<void> {
  const engine = page.context().browser()?.browserType().name();
  if (engine !== "chromium") {
    const annotations = test.info().annotations;
    if (!annotations.some((a) => a.type === "ax-tree-unmeasured")) {
      annotations.push({ type: "ax-tree-unmeasured", description: `no CDP accessibility tree in ${engine}` });
    }
    return;
  }
  expect(await inAxTree(page, name, role)).toBe(present);
}

/** The accessible name of the dialog holding focus ("" when none does). */
const focusedDialog = (page: Page) =>
  page.evaluate(() => {
    const d = document.activeElement?.closest("[role='dialog']");
    return d ? (document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent ?? "") : "";
  });

/** The dialog PAINTED topmost at (x, y). `inert` removes elements from hit
 *  testing, so a plain `elementFromPoint` would look straight through an
 *  inert dialog painted on top and report the live one beneath it — it
 *  cannot tell what the user SEES. So every `inert` is lifted for the one
 *  synchronous hit test (no frame renders in between) and put back. */
const paintedOnTopAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const inert = Array.from(document.querySelectorAll("[inert]"));
      for (const el of inert) el.removeAttribute("inert");
      const d = document.elementFromPoint(px, py)?.closest("[role='dialog']");
      for (const el of inert) el.setAttribute("inert", "");
      return d ? (document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent ?? "") : "";
    },
    [x, y],
  );

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
  await expectInAxTree(page, /^Tiles$/, "button", true);

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
  await expectInAxTree(page, /^Tiles$/, "button", false);
  await expectInAxTree(page, /^Background operations$/, undefined, true);

  await setPrefs(page, false);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.locator("[inert]").count()).toBe(0);
  expect(await canFocus(tiles)).toBe(true);
  await expectInAxTree(page, /^Tiles$/, "button", true);
});

test("a toast raised while a dialog is open is announced: not inert, and in the accessibility tree", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);

  await setPrefs(page, true);
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await expect(prefs).toBeVisible();
  // R15: the global Delete key no longer reaches the app from inside a
  // dialog, so the removal (confirm is off by default) is requested the way
  // any background operation would, and it says so in a toast.
  await prefs.getByRole("button").first().focus();
  await page.keyboard.press("Delete");
  // The store, read synchronously after the key: a DOM row count could still
  // show the row before a removal re-rendered.
  expect((await appSnapshot(page)).datasets).toBe(1);
  await requestRemoveActive(page);
  await waitForDatasetCount(page, 0);

  const toastMsg = page.locator(".qzk-toast", { hasText: "removed 1 dataset" });
  await expect(toastMsg).toBeVisible();
  expect(await inertAncestor(toastMsg)).toBe(false);
  await expectInAxTree(page, /removed 1 dataset/, undefined, true);
  // ...while the background around it really is inert.
  expect(await inertAncestor(page.locator(".qzk-library"))).toBe(true);
  await expectInAxTree(page, /^Tiles$/, "button", false);

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
  const hit = await paintedOnTopAt(page, pbox.x + pbox.width / 2, pbox.y + 30);
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
  // R15: Delete inside Preferences no longer asks (pinned by the R15 case
  // below: the confirm's body is lazy, so a dialog count read here right
  // after the key could not tell). The same removal request, raised from
  // outside a key event, still asks OVER Preferences.
  await requestRemoveActive(page);

  const ask = page.getByRole("dialog", { name: "Remove 1 dataset?" });
  await expect(ask).toBeVisible();
  expect(await dialogStates(page)).toEqual([
    { name: "Preferences", inert: true },
    { name: "Remove 1 dataset?", inert: false },
  ]);
  // Painted on top: its own centre hits it (it used to render UNDER
  // Preferences, which covered it completely).
  const abox = (await ask.boundingBox())!;
  const onTop = await paintedOnTopAt(page, abox.x + abox.width / 2, abox.y + 20);
  expect(onTop).toBe("Remove 1 dataset?");

  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  await waitForDatasetCount(page, 1);
  expect(await dialogStates(page)).toEqual([{ name: "Preferences", inert: false }]);
  await expect(opener).toBeFocused();
  await setPrefs(page, false);
  expect(await page.locator("[inert]").count()).toBe(0);
});

test("a window opened while a dialog is open mounts inert and cannot take focus; `f` from the dialog opens none", async ({ page }) => {
  await gotoApp(page);
  await setPrefs(page, true);
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await prefs.getByRole("button").first().focus();
  // R15: `f`, the curve-fit workshop's global shortcut, no longer fires from
  // a focused dialog button.
  await page.keyboard.press("f");
  await expect(prefs).toBeVisible();
  // The store, not the DOM: the window's body is lazy, so a DOM count read
  // right after the key would be 0 either way (measured with the gate
  // removed: that check stayed green).
  expect((await appSnapshot(page)).curveFitOpen).toBe(false);
  // A window that opens anyway (from the store, as a background operation
  // would) mounts AFTER the dialog's walk — the DOM-mutation gap — and must
  // still be background.
  await page.evaluate(() => (window as unknown as HarnessWindow).__qz.useApp.getState().setCurveFitOpen(true));
  const win = page.locator(".qzk-win").first();
  await expect(win).toBeAttached();
  expect(await inertAncestor(win)).toBe(true);
  // The window tries to take focus on mount; the browser refused it.
  expect(await page.evaluate(() => document.activeElement?.closest("[role='dialog']") !== null)).toBe(true);

  await setPrefs(page, false);
  expect(await page.locator("[inert]").count()).toBe(0);
});

/** The app state every background shortcut would change (R15). */
const appSnapshot = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => {
    const s = (window as unknown as HarnessWindow).__qz.useApp.getState() as unknown as Record<string, unknown>;
    const pick = ["activeId", "plotTool", "cmdkOpen", "curveFitOpen", "hysteresisOpen", "peaksOpen", "leftCollapsed", "rightCollapsed", "theme", "focusedWindowId"];
    return {
      ...Object.fromEntries(pick.map((k) => [k, s[k]])),
      datasets: (s.datasets as unknown[]).length,
      history: (s.history as unknown[]).length,
      windows: (s.plotWindows as unknown[]).length,
    };
  });

test("R15: background shortcuts pressed inside Preferences leave the app untouched", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);
  await setPrefs(page, true);
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await prefs.getByRole("button").first().focus();
  const before = await appSnapshot(page);

  const keys = ["Control+z", "Control+Shift+z", "Delete", "Backspace", "z", "h", "d", "f", "y", "p", "a", "ArrowDown",
    "Control+k", "Control+[", "Control+]", "Control+Shift+l", "Control+Shift+n", "Control+Tab"];
  for (const key of keys) {
    await page.keyboard.press(key);
    expect(await appSnapshot(page), key).toEqual(before);
    await expect(prefs, key).toBeVisible();
  }
  await expect(page.locator(".qzk-toast")).toHaveCount(0);
  expect(await page.locator(".qzk-win").count()).toBe(0);

  // Positive control: with the dialog closed the same keys reach the app.
  await setPrefs(page, false);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("z");
  expect((await appSnapshot(page)).plotTool).toBe("zoom");
});

/** R16: `?` pressed from `opener` inside the open dialog `under`. Shortcuts
 *  sits EARLIER in AppOverlays, so before open order drove the paint it
 *  opened UNDERNEATH `under` — invisible — and the first Escape closed it
 *  unseen (measured on main and on the first R12 cut). */
async function questionMarkOver(page: Page, under: string, opener: Locator): Promise<void> {
  await opener.focus();
  await page.keyboard.press("?");
  const shortcuts = page.getByRole("dialog", { name: /shortcuts/i });
  await expect(shortcuts).toBeVisible();
  // Visible ON TOP: its own centre hits it, not the dialog beneath.
  const box = (await shortcuts.boundingBox())!;
  const hit = await paintedOnTopAt(page, box.x + box.width / 2, box.y + box.height / 2);
  expect(hit).toMatch(/shortcuts/i);
  const live = (await dialogStates(page)).filter((d) => !d.inert).map((d) => d.name);
  expect(live).toHaveLength(1);
  expect(live[0]).toMatch(/shortcuts/i);
  // Focus and Tab are Shortcuts'.
  expect(await focusedDialog(page)).toMatch(/shortcuts/i);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await focusedDialog(page)).toMatch(/shortcuts/i);
  }
  // First Escape closes what is visible on top; the dialog beneath is live
  // again with its focus back where it was.
  await page.keyboard.press("Escape");
  await expect(shortcuts).toHaveCount(0);
  expect(await dialogStates(page)).toEqual([{ name: under, inert: false }]);
  await expect(opener).toBeFocused();
  // Second Escape closes the one beneath; nothing is left inert.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.locator("[inert]").count()).toBe(0);
}

test("R16: `?` in Help opens Shortcuts visibly on top, and Escape closes it first", async ({ page }) => {
  await gotoApp(page);
  await openHelpFromPalette(page);
  await questionMarkOver(page, "Help", page.getByRole("dialog", { name: "Help" }).getByRole("tab").first());
});

test("R16: `?` in Preferences opens Shortcuts on top, on first open and on reopen", async ({ page }) => {
  await gotoApp(page);
  for (let round = 0; round < 2; round++) {
    await setPrefs(page, true);
    const prefs = page.getByRole("dialog", { name: "Preferences" });
    await expect(prefs).toBeVisible();
    await questionMarkOver(page, "Preferences", prefs.getByRole("button").first());
  }
});
