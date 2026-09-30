// "Copy Figure" clipboard item for Word / PowerPoint / Keynote-style paste
// targets (MAIN_PLAN #35, PR #492).
//
// What a paste target actually receives, in one `ClipboardItem`:
//
// - `image/png` — the publication render at the caller's DPI (300). Always
//   present; the copy fails without it (see below).
// - `text/html` — an `<img>` whose src is that SAME PNG as a base64 data URI,
//   with explicit width/height in CSS px (pixels x 96 / DPI) so a 300-DPI
//   render pastes at its physical size instead of 3x oversize. Office apps
//   may pick the HTML flavour over the image one, so it must never carry
//   anything that could render differently from the PNG: it is built ONLY
//   from the PNG.
// - `image/svg+xml` — the vector render, ONLY when the browser advertises
//   that MIME via `ClipboardItem.supports()` and the caller supplied one. The
//   caller renders it with `svg_text_as_paths` (backend
//   `calc.figure_render.savefig_bytes`), so every glyph is an outline and the
//   paste depends on no installed font (the export default writes live
//   `<text>` in DejaVu Sans / cmsy10, which Office machines generally lack).
//
// The paste target chooses among those by its own priority; the key order
// below carries no meaning this code relies on.
//
// Failure isolation. Every value is a pending promise so `clipboard.write()`
// starts inside the click's transient activation (MAIN #35 — the same reason
// `copyImageAsync` exists). Per the Clipboard spec a write whose value promise
// REJECTS fails as a whole, so a failed SVG render would otherwise sink the
// copy. After a failed first write this module therefore retries from what
// actually resolved: PNG + HTML as settled blobs, then the PNG alone (the
// pre-#492 behaviour, for engines that refuse multi-format items). The
// retries run after `await`, so on an engine that enforces transient
// activation strictly they may be refused; that case reports `false` rather
// than claiming a copy. A failed PNG render fails the copy — an SVG-only
// item is not written, since most targets would paste nothing from it.
//
// Cancellation (`signal`): re-checked when each value resolves, so a cancel
// that lands while a render is still pending fails the in-flight write and
// suppresses every retry. A cancel landing after the values resolved, while
// the browser performs the write, is not observable from JS; see
// `copyImageAsync`'s doc in lib/clipboard.ts and `lib/exportActive.ts`.

import { clipboardImageSupported, clipboardSvgSupported, copyImage, SVG_MIME } from "./clipboard";

export interface OfficeGraphicCopy {
  /** The pending publication PNG render. */
  png: Promise<Blob | null>;
  /** The pending text-as-paths SVG render, or `null` when the caller skipped
   *  it (browser does not advertise raw SVG, or the figure is over the
   *  `copySvgBudget` threshold). Offered only when advertised. */
  svg: Promise<Blob | null> | null;
  /** The DPI the PNG was rendered at — sizes the HTML `<img>` in CSS px. */
  pngDpi: number;
  alt?: string;
}

/** CSS reference pixels per inch. */
const CSS_PX_PER_IN = 96;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

/** The PNG's size in CSS px at `dpi`, read from its IHDR chunk (always the
 *  first chunk: bytes 16-23 are big-endian width/height). `null` when the
 *  bytes are not a PNG — the caller then omits the size rather than failing. */
async function pngCssSize(png: Blob, dpi: number): Promise<{ w: number; h: number } | null> {
  const head = new Uint8Array(await png.slice(0, 24).arrayBuffer());
  if (head.length < 24 || PNG_SIGNATURE.some((b, i) => head[i] !== b)) return null;
  if (String.fromCharCode(...head.subarray(12, 16)) !== "IHDR" || !(dpi > 0)) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const scale = CSS_PX_PER_IN / dpi;
  const w = Math.round(view.getUint32(16) * scale);
  const h = Math.round(view.getUint32(20) * scale);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Blob -> base64 data URL. Self-contained on purpose: Office reads the HTML
 *  after this page may be gone, so an object URL would not resolve. */
function pngDataUrl(png: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("clipboard image encoding failed"));
    reader.onerror = () => reject(new Error("clipboard image encoding failed"));
    // Re-typed so the data URL says image/png even if the response blob had
    // no content type.
    reader.readAsDataURL(new Blob([png], { type: "image/png" }));
  });
}

function htmlAttr(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** The `text/html` flavour: the PNG, and nothing else. */
async function officeHtml(png: Blob, dpi: number, alt: string): Promise<Blob> {
  const [src, size] = await Promise.all([pngDataUrl(png), pngCssSize(png, dpi)]);
  const dims = size ? ` width="${size.w}" height="${size.h}" style="width:${size.w}px;height:${size.h}px"` : "";
  const img = `<img src="${src}"${dims} alt="${htmlAttr(alt)}">`;
  return new Blob([`<!doctype html><html><body>${img}</body></html>`], { type: "text/html" });
}

async function tryWrite(values: Record<string, Blob | Promise<Blob>>): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem(values)]);
    return true;
  } catch {
    return false;
  }
}

/** Copy a publication graphic as the multi-format item described in this
 *  module's header. Resolves `false` (never throws) when nothing was copied:
 *  no Clipboard image API, a failed or empty PNG render, a cancel, or every
 *  write refused. */
export async function copyOfficeGraphicAsync(
  source: OfficeGraphicCopy,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!clipboardImageSupported()) {
    await Promise.allSettled([source.png, source.svg]);
    return false;
  }
  const alt = source.alt ?? "Quantized figure";
  // Handlers attached at once: an engine may resolve write() without reading
  // every representation, and an unread rejection must not go unhandled.
  const png = source.png.catch(() => null);
  const svg = source.svg ? source.svg.catch(() => null) : null;
  const settled = async (pending: Promise<Blob | null>, what: string): Promise<Blob> => {
    const blob = await pending;
    if (!blob) throw new Error(`render produced no ${what}`);
    throwIfAborted(signal);
    return blob;
  };

  const pngValue = settled(png, "PNG");
  const values: Record<string, Promise<Blob>> = {
    "image/png": pngValue,
    "text/html": pngValue.then(async (blob) => {
      const html = await officeHtml(blob, source.pngDpi, alt);
      throwIfAborted(signal);
      return html;
    }),
  };
  if (svg && clipboardSvgSupported()) values[SVG_MIME] = settled(svg, "SVG");
  for (const value of Object.values(values)) value.catch(() => {});

  if (await tryWrite(values)) return true;

  // Retry from what resolved (see header): never after a cancel, never
  // without a PNG, and never re-offering the SVG that may be what failed.
  const pngBlob = await png;
  if (!pngBlob || signal?.aborted) return false;
  try {
    const html = await officeHtml(pngBlob, source.pngDpi, alt);
    if (signal?.aborted) return false;
    if (await tryWrite({ "image/png": pngBlob, "text/html": html })) return true;
  } catch {
    /* HTML encoding failed — the PNG alone below still copies the figure */
  }
  if (signal?.aborted) return false;
  return copyImage(pngBlob);
}
