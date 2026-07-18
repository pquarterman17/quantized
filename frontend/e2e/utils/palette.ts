// Command Palette driver, reused by any spec that needs to run a ⌘K command
// deterministically. Diagnosed from a window-arrange.spec.ts flake under
// full-parallel e2e load (2026-07-18) — reproducible on unmodified main
// (`--repeat-each=15`, ~1-2 failures in 15 both times), so pre-existing, not
// caused by any recent change. Confirmed failure, always at the SECOND "New
// Graph Window" call:
//
//   Error: expect(locator).toContainText(expected) failed
//   Locator: locator('.qz-cmdk-item').first()
//   Expected substring: "New Graph Window"
//   Received string:    "Import data…⌘O"
//
// The failure screenshot shows the palette open with its input showing the
// EMPTY placeholder ("Type a command…") and the full unfiltered curated
// list (every "File" group entry, "Import data…" active at the top).
//
// Root cause: `CommandPalette`'s `useEffect(() => { if (open) { setQuery("");
// setCursor(0); setMenuCmds([...]); ... } }, [open])` is a PASSIVE effect —
// it runs asynchronously after the `cmdkOpen: false -> true` render commits,
// not synchronously with it. A spec's `page.keyboard.press("Control+k")`
// immediately followed by `.fill(label)` can land BOTH before that effect
// flushes (React batches/defers passive effects behind whatever else is on
// the event loop, and this e2e run's `fullyParallel: true` + unmetered
// local `workers` adds real CPU contention that widens the gap far past
// what a human's post-shortcut reaction time would ever hit). When the
// effect finally fires, its unconditional `setQuery("")` clobbers the query
// the test just typed back to empty — with an empty query `fuzzy()` matches
// every command trivially (`lib/fuzzy.ts`: `if (n.length===0) return
// {score:0,...}`), so the "active" cursor-0 row becomes whichever curated
// label is shortest ("Import data…" here), not the intended command. This
// applies to ANY palette command, curated or registry-published — it is
// about the OPEN-transition's reset effect racing the test's own fill, not
// about which command source is involved.
//
// A second, related hazard is architecturally real even though this repro
// session didn't happen to catch it in the act: `menuCmds` is captured via
// `useCommands.getState().menuCommands` inside that SAME one-shot effect —
// commands published by a mount-effect publisher (e.g. `useWindowCommands`,
// mounted once from `Stage`) aren't guaranteed to have run by a test's very
// first Control+K. Because the snapshot is one-shot per open, waiting inside
// an ALREADY-OPEN palette can never recover from either hazard — only a
// fresh false->true `cmdkOpen` transition re-runs the effect.
//
// Both hazards are timing artifacts of automation sending keystrokes at
// superhuman speed (sub-millisecond Control+K -> fill, vs. a real user's
// tens-of-milliseconds-minimum reaction time) — not a production bug; see
// the task report for why this was NOT fixed in `src/`.
//
// The fix has two independent properties, both required:
//
// 1. Locate the row by its EXACT accessible text and click it directly —
//    never blind-Enter on whatever's highlighted at cursor 0. Even when the
//    query-clobber race fires, the target command is still present SOMEWHERE
//    in the (now-unfiltered) list — an empty query matches everything, it
//    just stops sorting the intended row to the top. A `hasText` locator
//    finds it regardless of sort position, so this property alone recovers
//    from the clobber race without needing a retry.
//
// 2. Retry the whole open -> type -> locate cycle, closing (Escape) between
//    attempts, until the target row appears at all. This is what recovers
//    from the second hazard (command not published yet): each retry's fresh
//    Control+K forces a new false->true transition, giving the publisher's
//    mount effect more wall-clock time before the next snapshot.

import { expect, type Page } from "@playwright/test";

/** Run a Command Palette command by its exact label. Opens with Control+K,
 *  types `label` to fuzzy-filter, then locates the `.qz-cmdk-item` whose text
 *  CONTAINS `label` (containment, not equality — the row also carries its
 *  shortcut badge, e.g. "New Graph Window⌘⇧N") and clicks it. Retries the
 *  full cycle — closing first — until the row is found, self-healing both
 *  races described above instead of racing them once. */
export async function runPaletteCommand(page: Page, label: string): Promise<void> {
  await expect(async () => {
    // Close first: a no-op if nothing is open, and required on a retry to
    // force the false->true `cmdkOpen` transition CommandPalette's own
    // open-effect keys off — the only thing that re-snapshots menuCommands
    // and re-arms a clean query, instead of reusing whatever this loop's
    // previous attempt left behind.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Type a command…").fill(label, { timeout: 2_000 });
    const item = page.locator(".qz-cmdk-item", { hasText: label }).first();
    await expect(item).toBeVisible({ timeout: 2_000 });
    await item.click();
  }).toPass({ timeout: 10_000 });
}
