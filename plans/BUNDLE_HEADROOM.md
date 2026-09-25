# Bundle headroom campaign

**Current state (2026-09-25, after slice 8 and its review round, rebased onto
Group F `55f0cac9`):** measured **867,284 B** eager against that parent's
**881,369 B** (**−14,085 B**), pin LOWERED **881,442 → 868,308 B**
(`measured + 1,024`), leaving **1,024 B of headroom** by design. Group F (the
bounded clipboard transfer this margin was reserved for) landed first and was
itself 22 B lighter than `3ccf4972`, so it spent none of it. Slice 7 was built and never landed, and the pin was RAISED
three times on 2026-09-20 between slices 6 and 8 (876,469 → 878,182 →
879,420 → 881,442); both are recorded in "Slice 7" below. Slice 8's lasting
finding is not a seam: most of the "chunk-boundary tax" slices 3–5 kept
measuring was Vite's preload lists naming already-loaded chunks, and removing
them (build-time, runtime-neutral) recovered 10.7 kB by itself. See "Slice 8".

**Status:** measured 2026-08-30 on `af88f43`. **Slices 1, 3, 4, 5, 6 and 8
executed; slice 7 built and reverted, never on main** (slice 5 deliberately small — see its ruling on `PlotLegend`; slice
6 ratchets the pin DOWN, the first slice authorized to) (see their sections
below); slice 2 is partially done. Slice 5 is no longer the
`lib/plotRecipeIO.ts` proposal it was reserved for — that candidate was
re-ranked out on the measured evidence below and the number was spent on two
render seams instead.

**Stale as of this document's own first draft** (kept for the record; see the
"What these numbers are NOT" note below and each slice's own measured
section for the numbers actually acted on): `main` sat at ~11 B of CI
headroom against an 889.4 kB eager budget at the time this campaign started,
so any eager addition was blocked then. `check-bundle-size.mjs`'s history
says "splitting is spent as a lever" and prescribes a justified raise
instead; that conclusion was drawn from a **chunk-level** profile, and this
document records a **per-module** one, which changed the picture enough to
be worth acting on.

**Earlier state (2026-09-19, after slice 6, round 2 following adversarial
review):** landed tip **875,445 B** eager against parent `8f79207d`'s
**888,562 B** measured bytes (**−13,117 B**, the largest single-seam win of
the campaign), pin LOWERED from the PRIOR PIN of **920,400 B** to
**876,469 B** (`measured + 1,024`), leaving **1,024 B of headroom** against
the new pin — by design: this slice's own forced-floor check (re-run
unmodified against the unmoved 920,400 pin) already FAILED before the pin
was touched, so the lower was compelled, not merely a deliberate discretionary
diet-and-lock-in choice (round 1 said the opposite; see slice 6's own
section for the correction). The next slice starts from a LOWER pin, not
from banked headroom.

**Earlier current state (2026-09-19, after slice 5):** landed tip **888,562 B**
eager against parent `cee0494f`'s **889,498 B** (**−936 B**), leaving
**31,838 B of headroom** against the unmoved 920,400 B budget. Slice 5 is the
first slice in this campaign whose limit is **not** candidate scarcity but the
ratchet's own LOWER bound — see "The ceiling this campaign has now hit" below
— and the first in which the biggest measured win was **rejected on
user-visible cost rather than on bytes**. Both of those findings outlast the
936 B, and both were the reason slice 6 ranked by the `PlotLegend` ruling
before it ranked by bytes.

**Earlier state (2026-09-18, after slice 4):** slices 3 and 4 are done. Slice
4's real parent is `b50f6602` (`git rev-parse 8a6f49ca^`), not `3f43467b`
(that's `HEAD~2` — the implementer's worktree was rooted there and the commit
was merged forward; `3f43467b`'s numbers below are that pre-merge worktree's,
kept as a labelled per-seam breakdown, not the landed measurement). Measured
against the real pair: landed tip 887,615 B eager against parent `b50f6602`'s
912,824 B (**−25,209 B**), which is **32,785 B of headroom** against the
unmoved 920,400 B budget — the first time this campaign has cleared the
25–40 kB its own history calls healthy. A tree's number is only valid for that
tree; re-measure before quoting it.

**Earlier note (2026-09-18, review round, finding 10):** slice 3 is done.
Budget is 920,400 B, unmoved throughout. Slice 3's own tree (`90ea30fa`)
measures 909,888 B eager against its real parent `e83c0cc8` (see slice 3's
section); the branch tip at the time of this note (`b621c5fa`, after P2.8
round 2 and BUG-016 round 3 landed on top) measures **910,371 B**, headroom
**10,029 B** — a tree's number is only valid for that tree, so re-measure
before quoting it as "today's".

## Reproducing this

The profiler is committed as `frontend/scripts/profile-eager-bundle.mjs`, so
every number below can be regenerated and every slice can measure its own
before/after:

```
cd frontend
npx vite build --sourcemap && node scripts/profile-eager-bundle.mjs
npm run build          # rebuild without maps afterwards
```

Measured on **`af88f43`** (the `main` this plan profiles), Node **v22.22.2**,
npm **10.9.7**, Linux x64. `TOP=n` widens the table.

It attributes minified generated bytes to source modules by walking each eager
chunk's VLQ mappings — a segment owns the generated text from its own column
to the next segment's — over exactly the chunk set `check-bundle-size.mjs`
calls eager (entry script + every `modulepreload`), so the two tools cannot
disagree about the denominator.

Two details there are easy to get wrong, and both were wrong in this script's
first version (found in review): an UNMAPPED segment still ends the preceding
span, or bundler glue gets charged to whichever module precedes it; and
sourcemap columns are UTF-16 code units, so a span must be sliced by column
and then measured with `Buffer.byteLength`, not reported as a unit count under
a "bytes" heading. The attribution core lives in
`frontend/scripts/eagerAttribution.mjs` with regression tests for both in
`src/lib/eagerAttribution.test.ts`.

```
eager chunks:        36
bytes on disk:       913,348
attributed:          897,425  (rest is chunk boilerplate/runtime)
  of which vendor:   241,688 (26.9%)
```

### What these numbers are NOT

**Every per-module figure is an UPPER BOUND on what deferring it could
recover, not expected yield.** A module only frees its attributed bytes if
nothing else eager still pulls it in, and a module that is *split* keeps
whatever share stays on the eager side. Slice headings below give the upper
bound; the measured net delta is TBD until a spike runs.

## Where the eager bytes actually are

| bundled | module | deferrable? |
|--------:|--------|-------------|
| 174,554 | `react-dom` (vendor) | no |
| 51,084 | `uplot` (vendor) | no — the plot is first paint |
| 36,562 | `store/useApp.ts` | only via slice decomposition (P4.1) |
| 12,336 | `lib/uplotOpts.ts` | no — plot rendering |
| 11,234 | `lib/uplotOverlays.ts` | no — plot rendering |
| 9,394 | `lib/plotview.ts` | no — plot model |
| 8,891 | `src/AppOverlays.tsx` | no — it *is* the lazy-panel registry |
| 8,140 | `store/windows.ts` | no |
| 8,041 | `commands/fileCommands.ts` | partially — see slice 2 |
| 7,680 | `commands/analysisCommands.ts` | partially — see slice 2 |
| 7,436 | `react` (vendor) | no |
| 7,121 | `lib/originFigures.ts` | **yes — slice 1** |
| 7,102 | `lib/uplotShapes.ts` | no — plot rendering |
| 7,016 | `store/figureLifecycle.ts` | unclear |
| 6,954 | `lib/plotspec.ts` | no — plot model |
| 6,736 | `lib/figureDocument.ts` | no — workspace parse needs it |
| 6,626 | `commands/plotCommands.ts` | partially — see slice 2 |
| 5,926 | `lib/plotRecipeIO.ts` | partially — slice 5 |
| 5,835 | `lib/contextActions.ts` | no — right-click latency |
| 5,231 | `lib/uplotGadgets.ts` | no — plot rendering |

**241,688 B (26.9%) is vendor** — react-dom 174.5 kB, uPlot 51 kB, react 7.4 kB
and the remainder. That is the single largest fact here and no amount of
splitting touches it.

## Ranked slices

### Slice 1 — split `lib/originFigures.ts` — **DONE**

**Upper bound 7,121 B · measured net eager delta −4.8 kB · MEDIUM risk**

Measured with `scripts/check-bundle-size.mjs` on the same machine, same Node,
back-to-back builds: **890.2 kB → 885.4 kB eager**. Local builds run ~0.9 kB
heavier than CI, so only this DELTA is evidence; on CI it takes the headroom
from ~11 B to ~4.8 kB. The budget pin was NOT raised.

Where the difference went, per `scripts/profile-eager-bundle.mjs`:

| module | before | after |
|--------|-------:|------:|
| `lib/originFigures.ts` | 7,121 | 1,914 |
| `lib/originPanels.ts` | 1,918 | 0 (lazy) |
| `lib/originFigureSelection.ts` (new) | — | 0 (lazy) |
| `lib/originSpatialPanels.ts` (new) | — | 0 (lazy) |
| `store/useApp.ts` | 36,562 | 36,897 |

The gap between the 7,121 B upper bound and the ~4.8 kB realised is exactly
what the caveat above predicted: the eager half keeps the Library row label,
the layer-family grouping, import-time entry construction and the legend-text
helpers `lib/originOverlay.ts` needs (1,914 B), and the store grew a preflight.
`lib/originPanels.ts` came along for free — the split module owns its only
value import.

**Not deferred, and why:** `lib/originOverlay.ts` (3,090 B) is apply-only from
`useApp`'s side, but `lib/plotSelectedTogether.ts` — eager, via
`contextActions`/`plotCommands` — statically imports `buildSelectionOverlay`
from it. Deferring it means splitting that module too; out of scope here.

**Shape of the fix:** the apply body was NOT rewritten. `applyOriginFigure`
keeps its synchronous `void` signature and its whole 190-line body verbatim;
only its ENTRY is gated. A third preflight joins the existing
confirm-then-defer chain: when `originApplyLibs()` is still null it loads the
chunk and re-enters the action, which then finds the modules cached and runs
straight through. One apply, one `set()` sequence, one macro entry, whichever
path it took. Guarded by the same `applySeq` counter the other two preflights
share (`store/originFigureApply.ts`).

**Cost:** the first Origin-figure apply of a session waits one chunk fetch.
Every later apply is synchronous. A prefetch on figure import would erase even
that, at the price of a nondeterministic warm-up in the suite; not taken.

**Original analysis, kept for the record:**

The bound is loose on purpose: `figureLabel`, `figureLayerFamily`, the
`OriginFigureEntry` type and whatever helpers the thin side keeps all stay
eager, so the recoverable figure is strictly less and possibly much less.
Measure it in the spike before committing to the slice.

Previously rejected as a lazy candidate because `useApp.ts` imports 7 symbols
"spread the length of the file". That judged the module as a whole. Per-export
use tells a different story: of its 21 exports, only `figureLabel` and
`figureLayerFamily` are reached at first paint (Library rows and
`libraryHierarchy`). The bulk — `resolveFigurePanels`,
`coincidentOverlayGroups`, `resolveSpatialPanels`, `spatialApplyNotices`,
`originFigureAnnotations`, `originRegionShades`, the legend/curve-style
helpers — runs only when an Origin figure is actually resolved or applied.

Split thin-eager from heavy-lazy, then reach the heavy half through the
`await …Libs()` pattern `store/plotRecipes.ts` already uses.

**Risk:** the heavy half is consumed from `useApp.ts`, so sync actions may
become async, changing caller contracts. This is core Origin project loading
with golden-tested behaviour — it needs its own PR and a careful pass, not a
ride-along.

**Acceptance criteria** — all met; where each is discharged:

1. Inventory every non-test importer and caller of each moved export BEFORE
   moving it; the move is only safe once that list is complete.
   → Done, and it corrected the plan's own premise: most apparent importers of
   `resolveFigurePanels`/`coincidentOverlayGroups`/`originFigureAnnotations`
   etc. were doc-comment MENTIONS, not imports. The real non-test importer set
   is nine files, and `store/useApp.ts` was the only eager consumer of the
   heavy half.
2. Preserve the synchronous public action contract where possible. If an
   action must become async, enumerate and update every caller, and say so
   explicitly in the PR rather than letting the signature change ride.
   → Preserved: `applyOriginFigure` is still `(id, opts) => void`. No caller
   signature changed. Three specs that assert state immediately after a click
   now warm the chunk in a `beforeAll`.
3. One history/macro entry per Origin apply, unchanged across the new async
   boundary — an await must not split one user action into two undo steps.
   → The body is untouched and runs once; asserted directly by "records exactly
   one macro step for a deferred apply".
4. Guard stale completion: if the active workspace or figure changes while the
   heavy chunk is loading, the resolved apply must not land. (Same seq-guard
   shape as `applyEnergyAsWavelength`.)
   → Shares `applySeq`. The obvious test (two chunk-deferred applies) does NOT
   hold this line — both resolve in registration order, so the newer one wins
   either way and the guard can be deleted with the suite still green (checked
   by mutation). The test that does hold it supersedes a chunk-deferred apply
   with one deferred on a slower PENDING SOURCE BOOK, and asserts the stale
   figure leaves no macro entry behind.
5. Cover single-layer, double-Y, spatial panels, annotations/region shades,
   and chunk-load failure.
   → The first four keep their existing `store/useApp.test.ts` coverage (warm
   path). Chunk-load failure, deferral, supersession and retry are new, in
   `store/originApplyLibs.test.ts`; each assertion was mutation-verified.
   `src/architecture.test.ts` gains a guard so a future static import from an
   eagerly-reachable module can't silently undo the split.
6. Report the measured net eager delta (profiler before/after) against an
   UNCHANGED budget pin. If the delta does not clear what the blocked lane
   needs, say so rather than raising the pin quietly.
   → Reported above; pin unchanged at 910,711 B. 4.8 kB of CI headroom is
   enough for the P3.5 workspace recipe-source completeness work this slice was
   cut to unblock, but it is well short of the 25-40 kB this file's own history
   calls healthy. Slices 2 and 3 stay on the table.

### Slice 2 — command metadata vs. handlers — **PARTIALLY DONE**

**Upper bound 22,347 B · measured so far −3,104 B of it · HIGHER risk**

**2026-09-14 (`b749f804`), the first two data points, both exactly this
slice's shape** — the `run` body behind a dynamic `import()`, the metadata
(id/label/description/keywords/section) left eager so the palette, the menus
and Help search are untouched:

| seam | module deferred | loader | measured eager delta |
|---|---|---|---:|
| worksheet reshapes | `lib/worksheetTransformCommands.ts` | `commands/dataCommands.ts` | **−2,645 B** |
| Page setup | `lib/pageSetupCommand.ts` | `commands/plotCommands.ts` | **−459 B** |

Both were measured cumulatively with `npm run build` after `npm ci` and a
`node_modules/.vite` wipe, on `4aafd3a3` (919,781 → 917,136 → … → 910,631 →
910,172 B across the four seams of that commit; the two rows above are the
reshape and Page-setup steps of that chain). `commands/plotCommands.ts` is in
this slice's own table above (6,626 B) and `commands/dataCommands.ts` is the
same axis — the Data-menu half of what `fileCommands`/`analysisCommands`
represent. The remaining bulk (`fileCommands` + `analysisCommands`, and the
rest of `plotCommands`) is untouched, so the slice stays open.

The Page-setup row is also the honest scale check this slice's own text asks
for: −459 B for one command's handler says the prize really is the handlers'
TRANSITIVE imports, not the command files' own bytes.

**2026-09-17 correction — `caa10f88` (round-2 seam-guard review close) recorded
its eager bytes against the wrong parent.** That commit's own body says
"eager JS 910,971 B at `56bb3599` -> 911,040 B here (+69 B)", but
`56bb3599` is `caa10f88^^`, not `caa10f88^` — the real parent
(`git rev-parse caa10f88^`) is `0565b674` (BUG-017's NaN/±Infinity/-0 cell
round-trip), which is two commits later than `56bb3599` and already carries
its own eager growth. Re-measured per `agent_rules.md` (`rm -rf
node_modules/.vite`, fresh `npm ci`, in scratch worktrees, exact bytes via
the eager-`<script type=module>`/`modulepreload` count in `dist/index.html`,
not the rounded kB the build's own `check-bundle-size.mjs` prints):

| tree | eager bytes (exact) |
|---|---:|
| `0565b674` (the real parent) | **912,846** |
| `caa10f88` | **912,915** |

+69 B, which matches the commit body's claimed delta exactly even though its
stated baseline was wrong — the arithmetic the round-3 review flagged as
"impossible" (a −795 B baseline shift against a claimed +69 B addition) does
not reproduce once the baseline is the real parent. Budget stays unchanged at
920,400 B; headroom is 7,485 B. **The pin is not moved.**

**Not in this slice, and not anywhere else yet: a root error boundary.** The
17 `lazy()` sites in `frontend/src` have none (measured 2026-09-15), so a
failed chunk load at a `Suspense` boundary unmounts the React root. Every
`lazy()`-shaped seam added here inherits that. It is a separate task, filed
as `plans/BUGS_AND_ISSUES.md` UX-003 — do not treat "the seam reports its
load failures" as true of `lazy()`-shaped seams.

Especially loose: the metadata (id, label, section, keywords) and the dispatch
seam must stay eager for the palette to list and search commands at all. The
real prize is the handlers' TRANSITIVE imports, which this attribution
credits to those modules rather than to the command files — so the bound says
little about the achievable number. (The spike this line asked for is the
table above; it landed at −3,104 B for two handlers, so the bound remains a
poor predictor and the rest still needs measuring one seam at a time.)

`fileCommands` + `analysisCommands` + `plotCommands` = 22,347 B. The earlier
rejection ("a dynamic import in front of the FIRST PRESS of every keyboard
shortcut") conflates two things: the command **metadata** (id, label, section,
keywords — needed eagerly so the palette can list and search) and the
**handler bodies** (needed only on invocation). Splitting them would keep the
palette instant and cost one import on first invocation per module, cached
thereafter.

Worth a measured spike before committing — the handlers' transitive imports,
not the command files themselves, are where the weight is.

### Slice 3 — three more lazy seams — **DONE (2026-09-18)**

**Measured net eager delta -6,890 B - budget UNMOVED at 920,400 B**

Headroom was 3,682 B (916,718 B eager) after P2.8's durable map-view contract
landed; it was 10,512 B on slice 3's own tree (`90ea30fa`) and 10,029 B on
the `b621c5fa` tip. The bundle pin is NOT edited in either direction,
and the map contract stays fully eager - it was explicitly out of scope.

**Review round correction (finding 3):** the pair below was originally
recorded against `c1757fb1`, the cherry-pick source's parent, not this
commit's real `git rev-parse HEAD~1`, which is `e83c0cc8` (`c1757fb1`'s
chain is 60 B lighter). Restated against the real parent; the delta itself
was already right (−6,890 B either way).

Bundle pair, exact bytes (the eager `<script type=module>` + `modulepreload`
count out of `dist/index.html`, not the rounded kB `check-bundle-size.mjs`
prints), both built in this worktree after `npm ci` with `node_modules/.vite`
wiped before every single build:

| tree | SHA | eager bytes |
|---|---|---:|
| parent (`git rev-parse HEAD~1`) | `e83c0cc8` | **916,778** |
| this commit (its own SHA) | slice 3 | **909,888** |

Cumulative, in the order the seams were measured - each row is a full
`npm run build` on the same machine, same Node, `.vite` wiped. **Measured on
the `c1757fb1` chain** (60 B lighter than the real parent above; the per-seam
deltas are unaffected, only the running totals carry that 60 B offset):

| seam | module deferred | loader | eager B | delta |
|---|---|---|---:|---:|
| parent | - | - | 916,718 | - |
| 1 | `components/windows/PanelPlotWindow.tsx` | `components/windows/WindowCanvas.tsx` | 913,251 | **-3,467** |
| 2 | `components/Stage/PolarStage.tsx` | `components/Stage/PlotStage.tsx` | 910,450 | **-2,801** |
| 3 | `store/plotRecipeApply.ts` | `store/plotRecipeApplyLazy.ts` (new) | 909,828 | **-622** |

Why each qualifies - every one runs strictly after a user action, never on
the default first paint. **Narrowed (review round, finding 4):** seams 1 and
2 are NOT true of a restored session — `polarMode` and `kind: "panel"` are
both persisted `PlotView`/window fields, hydrated straight into the live
singletons on project open (`store/useApp.ts`'s `hydrateView(...)`), so a
project restored **in** polar mode or **with** a panel window pays one chunk
fetch on that restore's first paint, not on a later gesture. No correctness
consequence (nothing reads the suspended frame before the chunk resolves;
`components/windows/lazyRenderSeams.test.tsx` pins exactly this), but the
"never on first paint, hydration, autosave restore or crash recovery" claim
this line originally made was false for those two paths:

1. **Panel windows.** `WindowCanvas`'s `win.kind === "panel"` branch. A panel
   window is either composed by the user in-session or restored from a saved
   `.dwk`/crash-recovery snapshot that already had one; either way it is
   never present on the DEFAULT first paint of a fresh project. `PanelPlotWindow`
   was the only eagerly-reachable importer of `PanelCell` and
   `PanelOverlayWindow`, so all three left together. `lazy()` + `Suspense
   fallback={null}`, the shape `BackgroundPlotWindow` two lines above it
   already uses.
2. **Polar mode.** PlotStage's third runtime-conditional alternate render mode
   and the only one still static (`MultiPanelStage` and `StatStage` were
   already `lazy()`). Entered by the Plot toolbar's polar toggle in-session, or
   already active on a restored project (`polarMode` is a persisted `PlotView`
   field). Takes `PolarStageCore` and `lib/polar.ts` with it.
3. **The Plot Recipe apply core.** `store/plotRecipes.ts` is composed into
   `useApp.ts`, so its static import of `store/plotRecipeApply.ts` - the
   apply/matching half (`resolveApplyOrStage`, `applyResolvedRecipe`,
   `resolvedCandidates`, `recipeLibs`) - was a permanent startup cost for a
   module every entry point into which is a recipe gesture. All seven actions
   that touch it were ALREADY `async`, because `recipeLibs()` lives inside that
   same module and was already awaited first in every one of them, so no public
   signature, return type or await count changed.

`src/architecture.test.ts` gains all three in `SEAMS`, and
`PanelCell`/`PanelOverlayWindow`/`PolarStageCore`/`lib/polar.ts` in
`DRAGGED_OUT`. Measured with the guard's own `eagerlyReachable()` walk against
the real parent `e83c0cc8` (finding 3 correction): 406 eager modules before,
400 after (three seams + four dragged out, minus the one module added -
`store/plotRecipeApplyLazy.ts`, the loader).

**Gesture preservation: not applicable to any of the three.** None writes the
clipboard or opens a file picker, so nothing here needs `copyTextAsync` or the
"start the promise inside the click's own task" discipline seam 3 of the first
diet did. The one candidate that WOULD have needed it is in the rejected list
below, and it was rejected on bytes, not on that.

**Failure reporting.** The `plotRecipeApply` seam rejects the action's own
promise on a chunk that will not load, which is exactly what a failed
`recipeLibs()` (an unguarded `Promise.all` of two dynamic imports, in that same
module) already did from those call sites - the seam adds no new failure MODE
for the five actions that were already unconditionally awaiting `recipeLibs()`
first, and nothing has mutated at that point. **Narrowed (review round, finding
6):** `matchingPlotRecipes`/`cleanMatchingPlotRecipe` (`resolvedCandidates`'s
two callers) now `await applyCore()` BEFORE `resolvedCandidates` short-circuits
on a `"generic"` technique or an empty pool — cases where the OLD code
performed zero dynamic imports and could not reject, so the new code CAN reject
where the old one never did. The only non-test caller is
`store/importBatchOffers.ts`'s recipe-suggestion offer, already wrapped in a
`try { … } catch { /* fall through to the plain toast */ }` (FINDING 3 there,
:150-168), so the user-visible outcome is unchanged — it degrades to the plain
"imported N files" toast, same as "no clean match found" already did. The two
`lazy()` seams inherit the
repo-wide gap: a `lazy()` boundary has no reporting of its own and unmounts the
React root. That is UX-003 in `plans/BUGS_AND_ISSUES.md` for all such sites at
once; it is not something these two introduced or can fix locally.

**Test lesson (review round fix): a component test that counts microtask
ticks after an action breaks once that action crosses a lazy seam.**
`src/components/overlays/PlotRecipeApplyDialog.test.tsx`'s `"Apply mapped
fields" applies the resolved subset, dropping the unmatched field` test drove
`confirmPendingRecipeApplicationPartial` (now behind this slice's
`plotRecipeApply` seam, one `await applyCore()`/dynamic import deeper than
before) with a single `await Promise.resolve();` and then asserted store
state — one microtask tick is no longer enough once the action itself awaits
a dynamic `import()`. Fixed to wait on STATE instead (the weak-wait ratchet's
own rule) in commit `b6282a5b`. Checked the rest of this seam's blast radius
for the same pattern (every `.test.ts(x)` calling `applyPlotRecipe` /
`saveAsPlotRecipe` / `confirmPendingRecipeApplication(Partial)` /
`matchingPlotRecipes` / `cleanMatchingPlotRecipe` / `applyPlotRecipeObject`):
`useWorkspaceAutosave.test.ts` and `store/importBatchOffers.test.ts` also
count fixed ticks (`await Promise.resolve()`, some looped 10x) around these
actions, but both were already generous enough to absorb the extra tick and
stayed green — `PlotRecipeApplyDialog.test.tsx` was the one case that broke.

#### Two seams measured and REJECTED, because they made the bundle BIGGER

**Correction (review round, finding 8):** this was originally headed "three
seams... rejected" — only two of the three rows below were actually rejected.
The third (`plotRecipeApply`) is the seam this slice KEPT; it is in the table
for comparison, not as a rejection.

This is the slice's most transferable finding, and it contradicts the
per-module table at the top of this file. Rollup's default chunking gives a
dynamic-import boundary a real cost: every module the deferred subtree SHARES
with the eager graph has to be carved into its own chunk, and each new chunk
pays import/export glue. Three seams were fully implemented and measured; two
were reverted on the measurement alone, one was kept:

| seam | attributed upper bound | measured |
|---|---:|---:|
| `store/reimport.ts` -> `lib/reimport.ts` + `lib/dependencyImpact.ts` (REJECTED) | 1,830 B | **+1,451 B** |
| `commands/fileCommands.ts` -> `lib/originTemplate.ts` (REJECTED) | 1,063 B | **+222 B** |
| `store/plotRecipes.ts` -> `store/plotRecipeApply.ts` (KEPT) | 2,857 B | **-622 B** (78% of the bound was eaten) |

**Finding 9 reconciliation:** the cumulative table above (seam 3's own row)
and this table disagreed on the kept seam's delta, -622 B vs -617 B, both
from this same file. -622 B is the cumulative table's value (the one measured
directly as that seam's own before/after build pair); this table now uses it
too rather than carrying a second, disagreeing number.

Deferring `lib/reimport.ts` split `lib/plotview.ts` (23.2 kB), `lib/formula.ts`
(10.1 kB), `lib/recalc.ts`, `lib/api`/`lib/api/http.ts`, `lib/figuredoc.ts` and
five smaller modules out into their own still-eager chunks; the module SET
shrank and the byte total went UP. (The two rejected seams were measured on top
of the `plotRecipeApply` one, so their deltas are marginal contributions in
that order - which is the number that decides whether to keep them.)

**The rule this slice adds:** rank candidates by how EXCLUSIVE the deferred
subtree is, not by attributed bytes. The two component seams realised 85% of
their bound (6,268 B of 7,422 B) because a React subtree is mostly its own; the
three `lib`/`store`-level ones realised **-79%** (`store/reimport.ts`:
1,451/1,830), -21% (`fileCommands`) and +22% (`plotRecipeApply`, kept) — the
first of those three was **-22%** here until the review round (finding 9)
caught the error: the file's own numbers above are 1,451 B against a 1,830 B
bound, which is -79%, not -22%. A seam whose target shares
`plotview`/`formula`/`api`-class modules with the entry graph is presumed a
loss until a real build says otherwise.

### Slice 4 — nine content-gated render seams — **DONE (2026-09-18)**

**Measured net eager delta −25,209 B — budget UNMOVED at 920,400 B**

Headroom is **32,785 B** against the unmoved 920,400 B budget, measured on
the landed pair below. The bundle pin is NOT edited in either direction. This
is the first slice whose result clears the 25–40 kB this file's own history
calls healthy.

**Real parent vs the implementer's build chain (2026-09-18 review round,
finding 1):** the commit's real parent is `b50f6602`
(`git rev-parse 8a6f49ca^`), not `3f43467b`. The implementer's worktree was
rooted two commits back at `3f43467b` and the commit was merged forward, so
every number originally recorded in this section — including the per-seam
table below — describes that pre-merge worktree, a tree that was never
committed. The per-seam table is kept because it is still the real,
individually-measured delta of each seam over `3f43467b`'s starting point and
its shape (which seam won how much, in what order) is unaffected by the
mislabel; it is now labelled explicitly as the `3f43467b` chain. The
authoritative before/after pair for this slice's own landed effect is the
`b50f6602` → `8a6f49ca` row below.

Bundle pair, exact bytes (the eager `<script type=module>` + `modulepreload`
count out of `dist/index.html`, not the rounded kB `check-bundle-size.mjs`
prints):

| tree | SHA | eager bytes | built by |
|---|---|---:|---|
| real parent (`git rev-parse 8a6f49ca^`) | `b50f6602` | **912,824** | orchestrator, `npm ci` + `.vite` wiped |
| this commit, as landed | `8a6f49ca` | **887,615** | orchestrator, `npm ci` + `.vite` wiped |
| — net delta — | — | **−25,209** | — |

The `3f43467b` chain below (the implementer's pre-merge worktree, ~1,529 B
lighter at the start than the real parent — the map colour-limits work in
`b50f6602` that chain never contained):

| tree | SHA | eager bytes | built by |
|---|---|---:|---|
| `3f43467b`-chain start (mislabelled "parent"/"`HEAD~1`" originally) | `3f43467b` | 911,295 | implementer, same-worktree `npm ci` + `.vite` wiped |
| `3f43467b`-chain end (pre-merge worktree tip) | slice 4 (pre-merge) | 885,632 | implementer, same-worktree `npm ci` + `.vite` wiped |

#### How the candidates were ranked

The per-module table at the top of this file gives an upper bound but says
nothing about whether a bound is reachable, which is what slice 3's rejected
seams were about. So this slice ranked candidates mechanically first: replay
`architecture.test.ts`'s own `eagerlyReachable()` walk over `src/`, then, for
every eager module with exactly one eager importer, CUT that edge and sum the
attributed bytes of everything that drops out (the **exclusive** bytes) plus
the bytes of everything reachable from the target that stays eager (the
**shared** set slice 3 warns gets carved into its own chunks). Scripts are in
the session scratch, not committed; the walk they replay is the guard's, so it
regenerates from `architecture.test.ts` plus
`scripts/profile-eager-bundle.mjs`.

That produced nine clean zero-shared leaves, four of which were unusable —
`store/graphBuilder.ts` and `store/datasetMeta.ts` are `useApp` slice
CREATORS (their state must exist at store construction), and
`lib/pageDocument.ts`/`lib/workspaceOrigin.ts` hang off `parseWorkspace`,
which is synchronous and would have to become async through every caller.
`lib/figureOverrides.ts` (4,526 B, the single largest zero-shared leaf) is the
same shape: its only eager use is `sanitizeFigureOverrides` inside
`sanitizeFigureDocument`, also a synchronous parse function. None of the five
was built or measured; they are analysis rejections, not measured ones, and
they stay on the table for a slice that is willing to move `parseWorkspace`.

**The ranking's own biggest miss is worth more than its hits, and it
qualifies slice 3's rule.** `components/Stage/PlotContextMenu.tsx` scored
*terribly* on that metric — 228 shared modules, 379 kB of them — so slice 3's
"a seam whose target shares `plotview`/`formula`/`api`-class modules with the
entry graph is presumed a loss" predicted a loss. Built and measured, it is
this slice's **largest single win at −6,328 B, 91% of its 6,985 B bound**.
The reconciliation: that rule was derived from `lib`/`store` seams, where the
shared modules are mid-graph and really do get carved out. A React component
seam's shared set is dominated by `useApp` and the entry-wide libraries, which
are *already* shared with dozens of other eager modules and therefore stay
exactly where they were. **Restated rule: rank a `lib`/`store` seam by the
exclusivity of its deferred subtree; rank a COMPONENT seam by its exclusive
bytes alone and ignore the shared set.** Slice 3's own component seams
(85% realised) were the first data point for this and were read too narrowly.

**Addendum (slice 5, 2026-09-19): a re-export shell is not a real seam.**
A component seam is only a win if its target's own bytes actually leave the
eager graph. When the "target" is a re-export shell wrapping content that is
*already* deferred behind some other loader, the shell adds a chunk-boundary
and its own module weight without removing anything — a pure loss. This is
why `DocumentWindow` (wrapping the already-lazy `MapWindow`/`WorksheetWindow`)
measured **+221 B** in slice 5's per-seam table below rather than a reduction:
check what a candidate's target actually re-exports before ranking it, not
just whether a gate exists to hang it on.

#### Per-seam measurements

Cumulative, in the order the seams were measured — each row is a full
`npm run build` on the same machine, same Node, `.vite` wiped first. Every
seam measured a REDUCTION, so none was rejected on measurement. **This table
is the `3f43467b` chain** (the implementer's pre-merge worktree, per the note
above) — the per-seam shape and ordering are real, but `3f43467b` is
`HEAD~2` of the landed commit, not its parent; do not quote this table's start
or end row as "the commit's" totals. Use the landed pair above for that.

| # | seam (module deferred) | loader | gate | bound | eager B | delta |
|---|---|---|---|---:|---:|---:|
| — | `3f43467b` chain start (not this commit's parent — see above) | — | — | — | 911,295 | — |
| 1 | `components/Library/SavedFiguresSection.tsx` | Library.tsx† | `figureDocs.length > 0` | 5,652 | 905,950 | **−5,345** |
| 2 | `components/Library/FiguresSection.tsx` | Library.tsx† | `originFigures.length > 0` | 3,912 | 902,454 | **−3,496** |
| 3 | `components/Library/CollectionsSection.tsx` | Library.tsx† | `collections.length > 0` | 2,717 | 900,019 | **−2,435** |
| 4 | `components/Library/SmartFoldersSection.tsx` | Library.tsx† | `smartFolders.length > 0` | 2,305 | 897,849 | **−2,170** |
| 5 | `components/Library/OriginFidelitySection.tsx` | Library.tsx† | `originFidelity.length > 0` | 1,523 | 895,914 | **−1,935** |
| 6 | `components/Library/ReportsSection.tsx` | Library.tsx† | `reports.length > 0` | 792 | 895,396 | **−518** |
| 7 | `components/Library/MultiSelectBar.tsx` | `Library.tsx` | `selectedIds.length > 1` | 1,660 | 893,958 | **−1,438** |
| 8 | `components/Stage/PlotResultChips.tsx` | `PlotStageOverlays.tsx` | `resultChipsVisible(...)` | 4,222 | 891,761 | **−2,197** |
| 9 | `components/Stage/PlotContextMenu.tsx` | `PlotStageMenus.tsx` | `menu && displayPayload` | 6,985 | 885,433 | **−6,328** |
| — | `LibrarySections.tsx` extraction (see below) | — | — | — | 885,632 | **+199** |

† Measured with `Library.tsx` as the loader. The nine seams took `Library.tsx`
to 417 lines, over the 400-line component ceiling, so the six flat sections
were then lifted into a new `components/Library/LibrarySections.tsx`, which
is now their loader — and an extra eager module plus its chunk glue, the
+199 B in the last row.

**Pre- vs post-extraction totals (2026-09-18 review round, finding 3):** the
nine seam deltas alone (rows 1–9 above, summed) are **−25,862 B** — this is
the number `architecture.test.ts`'s SEAMS comment carries. Adding the
`LibrarySections.tsx` extraction's +199 B honest cost gives **−25,663 B** —
the number this file (and the commit body) carry elsewhere. The two are not
in tension: one is the sum before paying the ceiling-compliance cost, the
other after. Both are the `3f43467b`-chain figures per the note above; the
landed net delta over the real parent `b50f6602` is the different, separately
measured **−25,209 B** at the top of this section.

Seam 6 (`ReportsSection`, −518 B against a 792 B bound) is the scale check
this slice owes the file: a section that is mostly JSX over a small helper set
gives back most of its own bytes and nothing else. Seams 1 and 9 are the
opposite and are where the slice actually lives — they drag `lib/*` modules
out with them (below).

#### Why each seam qualifies

Every flat Library section ALREADY returned `null` until its own store
collection was non-empty, and a fresh project's collections are all empty. So
on the default first paint the section bodies were pure dead weight: mounted,
rendering nothing, and in the entry chunk. Each is now `lazy()` +
`Suspense fallback={null}` behind the SAME emptiness test the section applies
internally, which is the whole trick — the gate is not a new judgement call,
it is the component's existing one hoisted one level so the chunk request
follows it.

- **The six flat sections** load strictly after the user authors that content
  or opens a project that already had it. That second path is a **persisted-
  state restore**, and it is stated here up front rather than as a later
  narrowing, which is what slice 3's finding 4 had to do for its polar/panel
  seams. A restore into a project with publication figures pays one chunk
  fetch on that restore's first paint. No correctness consequence — nothing
  reads the suspended frame — and `lazySectionSeams.test.tsx` pins both halves.
- **The multi-select bar** waits for the second selected row. Pure gesture;
  `selectedIds` is not a persisted field.
- **The plot result chips** (∫ Integrate · ∩ FWHM · the ROI gadget family) are
  the one seam with no restore path at all: those results are committed by an
  on-canvas tool and the workspace format never serializes them. Its gate is
  the component's own visibility predicate, moved into
  `components/Stage/resultChipsVisible.ts` and imported by BOTH the gate and
  the component, so a future chip kind cannot show up in one and not the other.
- **The plot context menu** was already rendered only on `menu &&
  displayPayload`, i.e. after a right-click on the canvas.

**BookFamiliesSection is deliberately NOT a seam** although it is the same
shape: its emptiness test is a DERIVED value (`originBookFamilies(datasets)`),
so gating on it would mean recomputing that grouping on every dataset change
to decide whether to fetch a ~1 kB chunk. Left static.

#### The cost, stated plainly

Eight of the nine seams cost nothing a user can perceive: the content they
render did not exist a moment earlier, so the chunk fetch overlaps the action
that creates it. **Seam 9 is different in kind** — the FIRST right-click on a
plot canvas in a session now waits one chunk fetch before the menu appears
(every later one is instant, and the app is served from localhost). This is
adjacent to the "no — right-click latency" annotation `lib/contextActions.ts`
carries in the table at the top of this file, so: that module is the shared
action registry behind the Library row menus and the palette, it is untouched,
and it stays eager. Only the plot-canvas menu RENDERER and its two helpers
moved. If the latency is ever judged unacceptable the seam is a one-line
revert worth +6,328 B.

#### Guards

`src/architecture.test.ts` gains all nine in `SEAMS`, and the six modules they
dragged out with them in `DRAGGED_OUT`: `FigureRow.tsx` + `lib/originPreview.ts`
(FiguresSection's), `lib/figureCompatibility.ts` (SavedFiguresSection's),
`lib/originFidelity.ts` (OriginFidelitySection's), and `lib/plotMenu.ts` +
`lib/plotHitTest.ts` (PlotContextMenu's — most of that seam's −6,328 B).
`FigureRow.tsx` is itself the LOADER of the pre-existing
`OriginSavedPreviewWindow` seam; that guard greps FigureRow's source and does
not require FigureRow to be eager, so it is unaffected.

Recorded originally as "400 eager modules of 914 before, 387 of 916 after,
against `3f43467b`" — wrong on two counts (2026-09-18 review round, finding
4): `3f43467b` is not this commit's parent (see above), and the walk was
mis-measured against it regardless. Re-measured with the guard's own
`eagerlyReachable()`/`sources()` against the REAL parent `b50f6602`: **402
eager modules of 920 before, 389 of 922 after** — the shape of the original
claim holds exactly (−13 eager modules, +2 corpus modules: the nine seams,
the six dragged out, minus the two modules ADDED —
`components/Library/LibrarySections.tsx`, `components/Stage/resultChipsVisible.ts`).
Nothing in `architecture.test.ts` asserts on these absolute counts (only
`> 200` plus an empty-intersection check), so no test was ever at risk — this
was a documentation defect only.

DOM coverage is `components/Library/lazySectionSeams.test.tsx` and
`components/Stage/lazyStageSeams.test.tsx`, in the shape slice 3's
`lazyRenderSeams.test.tsx` established: nothing on the first synchronous flush,
the real content once the chunk resolves. Both files pin the render-gate half
of seams 7 (`MultiSelectBar`) and 8 (`PlotResultChips`) too — their own
`resultChipsVisible(...)`/`selectedIds.length > 1` checks return `null`
internally regardless of the outer gate, so a DOM-only assertion cannot tell
a real gate from one deleted; an import-recording seam (`vi.hoisted` +
`vi.mock` factory) added in the 2026-09-18 review round closes that hole by
asserting the module was never imported while the gate stayed closed.

**Residual (2026-09-18 review round, finding 7, NOT fixed by this slice):**
seam 9 (`PlotContextMenu`) also defers `ContextMenu.tsx`'s own
`mousedown`/`keydown`(Escape)/`scroll`/`resize` dismissal listeners, since
`ContextMenu` is rendered by `PlotContextMenu` inside the deferred chunk.
During the one-chunk window after a session's first right-click, nothing owns
Escape or an outside click, so a user who dismisses that way in that window
still sees the menu once the chunk lands (menu `x`/`y` are captured at
right-click time, so position is unaffected). The window is one localhost
fetch, once per session, so this is minor and left as a named residual rather
than fixed here; a future slice that touches this seam should either move the
dismissal listeners to the eager loader or accept and re-state this cost.

**Test lesson this slice adds: a DOM-only test cannot see a render gate.**
Every one of these sections ALSO returns null internally when its collection is
empty, so deleting the outer `figureDocCount > 0` gate — which would put a
suspended boundary on the first paint and hand back the entire measured saving
— changes nothing a `queryByText` can observe. Measured: a DOM-only version of
the gate tests stayed GREEN through exactly that sabotage. What the deletion
does change is whether the module is ever IMPORTED, so the test now records
that directly, with a `vi.mock` factory per section that notes its own first
import and returns the real module via `importOriginal()`. The seams then run
in a fixed order and each asserts nothing had fetched its module before its own
gate opened — a claim about every earlier test in the file, all of which
rendered the same tree with that collection empty. The sabotage reddens two
tests.

**Blast-radius sweep for tick-counting**, per slice 3's own lesson: every test
touching a seam or its loader was grepped for `await Promise.resolve()` after
an action that now crosses a seam. The section tests render the sections
DIRECTLY and are unaffected. Five assertions across four tests in
`Library.test.tsx` did read state on the synchronous flush and are now DOM
state waits (`await screen.findByText(...)`), not counted ticks: `"2
selected"`, `"Clear"`, `"Smart folders"`, and `"Origin fidelity"` twice (one
test asserts it on two separate lines) — corrected 2026-09-18, review round,
finding 9 (originally undercounted as four).

#### What was left on the table

Beyond the five parse-path leaves above: `store/gadget.ts` (6,655 B exclusive,
28 shared modules / 23.7 kB) and `lib/statstage.ts` (6,444 B, 4 shared /
6,032 kB) are both real candidates, and both need a synchronous builder
(`useApp`'s gadget actions, `plotspec.ts`'s `buildSpecRender`) to become
async first. `components/overlays/ContextMenu.tsx` is a zero-shared 5,293 B
leaf with six `lazy()` sites, held back for the same right-click-latency
reason seam 9 already spends once. `commands/analysisCommands.ts` looks
superb on the metric (7,680 B exclusive, 4 shared / 180 B) and is a trap: its
bytes ARE the palette metadata (label/description/keywords), which must stay
eager, and its `run` bodies are one-liners — slice 2's shape would recover
almost nothing there.

### Slice 5 — one content-gated render seam — **DONE (2026-09-19)**

**Measured net eager delta −936 B — budget UNMOVED at 920,400 B**

This slice landed one seam out of five it built and measured. That is the
point of it, not a shortfall: the byte cap below is structural, and the single
largest win on the tree was **measured and then rejected on user-visible
cost**. Both findings are stated up front, in the "Current state" note near
the top of this file and in "The ceiling this campaign has now hit" just
below — that is what this slice is actually for.

Bundle pair, exact bytes (the eager `<script type=module>` + `modulepreload`
count out of `dist/index.html`, not the rounded kB `check-bundle-size.mjs`
prints). Both built in this worktree after `npm ci`, with `node_modules/.vite`
wiped before EVERY build:

| tree | SHA | eager bytes |
|---|---|---:|
| parent (`git rev-parse HEAD~1`) | `cee0494f` | **889,498** |
| this commit (slice 5) | see commit | **888,562** |
| — net delta — | — | **−936** |

Eager-walk module counts, measured with `architecture.test.ts`'s own
`eagerlyReachable()`/`sources()` replayed over `src/`: **394 of 927 before,
393 of 927 after** — the one seam. It drags no module out with it and this
slice adds no new module, so there is no offsetting `+1` of the kind slices 3
and 4 had to account for.

#### The ceiling this campaign has now hit — read this before slice 6

`scripts/check-bundle-size.mjs` is a two-sided ratchet. It fails the build
ABOVE `EAGER_JS_BUDGET` (920,400 B) and it also fails BELOW
`EAGER_JS_BUDGET - SLACK` (920,400 − 40,000 = **880,400 B**), demanding the pin
be ratcheted down so an unlocked gain cannot be silently spent. With the parent
at 889,498 B that leaves exactly **9,098 B** recoverable in a slice that does
not move the pin — and this slice was told not to move it.

That cap, not a shortage of candidates, is what sized slice 5 — together with
the cost ruling below, which disqualified the largest win independently of it.
Ranked candidates worth **~26 kB** were identified and five were fully built
and measured; two of them are banked below, unlanded, because landing them
would have left under 300 B of margin over the 880,400 B floor. **Slice 6's
first decision is not which seam to cut but whether it is authorized to ratchet
the pin DOWN** (the file's own protocol: lower to `measured + 1,024` right
after landing the reduction). Until then every further seam is unbankable.

#### How the candidates were ranked

Slice 4's corrected rule was applied as written: rank a `lib`/`store` seam by
the exclusivity of its deferred subtree, and rank a COMPONENT seam by its
exclusive bytes alone, ignoring the shared set. The guard's own
`eagerlyReachable()` walk was replayed over `src/` in a scratch script; for
every eager module with exactly one eager importer that edge was cut, and the
modules that fall out of the eager set were summed using
`scripts/profile-eager-bundle.mjs`'s per-module attribution (`npx vite build
--sourcemap`, `TOP=400`). The script is session scratch, not committed — it
replays the guard plus the committed profiler, so it regenerates from those
two.

Three of the four highest-ranked component candidates were rejected on
ANALYSIS, before any build, and are recorded here so slice 6 does not re-rank
them:

- `components/windows/PlotWindowFrame.tsx` (9,486 B exclusive) is **first
  paint**: `store/windows.ts` initializes `plotWindows: [_mainWindow]`, so a
  frame is on screen before any user action. No gate exists to hang it on.
- `components/Library/DatasetRow.tsx` (10,297 B exclusive, the single largest
  candidate on the tree) is reachable eagerly only through `Library.tsx`'s flat
  fallback row list, and `LibraryTree.tsx` + `SmartFoldersSection.tsx` both
  import it statically from inside ALREADY-lazy chunks. It therefore cannot be
  a `SEAMS` entry as-is — the guard's "no module value-imports a seam module
  statically" arm is corpus-wide and would go red for two importers that are
  doing nothing wrong. Landing it needs a thin `LibraryFlatRows.tsx` wrapper to
  be the seam instead (the `LibrarySections.tsx` shape, +~200 B of glue), which
  is real work this slice had no byte budget left to spend. Worth doing first
  in slice 6.
- `components/Stage/InsetPlot.tsx` (1,549 B) has the same two-importer shape
  (`BackgroundPlotWindow.tsx`), and is too small to be worth a wrapper.

#### Per-seam measurements — kept, banked and rejected

Each row is a full `npm run build` on the same machine, same Node,
`node_modules/.vite` wiped first, exact bytes out of `dist/index.html`. Five
seams were fully implemented and measured; one landed.

| # | seam (module deferred) | loader | gate | bound | delta | outcome |
|---|---|---|---|---:|---:|---|
| 1 | `components/windows/SnapshotPlotWindow.tsx` | `WindowCanvas.tsx` | `kind === "snapshot" && snapshot` | 1,169 | **−936** | **KEPT** |
| 2 | `components/Stage/PlotLegend.tsx` | `PlotStageOverlays.tsx` | `displayPayload && showLegend` | 6,259 | **−5,881** | **REJECTED on user-visible cost** — see the ruling below |
| 3 | `components/Stage/PlotToolbar.tsx` | `PlotStageOverlays.tsx` | `displayPayload` | 4,004 | **−3,644** | banked — breaches the 880,400 B floor outright |
| 4 | `components/overlays/CommandPalette.tsx` | `App.tsx` | `cmdkOpen` | 3,607 | **−2,935** | banked — would leave 259 B over the floor |
| 5 | `components/windows/DocumentWindow.tsx` (`MapWindow`+`WorksheetWindow`) | `WindowCanvas.tsx` | `kind === "worksheet"` / `"map"` | 866 | **+221** | **REJECTED on measurement** |

**Measured-alone vs marginal — do not confuse them.** Seam 1's −936 B is its
delta measured ALONE against the parent (889,498 → 888,562). The same seam
measured as a marginal addition on top of the PlotLegend tree read −585 B
(883,594 → 883,009): two seams landing in one build share chunk-boundary glue,
so a marginal figure is not the seam's own delta and the two are not
interchangeable. Seams 2–5 were measured on the PlotLegend tree and their
deltas are marginal in that order — which is the number that decides whether to
keep them, but not a number to quote as a standalone seam value. Seam 3's total
(879,950 B) FAILS the build outright: `bundle-size: FAIL — eager JS is 859.3 kB,
well under the 898.8 kB budget. Lower EAGER_JS_BUDGET … to 919950 to lock the
gain in.` Seam 4's total (880,659 B) passes by 259 B — a margin that thin is a
trap for the next lane, since any 260 B eager reduction anywhere then reddens
CI with a demand to move the pin.

#### The ruling on `PlotLegend`, and the trade it sets

`PlotLegend` was the largest clean win on the tree — −5,881 B, 94% of its
bound, one seam, a gate that already existed. It was built, measured, fully
tested (DOM + import-recorder, all sabotage cases green) and then **rejected,
on cost rather than on bytes**:

> The legend is part of the plot's MEANING, not chrome around it. Deferring it
> makes the first plot of a session paint for one chunk fetch before the legend
> appears, and every project restored with `showLegend` on pays the same on its
> first paint. That buys a visible first-paint artifact on a core surface with
> 5,881 B that the 880,400 B floor means the campaign **cannot bank for
> anything anyway**. With 31.9 kB of headroom already and ~8 kB of recoverable
> room, byte-hunting at the cost of perceived quality is the wrong trade.

The general rule this sets, and the one slice 6 should rank by first: **a seam
is disqualified by a perceptible artifact on a surface the user is looking at,
before bytes are considered at all.** Under it, seam 3 (`PlotToolbar`,
`displayPayload`-gated plot chrome) is now suspect on the same grounds and
should not be landed merely because it fits; seam 4 (`CommandPalette`) spends
its fetch on the first ⌘K of a session, which is the latency-sensitive class
slice 4 already flagged when it spent one on the right-click menu. Neither is
a free 3 kB waiting to be collected.

#### Why the kept seam qualifies, and what it costs

It runs strictly after a user action **or a persisted-state restore**, and the
restore path is stated here up front rather than as a later narrowing:

- **The snapshot window** is the `win.kind === "snapshot"` dispatch branch, one
  line from `PanelPlotWindow`'s slice-3 seam and the same in kind. **Pays a
  chunk fetch on open:** yes — `kind` is a persisted window field, so a project
  restored with a snapshot window fetches it on that restore's first paint;
  otherwise it waits for the user to take a snapshot, which creates the window
  in the same gesture that fetches the chunk. **Nothing perceptible on either
  path**, which after the `PlotLegend` ruling above is the property that
  qualified it, not its size.

It inherits the repo-wide `lazy()` gap: a chunk that will not load has no
reporting of its own and unmounts the React root at the nearest boundary. That
is UX-003 in `plans/BUGS_AND_ISSUES.md` for every such site at once, not
something this seam introduces or can fix locally.

#### Guards, and the slice-4 test lesson applied

`src/architecture.test.ts` gains the seam in `SEAMS`. `DRAGGED_OUT` is
unchanged: `SnapshotPlotWindow` is a prop-forwarding shell whose every import
is kept eager by something else, so it took no module with it.

DOM + import coverage is in `components/windows/lazyRenderSeams.test.tsx`.
**Slice 4's lesson — a DOM-only test cannot see a render gate — applies here
too, and was proved rather than asserted.** This gate is a ternary branch, so
the cheap break is to WIDEN it, not delete it; a widened branch still renders
*something* on every window, so the DOM assertions alone cannot separate it
from the real gate. Measured: widening it reddens the import recorder with
`expected [ 'SnapshotPlotWindow' ] to not include 'SnapshotPlotWindow'`.

All three `SEAMS` guard arms were verified against the seam by making it
static — the corpus-wide static-import arm, the `eagerlyReachable()` arm, and
the `(?<!typeof )` dynamic-import arm all went red. The last was additionally
verified in isolation (on the rejected `PlotLegend` seam, before it was
reverted) by leaving only a `typeof import("…")` type alias behind, which
reddens that arm alone; and the `DRAGGED_OUT` reachability arm was verified in
isolation by adding a static `LegendSample` import to an eager module, which
reddens that arm alone. Both isolation checks are recorded here because they
prove the ARMS work, which outlives the seams they were run against.

**Blast-radius sweep for tick-counting**, per slice 3's lesson: every
`.test.ts(x)` naming a `kind: "snapshot"` window or `SnapshotPlotWindow` — and,
while the legend seam existed, everything naming `PlotLegend`/`LegendSample`/
`qzk-legend` — was grepped for `await Promise.resolve()` after an action that
now crosses a seam. **Zero hits** in either radius. No test needed converting.

#### The `lib/plotRecipeIO.ts` candidate this slice was reserved for

Re-ranked and **not built**. The eager walk puts it at 5,789 B exclusive over
**43 shared modules / 66,434 B** behind its single eager importer
(`lib/workspace.ts`) — a `lib` seam with poor subtree exclusivity, which is
exactly the shape slice 3's rule presumes a loss until a build says otherwise,
and slice 4's restatement does NOT rescue it (that rescue is for COMPONENT
seams only). Its own note already conceded the structural problem:
`parseWorkspace` needs `sanitizeRecipes` at load, so only `parseRecipe` could
move and it shares most of the module's helpers with the half that stays. With
9,098 B of ratchet room available, spending a build on a candidate whose own
premise is "the win is small — verify before doing it" was the wrong trade
against two component seams with clean gates. It stays on the table for a slice
willing to split the module.

### Slice 6 — one seam (`DatasetRow` behind a wrapper), pin ratcheted DOWN — **DONE (2026-09-19, round 2 after adversarial review)**

**Measured net eager delta −13,117 B — pin LOWERED 920,400 -> 876,469 B**

**Corrected after adversarial review (round 2) — read this before the rest of
the section, which is otherwise the round-1 record with in-place fixes:**
the PRIOR PIN was **920,400**, not 888,562 as round 1 wrote — 888,562 is the
PARENT COMMIT's measured eager bytes, a different quantity, and conflating
them was the section's own error. Separately, round 1's claim that the
forced `total < EAGER_JS_BUDGET - SLACK` floor check "would not itself have
fired" was FALSE: re-run unmodified against this commit's `dist/`, that
check DOES fail against the unmoved 920,400 pin (`FAIL — eager JS is
854.9 kB, well under the 898.8 kB budget. Lower EAGER_JS_BUDGET … to
915428`) — this slice was COMPELLED to lower the pin, not merely authorized
to. The chosen 876,469 is still correct and stricter than the script's own
915,428 floor; only the narrative was wrong. A third defect (below, "the
seam is not free") changed the actual bytes by +17 (875,428 -> 875,445),
which is folded into the delta and pin above. See `check-bundle-size.mjs`'s
own history entry for the corrected numbers in full.

The first decision, per the tail this slice inherited, was whether it is
authorized to ratchet `EAGER_JS_BUDGET` DOWN at all (a pin-down slice or
nothing) — moot after the correction above: the forced floor check already
demanded a lower pin regardless of authorization. The pin was set to
`measured + 1,024` (876,469) rather than the script's own suggested floor
(915,428) so the gain is locked in tightly rather than left as spendable
slack for the next unrelated feature — exactly the trade the tail below
asked slice 6 to make explicit, now for the right reason.

#### Ranking: the `PlotLegend` ruling first, bytes second

Slice 5 left three inherited candidates (~26 kB, partly measured):
`DatasetRow` behind a wrapper, and slice 5's own banked `PlotToolbar`
(−3,644 B) and `CommandPalette` (−2,935 B) seams. Applying the `PlotLegend`
ruling — *a seam is disqualified by a perceptible artifact on a surface the
user is looking at, before bytes are considered at all* — to each, in
writing, before building anything:

- **`PlotToolbar`** (`displayPayload`-gated plot chrome) is disqualified on
  the same grounds as `PlotLegend` itself: it is part of what the user is
  looking AT on the plot's first paint (and on any restore with a plot
  already showing), not chrome around it. Rejected without a rebuild — the
  ruling covers it exactly as slice 5's own tail said it would.
- **`CommandPalette`** (opens on the first ⌘K of a session) is disqualified
  on the adjacent ground the ruling names: it spends its one chunk fetch on
  the FIRST invocation of a frequent, latency-sensitive gesture — the same
  class slice 4 already flagged when it spent one on the right-click menu
  (and accepted the cost there only because it was, at the time, the single
  largest win on the tree). Rejected without a rebuild.
- **`DatasetRow` behind a wrapper** is NOT disqualified. Its target is
  Library.tsx's own flat-list fallback body — the branch taken only when
  `query.trim() === "" && rows.length === 0`. Investigating that gate (not
  merely trusting the "component seam" label) found it is stronger than a
  persisted-restore-only claim: PR C's own invariant
  (`lib/libraryHierarchy.ts`'s `buildLibraryHierarchy` unconditionally adds a
  hierarchy worksheet node for every dataset, and `flattenLibraryHierarchy`
  always includes every root-level node regardless of expansion state) means
  `rows.length === 0` IMPLIES `datasets.length === 0`, which means `shown`
  (filtered from `datasets`) is empty too — so this branch renders zero
  `DatasetRow`s on every path in today's app, first paint AND restore
  included. Round-1 confirmed this only by trace and by the absence of a
  test exercising the impossible combination; round 2's adversarial review
  went further and PROBED it (dangling `workbookId`, dangling `folderId`,
  duplicate ids, cyclic/self-parent folders, an empty id, collapsed
  containers) via `vite-node`, and `rows.length` was ≥ 1 in every case.
  **Round 1 then overstated the cost claim: "deferring it is free" was true
  of the RENDERED content, but not of the ORIGINAL, un-gated code** — see
  "The seam is not free" fix below, applied in this round.

Also checked against the `lib`-vs-component rule (slice 3/4): `DatasetRow`'s
seam is a COMPONENT seam (a thin new `LibraryFlatRows.tsx` wrapper, the
`LibrarySections.tsx` shape), which slice 4's restatement rescues from the
"poor subtree exclusivity is presumed a loss" rule — and it was still
measured, not assumed.

#### Why `DatasetRow.tsx` itself can't be the `SEAMS` entry

`LibraryTree.tsx` and `SmartFoldersSection.tsx` both import `DatasetRow.tsx`
directly (they are its real render paths — the Tree view and Smart Folders),
and both are themselves already-lazy chunks. Making `DatasetRow.tsx` the
`SEAMS` `module` would make the guard's corpus-wide "no module value-imports
a seam module statically" arm red for those two importers, which are doing
nothing wrong. The seam is instead the new `components/Library/LibraryFlatRows.tsx`
wrapper (the `LibrarySections.tsx` precedent): it wraps Library.tsx's OWN
flat-list-fallback body (moved out verbatim — the `row()` helper and its
JSX, previously inline in Library.tsx), and `Library.tsx` is its only
importer, reached only via `lazy(() => import("./LibraryFlatRows"))`.

#### The seam is not free — round 2 fix (MED, adversarial review)

Round 1's gate on the `<Suspense>` boundary was `rows.length === 0` alone —
the SAME condition the branch's own analysis above traces, but not the same
as `shown.length > 0`. In the ONE state that actually reaches this branch
(an empty library — cold start, or a first run with nothing imported yet),
`rows.length === 0` is true and the round-1 code fetched
`LibraryFlatRows`'s chunk (and `DatasetRow`/`datasetRowMenu`/the
preview/Sparkline chunks with it) to render zero rows. Before this seam
existed those bytes were already sitting in the entry chunk, paid once, at
parse time, with no network round trip; after the seam, cold start pays a
NEW chunk fetch for content that was never going to render — a real cost,
and on exactly the surface ("first paint is free") the ranking above argued
was costless.

**Fix:** gate the `<Suspense>` boundary on `shown.length > 0` too (the same
condition `HomeScreen`, immediately below in the JSX, already computes for
free — no new derived state). `Library.tsx`'s branch chain is now `} else
if (shown.length > 0) { … } else { body = null; }`. Cold start (empty
library) now renders `body = null` and never touches the chunk;
`HomeScreen` renders the same as before either way.

Sabotage: reverted the gate to plain `else` (round 1's shape) and re-ran the
seam test — `libraryFlatRowsSeam.test.tsx`'s "never fetches on any REAL
state" test went RED at `expected [ 'LibraryFlatRows' ] to not include
'LibraryFlatRows'`, at the exact assertion that pins the true-empty state.
Reverted the sabotage; green again.

Re-measured (not assumed unchanged) after the fix: the gate is real,
non-comment code, so it moved the eager byte count by +17 B (875,428 ->
875,445) — folded into the Measurement table and the pin above.

#### Measurement

Both built in this worktree after `npm ci`, with `node_modules/.vite` wiped
before EVERY build; exact bytes out of `dist/index.html` (not the rounded kB
`check-bundle-size.mjs` prints). The PRIOR PIN was **920,400 B** — 888,562
below is the parent's MEASURED bytes, a different quantity (round 1's own
history entry conflated them; corrected here and in `check-bundle-size.mjs`):

| tree | SHA | eager bytes |
|---|---|---:|
| parent (`git rev-parse HEAD~1`) | `8f79207d` | **888,562** |
| this commit, before the `shown.length > 0` gate fix | — | 875,428 |
| this commit, as landed (with the gate fix) | see commit | **875,445** |
| — net delta (parent -> landed) — | — | **−13,117** |

Re-running `check-bundle-size.mjs` UNMODIFIED except for restoring the old
920,400 pin, against this commit's `dist/`, confirms the forced floor check
(`total < EAGER_JS_BUDGET - SLACK`) already failed before this slice touched
the pin: `FAIL — eager JS is 854.9 kB, well under the 898.8 kB budget. Lower
EAGER_JS_BUDGET … to 915428 to lock the gain in.` — round 1's claim that this
check "would not have fired" was wrong; this slice was compelled to lower
the pin, and chose 876,469 (`875,445 + 1,024`), stricter than the script's
own 915,428 suggestion.

Eager-walk module counts: first measured with a standalone replica of
`architecture.test.ts`'s own `eagerlyReachable()` walk (script kept in the
session scratch, not committed), then VERIFIED against the REAL guard
itself (round 2, adversarial review) — a temporary `console.log` dump of
`eagerlyReachable()`'s own output, run unmodified in both trees via
`npx vitest run src/architecture.test.ts -t "nothing eager reaches a seam"`,
gives **393 of 927 before, 382 of 928 after** (`sources().length` for the
corpus counts, also this file's own function) — the one seam (which itself
stays lazy, so it does not appear in either count) plus the eleven modules
it dragged out, minus the one module ADDED (`LibraryFlatRows.tsx`, the
loader, also lazy). The SET difference between the two real-guard dumps is
exactly the eleven `DRAGGED_OUT` entries below — nothing missed, nothing
extra. (The debug dump lines were removed from both trees' `architecture.test.ts`
after verification; they are not part of the committed diff.)

The realised delta (13,117 B) is LARGER than `DatasetRow.tsx`'s own
attributed bytes from the per-module table at the top of this file
(10,297 B) — expected, and not a discrepancy: that figure was one module's
own bytes, not its exclusive subtree, and the seam took DatasetRow's own
row-only siblings with it too (below).

#### What got dragged out

`DRAGGED_OUT` gains eleven modules, all measured (not assumed) with the same
before/after walk: `DatasetRow.tsx` itself, `DatasetRowParts.tsx`,
`DatasetRowPreview.tsx`, `Sparkline.tsx`, `datasetRowMenu.ts` (DatasetRow's
own imports — `libraryTileMenu.ts`, `datasetRowMenu.ts`'s other importer, is
itself reachable only from the already-lazy `LibraryWorkspace.tsx`/
`DetailsRow.tsx`, so it never made `datasetRowMenu.ts` eager), plus
`DerivedWorksheetMark.tsx` + `RecomputedMark.tsx` (rendered by
`DatasetRowParts.tsx`) and `lib/combineSeparateActions.ts` +
`lib/derivedWorksheetActions.ts` + `lib/downsample.ts` +
`lib/libraryPreviewPrefs.ts` (pulled in transitively by those). `ContextMenu.tsx`
and `Badge` (from `primitives`), also imported by `DatasetRow.tsx`, do NOT
drop — both stay eager via `PlotToolbar.tsx`/other primitives consumers, so
they correctly do not appear in `DRAGGED_OUT`.

#### Guard verification

`src/architecture.test.ts`'s `SEAMS` gains the one entry
(`LibraryFlatRows.tsx`, loader `Library.tsx`) and `DRAGGED_OUT` gains the
eleven modules above. All three `SEAMS` guard arms were verified by making
the seam static (replacing `const LibraryFlatRows = lazy(() =>
import("./LibraryFlatRows"))` with a plain `import LibraryFlatRows from
"./LibraryFlatRows"`), confirmed red, then reverted:

| sabotage | test | result |
|---|---|---|
| static import in the loader | "no module value-imports a seam module statically" | **RED** — `Library.tsx -> /components/Library/LibraryFlatRows` |
| static import in the loader | "nothing eager reaches a seam, or the modules the seams dragged out with them" | **RED** — all 12 (seam + 11 dragged-out) reappear eager |
| static import in the loader | "each loader reaches its seam through a dynamic import()" | **RED** |

DOM + import-recorder coverage: `components/Library/libraryFlatRowsSeam.test.tsx`
(the gate half — a `vi.hoisted` + `track()` import recorder, since this
seam's gate is strictly stronger than a DOM-visible ternary: even the round-2
`shown.length > 0` gate cannot be told apart from "deleted" by a DOM
assertion in the ONLY state real code can reach it in, because that state
renders nothing either way — only the import record can) and
`components/Library/LibraryFlatRows.test.tsx` (the wrapper's own render
output, unit-tested directly, decoupled from the mocked seam test so the
tracked import isn't fired early by a static top-level import in the same
file — a real trap: an earlier draft that imported `LibraryFlatRows`
statically in the seam test file for a second, direct-render assertion
fired the mock factory at file-load time instead of at Library.tsx's real
runtime `import()` call, permanently defeating the recorder for that file).

**Rewritten in round 2** to match the corrected gate and the adversarial
review's finding that the "gate open" state is unreachable through real
store state: `libraryFlatRowsSeam.test.tsx` now holds two tests —
(1) "never fetches the chunk on any REAL state, including the closest
approach to true-empty" drives `<Library />` through both real states
(dataset present -> tree; true-empty -> nothing) via `rerender()` and
asserts the chunk is never fetched in either, proving the round-2 fix; and
(2) "still fetches the chunk if the otherwise-unreachable gate is forced
open" mocks `useLibraryHierarchyModel` (wrapped in `vi.fn()`, defaulting to
the real implementation via `importOriginal`) to return `rows: []` while
`datasets` — and therefore `shown` — is non-empty, the one combination no
real app path can produce, and asserts the chunk STILL fetches and
`DatasetRow` still renders correctly if that ever becomes reachable. Proved
both halves reddened by sabotage (see the sabotage table): widening
`inHierarchy` to `false`, and separately reverting the `shown.length > 0`
gate, both redden test (1) at
`expected [ 'LibraryFlatRows' ] to not include 'LibraryFlatRows'` —
confirming a DOM-only version of either test (there isn't one, deliberately)
could not have caught it.

One React/testing-environment quirk surfaced in round 1 and is recorded so a
future seam test isn't re-surprised by it: two SEPARATE `render()` calls of
`<Library />` across two different `it()` blocks, both referencing the SAME
module-level `lazy(() => import(...))` object, do not reliably re-trigger
the tracked factory a second time. Round 1 worked around it with a single
`rerender()`-based test; round 2's rewrite keeps that shape for test (1) and
places test (2) — the file's only OTHER trigger of the factory — after it,
so it remains the first and only render to open the real gate in that
ordering.

#### Blast-radius sweep for tick-counting

Per slice 3's lesson: grepped every `.test.ts(x)` naming `DatasetRow` for
`await Promise.resolve()` after an action that now crosses this seam. One
file matched (`DatasetRow.test.tsx`), and its four `await Promise.resolve()`
sites are all inside the destructive-Remove confirm flow (waiting on
`askConfirm`'s own promise) on a `<DatasetRow>` rendered DIRECTLY — never
through `Library.tsx`/`LibraryFlatRows.tsx` — so none crosses the new seam.
**Zero hits.** The full Library suite (39 files / 531 tests) and the full
frontend suite (682 files / 11,547 tests) both pass unchanged.

#### The cost, stated plainly

None on the RENDERED content — this is still the first seam in the campaign
whose deferred branch renders zero content on every reachable path today, so
there is no first-paint or restore-time artifact to weigh against the bytes,
unlike `PlotLegend`/`PlotToolbar`/`CommandPalette`. Round 1 stopped there and
was wrong to: the ORIGINAL gate (`rows.length === 0` alone) DID cost a real
chunk fetch on cold start to render that zero content, which is fixed above
("The seam is not free"). With the `shown.length > 0` gate in place, the
cost really is none — not merely on what renders, but on whether the chunk
is ever fetched at all on the one path that could reach this branch.

**What `LibraryFlatRows.tsx` is, stated precisely (narrowing round 1's "real
fallback" language):** it is not a live fallback and nothing today exercises
it as one — no real store state can reach `rows.length === 0` with
`datasets.length > 0` (confirmed by trace AND by adversarial probing, see
above), so `shown.length > 0` can never hold at the same time as
`rows.length === 0`. It is a deliberately-retained UNREACHABLE guard: kept
in source, and now gated so it costs nothing even to check, because the
invariant that makes it unreachable lives in a different module
(`lib/libraryHierarchy.ts`) and this file should not assume that invariant
without proof. Calling it "the flat list" or "a real fallback" without that
qualifier is not backed by anything in the test suite, because nothing can
back it.

#### Sabotage table

| sabotage | test(s) | result |
|---|---|---|
| static import (seam made eager) | the 3 `SEAMS` guard arms | **RED** (all 3, see table above) |
| widen `inHierarchy` to always `false` | `libraryFlatRowsSeam.test.tsx`'s "never fetches the chunk on any REAL state" | **RED** — `expected [ 'LibraryFlatRows' ] to not include 'LibraryFlatRows'` |
| remove the `shown.length > 0` gate (round 2 fix reverted) | `libraryFlatRowsSeam.test.tsx`'s "never fetches the chunk on any REAL state" | **RED** — same assertion, at the true-empty (cold-start) state specifically |

### Slice 7 — window chrome, built and REVERTED; the three pin raises after it — **record added 2026-09-25**

Recorded by slice 8 because `check-bundle-size.mjs`'s 2026-09-20 entry said
"plans/BUNDLE_HEADROOM.md records what slice 7 established" and, on `main`,
it did not: slice 7's own section lived only on its unmerged branch. Sources,
all verifiable with `git show`: `8abdbd78` and `b51f0c53` (slice 7 rounds 1
and 2, **not ancestors of `main`** — `git merge-base --is-ancestor` says so)
and `7dd58552` (the first raise, on `main`).

- **Round 1** (`8abdbd78`) deferred `components/windows/PlotWindowFrame.tsx`
  behind `WindowCanvas.tsx`'s single-maximized fast path: −9,007 B, rejected
  on adversarial review because its `Suspense` wrapped the frame's
  `children`, i.e. the live `<PlotStage/>` — it blanked the plot on every
  multi-window path.
- **Round 2** (`b51f0c53`) deferred only `WindowTitleButtons.tsx`: −3,603 B
  (875,755 → 872,152). CI then failed e2e `group-facet-journey`, which
  right-clicks a window titlebar and waits for "Close Window":
  `windowMenu.ts` had gone lazy with the buttons, so the titlebar menu was not
  there when the user reached for it. Reverted (`7dd58552`'s message).
- **Standing rulings from slice 7:** the window-frame family (frame, titlebar
  buttons, titlebar menu) is disqualified — a titlebar is immediately
  interactive, not furniture; and `lib/plotRecipeIO.ts`'s `parseRecipe`
  split is measured-rejected at a **474 B** ceiling (deleting it outright
  saved only that, before any chunk-boundary cost).
- **The raises that followed** (each in `check-bundle-size.mjs` with its
  justification, all "measured + 1,024" under rule 2): 876,469 → 878,182
  (batch 9: UX-003 boundaries, BUG-019 projection, UX-004 node icons),
  → 879,420 (BUG-009 preview row-state migration), → 881,442 (BUG-009
  resolve-then-apply). That is how `main` reached 51 B of headroom.
- **No ratchet suspension is on record.** A brief for slice 8 mentioned a
  "round 11 batch" suspension of the ratchet; nothing in `plans/`, `docs/` or
  `check-bundle-size.mjs` at `3ccf4972` says so. The ratchet was never
  suspended — it was raised three times, each under the file's own rule 2.

### Slice 8 — preload-list pruning + the two promise dialogs, pin ratcheted DOWN — **DONE (2026-09-25)**

**Measured net eager delta −14,085 B — pin LOWERED 881,442 → 868,308 B** (868,037 at
landing; 868,330 after the review round's +293 B fix; 868,308 after rebasing
onto Group F `55f0cac9` — always `measured + 1,024`)

Exact bytes out of `dist/index.html` (the eager `<script type=module>` +
`modulepreload` set), `npm ci`, `node_modules/.vite` wiped before EVERY build,
every number reproduced by a second identical build:

| tree | eager B | delta |
|---|---:|---:|
| `3ccf4972` (parent) | 881,391 | — |
| + preload-list pruning | 870,673 | **−10,718** |
| + lazy `ConfirmDialog`/`ParamDialog` bodies | 867,013 | **−3,660** |
| + review round: first-ask key guard, replaced asks settle | 867,306 | **+293** |
| dialog bodies ALONE on the parent (no pruning) | 881,021 | −370 |
| rebased: Group F `55f0cac9` (new parent) | 881,369 | — |
| rebased: slice 8 on top of it | 867,284 | **−14,085** |

#### 1. Preload-list pruning — the chunk-boundary tax, found

Every dynamic `import()` Vite emits carries a preload list
(`__vite__mapDeps([...])` plus a per-chunk table of file names) naming the
target's **whole static-import closure**. For a seam reached from the entry,
most of that closure is the eager graph itself — `useApp`, `react`, `index`
— so each seam paid ~50 file names for chunks already fetched and evaluated
before its `import()` could run. On the parent, **18,363 B of the entry
chunk and 20,680 B across eager chunks** were these lists. That is the
mechanism behind slice 3's "+1,451 B for a 1,830 B bound" and slice 5's
marginal-vs-alone confusion: a new seam's list, not "glue".

`frontend/scripts/preloadPrune.mjs` (wired in `vite.config.ts` through
`build.modulePreload.resolveDependencies`, bundle captured by a
`generateBundle` hook ordered `pre`) drops, for JS hosts only, every chunk
certainly loaded before the host's code runs: the host chunk's own static
closure, and the HTML entry's (intersected across entries; this app has
one). ES modules link the whole static graph before evaluating any of it, so
those hints were already no-ops — Vite's preload helper found the existing
`<link rel="modulepreload">` and returned. Kept: the seam's own lazy chunk,
lazy chunks it shares with other seams (so they still preload in parallel —
observed in the browser: `ConfirmDialogBody` and `useDialogFocus` fetched
together), all CSS, and the HTML entry's own modulepreload tags. What is left
(10,747 B on the landed tree) is the per-chunk table naming each LAZY chunk
once, which is irreducible without changing chunking. Tests:
`src/lib/preloadPrune.test.ts`.

**The real output is gated, not just the pure functions (review round).**
An independent review re-checked every removal with its own
es-module-lexer probe (3,554 removals across 135 sites: 0 unsafe, 0 CSS
dropped) and asked for that probe in the build. It is now
`scripts/preloadVerify.mjs`, run from the prune plugin's `writeBundle`, so
every `vite build` (and so `npm run build` and CI) re-derives the static graph
from the EMITTED code — not from Rolldown's `imports`, which the prune itself
trusts — and fails on any list missing a chunk its target needs (target +
closure, minus host closure, minus entry closure) or any CSS Vite's own walk
would have listed. On the landed tree: 137 lists checked (137 wrapped
import() sites), 0 violations. *Review round 2:* the first version found only
130 -- it recognised an emptied list solely in the `import("./X"),[])` shape,
so the 7 async-destructure sites (`h(async()=>{let{x:e}=await import(..)},[])`)
were skipped, and emptying one of those passed the build (129 checked). Every
dynamic import must now be matched to a list or it is itself a violation; the
same sabotage (relinkPreview's list emptied) now fails the build.
Sabotage: a prune that drops one extra entry fails `npm run build` with 96
violations. `es-module-lexer` 2.3.2 became an exact devDependency (it was
already in the lock via vitest). Pruned lists put their CSS last because Vite
appends CSS after `resolveDependencies`; the CSS entries keep their relative
order and a JS modulepreload never takes part in the cascade, so this is
harmless (commented in `preloadPrune.mjs`).

**Consequence for future slices:** re-measure the "rejected on measurement"
seams (slice 3's `store/reimport.ts` and `fileCommands → originTemplate`,
slice 5's `DocumentWindow`); their losses were measured with the tax in
place. A seam alone on the parent is no longer the right comparison either —
measure on top of the pruning.

#### 2. `ConfirmDialog` / `ParamDialog` bodies

Both rendered nothing until something asked (`askConfirm`/`askParams`), yet
sat in the entry chunk with their focus machinery. Now:

- `store/confirmDialog.ts` / `store/paramDialog.ts` hold the stores and the
  ask functions (the `store/annotationTextDialog.ts` shape).
- `ConfirmDialog.tsx` / `ParamDialog.tsx` stay eager as thin gates that
  RE-EXPORT the ask functions, so ~40 call sites and ~67 test mocks of those
  module paths are untouched.
- The bodies (`ConfirmDialogBody.tsx`, `ParamDialogBody.tsx`, moved verbatim)
  are lazy. Dragged out with them: `useDialogFocus.ts`, `ParamFields.tsx`,
  `lib/params.ts`, `lib/scrollOutFocus.ts`. Replayed `eagerlyReachable()`:
  387 → 385 eager modules (four dropped, two stores added).

**Why they qualify under the `PlotLegend` ruling:** a dialog exists only
after something asked a question, so nothing on first paint, hydration or a
restore moves. **Cost, measured in a real browser** (Chromium, built SPA,
local `qz`, three runs each against the parent): the chunk fetch is
**8–12 ms** for the confirm body (+ `useDialogFocus`, in parallel) and
**4–5 ms** for the parameter body, on the FIRST open of a session only;
end-to-end open times were within run-to-run noise of the parent's (Export
figure first open 108–186 ms vs 114–137 ms; the first "Remove all" confirm is
~1.2–1.7 s on BOTH trees, a palette-first-run cost unrelated to this seam).
Later opens mount from `lazyRegion`'s resolved cache on the same flush.

**The first cut was rejected on the same ruling.** Mounting the body straight
into a suspending `lazyRegion` measured 300 B smaller but opened
**250–280 ms late** on the first Export figure: React holds a retry's reveal
until ~300 ms after the last committed Suspense fallback. So `lazyRegion`
gained `preload()`/`loaded()` and a `useRegionLoaded(region, wanted, onFail)`
hook: the gate starts the load when a request arrives and mounts the body
only once its chunk is in, so it never suspends. That is the +300 B in the
table above. The same hook is available to any `lazyPanel` that wants its
first open off the throttle — not applied to the existing ones here.

**Load failure (UX-003):** the load runs through `lazyRegion`'s tagged
loader and nothing throws during render, so the root is never at risk. The
pending ask settles with its cancel value (`false` — nothing destructive runs
behind a dialog nobody saw — or `null`, which every `askParams` caller
already handles), a danger toast says why, and the next ask retries the
fetch.

**First-ask key window — CLOSED in the review round.** As first landed,
nothing was modal while the first ask's chunk was in flight, so keys reached
the page behind. The reviewer's repro showed it was worse than a timing
nit: a second Enter on the focused trigger asked AGAIN and replaced the first
ask's `resolve`, so the first promise NEVER settled (`["ask2:false"]` where
the parent gave `["ask1:false"]`), and an Escape closed the `window`-layer
surface behind while the dialog then opened anyway. Fixed two ways:
`components/overlays/usePendingDialogGuard.ts` stands in for the dialog
while `open && !ready` (a `modal` escape surface that cancels the ask, and a
capture-phase swallow of Enter/Space on keydown and keyup), and both stores'
`open()` now settle a replaced ask with its cancel value (`false` / `null`)
instead of dropping it — which also closes the same loss for two asks
arriving back-to-back with the dialog already loaded.
`lazyDialogPendingKeys.test.tsx` holds the body chunk back and replays the
repro; disabling the guard, only the Enter swallow, or the stores' settle
each reddens it.

**Guards and sabotage** (each verified red, then reverted):

| sabotage | test | result |
|---|---|---|
| static import of a body in its gate | the three `SEAMS` arms in `architecture.test.ts` | **RED** (all three) |
| gate loads regardless of a pending ask | `lazyDialogSeams.test.tsx` import recorder | **RED** — `expected [ 'ConfirmDialogBody' ] to deeply equal []` |
| `useRegionLoaded` ignores a failed load | `lazyDialogSeamFailure.test.tsx` | **RED** — the ask never settles (timeout) |
| `preload()` does not fill the resolved cache | `lazyRegion.test.tsx` preload tests | **RED** (two tests) |

`lazyDialogSeamFailure.test.tsx` also asserts no `console.error` at all: the
failure stays a handled rejection. Not pinned by a test: that the gate waits
for `useRegionLoaded` rather than mounting into a suspending region (the
throttle regression) — that is only observable as wall-clock in a real
browser; the mechanism itself is pinned in `lazyRegion.test.tsx`.

#### Candidates considered and not landed

- **`CommandPalette`, `PlotToolbar`, `PlotLegend`** — still disqualified by
  the `PlotLegend` ruling (slices 5–6); not rebuilt.
- **`components/overlays/ContextMenu.tsx`** (5,293 B exclusive) — the
  right-click class slice 4 flagged, and the titlebar menu is exactly what
  broke slice 7 in e2e. Not built.
- **Window chrome** — slice 7's disqualification stands.
- **`store/recode.ts`** (3,935 B exclusive; only eager importer
  `AppOverlays.tsx`, which reads its `open` flag) — needs the store split so
  the flag survives without the actions; a `store`-level seam, not built.
- **`lib/template.ts`** (1,930 B) — its only eager use is a synchronous
  `hidden` predicate on the folder context menu; deferring it changes that
  menu's behaviour, not just its timing. Not built.
- **`components/Shell/AppearanceMenu.tsx`'s dropdown** (≤ 2,092 B bound,
  `lib/shortcuts.ts` stays eager via `MenuBar`) — plausible now that the tax
  is gone; not needed for this slice's target, left for the next.
- **`TooltipLayer` / `InteractionHints`** — `InteractionHints` must stay
  mounted for its reopen listener (`AppOverlays.tsx` header);
  `TooltipLayer` owns global hover listeners. Not built.

## What this does NOT change

Vendor is 26% and fixed. `useApp.ts` at 36.5 kB is the largest app module and
only P4.1-style slice decomposition touches it. A raise may still be the
honest answer for a lane that needs room *now*; these slices are how the
budget stops being a recurring blocker.

What has changed since that was written is which end of the ratchet binds,
and then, after slice 6, that the ratchet moved. Slice 6 ranked its three
inherited candidates by the `PlotLegend` ruling before bytes: `PlotToolbar`
and `CommandPalette` were both disqualified on user-visible cost (plot
chrome on first paint; the first ⌘K of a session) and stay banked, unlanded;
`DatasetRow` behind a `LibraryFlatRows.tsx` wrapper was not disqualified —
its target branch renders zero content on any reachable path today — and
landed at −13,117 B, the largest single-seam win of the campaign. The pin
was then lowered from the prior 920,400 B to 876,469 B (`measured + 1,024`)
— compelled by the script's own forced-floor check having already failed
against the unmoved pin, not a purely discretionary diet-pass choice (see
slice 6's round-2 correction), so that gain is locked in rather than left
as spendable slack.

**As of slice 6, headroom was 1,024 B against the 876,469 B pin** (stale:
three raises followed, then slice 8 lowered the pin to 868,308 B with
1,024 B of headroom — see the top of this file) — by design, not
by exhaustion. The two banked seams (`PlotToolbar` −3,644 B,
`CommandPalette` −2,935 B) remain on the table, unlanded, under the
`PlotLegend` ruling; landing either needs that ruling to be re-argued, not
merely a slice with spare bytes. A future slice with real headroom to spend
starts by re-measuring against the NEW pin, not by assuming the 8.1 kB or
31.8 kB figures this section's earlier drafts cited — both are stale as of
slice 6.
