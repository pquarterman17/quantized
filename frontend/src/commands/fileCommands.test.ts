// e2e/specs/quick-figure-lifecycle.spec.ts drives the REAL File menu with an
// EXACT-text locator on the Save-As command's label to trigger a real
// browser download — the realest available path for a project save/reload
// round trip (see that spec's own header). A silent label rename here
// (exactly what happened: "Save workspace (.dwk)…" -> "Save workspace as
// (.dwk)…", when the quick-save sibling command that motivated the "as"
// distinction was later removed for bundle-size reasons, leaving the
// rename with no remaining purpose) leaves the e2e locator matching
// nothing: `.click()` never lands on a real menu item, and the spec's
// `page.waitForEvent("download")` times out 60s later with an error that
// points at the download wait, not the actual cause.
//
// `npx vitest run` never runs `e2e/specs/*` (a separate Playwright suite,
// `npm run e2e`), so nothing in the fast unit loop caught this. This pin
// reads the e2e spec's OWN locator string from source and cross-checks it
// against the live command registry, so the next rename fails in
// milliseconds here instead of a 60-second CI timeout with a misleading
// "no download fired" symptom.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { useApp } from "../store/useApp";

/** The exact string quick-figure-lifecycle.spec.ts passes to `getByText(...,
 *  { exact: true })` for the click that must trigger the project-save
 *  download — i.e. the literal text `page.waitForEvent("download")` is
 *  paired with in that spec's `Promise.all`. Read from source rather than
 *  hand-copied, so this pin can't itself drift from what the e2e spec
 *  actually asserts. */
function e2eSaveDownloadLocatorText(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const specPath = resolve(here, "../../e2e/specs/quick-figure-lifecycle.spec.ts");
  const src = readFileSync(specPath, "utf-8");
  const match =
    /page\.waitForEvent\("download"\),\s*\n\s*page\.getByText\("([^"]+)",\s*\{\s*exact:\s*true\s*\}\)\.click\(\)/.exec(
      src,
    );
  if (!match) {
    throw new Error(
      "could not find the download-triggering getByText(...).click() in " +
        "e2e/specs/quick-figure-lifecycle.spec.ts — did its shape change? update this pin's regex",
    );
  }
  return match[1];
}

describe("File menu — Save-As label matches the e2e download-trigger locator", () => {
  it("keeps commands.ts's save-workspace label in sync with the e2e spec's exact-text locator", () => {
    const expected = e2eSaveDownloadLocatorText();
    const cmd = buildFileCommands(useApp.getState).find((c) => c.id === "save-workspace");
    expect(cmd).toBeDefined();
    expect(cmd?.label).toBe(expected);
  });
});
