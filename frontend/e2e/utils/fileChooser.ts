// Race-free file-chooser driver. Playwright's `filechooser` listener turns on
// Chromium's dialog interception fire-and-forget, so `Promise.all([
// waitForEvent("filechooser"), trigger ])` can open the dialog before
// interception is on. Headless Chromium then cancels the dialog at once and
// the event never comes. keyboard-only.spec.ts measured it: 8/20 failed in
// the original order, 19/20 with the trigger sent first, and 0/20 with one
// page round-trip between the listener and the trigger. That round-trip is
// what this helper adds.

import type { Page } from "@playwright/test";

/** Run `trigger` (the click/keypress that opens a file dialog) and answer the
 *  dialog with `files`. The listener is armed and confirmed by a page
 *  round-trip BEFORE the trigger runs. */
export async function chooseFiles(
  page: Page,
  trigger: () => Promise<unknown>,
  files: string | string[],
): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  // If the trigger throws, the test fails there. Without this catch, the
  // abandoned wait would also report an unhandled rejection.
  chooser.catch(() => undefined);
  // CDP handles commands in order, so once this evaluate returns, the
  // interception request sent before it has taken effect.
  await page.evaluate(() => 0);
  await trigger();
  await (await chooser).setFiles(files);
}
