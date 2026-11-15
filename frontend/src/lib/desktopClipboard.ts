// Native "Copy figure" clipboard (gap-4 G14) — the frontend half of
// quantized/desktop_bridge_clipboard.py's `DesktopClipboardBridge`.
//
// Under `qz --desktop` on Windows (with QZ_WIN_CLIPBOARD=1 and pywin32) the
// bridge writes the Windows clipboard itself: the text-as-paths SVG as the
// registered "image/svg+xml" format (Microsoft 365 Word/PowerPoint paste it as
// a scalable, editable graphic), the 300-DPI PNG as "PNG", and a CF_DIB. No
// EMF: there is no permissive SVG/matplotlib-to-EMF converter (see the Python
// module's doc), so Office 2016 and older paste the PNG.
//
// The renders come from the SAME server renderer File ▸ Export uses; this
// module only moves their bytes. Same family rules as desktopBridge.ts:
// `nativeClipboardReady() === false` means "no usable native path — use the
// browser clipboard", while a bridge that answers `{ok: false, error}` is a
// real failure the caller must SAY (it throws here), never a silent fallback.
//
// Readiness is probed ONCE, at startup (`primeNativeClipboard`, from App.tsx's
// desktop-shell effect), and read synchronously at click time. A probe
// round-trip in the click would put a bridge `await` in front of the BROWSER
// clipboard write on every desktop shell where the native path is off
// (macOS/Linux WebKit, Windows without the flag) — and WebKit refuses a
// `clipboard.write` that has left the click's activation.
//
// Lazy-only: imported by copy commands and App.tsx's dynamic import.

/** The formats the bridge reports writing: "svg" | "png" | "dib". */
export type NativeClipboardFormat = string;

interface ClipboardBridgeApi {
  clipboard_probe?: () => Promise<Record<string, unknown>>;
  copy_figure_clipboard?: (pngB64: string, svgB64: string) => Promise<Record<string, unknown>>;
}

function bridge(): ClipboardBridgeApi | null {
  const w = globalThis as { pywebview?: { api?: ClipboardBridgeApi } };
  return w.pywebview?.api ?? null;
}

let nativeReady = false;

/** Probe the bridge once and cache the answer (startup). Never throws; a
 *  missing or failing bridge caches `false`. */
export async function primeNativeClipboard(): Promise<boolean> {
  const api = bridge();
  if (typeof api?.clipboard_probe !== "function" || typeof api.copy_figure_clipboard !== "function") {
    nativeReady = false;
    return false;
  }
  try {
    nativeReady = (await api.clipboard_probe())?.available === true;
  } catch {
    nativeReady = false;
  }
  return nativeReady;
}

/** Synchronous: did the startup probe say the native path can run? */
export function nativeClipboardReady(): boolean {
  return nativeReady && typeof bridge()?.copy_figure_clipboard === "function";
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000; // String.fromCharCode's argument count stays bounded
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export interface NativeCopyOptions {
  /** An explicit vector request: a failed or missing SVG fails the copy
   *  instead of silently degrading to the PNG. */
  requireSvg?: boolean;
}

/** Write the rendered figure through the bridge; resolves to the formats it
 *  wrote. Throws with the bridge's own reason on any failure (fail closed).
 *  Without `requireSvg`, a failed SVG render drops the SVG and still copies
 *  the PNG — the result's formats then say so, and the caller must not claim
 *  vector. */
export async function copyFigureNative(
  png: Promise<Blob | null>,
  svg: Promise<Blob | null> | null,
  signal?: AbortSignal,
  opts: NativeCopyOptions = {},
): Promise<NativeClipboardFormat[]> {
  const api = bridge();
  if (typeof api?.copy_figure_clipboard !== "function") throw new Error("desktop clipboard bridge unavailable");
  const svgSettled = svg
    ? svg.then(
        (b) => ({ blob: b, error: b ? null : "the SVG render was empty" }),
        (e: unknown) => ({ blob: null, error: e instanceof Error ? e.message : "error" }),
      )
    : Promise.resolve({ blob: null, error: "no SVG was rendered" });
  const [pngBlob, svgOut] = await Promise.all([png, svgSettled]);
  if (!pngBlob) throw new Error("render produced no PNG");
  signal?.throwIfAborted();
  if (opts.requireSvg && !svgOut.blob) throw new Error(`vector render failed: ${svgOut.error}`);
  const [pngB64, svgB64] = await Promise.all([toBase64(pngBlob), svgOut.blob ? toBase64(svgOut.blob) : ""]);
  signal?.throwIfAborted();
  const result = await api.copy_figure_clipboard(pngB64, svgB64);
  if (result?.ok !== true) {
    throw new Error(typeof result?.error === "string" && result.error ? result.error : "clipboard write refused");
  }
  const formats = Array.isArray(result.formats) ? result.formats.filter((f): f is string => typeof f === "string") : [];
  if (opts.requireSvg && !formats.includes("svg")) throw new Error("the clipboard did not take the vector format");
  return formats;
}

/** The user-facing name of what landed — never "vector" unless an SVG did.
 *  Takes native names ("svg"/"png"/"dib") or browser MIME types. */
export function describeCopiedFormats(formats: readonly string[]): string {
  const has = (short: string, mime: string) => formats.includes(short) || formats.includes(mime);
  if (has("svg", "image/svg+xml")) return has("png", "image/png") ? "as vector (SVG) + PNG" : "as vector (SVG only)";
  if (has("png", "image/png")) return "as a 300-DPI PNG (not vector)";
  return "";
}
