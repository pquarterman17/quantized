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

import { useEffect, useState } from "react";

import { postBlob } from "../../../lib/api/http";

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
 *  it with useMemo): the effect keys on its identity, so a fresh literal per
 *  render would abort and re-arm the render after every settle. */
export function useFigurePreview(path: string, body: object | null): FigurePreview {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!body) {
      setPreview(null);
      setError(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(() => {
      postBlob(path, previewBody(body), controller.signal)
        .then(blobToDataUrl)
        .then(
          (url) => {
            if (cancelled) return;
            setPreview(url);
            setError(null);
            setBusy(false);
          },
          (failure: unknown) => {
            if (cancelled) return;
            setError(failure instanceof Error ? failure.message : "preview failed");
            setBusy(false);
          },
        );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, body]);

  return { preview, error, busy };
}
