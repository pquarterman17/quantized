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
// real matplotlib round-trip on the backend.

import { useEffect, useState } from "react";

import { renderFigureHitmap, type FigureSpec } from "../../../lib/api/figures";
import type { FigureHitmap } from "../../../lib/previewmap";

/** Screen-resolution preview; the export uses the document's chosen DPI. */
const PREVIEW_DPI = 110;
const DEBOUNCE_MS = 300;

export interface PreviewRender {
  /** A `data:image/png;base64,...` URL, or null before the first settled render. */
  preview: string | null;
  hitmap: FigureHitmap | null;
  error: string | null;
  busy: boolean;
}

export function usePreviewRender(spec: FigureSpec | null, canonical: boolean): PreviewRender {
  const [preview, setPreview] = useState<string | null>(null);
  const [hitmap, setHitmap] = useState<FigureHitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    const timer = setTimeout(() => {
      renderFigureHitmap({ ...spec, dpi: PREVIEW_DPI })
        .then((map) => {
          if (cancelled) return;
          setHitmap(map);
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
    };
  }, [canonical, spec]);

  return { preview, hitmap, error, busy };
}
