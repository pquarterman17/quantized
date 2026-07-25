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

/** Serialize a header row + data rows to TSV (the row-oriented complement to
 *  payloadToTSV — used by the worksheet "Copy rows"). Cells: null/undefined →
 *  empty field, else String(cell) at full precision. */
export function tableToTSV(
  headers: string[],
  rows: (number | string | null | undefined)[][],
): string {
  const cell = (v: number | string | null | undefined): string => (v == null ? "" : String(v));
  const lines = [headers.join("\t")];
  for (const row of rows) lines.push(row.map(cell).join("\t"));
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

/** Write a PNG the caller is still RENDERING, without losing the user gesture.
 *
 *  This exists for MAIN #35: the publication copy has to round-trip through the
 *  server renderer, and `await`ing that before touching the clipboard can drop
 *  the transient user-activation the Clipboard API requires — the copy then
 *  fails for no visible reason. The spec allows a `ClipboardItem` value to be a
 *  *promise*, so handing the pending render straight to the constructor keeps
 *  the write inside the originating gesture while the bytes are still in
 *  flight.
 *
 *  Falls back to awaiting the blob and writing it normally when the browser
 *  rejects a promise value, so a stricter engine degrades to "might lose the
 *  gesture" rather than "never copies". Resolves false if both routes fail. */
export async function copyImageAsync(pending: Promise<Blob | null>): Promise<boolean> {
  if (!clipboardImageSupported()) {
    await pending.catch(() => null); // don't leave an unhandled rejection behind
    return false;
  }
  const asBlob = async (): Promise<Blob> => {
    const blob = await pending;
    if (!blob) throw new Error("render produced no image");
    return blob;
  };
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": asBlob() })]);
    return true;
  } catch {
    /* promise-valued ClipboardItem unsupported, or the render failed */
  }
  try {
    return await copyImage(await asBlob());
  } catch {
    return false;
  }
}

/** Synchronous capability check for the async Clipboard image API — the exact
 *  condition copyImage gates on above, exposed so the plot toolbar (#7) can
 *  disable its "Copy Image" button with a reason instead of clicking through
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

/** Write a PENDING SVG render to the clipboard, keeping the user gesture alive
 *  the same way `copyImageAsync` does. Resolves false when the browser will not
 *  take SVG, so the caller can say why rather than failing silently. */
export async function copySvgAsync(pending: Promise<Blob | null>): Promise<boolean> {
  if (!clipboardSvgSupported()) {
    await pending.catch(() => null); // no unhandled rejection left behind
    return false;
  }
  try {
    const asBlob = (async () => {
      const blob = await pending;
      if (!blob) throw new Error("render produced no image");
      return blob;
    })();
    await navigator.clipboard.write([new ClipboardItem({ [SVG_MIME]: asBlob })]);
    return true;
  } catch {
    return false;
  }
}
