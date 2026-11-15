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
// `false` from `desktopClipboardReady` means "no usable native path — use the
// browser clipboard", while a bridge that answers `{ok: false, error}` is a
// real failure the caller must SAY (it throws here), never a silent fallback.
//
// Lazy-only: imported by lib/copyFigureCommand.ts, never by an eager module.

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

/** Can the native clipboard write run? Synchronous `false` (no `await`) when
 *  there is no desktop shell, so a browser click spends no microtask on it. */
export function desktopClipboardReady(): false | Promise<boolean> {
  const api = bridge();
  if (typeof api?.clipboard_probe !== "function" || typeof api.copy_figure_clipboard !== "function") {
    return false;
  }
  return api.clipboard_probe().then(
    (r) => r?.available === true,
    () => false,
  );
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

/** Write the rendered figure through the bridge; resolves to the formats it
 *  wrote. Throws with the bridge's own reason on any failure (fail closed).
 *  A failed SVG render drops the SVG and still copies the PNG — the result's
 *  formats then say so, and the caller must not claim vector. */
export async function copyFigureNative(
  png: Promise<Blob | null>,
  svg: Promise<Blob | null> | null,
  signal?: AbortSignal,
): Promise<NativeClipboardFormat[]> {
  const api = bridge();
  if (typeof api?.copy_figure_clipboard !== "function") throw new Error("desktop clipboard bridge unavailable");
  const [pngBlob, svgBlob] = await Promise.all([png, svg ? svg.catch(() => null) : null]);
  if (!pngBlob) throw new Error("render produced no PNG");
  signal?.throwIfAborted();
  const [pngB64, svgB64] = await Promise.all([toBase64(pngBlob), svgBlob ? toBase64(svgBlob) : ""]);
  signal?.throwIfAborted();
  const result = await api.copy_figure_clipboard(pngB64, svgB64);
  if (result?.ok !== true) {
    throw new Error(typeof result?.error === "string" && result.error ? result.error : "clipboard write refused");
  }
  const formats = Array.isArray(result.formats) ? result.formats.filter((f): f is string => typeof f === "string") : [];
  return formats;
}

/** The user-facing name of what landed — never "vector" unless an SVG did. */
export function describeCopiedFormats(formats: readonly string[]): string {
  if (formats.includes("svg")) return "as vector (SVG) + PNG";
  if (formats.includes("png")) return "as a 300-DPI PNG (not vector)";
  return "";
}
