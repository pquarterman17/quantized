// Bundle size ratchet (MAIN_PLAN #29) — the frontend arm of the repo's
// size-ratchet discipline, applied to build output instead of source lines.
//
// WHAT IT MEASURES: the *eager* JavaScript — the entry module plus every
// `modulepreload` chunk Vite emits for it. That is exactly what the browser
// must download and parse before it can paint, so it is the number a user
// feels on launch. It is a better budget than Vite's built-in warning, which
// only looks at the single largest chunk and therefore says nothing about how
// many chunks load eagerly.
//
// WHY A RATCHET, NOT A CAP: the pin only ever moves DOWN. Going over fails the
// build; dropping well under ALSO fails, demanding the pin be lowered, because
// an unlocked gain is one feature away from being spent. That is the same rule
// the MATLAB GUI line-count ratchets and the Python 500-line ceiling enforce —
// if you find yourself raising the pin to go green, that is the ratchet working.
//
// Runs as part of `npm run build`, so CI enforces it with no extra wiring.

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Eager JS budget in bytes: entry + modulepreloads.
 *
 *  2026-08-16 — pinned at 874,461 after the E-c1 extraction pass, booked by
 *  the owner's E-c split ("address the eager bundle budget first" — the
 *  0.2 kB of remaining headroom was one feature away from red). Three
 *  runtime-conditional subtrees left the eager graph, each following the
 *  2026-08-02 MapStage/DocumentWindow precedent: (1) `Inspector` (App.tsx)
 *  — ~45 kB of cards behind a same-class `<aside>` fallback so the grid
 *  column never shifts; (2) `StatStage` + `MultiPanelStage` (PlotStage.tsx)
 *  — alternate stage modes, never the default-plot first paint; (3)
 *  `BackgroundPlotWindow` (WindowCanvas.tsx) — a fresh session has exactly
 *  one focused window, and this renderer drags in the whole
 *  BackgroundAltModes/useStatStage/statRender cluster. Measured 834,461 B
 *  eager, down from 924,777 B — recovers ~88 kB and re-opens the full
 *  40 kB slack band for E-c2 (tile previews) and E-c3 (virtualization).
 *  NEVER raise this — split a panel out or defer a module instead.
 *
 *  2026-08-02 — pinned at 924,977 after moving the Stage cell's Map/
 *  Worksheet tabs and the MDI `MapWindow`/`WorksheetWindow` document-window
 *  content (`components/windows/DocumentWindow.tsx`) to dynamic imports, plus
 *  flag-gating `WhatIsThis` the same way MAIN #29 already gated the workshop
 *  panels. `Stage.tsx` and `DocumentWindow.tsx` each held their own static
 *  `import MapStage ...` / `import WorksheetPane ...`, so both were in the
 *  eager graph even though `stageTab` defaults to `"plot"` and most
 *  workspaces have zero map/worksheet document windows — `MapStage` alone
 *  pulls in `d3-contour` (mapRender.ts -> lib/contour.ts), a real external
 *  dependency with no business loading before first paint. Both call sites
 *  now lazy-import the identical specifiers, so Vite serves them from ONE
 *  shared chunk regardless of which path (tab or document window) is hit
 *  first. `AnnotationTextDialog` and `InteractionHints` were evaluated for
 *  the same treatment and stay eager — see AppOverlays.tsx's header comment
 *  for why. Measured 884,977 B eager (543,714 entry + 244,592 shared store
 *  chunk + ~96,671 B across smaller shared/preload chunks: primitives,
 *  uplotOpts, the split-out `help` store chunk, ParamDialog, ToolWindow,
 *  etc.), down from 917,401 B before this pass — recovers ~53 kB of
 *  headroom for future feature slices. Slack is 40 kB. NEVER raise this —
 *  split a panel out or defer a module instead.
 *
 *  2026-07-26 — pinned at 941,260 after P4.1 made `CalcOnlyApp` (the
 *  `?view=calc` standalone DiraCulator launcher) a dynamic import in
 *  `main.tsx`. It was the last static importer of `CalculatorsContent`'s
 *  whole tab tree (SuperconductorTab, SldTab, VacuumTab, …) outside the
 *  already-lazy in-app `CalculatorsPanel`, so that ~69 kB chunk was riding
 *  the eager entry for every default-view user despite never rendering
 *  there. Measured 901,260 B eager (659,048 entry + 242,212 shared store
 *  chunk), down from 948,378 B (948.4 kB) before the split. Slack is 40 kB
 *  so routine feature work does not churn the pin. NEVER raise this — split
 *  a panel out or defer a module instead.
 *
 *  2026-07-25 — was 972,000 after MAIN #29 split the 25 flag-gated
 *  workshop panels out of `AppOverlays.tsx`. Measured 932,219 B eager
 *  (702,285 entry + 229,934 shared store chunk), down from a single
 *  1,120,960 B chunk before the split: -16.8% of what the browser fetches
 *  before first paint. */
const EAGER_JS_BUDGET = 874_461;

/** Lower the pin once the measurement drops more than this far below it —
 *  otherwise a real extraction silently leaves headroom for the next one to
 *  spend. */
const SLACK = 40_000;

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "..", "..", "src", "quantized", "web");
const indexHtml = join(distDir, "index.html");

let html;
try {
  html = readFileSync(indexHtml, "utf8");
} catch {
  console.error(`bundle-size: no build output at ${indexHtml} — run \`npm run build\` first.`);
  process.exit(1);
}

// Vite emits the entry as `<script type="module" ... src="/assets/x.js">` and
// each statically-reachable shared chunk as `<link rel="modulepreload" ...
// href="/assets/y.js">`. Anything NOT listed here is a lazy chunk fetched on
// demand, which is precisely what we are not charging for.
const eagerRefs = [
  ...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g),
].map((m) => m[1]);

if (eagerRefs.length === 0) {
  console.error("bundle-size: parsed index.html but found no eager JS — has Vite's output format changed?");
  process.exit(1);
}

const files = eagerRefs.map((ref) => {
  // Refs are server-absolute ("/assets/x.js"); strip the leading slash so they
  // resolve inside the dist dir on every platform.
  const path = join(distDir, ref.replace(/^\//, ""));
  return { ref, bytes: statSync(path).size };
});

const total = files.reduce((sum, f) => sum + f.bytes, 0);
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

for (const f of files) console.log(`  ${kb(f.bytes).padStart(10)}  ${f.ref}`);
console.log(`  ${kb(total).padStart(10)}  eager total (budget ${kb(EAGER_JS_BUDGET)})`);

if (total > EAGER_JS_BUDGET) {
  console.error(
    `\nbundle-size: FAIL — eager JS is ${kb(total)}, over the ${kb(EAGER_JS_BUDGET)} budget by ${kb(total - EAGER_JS_BUDGET)}.\n` +
      `Do NOT raise the budget. Make the new code lazy instead: flag-gated panels belong in\n` +
      `AppOverlays.tsx's lazyPanel() list, and anything only needed after a user action can be\n` +
      `a dynamic import(). See MAIN_PLAN.md #29.`,
  );
  process.exit(1);
}

if (total < EAGER_JS_BUDGET - SLACK) {
  console.error(
    `\nbundle-size: FAIL — eager JS is ${kb(total)}, well under the ${kb(EAGER_JS_BUDGET)} budget.\n` +
      `Lower EAGER_JS_BUDGET in frontend/scripts/check-bundle-size.mjs to ${total + SLACK} to lock the gain in.`,
  );
  process.exit(1);
}

console.log(`bundle-size: OK — ${kb(total)} eager, ${kb(EAGER_JS_BUDGET - total)} under budget.`);
