// The lazy-only half of lib/clipboard.ts (bundle diet slice 15): the
// worksheet's row-table TSV and the pending-render image/SVG writes. Only
// lazy modules call these (the worksheet view, the Copy Figure command), while
// the eager plot toolbar, plot actions and palette need just the plain
// text/PNG writes and the capability probes, so the code moved here verbatim.
// clipboard.ts re-exports everything here with `export *`, so importers and
// test mocks of "lib/clipboard" are unchanged, and Rollup bundles this file
// with the lazy chunks that use its names. architecture.test.ts
// ("re-exported lazy half") keeps eager modules off it.

import { clipboardImageSupported, clipboardSvgSupported, copyImage, SVG_MIME } from "./clipboard";

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
 *  gesture" rather than "never copies". Resolves false if both routes fail.
 *
 *  `signal` (P3.4 safe-cancel-for-export residual, optional): re-checked a
 *  second time here, but narrower than it first looks. `asBlob()` runs
 *  EAGERLY — it is invoked synchronously by `new ClipboardItem({ "image/png":
 *  asBlob() })` below, so this check happens one microtask after `pending`
 *  settles, NOT at "the browser's own read" of the value promise. It closes
 *  only the gap between `postBlob`'s own check (lib/api/http.ts) returning
 *  and this function building the `ClipboardItem`. A cancel that lands AFTER
 *  that — while the browser is still reading the value promise, or actually
 *  performing the write — is not observable from this module (there is no
 *  JS hook for either half, on any engine), and the clipboard write
 *  completes regardless. See `lib/exportActive.ts`'s post-`fn` abort check
 *  for how that residual is reported to the user rather than mis-reported as
 *  "cancelled". */
export async function copyImageAsync(pending: Promise<Blob | null>, signal?: AbortSignal): Promise<boolean> {
  if (!clipboardImageSupported()) {
    await pending.catch(() => null); // don't leave an unhandled rejection behind
    return false;
  }
  const asBlob = async (): Promise<Blob> => {
    const blob = await pending;
    if (!blob) throw new Error("render produced no image");
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
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

/** Write a PENDING SVG render to the clipboard, keeping the user gesture alive
 *  the same way `copyImageAsync` does. Resolves false when the browser will not
 *  take SVG, so the caller can say why rather than failing silently.
 *  `signal` — see copyImageAsync's own doc: the same eager `asBlob()` re-check,
 *  the same residual (a cancel landing after that check still lets the write
 *  complete). */
export async function copySvgAsync(pending: Promise<Blob | null>, signal?: AbortSignal): Promise<boolean> {
  if (!clipboardSvgSupported()) {
    await pending.catch(() => null); // no unhandled rejection left behind
    return false;
  }
  try {
    const asBlob = (async () => {
      const blob = await pending;
      if (!blob) throw new Error("render produced no image");
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      return blob;
    })();
    await navigator.clipboard.write([new ClipboardItem({ [SVG_MIME]: asBlob })]);
    return true;
  } catch {
    return false;
  }
}
