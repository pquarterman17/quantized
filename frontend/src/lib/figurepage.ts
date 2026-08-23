// Figure-page composer (GOTO #4) — page label/grid schema constants shared by
// the eager `.dwk` parse boundary and the (lazy) Figure Page workshop.
//
// SCOPE (narrowed 2026-08-23, C2 bundle pass): this file used to also hold
// the ephemeral editing-session slot model (assign/clear/patch/move/resize +
// the live-session source resolver) — that logic now lives in
// `lib/figurepageActions.ts`, reached only from the Figure Page workshop
// panel (already `lazy()`-gated behind Library.tsx). The three exports below
// stay here because `lib/pageDocument.ts`'s `sanitizeOutput` — part of the
// eager, synchronous `parseWorkspace` boundary (`lib/workspace.ts`) — needs
// them to validate a persisted page's `output.labelFormat`/`labelPos`; that
// one eager edge was dragging figurepageActions.ts's whole ~190-line session
// model (plus its own `lib/figuredoc.ts`/`docRenderable` dependency) into the
// eager graph purely by file co-location. See figurepageActions.ts's own
// header for the verified-no-eager-consumer rationale on everything moved.

// Mirrors the backend's accepted values (calc/figure_page.py).
export const PAGE_LABEL_FORMATS = ["(a)", "a)", "a.", "(A)", "A)", "A.", "none"] as const;
export type PageLabelFormat = (typeof PAGE_LABEL_FORMATS)[number];
export const PAGE_LABEL_POSITIONS = ["nw", "ne", "outside"] as const;
export type PageLabelPosition = (typeof PAGE_LABEL_POSITIONS)[number];

/** UI grid bound (the backend itself caps at 8x8). */
export const PAGE_MAX_GRID = 4;
