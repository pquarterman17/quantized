// Draws the graph's scatter overlays (`PlotView.overlays`: line of fit + band,
// LOWESS smoother, density ellipse) over the live uPlot instance. Off by
// default: with no overlay on this hook does nothing and loads nothing. The
// canvas drawing and the backend call live in the lazy `lib/plotOverlaysDraw.ts`.
//
// The instance is rebuilt by PlotViewport on structural edits, so the draw hook
// is re-attached whenever `plotRef.current` is a new instance (checked after
// every render); it reads the latest results from a ref and a result arriving
// asks the instance for a redraw. A graph the overlays cannot honour (log axis,
// exchanged axes or horizontal bars, waterfall, a thinned payload) draws only the key naming why.

import { useEffect, useRef, useState, type RefObject } from "react";
import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import { overlaysOn, overlaysWire, overlayViewRefusal, type PlotOverlays } from "../../lib/plotOverlays";
import type { OverlayResult } from "../../lib/plotOverlaysDraw";
import type { SeriesStyle } from "../../lib/seriesStyleTypes";

export interface OverlayView {
  xScale: string;
  yScale: string;
  exchangeXY?: boolean;
  waterfall?: number;
  waterfallDx?: number;
}

type DrawMod = typeof import("../../lib/plotOverlaysDraw");
interface Shown { results: OverlayResult[]; refusal: string | null }

export function useScatterOverlays(
  plotRef: RefObject<uPlot | null>,
  payload: PlotPayload | null,
  overlays: PlotOverlays | null | undefined,
  view: OverlayView,
  hidden: readonly boolean[] | undefined,
  styles: readonly (SeriesStyle | undefined)[] | undefined,
): void {
  const shown = useRef<Shown | null>(null);
  const mod = useRef<DrawMod | null>(null);
  const attached = useRef<uPlot | null>(null);
  const [epoch, setEpoch] = useState(0);
  const key = JSON.stringify(overlaysWire(overlays) ?? null);
  const viewRefusal = overlayViewRefusal({ ...view, exchangeXY: !!view.exchangeXY, waterfall: view.waterfall ?? 0, waterfallDx: view.waterfallDx ?? 0, horizontalBars: (styles ?? []).some((s) => s?.bars === "horizontal") });
  const on = overlaysOn(overlays) && payload !== null;

  useEffect(() => {
    if (!on || !overlays || !payload) {
      if (shown.current) {
        shown.current = null;
        plotRef.current?.redraw(false); // clear what was drawn
      }
      return;
    }
    const ctl = new AbortController();
    void (async () => {
      mod.current ??= await import("../../lib/plotOverlaysDraw");
      const m = mod.current;
      const inputs = viewRefusal ? { refusal: viewRefusal } : m.overlayInputs(payload, hidden, styles);
      let next: Shown;
      if ("refusal" in inputs) {
        next = { results: [], refusal: inputs.refusal };
      } else {
        try {
          next = { results: await m.fetchOverlays(inputs, overlays, ctl.signal), refusal: null };
        } catch (err) {
          next = { results: [], refusal: `not drawn: ${err instanceof Error ? err.message : "the request failed"}` };
        }
      }
      // A superseded request (its inputs changed while it ran) never replaces what is shown.
      if (ctl.signal.aborted) return;
      shown.current = next;
      setEpoch((e) => e + 1);
      plotRef.current?.redraw(false);
    })();
    return () => ctl.abort();
    // `overlays` is held by its wire `key`; `hidden`/`styles` by the payload they align to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, payload, viewRefusal, plotRef, hidden?.join(), styles]);

  // After every render: attach the draw hook to a freshly built instance.
  useEffect(() => {
    const u = plotRef.current;
    if (!on || !u || attached.current === u) return;
    attached.current = u;
    (u.hooks.draw ??= []).push((p: uPlot) => {
      const s = shown.current;
      if (s && mod.current) mod.current.drawOverlays(p, s.results, s.refusal);
    });
    if (shown.current) u.redraw(false);
  });
  void epoch;
}
