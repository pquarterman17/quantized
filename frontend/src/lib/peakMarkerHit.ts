// Peak Analyzer wizard click-on-plot marker editing (interaction plan item 5,
// deferred from closed gap #31): hit-test the wizard's candidate markers
// against a plot click, in PIXEL space so the tolerance stays constant across
// zoom levels. Rides the shared point-gesture core (lib/pointGesture) for the
// pixel-frame conversion + nearest-point hit test — this file was the template
// the 2026-07-11 pixel-frame bug was cloned FROM, which is exactly why the
// core now exists once (MAIN #8). What stays here is peak-wizard domain logic:
// the visible-marker projection and the click-only edit plugin — usePeakWizard
// is the only owner of the candidate list this hit-tests against.

import type uPlot from "uplot";

import { CLICK_PX, hitTestPoints, pointPixels, type GesturePoint } from "./pointGesture";

/** A wizard candidate marker tagged with its index into the FULL `candidates`
 *  array (what `removePeak`/`togglePeak` expect — NOT its position among only
 *  the visible/included markers). */
export interface PeakMarkerCandidate {
  index: number;
  center: number;
  height: number;
}

/** The markers actually drawn on the plot: only `included` candidates ride the
 *  `setPeakOverlay` series (see usePeakWizard's marker-overlay effect /
 *  `withPeakOverlay` in plotdata.ts), so only those are clickable for removal.
 *  Pure — no uPlot needed, trivially unit-tested without a plot instance. */
export function visiblePeakMarkers(
  candidates: readonly { center: number; height: number; included: boolean }[],
): PeakMarkerCandidate[] {
  const out: PeakMarkerCandidate[] = [];
  candidates.forEach((c, index) => {
    if (c.included) out.push({ index, center: c.center, height: c.height });
  });
  return out;
}

/** Marker (center, height) data coords → the core's pixel-tagged gesture
 *  points (center→x, height→y), via `pointPixels` — the CSS-px frame contract
 *  lives there. Separately testable with a minimal `{valToPos}` stub. */
export function peakMarkerPixels(
  u: Pick<uPlot, "valToPos">,
  markers: readonly PeakMarkerCandidate[],
): (GesturePoint & { px: number; py: number })[] {
  return pointPixels(
    u,
    markers.map(({ index, center, height }) => ({ index, x: center, y: height })),
  );
}

/**
 * Wizard-scoped plot plugin (step ② only — see PlotStage's `peakWizardEdit`
 * prop, sourced from the store bridge usePeakWizard maintains). A plain click
 * (mousedown+mouseup with < CLICK_PX movement, the shared click-vs-drag
 * threshold) either removes the marker under the pointer or adds a new
 * candidate at the clicked x; a genuine drag (box zoom, pan) is left alone.
 * Markers themselves are NOT drawn here — they already ride the existing
 * `setPeakOverlay` points series (`withPeakOverlay` in plotdata.ts) — this
 * plugin only owns the click gesture plus a crosshair/pointer cursor swap for
 * affordance. Composes unconditionally of `tool` (like wheelZoomPlugin),
 * since the interaction is wizard-scoped, not toolbar-tool-scoped.
 */
export function peakMarkerEditPlugin(
  markers: readonly PeakMarkerCandidate[],
  opts: { onAdd: (x: number) => void; onRemove: (index: number) => void },
  tol = 8,
): uPlot.Plugin {
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        let down: { x: number; y: number } | null = null;
        over.style.cursor = "crosshair";

        over.addEventListener("mousemove", (e: MouseEvent) => {
          if (down) return; // fixed while a click gesture is in flight
          const rect = over.getBoundingClientRect();
          const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          const hit = hitTestPoints(peakMarkerPixels(u, markers), pointer, tol);
          over.style.cursor = hit != null ? "pointer" : "crosshair";
        });

        over.addEventListener("mousedown", (e: MouseEvent) => {
          if (e.button !== 0) return;
          const rect = over.getBoundingClientRect();
          down = { x: e.clientX - rect.left, y: e.clientY - rect.top };

          const onUp = (ev: MouseEvent) => {
            document.removeEventListener("mouseup", onUp);
            const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
            const moved = down ? Math.hypot(up.x - down.x, up.y - down.y) : Infinity;
            down = null;
            if (moved >= CLICK_PX) return; // a drag (box zoom / pan) — not a click
            const hit = hitTestPoints(peakMarkerPixels(u, markers), up, tol);
            if (hit != null) opts.onRemove(hit);
            else opts.onAdd(u.posToVal(up.x, "x"));
          };
          document.addEventListener("mouseup", onUp);
        });
      },
    },
  };
}
