// The debounced server-rendered PNG preview + its element hit-map.
//
// Extracted from useFigureBuilder.ts, which sits on a hard module-size pin
// that every new canonical slice funds by moving a cohesive block out first
// (legacyFigure.ts for F2.3d, useGraphTemplates.ts for F2.3e). This block is
// self-contained by construction: a request spec in, four pieces of render
// state out, and the ONLY writer of any of them.
//
// The 300 ms debounce is what makes a live WYSIWYG preview affordable — every
// keystroke in a property panel produces a new spec, and each render is a
// real matplotlib round-trip on the backend. Two more things keep it cheap:
// the request rides the dataset-handle cache (lib/api/datasetCache.ts), so the
// dataset crosses the wire once and a short handle after that; and a render
// superseded by a newer spec (or an unmount) is ABORTED, not just ignored --
// the server skips a render whose client has gone by the time it holds the
// matplotlib render lock, so a stale preview does not delay the fresh one.

import { useEffect, useState } from "react";

import { renderFigureHitmap, type FigureSpec } from "../../../lib/api/figures";
import type { FigureHitmap } from "../../../lib/previewmap";
import { previewDpiFor } from "./previewSizing";

// Screen-resolution preview, sized to the figure (previewSizing.ts); the
// export uses the document's chosen DPI.
const DEBOUNCE_MS = 300;

export interface PreviewRender {
  /** A `data:image/png;base64,...` URL, or null before the first settled render. */
  preview: string | null;
  hitmap: FigureHitmap | null;
  error: string | null;
  busy: boolean;
  /** The resolution `preview` was rendered at (its pixels / inch), so the
   *  view can recover the figure's physical size from the hit-map's pixels. */
  previewDpi: number | null;
}

export function usePreviewRender(spec: FigureSpec | null, canonical: boolean): PreviewRender {
  const [preview, setPreview] = useState<string | null>(null);
  const [hitmap, setHitmap] = useState<FigureHitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewDpi, setPreviewDpi] = useState<number | null>(null);

  useEffect(() => {
    if (!spec) {
      setPreview(null);
      // Legacy mode deliberately keeps its last hit-map and busy flag on a
      // momentarily-absent spec; a canonical session clears them, because an
      // unrenderable canonical draft must not leave a stale hit-map that
      // click-to-focus would test against a picture no longer on screen.
      if (canonical) {
        setHitmap(null);
        setBusy(false);
      }
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setBusy(true);
    const dpi = previewDpiFor(spec, typeof window === "undefined" ? 1 : window.devicePixelRatio);
    const timer = setTimeout(() => {
      renderFigureHitmap({ ...spec, dpi }, controller.signal)
        .then((map) => {
          if (cancelled) return;
          setHitmap(map);
          setPreviewDpi(dpi);
          setPreview(`data:image/png;base64,${map.image}`);
          setError(null);
        })
        .catch((failure) => {
          if (!cancelled) setError(failure instanceof Error ? failure.message : "preview failed");
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [canonical, spec]);

  return { preview, hitmap, error, busy, previewDpi };
}
