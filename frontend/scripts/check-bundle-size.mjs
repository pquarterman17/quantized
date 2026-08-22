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
 *  2026-08-18 — pinned at 905,104 after the bundle-diet pass that followed
 *  four feature lanes (P1.6 import wizard, L metadata/collections, K derived
 *  worksheets, J combine/split) landing the same day and leaving the eager
 *  gate at 853.9 kB against the 854.0 kB pin — effectively zero headroom
 *  with more frontend lanes already queued. Two real reductions, both
 *  behavior-preserving (no new Suspense fallback becomes visible on any hot
 *  path — plot rendering, the worksheet grid, and keyboard shortcuts stay
 *  fully eager):
 *  (1) `askAnnotationText()` and its store moved out of
 *  `components/overlays/AnnotationTextDialog.tsx` into
 *  `store/annotationTextDialog.ts` (the `store/quickPlotWithDialog.ts`
 *  shape) — `components/Stage/useShapeDraw.ts` and `annotationShapeActions.ts`
 *  (the always-eager Stage tree) only ever CALLED `askAnnotationText()`, never
 *  rendered the dialog, but importing it from the component file dragged the
 *  whole dialog — RichLabelInput -> SymbolPalette, the Omega symbol grid —
 *  into the eager graph. The dialog itself is now a `lazyPanel()` in
 *  AppOverlays.tsx, same as SplitDatasetDialog/QuickPlotWithDialog.
 *  (2) `components/primitives/index.tsx`'s barrel re-exported `Card`,
 *  `RichLabelInput`, `SymbolPalette`, `RangeSlider`, and
 *  `BufferedNumberField` as STATIC re-exports alongside `Button`/`Select`/
 *  `StatusDot`/etc. (which genuinely are eager — ConfirmDialog, ParamDialog,
 *  Shell chrome, PlotLegend, PlotResultChips). Every actual consumer of
 *  those five is a lazy Inspector card or workshop panel, but the static
 *  re-export gave them the SAME reachability as `Button`, so Rollup bundled
 *  all five into the eager `primitives` chunk regardless. They now import
 *  straight from their own file (`"../primitives/Card"`, not `"../primitives"`)
 *  and `index.tsx` no longer re-exports them — 21 call sites updated, 0
 *  behavior change (same components, same props, just a different import
 *  path). `RichText` stays barrel-exported: `PlotLegend.tsx` needs it via
 *  that exact barrel and it IS eager.
 *  Measured 865,104 B eager (was 874,393 B on main, 853.9 kB against the old
 *  854.0 kB pin), down ~9.4 kB — real, but under the ~20 kB bar for relying
 *  on found reductions alone with more lanes already queued behind this one.
 *  Per this pass's explicit scope, the remaining gap to a healthy 25-40 kB
 *  cushion is a deliberate, reviewed pin raise (not a silent bump): the four
 *  lanes that exhausted the previous 40 kB slack band were legitimate
 *  feature growth, not accidental bloat, and this ratchet exists to catch
 *  the latter. New pin follows the file's own convention (measured + the
 *  full 40 kB `SLACK`): 865,104 + 40,000 = 905,104, i.e. 883.9 kB — 39.1 kB
 *  of headroom for the lanes already in flight. NEVER raise this again
 *  without the same measure-first discipline — split a panel out or defer a
 *  module instead.
 *
 *  2026-08-21 — 907,264 (886.0 kB) after the Sol Day-6 audit wave
 *  (#194-#199) landed six correctness fixes whose logic is legitimately
 *  EAGER store/lib code: the formula-reference rewrite on column removal,
 *  atomic LockProvider verbs + token-bound saves, relink unknown-verdict
 *  handling, import-wizard multi-X validation, cancellation guards, and
 *  phantom-undo checks. The one lazy-able piece (the desktop lock
 *  wire+adapter, lib/desktopLockBridge.ts + lib/desktopLockProvider.ts) WAS
 *  deferred first via dynamic import in App.tsx (-1.4 kB); the remaining
 *  overage after that split measured 884.0 kB vs the old 883.9 kB budget —
 *  0.1 kB of irreducible synchronous store logic, not a deferrable panel.
 *  Raised by the minimal honest margin (+2.1 kB incl. small headroom)
 *  rather than degrading store code to dodge a tripwire. The next raise
 *  still requires this same written-justification treatment: lazy-chunk
 *  FIRST, raise only for measured, irreducible eager logic.
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
 *  before first paint.
 *
 *  2026-08-22 — 911,872 (890.5 kB) after P1.3 wave 2 Lane C wired
 *  `plotRecipes` into `lib/workspace.ts`'s `parseWorkspace` (the mandated
 *  "run `sanitizeRecipes` on load, drop-malformed-never-throw" contract —
 *  the same validator `plotRecipeMatch.ts`/import-recipe already rely on,
 *  not a second lighter one). `workspace.ts` is a core, synchronous entry
 *  point (both the autosave-restore-on-startup path and the explicit
 *  File > Open path need the full parsed doc before either can proceed), so
 *  the validator it now calls — `lib/plotRecipeIO.ts`'s `sanitizeRecipes`,
 *  ~250 lines of genuinely new per-field structural checks (signature/
 *  mapping/visual), previously reachable only from tests and the
 *  not-yet-wired `plotRecipeMatch.ts` — has no lazy path available within
 *  this lane's scope (deferring `parseWorkspace` itself behind a dynamic
 *  import would mean restructuring every store/App.tsx call site that
 *  awaits it today, which is exactly the store<->workspace integration
 *  slice this lane deliberately does NOT own). Measured 910,848 B eager
 *  (was 907,264 B/886.0 kB the prior pin, itself only 1.9 kB of headroom —
 *  wave 1's new files added zero eager cost since nothing imported them
 *  yet; wiring them in, as this wave was explicitly asked to do, is what
 *  spends it), 3,584 B (3.5 kB) over. `plotRecipeIO.ts`'s OTHER imports
 *  (plotview's `sanitizeAnnotations`/`sanitizeShapes`/`sanitizeRegionShades`/
 *  `isAxisScale`/`LEGEND_POS`/`legendXYOrNull`) cost nothing extra — they're
 *  already eager via `lib/figuredoc.ts`/`lib/techniqueViewMemory.ts`, both
 *  existing `workspace.ts` imports; the delta is genuinely new validation
 *  logic, not duplicated already-shipped code. Raised by the MINIMAL honest
 *  margin, per the 2026-08-21 entry's precedent above (not the 40 kB `SLACK`
 *  constant — that guards the LOWER bound only, forcing a pin-down after a
 *  real win, and is not a sizing convention for a raise): 910,848 + 1,024 =
 *  911,872, ~1 kB of rounding room, nothing banked for future growth. NEVER
 *  raise this again without the same measure-first discipline — split a
 *  panel out or defer a module instead.
 *
 *  2026-08-22 (same day, wave-2 integration) — 919,795 after Lane B's
 *  store/plotRecipes.ts (CRUD + apply orchestration, composed eagerly into
 *  useApp like every other slice) landed on top of the entry above.
 *  Lazy-chunked first, per protocol: only `lib/plotRecipeMatch.ts`
 *  (resolveRecipe) stays behind a dynamic import — `lib/plotRecipe.ts` is
 *  unavoidably eager via the entry above's parseWorkspace wiring, and
 *  converting the slice's dual eager+lazy import of it to a plain static
 *  import at integration measured 0.4 kB SMALLER (the dual shape made
 *  Rollup carve shared deps into their own always-preloaded chunks). The
 *  remaining delta is the slice itself — synchronous store logic of the
 *  same class the 2026-08-21 entry declined to degrade to dodge this
 *  tripwire. Measured 918,771 B; budget = measured + 1,024. Same rule
 *  stands: never raise without measuring, defer panels/modules first.
 *
 *  2026-08-22 (same day, wave-3 Lane D integration) — 924,338 after the
 *  recipe UI (Recipe Manager panel, apply preview+confirm dialog, the
 *  "apply anyway, drop unmatched" opt-in, a global recipe scope, and a
 *  post-import suggestion toast) landed on top of the entry above.
 *  Lazy-chunked first, per protocol, with FOUR variants actually measured
 *  (not assumed) rather than two: (1) KEPT — the global-scope store's boot
 *  hydration (store/globalPlotRecipes.ts) as a dynamic `import()` in
 *  App.tsx measured smaller than a plain static import; (2) KEPT — the
 *  "Save as Plot Recipe…" command's implementation
 *  (components/windows/saveFigureAsRecipe.ts) as a dynamic `import()` from
 *  useWindowCommands.ts measured smaller than inlining it in the
 *  already-eager figureLifecycleUi.ts; (3) REVERTED — routing the Recipe
 *  Manager panel's import/export through new eager wrapper functions (so
 *  the lazy panel itself never touched `lib/plotRecipeIO.ts`/
 *  `lib/plotRecipe.ts` directly) measured 902.5 kB, WORSE than leaving the
 *  panel's lazy module import them directly (901.7 kB) — the wrapper
 *  functions' own home module inherited the same dual-reachability tax one
 *  hop removed; (4) REVERTED — splitting the post-import recipe-suggestion
 *  toast branch into its own dynamically-imported module measured
 *  902.1 kB, WORSE than inlining it in the already-eager
 *  store/importBatchOffers.ts — a small, already-store-only branch does
 *  not clear the fixed per-dynamic-import chunk-boundary cost. Root cause
 *  of the remaining delta, confirmed by diffing exact per-chunk bytes
 *  against the pre-wave build: the Recipe Manager's import/export feature
 *  is the FIRST lazy consumer of `lib/plotRecipeIO.ts`'s `parseRecipe`/
 *  `sanitizeRecipes`, already eager via `lib/workspace.ts`'s synchronous
 *  `parseWorkspace` (2026-08-21 entry) — that new divergent (eager +
 *  lazy) reachability makes Rollup carve `plotRecipeIO.ts` into its own
 *  extra always-preloaded chunk instead of leaving it inlined where it
 *  already lived: `useApp`'s chunk dropped ~4.0 kB while a new
 *  `plotRecipeIO` chunk of ~5.9 kB appeared, a ~1.9 kB net extraction tax
 *  that no further lazy-splitting recovered (see (3)/(4) above). The other
 *  ~1.7 kB is genuinely new, irreducible eager wiring: the "Plot Recipe
 *  Manager…" palette command, the two new `lazyPanel()` entries + their
 *  open-flag store reads in AppOverlays.tsx, and the three new
 *  store/plotRecipes.ts actions (`confirmPendingRecipeApplicationPartial`,
 *  `applyPlotRecipeObject`, `cleanMatchingPlotRecipe`) — synchronous store
 *  logic of the same class the 2026-08-21/22 entries above also declined
 *  to degrade to dodge this tripwire. Measured 923,314 B; budget =
 *  measured + 1,024 = 924,338, ~1 kB of rounding room, nothing banked for
 *  future growth. Same rule stands: never raise without measuring, defer
 *  panels/modules first.
 *
 *  2026-08-22 (same day, wave-3 Lane D code-review round) — 925,527 after
 *  fixing 8 code-review findings on top of the entry above (two orchestrator
 *  rulings replacing the apply-dialog Confirm action and cross-scope Move
 *  with Copy-with-fresh-id; global-scope candidates folded into
 *  matching/suggestion; a hydrate-before-mutate guard on every global-store
 *  mutation; an empty-both-scopes early return before the recipe-suggestion
 *  toast; a broadened toast string; a rejected-file-read `.catch`). Findings
 *  4+6 (global-scope candidates + a single-resolve-per-candidate pass) added
 *  real logic to store/plotRecipes.ts, pushing it back over the 500-line
 *  ceiling — `recipeLibs`/`resolvedCandidates` moved into the ALREADY
 *  eager `store/plotRecipeApply.ts` sibling rather than a new file, and
 *  BOTH placements were actually measured (not assumed): a brand-new sibling
 *  module and merging into the existing one produced the IDENTICAL total,
 *  924,503 B — ruling out a Rollup chunk-boundary "extraction tax" (the
 *  2026-08-22 wave-3 entry's cause) as this round's driver. The +165 B over
 *  the prior 924,338 pin is genuinely new, irreducible eager logic across
 *  the 8 fixes (the global-store merge/hydrate-guard/copy-in additions,
 *  mainly) — no further lazy-split measured smaller; see this file's own
 *  git history for the two variants actually tried. Measured 924,503 B;
 *  budget = measured + 1,024 = 925,527, ~1 kB of rounding room, nothing
 *  banked for future growth. Same rule stands: never raise without
 *  measuring, defer panels/modules first. */
const EAGER_JS_BUDGET = 925_527;

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
