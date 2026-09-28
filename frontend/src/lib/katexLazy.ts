// On-demand KaTeX for the equation preview (audit P2.7 stretch). The renderer
// (lib/katexRender.ts: KaTeX + its stylesheet + fonts) is fetched the first
// time a preview has something to draw, never at startup. This dynamic
// import() is the only way in; `architecture.test.ts` pins that, and
// `scripts/check-bundle-size.mjs` would charge a static import to the eager
// budget.
//
// A failed load is not retried (`retryOnFailure: false`): a browser caches a
// failed dynamic `import()` of the same chunk URL for the page's lifetime (see
// `lib/onDemand.ts`), so the preview simply stays empty until a reload.

import { onDemand } from "./onDemand";

/** KaTeX HTML for a LaTeX string, or null when KaTeX refuses it. */
export type TexRenderer = (tex: string) => string | null;

const seam = onDemand<TexRenderer>(() => import("./katexRender").then((m) => m.renderTex), {
  retryOnFailure: false,
});

/** The renderer, loading KaTeX on the first call; later calls share it. */
export function loadTexRenderer(): Promise<TexRenderer> {
  return seam.core();
}

/** Test-only: forget the loaded (or failed) module. */
export function resetTexRendererForTests(): void {
  seam.resetForTests();
}
