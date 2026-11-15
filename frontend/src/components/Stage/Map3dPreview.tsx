// The Map stage's static 3-D view: the server's matplotlib render of the
// surface / 3-D scatter / 3-D waterfall, shown over the 2-D canvas. Lazy (only
// mounted while a 3-D view is chosen). Static by design -- an interactive
// rotating view is a later lane and needs no dependency here.
//
// The picture is `POST /api/export/map-figure` with the EXPORT's own body
// (`mapFigureBody` + `view3dOptions`) and only `fmt: "png"`, so ⤓ exports
// exactly this. The body carries every input the picture depends on, so its
// JSON is the refetch key; a server refusal (too few points, a waterfall of one
// curve, …) is shown as the reason instead of a stale picture.

import { useEffect, useMemo, useState } from "react";

import { renderMapFigure } from "../../lib/api/mapFigure";
import type { ColormapName } from "../../lib/colormap";
import type { MapPayload } from "../../lib/mapdataFetch";
import type { Map3dView } from "../../lib/mapView3d";
import { mapFigureBody } from "./mapFigureExport";
import { view3dOptions } from "./map3dRequest";

export interface Map3dPreviewProps {
  payload: MapPayload | null;
  /** The grid on screen is the one for the current inputs (see MapStage). */
  fresh: boolean;
  view3d: Map3dView;
  cmap: ColormapName;
  logZ: boolean;
  colorLimits: readonly [number | null, number | null] | null;
  /** Top inset (px): clears the toolbar dock, as the 2-D canvas host does. */
  top: number;
}

const dataUrl = (b: Blob): Promise<string> =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error("the 3-D view could not be read"));
    r.readAsDataURL(b);
  });

type Shot = { url: string } | { error: string } | null;

export default function Map3dPreview({ payload, fresh, view3d, cmap, logZ, colorLimits, top }: Map3dPreviewProps) {
  const [shot, setShot] = useState<Shot>(null);
  const body = useMemo(
    () =>
      payload && fresh
        ? mapFigureBody(
            payload,
            { cmap, logZ, colorLimits, contour: { on: false, levelCount: 0, scale: "linear" }, view3d },
            view3dOptions(view3d, "png", "preview"),
          )
        : null,
    [payload, fresh, view3d, cmap, logZ, colorLimits],
  );
  const key = useMemo(() => (body ? JSON.stringify(body) : null), [body]);

  useEffect(() => {
    if (!body) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      renderMapFigure(body, ctl.signal).then(
        // A data: URL, not a blob: URL -- the app's CSP is `img-src 'self' data:`.
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
    // `key` is the body's value: object identity alone would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div
      data-map3d-preview=""
      aria-busy={!shot}
      style={{ position: "absolute", inset: 8, top, zIndex: 2, display: "grid", placeItems: "center", background: "var(--surface-1)", overflow: "hidden" }}
    >
      {shot && "url" in shot ? (
        <img alt="3-D map preview" src={shot.url} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      ) : (
        <div role={shot ? "alert" : "status"} className="qzk-ds-meta" style={{ padding: 16, maxWidth: 420, textAlign: "center", color: shot ? "var(--danger)" : "var(--text-dim)" }}>
          {shot ? `3-D view not drawn — ${shot.error}` : "Rendering 3-D view…"}
        </div>
      )}
    </div>
  );
}
