// Standalone-view detection (MAIN_PLAN #22 — the DiraCulator launcher). The
// app has no router; a deep-link is just a query param read once at startup
// (mirrors the `?harness` seam in main.tsx). `?view=calc` mounts CalcOnlyApp
// instead of the full App shell (no Library/Stage/Inspector/menubar) — any
// affordance that reaches into a workshop that isn't mounted there (e.g. the
// SLD "→ Reflectivity" seed) must check this and no-op instead of updating
// state nothing renders.

/** True when the SPA was loaded with `?view=calc`. Reads `location.search`
 *  live (cheap, no caching) so it works the same whether checked once at
 *  startup (main.tsx) or from deep inside a workshop tab (SldTab). */
export function isCalcOnlyView(): boolean {
  return new URLSearchParams(window.location.search).get("view") === "calc";
}
