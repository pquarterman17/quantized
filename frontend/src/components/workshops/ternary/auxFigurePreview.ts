// The debounced, abortable server-rendered PNG preview shared by the ternary
// and vector-field workshops — figurebuilder/usePreviewRender.ts's shape
// without the hit-map: a request body in, `{preview, error, busy}` out.
//
// "Screen == export" is the contract: `previewBody(body)` is the very body
// the Export button sends, with only the format (PNG) and a screen dpi
// changed, so what the preview shows is what the file will hold. The 300 ms
// debounce keeps a keystroke in the title field from costing a matplotlib
// round-trip, and a render superseded by a newer body (or an unmount) is
// ABORTED, not just ignored, so a stale render never delays the fresh one.

import { useEffect } from "react";

import { postBlob } from "../../../lib/api/http";
import { tokenOf } from "../../../lib/previewKey";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";

/** Screen-resolution preview; the export uses the preset's calibrated dpi. */
export const PREVIEW_DPI = 110;
const DEBOUNCE_MS = 300;

export interface FigurePreview {
  /** A `data:image/png;base64,...` URL, or null before the first settled render. */
  preview: string | null;
  error: string | null;
  busy: boolean;
}

/** The export body restated for the screen: PNG at preview resolution. */
export function previewBody<T extends object>(body: T): T & { fmt: "png"; dpi: number } {
  return { ...body, fmt: "png", dpi: PREVIEW_DPI };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the preview"));
    reader.readAsDataURL(blob);
  });
}

/** `body` must be referentially stable across renders (the workshops derive
 *  it with useMemo): its identity (`tokenOf`) is the preview key, so a fresh
 *  literal per render would abort and re-arm the render after every settle.
 *  Rides the shared workbench shell: the previous image stays on screen
 *  (`busy`) while the next one renders, and a superseded render is aborted. */
export function useFigurePreview(path: string, body: object | null): FigurePreview {
  const shell = useWorkbenchPreview<string>({
    key: body ? `${path}#${tokenOf(body)}` : "",
    delayMs: DEBOUNCE_MS,
    fallbackError: "preview failed",
    run: async (signal) => {
      if (!body) throw new Error("nothing to preview");
      return blobToDataUrl(await postBlob(path, previewBody(body), signal));
    },
  });
  const { discard } = shell;
  // No body: forget the old image, so a later body never shows it.
  useEffect(() => {
    if (!body) discard();
  }, [body, discard]);

  return {
    preview: body ? (shell.latest?.value ?? null) : null,
    error: shell.error || null,
    busy: shell.loading,
  };
}
