// The Curve Fit's confidence/prediction band as it rides on the plot's fit
// overlay (`FitOverlay.band`, lib/fitTypes.ts). Split out of lib/types.ts (at its
// line pin). Type-only.

/** The band edges, in order: CI low, CI high, then optionally PI low and PI
 *  high, each with its series label. Every `y` aligns to the overlay's own `y`
 *  (null = no value there). Riding on the overlay means anything that clears
 *  or replaces the curve clears the band with it; lib/plotdata's
 *  `withFitOverlay` draws them, shaded between each low/high pair.
 *
 *  `legend` is the edge's legend text when it is not its label: a band is ONE
 *  legend entry (on its lower edge: "95% confidence band"), so its upper edge
 *  carries "" (no row — on screen and in the export alike). Four rows named
 *  low/high per level, each in a palette colour the band is not drawn in, was
 *  what the legend showed before. */
export type FitBandEdges = { label: string; y: (number | null)[]; legend?: string }[];
