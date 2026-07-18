// Journey (residual #15 item) — on-canvas CHANNEL_DND legend/axis-band drag:
// dragging a channel chip from the Inspector's Channels card onto one of the
// plot's three axis drop bands (bottom = X, left = Y, right = Y2) re-plots it
// through the same store actions the card's own checkboxes use (see
// lib/dragaxis.ts's module doc). This is exactly the native-HTML5-drag +
// conditionally-mounted-drop-target gap jsdom can't cover: dragaxis.test.ts
// and AxisDropZones.test.tsx each exercise `resolveAxisZone`/`resolveAxisDrop`
// or a synthetic dataTransfer stub directly, never a real drag gesture
// arriving at a target that only mounts mid-drag.
//
// Mechanism: `AxisDropZones` (components/Stage/AxisDropZones.tsx) only
// renders its three `.qzk-axis-zone` bands once a CHANNEL_DND drag is
// already in progress over `.qzk-stage` (a nested-enter/leave `depth`
// counter) — so `locator.dragTo(band)` can't resolve the target band's
// bounding box upfront (it doesn't exist until the drag has already
// started). Instead this builds a live `DataTransfer` in-page (the same
// `page.evaluateHandle` pattern `utils/dnd.ts` uses for file drops) and
// dispatches the raw drag-event sequence by hand: `dragstart` on the source
// row (ChannelsCard.tsx's own onDragStart handler populates the
// CHANNEL_DND payload from React's live closure — the test never encodes
// the payload itself), `dragenter`+`dragover` on `.qzk-stage` (mounts the
// bands), then `dragover`+`drop` on the specific band at hand-computed
// coordinates derived from `resolveAxisZone`'s band-sizing constants
// (bottom/left/right strips, `BAND_MIN_PX = 32` — see lib/dragaxis.ts) so
// the drop always lands well inside the target band regardless of the
// stage's actual on-screen size.
//
// Source rows: ChannelsCard.tsx renders one `<label class="qz-check"
// draggable>` per non-X channel (both plotted AND unplotted — unlike the
// legend, which only lists plotted series), which is why it's the drag
// SOURCE here rather than PlotLegend. The fixture (three-channel.csv) has
// three dense (no missing values) Y channels so all three plot by default
// (yKeys stays the "auto" sentinel, null) — "Gamma" is deliberately
// unchecked via the card's own checkbox first so the Y-band sub-test
// exercises a genuinely NON-plotted channel, matching the journey brief.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

interface AxisState {
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
}

async function readAxisState(page: Page): Promise<AxisState> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __qz: { useApp: { getState: () => AxisState } };
        }
      ).__qz.useApp.getState(),
  );
}

/** Drag a ChannelsCard row onto one of the plot's axis bands. `zone` picks
 *  the drop point via the SAME geometry `resolveAxisZone` (lib/dragaxis.ts)
 *  uses: bottom strip -> X, left strip -> Y, right strip -> Y2. */
async function dragChannelOntoAxis(
  page: Page,
  channelLabel: string,
  zone: "x" | "y" | "y2",
): Promise<void> {
  const row = page.locator(".qzk-inspector label.qz-check", { hasText: channelLabel });
  const stage = page.locator(".qzk-stage");
  const box = (await stage.boundingBox())!;

  const point =
    zone === "x"
      ? { x: box.x + box.width / 2, y: box.y + box.height - 5 } // bottom strip
      : zone === "y"
        ? { x: box.x + 5, y: box.y + box.height / 2 } // left strip
        : { x: box.x + box.width - 5, y: box.y + box.height / 2 }; // right strip

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

  // The row's own onDragStart handler (ChannelsCard.tsx) reads this event's
  // dataTransfer and calls setData(CHANNEL_DND, ...) with the real
  // datasetId/channel from React's closure.
  await row.dispatchEvent("dragstart", { dataTransfer });
  // Mounts AxisDropZones' band overlay (depth 0 -> 1).
  await stage.dispatchEvent("dragenter", { dataTransfer, clientX: point.x, clientY: point.y });
  await stage.dispatchEvent("dragover", { dataTransfer, clientX: point.x, clientY: point.y });
  await stage.dispatchEvent("drop", { dataTransfer, clientX: point.x, clientY: point.y });
}

test.describe("Channel-chip drag onto an axis band @core", () => {
  test("drag onto Y, Y2, and X re-plots the channel through the same store actions the Channels card uses", async ({
    page,
  }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
    await waitForDatasetCount(page, 1);
    await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

    // Expand the Channels card (a native <details>/<summary> — starts
    // collapsed, Card defaultOpen=false; the `<summary>` element itself is
    // the click target, located by its text like every other primitive Card
    // header in this suite).
    const channelsBody = page
      .locator(".qz-card")
      .filter({ has: page.locator("summary", { hasText: "Channels" }) });
    await channelsBody.locator("summary").click();
    await expect(channelsBody.locator("label.qz-check")).toHaveCount(3);

    // ── Setup: uncheck "Gamma" so it's a genuinely unplotted channel ──────
    // The data contract splits the x-source (ds.time, from the CSV's first
    // "Time (s)" column) OUT of `ds.data.labels` — so labels/channel indices
    // are Alpha=0, Beta=1, Gamma=2 (no slot for the time column at all).
    // Unchecking Gamma leaves an EXPLICIT yKeys=[0,1] (it no longer matches
    // the dense "all three" default, so it can't collapse to the auto
    // sentinel null — see ChannelsCard.tsx's toggle()).
    //
    // GUI_INTERACTION #17 fixed the layout squeeze this journey used to work
    // around: the row's own `label.qz-check` box (flex:1, minWidth:0) still
    // collapses in the Inspector's fixed 296px column once the modeling-
    // type/role/error selects claim their space, but the checkbox itself no
    // longer shrinks with it (`.qz-check input { flex-shrink: 0 }`,
    // components.css) — only the channel-name text truncates now
    // (ChannelsCard.tsx wraps it in an ellipsis span). A plain center-click
    // uncheck lands on the checkbox correctly.
    const gammaRow = channelsBody.locator("label.qz-check", { hasText: "Gamma" });
    await gammaRow.locator('input[type="checkbox"]').uncheck();
    await expect.poll(async () => (await readAxisState(page)).yKeys).toEqual([0, 1]);

    // ── Drag Gamma onto the Y band: rejoins the dense default (all three
    //    channels plot again), collapsing yKeys back to the "auto" sentinel
    //    (null) — see dragaxis.ts's ensureVisible doc. ──────────────────────
    await dragChannelOntoAxis(page, "Gamma", "y");
    await expect.poll(async () => (await readAxisState(page)).yKeys).toBeNull();

    // ── Drag Alpha onto the Y2 band: joins the secondary axis. ─────────────
    await dragChannelOntoAxis(page, "Alpha", "y2");
    await expect.poll(async () => (await readAxisState(page)).y2Keys).toEqual([0]);

    // ── Drag Beta onto the X band: becomes the new x-axis source. ──────────
    await dragChannelOntoAxis(page, "Beta", "x");
    await expect.poll(async () => (await readAxisState(page)).xKey).toBe(1);
  });
});
