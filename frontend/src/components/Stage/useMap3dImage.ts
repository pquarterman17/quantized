// The static 3-D preview's fetch, shared by the Map stage and the waterfall
// workshop's N-curve 3-D section: the server's PNG of `body` (the export's own
// request, only `fmt` changed). The body's JSON is the refetch key -- it holds
// every input the picture depends on -- so identity churn never refetches.
// Null body = nothing to draw (keeps the last picture). A refusal comes back as
// `{ error }` with the server's reason. The picture is a data: URL because the
// app's CSP is `img-src 'self' data:` (a blob: URL is blocked).

import { useEffect, useMemo, useState } from "react";

import { renderMapFigure } from "../../lib/api/mapFigure";
import type { MapFigureSpec } from "../../lib/api/mapFigure";

export type Map3dShot = { url: string } | { error: string } | null;

const dataUrl = (b: Blob): Promise<string> =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error("the 3-D view could not be read"));
    r.readAsDataURL(b);
  });

export function useMap3dImage(body: MapFigureSpec | null): Map3dShot {
  const [shot, setShot] = useState<Map3dShot>(null);
  const key = useMemo(() => (body ? JSON.stringify(body) : null), [body]);
  useEffect(() => {
    if (!body) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      renderMapFigure(body, ctl.signal).then(
        // The previous picture stays up until this one is ready.
        (blob) => dataUrl(blob).then((url) => !ctl.signal.aborted && setShot({ url })),
        (e: unknown) => {
          if (!ctl.signal.aborted) setShot({ error: e instanceof Error ? e.message : "the 3-D view could not be rendered" });
        },
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the body's value
  }, [key]);
  return shot;
}
