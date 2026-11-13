// The Curve Fit's confidence/prediction band as it rides on the plot's fit
// overlay (`FitOverlay.band`, lib/types.ts). Split out of lib/types.ts (at its
// line pin). Type-only.

/** The band edges, in order: CI low, CI high, then optionally PI low and PI
 *  high, each with its legend label. Every `y` aligns to the overlay's own `y`
 *  (null = no value there). Riding on the overlay means anything that clears
 *  or replaces the curve clears the band with it; lib/plotdata's
 *  `withFitOverlay` draws them, shaded between each low/high pair. */
export type FitBandEdges = { label: string; y: (number | null)[] }[];
