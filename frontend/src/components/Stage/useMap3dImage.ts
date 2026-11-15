// The static 3-D preview's fetch, shared by the Map stage and the waterfall
// workshop's N-curve 3-D section: the server's PNG of `body` (the export's own
// request, only `fmt` changed). The body's JSON is the refetch key -- it holds
// every input the picture depends on -- so identity churn never refetches.
// A refusal comes back as `{ error }` with the server's reason. The picture is a
// data: URL because the app's CSP is `img-src 'self' data:` (a blob: URL is
// blocked).
//
// STALENESS: each result remembers the key it was rendered for. `busy` is true
// whenever the picture held is not the one for the CURRENT body (a new key still
// rendering, or no body at all while the grid regrids) -- the caller dims it and
// must not describe the new inputs under it. Renders hold the server's global
// render lock for seconds on big data, so they are debounced.

import { useEffect, useMemo, useState } from "react";

import { renderMapFigure } from "../../lib/api/mapFigure";
import type { MapFigureSpec } from "../../lib/api/mapFigure";

export type Map3dShot = ({ url: string } | { error: string }) & { key: string };

export const MAP3D_DEBOUNCE_MS = 400;

const dataUrl = (b: Blob): Promise<string> =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error("the 3-D view could not be read"));
    r.readAsDataURL(b);
  });

export function useMap3dImage(body: MapFigureSpec | null): { shot: Map3dShot | null; busy: boolean } {
  const [shot, setShot] = useState<Map3dShot | null>(null);
  const key = useMemo(() => (body ? JSON.stringify(body) : null), [body]);
  useEffect(() => {
    if (!body || key === null) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      renderMapFigure(body, ctl.signal).then(
        // The previous picture stays up (dimmed) until this one is ready.
        (blob) => dataUrl(blob).then((url) => !ctl.signal.aborted && setShot({ url, key })),
        (e: unknown) => {
          if (!ctl.signal.aborted) setShot({ error: e instanceof Error ? e.message : "the 3-D view could not be rendered", key });
        },
      );
    }, MAP3D_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the body's value
  }, [key]);
  return { shot, busy: shot === null || shot.key !== key };
}
