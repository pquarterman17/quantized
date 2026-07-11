// Peak Analyzer wizard click-on-plot marker editing (interaction plan item 5,
// deferred from closed gap #31): hit-test the wizard's candidate markers
// against a plot click, in PIXEL space so the tolerance stays constant across
// zoom levels — the 2-D point-marker sibling of uplotGadgets' hitTestRoiHandles
// / hitTestCursorHandles (1-D edges) and uplotOverlays' pickRefLine (1-D
// lines). Kept in its own sibling lib rather than uplotGadgets.ts since it's
// peak-wizard-specific, not generic gadget-frame infrastructure — usePeakWizard
// is the only owner of the candidate list this hit-tests against.

import type uPlot from "uplot";

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

/** Marker (center, height) data coords → plot PIXELS via `valToPos` — kept as
 *  a thin, separately-testable step (same idiom as the sibling gadget
 *  plugins' `fakeU`: a minimal `{valToPos}` stub stands in for uPlot). */
export function peakMarkerPixels(
  u: Pick<uPlot, "valToPos">,
  markers: readonly PeakMarkerCandidate[],
): (PeakMarkerCandidate & { x: number; y: number })[] {
  return markers.map((m) => ({
    ...m,
    // CSS px relative to u.over (same frame as the pointer's clientX-rect
    // math) — NOT the `true` canvas-pixel form, which is DPR-scaled and
    // bbox-offset (review 2026-07-11: same fix as uplotAnchors; this file
    // was the template the bug was cloned from).
    x: u.valToPos(m.center, "x"),
    y: u.valToPos(m.height, "y"),
  }));
}

/** Which marker (given in PIXELS, from `peakMarkerPixels`) the pointer (also
 *  pixels) is nearest to, within `tol` px — Euclidean, since a marker is a
 *  POINT (not an edge/line, so the tolerance is a circle around it rather
 *  than hitTestRoiHandles/hitTestCursorHandles's 1-D band). Nearest wins; an
 *  exact-distance tie keeps the earlier (lower-index) marker. Null when
 *  nothing is within tolerance, including an empty marker list. */
export function hitTestPeakMarkers(
  markers: readonly { index: number; x: number; y: number }[],
  pointer: { x: number; y: number },
  tol = 8,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const m of markers) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    const d = Math.hypot(m.x - pointer.x, m.y - pointer.y);
    if (d <= tol && d < bestDist) {
      bestDist = d;
      best = m.index;
    }
  }
  return best;
}

/**
 * Wizard-scoped plot plugin (step ② only — see PlotStage's `peakWizardEdit`
 * prop, sourced from the store bridge usePeakWizard maintains). A plain click
 * (mousedown+mouseup with < 6px movement, matching the gadget plugins'
 * click-vs-drag threshold) either removes the marker under the pointer or
 * adds a new candidate at the clicked x; a genuine drag (box zoom, pan) is
 * left alone. Markers themselves are NOT drawn here — they already ride the
 * existing `setPeakOverlay` points series (`withPeakOverlay` in
 * plotdata.ts) — this plugin only owns the click gesture plus a
 * crosshair/pointer cursor swap for affordance. Composes unconditionally of
 * `tool` (like wheelZoomPlugin), since the interaction is wizard-scoped, not
 * toolbar-tool-scoped.
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
          const hit = hitTestPeakMarkers(peakMarkerPixels(u, markers), pointer, tol);
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
            if (moved >= 6) return; // a drag (box zoom / pan) — not a click
            const hit = hitTestPeakMarkers(peakMarkerPixels(u, markers), up, tol);
            if (hit != null) opts.onRemove(hit);
            else opts.onAdd(u.posToVal(up.x, "x"));
          };
          document.addEventListener("mouseup", onUp);
        });
      },
    },
  };
}
