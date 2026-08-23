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
//
// THE ALLOWED REVIEW PROCESS FOR CHANGING THE PIN (both directions), made
// explicit here per R8's own review comment — every history entry below
// already follows it, this just states the rule the entries demonstrate:
//   1. MEASURE first. Run `npm run build` and read this script's own
//      per-chunk printout before touching the pin — never guess a delta.
//   2. A pin RAISE is the last resort, only for measured, irreducible eager
//      logic (new store/session-lifecycle code with no lazy-able panel or
//      module behind it), and is capped at the MINIMAL honest margin:
//      `measured + 1,024` (roughly a kB of rounding room), never the 40 kB
//      `SLACK` constant below — that constant guards the LOWER bound only.
//      Write the justification inline in the history entry (what grew, why
//      it can't be deferred) before raising.
//   3. A pin LOWER happens two ways: this script's own `total <
//      EAGER_JS_BUDGET - SLACK` check FAILS the build once a real reduction
//      opens more than 40 kB of headroom (forcing the lock-in), or a
//      deliberate diet pass lowers it directly to `measured + 1,024` right
//      after landing the reduction, so the gain is never left sitting as
//      spendable slack for the next unrelated feature.
//   4. Either direction: leave a dated entry below naming what moved (or
//      was added) and the exact measured before/after byte counts — never
//      a bare number change with no comment, and never a raise "to make CI
//      green" without having tried a lazy split first.

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
 *  2026-08-22 (same day, R4 code-review follow-up, findings F1/F3/F5) —
 *  921,068 after two BLOCKING two-writer/fail-open fixes in
 *  store/projectLock.ts's `heartbeat()` (F1: re-validate the LIVE store's
 *  path + record identity — token AND instanceId — immediately after the
 *  CAS await and before ANY set(), or a straggler tick resolving after a
 *  project switch, or CAS-succeeding on ANOTHER holder's own
 *  currently-valid token, could silently promote this session onto a lock
 *  it does not own) plus two correctness gaps the same review found (F3:
 *  `openProject`/`takeOverEditing` must reset `unverifiableHeartbeats` on
 *  success, or a carried streak demotes a brand-new session after one
 *  blip; F5: `openAsCopy` must clear path/record/the streak, or a
 *  recovering bridge could silently re-acquire a lock the user explicitly
 *  relinquished). None of the four is a deferrable panel or user-action-
 *  gated module — this is the SAME session-lifecycle store logic the
 *  2026-08-21/22 entries above already established as the irreducible-
 *  eager class; `createInMemoryLockProvider` was extracted to its own
 *  sibling module (store/inMemoryLockProvider.ts) first for the SEPARATE
 *  500-line god-module ceiling, which does not change eager byte count
 *  (same code, still statically imported). Local-variable trims (removed
 *  redundant `startPath`/`startToken` snapshots in favor of the
 *  already-destructured `path`/`token`) recovered only ~4 B — minification
 *  already collapses identifier names, confirming the remaining delta is
 *  real new branching, not naming. Measured 920,044 B; budget = measured +
 *  1,024, same 1 kB rounding-room convention as the two entries above.
 *  NEVER raise this again without the same measure-first discipline —
 *  split a panel out or defer a module instead.
 *
 *  2026-08-22 (same day, R4 round-3 code review, findings F1/F2/F4/F5) —
 *  921,226 after a further BLOCKING two-writer/fail-open fix (F1: a
 *  provider reporting `acquired: true` with `record: null` — a wire
 *  record that failed to parse — was NOT normalized into `unverifiable`
 *  at THREE call sites in store/projectLock.ts, so it could be stored as
 *  `held-by-me`/`record: null`, poisoning `heartbeat()` — stuck forever,
 *  never demoting — and `runSaveWorkspace` — an empty token skips its own
 *  backend check, an ungated write) plus three more correctness gaps (F2:
 *  a third fresh-acquisition site, store/workspaceIO.ts's Save-As success
 *  path, also needed the F3-round-2 `unverifiableHeartbeats` reset; F4: an
 *  ownership pre-check in `heartbeat()` BEFORE calling `provider.refresh`
 *  at all, so a foreign-instanceId record's token is never sent to a real
 *  backend CAS in the first place — closing a remote side-effect the
 *  round-2 post-await re-validation could only ever half-close locally;
 *  F5: `openAsCopy` must also reset `status` to `"unlocked"`, not just
 *  clear path/record, or a phantom "held-by-other-*" status keeps the
 *  Take Over Editing gate acting on a lock this session no longer tracks).
 *  Same irreducible session-lifecycle-store class as every prior entry.
 *  F6 of the SAME review (deduplicating `lib/desktopLockBridge.ts`'s
 *  triplicated acquire/refresh/takeover parsing into one
 *  `parseCasOutcome` helper) was expected to recoup eager bytes but did
 *  NOT move this number at all — `desktopLockBridge.ts`/
 *  `desktopLockProvider.ts` are reached only through `App.tsx`'s dynamic
 *  `import("./lib/desktopLockProvider")` (verified: no static importer
 *  exists anywhere in `src/`), so that file was never part of the EAGER
 *  graph this script measures; the dedup is a real, worthwhile
 *  simplification of a LAZY chunk, just not a lever on this number. The
 *  net effect this round is genuinely a small further RAISE, not the
 *  lowering the review anticipated: measured 920,202 B (up from the prior
 *  920,044 B entry — real new eager branching, not measurement noise);
 *  920,202 + 1,024 = 921,226. Still comfortably inside `SLACK` of the
 *  prior pin, so no forced ratchet-down applies here either direction.
 *  NEVER raise this again without the same measure-first discipline —
 *  split a panel out or defer a module instead.
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
 *  measuring, defer panels/modules first.
 *
 *  2026-08-22 (merge of #208 R4 + the wave-3 recipe-UI branch) — the two
 *  branches above each moved this constant independently (R4: 921,226;
 *  wave 3: 925,527). Both raises were individually measured, approved,
 *  and documented in their entries above; this entry records the single
 *  INTEGRATED re-measurement of the merged tree: 925,435 B eager, so
 *  925,435 + 1,024 = 926,459 per the same minimal-raise convention.
 *
 *  2026-08-23 (R8, POST_SPRINT_INDEPENDENT_REVIEW) — restored real headroom
 *  by measured reduction, not a raise: the pin had drifted to 0.3 kB of
 *  slack (897.9 kB measured against the 898.2 kB pin per R8's problem
 *  statement; re-measured at session start as 926,154 B against this same
 *  926,459 pin — 305 B). Root cause, found by tracing which chunk actually
 *  carried each moved symbol rather than assuming: `lib/api.ts` (the typed
 *  fetch client) had ONE static eager edge — useApp.ts's `fftSpectral`/
 *  `fitModel`/`peaksIntegrate`/`uploadFile` imports — and Rollup ships a
 *  module's code to whichever chunk needs ANY of its exports eagerly, so
 *  ~1,400 lines of lazy-workshop-only calculator/stats/baseline/curvefit/
 *  export-figure/magnetometry/peaks/reflectivity/import-filter/reductions
 *  wrappers, all co-located in that ONE file, were riding along into the
 *  eager `useApp` chunk purely by file co-location — the exact same
 *  mechanism as the 2026-08-18 primitives-barrel finding, just via a
 *  same-file eager/lazy split instead of a re-export barrel. Four
 *  measured, independently-verified moves (each rebuilt and re-measured
 *  before the next):
 *  (1) `components/primitives/index.tsx` barrel: `IconButton`/`MetaRow`/
 *  `SegmentedControl`/`SegOption`/`NumberField`/`Checkbox`/`Switch`/
 *  `SliderRow`/`Pill`/`DataTable` had crept back into the eager barrel
 *  since the 2026-08-18 pass — verified each had ZERO eager consumer (real
 *  grep for an import, not a text match) before moving; each got its own
 *  file, matching Card/RichLabelInput/SymbolPalette's existing convention.
 *  `NumberField` turned out to have exactly one eager consumer
 *  (SqliteQueryDialog.tsx, itself eager per AppOverlays.tsx's own
 *  self-gating-window-event exception) — its own extraction still nets
 *  positive despite a small Rollup chunk-boundary tax. 926,154 -> 924,675 B
 *  (-1,479 B).
 *  (2) Twelve calculator domains still defined directly in lib/api.ts
 *  (reference/units, sld, electrical, optics, vacuum, thermal, diffusion,
 *  electrochemistry, semiconductor, thin-film, superconductor, magnetic —
 *  every DiraCulator Calculators tab) moved to their own `api/<domain>.ts`
 *  siblings (merged into the existing electrical.ts/diffusion.ts/
 *  thinFilm.ts/magnetic.ts where a later addition had already started one,
 *  per that convention). Verified lazy-only per domain (every consumer is
 *  a Calculators tab, itself behind AppOverlays.tsx's lazy
 *  `CalculatorsPanel`) before moving. 924,675 -> 918,760 B (-5,915 B).
 *  (3) `api/stats.ts`'s `statsDescriptive` — the ONE function useApp.ts
 *  needs eagerly out of that file's ~23 — split to its own
 *  `api/statsDescriptive.ts` sibling so the other ~22 (statschooser/
 *  distribution/multivar/variability workshops) lose their eager
 *  reachability; `statsRecommend`/`statsRunTest` (statschooser's "test
 *  chooser", still directly in lib/api.ts) joined stats.ts in the same
 *  move. 918,760 -> 916,811 B (-1,949 B).
 *  (4) The remaining lazy-only lib/api.ts sections: baseline (8 fns),
 *  curvefit (`autoGuess`/`listFitModels`/`bootstrapFit`/`validateEquation`/
 *  `fitEquation`/`findXY`/`scanFitModels` — `fitModel` itself stays, it's
 *  eager), figures (`FigureSpec` + six export/render wrappers —
 *  `exportFigure` turned out to ALSO be eager via
 *  lib/exportFigureCommand.ts's File-menu "Export Figure..." command, but
 *  every function here is a one-line postJSON/postDownload/postBlob
 *  wrapper so the whole file's Rollup chunk measures ~0.5 kB regardless —
 *  negligible, and the other five stay lazy-only), datasetAlgebra,
 *  magnetometry (4 fns), peaks (`findPeaks`/`fitPeak`/`fitMultiPeak` —
 *  `peaksIntegrate` stays, it's eager), reflectivity (3 fns), import
 *  filters (6 fns), and reductions (3 fns) — each verified lazy-only by
 *  real-consumer grep first. `reportEmit`/`reportExport` were ALSO
 *  evaluated and moved to `api/report.ts`, but stay re-exported (unlike
 *  every other move here): `folderOps.ts` (eager, part of the always-
 *  mounted Library) statically imports `pipeline/runTemplate.ts`, which
 *  calls `reportEmit` for real, so that one file is genuinely eager — but
 *  since it holds only those two tiny wrappers with nothing else to drag
 *  along, re-exporting it costs nothing extra, unlike lib/api.ts's old
 *  sprawl. 916,811 -> 915,000 B (-1,811 B).
 *  `lib/api.ts` itself: 1,725 -> 299 lines (architecture.test.ts's
 *  MODULE_PINS, JMP_GAP #14 ratchet, lowered to match).
 *  Net: 926,154 -> 915,000 B, an 11,154 B (10.9 kB) real, measured
 *  recovery — under the file's own 40 kB `SLACK` forced-lower threshold,
 *  so this is a deliberate lock-in, not one the ratchet's under-slack
 *  check would have demanded on its own. Full vitest suite, tsc, and
 *  eslint all green post-move (every relocated symbol's consumers —
 *  including `vi.mock` factories using the `importOriginal` spread
 *  pattern, which silently stop covering a moved export if left pointed
 *  at the old facade path — updated to import from the real new path).
 *  915,000 + 1,024 = 916,024 per the same minimal-raise-margin convention,
 *  applied here to a LOWER. Same rule stands going forward: any new
 *  lib/api.ts wrapper for one of these now-split domains belongs in its
 *  sibling file, never back in lib/api.ts itself — see that file's own
 *  header comment.
 *
 *  2026-08-23 (integrated re-measure, #215 + R8) — R8 above (branch
 *  `claude/r8-bundle-diet`) and #215 (`lib/plotRecipeSchema.ts`: split the
 *  Plot Recipe schema types + version constant out of `lib/plotRecipe.ts`
 *  so `lib/workspace.ts`'s synchronous `parseWorkspace` no longer pulls
 *  the capture implementation eager, letting `store/plotRecipeApply.ts`'s
 *  `recipeLibs()` lazy-load capture+matching together) were developed in
 *  parallel on top of the same pre-#215 `main` and merged independently —
 *  #215 landed first (926,459 budget UNCHANGED, ~1.9 kB recovered but left
 *  under the existing pin rather than locked in, since its own R8 was
 *  explicitly left open for this branch to finish). Rebasing R8 onto
 *  post-#215 `main` was a clean auto-merge everywhere except this file's
 *  own history block and `plans/POST_SPRINT_INDEPENDENT_REVIEW.md`'s
 *  closure log (both additive) — R8's `lib/api.ts` split and #215's
 *  `plotRecipe.ts` split touch disjoint files. Re-measured the INTEGRATED
 *  tree per the same rule this file has followed all along (never reuse a
 *  pre-merge number once the base moved): 913,023 B, a further 1,977 B
 *  below R8's own pre-integration 915,000 B — matching #215's claimed
 *  ~1.9 kB independently. 913,023 + 1,024 = 914,047. Full gates re-run
 *  green on the integrated tree (tsc, eslint, full vitest, this build).
 *  Same rule stands: never raise without measuring, defer panels/modules
 *  first.
 *
 *  2026-08-23 (C2, finishing R8's own re-opened headroom target) — profiled
 *  the integrated eager graph with real sourcemaps (`vite build
 *  --sourcemap`, per-chunk `sources`/`sourcesContent` cross-referenced
 *  against a from-`main.tsx` static-import reachability BFS — never assumed
 *  from file names) rather than guessing from chunk names. The known
 *  flagged candidate (App.tsx's `globalPlotRecipes` dynamic-import comment)
 *  turned out ALREADY RESOLVED by #215/R8: `lib/plotRecipeStorage.ts`,
 *  `store/globalPlotRecipes.ts`, `lib/plotRecipe.ts`/`lib/plotRecipeMatch.ts`,
 *  and the Recipe Manager panel all confirmed as separate, small, genuinely
 *  LAZY chunks (1.5-4.6 kB each, none modulepreloaded) — no further gain
 *  there. The real remaining lever, found by the same reachability method
 *  that caught the `lib/api.ts`/primitives-barrel pattern before: six more
 *  files where ONE small eager-reachable export (directly required by
 *  `lib/workspace.ts`'s synchronous `parseWorkspace`, or called INTERNALLY
 *  by another eager function in the same file — checked explicitly, since a
 *  same-file internal call is invisible to a plain cross-file-importer grep
 *  and produced two false positives ruled out before moving anything:
 *  `lib/foldertree.ts`'s `isSelfOrDescendant`, called by its own eager
 *  `moveFolder`; `lib/quickFigureMapping.ts`'s `roleFilteredYKeys`/
 *  `incompleteErrorNotices`/`axisDisplayName`, called by its own eager
 *  `canCreateQuickFigure`) was dragging a much larger sibling of
 *  edit-only/session-only/fetch-only logic into the eager graph purely by
 *  file co-location — the exact `lib/api.ts` mechanism, just five more
 *  instances of it. Each pure module-boundary move (no behavior change,
 *  verified zero eager consumer for what moved before touching it), each
 *  rebuilt and re-measured before the next:
 *  (1) `lib/pageDocument.ts`: `sanitizePageDocuments`/`sanitizePageDocument`
 *  (needed by `parseWorkspace`) stay; `createPageDocument`/`resolvePagePanel`/
 *  `pagePanelLabels`/`pagePanelLifecycle`/`pagesReferencingFigure`/
 *  `pageDocumentDirty`/`pageDocumentHasUnsavedEdits`/`serializePageDocument`/
 *  `deserializePageDocument` (Figure Page workshop + Library delete-guard
 *  only) moved to new sibling `lib/pageDocumentActions.ts`.
 *  913,023 -> 912,010 B (-1,013 B).
 *  (2) `lib/figurepage.ts`: `PAGE_LABEL_FORMATS`/`PAGE_LABEL_POSITIONS`/
 *  `PAGE_MAX_GRID` (needed by `pageDocument.ts`'s `sanitizeOutput`) stay;
 *  the entire ephemeral editing-session slot model (`emptySlots` through
 *  `resolvePanelSource`, ~190 lines, plus its own `lib/figuredoc.ts`
 *  dependency) moved to new sibling `lib/figurepageActions.ts` — the
 *  Figure Page workshop's only real consumer. 912,010 -> 910,071 B
 *  (-1,939 B).
 *  (3) `lib/mapdata.ts`: `is2DMap`/`canRenderMap` (needed eagerly by
 *  `lib/quickPlot.ts`/`lib/plotSelectedTogether.ts`/`lib/stagetab.ts`/
 *  `components/Stage/Stage.tsx` for import-time Map-tab routing/gating)
 *  stay; the actual heatmap fetch/regrid + RSM axis-key helpers
 *  (`fetchMap`/`buildMapColumns`/`regridNearest`/`hasQSpace`/`rsmAxisKeys`/
 *  `MapPayload`, MapStage-only) moved to new sibling `lib/mapdataFetch.ts`.
 *  910,071 -> 907,721 B (-2,350 B).
 *  (4) `lib/quickFigureMapping.ts`: the `QuickFigureMapping` shape + the
 *  create-gate predicates (`mappingReady`/`canCreateQuickFigure` and their
 *  internally-called helpers) stay; the mapping-EDIT actions
 *  (`initialQuickFigureMapping`/`assignmentFor`/`assignQuickFigureColumn`/
 *  `useAcquisitionAxis`, Quick Figure Builder workshop only) moved to new
 *  sibling `lib/quickFigureMappingActions.ts`. 907,721 -> 906,163 B
 *  (-1,558 B).
 *  (5) `lib/datasetsplit.ts`: `pickDefaultSplitColumn` (+ its private
 *  `setpointScore`) — the ONE export here with no consumer in
 *  `store/split.ts`'s eager `splitColumn`/`tooManyGroups`/`sliceDataStruct`
 *  chain, only the lazy SplitDatasetDialog's initial-column suggestion —
 *  moved to new sibling `lib/datasetsplitDefault.ts`. 906,163 -> 905,994 B
 *  (-169 B, the smallest of the five: confirms even a tiny verified move is
 *  never negative here, unlike a fresh dynamic-import boundary's fixed
 *  chunk-overhead tax).
 *  (6) `lib/fitselection.ts`: `FitSelection` + `selectedFitData`/
 *  `fitStepParams`/`fitSpecFromStepParams`/`fitDataForSpec`/`stampRecompute`
 *  (needed by `store/useApp.ts`/`store/recalcFits.ts`/
 *  `components/workshops/pipeline/executeSteps.ts`; `selectedFitData` stays
 *  because `fitDataForSpec` calls it internally) stay; the plotted-channel
 *  helpers + fit-recipe builder (`fullPlottedX`/`plottedYKey`/`fitSpecFrom`/
 *  `finiteRange`/`activeCorrectionNames`, interactive fit workshops only)
 *  moved to new sibling `lib/fitselectionActions.ts`. 906,163 was already
 *  spent by (5); this one measured 905,994 -> 904,976 B (-1,018 B).
 *  Net this pass: 913,023 -> 904,976 B, an 8,047 B (7.9 kB) further real,
 *  measured recovery on top of R8/#215's integrated 913,023 B — 21,178 B
 *  (20.7 kB) below the 926,154 B figure the two parallel branches both
 *  started from, clearing R8's own re-opened "at least 15 kB, ideally
 *  20 kB+" target. `lib/workspace.ts`'s synchronous `parseWorkspace` and
 *  every recipe/template behavior are UNCHANGED — every move above is a
 *  pure module-boundary split with the same exports, same signatures, same
 *  call sites (just a different import path); no new Suspense fallback
 *  becomes visible on any hot path (initial plot, Library, workspace
 *  restore all still resolve through the SAME already-eager entry points).
 *  Full vitest (551 files / 8,261 tests), tsc --noEmit, and eslint all green
 *  post-move. 904,976 + 1,024 = 906,000 per the same minimal-raise-margin
 *  convention, applied here to a LOWER. Same rule stands going forward:
 *  never raise without measuring, defer panels/modules first — and check
 *  for an internal same-file caller before trusting a "no eager importer"
 *  grep, the two false positives above (`isSelfOrDescendant`,
 *  `roleFilteredYKeys`/`incompleteErrorNotices`/`axisDisplayName`) would
 *  have cost a wasted move otherwise.
 *
 *  2026-08-23 (integrated re-measure, C1 #217 + C2) — C2's branch measure
 *  (904,976, budget 906,000) predated C1's relink-consent merge, whose
 *  irreducible eager store/bridge wiring (store/relink.ts consent state,
 *  desktopBridge picker calls, the replaceWorkspace panel-close hook)
 *  added a measured +894 B. Integrated tree: 905,870 B; budget re-set to
 *  measured + 1,024 = 906,894 — still 19.3 kB below the 926,154 B the R8
 *  campaign started from, C2's ">= 15 kB, preferably 20 kB+" verdict
 *  unchanged at 20,284 B recovered.
 *
 *  2026-08-23 (L0.33 Reimport All, coordinator review round 2, G4/G1) — two
 *  UI-race fixes both landed genuinely irreducible eager weight after
 *  measuring, not padding: (1) F4's restored `|| reimportAllBusy` mount
 *  gate in AppOverlays.tsx (a saved-bytes trim had made the dialog's
 *  "staging…" state unreachable in the real app); (2) G1's `cancelReimportAll`
 *  action (store/reimportAll.ts) plus G2's `reimportAllCommitted` field,
 *  both required so closing the report mid-stage genuinely cancels it
 *  (bumps the generation cell) instead of letting a superseded stage
 *  silently reopen and chain a commit the user already dismissed, and so
 *  the dialog can tell a partial success apart from an outright refusal.
 *  Neither is a panel or a lazy-import candidate — both are tiny, always-
 *  needed store surface, same class as the generation cell they extend.
 *  Measured 907,043 B; budget re-set to measured + 1,024 = 908,067 per the
 *  same minimal-raise-margin convention — still 18.1 kB below the 926,154 B
 *  the R8 campaign started from. Full vitest, tsc --noEmit, and eslint all
 *  green post-raise.
 *
 *  2026-08-23 (browser multi-tab lock, `claude/browser-tab-lock`) — the new
 *  `lib/browserLockProvider.ts` module itself is NOT eager (dynamic
 *  `import()` in App.tsx's non-desktop branch, same lazy shape as the
 *  existing `lib/desktopLockProvider.ts` install — verified in the build
 *  output: no `browserLockProvider` chunk appears in either the entry script
 *  or the modulepreload list). The one genuinely eager addition is the
 *  install-site wiring itself: a second `useEffect` in the always-eager
 *  `App.tsx` root component (the `hasDesktopShell()` check plus the
 *  `import()`/`.then()`/`setProvider()` call). This is irreducible per this
 *  file's own rule — it IS the lazy-import boundary, so it cannot itself be
 *  deferred behind another one, and it is a few lines of always-needed
 *  session-lifecycle glue, the same class of unavoidable eager cost the
 *  2026-08-21/22/23 entries above already established (atomic LockProvider
 *  verbs, the Reimport All cancellation guard) rather than a deferrable
 *  panel. Measured 908,253 B (was 907,043 B); budget re-set to measured +
 *  1,024 = 909,277 per the same minimal-raise-margin convention — still
 *  17.1 kB below the 926,154 B the R8 campaign started from. Full vitest
 *  (554 files / 8,414 tests), tsc --noEmit, and eslint all green post-raise. */
const EAGER_JS_BUDGET = 909_277;

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
