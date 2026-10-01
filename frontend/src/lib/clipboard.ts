// Copy the currently displayed plot to the clipboard as TSV — the fastest way to
// drop exactly what's on screen into Origin / Excel / a notebook. Reads the
// display payload, so it honors the x-axis source, plotted-channel selection,
// waterfall offsets, and any overlays (fit / baseline / peaks). The TSV builder
// is pure + tested; the clipboard write is a thin, capability-guarded wrapper.

import type { PlotPayload } from "./plotdata";

/** Serialize the display payload to tab-separated values with a header row.
 *  Columns are x then each plotted series (overlays included); `null` cells
 *  (gaps / NaN) become empty fields so the row width stays constant. */
export function payloadToTSV(payload: PlotPayload): string {
  const header = [
    payload.xUnit ? `${payload.xLabel} (${payload.xUnit})` : payload.xLabel,
    ...payload.series.map((s) => (s.unit ? `${s.label} (${s.unit})` : s.label)),
  ];
  const cols = payload.data;
  const nRows = cols[0]?.length ?? 0;
  const lines = [header.join("\t")];
  for (let i = 0; i < nRows; i++) {
    lines.push(cols.map((c) => (c[i] == null ? "" : String(c[i]))).join("\t"));
  }
  return lines.join("\n");
}

/** Write text to the clipboard; resolves false when unavailable (insecure
 *  context / permission denied) so callers can surface a status message. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or non-secure context — fall through to false */
  }
  return false;
}

/** Write a PNG blob to the clipboard as an image; resolves false when the async
 *  Clipboard image API is unavailable (e.g. Firefox, insecure context) so callers
 *  can fall back to a toast. */
export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return true;
    }
  } catch {
    /* permission denied / unsupported — fall through to false */
  }
  return false;
}

/** Write text the caller is still BUILDING, without losing the user gesture —
 *  `copyText`'s counterpart to `copyImageAsync`, and it exists for the same
 *  MAIN #35 reason. `store/workbookTransfer.ts`'s Copy has to `await` a
 *  dynamic `import()` of its package builder before it has any text at all;
 *  doing that BEFORE touching the clipboard drops the transient user
 *  activation the Clipboard API requires, and the copy then fails reporting
 *  "clipboard unavailable" when the clipboard was fine. The spec allows a
 *  `ClipboardItem` value to be a promise, so handing the still-pending text
 *  straight to the constructor keeps the write inside the originating
 *  gesture while the chunk and the package are still in flight.
 *
 *  The capability gate is `clipboardImageSupported()`: despite its name it
 *  tests exactly `navigator.clipboard.write` + `ClipboardItem`, which is the
 *  same pair a promise-valued TEXT write needs.
 *
 *  The value handed to `ClipboardItem` is a `Promise<Blob>`, not the bare
 *  `Promise<string>` (2026-09-15 review round 2, finding 3). The spec allows
 *  `DOMString or Blob`, but Blob is the shape every engine that has
 *  `ClipboardItem` at all has accepted since it shipped, and it is what
 *  `copyImage` above and `copyImageAsync`/`copySvgAsync`
 *  (lib/clipboardExtras.ts) already pass. On an engine that refuses the
 *  string shape the `catch` below would drop into the
 *  gesture-losing fallback and this function would silently no-op its whole
 *  reason for existing; wrapping costs one synchronous `.then` registration
 *  and changes no timing (the write still starts in the caller's task).
 *
 *  Fallback — an engine with no `ClipboardItem`, or one that refuses a promise
 *  value — awaits the text and calls `copyText`. That path RE-OPENS the very
 *  window this function exists to close (the gesture can be spent before the
 *  write), so on those engines the behaviour degrades to "might lose the
 *  gesture", not to "never copies". Resolves false if both routes fail. */
export async function copyTextAsync(pending: Promise<string>): Promise<boolean> {
  if (clipboardImageSupported()) {
    const asBlob = pending.then((text) => new Blob([text], { type: "text/plain" }));
    // An engine whose write() resolves WITHOUT reading the value promise never
    // attaches a handler to it, so a build failure would land as an unhandled
    // rejection while the caller's own `await build` still reports the real
    // reason (measured 2026-09-15, review round 2 finding 2). Same guard
    // `copyImageAsync` (lib/clipboardExtras.ts) uses.
    asBlob.catch(() => {});
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": asBlob })]);
      return true;
    } catch {
      /* promise-valued ClipboardItem unsupported, or the text never built */
    }
  }
  try {
    return await copyText(await pending);
  } catch {
    return false;
  }
}

/** Synchronous capability check for the async Clipboard image API — the exact
 *  condition copyImage gates on above, exposed so the plot toolbar (#7) can
 *  disable its "Copy Figure" button with a reason instead of clicking through
 *  to a failure toast on browsers that never support it (Firefox, insecure
 *  contexts). Not a substitute for copyImage's own try/catch: a runtime
 *  permission denial can still happen even when this returns true. */
export function clipboardImageSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined"
  );
}

/** MIME for a vector clipboard copy (MAIN_PLAN #35). */
export const SVG_MIME = "image/svg+xml";

/** Will this browser accept an SVG on the clipboard?
 *
 *  Browsers do NOT allow arbitrary MIME types through `clipboard.write` — the
 *  set is sanctioned, and `image/svg+xml` is outside it almost everywhere
 *  today. `ClipboardItem.supports()` is the standard probe for exactly this
 *  question, so we ask instead of assuming, and offer the option only where the
 *  answer is yes.
 *
 *  Deliberately NOT falling back to writing the markup as text/plain: that
 *  pastes a wall of XML into Word rather than a figure, which is worse than the
 *  option simply not appearing. The PNG copy already covers everyone; a user
 *  who needs vector has "Export figure…". */
export function clipboardSvgSupported(): boolean {
  if (typeof ClipboardItem === "undefined") return false;
  const supports = (ClipboardItem as unknown as { supports?: (t: string) => boolean }).supports;
  // No `supports` at all means an older implementation with a fixed, narrow
  // allowlist that never included SVG — treat that as "no", not "unknown".
  if (typeof supports !== "function") return false;
  try {
    return supports(SVG_MIME) === true;
  } catch {
    return false;
  }
}

// `tableToTSV` (the worksheet "Copy rows") and the pending-render image/SVG
// writes `copyImageAsync` / `copySvgAsync` live in lib/clipboardExtras.ts:
// only lazy modules call them (bundle diet slice 15). Re-exported so no
// importer or test mock of "lib/clipboard" changed.
export * from "./clipboardExtras";
