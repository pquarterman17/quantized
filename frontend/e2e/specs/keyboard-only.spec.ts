// Journey (g) — The essential journey with NO mouse: import (via the Command
// Palette instead of drop), the import auto-plots, open a row's context menu
// with the keyboard (Shift+F10 on a focused row), activate an action
// (GUI_INTERACTION_PLAN #15). jsdom has no OS-level keyboard-shortcut-driven
// context menu at all — Shift+F10 firing a real `contextmenu` DOM event at
// the focused element is Chromium/OS behavior a synthetic `fireEvent` can't
// reach.
//
// `locator.focus()` moves focus programmatically rather than replaying every
// intervening Tab press — the thing being verified is that a REAL Shift+F10
// keypress on a focused element produces a real `contextmenu` event a real
// browser dispatches (jsdom's gap), not the app's own Tab order (which is a
// separate, un-blocked concern — nothing here depends on it).
//
// `locator.press('Enter')` on the resulting menu item also focuses it first,
// then dispatches real key events — Chromium's native "Enter activates a
// focused <button>" behavior, again nothing jsdom implements by default.

import { expect, test } from "@playwright/test";

import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

test("import via the Command Palette, then open + act on a row's context menu, all by keyboard", async ({
  page,
}) => {
  // Arm the file-chooser listener BEFORE loading the app. The listener's
  // interception request is fire-and-forget, and Enter opens the chooser in
  // the same keydown. Armed just before Enter, it lost that race in 35-55% of
  // runs: the dialog opened un-intercepted, headless Chromium cancelled it,
  // and the event never came. Forcing the race (Enter sent before the
  // listener) failed 19/20, every failure with a native `cancel` on the
  // input. The app was right every time: correct option highlighted, picker
  // click() under user activation.
  const fileChooserPromise = page.waitForEvent("filechooser");
  await gotoApp(page);

  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Type a command…").fill("Import data");
  // Wait on STATE: the highlighted row is the one Enter runs.
  const commands = page.getByRole("listbox", { name: "Commands" });
  await expect(commands.getByRole("option", { selected: true })).toContainText("Import data…");

  await page.keyboard.press("Enter"); // runs the highlighted "Import data…" command
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(fixturePath("linear-ramp.csv"));

  await waitForDatasetCount(page, 1);
  // A fresh import auto-activates + rebinds the focused window (store's
  // addDataset) — plotted with no separate "click to plot" step needed.
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

  // ── Open the row's context menu via Shift+F10 (no right-click) ─────────
  const handle = page.locator("[data-ds-id] .qzk-drag-handle");
  await handle.focus();
  await page.keyboard.press("Shift+F10");

  // GUI_INTERACTION #8 gave every plain-action menu row an explicit
  // role="menuitem" (ContextMenu.tsx's MenuList) — the accessible role is
  // "menuitem", not the element's old implicit "button".
  const duplicateItem = page.getByRole("menuitem", { name: "Duplicate", exact: true });
  await expect(duplicateItem).toBeVisible();
  await duplicateItem.press("Enter");

  await waitForDatasetCount(page, 2);
});
