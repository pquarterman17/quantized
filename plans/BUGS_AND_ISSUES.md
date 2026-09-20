# Quantized living bugs and usability issues

**Status:** Active working checklist  
**Created:** 2026-09-08  
**Updated:** 2026-09-20 (BUG-021 FIXED — owner-reported, from a real VSM
hysteresis loop: the Magnetometry ▸ Background tab ran the M(T) one-sided
high-T fit on M(H) data, which shears a saturated loop down by Ms
(measured: plateaus at 0 and −2·Ms, squareness a meaningless 1.0000). It now
dispatches on what the x axis DECLARES itself to be — reading `x_column_long`
first, so an Origin SHORT column name cannot masquerade as a field symbol —
and fails closed, letting the user pick, when that cannot be determined. With
it: `ensureOk`, the app-wide single error-extraction path, no longer
stringifies FastAPI's array-shaped 422 `detail` to
`[object Object],[object Object],…`, and the NaN gaps that caused that 422 are
filtered at all five magnetometry request sites — dropped before a fit and
restored on their original rows, substituted per axis on the elementwise
conversion path (BUG-017's contract, extended to the API request path). The
"autosave failing" banner the owner saw alongside it is BUG-019 above, not a
NaN failure: `saveAutosave` is measured succeeding with NaN/-0 cells. Filed as
BUG-019 on the branch and renumbered on rebase (BUG-020 was drafted for the
autosave banner and dropped, never used). Earlier 2026-09-19:
UX-004 filed and its collision half FIXED: the
Library's node-type marks collided across three contradicting per-view maps —
`▦` alone meant Folder, Figure page, Worksheet and two different commands —
and nothing checked, because UX-001's icon audit asserted each mark was
LABELLED, never that two marks were DISTINGUISHABLE. One source of truth
(`components/Library/nodeIcons.ts`) separated by silhouette rather than hatch,
an injectivity test over the complete kind set, `▦`/`▥` retired outright, and
the preview toggle `∿` joins `⠿`/`⋯` as a resting cue; the mark choice and
that density change are design judgement and still need the owner's eye; BUG-019 + BUG-020 FIXED: `captureTechniqueView` (`lib/techniqueViewMemory.ts`) spread its capture source whole, and three of its four callers hand it the ENTIRE `AppState` — so every per-technique view memory entry carried `datasets`, `plotWindows` AND the previous `techniqueViewMemory`, and alternating between two techniques compounded the map Fibonacci-wise (ratio -> phi ~ 1.62; measured on the owner's own sequence: 5.4 MB -> 16.3 -> 32.4 -> 70.0 -> 123.6 -> 214.8 -> 359.6 MB, then `JSON.stringify` throwing `Invalid string length`, then the page unresponsive for >45 s). The autosave that stringifies it runs on the thread that draws, which is why an ROI box integration's Apply produced an empty plot AND blanked previously plotted datasets; the StatusBar's persistent autosave-failing alert DOES fire, but its status line blamed storage for what was a serialization failure, and that wording is fixed too. Fixed by projecting the capture source down to its nine declared fields; same sequence now flat at 344 B. BUG-020, found alongside it and filed separately: `useCutLanding` minted cut ids from a private page-lifetime counter, so a reopened workspace holding `cut-1` plus one new cut held two datasets with that id — Apply plotted the OLD one and a single delete destroyed both; it now draws from `store/idSeq.ts`. UX-003 FIXED across three rounds: `lib/lazyRegion.tsx`,
a drop-in `lazy()` replacement, gives every code-split seam its own error
boundary and a retry that rebuilds `lazy()` — the only way to defeat React's
permanent memoization of a rejected lazy() promise. Re-measured the seam
count myself before touching anything: 30, not the filed 28. All 30
converted, plus AppOverlays' 52-panel `lazyPanel()` family via its one
shared call site. Two adversarial-review rounds each found and closed real
defects — round 2: the boundary was catching every descendant error, not
just a load failure, mislabeling genuine render bugs (fixed with a tagged
`LoadFailure` wrapper class + a re-throw for anything else), and a
module-scoped mutable "current lazy" let one instance's retry silently
remount every sibling instance of the same seam (fixed with a per-instance
retry + a success-only, mount-time-read cache so the common case stays
cheap); round 3: the tag was applied by mutating the caught rejection
(fails on a frozen value), the loader's synchronous path wasn't wrapped,
and this record's own numbers had drifted from the code and misattributed
a real cost delta to a "stale cache". 13 tests total, 7 sabotage rounds
each reddening the exactly-expected tests. Eager bytes, measured after
`npm ci` + a cleared vite cache: 876,437 B against the unmoved 876,469 B
budget — 32 B of headroom (see the entry's Completion record for the full,
corrected accounting); 2026-09-19 earlier: BUG-018 FIXED in `5d6ef1b9`: `lib/escapeStack.ts` gains a `modal` layer above `menu` and all ten backdrop dialogs became surfaces on it, so one Escape closes the innermost dialog only and a pending `ConfirmDialog` underneath stays pending — the bypass of the dispatcher's three early returns is keyed on the CLAIMANT resolving to a modal, so the four editing-target landing spots that killed the reverted first attempt all close on one Escape, and the modal's claim resolves synchronously at keydown and marks the event so a window-bubble `preventDefault()` claimant behind the dialog cannot kill it; P3.3 residual R1 closed and R13 closed, R12 untouched; 2026-09-19 earlier: BUG-018 filed: stacked backdrop dialogs all claim the same Escape, so one keystroke closes two dialogs and can answer a pending confirmation — pinned by test, not fixed; P3.3 residual R1 narrowed from CLOSED to focus-half-only and its bundle pair re-measured against the right parent; 2026-09-18: UX-003's `lazy()` site count corrected 17 -> 19 -> 28
— `plans/BUNDLE_HEADROOM.md` slice 3 added two more sites in modules the
record already named, then slice 4's own 2026-09-18 review round re-measured
after slice 4 added nine seams across three new modules, landing at 28;
2026-09-17: BUG-016 fixed and its review rounds 2 and 3 closed: a grouped figure's levels export with their channel's style, as the canvas draws them — on the pinned and Graph Builder paths too, and round 3 makes a pinned figure RECORD whether its colour was chosen so a theme, palette or display-position change between the pin and the export cannot bring the one-hue regression back; BUG-012 round 3 closed; BUG-017 fixed: NaN/±Infinity/-0 cells round-trip through `.dwk` save, autosave, Pack Project and workbook transfer; BUG-012 and BUG-013 review rounds closed, BUG-013 round 3 closing the live-span key, frozen-document self-containment and the canvas-less fallback; BUG-013 round 4 closing the document route's group_col degrade; UX-003 filed)  
**Initial author:** ChatGPT-Sol (not Claude)  
**Purpose:** A durable, additive record of defects and usability friction found while using Quantized as an OriginPro replacement.

This is a working document, not a claim that every observation is already reproduced or assigned. Add new reports using the template below. Do not check off an item merely because code was written: its acceptance criteria and relevant automated tests must pass. Items requiring owner testing should remain open until that testing occurs.

## Status key

- `[ ]` Open or not yet verified
- `[~]` In progress (use only while a named PR or branch exists)
- `[x]` Verified complete; add the date, PR/commit, tests, and verifier
- **P0:** data loss or scientifically incorrect result that can escape notice
- **P1:** blocks or seriously damages a primary workflow
- **P2:** substantial friction or confusing behavior with a workaround
- **P3:** polish or low-frequency inconvenience

## Active queue

| ID | Priority | Area | Issue | Owner | Status/evidence |
|---|---:|---|---|---|---|
| BUG-001 | P0 | NCNR `.refl` import/plot | Uncertainty and resolution are plotted as ordinary Y curves | Claude | Every code-verifiable box closed 2026-09-12; owner Windows visual check + a Reductus variant check remain |
| UX-001 | P1 | Origin project Library | Large worksheet cards are difficult to interpret and consume too much space | Claude | Compact Tree row + both residuals (icon audit, selected-vs-open) test-verified 2026-09-12; owner visual verification of the reported project remains. **Its icon-audit residual proved to be only half an audit — see UX-004**, which finishes it without reverting anything here |
| BUG-002 | P2 | Desktop bridge write consent | A hard-linked alias of a declared raw source defeats the never-overwrite-your-own-source check | Unassigned | Reproduced by strict `xfail`, 2026-09-09 |
| UX-004 | P1 | Origin project Library | Node-type marks COLLIDE — `▦` meant Folder, Figure page, Worksheet and two commands; `▤` meant Workbook and Report; `▥` meant Worksheet and five artifact kinds — across three contradicting per-view maps, and `▦ ▥ ▤` differ only by hatch at row size | Claude (agent) | **Collision half FIXED 2026-09-19** and locked by an injectivity test over the complete kind set (`nodeIcons.test.ts`); one shared vocabulary separated by silhouette. Density change (`∿` becomes a resting cue) and the choice of the eight marks are design judgement — owner eyeball on the reported project still required |
| UX-002 | P3 | Workbook copy/paste | Cross-workbook lineage (`versionOf`, external `derivedFrom`) is dropped silently — the count is computed but never shown | Unassigned | Found in review, pinned by test, 2026-09-09 |
| BUG-003 | P2 | Data Filter workbench | A filter predicate survives a column's type change with a stale `kind`, applied everywhere but invisible/uneditable in the panel that wrote it | Unassigned | Design-time finding, sabotage-verified, 2026-09-09 |
| BUG-004 | P3 | Stat Stage workbench | A picked "group by" column survives a `channelTypes` override that de-categorizes it, stranding a stale index the picker no longer offers (facet is deliberately NOT affected — see the entry) | Unassigned | Design-time finding, fixed + sabotage-verified, 2026-09-09 |
| BUG-005 | P2 | Corrections / Resample | A categorical channel is transformed like numeric data — its level codes become fractional and its level table is (correctly) discarded, so the column silently degrades to meaningless numbers | Unassigned | Found in the Group J propagation audit, strip pinned by test, 2026-09-09 |
| BUG-006 | P2 | Row slices, row edits, merge, corrections, pending previews | A row slice carried the `text_columns` sidecar through UNSLICED, so an extracted subset's text cells no longer lined up with its rows | Claude | **10 of 10 code sites fixed, re-verified 2026-09-14 by grepping every call site rather than trusting the count** (see the entry's "Every caller covered" box); `lib/barlayout.ts`'s label path was the last one, shipped 2026-09-12. The deferred end-to-end reproduction test (filter + Extract, at the `planExtract` layer) was added 2026-09-14 — see the entry's Reproduction checklist. Declared closed three times before it actually was, and FOUR review rounds each found defects in the previous round's fix — twice HIGH every round, with a fully green suite every time. The suite had caught essentially none of it; adversarial review, per-branch sabotage and measuring claims caught all of it. Owner's real-data visual confirmation remains open |
| BUG-007 | P2 | Test hygiene | A `void`-ed async store action in a test made its assertion vacuous AND leaked `set()` into a later test — misdiagnosed by me as a module-init-order hazard | Claude | **FIXED** 2026-09-09; reduction collected, pin lowered |
| BUG-008 | P2 | Split Dataset | An explicit `cat_levels` level table was invisible to Split, so a few-row categorical column MERGED all its samples into one child dataset (and, at row counts where the shape heuristic agreed, named the children after raw float codes) | Claude | **FIXED** 2026-09-10 after ONE review round that found 2 HIGH — the first cut fixed only the `cat_levels` shape and its chokepoint ratchet was evadable by an aliased import. 22 behaviour tests + a 2-test ratchet, every fix sabotage-verified |
| BUG-009 | P2 | Pending-dataset contract | Five ad-hoc guards rather than one contract; the data-CORRUPTING sites and the row-state family are guarded + ratcheted, and a failed fetch now names its reason instead of promising a retry forever — but "refuse" should still be "resolve-then-apply" | Unassigned | Found across five review rounds, 2026-09-10; corrupting sites, row state and the misleading message fixed, the deferral refactor open. A load-path fix for the row-state/pending clamp (Group AF, 2026-09-13) was built and reverted after adversarial review — see the entry |
| BUG-010 | P2 | Workspace load status | `migrationWarnings` are folded into the load status only on a plain File ▸ Open; crash recovery, silent autosave restore and Append Project each overwrite `status` one statement later, and workbook-package import never reads them at all | Claude (agent) | Found 2026-09-13 reviewing Group AF; **fixed 2026-09-13** (commit pending merge): one shared `notifyMigrationWarnings` toast from all four loaders, `duplicateWorkbook` a pinned structural non-goal. Adversarial review round (2026-09-13) closed the one real gap the fix missed — File ▸ Open itself never joined the toast channel — plus doc/citation cleanup; see the entry |
| BUG-011 | P1 | Pack Project (portable export) | `serializeCurrentWorkspaceForPack` never resolved pending datasets before serializing, so packing a workspace with an unopened lazy Origin book shipped that book's downsampled PREVIEW rows (and a stray `pending` field) as the portable project's real data | Claude (agent) | Found 2026-09-13 reviewing Group AF; **fixed 2026-09-13** (commit pending merge) — both the preview and Start-pack paths resolve first and abort by name if a book can't be fetched; 5 sabotage-verified specs. Adversarial review round (2026-09-13) closed both CONFIRMED code findings (Start pack's own resolve window, a book turning pending mid-fetch) plus doc/nit cleanup. Review rounds 2/3 (2026-09-13) closed further regressions, finished the finding #5 fix, and widened the terminal-status fix to every `failed`/`cancelled` transition. Residual closed 2026-09-13: `store/workspaceIO.ts`'s Save/Save As now shares the identical post-await `pending` re-check (see the entry) — every explicit export path (Save, Save As, workbook transfer, Pack Project) now closes finding #2's window. Owner call on abort-vs-partial-pack still open |
| FEATURE-001 | P3 | Faceted plots | Per-series styling (dash/width/colour/marker) is ignored by faceted plots on BOTH screen and export; panels can also resolve different channel sets, so one style list cannot serve the grid | Unassigned | Measured 2026-09-09; a fix was built, reviewed, and reverted — see the entry |
| BUG-012 | P2 | Figure export/reopen — axis breaks | A saved figure's x-axis break reaches export and survives reopen in the document, but nothing on screen ever renders it after reopen | Claude (agent) | Found by the P4.2 regression matrix (`1593cdee`); **FIXED 2026-09-14** — `Stage/useEffectiveComposition`'s durable fallback derives the paneled break from `plot.axisBreaks.x` via `lib/facet.durableComposition`, which wraps the SAME builder `breakAtGaps` uses (one construction site, no new persisted field). Divergence test inverted, `break` is a full matrix fixture again (screen ≡ export ≡ reopen + golden), facet-beats-break precedence defined and tested against the export path's own ordering. **Review round closed 2026-09-16** (F1-F5 + nits): panel x-ranges now come from the break BOUNDS so screen and export elide the same range for endpoints that are not data points; the stack toggle and a genuine dataset switch both clear the authored break; background windows panel it too; two residuals recorded. **Round 3 closed 2026-09-17**: the IMPORT rebind clears the break too (the third switch site), the no-break short-circuit is back in front of `analysisData`, the stack toggle no longer dirties the project when nothing changes, and the screen≡export claim is narrowed to in-extent non-empty breaks with the three diverging shapes recorded |
| BUG-013 | P2 | Figure export — waterfall view | A waterfall view's per-series vertical offset is applied on screen but never reaches the export wire, so the exported figure draws overlaid, un-offset curves | Claude (agent) | Found by the P4.2 regression matrix (`1593cdee`); **FIXED 2026-09-14** — `FigureSpec`/`FigureRequest` grew `waterfall_offsets`, a per-plotted-series shift in Y data units resolved by the new `lib/waterfallOffset.ts` (the canvas' own step, keyed by DISPLAY position) and applied by `calc.plotting.apply_waterfall_offsets`. The divergence test is inverted and `waterfall` is a full matrix fixture (screen ≡ export ≡ reopen) |
| BUG-014 | P3 | Figure export — legend rename | A legend rename replaces the whole on-screen label, but on export only the channel label is replaced and the backend re-appends the unit ("Loop 1" exports as "Loop 1 (au)") | Claude (agent) | Found by the P4.2 regression matrix (`1593cdee`); **FIXED 2026-09-15** — the rename rides its own per-series presentation field (`series_styles[i].legend`), used VERBATIM by `calc.figure_labels.series_display_name`, and the wire `dataset` keeps the DATA's labels/units. The divergence test is inverted. **Review round 2026-09-16** closed the FACET branch, which still shipped `"Loop 1 (au)"` (and showed no rename at all on screen), and `lib/spatialPageExport.ts`'s decoded Origin captions; an EMPTY rename stays a named residual. **Review rounds 3-4 (2026-09-17)** closed the remaining screen/export splits: a background window's facet grid, then the plain per-channel stack and the paneled x-break panels (all three multi-panel legs show a rename in the panel's y-axis label now), and a non-string rename in a hand-edited `.dwk` is dropped at the sanitizer instead of crashing the canvas. **Round 5 (2026-09-17)** reverses a regression round 4 introduced: the x-break leg re-derived one channel list over the whole dataset and mislabeled panels whose own channel lists differ, so each `BreakPanel` now carries its `channels` and the renames project per panel; technique-memory keys stay numeric. **Review round 5 (2026-09-17)** closed CLEAN: fixed 2 low-severity `numKeyedRecord` findings (a blank/whitespace key silently relocating onto channel 0; a key collision resolving to the non-canonical spelling regardless of file order) and corrected the round-5 sabotage table's undercounted rows 6/7 |
| BUG-015 | P2 | Figure export — hidden series palette | Hiding a series shifts later series' palette colour on export only; the canvas keeps a hidden series in the display list with `show:false` so later series keep their position, but the export's filtered channel list recolours them by their new, filtered index | Claude (agent) | Found by the P4.2 regression matrix (`1593cdee`); **FIXED 2026-09-14** — `lib/figureSpec.ts` derives each plotted channel's UNFILTERED display position unconditionally and `buildExportStyles` colours by it always (the P3.3 dash/marker cycle stays opt-in on top of the same positions). The divergence test is inverted, and `hidden` is now a full matrix fixture (screen ≡ export ≡ reopen + golden) |
| BUG-016 | P2 | Figure export — grouped per-series styling | A grouped figure's per-series style (colour/width/dash/marker) reaches the canvas — every level of the channel draws with it — but `routes/export_figures.py`'s `group_col` branch drops `series_styles` entirely, so the exported figure draws default-coloured, solid, default-width curves | Claude (agent) | Found by the 2026-09-14 review round of the P4.2 regression matrix; **FIXED 2026-09-17** — the `group_col` branch now expands the `y_keys`-aligned `series_styles` onto the synthetic per-level series (`calc.figure_group_styles`, pure), so every level draws with its channel's dash/width/marker/step/fill and explicit colour, exactly as the canvas does. COLOUR is honoured only when the user CHOSE one: an unstyled level takes the palette slot at its own display position, which one channel-aligned wire entry cannot carry, so `lib/exportStyles.ts` omits a palette-derived colour for a grouped request and both sides cycle per level. The divergence test is inverted, `styleComparable("group")` compares the style's SHAPE half again, and the `group` golden moved to record it. **Review round 2 (2026-09-17)** closed the three CONFIRMED findings: a PINNED `publication.seriesStyles` array bypassed the colour rule and made the backend paint every level ONE hue (a regression against the pre-fix cycle — round 2 recovered "derived vs chosen" from the palette slot itself in `lib/exportStyles.stripDerivedColors`, a function round 3 DELETED); the Graph Builder → Publication Preview handoff (`lib/plotSpecFigure.ts`) still dropped grouped styling outright, on the very half-truth this commit corrected elsewhere; and the legacy path's `grouped` flag was guarded by nothing (sabotage left the suite green). **Review round 3 (2026-09-18)** replaced round 2's recovery-by-comparison with PROVENANCE: `buildExportStyles` records `ExportSeriesStyle.colorDerived` on every colour it emits, the document persists it, and the single wire boundary `exportStyles.toWireSeriesStyles` applies the grouped rule and strips the flag — so a theme flip, a palette preset or a display-position shift between the pin and the export can no longer resurrect the one-hue regression, and a grouped request never sends a derived colour while an explicit one is always sent. The residual colour gap is now recorded precisely: different palettes **and** different cycle offsets; plus one scoped migration residual for documents saved before provenance existed. **Review round 4 (2026-09-18)** moved that migration to LOAD time — `publicationStyles.sanitizeExportSeriesStyles` decides a flagless colour once, when the document arrives, and the `.dwk` FigureDoc path now runs that sanitizer at all — so a re-save really does persist provenance, a malformed persisted flag cannot flip it, an imported Origin template records its decoded colours as CHOSEN, a pinned array is re-cut to `y_keys` when a channel was hidden after the pin, and the export route refuses a leaked `colorDerived` with a 422. **Review round 5 (2026-09-18)** removed the palette inference from BOTH places it had lived: the palette a pin was taken under is persisted in no document, so round 4's load-time comparison read the READER's theme and then FROZE a possibly-wrong answer on the next save (measured: a figure saved under one palette and opened under another shipped both derived colours to a grouped export — round 1's regression — permanently). Provenance is now recorded ONLY by the five producers; an unflagged colour is UNVOUCHED and fails closed, omitted from a grouped export and kept on a flat one, until the figure is RE-PINNED (loading and re-saving retire nothing). The pin re-cut is reduced to a hidden-channel filter over the pin, closing the three guard clauses round 4's review sabotaged green, and `/figure-hitmap`'s 422 gains the test the claim rested on |
| UX-003 | P3 | Lazy chunk loading (whole app) | A failed `lazy()` chunk fetch unmounted the React root — 30 `lazy()` sites measured 2026-09-19 (17 at filing, +2 slice 3, +9 slice 4, +2 more found unfiled at this fix's start), zero error boundaries, so the window went blank with no toast, no status, no console error, and React cached the rejection so the gesture could not retry | Claude (agent) | **FIXED** 2026-09-19, three rounds — `lib/lazyRegion.tsx`, a drop-in `lazy()` replacement: one error boundary per region distinguishing a load failure (a tagged `LoadFailure` wrapper, never a value mutation) from a genuine render bug (re-thrown, not mislabeled), plus a per-instance retry that rebuilds `lazy()` without ever remounting a sibling instance of the same seam. Wired to all 30 seams plus AppOverlays' 52-panel `lazyPanel()` family via one shared call site. 13 tests, 7 sabotage rounds each reddening the exactly-expected tests. Eager bytes (measured post `npm ci` with a cleared cache): 876,437 B vs 876,469 B budget (32 B headroom) — see the entry for the full accounting and a correction to an earlier mismeasurement |
| BUG-017 | P1 | Workspace save/reopen — NaN/±Infinity cells | `workspaceSerialize.ts`'s `data: d.data` has no NaN/±Infinity replacer, `JSON.stringify` turns them into `null`, and `workspaceDatasetParse.ts`'s `isNumberArray` rejects `null` and throws — so the WHOLE workspace fails to reopen after saving a dataset with one such cell (reachable by a plain `insertRows`, whose blank rows are minted as `Number.NaN`); `-0` separately round-trips silently to `0` | Claude (agent) | Found by the P2.1 round-3 review (pre-existing, outside that commit); **FIXED 2026-09-16** — the new `lib/nonFiniteCells.ts` encodes the four values JSON cannot represent as the sentinel strings `"NaN"`/`"Infinity"`/`"-Infinity"`/`"-0"` on the way out and decodes them on the way in, applied symmetrically by `workspaceSerialize.ts` (`.dwk`, autosave, Pack Project) and `workspaceDatasetParse.ts`, plus the same-shaped hole in `lib/workbookTransfer.ts`'s clipboard package. The encoders return their input by reference when nothing needs a sentinel, so an ordinary document is byte-identical to before (no schema bump); `null` deliberately stays a rejection and a malformed entry deliberately still refuses the whole workspace — see the entry for both rulings |
| BUG-018 | P2 | Backdrop dialogs — stacked Escape | Two backdrop dialogs can be open at once (`Ctrl+,` then `?`, no mouse) and ONE Escape closes BOTH, because all ten use `window` capture + `stopPropagation()`, which does not stop a same-node same-phase sibling; over a pending `ConfirmDialog` the same keystroke silently resolves the confirmation `false` | Claude (agent) | Found in the 2026-09-19 adversarial review of `cee0494f`; reproduced by the reviewer in real Chromium (keyboard only) and re-measured in jsdom on `490243f9`. **FIXED 2026-09-19** (`5d6ef1b9`) — the entry's option 1: `lib/escapeStack.ts` gains a `modal` layer above `menu`, and all ten backdrop dialogs are surfaces on it, so the innermost closes and nothing below it acts on the same keystroke (2 → 1 → 0 on the three stacked pairs; a pending confirm stays PENDING and resolves `false` only on the second Escape; the lone-dialog control is unchanged). The bypass of `isEditingTarget`/`cmdkOpen`/`.qzk-ctx` is keyed on THE CLAIMANT resolving to a modal, nothing below a modal is offered the key even when the modal declines, and (round-9 review) the claim resolves SYNCHRONOUSLY at keydown and marks the event, so a window-bubble listener that honours `defaultPrevented` — `usePeakWizard`'s marker-edit pause — can no longer kill the dialog's close mid-dispatch. The bypass is what the reverted first attempt lacked: all four editing-target landing spots (Help's search box, Separate's and Combine's Name field, Split's Column select) are measured closing on ONE Escape, one test each. A second blocker was found on the way: Combine/Separate/Split stopped EVERY key in the dialog box's React `onKeyDown`, and a React synthetic `stopPropagation()` stops the NATIVE event at the React root — below `window` — so Escape is now let through there. R13's three missing reachability pins are closed with it; R12 is untouched and its wording unchanged |
| BUG-019 | P1 | Per-technique view memory / dataset switch / autosave | `captureTechniqueView` stored the WHOLE object handed to it, and three callers hand it the entire `AppState` — so each entry held the library, the windows and the PREVIOUS memory map, compounding the serialized workspace on every dataset switch (Fibonacci-wise when alternating two techniques, ratio -> phi ~ 1.62) until autosave's `JSON.stringify` stalled the main thread and every plot, new and old, stopped drawing | Claude (agent) | Owner-reported 2026-09-19 (XRDML 3-D map + box integration); **FIXED 2026-09-19** — the capture projects down to its nine declared fields. Measured before/after on the owner's exact sequence in the running app: 5.4 MB -> 359.6 MB -> `RangeError` -> unresponsive, versus a flat 344 B |
| BUG-020 | P2 | Durable dataset identity | A derived/imported dataset took its id from a private page-lifetime counter (`cut-1`, `magbg-1`, etc.) instead of `store/idSeq.ts`, so a reopened workspace plus one new operation could hold TWO datasets with that id: the app could plot the old result and one delete could destroy both | Claude + ChatGPT-Sol (agents) | Cut landing fixed 2026-09-19. **Repository-wide source audit completed 2026-09-20 (ChatGPT-Sol):** the initially reported four workshop hooks plus demo/sample loading, folder/template batches, worksheet extraction/transforms, Import Wizard, SQLite, Dataset Math, Digitizer, Tabulate and both FFT reductions now use `nextDatasetId()`. Counters remain only where they number a human-readable name. A source-level architecture ratchet pins all migrated producers to the shared sequence and rejects every retired durable-id prefix. Owner verification remains. |
| BUG-021 | P0 | Magnetometry workshop — Background tab | The tab ran the M(T) one-sided high-T fit (`subtract_mag_background`) on an M(H) hysteresis loop, whose own docstring forbids exactly that: the window sits entirely in the +H tail, so the intercept removed carries +Ms and the corrected loop is sheared down by Ms (measured: plateaus at 0 and −2·Ms, squareness a meaningless 1.0000). Surfaced to the owner as `[object Object],[object Object],[object Object],[object Object]` — `ensureOk`'s `as { detail?: string }` cast stringifying FastAPI's array-shaped 422 `detail`, one entry per NaN gap that `JSON.stringify` had written as `null` | Claude (agent) | Reported 2026-09-19 by owner on a real VSM loop (filed as BUG-019 on the branch, renumbered on rebase); all four reported defects reproduced by measurement before any code changed. **FIXED 2026-09-20** — dispatch on the DECLARED x label/unit (`lib/magDataKind.ts`, reading `x_column_long` first so an Origin SHORT column name cannot masquerade as a field symbol), failing closed to a user choice when it cannot be determined; gaps dropped before every fit request and restored on their original rows, and SUBSTITUTED per axis on the elementwise conversion path (`lib/api/finitePairs.ts`); all five magnetometry call sites filtered, including the Hysteresis workshop's automatic analysis; any `detail` shape rendered readably (`lib/api/errorDetail.ts`, lazily imported to keep it out of the eager bundle); panel wording, control label, per-path default and the reported quantity (offset, not intercept) follow the path actually selected; a documented no-op is reported as a no-op; the readout is tagged with the datasets it is about so a dataset switch cannot leave a stale one on screen. 13 sabotages over two rounds, each restored byte-identical. Owner verification on the reported file remains |
| BUG-022 | P1 | Fitting and peak-analysis request boundaries | `selectedFitData` deliberately preserves non-finite values, but consumers posted them to pydantic `list[float]` routes, turning NaN into rejected `null` values | ChatGPT-Sol | **FIXED 2026-09-20, widened by critical self-review:** direct Curve/Equation/Bumps fits, auto-guess, model scan, Peak Analyzer, the older Peaks workshop, saved-fit recomputation and pipeline replay now apply `dropGapRows`. Fitted curves are scattered back through `restoreGapRows`; weighting follows the same kept indices; pipeline logs and interactive notices disclose exclusions. Grouped fits and ROI gadgets were audited and already filtered finite pairs. The selector remains unchanged, preserving the original design ruling. |
| BUG-023 | P2 | Frozen figure and snapshot-window persistence | Frozen `FigureDocument` snapshots and `kind:"snapshot"` plot windows bypass BUG-017's non-finite-cell codec: JSON converts NaN/±Infinity to `null` and `-0` to `0`; reopen cannot recover infinity kind/sign or signed zero | ChatGPT-Sol | Code-proven at both independent data-bearing persistence boundaries in the v0.26.1 post-release audit; full pickup brief in `POST_RELEASE_PROBLEM_AUDIT.md` |
| UX-005 | P1 | Quick Plot refusal guidance | The current release tells users Configure Quick Plot “arrives with the Quick Figure Builder (PR G)” even though **Configure Quick Plot…** and the builder already shipped and appear beside Quick Plot | ChatGPT-Sol | Code-proven user-facing stale copy at both refusal constants; tests currently pin the wrong wording. Full pickup brief in `POST_RELEASE_PROBLEM_AUDIT.md` |
| UX-006 | P3 | Installed-version diagnostics | `qz --version` is rejected, so users and support agents cannot identify an installed CLI/package build using the conventional command; the release smoke test must import Python internals instead | ChatGPT-Sol | Reproduced against the published v0.26.1 wheel and confirmed absent from `cli.py`; full pickup brief in `POST_RELEASE_PROBLEM_AUDIT.md` |
| UX-007 | P2 | Workbook Properties command | The workbook right-click menu shows **Properties…** permanently disabled and explains it with the internal roadmap text “arrives with Details/Properties (PR D)”, even though PR D shipped; the result is a prominent dead end in the new Origin-like Library | ChatGPT-Sol | Code-proven in the v0.26.1 action registry and pinned by its unit test. Full pickup brief in `POST_RELEASE_PROBLEM_AUDIT.md` |

---

## BUG-001 — NCNR `.refl` uncertainty roles are plotted incorrectly

**Priority:** P0 — scientifically misleading default visualization  
**State:** Open — every CODE-VERIFIABLE checklist box is now closed (2026-09-12);
what remains needs a human or an external file: the owner's Windows visual
check on the reported file (Acceptance criteria), the reproduction-checklist
item asking to check a Reductus variant beyond the repository fixture, and
the reproduction-checklist item asking for a manual Error-Columns UI check
"in the current release" (a running-app check, not a unit test).
Plot-window-rebinding preservation of the declared roles (drag/drop a
dataset onto an existing window) is now also verified — see the Completion
record's second 2026-09-12 entry.  
**Reported:** 2026-09-08 by owner  
**Investigated:** 2026-09-08 by ChatGPT-Sol  
**Suggested implementation owner/model:** Claude Sonnet for parser/state reliability; ChatGPT-Sol for final interaction and visual review  
**Likely scope:** `src/quantized/io/ncnr.py`, import-role/default plotting logic, and their backend/frontend tests

### User-visible problem

Opening `S3_6500e_From700mT.refl` produces three independent curves named approximately:

- `counts per incident count`
- `uncertainty`
- `resolution`

That default is wrong. The latter two columns describe uncertainty; they are not independent measured Y series. Plotting them as curves also gives them colors and legend entries, making a plausible-looking but scientifically misleading figure.

### Confirmed implementation evidence

- [x] The NCNR Reductus parser currently maps Qz to the independent axis and puts every remaining file column into `DataStruct.values`.
- [x] Unlike the NCNR refl1d-style parser, `import_ncnr_refl` supplies no `default_value_channels` or `error_channels` plotting hints.
- [ ] ~~Generic label inference can recognize the standalone `uncertainty` label and associate it with the preceding measured channel.~~ **Corrected 2026-09-09 (Claude): this is not what happens for this file.** Measured against the fixture's own labels: `inferErrorBindings({labels: ["Intensity","uncertainty","resolution"]})` returns `[]`. The context-free classifier does return a spurious hit on `uncertainty` — it strips a leading `unc` and reports base `"ertainty"` — and the sibling-evidence gate then correctly rejects it, since no `ertainty` column exists. So no binding was produced by inference, and the roles had to come from the parser.
- [x] Generic default channel selection does not hide inferred error-role channels from the initial plot.
- [x] `resolution` is not a generic error token, so label inference does not identify its scientific role.
- [x] The existing fixture declares columns `[Qz, Intensity, uncertainty, resolution]` with units `[1/Ang, counts, counts, 1/Ang]`, which provides a stable regression case.

### Intended scientific mapping

- Qz is X.
- Intensity/reflectivity (`counts per incident count` in the reported file) is the plotted Y series.
- `uncertainty`, with the same units as intensity, is the symmetric vertical/Y uncertainty for the measured series.
- `resolution`, with Q units (`1/Ang`), is the symmetric horizontal/X uncertainty (dQ/resolution).
- Both uncertainty columns remain accessible and editable as data, but are hidden as standalone curves by default.

The implementation must use the file format's semantics, not merely the exact display names shown in one file. If Reductus variants use different column names or omit one uncertainty column, the importer must fail safely and leave ambiguous roles unassigned.

### Reproduction checklist

- [x] Import an NCNR Reductus `.refl` file containing Qz, measured intensity, uncertainty, and resolution.
- [x] Observe all three value columns drawn as lines on the default log-Y plot.
- [x] Observe uncertainty and resolution included as ordinary legend series.
- [ ] Confirm whether manually assigning the two roles in **Error Columns** immediately produces correct X/Y whiskers in the current release.
- [ ] Check at least one Reductus file variant beyond the repository fixture before broadening name matching.

### Implementation checklist

- [x] Define parser-owned default semantics for a recognized four-column Reductus reflectometry layout.
- [x] Default the plotted channel set to the measured intensity/reflectivity only.
- [x] Bind the intensity uncertainty as symmetric Y error.
- [x] Bind resolution/dQ as symmetric X error using the canonical rich error-role model.
- [x] Ensure bound error columns do not appear as independent curves or ordinary legend entries by default.
- [x] Preserve all imported numeric columns in the worksheet; do not alter raw values.
- [x] Keep every role overridable through the import/error-column UI. NCNR-`.refl`-SPECIFIC (2026-09-12, Claude): `frontend/src/components/Stage/usePlotPayload.errorRoles.test.ts`'s "NCNR .refl error roles are overridable through the store action ErrorRolesCard calls" describe block imports the real fixture's declared roles via `useApp.importPaths`, confirms they land, then overrides one binding through `useApp.getState().setErrorRoles` — the EXACT action `ErrorRolesCard.tsx`'s Side `<Select>` `onChange` calls via its `patch` helper — and confirms both that the store keeps the override (not the parser's declaration) and that the NEXT render of the real `usePlotPayload` hook draws accordingly (the resolution binding's horizontal whisker disappears once its `side` is overridden to an incomplete asymmetric pair; the untouched Y/uncertainty whisker is unaffected). Sabotage-verified: making `setErrorRoles` a no-op (write back the dataset's existing roles instead of the new ones) made both new tests fail; reverted.
- [x] Handle files that omit uncertainty, omit resolution, or contain additional value columns without shifting indices incorrectly.
- [x] Ensure workspace save/reopen and duplication preserve the intended roles. **Save/reopen, confirmed 2026-09-12 (Claude):** `frontend/src/lib/workspace.test.ts:2149` ("BUG-001: an NCNR .refl's declared Y+X roles round-trip through a workspace save/reopen", landed 2026-09-09) already round-trips the exact declared Y+X shape through `serializeWorkspace`/`parseWorkspace` — read and confirmed, not re-done. **Reimport (the store's `reimportDataset` action), unchanged-shape case, now also covered:** `frontend/src/store/reimport.test.ts`'s BUG-001 describe block (see the visibility item below) asserts the declared `errorRoles` survive a same-shape reimport unchanged. **Plot-window rebinding (dragging/dropping a dataset onto an existing window), confirmed 2026-09-12 (Claude):** `frontend/src/components/Stage/usePlotPayload.errorRoles.test.ts`'s "rebindWindow (drag/drop) preserves an NCNR .refl's declared error roles (BUG-001, plot-window rebinding)" describe block drives the real `useApp.getState().rebindWindow` action (not a hand-built window record) against a real NCNR `.refl` import, covering both the FOCUSED-window rebind path and the BACKGROUND (unfocused) window rebind path, and confirms the resulting window's own payload (via the real `usePlotPayload` hook, fed `documentErrors` exactly as `PlotStage`/`BackgroundPlotWindow` thread it) draws both the Y and X whiskers. A third case confirms an explicit `setErrorRoles` override made on the dataset BEFORE the rebind survives it — the rebind reads the dataset's CURRENT roles, not a stale parser default.
- [x] Verify that user-customized channel visibility is not overwritten after the initial default is established. NCNR-`.refl`-SPECIFIC (2026-09-12, Claude): `frontend/src/store/reimport.test.ts`'s "reimportDataset — NCNR .refl channel-visibility customization survives a same-shape reimport" describe block confirms the default (`defaultDenseChannels` on the fixture's own shape returns `[0]` only — the measured channel alone), then customizes BOTH directions — widen (`yKeys: [0, 1]`, plotting `uncertainty` as an ordinary series) and hide (`hiddenChannels: [0]`, hiding the default series) — and reimports the SAME-shape fixture (real rows 5-9 of `tests/golden/ncnr_j395_default.json` fed in place of rows 0-4): both customizations, and the declared `errorRoles`, survive untouched. Sabotage-verified: forcing `store/reimport.ts`'s `viewReset` to always fire (dropping the `shapeChanged` gate) made all three new assertions fail — and also broke the PRE-EXISTING generic pin ("keeps the live view's channel-keyed state when the shape is unchanged"), confirming the sabotage genuinely exercised the shared chokepoint; reverted.

### Automated-test checklist

- [x] Backend parser test asserts the semantic hints/roles emitted for `tests/fixtures/ncnr_j395.refl`.
- [x] Backend tests cover missing and reordered optional columns if the format permits them.
- [x] Frontend import test asserts the canonical Y- and X-error bindings stored on the dataset.
- [x] Default-channel test asserts only the measured series is selected initially.
- [x] Rendering/payload test asserts uncertainty and resolution are absent as standalone series.
- [x] Overlay test asserts Y uncertainty and X resolution produce vertical and horizontal spans respectively.
- [x] Log-axis regression test confirms valid uncertainty rendering without changing the underlying data.
- [x] Relevant backend, frontend, type-check, and production-build gates pass. Run in full 2026-09-12 (see Completion record): `npx tsc -b --force` clean; `npx eslint` (touched files) clean; targeted `npx vitest run` (touched/new files + `architecture.test.ts`) 468 passed/0 failed; FULL `npx vitest run` **625 test files, 10049 tests, all passed, 0 failed**; `npm run build` (via `npm ci` first) succeeded — `tsc -b && vite build` clean, bundle 896.3 kB eager (budget 897.3 kB, 0.9 kB headroom).

### Acceptance criteria

- [x] A freshly imported recognized `.refl` file opens with only its measured reflectivity/intensity curve selected. **2026-09-14 (Claude):** backend, `tests/test_io_ncnr.py::test_refl_declares_uncertainty_and_resolution_roles` asserts `ds.metadata["default_value_channels"] == [0]` on the real fixture; frontend, `frontend/src/lib/plotdata.test.ts`'s "BUG-001: an NCNR .refl import selects only the measured channel by default" pins `defaultDenseChannels` to `[0]` on an all-equally-dense 3-channel dataset (so the hint, not the density heuristic, is what is doing the work), and `frontend/src/store/reimport.test.ts`'s "only the measured channel is the default (before any customization)" (inside the BUG-001 describe block) asserts the same against the real NCNR-shaped metadata — its own comment names this exact acceptance criterion.
- [x] Vertical bars represent the intensity uncertainty. **2026-09-14 (Claude):** `frontend/src/lib/errorbars.test.ts`'s "NCNR reductus .refl role bindings (BUG-001)" describe block, case "binds the uncertainty channel to a VERTICAL (y-axis) span on the measured series" — asserts `buildErrorSpans` produces a y-axis span from the uncertainty column's own values; end-to-end confirmation through the real render hook in `usePlotPayload.errorRoles.test.ts`'s "draws a VERTICAL span from the uncertainty binding and a HORIZONTAL span from the resolution binding".
- [x] Horizontal bars represent Q resolution when provided. **2026-09-14 (Claude):** same describe block, case "binds the resolution channel to a HORIZONTAL (x-axis) span, not a y one" — asserts an x-axis span from the resolution column; same end-to-end hook test as above.
- [x] Neither uncertainty column appears as a normal legend series unless the user explicitly chooses to plot it. **2026-09-14 (Claude):** default-hidden half — `errorbars.test.ts`'s "draws neither uncertainty nor resolution as a plotted series alongside the spans" (only channel 0 is ever passed as `plotted`) and `usePlotPayload.errorRoles.test.ts`'s "plots only the measured channel; uncertainty/resolution never appear as series". Explicit-choice half — `reimport.test.ts`'s "a customization that WIDENS the default (plotting uncertainty as an ordinary series) survives a same-shape reimport" drives the real store (`yKeys: [0, 1]`, the Channels-card checkbox path) and confirms uncertainty stays plotted once the user asks for it.
- [x] The worksheet still exposes every original column and value. **2026-09-14 (Claude):** `tests/test_io_ncnr.py::test_refl_declares_uncertainty_and_resolution_roles` asserts `ds.labels == ("Intensity", "uncertainty", "resolution")` and `ds.values.shape == (325, 3)` on the real fixture — every imported column present and untouched, exactly this criterion's wording.
- [x] Ambiguous/unrecognized layouts are not silently given confident but unsupported bindings. **2026-09-14 (Claude):** `tests/test_io_ncnr.py::test_refl_roles_fail_safe_on_unrecognised_layouts` (parametrized: swapped uncertainty/resolution order, and no recognisable token at all) asserts `_refl_role_metadata(...) == {}` — no roles emitted, rather than a confident but wrong binding.
- [ ] Owner verifies the reported file visually on Windows.

### Completion record

- PR/commit: in progress on `claude/repo-evaluation-l7y7k9` (parser roles + the
  frontend consumer they needed)
- Automated tests: `tests/test_io_ncnr.py` (declared roles, unit-gating,
  fail-safe layouts, the `R`/`dR`/`dQ` spelling);
  `frontend/src/store/importDatasets.test.ts` (declared roles honoured
  including the X binding, precedence over the label guess, malformed entries
  dropped with fallback intact). The two behavioural frontend tests were
  verified to fail without the change.
- Agent verification: the parser emits the roles and the store stores them;
  the rendered plot draws horizontal whiskers from an X binding on this
  dataset (`usePlotPayload.errorRoles.test.ts`); save/reopen round-tripping of
  the declared roles is confirmed (`workspace.test.ts:2149`) and same-shape
  reimport round-tripping of them is now covered too
  (`reimport.test.ts`); the "role overridable through the UI" and
  "user-customized visibility is not overwritten" criteria are now covered by
  NCNR-`.refl`-specific tests (2026-09-12, Claude — see the Implementation
  checklist above). Plot-window-rebinding preservation for this shape is now
  covered too (2026-09-12, Claude, second pass — see below).
- Owner verification: pending — required for this item (Windows, reported file)
- Notes: the fix needed a contract gap closed first. `metadata["error_roles"]`
  was written by the backend and read by NOTHING, so no parser could express an
  X error at all; `store/importErrorRoles.ts::parserErrorRoles` is that missing
  reader. `io/ncnr.py`'s `import_ncnr_dat` has the same latent problem for its
  own `dQ` column and is deliberately NOT changed here — out of scope for this
  item, and it needs its own fixture evidence.

- **2026-09-09 (Claude), verification pass closing the remaining automated-test
  checklist boxes + the omitted/extra-column parser gap:**
  - `_refl_role_metadata` (`src/quantized/io/ncnr.py`) changed from an
    all-or-nothing exact-3-column match to PER-COLUMN recognition: each
    candidate uncertainty/resolution channel binds (or not) purely on its own
    name+unit evidence (uncertainty: immediate-preceding-channel unit match;
    resolution: x-unit match), so a real variant that omits one of the pair, or
    carries extra value columns anywhere in the layout, still gets the
    bindings that ARE unambiguous, and an unidentifiable column is simply left
    plotted rather than voiding the whole file's roles. Channel indices are
    read from wherever the columns actually are — never reassigned to a fixed
    0/1/2 position. `tests/test_io_ncnr.py` gained 7 new/rewritten tests
    (omitted resolution, omitted uncertainty, leading/trailing extra columns,
    two duplicate-"uncertainty" columns beside a valid resolution, an
    unrecognised-token column beside a valid resolution) plus a rewrite of the
    unit-mismatch test for the new per-column semantics; all 7 were confirmed
    to FAIL against the pre-change parser before the rewrite (ncnr.py stayed
    424 lines, under the 500-line ceiling — no extraction needed).
  - Default-channel test: `frontend/src/lib/plotdata.test.ts` — a
    `.refl`-shaped, equal-density 3-channel dataset with
    `metadata.default_value_channels: [0]` asserts `defaultDenseChannels`
    returns `[0]` only (the density heuristic alone would have returned all
    three).
  - Rendering/payload test: `frontend/src/lib/plotdata.test.ts`'s
    `buildColumns` case, and `usePlotPayload.errorRoles.test.ts`'s first case
    (below) — both assert `series`/labels never contain "uncertainty" or
    "resolution".
  - Overlay/span test: `frontend/src/lib/errorbars.test.ts`'s new "NCNR
    reductus .refl role bindings" describe block asserts `buildErrorSpans`
    produces a y-axis span (vertical) from the uncertainty binding and an
    x-axis span (horizontal) from the resolution binding, keyed on the one
    plotted column — plus an end-to-end version through the real hook,
    `frontend/src/components/Stage/usePlotPayload.errorRoles.test.ts` (new
    file; `fetchPlot` mocked to delegate to the real `buildColumns`, matching
    the established `usePlotPayload.quickFigureParity.test.ts` pattern).
  - Log-axis regression: `frontend/src/lib/uplotOverlays.test.ts`'s new
    `errorSpansPlugin (item 4: log-Y axis, ...)` describe block — a
    `valToPos` stub mimicking a real log-scale uPlot (NaN for any
    non-positive input) confirms the plugin hands the RAW, unclamped
    lower-whisker value through (producing NaN, which a real canvas silently
    skips) rather than altering the magnitude, and that neither the plotted
    data nor the span magnitudes are mutated by drawing.
  - Round-trip test: `frontend/src/lib/workspace.test.ts` gained a
    BUG-001-labeled case round-tripping the exact declared Y+X shape through
    `serializeWorkspace`/`parseWorkspace` (the pre-existing generic
    asymmetric/X-error round-trip test already covered the mechanism; this
    pins the actual NCNR shape). `frontend/src/store/useApp.test.ts` gained a
    `duplicateDataset` case for a RICH (X-error) binding specifically — the
    pre-existing F5 test only covered the `errorRoles: []` marker, not a rich
    binding — confirming the clone gets an independent array with the same
    bindings. Reimport and plot-window-rebinding preservation were NOT
    exercised this pass; still open (2026-09-12: reimport round-tripping is
    now covered — see below and the Implementation checklist; plot-window
    rebinding remains open).
  - **Review round (same day), two real defects in the above, both fixed:**
    (1) `_measured_channel_for_uncertainty` rejected a BLANK unit outright, so a
    dimensionless reflectivity — `R`/`dR` with no units, an ordinary reductus
    spelling — got no Y binding and `dR` was still drawn as its own curve: the
    original BUG-001 symptom, and a test had locked it in. Units must now
    AGREE, and two blanks agree. The asymmetry with `_resolves_to_x_axis`
    (which still demands a non-empty unit) is deliberate and documented: the
    uncertainty pairing already has its own name plus adjacency to a non-error
    column as independent evidence, whereas an x-axis binding has neither, so
    there the unit is the only evidence. (2) `default_value_channels` listed
    EVERY unbound channel, and a non-empty hint short-circuits
    `defaultDenseChannels`' density heuristic (`lib/plotdata.ts:189`, verified)
    — so a monitor/`Lambda`/unit-mismatched column the parser explicitly
    declined to reason about was PINNED as a plotted curve where the heuristic
    used to hide it, turning "I don't know what this is" into a confident
    plotting decision. It now lists the identified measurement targets only,
    which is what this item's own acceptance criterion asks for ("only its
    measured reflectivity/intensity curve selected"); unrecognised columns stay
    in the worksheet and stay toggleable. Pinned by
    `test_refl_roles_bind_a_dimensionless_r_dr_dq_file_and_plot_only_r`.
  - Gates run: `uv run ruff check src tests tools`, `uv run mypy src`,
    `uv run pytest tests/test_io_ncnr.py -q` (26 passed) all green;
    `npx tsc --noEmit -p tsconfig.json` clean; `npx eslint <touched files>
    --max-warnings=0` clean; targeted `npx vitest run` on every touched/new
    file plus `src/architecture.test.ts` — 757 passed, 0 failed (confirms the
    weak-wait ratchet and size-ceiling guards are unaffected). Full frontend
    suite and `npm run build` intentionally NOT run (left to the requester
    per instructions).
  - Still open / not verified this pass: owner's Windows visual check on the
    reported file; the "role overridable through the UI" and
    "user-customized visibility survives the default" criteria (no NCNR-.refl-
    specific test written for either); reimport and plot-window-rebinding
    round-tripping.

- **2026-09-12 (Claude), closing the remaining code-verifiable checklist
  boxes (owner/hardware boxes untouched):**
  - **Implementation checklist item "Keep every role overridable..."**:
    NCNR-`.refl`-specific test added, `frontend/src/components/Stage/
    usePlotPayload.errorRoles.test.ts` — see that checklist line for detail.
    Sabotage-verified (no-op override) FAILED both new tests before revert.
  - **Implementation checklist item "Verify that user-customized channel
    visibility is not overwritten..."**: NCNR-`.refl`-specific test added,
    `frontend/src/store/reimport.test.ts` — see that checklist line for
    detail. Sabotage-verified (always-reset `viewReset`) FAILED all three new
    assertions (and the pre-existing generic pin) before revert.
  - **Stale-record reconciliation**: the "reimport/save/reopen round-trip"
    mention above was stale for the save/reopen half — `workspace.test.ts:2149`
    already covers the exact NCNR Y+X shape (landed 2026-09-09, confirmed by
    reading it, not redone). The reimport half is now genuinely covered too
    (this pass, unchanged-shape case). Plot-window rebinding (drag/drop onto
    an existing window) was the one sub-case of this item that remained
    unverified after this pass — now covered, see the follow-up 2026-09-12
    entry below.
  - **Automated-test checklist item "Relevant backend, frontend, type-check,
    and production-build gates pass."**: run in full this pass (previously
    deferred to the requester).
    - `npx tsc -b --force`: clean (exit 0).
    - `npx eslint src/components/Stage/usePlotPayload.errorRoles.test.ts
      src/store/reimport.test.ts src/store/importErrorRoles.ts
      src/store/reimport.ts --max-warnings=0`: clean.
    - `npx vitest run` (targeted: both new/touched files + every file this
      item's Completion record already names + `architecture.test.ts`): 468
      passed, 0 failed.
    - `npx vitest run` (FULL suite, 2026-09-12, after `npm ci`): **625 test
      files, 10049 tests, all passed, 0 failed** (606s).
    - `npm run build` (via `npm ci` first, per this repo's own
      "vite's transform cache also lies" lesson): **succeeded** — `tsc -b`
      clean, `vite build` clean (955 modules), `check-bundle-size.mjs`:
      "bundle-size: OK — 896.3 kB eager, 0.9 kB under budget" (897.3 kB).
  - No backend/parser code touched this pass (scope was additive frontend
    tests + this plan file), so `uv run pytest tests/test_io_ncnr.py -q`
    (26 passed, per the prior pass) was not re-run.
  - Still open after this pass: owner's Windows visual check on the reported
    file (Acceptance criteria); the "check a Reductus variant beyond the
    fixture" and "confirm manual Error-Columns assignment in the current
    release" reproduction-checklist items (need a human/external file);
    plot-window-rebinding preservation of the declared roles across a
    reshape/rebind — now covered, see the follow-up 2026-09-12 entry below.

- **2026-09-12 (Claude), second pass — the plot-window-rebinding checklist box
  closed (the last code-verifiable box on this item):**
  - Found the existing rebind action: `store/windows.ts`'s `rebindWindow` (the
    EXPLICIT drag/drop gesture) already threaded `errors: ds?.errorRoles,
    resetErrors: true` into `store/windowDocuments.ts`'s `syncPlotWindow` for
    BOTH the focused-window path (`focusedRebindPatch`) and the
    background-window path — reading the dataset's rich `errorRoles` fresh off
    the store at rebind time, not a value captured at import. Reading the code
    first (per the verify-before-building rule) found the wiring already
    correct; the gap was verification, not implementation.
  - New tests: `frontend/src/components/Stage/usePlotPayload.errorRoles.test.ts`'s
    "rebindWindow (drag/drop) preserves an NCNR .refl's declared error roles
    (BUG-001, plot-window rebinding)" describe block (3 cases), mirroring the
    file's own established fixture-loading pattern (the real
    `useApp.getState().importPaths` against a hand-built payload matching
    `tests/golden/ncnr_j395_default.json`'s first five rows, exactly as the
    two describe blocks above it and `store/reimport.test.ts`'s BUG-001 block
    already do):
    1. A FOCUSED window opened on a plain dataset, then rebound via the real
       `rebindWindow` action onto the NCNR dataset: the window's own
       `document.bindings.errors` equals the parser-declared roles, AND the
       window's own rendered payload (the real `usePlotPayload` hook, fed
       `documentErrors` exactly as `PlotStage` threads it for a focused
       window) draws both the Y (uncertainty) and X (resolution) whiskers.
    2. The SAME rebind onto a BACKGROUND (unfocused) window: the declared
       roles land on that window's own document too, and rebinding it never
       touches `focusedWindowId` or the other (focused) window's binding —
       exercises `rebindWindow`'s OTHER branch (the non-focused-window `else`
       in `store/windows.ts`).
    3. An explicit `setErrorRoles` override applied to the NCNR dataset
       BEFORE it is ever dropped onto a window: the rebound window ends up
       with the OVERRIDE, not the parser's original declaration — confirming
       `rebindWindow` reads the dataset's CURRENT roles, not a stale value.
  - Sabotage-verified, each restored immediately after: removing
    `errors: ds?.errorRoles, resetErrors: true` from `focusedRebindPatch`'s
    `syncPlotWindow` call made cases 1 and 3 FAIL (2 failed/8); separately
    removing the same option from `rebindWindow`'s background-window
    `syncPlotWindow` call made case 2 FAIL (1 failed/8, exactly the
    background test) — confirming both branches are independently covered
    and the tests genuinely exercise the code they guard, not a shared
    incidental path.
  - Gates run (frontend-only; no `src/quantized/` code touched, so no backend
    gate): `npx tsc -b --force` clean (exit 0); `npx eslint` on every touched
    file clean; targeted `npx vitest run` (the new/touched file plus
    `architecture.test.ts` and every DatasetRow/FigureRow/WorkbookRow/
    FolderRow/ArtifactRow/window test this pass also touched for UX-001) —
    671 passed, 0 failed; FULL `npx vitest run` (after `npm ci`) — see the
    combined gate summary at the end of the UX-001 entry below (this session
    ran ONE full suite + build covering both items).
  - Not done / out of scope: the owner's Windows visual check, the Reductus
    variant check, and the manual Error-Columns UI check remain open (need a
    human/external file, per the item's own State line) — not touched here.

---

## UX-001 — Origin workbook worksheet cards are oversized and unclear

**Priority:** P1 — major friction parsing imported Origin projects  
**State:** In progress — compact Tree row implemented and test-verified; owner visual verification still required before this can be marked complete  
**Reported:** 2026-09-08 by owner  
**Investigated:** 2026-09-08 by ChatGPT-Sol  
**Suggested implementation owner/model:** ChatGPT-Sol or a lower-cost Codex frontend model for interaction/CSS; Claude Sonnet for integration/reliability review  
**Related plan:** `plans/LIBRARY_WORKBOOK_UX_PLAN.md`

### User-visible problem

Expanded Origin books show large rectangular worksheet/dataset cards in the left Library. The cards contain a sparkline, point count, channel count, duplicate/delete icons, and an add/plot control, but that structure is not apparent. Similar truncated names and weak type cues make it difficult to tell:

- whether a box represents a book, worksheet, dataset, or saved graph;
- why some items are large preview cards while others are compact rows;
- what each icon does;
- which item owns the currently displayed plot; and
- whether clicking, double-clicking, or the `+` control opens, plots, or adds the item.

The result is particularly difficult in a large imported Origin project, where hierarchy comprehension matters more than decorative previews.

### Design direction

Use a compact, scan-first Origin-like tree as the default for expanded workbook contents. A worksheet row should communicate type, name, status, and key size information before offering a preview. Thumbnails remain valuable, but should be an explicit expanded state or part of the existing Tiles view rather than forcing every tree item to become a tall card.

### Research and decision checklist

- [x] Inventory every row/card type that can appear beneath an imported Origin folder and workbook. — `LibraryTree.tsx`'s dispatcher: `worksheet`→`DatasetRow`, `origin-figure`→`FigureRow`, `workbook`→`WorkbookRow`, `folder`→`FolderRow`, everything else→`ArtifactRow`.
- [x] Document what each existing icon and badge means and which actions are duplicated elsewhere. **Tree-wide audit, 2026-09-12 (Claude):** `frontend/src/components/Library/rowIconAccessibility.test.tsx` renders each of the five row kinds (`DatasetRow` in both its full-card and compact-Tree layouts, `FigureRow`, `WorkbookRow`, `FolderRow`, `ArtifactRow`) and asserts every icon-only interactive control (`<button>`/`role="button"`) carries an `aria-label` or `title` — all already did except none found needing a fix on the interactive side. A second describe block in the same file targets informative count/icon BADGES (non-interactive) the same way and found one real inconsistency: `FolderRow`'s dataset-count chip had no `title` at all, unlike `WorkbookRow`'s identically-shaped worksheet-count chip — fixed by giving it one (`FolderRow.tsx`). No duplicated action was found among any row's icon-only controls (each names a distinct action — drag/menu/expand/duplicate/remove/move/tag-add/tag-remove/preview-toggle/open-in-new-window/etc.) — a read-through finding, not test-asserted, since "no duplicate" has no single automatable signal here.
- [x] Determine why the reported worksheets render as large cards while Graph2/Graph8/Graph9 render as compact rows. — a component choice, not CSS: `DatasetRow.tsx` rendered a 4-part stacked card with an always-mounted `Sparkline`; `FigureRow.tsx` was already a single-line `.qzk-fig-item`.
- [x] Check whether the current Tree/Tiles/Details preference already provides a compact alternative for these exact nodes. — `LibraryDetails.tsx` already renders every kind as a uniform compact `<tr>`; this was a Tree-view component gap, not a missing capability.
- [x] Reconcile this item against unfinished work in `LIBRARY_WORKBOOK_UX_PLAN.md`; do not create a second competing hierarchy model. — the fix changes only how a `worksheet` node renders inside Tree; `lib/libraryHierarchy.ts`'s `buildLibraryHierarchy`/`flattenLibraryHierarchy` is untouched and still the single structural truth.
- [ ] Test hierarchy comprehension with a project containing several books, sheets, and saved graphs with similar names. — needs a real user/owner session; not exercised here.

### Interaction checklist

- [x] Make the node type explicit: Folder, Workbook, Worksheet/Data, or Graph/Figure. — Folder (▦)/Workbook (▤) already had glyphs; added Worksheet (▥, `DatasetRow.tsx`) and Graph (⌁, `FigureRow.tsx`), same aria-hidden+title convention.
- [x] Use compact worksheet rows by default in Tree view. — `DatasetRow.tsx`'s `treeMode` branch is now a single `.qzk-ds-compact-row` line; the flat/search-list and Smart Folders card is unchanged (they never pass `treeMode`).
- [x] Allow an optional inline thumbnail expansion without changing selection or opening a plot. — `DatasetRowPreview.tsx`'s toggle mounts/unmounts the existing `Sparkline`; `stopPropagation` keeps it out of the row's select/open handlers. Test-verified (see Automated tests).
- [x] Keep richer thumbnails in Tiles view. — Tiles/`TilePreview.tsx`/`useThumbnail.ts` untouched.
- [x] Show the complete name through resizing and a short hover tooltip when truncation is unavoidable. — `DatasetRowParts.tsx`'s `DatasetRowName` keeps the pre-existing `.qzk-ds-name` (flex:1/min-width:0/ellipsis) + full-name title tooltip, shared by both row layouts.
- [x] Give icon-only actions one-sentence tooltips and accessible names. — within the rows touched: added `aria-label` to Duplicate/Move up/Move down (previously title-only); the preview toggle and every relocated `DatasetRowControls` icon carry both. Not a full tree-wide icon audit (see the open research item above).
- [x] Make the primary row click behavior consistent and discoverable. — click/dblclick/selection semantics (L0.25) are unchanged, just relocated behind the same handlers.
- [x] Put secondary actions in a consistent right-click/overflow menu; avoid a permanent strip of unexplained icons. — the compact row drops the always-visible ▲▼⧉✕ strip; Duplicate/Remove/Add tag/etc. stay reachable through the existing "⋯"/context menu (`datasetRowMenu.ts`), unchanged.
- [x] Clearly distinguish selection from the item currently open in a plot or worksheet. **2026-09-12 (Claude):** "open" reads as the dataset shown in the ACTIVE window (the obvious reading per this item's own steer) — the existing `activeId` store state `LibraryTree.tsx` already passes to `DatasetRow` as `active={node.entity.id === activeId}`, no new state added. The `.active` CSS class (distinct from multi-select's `.selected` — separate border/box-shadow vs. background recipes in `shell.css`, both design tokens only) already carried this visually; the gap was a semantic marker, so `DatasetRow.tsx`'s row now also carries `aria-current="true"` exactly when `active`, independent of `selected` in both directions (a row can be plotted AND part of a multi-selection at once). Tested at the DOM layer: `frontend/src/components/Library/DatasetRow.test.tsx`'s "DatasetRow — aria-current marks the OPEN item, independent of multi-select (UX-001)" describe block (5 cases: active-only, selected-only, both, neither, and the compact Tree layout) asserts the `aria-current` attribute and both classes independently. Sabotage-verified: removing the `aria-current` prop made exactly the 3 cases that expect it present FAIL (3 failed/50), the 2 negative-case tests stayed green; reverted.
- [x] Preserve keyboard navigation, multiselect, drag/drop, and context-menu behavior. — `LibraryTree.test.tsx` (705 lines) and `DatasetRow.test.tsx` (538 lines) pass unmodified against the new layout.
- [x] Ensure large projects remain performant when thumbnails are collapsed. — the always-mounted `Sparkline` (~120+ synchronous SVG builds per Tree render) is now opt-in per row.
- [x] Do not lose Origin book/sheet provenance or saved-graph relationships when simplifying the presentation. — sheet chip, Origin routing, `DerivedWorksheetMark`, drag/drop all preserved verbatim in `DatasetRowParts.tsx`'s `DatasetRowControls`.

### Suggested compact row contents

- Disclosure arrow where the node has children
- Type icon plus plain-language tooltip
- Fullest practical worksheet/graph name
- Concise secondary text such as `322 rows · 3 columns`
- Small state badges only when meaningful, for example `Origin` or `missing source`
- One visually clear overflow/actions button
- Optional thumbnail disclosure, not an always-expanded card

### Acceptance criteria

- [ ] A new user can identify folders, workbooks, worksheets, and saved graphs without trial-and-error clicking. — glyphs now exist for all four kinds; a real judgment call needs an actual new-user/owner session.
- [ ] At least six worksheet rows are comfortably visible in a typical-height Library without scrolling past large previews. — very likely true (a compact row is one ~20-24px line vs. the prior ~90-110px card) but not visually confirmed against a rendered viewport — no screenshot taken this pass. **2026-09-14 (Claude), partial evidence added, still left unticked:** `frontend/src/components/Library/LibraryTree.compactRows.test.tsx` renders the real `LibraryTree` with 8 worksheets and confirms, at the DOM+CSS-text layer, the two structural facts that ARE honestly establishable without a real browser: every worksheet row is a single line with no `.qzk-ds-spark`/`.qzk-ds-foot` child mounted by default (no preview, no full-card footer), and `shell.css` declares the compact modifier's padding as measurably smaller than the full card's (`3px 4px` vs `8px 9px`). That is NOT the same as proving six such rows fit in a 480px panel: `shell.css` declares no `height`/`line-height` for `.qzk-ds-compact`/`.qzk-ds-compact-row`/`.qzk-ds-name`, so the row's actual rendered height depends on the browser's font-metric default line-height, which neither CSS-text parsing nor jsdom's layout-free DOM can supply. Sabotage-verified (forcing the preview open by default via `DatasetRowPreview`'s `isPreviewExpanded` call, and inflating the compact padding to the full card's in a scratch edit of `shell.css`) made the corresponding assertions fail; both reverted byte-identical. Left unticked per this box's own honesty requirement.
- [x] A user can reveal a plot thumbnail when desired without opening or replacing the active plot. — test-verified: `selectedIds`/`activeId` unchanged after toggling the preview.
- [x] Names and action meanings are recoverable even when the Library is narrow. — the tooltip/ellipsis mechanism is preserved, not re-tested at a narrow panel width. **2026-09-14 (Claude):** `LibraryTree.compactRows.test.tsx`'s "narrow-panel name/action recoverability" describe block renders the real `LibraryTree` with a deliberately long worksheet name and asserts (1) the name element's `title` attribute contains the full, untruncated name — recoverable regardless of rendered width — and (2) `shell.css`'s `.qzk-ds-name` rule declares `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap` (parsed from the stylesheet text via `styles/cssRules.testkit.ts`, not assumed). Sabotage-verified: stripping the `title` attribute from `DatasetRowParts.tsx`'s name span, and separately dropping the three overflow declarations from `shell.css`'s `.qzk-ds-name` rule, each made its corresponding assertion fail; both reverted byte-identical.
- [x] Tree, Tiles, and Details views retain consistent selection and activation behavior. — Tiles/Details untouched; Tree's selection/activation logic is unchanged (only the worksheet row's markup changed), and `LibraryTree.test.tsx` passes unmodified.
- [ ] The reported Origin project remains navigable with no missing or duplicated nodes. — not tested against the owner's actual reported project (not available here).
- [ ] Owner verifies the revised workflow on the reported project. — pending; required before this item can be marked complete.

### Completion record

- PR/commit: committed locally in this worktree (not pushed, no PR opened per task instructions).
- Automated tests: `frontend/src/components/Library/DatasetRowCompact.test.tsx` (new, 7 cases — compact-row shape, glyph, meta text, opt-in preview mount/unmount, no-selection-change, localStorage persistence, flat-mode regression guard) and `frontend/src/lib/libraryPreviewPrefs.test.ts` (new, 3 cases) all pass and were individually sabotage-verified (broke the code path each covers, confirmed the test failed, restored). Full existing suite green (see Agent verification) — `DatasetRow.test.tsx` and `LibraryTree.test.tsx` pass with ZERO changes to their assertions.
- Agent verification: worksheet Tree rows are now a single compact line (glyph + name + `N pts · Mch` + opt-in preview toggle), matching `FigureRow`'s existing compact shape; the sparkline no longer mounts unconditionally; expanding/collapsing it never touches `selectedIds`/`activeId`; all pre-existing keyboard/drag/context-menu/roving-focus behavior is unchanged (same tests, same assertions, all passing). `tsc --noEmit`, `eslint src`, and the full `vitest run` suite are clean; `npm run build` + the bundle-size ratchet are clean (see gate numbers in the implementation session's own report).
- Owner verification: pending — required for this item (visual review of the reported Origin project, real-viewport row-count check, narrow-panel truncation check).
- Notes: scope was deliberately narrow — only `DatasetRow.tsx`'s `treeMode` (Tree) branch changed; the flat/search-list and Smart Folders card, Tiles, Details, and `LIBRARY_WORKBOOK_UX_PLAN.md`'s hierarchy model are all untouched. A full tree-wide icon/badge audit and the "distinguish selection from the item open in a plot" item remained open at the time this note was written — both closed 2026-09-12 (Claude), see the dated entry below. The eager-bundle ratchet (`frontend/scripts/check-bundle-size.mjs`) needed a raise — 910,748 → 912,503 bytes (+1,755, budget raised to measured + 1,024 = 913,527) — after a measured `React.lazy()` split of the preview toggle came back WORSE (fragmented Sparkline's own shared chunks) and was reverted, and deduplicating the two row layouts' shared JSX/logic recovered 415 of the original 1,146-byte overage; the dated history entry in that file has the full measurement trail.

- **2026-09-12 (Claude), the two remaining UX-001 residuals closed:**
  - **(a) Tree-wide icon/badge audit**: new test file
    `frontend/src/components/Library/rowIconAccessibility.test.tsx` renders
    all five Library row kinds and asserts every icon-only `<button>`/
    `role="button"` carries an `aria-label` or `title`; all already did.
    A second describe block applies the same requirement to non-interactive
    count/icon badges and found one real gap: `FolderRow.tsx`'s dataset-count
    chip had neither, unlike `WorkbookRow.tsx`'s sibling worksheet-count chip
    — fixed with a `title` (`FolderRow.tsx`), mirroring the existing
    convention. Sabotage-verified: reverting the `FolderRow.tsx` fix made
    exactly the one targeted test FAIL (1 failed/8); every other row kind's
    test passed both before and after (no fix was needed there), confirming
    the audit is real, not vacuous.
  - **(b) Selected vs. open**: "open" = the dataset shown in the ACTIVE
    window — the existing `activeId` state `LibraryTree.tsx` already threads
    into `DatasetRow`'s `active` prop (no new state). `DatasetRow.tsx` now
    also sets `aria-current="true"` on the row when `active`, independent of
    `selected`; the pre-existing `.active`/`.selected` CSS classes (both
    design-token-only) already distinguished the two visually. Tested at the
    DOM layer in `DatasetRow.test.tsx` (5 cases covering all four
    active×selected combinations plus the compact Tree layout);
    sabotage-verified (removing the prop failed exactly the 3 cases that
    require it, 3 failed/50; reverted).
  - Gates (frontend-only; `src/quantized/` untouched): `npx tsc -b --force`
    clean; `npx eslint` on every touched file clean; targeted `npx vitest
    run` (all five row-kind test files + `rowIconAccessibility.test.tsx` +
    `usePlotPayload.errorRoles.test.ts`/`.test.ts` + `useApp.test.ts` +
    `windows.test.ts`/`windowDocuments.test.ts`/`reimport.test.ts` +
    `architecture.test.ts`) — 671 passed, 0 failed. `DatasetRow.tsx` landed
    exactly AT the 400-line `.tsx` ceiling (400 after trimming the added
    comment) — no extraction needed, no pin raised. See the combined FULL
    suite + build numbers at the end of this entry (one gate run covered
    both this pass and BUG-001's plot-window-rebinding pass above).
  - Not done / explicitly out of scope, per this item's own steer: the "pick
    the obvious reading" note above IS the product decision for (b) — no
    further decision needed; owner visual verification of the reported
    Origin project remains pending (unchanged from the prior pass).

---

## BUG-002 — a hard-linked alias defeats the declared-source write guard

**Priority:** P2 — substantial, but the worst outcome is a refused-save that
isn't refused, not lost data. See "Why this is P2 and not P0" below; that
bounding is itself test-locked, so re-check it before re-rating.

**Found:** 2026-09-09, by the P1.1 path-shape coverage pass (not by a user).

### User-visible problem

The desktop bridge refuses to let a project save overwrite one of the project's
own raw source files — the guard that stops a "Save" from silently destroying
the data the project was built from. That check compares path STRINGS, so it
does not recognise a second name for the same file. Saving through a hard-linked
alias of a declared source is permitted when it should be refused.

### Confirmed implementation evidence

- `src/quantized/desktop_consent.py:320` (`is_declared_source`) and
  `src/quantized/desktop_project_file.py:139-190`
  (`payload_declares_source`) both key the decision on a path string after
  `realpath`/`normcase`/`normpath` — never on filesystem identity
  (`st_dev`/`st_ino`).
- `realpath` resolves SYMLINKS, so a symlinked alias is already handled. A
  HARD LINK has no link to resolve: two directory entries name one inode and
  both are "real" paths, so string comparison cannot see them as one file.
- Reproduced on Linux, and pinned as a **strict** xfail so it converts to a
  failure the moment the behaviour changes:
  `tests/test_desktop_bridge_path_shapes.py::test_a_hardlinked_alias_of_the_declared_source_is_wrongly_permitted_as_a_write_target`.

### Why this is P2 and not P0

`portable/publish.py`'s `atomic_replace_file` writes to a temp file and then
`os.replace`s it into position. That REPLACES the directory entry rather than
mutating the shared inode, so the alias is severed and the original raw file
survives byte-for-byte even when the guard is bypassed. That mitigation is not
incidental to this rating — it is locked in by
`test_hardlink_bypass_does_not_actually_corrupt_the_shared_inodes_bytes`. If
any write path is ever changed to write in place, this becomes a data-loss bug
and must be re-rated P0.

### Suspected sibling case (NOT reproduced)

The same string-keyed design should also miss an NFC/NFD respelling of one
filename on a normalization-insensitive filesystem (macOS HFS+/APFS), where two
different byte sequences name one file. This could not be reproduced in the
Linux-only gate, so it is recorded as a plausible consequence of the same root
cause, **not** as an established fact. It needs a macOS check before anyone
acts on it.

### Why it was not fixed on discovery

The obvious fix — stat every declared source on every quick-save and compare
`(st_dev, st_ino)` against the destination — is exactly the per-source I/O that
`payload_declares_source`'s own docstring says was deliberately avoided: an
unreachable network source would pay a full SMB timeout on every save. Choosing
between a correct guard and a save that cannot hang is an owner design call,
not a drive-by patch.

### Fix checklist

- [ ] Decide the tradeoff explicitly: identity-based comparison, a bounded/
  cached stat, or an accepted documented limitation.
- [ ] If identity-based: ensure an unreachable source cannot make a save hang
  (a timeout or a skip-on-error path), and test that case.
- [ ] Flip the strict `xfail` to a passing test in the same commit as the fix.
- [ ] Check the macOS NFC/NFD sibling case on real macOS, then either fix or
  explicitly rule it out here.
- [ ] Re-read the P2 rating above once the write path is settled.

### Completion record

_(empty — open)_

---

## UX-002 — copy/paste drops cross-workbook lineage without saying so

**Priority:** P3 — nothing is corrupted and no scientific value is wrong; the
user simply is not told that a link was not carried over.

**Found:** 2026-09-09, in the review round of the derived-data provenance
verification pass (not by a user).

### User-visible problem

Copying or duplicating a workbook drops any lineage link that points OUTSIDE
that workbook, and says nothing. The pasted worksheet looks complete; its
"this is version 2 of ..." relationship is simply gone.

### Why the drop itself is correct

`pasteTransferPackage` rewrites every internal reference to the fresh ids it
mints, and drops any reference whose target is not in the package. The
alternative is a dangling id pointing into a project the destination may not
even have open — exactly what the fresh-id rewrite exists to prevent. **The
drop is not the bug. The silence is.**

### Why it hits `versionOf` essentially every time

"Import as new version" (`store/relink.ts:303`) tags the newly imported dataset
with the OLD dataset's id, and that import created a brand-new workbook
(`store/importDatasets.ts:271` — a single-file import is always its own
workbook). So a version link crosses a workbook boundary **by construction**,
and is therefore dropped by any single-workbook copy. `derivedFrom` is hit in
the narrower case where a derived sheet's source was moved out (Separate
Worksheets sweeps only downstream dependents).

### Confirmed implementation evidence

- `lib/workbookTransfer.ts:375` — `next.versionOf = rewriteRef(d.versionOf)`;
  `rewriteRef` returns `undefined` for an out-of-package target and increments
  `droppedExternalRefs` (`:353-357`). The module header (`:70-76`) documents
  this rule for `bgRef`/`derivedFrom`/`versionOf` explicitly.
- `droppedExternalRefs` is returned from `pasteTransferPackage` (`:405`) and
  read by **nothing** outside tests — verified by grep across `frontend/src`.
- Behaviour pinned by `lib/workbookTransfer.test.ts`'s "drops cross-workbook
  lineage rather than dangling it — versionOf and an external derivedFrom",
  which is sabotage-verified (dangling the ref instead of dropping it fails it).

### Fix checklist

- [x] Surface `droppedExternalRefs` after a paste — a toast or a status line
  saying how many lineage links could not be carried, not a silent success.
  **Shipped 2026-09-09 (Group J).** `store/workbookTransfer.ts`'s `refNote()`
  appends "— N reference(s) to data outside the copy not carried" to BOTH the
  persistent status line and the toast, for Paste AND Duplicate; the toast drops
  from `"ok"` to `"info"` when anything was dropped, because a green check reads
  as "clean". **"reference", not "lineage link", after the review round:**
  `rewriteRef` counts `bgRef` alongside `derivedFrom`/`versionOf`, and a dropped
  BACKGROUND reference is not provenance — it is a subtraction input, so losing
  it changes the plotted data, not just the history. It is therefore counted
  separately (`droppedBackgroundRefs`) and named in the message. Six tests in
  `store/workbookTransfer.test.ts`, all sabotage-verified, including a negative
  control ("does NOT annotate a transfer that carried everything") that fails
  when the note is forced ON.

  The same round found four of Paste's refusals toasted WITHOUT setting the
  status line, so a refused paste left the previous action's success message
  standing on the status bar. All nine refusal sites in the slice now go through
  one `fail()` helper; pinned by "a refused paste replaces the status line
  instead of leaving the last success standing".
- [ ] Decide whether a dropped link is worth preserving as inert historical
  text (e.g. the source dataset's NAME) rather than a resolvable id. This is a
  semantics call about what lineage means across a transfer boundary — do not
  invent it silently.
- [ ] If a "copy with dependents" scope is ever added, revisit: the link would
  then be internal and would not need dropping at all.

### Completion record

- PR/commit: the Group J commit (2026-09-09) — surfacing half only.
- Automated tests: `store/workbookTransfer.test.ts` — "names the dropped link
  count after a paste, and uses info rather than a clean ok", "names the
  dropped link count after a duplicate too", "pluralizes honestly — two dropped
  refs say 'references'", "names a dropped BACKGROUND reference separately — it
  is not provenance", "a refused paste replaces the status line instead of
  leaving the last success standing", "does NOT annotate a transfer that carried
  everything — ok stays ok".
- Agent verification: fix + four sabotage-verified tests.
- Owner verification: —
- Notes: **still open**, because box 2 is an owner semantics call, not work
  that was skipped: whether a dropped link should be preserved as inert
  historical text (the source dataset's NAME) rather than a resolvable id is a
  decision about what lineage MEANS across a transfer boundary. Only the count
  is surfaced; nothing about the drop rule itself changed.

---

## BUG-003 — a Data Filter predicate outlives a column's type change, invisibly

**Priority:** P2 — no data is lost and no scientific result is silently
wrong for the common case (the underlying `dataset.filter` entry is left
completely untouched, so nothing is destroyed and the row-filtering answer
is deterministic), but a user CAN end up staring at a Data Filter panel
that looks unconstrained while rows are still narrowed by a predicate they
can no longer see or edit through that panel. That is exactly the kind of
"can escape notice" mismatch the P0/P1 bar is written around, capped at P2
here only because the escape hatch (Clear) stays reachable — see
"Conservative behaviour implemented" below.

**Reported:** 2026-09-09, by Claude (PRIMARY_SOFTWARE_AUDIT_PLAN's Data
Filter categorical-wiring slice), while verifying the workbench's
`is_categorical`/`isCategoricalChannel` path per the task's own prompt:
"what a filter should do for a column whose type changes while a filter is
active" — the prompt's own example of a question prior art does not
settle.

**Investigated:** — (design-time finding: traced through the code and
pinned by a sabotage-verified test, not surfaced by a user report yet.)

**Suggested implementation owner/model:** — (needs an owner product
decision; see "What is NOT decided" below.)

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`'s "Data Filter /
Tabulate / Stat Stage workbench wiring" box (P1.4/P1.5-adjacent).

#### User-visible problem

`frontend/src/components/workshops/datafilter/useDataFilter.ts` classifies
each column as `"range"` (continuous) or `"set"` (categorical/level-
membership) via `lib/modeling.ts`'s `channelModelingType` — which honors a
user's `setChannelType` override FIRST, before the `isCategoricalChannel`/
numeric-shape inference. That override can change independently of any
existing filter predicate on the same column (`setChannelType` never
touches `dataset.filter`). If a user:

1. Filters a categorical column down to a level subset (a `kind: "set"`
   predicate), then
2. Overrides that same column's type to "continuous" (or the reverse:
   filters a continuous column by range, then overrides it to "nominal", or
   a reimport changes whether the column carries `cat_levels` at all) —

the STORED predicate keeps its original `kind` forever (nothing rewrites
it), but the panel now renders the OTHER control for that column. A range
field cannot show `.values`; a checkbox list cannot show `.min`/`.max`. The
`Dataset.filter` entry (`lib/datafilter.ts`'s `rowPasses`/`filteredOutRows`,
which every downstream consumer — Tabulate, Distribution, `analysisData` —
reads) evaluates a predicate purely by ITS OWN stored `kind`, with zero
awareness of the column's now-different live classification, so the
predicate keeps narrowing rows exactly as before — just no longer
representable in the UI that wrote it.

#### Conservative behaviour implemented (this slice, Data Filter only)

`useDataFilter.ts`'s `columns` memo now only reports a stored predicate as
a column's `current` (the value the checkbox/range controls read from) when
its `.kind` matches the column's freshly-computed classification; a
mismatched leftover is treated as absent for DISPLAY. It is deliberately
NOT deleted from `dataset.filter` — reverting the override brings the exact
same predicate back as `current`, so no work is lost — and `useDataFilter`'s
`active` flag (which drives the panel's "Clear" button) still reads the RAW
filter array regardless of the mask, so a user who notices "showing fewer
rows than the checkboxes suggest" always has a one-click way to remove
everything. Editing the affected column (any `setRange`/`toggleLevel` call)
replaces whatever was stored for that column outright, so normal use
self-heals on the next interaction. Sabotage-verified:
`useDataFilter.test.ts`'s "a stale kind-mismatched predicate is masked, not
deleted" test (see the PR that introduced this entry for the sabotage
transcript — reverting the `stored?.kind === expectedKind ? stored :
undefined` masking makes it fail as expected).

#### What is NOT decided (needs an owner call)

- Should `lib/datafilter.ts`'s row-filtering (`rowPasses`/`filteredOutRows`
  — shared by Tabulate/Distribution/every `analysisData` consumer, all out
  of scope for this slice) keep applying a kind-mismatched predicate at
  all, or should it stop counting a predicate that no longer matches its
  column's live classification as active anywhere in the app, not just in
  this one panel's display?
- If it should stop being applied everywhere: should the stale entry then
  be auto-dropped from `dataset.filter` (simplest, but a silent auto-
  mutation of saved state with no user action) or just made globally inert
  while still stored (matches this slice's local masking, but means
  `lib/datafilter.ts` itself needs to know about column classification —
  a `DataStruct`/`Dataset`-level concern it currently has zero dependency
  on)?
- Should the panel instead surface the mismatch explicitly (a small
  "N hidden filter(s) don't match this column's current type" notice) so
  the inconsistency is visible rather than merely non-corrupting?

#### Reproduction

- [x] Starting state and sample data identified — a 2-level categorical
  column (`cat_levels`-backed or `channelTypes` override to "nominal") with
  an active `kind: "set"` filter predicate.
- [x] Exact actions recorded — call `setChannelType(id, col, "continuous")`
  (or, for the reverse case, override a continuous column to "nominal")
  while a filter predicate already exists on that column.
- [x] Actual result recorded — the panel now renders the OTHER control
  type for that column with no visible constraint; the stored predicate is
  untouched and (before this slice's fix) was surfaced as `current` on the
  wrong-shaped control.
- [x] Expected result recorded — see "Conservative behaviour implemented"
  above for what ships now; see "What is NOT decided" for the open
  question about `lib/datafilter.ts`'s row-filtering side.
- [x] Reproduced by an agent (`useDataFilter.test.ts`, sabotage-verified).

#### Investigation

- [x] Likely owning components/modules identified —
  `frontend/src/components/workshops/datafilter/useDataFilter.ts` (display
  masking, fixed this slice); `frontend/src/lib/datafilter.ts`
  (`rowPasses`/`filteredOutRows`, the row-filtering side, unresolved).
- [x] Root cause confirmed rather than inferred — read both modules; the
  kind-blind evaluation in `lib/datafilter.ts` and the lack of any
  filter-clearing side effect in `store/useApp.ts`'s `setChannelType` were
  both confirmed by direct inspection, not assumed.
- [x] Related workflows and persistence paths checked — `setChannelType`
  (`store/useApp.ts`), the filter round trip (`lib/workspaceSerialize.ts`/
  `lib/workspaceDatasetParse.ts`).
- [x] Existing plan overlap reconciled — filed against the
  PRIMARY_SOFTWARE_AUDIT_PLAN box this slice closed for Data Filter.

#### Implementation

- [x] Minimal safe behavior defined — see "Conservative behaviour
  implemented" above.
- [ ] Failure and ambiguous-data behavior defined for the UNRESOLVED
  `lib/datafilter.ts` row-filtering side — owner call needed.
- [x] Data integrity and backward compatibility considered — no auto-
  deletion; a saved project with a now-mismatched predicate still opens and
  round-trips it unchanged.
- [ ] UI wording/tooltips/accessibility for a "hidden filter" notice — not
  built; see "What is NOT decided."

#### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward —
  `useDataFilter.test.ts`, sabotage-verified.
- [x] Relevant focused tests pass — full `datafilter` workshop suite green.
- [x] Type-check/build/repository gates pass — see the PR that introduced
  this entry.
- [ ] Agent verifies acceptance criteria for the unresolved half — blocked
  on the owner call above.
- [ ] Owner verifies when required.

#### Completion record

- PR/commit: — (Data Filter's display-masking half shipped in the commit
  that added this entry; the `lib/datafilter.ts` row-filtering half is
  still open.)
- Automated tests: `useDataFilter.test.ts` — "a stale kind-mismatched
  predicate is masked, not deleted (BUG-003)".
- Agent verification: display-masking half only.
- Owner verification: —
- Notes: Tabulate and Stat Stage were out of scope for the slice that filed
  this — worth checking whether either has the same
  `channelModelingType`-vs-stored-state staleness risk in its own state
  (e.g. Tabulate's group-column selection) when they get their own wiring
  slice.

---

## BUG-004 — a Stat Stage GROUP pick outlives its column's type change

**Scope corrected in review (2026-09-09), same day as filing.** This covers
`groupCol` ONLY. The first fix also masked `facetCol`, and that was a
regression: `useGraphBuilder` gates its seeded `groupCol` on
`isCategorical(...)` but passes `facetCol` through ungated, and `facetSlices`
has no categorical gate — so faceting on a non-categorical column is a
SUPPORTED configuration Graph Builder deliberately produces and announces
("faceted by <label>"). Masking it rendered one unfaceted panel while the
status line still claimed a facet. The rule that separates them: a pick is
"stale" only if NO live entry point could have produced it. Every way to set
`groupCol` is categorical-gated; `facetCol` has an ungated one.

**Priority:** P3 — narrower and lower-friction than BUG-003: the only
consumer of the stale value is this same hook (no shared row-filtering
fanout, no scientific-result risk — the fix below closes the gap
completely, on-screen, the same render cycle the override lands), and the
override itself (a manual "treat this column as continuous/nominal" action
on the Channels card) is an infrequent, deliberate user action.

**State:** Verified complete (fix + sabotage-verified regression tests);
owner sign-off still open.

**Reported:** 2026-09-09, by Claude (PRIMARY_SOFTWARE_AUDIT_PLAN's Tabulate/
Stat Stage categorical-wiring slice), while checking Stat Stage for the
same class of bug BUG-003 named for Data Filter, per that slice's own
prompt: "watch specifically for the analogue of the bug the Data Filter
slice found."

**Investigated:** 2026-09-09 by Claude (design-time finding, traced through
the code and pinned by sabotage-verified tests before any user report).

**Suggested implementation owner/model:** — (fix shipped this slice; an
owner may want to review the "mask the computation too, not just the
picker" call below against BUG-003's precedent.)

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`'s "Data Filter /
Tabulate / Stat Stage workbench wiring" box; BUG-003 (same root cause,
different workbench).

#### User-visible problem

`frontend/src/components/Stage/useStatStage.ts` restricts its "group by"
and "facet by" `<Select>` option lists to `categoricalCols`
(`lib/statstage.categoricalChannels`, itself `channelModelingType`-gated —
override wins first). The PICKED `groupCol`/`facetCol` is separate local
`useState`, set once on mount/dataset-switch and otherwise left alone. If a
user:

1. Picks a categorical column as "group by" (or "facet by"), then
2. Overrides that same column's type to "continuous" via the Channels card
   (`setChannelType`, which never touches `groupCol`/`facetCol`) —

`categoricalCols` correctly drops the column (it's recomputed fresh every
render off the dataset's own — now-changed-by-reference — `channelTypes`),
but the raw `groupCol`/`facetCol` state still held that column's index. The
`<Select>`'s `value` then names an option no longer in its own `options`
list — a mismatched control, the same "stale selection invisible in the
panel that wrote it" symptom BUG-003 named for Data Filter — while, before
this fix, the actual box/violin/bar grouping and facet-slicing math kept
partitioning by that same now-uncategorized column regardless, so the
rendered chart and the toolbar could visibly disagree about what was
driving the split.

#### Fix implemented (this slice, full — not display-only)

`useStatStage.ts` derives `effectiveGroupCol`/`effectiveFacetCol` (masked
to `null` whenever the raw pick is no longer in the freshly-computed
`categoricalCols`) and threads them through EVERY downstream read —
`resolveGroups`/`resolveGroupsIndexed`, `computeBarData`,
`computeFacetBarDraws`/`computeFacetGroupDraws`, `facetSlices`, the
`groupLabel` string, the `showConnectMeans` gate, and the exported picker
values themselves — not only the `<Select>` display. Raw `groupCol`/
`facetCol` state is never cleared, so reverting the override brings the
exact same pick back automatically (the same self-healing property BUG-003
established for Data Filter's masking).

This goes further than BUG-003's "display-level only" masking, and that
divergence is deliberate, not an oversight: Data Filter's row-filtering
(`lib/datafilter.ts`) is shared app-wide (Tabulate, Distribution, every
`analysisData` consumer), so changing ITS behavior needed an owner call
and was left open. Stat Stage's `groupCol`/`facetCol` have exactly ONE
consumer — this same hook — so there is no wider blast radius to defer,
and leaving the computation unmasked while only fixing the display would
have created a WORSE, more visible contradiction than BUG-003's original
bug: the toolbar would read "(per channel)" while the rendered chart kept
showing per-category boxes labeled with the stale column's levels, on the
very same screen, at the very same time. An owner may still want to weigh
this as a data point for BUG-003's own still-open question (whether Data
Filter's row-filtering should likewise stop applying a stale predicate
everywhere, not just mask its display) — that call is not made here.

#### Reproduction

- [x] Starting state and sample data identified — a dataset with a ≥2-level
  categorical "group by" (or "facet by") column, actively picked.
- [x] Exact actions recorded — `setChannelType(id, col, "continuous")` on
  the picked group/facet column (same dataset, same id — the active-id
  reset effect does not fire).
- [x] Actual result recorded (pre-fix) — `groupCol`/`facetCol` stayed at
  the stale index; `categoricalCols` no longer listed it; the `<Select>`
  had a `value` with no matching `<option>`; `resolveGroups`/facet slicing
  kept using the stale column.
- [x] Expected result recorded — see "Fix implemented" above.
- [x] Reproduced by an agent — `useStatStage.test.ts`, sabotage-verified
  (reverting the `effectiveGroupCol`/`effectiveFacetCol` masking to the raw
  state makes all three new tests fail).

#### Investigation

- [x] Likely owning components/modules identified —
  `frontend/src/components/Stage/useStatStage.ts` (fixed this slice).
- [x] Root cause confirmed rather than inferred — read the hook in full;
  confirmed `categoricalCols` recomputes fresh (dataset gets a new object
  reference on every `setChannelType`) while `groupCol`/`facetCol` do not,
  by direct inspection, then reproduced it with a failing test before
  fixing.
- [x] Related workflows and persistence paths checked — neither
  `groupCol`/`facetCol`/`mode`/`valueCol` persist through `.dwk` at all
  (only the `statMode` boolean toggling the Stage view does — `PlotView` in
  `lib/plotview.ts`), so there is no save/reopen angle to this bug
  specifically; see the PRIMARY_SOFTWARE_AUDIT_PLAN slice notes for the
  broader persistence finding.
- [x] Existing plan overlap reconciled — filed against the same
  PRIMARY_SOFTWARE_AUDIT_PLAN box BUG-003 was filed against.

#### Implementation

- [x] Minimal safe behavior defined — mask to `null` (the documented
  "per plotted channel"/"no facet" fallback), applied to both display and
  computation; raw state untouched for self-healing.
- [x] Failure and ambiguous-data behavior defined — masking degrades to an
  already-existing, already-tested code path (the `groupCol === null`/
  `facetCol === null` fallback), not a new failure mode.
- [x] Data integrity and backward compatibility considered — no stored
  state changes shape; nothing persists across save/reopen for this
  picker anyway (see above).
- [x] UI wording/tooltips/accessibility — none needed; the `<Select>`
  simply falls back to its existing "(per channel)"/"(none)" option, no new
  copy.

#### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward —
  `useStatStage.test.ts`'s "stale channelTypes override on groupCol/
  facetCol (BUG-004)" describe block, sabotage-verified by reverting the
  masking and confirming the groupCol tests fail while the rest of the suite
  stays green. **Review round:** the block's facetCol test originally asserted
  facet was masked too and has been INVERTED — it now pins that a
  non-categorical facetCol SURVIVES, with a companion test that a Graph
  Builder seed faceting on a non-categorical column still facets. A test that
  pins a regression is worse than no test, and that is what it was.
- [x] Relevant focused tests pass — full `useStatStage.test.ts` (29 tests)
  and `lib/statstage.test.ts` green; one PRE-EXISTING test in the same file
  ("all facet levels dropping → drawFacets null with the empty-groups
  error") had to be updated — it forced its "no data" edge case via an
  all-NaN GROUP column, which (correctly, now that classification gates
  the computation too) started falling back to the per-plotted-channel
  grouping instead of erroring, since that column was never reachable
  through the real picker to begin with once it stopped classifying as
  categorical. Reworked to force the same zero-groups outcome via an
  all-NaN VALUE column instead, which exercises the same downstream path
  without depending on a groupCol the UI could never actually offer.
- [x] Type-check/build/repository gates pass — see the PR/commit that
  introduces this entry.
- [x] Agent verifies acceptance criteria — **verified 2026-09-13:** read
  `maskStaleCategoricalPicks` (`frontend/src/lib/statstage.ts`) in full —
  `groupCol`/`group2Col` mask to `null` when absent from the freshly
  computed `categoricalCols` index, `facetCol` passes through unmasked,
  matching this entry's "Fix implemented" description exactly. Ran
  `npx vitest run src/components/Stage/useStatStage.test.ts
  src/lib/statstage.test.ts` — 89 passed, including the cited "de-
  categorizing the picked groupCol masks the picker AND stops the grouping
  math from using it" and "a non-categorical facetCol SURVIVES" cases.
  A manual click-through was not performed this slice.
- [ ] Owner verifies when required.

#### Completion record

- PR/commit: — (lands in the commit that adds this entry.)
- Automated tests: `useStatStage.test.ts` — "de-categorizing the picked
  groupCol masks the picker AND stops the grouping math from using it",
  "reverting the override brings the exact same groupCol pick back (raw
  state was never cleared)". The facet side is covered by the two tests that
  assert the OPPOSITE, and deliberately so: "a non-categorical facetCol
  SURVIVES — faceting is not restricted to categorical columns" and "a Graph
  Builder seed faceting on a NON-categorical column still facets" (see the
  scope note above — masking `facetCol` was a regression caught in this
  entry's own review round, not part of the fix).
- Agent verification: fix + sabotage-verified tests, this slice.
- Owner verification: —
- Notes: Tabulate was checked in the same slice and found NOT to have this
  bug — its "Group by" ZoneWell never filters its option list by
  classification (any column stays selectable regardless of type), and its
  one classification-dependent read (`groupIsCategorical`, an informational
  warning) is recomputed fresh every render rather than cached against
  stale state, so it self-heals automatically. See
  `useTabulate.test.ts`'s "a channelTypes override wins for
  groupIsCategorical, without hiding the stale selection or breaking the
  table" test (sabotage-verified against `lib/modeling.ts`'s override
  precedence).

---

## BUG-005 — Corrections and Resample transform a categorical channel like numeric data

**Priority:** P2 — nothing is destroyed (the source dataset is untouched; the
result is a NEW DataStruct) and the degradation is not silent in the worst
sense: the level table is correctly discarded rather than left attached to
values that no longer index it, so the output shows honest raw numbers instead
of confidently wrong labels. It is P2 rather than P3 because the numbers it
does show are meaningless — a smoothed "phase code" of 0.37 is not a
measurement of anything — and nothing warns the user that a column was
transformed that should not have been.

**Reported:** 2026-09-09, by Claude, in the Group J `cat_levels` propagation
audit (a delegated read-only sweep of every DataStruct-deriving site).

**Investigated:** — (design-time finding, confirmed by reading both modules;
not surfaced by a user report.)

**Suggested implementation owner/model:** a backend slice with golden-parity
care — the change touches `calc/corrections.py`'s whole pipeline.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P1.4's "Preserve
factors through derived data, filter/join, reopen, recipes, and export" box.

#### User-visible problem

`calc/corrections.py`'s `apply_corrections` and `calc/resample.py`'s
`resample_data` both transform **every channel unconditionally** — the
corrections pipeline with `for k in range(values.shape[1])` loops plus
whole-matrix `smooth_data`/`normalize`/`derivative` calls, and resample by
interpolating each column onto a new grid. Neither has any notion of a channel
being categorical.

A categorical channel's values are level CODES (0..n-1) that index
`cat_levels`. Smoothing, differentiating, normalizing or interpolating them
produces fractional numbers that index nothing. So a dataset carrying, say,
`[Moment (numeric), Phase (categorical)]` comes out of Corrections with a
`Phase` column of arbitrary decimals.

#### Why the drop WAS conservative (superseded — see the CLOSED entry below) — not simply correct

Both functions used to discard `cat_levels` unconditionally; they now discard it unless the codes provably survived (see the CLOSED entry below). Both functions discard `cat_levels`. That is now **explicit and documented in
both modules** (it used to be an accidental omission that read like a bug in
the propagation audit). For a transform that actually changes values, keeping
the table would be strictly worse: the output would claim level labels for
values that cannot have them. The drop is damage control there, not a solution
— the column is still garbage, just honestly-typed garbage.

**But the drop is over-broad, which is the second half of this bug.** Both
functions drop the table whenever they run, including paths where nothing
happened to the codes:

- `apply_corrections` with a parameter set that touches only x (or is empty)
  returns the codes bit-identical, and drops the table anyway.
- `resample_data` onto a grid COINCIDENT with the input x is an identity
  interpolation — the codes come back exact, and the table is dropped anyway.

So a user who resamples "onto the same grid to normalize a batch", or applies an
x-offset-only correction, silently loses labelling that was never invalidated.
The two tests below assert the codes are invalidated only for the parameters
they use; they do NOT establish that the strip is always warranted, and this
entry no longer claims they do.

#### What the real fix requires

Corrections must not transform a categorical channel at all: carry such a
channel through untouched, and carry its level table with it. That needs a
channel mask threaded through every step of the pipeline (offset, background,
reference subtraction, unit conversion, smoothing, normalization, derivative)
plus the whole-matrix helpers, and it carries real golden-parity regression
risk against the frozen MATLAB outputs. It was deliberately NOT attempted
inside the audit slice that found it.

Open sub-questions for whoever takes it:

- Should Resample *refuse* a categorical channel rather than pass it through?
  Nearest-neighbour resampling of a code column is defensible and would
  preserve valid codes, but it is a different interpolation than the one the
  user picked for the numeric channels — silently mixing methods within one
  operation needs a deliberate ruling.
- Should the UI warn before running a correction on a mixed dataset, or should
  the pass-through be silent because it is now correct?

#### Reproduction

- [x] Starting state identified — any `DataStruct` with `cat_levels` on at
  least one channel and at least one numeric channel.
- [x] Exact actions recorded — `apply_corrections(data, {"smoothEnabled":
  True, ...})`, or `resample_data(data, n_points=N)`.
- [x] Actual result recorded — the categorical channel's codes come back
  fractional; `cat_levels` is `None` on the result.
- [x] Reproduced by an agent — the two strip tests below assert exactly this,
  including that the codes really are no longer valid.
- [ ] Reproduced through the UI on real owner data.

#### Investigation

- [x] Likely owning modules identified — `src/quantized/calc/corrections.py`
  (`apply_corrections`), `src/quantized/calc/resample.py` (`resample_data`).
- [x] Root cause confirmed rather than inferred — both were read directly; the
  unconditional per-channel loops and whole-matrix calls are visible in the
  source, and `routes/corrections.py` pipes the result straight to
  `datastruct_payload` with no client-side re-stitching (`store/corrections.ts`
  uses the response as-is), so nothing downstream repairs it.
- [x] Related paths checked — `calc/aggregate.py`'s dataset algebra is n/a (its
  output is a single new arithmetic column unrelated to either source's channel
  indices).

#### Implementation

- [x] Minimal safe behavior defined and shipped — the strip is explicit and
  documented in both modules, with the reasoning inline so a future author
  cannot "fix" it by re-adding `cat_levels=` without reading why.
- [ ] Channel-mask pass-through for categorical channels — the actual fix.
- [x] **DONE 2026-09-10 — stop dropping the table on paths that do not change
  the codes.** `quantized/cat_levels.py`'s `surviving_cat_levels` is the
  predicate, and it is EVIDENCE not inference: it compares each channel's column
  before and after, elementwise, rather than keeping a per-transform allowlist —
  so a transform added later is conservative by default and no existing golden
  output can change (the function can only PRESERVE a table where the numbers are
  bit-identical). PER CHANNEL, because `cat_levels` is: correcting one channel
  must not cost a different, untouched one its labels. It takes `kept_rows` so a
  TRIM compares surviving rows instead of reading the shape difference as a
  change. NaN compares equal — a NaN code is already unresolvable by `level_of`,
  so a NaN that stays a NaN changes nothing the table can describe.
  Three real preservation cases now covered, each measured, not assumed: an
  IDENTITY correction (`{}`), a pure row TRIM, and an X-ONLY shift (`xOff` moves
  the grid, never a value); plus a resample onto a COINCIDENT grid. The drop
  still happens whenever the numbers move — pinned by the smoothing and
  interpolation tests that predate this, which still pass unchanged.
  The per-channel property is demonstrated in the real pipeline by the
  beam-footprint scale, which deliberately SKIPS `dq`-labelled channels: ch0 moves
  (1.0 -> 114.59...), the `dq` channel does not, and only its table survives.
  Seven sabotages verified, including both "always keep" and "always drop".
  New home rather than a new function in `datastruct.py`, for COHESION:
  `row_sidecars.py` owns "which metadata keys are row-indexed", this one owns
  "when does a value transform invalidate a level table". (A line-count reason was
  also cited and was WRONG — 506 was measured against a draft that was then
  rewritten; the shipped single function would have left `datastruct.py` at 496,
  under the ceiling. With `surviving_level_order` it would now be 514, but the
  argument was always cohesion.)
- [ ] Resample's nearest-neighbour-vs-refuse ruling.
- [ ] Any user-facing warning.

#### Tests and acceptance

- [x] The deliberate strip is pinned, with the reasoning in the docstring —
  `test_corrections_strips_cat_levels_because_codes_are_transformed`,
  `test_resample_strips_cat_levels_because_interpolation_breaks_codes`. Each
  also asserts the codes are genuinely no longer valid FOR THE PARAMETERS IT
  USES (a moving-average smooth; a 7-point resample of a 4-point input) — that
  is the honest scope: they prove the strip fires and that these particular
  transforms invalidate the codes. They do NOT prove the strip is always
  warranted, and the identity-parameter cases above are exactly where it is not.
- [ ] A test for an identity-parameter path (codes survive, table still dropped)
  — deliberately NOT added as a passing test, since it would lock in the
  over-broad behavior. It belongs with the fix, as the test that goes green.
- [ ] Pass-through behavior tested — blocked on the fix.
- [ ] Owner verifies on real mixed data.

#### Completion record

- PR/commit: the Group J commit (2026-09-09) — documentation + test-locking of
  the existing behavior only. **The bug itself is open.**
- Automated tests: the two strip tests named above.
- Agent verification: strip behavior only.
- Owner verification: —

---

## BUG-006 — a row slice carries `text_columns` through unsliced, so text cells stop matching their rows

**Priority:** P2 — the numeric data in the child is correct and the parent is
untouched, so nothing is destroyed. But every text cell shown against an
extracted row belongs to a DIFFERENT row of the parent, which is a wrong value
displayed as if it were right: a sample id, operator or run label read off the
child's grid can be silently attributed to the wrong measurement. That is the
"can escape notice" class, capped at P2 only because it requires a sheet that
carries inline text columns at all.

**Reported:** 2026-09-09, by Claude, in the adversarial review round of the
Group J `cat_levels` propagation fix — the review was asked whether
`sliceDataStruct(ds.data, rows)` was truly equivalent to the literal it
replaced, and following that question through the row-index domain surfaced this
separate, older defect.

**Investigated:** — (design-time finding, confirmed by reading the code.)

**Suggested implementation owner/model:** a frontend slice; the decision half
needs a ruling before the code half.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P1.4's
"Preserve factors through derived data, filter/join, reopen, recipes, and
export" box.

#### User-visible problem

`lib/datasetsplit.ts`'s `sliceDataStruct` copies `metadata` wholesale
(`metadata: { ...data.metadata }`). The `text_columns` sidecar lives IN metadata
and is row-indexed — `{ columnHeader: [cell per row] }` (`io/delimited.py:411`,
`io/import_preview.py:455`, `io/sqlite_query.py:169`; read in the frontend by
`lib/columnmeta.ts`'s `originTextColumns`).

So slicing rows `[1, 5, 9]` out of a sheet gives a child whose numeric rows are
the right three, and whose text columns are still the parent's FULL cell lists.
The worksheet renders text columns positionally alongside the numeric grid, so
the child's row 0 shows the parent's row-0 text against the parent's row-1
numbers.

Both consumers of `sliceDataStruct` are exposed:

- **Extract** (`components/Stage/worksheet/extractRows.ts` ->
  `useWorksheetView`'s `extractSubset`) — the Data-Filter-narrowed row set.
- **Split by column** (`store/split.ts`'s `splitDatasetByColumn`) — each child
  gets one group's rows.

`label_rows` is NOT affected: it is indexed by CHANNEL, not by row, so a row
slice leaves it correct.

#### Why it was not fixed on discovery, and why that was over-cautious

It was filed needing "a ruling" on whether to slice the sidecar or drop it.
**On revisiting, there is no ruling to make.** The sidecar is row-indexed by
construction; the operation is a row slice; slicing it is the only
self-consistent answer. Dropping the text columns would LOSE data, and keeping
them unsliced MISATTRIBUTES it — there is no third option worth an owner's
time. Filing it as a decision was the wrong call, and it is recorded that way
rather than quietly re-scoped.

The two hesitations, and what they were actually worth:

1. `sliceDataStruct` is shared, so the primitive stops being a pure
   column-layout-preserving row map and starts knowing about specific metadata
   keys. Real, and the fix leans into it: an explicit `ROW_INDEXED_SIDECARS`
   allowlist naming exactly which keys are per-row, with the reason that
   everything else (`label_rows`' per-CHANNEL cells, `all_column_names`,
   file-level `comments`) must NOT be sliced written next to it. Slicing those
   would be the mirror-image bug.
2. A text-only Origin book (`time.length === 0`, text columns ARE the grid) is
   genuinely different — but Extract already refuses that case outright
   (`planExtract` returns null when no row carries numeric data), so it never
   reaches this code, and Split partitions by a numeric column so it cannot
   arise there either. The edge was real; its reachability was not checked
   before letting it block the fix.

#### Reproduction

- [x] Starting state identified — any dataset whose `metadata.text_columns` is
  non-empty (a generic CSV with a text column, any Origin "Text & Numeric"
  sheet, a SQLite import with a text column) plus an active filter or a
  Split-by-column.
- [x] Exact actions recorded — filter to a row subset, press Extract; or Split
  by any column.
- [x] Actual result recorded — the child's `metadata.text_columns` is the
  parent's, unsliced; every text cell is off by the filter's own offsets.
- [x] Reproduced by a test — deliberately not added yet: a passing test would
  lock in the wrong behavior, and a failing one belongs with the fix.
  **2026-09-14 (Claude):** added now that the fix is shipped everywhere (see
  the "Every caller covered" box below). `frontend/src/components/Stage/
  worksheet/extractRows.test.ts`'s "planExtract — a filtered row subset's
  text cells line up with THEIR OWN rows on Extract (BUG-006)" describe block
  reproduces the original user-visible symptom end to end, at the layer the
  user experiences: a dataset with `metadata.text_columns`, filtered to a
  non-contiguous row subset (simulating the Data Filter), run through
  `planExtract` — the exact function `useWorksheetView`'s `extractSubset`
  calls for the Extract button — then asserts every child row's OWN text cell
  names the same source row its own numeric value came from. Sabotage-
  verified: reverting `lib/datasetsplit.ts`'s `sliceDataStruct` to copy
  `metadata` wholesale (`{ ...data.metadata }`, dropping the
  `sliceRowSidecars` call) made it fail (`expected [...] to have a length of
  4 but got 6`); reverted byte-identical.
- [ ] Confirmed visually on real owner data.

#### Investigation

- [x] Likely owning module identified — `frontend/src/lib/datasetsplit.ts`
  (`sliceDataStruct`), with `extractRows.ts` and `store/split.ts` as the two
  callers.
- [x] Root cause confirmed rather than inferred — read `sliceDataStruct` (it
  spreads `metadata` and names no sidecar), `io/delimited.py`'s
  `text_columns` construction (row-indexed by definition) and
  `lib/columnmeta.ts`'s reader.
- [x] Scope bounded — `label_rows` is channel-indexed and unaffected;
  `cat_levels` is channel-indexed and already handled.

#### Implementation

- [x] Slice `text_columns` in `sliceDataStruct` — the only self-consistent
  option for a row-indexed sidecar under a row slice.
- [x] Applied at every FRONTEND row-SLICING site (row edits and the backend are
  separate boxes below; "EVERY row-slicing site" as this originally read was
  false — see STILL OPEN), via one shared `lib/rowSidecars.ts`:
  `lib/datasetsplit.sliceDataStruct` (Extract, Split-by-column, byPartition),
  `lib/rowstate.pruneExcluded` (the analysis view behind every filter and row
  exclusion — Tabulate and Stat Stage category labels were reading one row off)
  and `lib/facet.facetSlices`. **The first version fixed only the first of
  those and claimed the bug closed**; a review found the other two still live,
  which would have been an overclaim shipped.
- [x] THREE sidecar keys, not two. `origin_report_sheets` is the same
  `{name: [cell per row]}` shape (`io/origin_project/opj.py`) and was missed by
  the first attempt — whose comment asserted, wrongly, that everything else was
  file-level or channel-indexed. Both text-column spellings are handled,
  matching `lib/columnmeta.ts`'s own `??` read order.
- [x] A row past a SHORT text column yields `""` — a blank cell, which is what
  the worksheet renders — rather than `undefined`, which would serialize to
  `null` and read back as a hole.
- [x] A structurally corrupted sidecar (a bare array where `{name: cells[]}`
  belongs) is carried through UNTOUCHED rather than reshaped.

#### Tests and acceptance

- [x] Eight tests in `lib/datasetsplit.test.ts` ("row-indexed metadata sidecars
  (BUG-006)"): same-rows slicing, a NON-ASCENDING slice (the signature accepts
  any order, so text must follow the same permutation as the numbers), the
  SHORT-column blank cell, the `origin_text_columns` spelling, the corrupted
  array shape, and a no-sidecar dataset unchanged.
- [x] Sabotage-verified, and the first attempt was WEAK — worth recording. The
  "channel-indexed sidecars are not sliced" test could not fail: TWO
  independent mechanisms protect them (not in the allowlist, and not
  `{name: array}` objects), so removing either alone left it green. It is now
  labelled as the characterization test it is, and the shape guard got its own
  test that DOES fail when the `Array.isArray` rejection is removed.
- [x] ~~Every caller covered~~ — SIX of eight, see "STILL OPEN" below. This box
  was ticked twice on an enumeration that was never verified against a search;
  the two misses were found by review, not by the suite. The fix is in one
  shared helper, and
  `rowstate`/`facet`/`datasetsplit`/`selectionInvariant` suites all pass. Two
  pre-existing assertions changed from `toBe` to `toEqual` on `metadata`: it is
  no longer carried by REFERENCE (its sidecars must be sliced), and those tests
  had been pinning that aliasing rather than any contract. Content is unchanged
  for a dataset carrying no row-indexed sidecar.
  **RECONCILED 2026-09-14 (Claude):** the "STILL OPEN" this note pointed to is
  a heading inside BUG-009's entry, not this one — a stale cross-reference
  left over from before Group P closed the remaining sites (2026-09-10) and
  the `PREVIEW_SOURCE_ROWS` label-path fix generalized (2026-09-12). Re-verified
  against the CODE, not the prose, by grepping every call site of the shared
  helpers (`ROW_INDEXED_SIDECARS`/`sliceRowSidecars`/`concatRowSidecars`/
  `withoutRowSidecars`/`PREVIEW_SOURCE_ROWS` in `lib/rowSidecars.ts`, and
  `slice_row_sidecars`/`drop_row_sidecars` in `row_sidecars.py`) rather than
  trusting a count. All TEN sites this entry ever named now carry the fix:
  1. `lib/datasetsplit.ts:463` `sliceDataStruct` (Extract, Split-by-column,
     byPartition) — slices.
  2. `lib/rowstate.ts:73` `pruneExcluded` — slices.
  3. `lib/facet.ts:62` `facetSlices` — slices.
  4. `store/cellEdit.ts:161,208` `insertRows`/`deleteRows` — slices (sized by
     `sidecarRowCount`, not `time.length`).
  5. `lib/worksheetTransforms.ts`'s `provenance()` (transpose/stack/unstack) —
     deliberately DROPS both `ROW_INDEXED_SIDECARS` and `PREVIEW_SOURCE_ROWS`;
     no row mapping exists for those reshapes.
  6. `lib/merge.ts:196-197` `mergeDatasets` — `withoutRowSidecars` +
     `concatRowSidecars` (per-input span, no truncation, no silent drop of
     datasets 1..N).
  7. `calc/corrections.py:328` xTrim — `slice_row_sidecars`.
  8. `calc/resample.py:143` — deliberately `drop_row_sidecars`; no output row
     is an input row.
  9. `store/importDatasets.ts` (composes `PREVIEW_SOURCE_ROWS` onto a pending
     book's preview metadata) + `components/Stage/worksheet/textColumns.ts`'s
     `worksheetTextColumns` (suppresses text columns while `rowsAreSampled`,
     never misattributes them) — the render half of site 9.
  10. `lib/barlayout.ts:126` `textLabelsFor` — reads `PREVIEW_SOURCE_ROWS` via
      `asPreviewSourceRows`; the label path closed 2026-09-10 and generalized
      via the `preview_rows` wire field shipped 2026-09-12.
  TEN of ten, by search rather than by enumeration this time.
- [x] `store/cellEdit.ts`'s `insertRows`/`deleteRows` — the worst site, because
  a slice produces a NEW dataset while a row edit is PERSISTED into the
  existing one. Both are slices in disguise and share `sliceRowSidecars`:
  `deleteRows` builds the surviving row list, `insertRows` builds the same kind
  of list with `-1` in the new slots (a miss already yields a blank, so an
  insert needs no second code path — an earlier draft's separate
  `insertBlankRowsInSidecars` was the thing most likely to drift). Both mirror
  what the file already does for `excludedRows` ("REMAP rather than clear: an
  explicit insert knows exactly what moved").
- [x] Both index lists are sized from `sidecarRowCount`, NOT `time.length`.
  Sizing from the numeric grid was a DATA-LOSS bug found in the Group N review
  after the fix had been declared closed: a sidecar longer than `time` was
  truncated on the next row edit, and a text-only Origin book (`time: []` with
  a populated `text_columns`) lost its entire grid to one `insertRows`. Green
  on the whole suite, because nothing pinned sidecar length against row count.
  Four regression tests now do, insert and delete, including the `time: []`
  case.
- [x] `lib/worksheetTransforms.ts`'s `provenance()` — the sixth site, also
  found in the Group N review. Transpose/stack/unstack REPLACE the rows rather
  than permuting them, so no index mapping exists; the sidecars fail closed and
  are dropped. This also unshadowed `stackWorksheet`'s fresh
  `origin_text_columns: {Source}`, which a surviving stale `text_columns` beat
  in `lib/columnmeta.ts`'s `text_columns ?? origin_text_columns`.

#### The last three sites (Group P) — and why the enumeration kept being wrong

The claim "applied at EVERY row-slicing site" was false twice. Group P closed
the two the Group N review found, plus a NINTH the Group P audit found on its
own, and the reason the count kept moving is worth recording: each earlier pass
enumerated the sites it had *thought of* instead of searching for the shape.
Group P searched for the shape — every producer of a DataStruct whose row count
differs from its input's — and that is what turned up sites 7-9.

- [x] **`src/quantized/calc/corrections.py`'s xTrim** (`:122-131` masks rows,
  `:252` returns `metadata=dict(data.metadata)` unsliced). Import a CSV with one
  `label`-role column, so `metadata.text_columns` holds exactly one cell per row
  (`io/import_preview.py:453-458`); apply corrections with `xTrimMin` cutting the
  first 50 of 100 rows. The response has 50 rows and 100 text cells starting at
  `o0`, so row 0 shows `o0` beside old row 50's numbers — and
  `routes/_payload.py:131` -> `store/corrections.ts:183-201` writes it straight
  into `d.data` and thence the `.dwk`. Worse than the Extract/Split cases this
  bug started from, which only ever produced a derived copy. The code right
  beside it reasons explicitly about `excludedRows` shifting under an xTrim and
  says nothing about the sidecars.
- [x] **`frontend/src/lib/merge.ts:119-123`** — `metadata: { ...datasets[0].metadata,
  ... }`. Two harms: datasets 1..N's sidecars are silently DROPPED, and if
  dataset 0's sidecar is longer than its own row count (the ragged case) its
  trailing cells land on dataset 1's rows. Measured shape: A = `time:[10,20,30]`
  with `text_columns:{A:[a0..a5]}`, B = 3 numeric rows -> merge yields 6 rows
  with `A:[a0..a5]` unchanged, so B's rows display `a3,a4,a5`. Reached from
  `useApp.ts` importAppended + mergeSelected. FIXED by
  `lib/rowSidecars.concatRowSidecars`: column names are unioned in
  first-appearance order, each input contributes EXACTLY its own row count padded
  with blanks, and an all-blank column is dropped. This is the one place that
  must NOT trailing-trim — trimming one part would shift every following part.
  An input whose sidecar runs longer than its own rows has cells for rows the
  combined grid does not have; those are dropped rather than pushed onto the next
  input, the honest trade.
- [x] **Site 9, found by Group P's own audit, NOT by the reviews:
  `store/importDatasets.ts` + `useWorksheetView.ts`.** A still-pending Origin
  book's placeholder Dataset pairs the ~200-row min/max-DECIMATED preview
  (`_book_preview_payload` -> `book.preview.time/values`) with the FULL book's
  `metadata` (`_slim_metadata` strips only `origin_books`), so its text sidecars
  hold one cell per REAL row. `GridRow` then rendered `t.rows[r]` beside
  `values[r]` — and decimation keeps each bucket's extremum, so it is not even a
  prefix: row r's text belonged to whatever row the sampler picked. It also drove
  the grid's row count to the FULL length via
  `max(time.length, textRowCount)`, rendering thousands of rows with no numbers.
  Visible in the worksheet for as long as the fetch takes, and indefinitely when
  it fails (`installBookData`'s catch leaves `pending` set). `pendingGuard` in
  the SAME FILE already refused extract/copy citing this exact reasoning ("a row
  index computed against the preview doesn't correspond to any real row") — the
  render simply never got the same treatment. FIXED by suppressing text columns
  while `ds.pending`; nothing is lost, since `installBookData` swaps data and
  metadata together and the Inspector's provenance card (which never indexes by
  row) keeps showing them throughout.
- [x] **`calc/resample.py`** — DROPS them rather than slicing, because every
  output row is an interpolated point on a new grid: no output row IS an input
  row, so there is no mapping. The same reasoning already governed `cat_levels`
  there. New `drop_row_sidecars` makes the choice explicit and tested.
- [x] `src/quantized/row_sidecars.py` is the new Python mirror of
  `lib/rowSidecars.ts` — same module name, same key list, same trailing-trim and
  empty-column rules, kept in sync BY HAND like
  `datastruct.is_categorical`/`lib/categorical.isCategoricalChannel`.
- [x] Checked and NOT sites: `io/origin_project/preview.py`'s
  `_trim_trailing_padding`/`decimate_datastruct` (their metadata is discarded —
  the payload sends the full ds's), and `calc/map.py` (builds a 2-D `MapData`
  grid, where a per-row sidecar has no meaning). Both independently re-verified
  in the second review round. NOTE `preview.py` is no longer merely "not a site":
  it is now the SOURCE of site 9's fix, since it is the only place that can tell a
  padding trim (an aligned prefix) from a min/max sample.
- [x] **Site 10, CLOSED 2026-09-10.** The diagnosis was right: `textLabelsFor`
  pairs sidecar cell r with row r, and a lazily-loaded book's preview has
  decimated rows against a FULL-LENGTH sidecar
  (`io/origin_project/preview.py` leaves `metadata=ds.metadata` on both the trim
  and the sampled path). Measured wrong output, red-first: a 6-row book with
  levels `[0,0,1,1,2,2]` and text `["A0","A0","B1","B1","C2","C2"]`, sampled to
  rows `[1,2,4,5]`, returned `["A0","A0","B1"]` for levels `[0,1,2]` — every
  level covered and each internally consistent, so its own agreement check
  PASSED. Confident wrong category names, not a safe numeric fallback.
  **FIX: `textLabelsFor` skips a sidecar column whose length disagrees with the
  row count.** Suppress, never reindex (reindexing is impossible — the preview
  does not record which rows the sampler kept), and never DELETE.
  **TWO REJECTED ALTERNATIVES, both measured:**
  * *Threading a `sampled` flag into the pure layer* (what this entry originally
    prescribed): making the parameter required enumerated 27 errors across 13
    files — ~9 pure functions plus every transitive caller — and left a
    permanent hazard that a new caller passes `false` and silently restores the
    bug.
  * *Stripping the sidecar at the two producers* (built, and REVERTED in
    adversarial review): it destroyed data that legitimate NON-row-indexing
    readers need — the Inspector's Origin provenance card and
    `lib/projectSearchSidecars.ts`'s name search — and the loss PERSISTED,
    because `lib/workspaceSerialize.ts` then wrote the stripped metadata into
    the `.dwk`. It also gated on `book.preview_sampled`'s truthiness rather than
    the shared `rowsAreSampled` predicate, so an older backend's `undefined`
    FAILED OPEN and reopened the bug. Site 9 had already chosen the right shape
    and said so in its own header; the strip contradicted it.
  **KNOWN COST — as first written, and CORRECTED 2026-09-12 (Claude):** the
  paragraph here says a padding-TRIMMED preview's labels "also degrade to
  formatted numbers", on the argument that "no length test can tell a prefix
  from a sample". That is TRUE OF THE LABEL PATH and the two halves of this bug
  ended up on DIFFERENT guards, which is worth stating plainly because I first
  corrected this row the wrong way round:
    * the WORKSHEET text-column path (`worksheet/textColumns.ts`) gates on
      `lib/rowSidecars.rowsAreSampled`, which reads the backend's
      `preview_sampled` flag — so a TRIMMED preview's text columns DO show.
    * the LABEL path (`lib/barlayout.textLabelsFor`) gates on a pure LENGTH test
      (`rows.length !== by.length`) and takes a bare `DataStruct`, so it has no
      access to `pending` and therefore no access to the flag. A trimmed preview
      suppresses there exactly as the paragraph says.
  So the flag fixed one path and not the other, and the label path is the one
  this booked item is about. (My first edit here claimed both were fixed, having
  verified `rowSidecars.ts` and generalised to a module that does not use it.)
- [x] **Booked by site 10's fix, rescoped 2026-09-12:** recovering the LABEL
  path's text labels — for a sampled preview AND for a trimmed one, since that
  path cannot see the flag — needs the backend to send which rows the decimator
  kept. Cheaper than the original note assumed:
  `_decimate` ALREADY computes them (`idx = np.fromiter(sorted(keep), ...)`,
  `io/origin_project/preview.py`) and discards them, so nothing needs
  recomputing — the wire field is the whole backend cost, and only when sampled
  (unsampled, the map is the identity and pure waste). Then the guard can be
  exact instead of conservative for the label path. Still a wire/preview
  contract change, deliberately not invented inside the original fix.
  **Backend half landed 2026-09-12** (`preview_rows`, omitted when the rows
  already correspond). The frontend half is NOT a signature change: measured, 30
  non-test call sites reach `resolveCategoryLabels`, most holding only a
  `DataStruct`, so threading a `Dataset` through them is the blast radius this
  bug's four review rounds warn about. Carry the map in the PREVIEW's own
  metadata instead, where `textLabelsFor` already reads, and the change is ONE
  site.
  **Also measured, and a better option to weigh first:** `_slim_metadata` drops
  only `origin_books`, so every lazy book's inventory entry currently ships its
  FULL-LENGTH text sidecars beside a 200-row preview. Slicing those to the
  preview rows would make `rows.length === by.length` hold naturally — labels
  correct at all 30 sites with NO frontend change, and a SMALLER payload than
  today. CHECKED 2026-09-12 AND REJECTED, by reading the reader that made it a
  question: `components/Inspector/OriginProvenanceCard.tsx` renders that
  sidecar's CELLS (`ColumnStringsSection`) and counts its keys in the card
  header, so slicing on the wire would silently show a SUBSET of a provenance
  card whose entire job is reporting what the file contained, with nothing on
  screen saying it was narrowed. `projectSearchSidecars.ts` reads keys only and
  would have been fine; the card is what rules it out. The payload saving is real
  and deliberately forgone — the map is additive and lossless, a sliced sidecar
  is lossy for a reader that wants the whole thing.
  So the shape is the MAP, and what remains is getting it to `textLabelsFor`.
  NOT a one-liner, and the backend field is INERT until it is done: the map
  belongs to the preview while `textLabelsFor` takes a bare `DataStruct`, and
  both homes cost something — `metadata` round-trips it into the `.dwk` and adds
  another row-indexed-ish key to the family that already cost four review rounds,
  while an optional parameter spares all but one of `resolveCategoryLabels`'
  call sites — 11 invocations outside `lib/barlayout.ts`, 12 counting the one
  inside it, measured with `grep -o 'resolveCategoryLabels('` over non-test
  sources; the "29 of 30" an earlier draft of this note claimed was a count of
  textual references (imports and prose included), not of calls — but must be threaded
  through every path that labels a possibly-pending dataset (bar/box/violin/
  strip, Tabulate, Data Filter, plotdata). Decide it deliberately.
  `catTableLabels` needed no change — `cat_levels` is channel-keyed, not
  row-indexed. NOTE that is a narrow claim: an Origin `.opj` import carries text
  columns and NO `cat_levels`, so for the datasets this guard actually affects
  the fallback IS the numbers.
  `lib/projectSearchSidecars.ts` reads keys only and is fine.
  **SHIPPED — reconciled 2026-09-12.** Landed as the metadata option decided
  above: backend `e524d4ff` (`preview_rows`, omitted when the rows already
  correspond), frontend `8711dab5` (`lib/rowSidecars.ts`'s
  `PREVIEW_SOURCE_ROWS`/`asPreviewSourceRows`, read by
  `lib/barlayout.ts::textLabelsFor` via `meta[PREVIEW_SOURCE_ROWS]`), review
  fixes `3145fe33` (composed map on a row slice, duplicate-index rejection,
  identity map for a trimmed prefix, facet-picker fix); merged as #355
  (`fe40adb5`). `store/importDatasets.ts` writes the map onto the preview's
  metadata; `lib/rowSidecars.ts::composePreviewSourceRows`/`sliceRowSidecars`
  keep it correct across a row slice.
  **Residuals recorded, not further open work:** (1) a text column shorter
  than the book reads an out-of-range map entry as `undefined` -> blank per
  CELL, fail-closed one row at a time rather than disabling the whole map
  (`lib/barlayout.ts::textLabelsFor`'s unbounded-validator comment); (2)
  `mergeDatasets` (`lib/merge.ts` via `withoutRowSidecars`) and every
  worksheet reshape (`lib/worksheetTransforms.ts`'s `provenance()`) DROP the
  map outright rather than compose or carry it, deliberately — `stack`'s
  recoverable row mapping is booked but not done (see `rowSidecars.ts`'s
  `PREVIEW_SOURCE_ROWS` doc comment).

#### Second review round, on the fix itself — all fixed here

Ten more issues, two HIGH, and both HIGH ones were in the round-1 FIX rather than
in code it had missed:

- [x] `concatRowSidecars` sized parts by `time.length`, TRUNCATING an input's
  overflow cells — the very thing `store/cellEdit.ts` had ruled against one
  commit earlier, and its doc called that truncation "the honest trade" without
  mentioning the honest option. Parts are now sized by `sidecarRowCount` and the
  numeric rows padded to match, so nothing is dropped and part k's numbers and
  text land on the same output rows.
- [x] `mergeDatasets` spread dataset 0's metadata and relied on the rebuild to
  OVERWRITE it; `concatRowSidecars` omits a key no input contributes to, and an
  omitted key left dataset 0's sidecar standing. Now stripped first
  (`withoutRowSidecars`). Recorded precisely because it matters: with the span fix
  in place, a sabotage showed the strip is load-bearing ONLY for a corrupted
  sidecar — it does not fix the two headline reproductions, and the comment says
  so rather than taking credit for them.
- [x] Row EDITS on a pending book were unguarded, so `sidecarRowCount` reported
  the full book's span against the preview's numbers: one "insert row" padded the
  grid to the full length in NaN, persisted it, and `installBookData` then wiped
  it silently. `refusePendingEdit` (store/pendingEdit.ts) mirrors `pendingGuard`. Site 9's render fix
  had just removed the phantom rows that used to hint at this.
- [~] Site 9's condition went through THREE wrong versions before the right one,
  and the record of the wrong ones matters more than the fix:
  1. `ds.pending` alone — over-suppressed the RENDER: a text-only book (where the
     text columns ARE the grid) went completely blank while pending, permanently
     when the fetch failed.
  2. `pending.rows > data.time.length` — a row-count PROXY, and the claim
     justifying it was FALSE. `decimate_datastruct` does NOT return its input
     unchanged below 200 rows: `_trim_trailing_padding` runs FIRST, and that trim
     is corpus-attested (Book15 drops 19 of 180). So a trimmed preview is shorter
     than `pending.rows` while still being a strict PREFIX whose cells line up —
     and the proxy blanked ordinary books, which is the regression it replaced.
  3. Reusing the resulting `rowsAreSampled` for the row-EDIT guard as well. Those
     answer different questions: whether SIDECARS may be indexed (render) versus
     whether `d.data` is about to be THROWN AWAY by `installBookData` (edit, true
     for every pending dataset). That loosening re-opened a silent data-loss path
     — measured on the same corpus shape, `insertRows` materialized 19 trimmed
     rows as NaN, recorded undo, warned about nothing, and the resolve discarded
     all of it.
  NOW: the render reads `rowsAreSampled`, which reads the BACKEND's own
  `preview_sampled` (only the backend can distinguish a trim from a sample);
  the edit guard reads `pending != null` and covers cell writes as well as row
  edits. Both are sabotage-verified, and the wire flag's three plumbing hops are
  each pinned by a test — round 4 deleted each of them with the whole suite green.
- [x] The Python module diverged from the TS on three measured cases: a `None`
  cell (which a `.dwk` round trip really produces), a non-integer index, and a
  tuple-valued column (silently returned UNSLICED to a pure-API caller).
- [x] "name-for-name" and "cannot drift silently" were both false — nothing
  compared the two modules at all. The key list is now mechanically enforced by a
  test that parses the `.ts` file; cell semantics are pinned case-by-case.
- [x] Every `concatRowSidecars` branch was untested, including the all-blank
  prune whose deletion left the whole suite green while keeping site 8 open.
  Covered, plus the negative-index guard the Python side had never pinned.
- [x] A `useMemo` keyed on the whole `Dataset` re-materialized every text cell on
  any unrelated change (rename, tag, exclusion toggle); back to the two fields it
  reads.
- [x] `corrections.py`'s comment cited `excludedRows` reasoning that lives in the
  FRONTEND, not in that module.

Also booked, not a defect: `lib/worksheetTransforms.ts`'s `stackWorksheet` DOES
have a recoverable row mapping (output row `k` <- source row
`floor(k / selected.length)`), so its sidecars are dropped by CHOICE, not
impossibility. Carrying them means merging with the fresh `origin_text_columns:
{Source}` stack already writes. The comment there previously asserted
impossibility for all three reshapes; it now distinguishes the three cases.

#### Completion record

- PR/commit: the Group M commit + TWO Group N review rounds (all 2026-09-09).
- Automated tests: `lib/datasetsplit.test.ts` (the eight named above),
  `lib/rowSidecars.test.ts` (the index-list and row-span primitives),
  `store/cellEdit.test.ts` (row edits, including the four truncation
  regressions), `lib/worksheetTransforms.test.ts` (the reshape drop).
- Agent verification: fix + sabotage-verified tests, including the correction
  of TWO weak ones (the channel-indexed control was re-written a second time in
  the Group N round — `all_column_names` is a bare array, so the shape guard
  alone kept it green regardless of the allowlist).
- Owner verification: — (worth a look on a real Origin "Text & Numeric" sheet;
  the fix is shape-driven, not corpus-driven, so no specimen was needed.)

---

## BUG-008 — Split Dataset ignored an explicit categorical level table

**Priority:** P2 — nothing is destroyed (the source dataset is untouched and the
child rows that DO get minted are correct), but the primary failure mode is a
silent merge: three samples become one dataset with no warning, and the user's
next analysis runs on a pooled population they believe is one sample. The
secondary mode is cosmetic-looking but just as misleading — children named
`run.dat (0)` / `run.dat (1)` after raw float level codes.

**Reported:** 2026-09-09, by Claude, while auditing the categorical accessors
after the Group J propagation pass. Found by READING two modules that answer the
same question, not by any failing test.

### What happened

`lib/modeling.ts`'s `channelModelingType(dataset, channel)` is the sanctioned
accessor for "what does this column MEAN". It resolves in a deliberate order:

1. the user's `channelTypes` override,
2. an explicit `cat_levels` level table (its own comment: "a level table means
   'these are labeled categories', the strongest signal there is — stronger
   than the numeric-shape heuristic below, so it's checked first"),
3. and only then `inferModelingType`, the numeric-shape heuristic.

`lib/datasetsplit.ts`'s `isCategoricalColumn` skipped straight to (3). Since the
heuristic needs at least 12 finite rows (`MIN_SAMPLES`) before it will call
anything nominal, a realistic small categorical column read as CONTINUOUS and
went to gap-clustering.

Measured on a 3-sample / 6-row column (`cat_levels: {0: ["A123","B456","C789"]}`,
codes `[0,1,2,0,1,2]`):

| | before | after |
|---|---|---|
| `channelModelingType` | `nominal` | `nominal` |
| `isCategoricalColumn` | **`false`** | `true` |
| `splitColumn().groups` | **`[{label: "1", rows: 6}]`** | `[A123:2, B456:2, C789:2]` |

One group, labelled `"1"` — the *median of the level codes* standing in for a
sample name. At 12 rows, where the heuristic happens to agree, the grouping was
right but the labels were the raw codes (`"0"`/`"1"`/`"2"`).

### The same bug from a second angle, which settled the fix

`lib/byPartition.ts`'s `byColumnOptions` — which decides which columns are
OFFERED for splitting — already used the correct accessor:
`isCategorical(channelModelingType(active, c.index))`. So a column the UI
offered as categorical could be gap-clustered by the code that then split it.
Two code paths, two answers to the same question. That made the fix direction
unambiguous: adopt the accessor, don't add a second heuristic.

### The fix

- `isCategoricalColumn`, `splitColumn` and `pickDefaultSplitColumn` now take a
  `Dataset` rather than a bare `DataStruct`, and the categorical decision is
  `isCategorical(channelModelingType(ds, col))`. All three consumers already
  held a full `Dataset` (`SplitDatasetDialog`, `store/split.ts`, and
  `lib/datasetsplitDefault.ts`, whose only caller is that same dialog), so
  there is NO DataStruct-only fallback and no call site where the
  `channelTypes` override goes unhonoured. `lib/datasetsplit.ts` importing
  `lib/modeling.ts` is not a layering break — `channelModelingType` itself
  takes a `Dataset`.
- `groupByExactValue` gained an optional per-level name resolver; `splitColumn`
  builds it from `lib/barlayout.ts`'s `resolveCategoryLabelsOrNull` — the app's
  ONE category-label resolver, shared with the bar/box axis, Tabulate, Data
  Filter, the stat stage, facets and `lib/byPartition.ts`. Passing no resolver
  keeps numeric labels, which is CORRECT for a small-integer numeric column
  routed to exact-value grouping by the shape heuristic AND carrying no
  covering text sidecar either — "run 3" must not become "run C". That
  negative control is the load-bearing test.

  The qualifier matters and a round-2 finding put it there: naming is decided
  by whether the column HAS names, not by WHY it reads as categorical. A
  shape-heuristic column with a covering sidecar is named from it (measured:
  `run = [1,2,3,…]` with a generic `text_columns` sidecar labels its groups
  `["C","A","B"]`), because `byPartition`, Tabulate, Data Filter and the stat
  stage all label that same column from that same sidecar — a split that
  disagreed would be the very divergence BUG-008 was. The sidecar source is
  also not Origin-specific: `metadata.text_columns` is read first, so
  delimited and SQLite imports are in scope too.

  **The first cut got this wrong and the review round caught it (HIGH 1).** It
  resolved labels through `lib/categorical.ts`'s level table ALONE, which is
  the narrower of the resolver's two named sources — the exact mistake
  `lib/statschooser.ts`'s header records having already been made and fixed
  once. `channelModelingType` calls a column categorical for THREE reasons and
  only one carries a `cat_levels` table; an Origin `.opj` import is the second
  shape (numeric codes plus an `origin_text_columns` sidecar, no level table).
  Measured on that shape: split produced `["0","1","2"]` while
  `resolveCategoryLabels` on the same column produced
  `["Reference","Doped","Annealed"]` — so the child datasets were named
  `run.opj (0)` from a sidecar each child literally carries (BUG-006's slice
  made sure of it), and the "FIXED" claim was broader than the code. Adopting
  the shared resolver closed it and re-unified split with every other surface.
- The dialog's tolerance field is hidden for a level-table column, where it was
  previously offered (telling the user a categorical column was a continuous
  measurement), and preview rows key on the group VALUE rather than its label
  so a malformed table with duplicate level names still renders distinct rows.
- Two dialog defects the review round surfaced as newly reachable:
  - the over-cap warning told the user to "widen the tolerance" for a column
    whose tolerance field this very component hides (measured: a 60-level
    column renders both at once). It now points at Recode for a categorical
    column.
  - the tolerance was seeded once per OPEN, from whatever column was picked by
    default — now frequently the categorical one, whose field is hidden. So a
    tolerance derived from dimensionless level codes was silently presented as
    a distance in the next column's physical units (measured: a field column
    arrived pre-filled `1` T from codes `[0,1,2]` and previewed six one-row
    groups, where its own `autoTolerance` of ~1.8 previews one). The tolerance
    now follows the COLUMN, which is the quantity it describes.
- An EMPTY level name (`cat_levels: {0: ["", "B"]}`, which `isValidLevelList`
  and `sanitizeDataStruct` both accept, so a hand-edited `.dwk` reaches it) no
  longer produces a child dataset named `run.dat ()` — `||`, not `??`.

### Mechanism, not just a fix

The divergence was invisible to the whole suite — it took reading two modules
side by side. So `architecture.test.ts` now carries a **modeling-type accessor
chokepoint**: only `lib/modeling.ts` may reach `inferModelingType`. Every other
module has to go through `channelModelingType` and therefore honours the
override and the level table.

**The first version of this guard was inverted in all three directions**, which
the review round measured (HIGH 2) — a cautionary example of a ratchet that
looks like protection:

- it matched the CALL SPELLING (`/\binferModelingType\s*\(/`), so
  `import { inferModelingType as inferType }` followed by `inferType(...)` — a
  genuine raw-heuristic call, BUG-008 verbatim — left it GREEN;
- `\s*` matches a space, so a file whose only mention was prose like
  "inferModelingType (MIN_SAMPLES=12)" FAILED it. That text already exists in
  two test files; only `sources()` excluding tests was saving it;
- the allowlist was a SUFFIX match, so `components/probe/lib/modeling.ts` was
  allowlisted too.

It now strips line and block comments, flags the identifier anywhere in real
code (an import statement spells the original name even when aliased), and
compares the path exactly. All three evasions were re-measured against the new
version: alias caught, comment green, same-named module in another directory
caught. A second test asserts `lib/modeling.ts` still DEFINES the function, so
deleting or moving it cannot leave the guard vacuously green.

### Verification

- Repro measured before the fix and recorded above, not inferred.
- 22 behaviour tests: 14 in `lib/datasetsplit.test.ts` (grouping into 3,
  level-name labels, `isCategoricalColumn` itself, the numeric negative
  control, per-channel resolution, unresolvable-code fallback, the
  `channelTypes` override, byPartition agreement, default-column pick), 2 in
  `store/split.test.ts` (child names + level tables carried through) and 6 in
  `components/overlays/SplitDatasetDialog.test.tsx` (tolerance field hidden,
  preview shows level names, duplicate level names stay distinct groups,
  tolerance re-seeded on column change, over-cap advice not pointing at a
  hidden field, continuous positive control). The `lib/` set also covers the
  Origin-sidecar naming, a sidecar that disagrees with itself (the negative
  control for that half), an empty level name, and the `channelTypes` override
  in BOTH directions — a `"nominal"` override splits a wobbly setpoint column
  per distinct read (measured 20 groups), and a `"continuous"` override
  gap-clusters a level-table column back to the pre-fix symptom on purpose,
  because the override is checked BEFORE the level table. Plus the 2-test
  accessor chokepoint in `architecture.test.ts`.
- Both halves sabotage-verified independently: reverting the accessor fails 8 +
  2 + 3 tests; reverting only the label resolution fails 3 and leaves the
  numeric negative control green; reverting the preview's `key={g.value}` fails
  the duplicate-level-name test alone.
- One test was strengthened after sabotage showed it passing vacuously ("every
  child kept its level table" was trivially true of zero children when the
  split bailed), which is exactly the failure mode that sabotage exists to
  catch.
- **A doc-promise audit corrected a comment rather than the code.** The comment
  claimed the column's unit "is still applied to any code the table can't
  resolve". Measured against the shared resolver: FALSE. Once that resolver
  decides a column has names it fills uncovered codes with formatted numbers of
  its own, so an out-of-range code reads "5", not "5 K" — deliberately the same
  text a categorical axis tick shows. The unit appears only when the resolver
  declines for the whole column. The claim was narrowed to what the code does
  and both branches are now asserted.
- The one accepted cosmetic loss: duplicate level NAMES yield two identically
  named child datasets (measured). Nothing resolves datasets by name (checked),
  so this is discoverability only.
- Owner verification: — (shape-driven, no specimen needed; worth a look on a
  real Origin sheet with a text column imported as categorical.)

---

## BUG-009 — the pending-dataset contract is five ad-hoc guards, not a contract

**Priority:** P2 — the two data-CORRUPTING sites are guarded as of 2026-09-10, so
nothing is actively destroying data. What remains is structural, and the structure
is why this cost five review rounds.

### What happened

BUG-006's site 9 (a pending Origin book's `data` is a display projection that
`installBookData` replaces wholesale) took FIVE review rounds. Each round found two
HIGH defects; THREE of those were regressions introduced by the fix for an earlier
round's finding. Every round was fully green when its defects were found.

The cause was not carelessness. **Nothing noticed a MISSING guard.** The suite and
each reviewer could only see the guards that existed, so round 4 could extend the
guard to three sites and still miss the two that CORRUPT data rather than merely
lose an edit:

- `store/computedColumns.ts` `addFormula`/`updateFormula`/`removeFormula` and
  `store/recode.ts` wrote `formulas` onto a pending dataset. Measured: the formula
  SURVIVES the resolve while the preview's labels do not, so the next legitimate
  edit computes `baseCount = labels.length - formulas.length`, treats a REAL
  measured channel as the computed one, and overwrites its imported values with
  formula output under its own label. `applyCorrections` drops that channel outright.

### Done (2026-09-10)

- [x] All nine mutation sites route through ONE `store/pendingEdit.refusePendingEdit`
  — its own module, because four earlier rounds each added a COPY of the rule
  instead of a home, and three of those copies were wrong at some point.
- [x] A ratchet in `architecture.test.ts`. **Its first version enforced almost
  nothing and this tick was FALSE for a day** — it token-matched the FILE
  (`src.includes("refusePendingEdit")`), so deleting all four guard CALLS while
  leaving the imports kept 620 files / 9,792 tests green. The only thing standing
  between the data-corrupting fix and silent deletion was an eslint unused-import
  error, which a partial deletion or a reorder defeats. Now PER-UPDATER: each
  matched updater must have a guard in its own enclosing action. Sabotage-verified
  on the three cases the file-level version missed (all four calls deleted; a
  second unguarded action in an already-guarded module; a guard removed from one
  action while siblings keep theirs).
- [x] What the ratchet does NOT catch is enumerated inline rather than summarised
  as "a coarse net": a mutation via a `lib/` helper returning a whole Dataset
  (live instance named — `useApp.ts:1142`'s overlay path, benign today, and the
  detector reports NOTHING for that file), `{...d, ...patch}` with a precomputed
  patch (`corrections.ts`/`recalcDatasets.ts`'s real shape), `getState().datasets`,
  a write past the scan window, ROW-STATE keys, and anything outside `./store/`.
- [x] The exemption list's honesty test now checks the exempt module's stated
  REASON, not just that it still has an updater: deleting `reimport.ts`'s
  `pending: undefined` — the exact clause its exemption cites — previously left
  every test green.

### CLOSED (2026-09-10) — the ROW-STATE family (found round 6)

- [x] The row-state actions are guarded, and the ratchet can now see them. They no
  longer live in `useApp.ts`: row exclusion, the transient row `selection`, and the
  per-column filter moved to **`store/rowState.ts`** (`RowStateSlice`), because the
  `useApp.ts` size pin sat 2 lines above the file and the guard had to be funded by
  an extraction rather than an append.
  **SEVEN actions, not the five booked here** — this entry missed
  `excludeSelectedRows` and `keepOnlySelectedRows`, which are how a selection
  actually becomes exclusions (the worksheet TOOLBAR's Exclude / Keep-only buttons,
  `WorksheetToolbar.tsx` -> `useWorksheetView.ts`; the row CONTEXT menu is
  mask/unmask/copy-row). `keepOnlySelectedRows` was the worst of them: it takes the
  COMPLEMENT over `data.time.length`, i.e. over the PREVIEW's row count.
  **Five WRITERS are guarded**: `toggleRowExcluded`, `setRowsExcluded`,
  `setDatasetFilter`, `excludeSelectedRows`, `keepOnlySelectedRows` — each calling
  `refusePendingEdit` directly (a wrapper hid the call from the ratchet's
  guard-detection; sabotage caught that).
  **Two CLEARS are deliberately NOT guarded and must stay that way**:
  `clearRowExclusions` and `clearDatasetFilter`. Clearing destroys a preference
  rather than recording one, and refusing it would TRAP a user whose `.dwk` restored
  row state alongside `pending` (`lib/workspaceSerialize.ts` writes the three fields
  independently and `lib/workspaceDatasetParse.ts` restores them independently — a
  reimport is NOT the path, it clears `pending` in the same updater).
  `rowState.test.ts` pins BOTH directions, so adding a guard to either clear turns a
  test red on purpose: that is the design, not an oversight to fix.
  The ratchet's key list is now `data|metadata|cat_levels|formulas|excludedRows|filter`
  with per-ACTION exemptions, so a NEW row-state writer in a NEW slice is caught.

- [ ] **Booked while closing the above:** `lib/workspaceDatasetParse.ts`'s restore
  clamps `excludedRows` with `sanitizeExcluded(..., ds.data.time.length)` where
  `data` is the stored PREVIEW on a pending dataset — the same clamp-against-preview
  shape the guard fixes for `setRowsExcluded`, on the LOAD path, unguarded. Low harm
  today (`installBookData` clears the field on resolve anyway, so the clamp only
  truncates them earlier), but it carries its own design question — should a `.dwk`'s
  exclusions survive a pending load at all? — so it is not a drive-by fix.

  **ATTEMPTED AND REVERTED (2026-09-13, Group AF).** A fix was built, reviewed
  adversarially, and taken back out before it reached `main` — the branch that
  carried it never merged forward, so the code here is still the pre-attempt
  original above. Recorded honestly rather than silently dropped, per this
  document's own purpose.

  What was built: `lib/workspaceDatasetParse.ts`'s restore refused BOTH
  `excludedRows` and `filter` outright whenever the parsed dataset was `pending`
  — dropping both fields instead of clamping the first — and pushed a named
  notice into `parseWorkspace`'s `migrationWarnings`, on the reasoning that
  `pending` is set on a brand-new import with no row state
  (`store/importDatasets.ts:232`) and every row-state writer now refuses on
  `pending` (`store/rowState.ts`'s five `refusePendingEdit` call sites at lines
  138/151/197/212/228; `store/cellEdit.ts`; `store/derivedWorksheets.ts:94`
  throws; `store/split.ts:123` resolves the source first), so the `.dwk` round
  trip (`lib/workspaceSerialize.ts` writes `excludedRows` (line 214), `filter`
  (line 215) and `pending` (line 225) independently — see that last field's own
  comment, lines 217-224, for why it argued this could only be an autosave
  snapshot — and `workspaceDatasetParse.ts` restores all three independently)
  reads as the only path that can hand a live dataset `pending` together with
  row state.

  Why it was reverted — adversarial review found the fix was a net regression,
  not a hardening, for the case it mattered most:
  - `installBookData` (`lib/bookData.ts` lines 106-119) clears `excludedRows`/
    `filter` only in its **success** handler; on a failed fetch (a moved
    `.opj`, an expired upload token — `_bookErrors`, the BUG-009 message fix
    above) or a book the user simply never reopens, `pending` stays set
    **indefinitely**, and the old (clamp, don't refuse) behaviour kept the
    user's exclusions against the exact preview rows they struck out. Refusing
    at load deletes those exclusions on the very next autosave — permanently,
    for a document with no other route back to that state, since an explicit
    Save aborts rather than writes when a book can't be resolved
    (`store/workspaceIO.ts`'s `prepareWorkspaceState`, lines 63-91, abort block at
    69-80) and
    autosave is therefore that user's only persistence for a stuck book.
  - The `migrationWarnings` notice the fix relied on to make the loss loud is
    unreachable on every path that can actually carry `pending` into
    `loadWorkspace`: crash recovery (`lib/applyRecoveryChoice.ts`'s
    `applyRecoverAutosave`, line 29 calls `loadWorkspace` then line 36
    overwrites `status` with its own message), the silent startup autosave
    restore (`useWorkspaceAutosave.ts` line 422 calls `loadWorkspace`, then
    lines 427/434 overwrite `status` with one of two hand-built messages),
    Append Project (`store/workspaceIO.ts`'s `runAppendWorkspace`, line 468,
    which doesn't call `loadWorkspace` at all and writes its own `status`),
    and workbook-package import (`store/workbookTransfer.ts`'s
    `pasteWorkbookFromClipboard`, line 233 calls `lib/workbookTransfer.ts`'s
    `parseTransferPackage`, whose own internal `parseWorkspace` call — that
    module's line 300 — computes `migrationWarnings` that the store file
    then never reads off the parse result). Only a plain File ▸ Open reaches
    `store/useApp.ts`'s `loadWorkspace` (migration notice folded into `status`
    at line 1565) without a follow-up overwrite — so the one loud case was the
    one path least likely to be the one that actually happens. Booked as its
    own bug below (BUG-010) since it outlives this attempt.
  - `filter` is a column+value predicate, valid in both preview and source row
    space (the backend preview payload keeps the full label/unit roster —
    `routes/parsers.py`'s `_book_preview_payload`, lines 148-149 — only the
    row-indexed `time`/`values` are decimated), so refusing it for a row-SPACE
    reason was never justified by the same logic as `excludedRows`; whether
    `installBookData` should keep clearing it on arrival is the pre-existing,
    still-open `#50`/`#53` product decision, not something this fix should
    have settled by fiat.

  **Plan of record (not built):** keep the restored row state in PREVIEW space
  through the pending phase — i.e. restore it as today, unguarded — and make
  `lib/bookData.ts`'s `installBookData` COMPOSE it through the
  `lib/rowSidecars.PREVIEW_SOURCE_ROWS` map (Group T) into source space at the
  one moment both row spaces are known, falling back to today's drop only when
  no such map exists (a pre-`preview_sampled` backend, or a hand-edited file).
  Every reader stays as-is: `lib/rowstate.ts`'s `droppedRows` (lines 97-104)
  already reads `excludedRows`/`filter` against whatever `ds.data` currently
  is, so a value that is always in the same space as the `data` it travels
  with needs no reader change. This touches `lib/bookData.ts`, whose clearing
  behaviour is itself a deliberate #50/#53 fix, so it is a separate,
  owner-visible change — not attempted here either.

- [x] **Also booked:** `setDatasetFilter`/`clearDatasetFilter` record NO history,
  while `clearRowExclusions` does. So building a filter and pressing undo restores a
  snapshot from before the filter change and silently discards it. Pre-existing and
  untouched by the guard pass; worth its own fix.
  **SHIPPED — reconciled 2026-09-12.** Fixed by `0da3bf20` (#354, Group S,
  "the Data Filter belongs to undo"): `store/rowState.ts`'s `setDatasetFilter`
  calls `recordHistoryCoalesced("data filter", ...)` and `clearDatasetFilter`
  calls `recordHistory("clear data filter")`; `store/dataIntake.ts` calls
  `endHistoryRun()` to terminate a slider/typing run. Pinned in
  `store/rowState.test.ts`'s "Group S — a filter edit is undoable" and
  "Group S — clearing the filter" describes ("Ctrl+Z gives back the state
  from before the filter", "a whole EDITING RUN is one undo step, not one per
  event", "is its own undo step, and undoing it gives the filter back",
  "records NOTHING when there is no filter to clear", among others).

### STILL OPEN — the structural fix

- [ ] **Replace "refuse" with "resolve-then-apply."** The guard refuses; it does not
  defer. `ensureBookData` never clears `pending` on failure, so a permanently failed
  fetch (moved source, expired upload token) is a permanent lockout: every edit,
  extract, copy and save refused forever, while the status still says "in a moment".
  For a text-only book the render fix now SHOWS the cells, so the user sees an
  editable grid that can never be edited. `store/corrections.ts` already has the
  right shape (`await get().resolveDataset(id)` first). One `withResolved(id, fn)`
  wrapper would make the safe path the DEFAULT rather than something each new action
  must remember — which is the actual defect. Deliberately NOT attempted inside a PR
  that has already taken five review rounds.
### CLOSED (2026-09-10) — "in flight" vs "failed, will never arrive"

- [x] `lib/bookData.ts` records why the last fetch for a `pending` book failed
  (`lastBookError(id, source)`), and `store/pendingEdit.ts`'s
  `pendingStatusMessage` says what actually happened — `the last attempt to load
  its full data failed (<reason>) … relink or re-import the source` — instead of
  promising "try again in a moment" forever to a book that will never arrive.
  `installBookData` re-throws unchanged, so `resolveDataset`'s reject, the save
  command's abort and `ensureBookData`'s toast are untouched; success clears the
  record alongside `pending`.
  **ADVISORY ONLY, and that is pinned by test**: the retry is still kicked (a network
  blip does come back), the refusal is unchanged, and nothing becomes unreachable
  because a failure was recorded. So this closes the LIE, not the lockout — the
  lockout is the deferral box above, which is still open.

  **MODULE STATE, NOT A `Dataset` FIELD — and the first attempt got that wrong,
  which is the useful part of this entry.** Putting the reason on `Dataset` meant a
  failed fetch performed a store write where it had previously performed NONE, and
  two live mechanisms compare `datasets` by IDENTITY:
  `components/windows/WindowCanvas.tsx` and `components/Stage/useMultiPanelStage.ts`
  have effects whose deps include `datasets` (or the active `Dataset` object) and
  whose bodies call `ensureBookData` when `pending` is set — so each failure re-ran
  the effect, which re-fetched, which failed, which wrote again: an unbounded
  request storm on exactly the dead book being fixed. And
  `useWorkspaceAutosave.shouldAutosave` compares the same reference, so the write
  marked a clean project dirty and, once looping, reset the 800 ms autosave
  debounce faster than it could ever fire — starving autosave of real user edits.
  Both were found in adversarial review while CI was 14/14 green.
  A fetch outcome is transport state, like the in-flight promise beside it; keeping
  it in module scope makes "never serialized, never undone, never remapped, never
  re-rendered" true by construction instead of by four separate allowlists. The
  entry records WHICH source failed, because dataset ids repeat across a project
  load. Pinned by four tests that assert the array identity, each dataset's object
  identity, and `shouldAutosave` — the last of those asserted `projectDirty`
  first and was VACUOUS (its subscriber only registers inside a React effect, so
  the flag stays false either way); it survived the sabotage that reintroduced the
  write, and now asserts the gate directly.

- [x] **Review round 2 (no HIGHs; both round-1 HIGHs verified gone).** Fixed:
  `lastBookError` now compares `token` as well — an upload `BookSource` has no
  `path`, so without it the identity check degenerated to `bookId` alone for
  exactly the case this bug names, an expired upload token. Each of the four
  fields is now sabotage-verified individually (the first test varied two at
  once and could not tell which was compared). `installBookData`'s failure
  handler became the second argument to `.then` rather than a `.catch`, so a
  throw from the SUCCESS handler can no longer be recorded as a fetch failure.
  `lib/workbookTransfer`'s refusal no longer claims a book is dead for good —
  the record says only that the LAST attempt failed, and a two-second blip
  records one — and it now caps the reason through the shared `truncateReason`
  instead of interpolating an unbounded backend `detail`; both arms have tests,
  the failure arm having had none. The status text stopped advising "relink",
  which writes `Dataset.source` only and never clears `pending`, so it could
  not revive the book.

- [x] **A PROVEN test-order defect, and a ratchet for it.** `_bookErrors` is
  module state cleared only by a success, so a guard test's jsdom-rejecting
  fetch poisons later tests in the same file that share a dataset id.
  `cellEdit.test.ts` and `computedColumns.test.ts` shipped exactly that and
  passed only because the one test in each that asserts the message happened to
  run first: `--sequence.shuffle.tests --seed=1` failed both. `lib/bookData.ts`
  already documented the rule and the commit that wrote it applied it to two of
  the four files needing it — so `architecture.test.ts` now enforces it (a test
  file asserting the pending-guard message must CALL
  `resetBookTransportForTests()`). That check's own first version matched the
  IMPORT, so deleting the call left it green — the identical hole this bug's
  other ratchet already shipped and recorded once. Sabotage caught it both
  times; only the second time was it already written down.

- [x] **The wording now has ONE home.** The first version corrected one of five
  messages while claiming it had corrected all of them:
  `useWorksheetView.pendingGuard` (Extract / Copy rows), `useTabulate`,
  `useFitYByX` and `useStatsChooser` each carried their own hard-coded "try again
  in a moment", and `lib/workbookTransfer.buildTransferPackage` its own plural
  variant. All five now go through `pendingStatusMessage` (or, for the transfer
  package, name the first genuinely dead book). Their control flow is unchanged —
  each still writes to its own local status/error channel — so this unifies the
  wording only; unifying the GUARDS is the structural half still open above.

### The invariant, stated once (it never was)

A pending dataset's `data` is a **read-only display projection**. Read: allowed.
Render: allowed, and row-indexed sidecars may be shown only when the backend says
the preview is a prefix (`preview_sampled === false`). Edit / derive / extract /
save: resolve FIRST, then apply, and surface a genuine failure.

### Completion record

- PR/commit: the round-5 response on the Group P branch (2026-09-10).
- Owner verification: — (the resolve-then-apply refactor is a design call worth
  an owner's read before it is built).

---

## BUG-010 — `migrationWarnings` are unreachable on every load path except a plain File ▸ Open

**Priority:** P2 — no data is corrupted, but the ONE mechanism this repo has for
telling a user "something in your saved document was dropped or downgraded on
load" silently says nothing on three of the four ways a document can load. A
diagnostic that only fires on the least common path is worse than it looks: it
lets a future fix (like the reverted Group AF attempt above) believe it has
made a loss loud when it has not.

**State:** Fixed (commit pending merge), 2026-09-13 — see "Fix implemented" below; the workbook-package decision is recorded there. A same-day review round found one real coverage gap (File ▸ Open) plus several stale/inaccurate prose citations — see "Review round, 2026-09-13" near the end of this entry.

**Reported:** 2026-09-13, by Claude, during adversarial review of the Group AF
`.dwk` load-path attempt on the BUG-009-adjacent item above — that attempt's
loudness story depended on this channel and the review measured that it does
not reach the user on any path a real pending-dataset document is likely to
take.

**Investigated:** root cause confirmed by reading every caller, not inferred —
see Evidence below.

**Suggested implementation owner/model:** Unassigned.

**Related plan:** BUG-009 (the pending-dataset contract) above; the item this
was found while reviewing.

#### User-visible problem

`store/useApp.ts`'s `loadWorkspace` is the one place that folds a document's
`migrationWarnings` into the load status: it builds `migrationNotice` from
`migrationWarnings[0]` (line 1431) and appends it to the `"loaded workspace — N
datasets…"` status string (line 1565). That machinery exists today for
unrelated migration cases (e.g. a saved `FigureDocument` with an unsupported
version — `lib/workspace.ts`'s `parseEditableFigures`, line 183) and is exactly
what the reverted Group AF fix planned to reuse for "your saved row exclusions
were dropped because the book hadn't finished loading."

The problem: every OTHER entry point that can load a workspace either never
calls `loadWorkspace` at all, or calls it and then overwrites `status` one or
two statements later with its own message that never reads
`ws.migrationWarnings`. A warning pushed into that array is therefore visible
only when the user does a plain File ▸ Open — not on the two paths (crash
recovery, silent autosave restore) that are how a pending-dataset document is
actually most likely to come back, and not on Append Project or a workbook
package import either.

#### Root cause

Four call sites, each confirmed by reading the code:

- **`lib/applyRecoveryChoice.ts`'s `applyRecoverAutosave`** (the "Recover
  autosaved work" crash-recovery choice): line 29 calls
  `s().loadWorkspace(prompt.workspace)`, then line 36 calls
  `s().setStatus(msg)` with a hand-built `"recovered N datasets from
  autosave…"` string that never reads `prompt.workspace.migrationWarnings`.
  Whatever `loadWorkspace` just wrote to `status` is gone before the user sees
  it.
- **`frontend/src/useWorkspaceAutosave.ts`'s silent startup restore**: line 422
  calls `useApp.getState().loadWorkspace(restored)`, then lines 427/434 call
  `setStatus` with one of two hand-built strings
  (`"recovered … after an unexpected close"` / `"restored … from autosave"`),
  again never touching `restored.migrationWarnings`. This is the path that
  runs on every ordinary app start when an autosave generation exists — the
  most common way a `pending` dataset re-enters the live store.
- **`store/workspaceIO.ts`'s `runAppendWorkspace`** (Append Project): does not
  call `loadWorkspace` at all — it calls `mergeWorkspace` directly and, at line
  468, sets `status: msg` to its own `"appended N datasets (M renamed)…"`
  string. `ws.migrationWarnings` from the parsed `.dwk` is never read anywhere
  in this function.
- **`store/workbookTransfer.ts`'s `pasteWorkbookFromClipboard`**: line 233
  calls `lib/workbookTransfer.ts`'s `parseTransferPackage(text)` (that
  function, in turn, calls `parseWorkspace(...)` internally at its own line
  300) and stores the result in `parsed`, then reads only `parsed.pkg` fields
  (workbook/datasets/etc.); the sibling `parsed.migrationWarnings` the parse
  already computed is never read anywhere in the store file — confirmed by a
  whole-file search.

So of the four loaders that can carry a document's `migrationWarnings` into
the live store, three actively discard it and the fourth (plain File ▸ Open,
`store/useApp.ts`'s `loadWorkspace` itself) is the only one where it survives
to the status bar. (A later review round found File ▸ Open's own toast
coverage was itself incomplete — see the 2026-09-13 review paragraph near the
end of this entry.)

#### Fix checklist

- [x] Give `migrationWarnings` a delivery channel a caller cannot silently
  clobber by writing to `status` afterward — shipped as a shared toast
  helper (`notifyMigrationWarnings` in `store/toasts.ts`, mirroring the
  existing "recovered … — check your latest edits" toast pattern in
  `useWorkspaceAutosave.ts`) called explicitly at every loader, rather than a
  toast fired automatically from inside `loadWorkspace` itself — a
  `loadWorkspace`-internal toast would still miss Append Project and
  workbook-package import, which never call `loadWorkspace` at all, so the
  helper is called at every loader explicitly (File ▸ Open's own
  `replaceWorkspace`/`replaceWorkspaceSafely` included, after the review
  round) — and rather than a `status` string every caller must remember to
  fold into its own message.
- [x] Pin it at `applyRecoverAutosave` first — it is the site the Group AF
  attempt actually needed and the one whose overwrite is a single, easy-to-see
  statement (line 36).
- [x] Decide and implement the same fix shape for the silent autosave restore
  and `runAppendWorkspace`, or explicitly narrow the promise (e.g. document
  that `migrationWarnings` is File ▸ Open-only) if a store-wide channel is
  judged out of scope.
- [x] Decide whether `store/workbookTransfer.ts`'s `pasteWorkbookFromClipboard`
  should surface `parseTransferPackage`'s `migrationWarnings` at all — a
  workbook package is a narrower object than a full workspace, so this may be
  a deliberate non-goal rather than a gap; state it either way.
- [x] A regression test per fixed site: assert the notice actually reaches the
  user-visible surface (status/toast) after each of the four currently-silent
  loaders, not just that `migrationWarnings` was computed. (A fifth loader —
  File ▸ Open's own `replaceWorkspace`/`replaceWorkspaceSafely` — was found
  silent too in a later review round; see the dated paragraph near the end of
  this entry.)

#### Fix implemented

A delivery channel no caller's later `setStatus` can clobber: a toast
(`store/toasts.ts`), via one new shared helper —
`notifyMigrationWarnings(warnings)` in `store/toasts.ts` — so the
"first warning + (+N more) count" format (mirroring `useApp.ts`'s own
`migrationNotice` local) and the "one toast for N warnings, never one per
warning" rule live in exactly one place. `useApp.ts`'s existing status-line
fold for File ▸ Open is UNCHANGED — this is additive, not a reroute — and,
after the review round below, File ▸ Open is the ONE path that shows BOTH
the status line and the toast; every other load path shows the toast only
(their own `setStatus` overwrites whatever `loadWorkspace` folded).

Call sites, each now calling `notifyMigrationWarnings`:

1. `lib/applyRecoveryChoice.ts:38` (`applyRecoverAutosave`) — called with
   `prompt.workspace.migrationWarnings`, right after the `setStatus` that
   would otherwise be the only signal.
2. `useWorkspaceAutosave.ts:436` (unconditionally, after both the
   "unclean"/silent status branches) — called with
   `restored.migrationWarnings`.
3. `store/workspaceIO.ts:473` (`runAppendWorkspace`, end of function) —
   called with `ws.migrationWarnings`; this path had no status-line fold to
   begin with, so the toast is its only surface.
4. `store/workbookTransfer.ts:250` (`pasteWorkbookFromClipboard`, after a
   successful parse) — called with `parsed.migrationWarnings`. The field
   lives on the `ParseTransferResult` success variant (`lib/workbookTransfer
   .ts`'s `ParseTransferResult`, a sibling of `pkg` rather than a field ON
   it — a live session's own `buildTransferPackage` has no equivalent, since
   it can never itself hold a version-skipped figure, so there is no shared
   persisted shape to keep in sync, only a parse-time result to report).
   `WorkbookTransferPackage` itself is unchanged; no new field was added to
   it.
5. `lib/openWorkspaceReplace.ts` (File ▸ Open / Open without layout, both via
   `replaceWorkspace`/`replaceWorkspaceSafely`) — called right after each
   function's own `loadWorkspace(ws)` call, with `ws.migrationWarnings`.
   Added in a review round (below) after this site's own status-line fold
   was mistaken for full coverage — it survives untouched (nothing later in
   either function writes `status`), but a status line alone is easy to
   miss on a large load, and every OTHER loader here already gets a toast
   too.

**Workbook-package decision (item 4, explicit):** `migrationWarnings` CAN be
non-empty for a workbook-transfer package — confirmed structurally, not
assumed: `parseTransferPackage` wraps the incoming `editableFigures` array
in a synthetic `.dwk` document and hands it to the SAME `parseWorkspace`
sanitizer a real project open uses, so an unsupported `FigureDocument`
version inside a pasted package hits the identical version-skip branch a
`.dwk` would (pinned by
`lib/workbookTransfer.test.ts`'s "surfaces migrationWarnings from an
unsupported FigureDocument version inside the package (BUG-010)"). It is
surfaced on Paste. It is deliberately NOT surfaced on `duplicateWorkbook`:
that path's `parseTransferPackage` call always round-trips figures read
straight from THIS session's own live `state.editableFigures`, which by
construction cannot hold a version-skipped figure (any such figure was
already skipped, with its own warning, at the ORIGINAL load that put it
into live state) — a structural, not a policy, non-goal, pinned by
`store/workbookTransfer.test.ts`'s "duplicate's own round trip never
carries a migration warning (structural, not a live path)".

#### Reproduction

- [x] Starting state and sample data identified — a saved `.dwk`/autosave/
  workbook package containing a `FigureDocument` with `version` greater
  than `FIGURE_DOCUMENT_VERSION`.
- [x] Exact actions recorded — the four load/merge paths above.
- [x] Actual result recorded (pre-fix) — no toast, no dialog; the status
  line either never carried the notice (sites 3-4) or carried it for a
  fraction of a `set()` call before being overwritten (sites 1-2).
- [x] Expected result recorded — see "Fix implemented" above.
- [x] Reproduced by an agent — one regression test per site (see below),
  each sabotage-verified: removing that site's `notifyMigrationWarnings`
  call (or, for site 4, reverting the dropped-field propagation) makes that
  site's new test fail — sites 1-3 fail exactly their own test; the site-4
  field sabotage fails two tests in two files (the `lib/` parse test and the
  `store/` paste test), as the first review round noted.

#### Investigation

- [x] Likely owning components/modules identified — the files named above,
  plus `lib/openWorkspaceReplace.ts` once the review round below found its
  gap.
- [x] Root cause confirmed rather than inferred — read every caller of
  `loadWorkspace`, `appendWorkspace`, and `parseTransferPackage` before
  writing the fix; confirmed `useApp.ts`'s status-line fold is the ONLY
  existing consumer of `migrationWarnings` anywhere in the frontend.
- [x] Related workflows and persistence paths checked — `LoadedWorkspace
  .migrationWarnings`'s own doc ("Load-time compatibility notices. Never
  serialized back into a .dwk.") is respected; nothing here changes what
  gets saved, only what gets told to the user at load/merge time.
- [x] Existing plan overlap reconciled — none found; this is a new entry.

#### Implementation

- [x] Minimal safe behavior defined — one shared, side-effect-only helper
  (`notifyMigrationWarnings`), a no-op on an empty array, called
  additively at each site; `useApp.ts` itself is untouched (kept under its
  own store-size ratchet — the helper lives in `store/toasts.ts`, the
  module every call site already imports `toast` from, not a new sibling
  module).
- [x] Failure and ambiguous-data behavior defined — unchanged; this only
  adds a NOTICE of an already-correct skip/degrade, never new fallback
  logic of its own.
- [x] Data integrity and backward compatibility considered — no persisted
  shape changes; `ParseTransferResult.migrationWarnings` (the field that
  carries a workbook-package parse's notices — see "Fix implemented" item
  4 above) is transient, mirroring `LoadedWorkspace.migrationWarnings`'s own
  "never serialized back" contract; `WorkbookTransferPackage` itself gained
  no field.
- [x] UI wording/tooltips/accessibility included where relevant — reuses
  the existing toast component/store (`store/toasts.ts`) verbatim; the
  message text is the warning's own text (already user-facing English),
  plus the same "(+N more)" count `useApp.ts` already used.

#### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward — one test
  per site, each independently sabotage-verified (see the commit body's
  sabotage table).
- [x] Relevant focused tests pass — `lib/applyRecoveryChoice.test.ts`,
  `useWorkspaceAutosave.test.ts`, `store/appendWorkbooks.test.ts`,
  `lib/workbookTransfer.test.ts`, `store/workbookTransfer.test.ts`,
  `architecture.test.ts` — 147 tests, all green. (The review round added
  `lib/openWorkspaceReplace.test.ts` and `store/toasts.test.ts` cases; see
  its own gate table below rather than this original count.)
- [x] Type-check/build/repository gates pass — `npx tsc -b --force`,
  `npx eslint src --max-warnings=0`, `npm run build` after `npm ci`,
  `uv run pytest -q tests/test_repo_integrity.py`. The full `npx vitest run`
  count recorded here at the original fix (10108/10109) and the count the
  commit body recorded (10116/10116) were BOTH stale — different snapshots
  of a moving suite, neither reproducible against this entry's own HEAD.
  Per agent_rules.md's "never estimate a number that will be recorded",
  this is not corrected in place; the review round below measured its own
  number fresh instead.
- [x] Agent verifies acceptance criteria — this entry.
- [ ] Owner verifies when required.

#### Completion record

- PR/commit: — (lands in the commit that adds this entry.)
- Automated tests: see "Tests and acceptance" above for the full file list;
  new tests are individually named in each file under a "(BUG-010)"
  suffix/comment.
- Agent verification: fix + sabotage-verified tests, this slice.
- Owner verification: —
- Notes: the `duplicateWorkbook` non-surfacing is a deliberate, structural
  non-goal (see "Workbook-package decision" above), not an oversight —
  pinned by its own test rather than left undocumented.


#### Evidence

Recounted at this entry's HEAD (a review round found the original cites had
drifted off by one or more lines — the fix's own inserted comments pushed
several of the statements they name a few lines further down — and one
symbol name, `parseWorkbookPackage`, was never a real export; the actual
function is `parseTransferPackage`):

- `frontend/src/store/useApp.ts:1431` (`migrationNotice` built),
  `frontend/src/store/useApp.ts:1565` (folded into `status` — the one path
  that worked pre-fix).
- `frontend/src/lib/applyRecoveryChoice.ts:29` (`loadWorkspace` call),
  `frontend/src/lib/applyRecoveryChoice.ts:36` (`setStatus` overwrite; cited
  line moved from the original finding's :34 once the fix's own
  `notifyMigrationWarnings` call and its preceding comment landed above it).
- `frontend/src/useWorkspaceAutosave.ts:422` (`loadWorkspace` call),
  `frontend/src/useWorkspaceAutosave.ts:427,434` (`setStatus` overwrites, one
  per branch; the second moved from :430 for the same reason as above).
- `frontend/src/store/workspaceIO.ts:448` (`runAppendWorkspace` definition),
  `frontend/src/store/workspaceIO.ts:468` (`status: msg` — unmoved by the
  fix, since its own `notifyMigrationWarnings` call lands AFTER this line).
- `frontend/src/lib/workbookTransfer.ts`'s `parseTransferPackage`: at the
  ORIGINAL finding, its internal `parseWorkspace(...)` call sat at line 288
  and the function read only `loaded.workbooks`/`loaded.datasets` off the
  result, never `loaded.migrationWarnings`. Both lines moved once the fix
  landed (the `parseWorkspace(...)` call is now at `:300`); the fix itself
  is what ADDED the previously-missing read, now `migrationWarnings: loaded
  .migrationWarnings` at `:323` — so, unlike the four cites above (which
  still describe standing gaps this fix closed elsewhere), this one now
  describes a gap the fix closed IN THIS SAME FILE, before the result ever
  reached `store/workbookTransfer.ts`'s `pasteWorkbookFromClipboard`
  (`:250`, see "Fix implemented" above).
- Agent verification: each call site read directly at the original finding;
  re-verified line-for-line against this entry's HEAD during the 2026-09-13
  review round below.
- Owner verification: — not required to confirm the gap (it is a static
  reachability fact), but the chosen delivery-channel shape is a product call.

#### Review round, 2026-09-13 (adversarial review of commit `762e00c1`)

The code fix was found correct and complete on every one of its four sites —
all sabotage-verified again, full suite green — but the review found the
PROSE around it inaccurate in several places, plus one real coverage gap:

1. **File ▸ Open never joined the toast channel.** `replaceWorkspace`/
   `replaceWorkspaceSafely` (`lib/openWorkspaceReplace.ts`) route every
   native/browser-picker open into `loadWorkspace`, whose own
   `migrationNotice` status-line fold survives there (nothing downstream
   overwrites `status`) — but no call to `notifyMigrationWarnings` existed
   on that path, so File ▸ Open was the one loader with a status line and
   no toast, contradicting the "that path now shows both" sentence this
   entry and the original commit body both made. Fixed: both functions now
   call `notifyMigrationWarnings(ws.migrationWarnings)` right after their
   own `loadWorkspace` call, the same "after the status fold" placement
   every other fixed site uses. Regression test:
   `lib/openWorkspaceReplace.test.ts`'s new "migrationWarnings join the
   toast channel (BUG-010 review F1)" describe block, asserting against the
   real `useToasts` store (not the mock the file already carries for its
   unrelated lock-registration assertions) — sabotage-verified (removing
   either call fails exactly its own test).
2. **Three sentences described a design that was never shipped.** The
   "Fix implemented"/"Implementation" sections above have been rewritten to
   say what actually landed: the `migrationWarnings` field for a workbook
   package lives on `ParseTransferResult`'s success variant (a sibling of
   `pkg`), the call site reads `parsed.migrationWarnings` (not
   `parsed.pkg.migrationWarnings`, and `WorkbookTransferPackage` gained no
   field), and the helper lives in `store/toasts.ts` (not a "sibling `lib/`
   module" — `useApp.ts`'s own store-size ratchet was never at stake since
   the helper was never a candidate for living inside `useApp.ts` itself).
3. **Every "Fix implemented" file:line citation was off by one, and one
   symbol name didn't exist.** `parseWorkbookPackage` is not a real export —
   the function is `parseTransferPackage`. The four call-site line numbers
   and several pre-fix "Evidence" citations have been recounted against
   this entry's HEAD (see "Fix implemented" and "Evidence" above for the
   corrected numbers and why each moved).
4. **The plan and the original commit body quoted two different, both
   stale, full-suite counts.** Measured fresh in this review round (see the
   gate table below) rather than repeated from either source.
5. **The `duplicateWorkbook` "pinned by its own test" claim couldn't
   actually fail.** The prior version of `store/workbookTransfer.test.ts`'s
   "duplicate's own round trip never carries a migration warning" test
   asserted the ABSENCE of a `notifyMigrationWarnings` call — true for every
   input, since `duplicateWorkbook` never calls that helper at all, so the
   assertion could not fail even if the structural claim behind it were
   false (confirmed: adding the call back left the suite green). The test
   now asserts the STRUCTURAL claim directly — `buildTransferPackage` +
   `parseTransferPackage` on a live workbook carrying a version-1
   `FigureDocument` yields `migrationWarnings === []` and a version rewritten
   to `FIGURE_DOCUMENT_VERSION` — and fails when that claim is sabotaged
   (verified: forcing the fixture's version to an unsupported value turns
   the assertion red).
6. **The toast on sites 1-2 is the ONLY surface, and used to self-dismiss in
   1.9 s.** On `applyRecoverAutosave` and the silent autosave restore, a
   later `setStatus` deliberately overwrites `loadWorkspace`'s status-line
   fold, so the toast is the one place "part of your saved document was
   dropped" is said at all — worth a longer look than the default `TOAST_TTL`
   gives. `notifyMigrationWarnings` (`store/toasts.ts`) now passes
   `{ ttlMs: TOAST_ACTION_TTL }` (6 s, not 1.9 s). `ToastKind` has no
   dedicated "warning" value (`"info" | "ok" | "danger"`); kept `"info"` —
   the same kind `useWorkspaceAutosave.ts`'s "Recovered … check your latest
   edits" toast already uses for an analogous "something was silently
   changed, go look" notice, since a migration warning is a successful load
   that dropped one degraded piece, not the outright failure `"danger"` is
   reserved for. Pinned by a new test in `store/toasts.test.ts`.
7. **The helper's own "one toast, never one per warning" and "(+N more)"
   rules had no direct test.** Every existing call-site test passed exactly
   one warning. `store/toasts.test.ts` now covers zero/one/many warnings
   directly against `notifyMigrationWarnings`.

Nits also addressed: the checklist's first fix-checklist box (previously
ticked against "a toast fired from inside `loadWorkspace` itself") reworded
to describe what shipped — a shared helper called explicitly at every
loader; a stray doubled blank line before `## New issue template` (merge
noise) removed.

Not addressed, and why: the ORIGINAL commit body (`762e00c1`) still carries a
stale bundle paragraph ahead of the orchestrator note that retracts it — a
past commit's message is frozen history; nothing a later commit does can
edit it, so this stays a known wrinkle in `git log` rather than something
"fixed" here.

**Gate (this review round, `frontend/`):**

| gate | result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `npx eslint src --max-warnings=0` | exit 0 |
| targeted vitest (`toasts.test.ts`, `openWorkspaceReplace.test.ts`, `workbookTransfer.test.ts` x2) | 74 passed, exit 0 |
| full `npx vitest run` | 636 files / 10424 tests (10422 passed, 2 expected-fail), 0 `FAIL` lines, exit 0 (720.6 s) — measured on the agent's pre-rebase tree (parent `384f2bc9`, lacking `48556a04`/`a99ebb6d`); the batch's final full run is recorded in the PR body |
| `npm run build` (eager JS) | 916,453 B vs 916,384 B at `HEAD~1` (`a99ebb6d`, this commit's real parent; the agent's report named `384f2bc9`, three commits back, which happens to measure the same 916,384 B) — +69 B, 3,947 B under the unmoved 920,400 B budget |
| `uv run pytest -q tests/test_repo_integrity.py` | 12 passed |

---

## BUG-011 — Pack Project can silently ship a lazy book's PREVIEW rows as the packed project's real data

**Priority:** P1 — this is the scientific-data-integrity bar this document's
priority key names explicitly ("P0: data loss or scientifically incorrect
result that can escape notice"; capped at P1 rather than P0 only because it
requires an in-progress lazy Origin import at the moment of packing, not the
common case). Pack Project is the mechanism for handing a portable, self-
contained project to someone else; if the payload it writes is a ~200-row
downsampled preview instead of the real book, the recipient has no way to
know their analysis is running on decimated data.

**State:** Fixed (commit pending merge), 2026-09-13.

**Reported:** 2026-09-13, by Claude, during adversarial review of the Group AF
`.dwk` load-path attempt above. Found by comparing `packProjectRun.ts`'s
serialization call against its two siblings that serialize a workspace for
export, not by a failing test.

**Investigated:** root cause confirmed by reading the code; not yet reproduced
end-to-end with a real pack run against a lazy book.

**Suggested implementation owner/model:** Unassigned.

**Related plan:** BUG-009 (the pending-dataset contract) above.

#### User-visible problem

`store/packProjectRun.ts`'s `serializeCurrentWorkspaceForPack` (lines 44-52) is
the content both the pack preview and the actual "Start pack" action send to
the backend's `pack_project`. It calls:

```ts
return serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
```

directly against the live `useApp` state `s`, with **no** call to
`resolvePendingDatasets()` anywhere in the function or the file (confirmed by
a whole-file search — the only `pending*` identifiers in `packProjectRun.ts`
are the unrelated `pendingTimer`/`pendingApply` poll-throttle variables). If
any dataset in the workspace is still `pending` (a lazy Origin book whose full
data hasn't been fetched yet — normal for a workbook the user hasn't opened),
`serializeWorkspace` writes that dataset's `d.data`, which **is the downsampled
preview** for as long as `pending` is set, into the packed payload — and writes
`pending` itself into it too, since nothing cleared it first.

This directly falsifies the comment `lib/workspaceSerialize.ts` carries about
its own `pending` field (lines 217-224): "an explicit 'Save workspace (.dwk)…'
resolves every pending dataset FIRST … so `d.pending` is never set in a real
exported .dwk — only autosave … can legitimately still have one." Pack Project
is a second explicit-export path that comment did not account for, and it does
not resolve first.

#### Root cause

- `store/workspaceIO.ts` line 73 (inside `prepareWorkspaceState`, the shared
  preface for Save and Save As) calls `await get().resolvePendingDatasets()`
  before serializing, and aborts the save with a status/toast if it fails.
- `store/workbookTransfer.ts` lines 189 and 254 (the two workbook-transfer
  export paths) likewise call `await get().resolvePendingDatasets()` before
  building their payload.
- `store/packProjectRun.ts`'s `serializeCurrentWorkspaceForPack` has no
  equivalent call. It is also **synchronous** (returns a `string`, not a
  `Promise`), which is itself evidence the resolve step was never wired in —
  `resolvePendingDatasets()` is async.

#### Fix checklist

- [x] `serializeCurrentWorkspaceForPack` now `await`s
  `useApp.getState().resolvePendingDatasets()` before `serializeWorkspace`,
  mirroring `workspaceIO.ts`'s `prepareWorkspaceState` (status line while it
  fetches included): `frontend/src/store/packProjectContent.ts:49-123`, resolve
  call at `:54`. It became `async` and now returns a `PackContent` result
  (`:28`) rather than a bare string, and BOTH callers were updated —
  `frontend/src/store/packProjectRun.ts:138` (the pack PREVIEW) and `:392`
  ("Start pack"). The store re-read after the `await` is deliberate and
  documented: `resolvePendingDatasets` replaces the dataset objects, so a
  snapshot taken before it would still be the preview-carrying one.
  (Line numbers current as of round 2, below — see that section's own
  recount; they move every time either function grows.)
- [x] Failure UX mirrors `workspaceIO.ts` lines 69-80: `refusePack`
  (`packProjectContent.ts:131-135`) sets the app status line, raises a
  `danger` toast, and puts the pack state machine into `failed` with a named
  `pending_unresolved` error — same sentence shape as the siblings
  (`workspaceIO.ts:75`, `store/workbookTransfer.ts:191`/`:262`; there is no
  shared helper to reuse, each spells it out inline). Both the preview
  (`packProjectRun.ts:144-147`) and Start-pack (`:399-402`) paths abort
  BEFORE any bridge call, so `NOTHING_MODIFIED_NOTE` holds literally.
  The message originally named only the operation and the underlying fetch
  error, not the book — review finding #5 pointed out that claim ("the
  siblings name the operation too") was only two-thirds true: two of the
  three sibling sites (`store/workbookTransfer.ts:191`/`:262`) DO name the
  workbook, only `workspaceIO.ts:75` doesn't. The round-2 fix below closes
  this for Pack Project in full — both the book's NAME and its RECORDED
  REASON now come from `lib/bookData.ts`'s `lastBookError`, exactly as
  `lib/workbookTransfer.ts:195-196` already does (round 1 only adopted the
  name half — see the round 2 section's finding #5).
- [x] `lib/workspaceSerialize.ts`'s `pending` comment corrected
  (`:217-257`, widened again in round 2 below): it now states that EVERY
  explicit export path resolves first and aborts on failure — Save/Save As,
  workbook Copy/Duplicate, and Pack Project — naming all three with
  file:line, and says outright that it previously named only the first and
  wrongly claimed autosave was the sole route. Autosave remains the one
  legitimate `pending` carrier.
- [x] Regression tests, `frontend/src/store/packProject.test.ts:734-903`
  (the original fix's 5 specs, all sabotage-verified — see the Completion
  record; round 2 recount below: this range moved from the round-1 review's
  own `:731-900` purely because a handful of lines were added ABOVE this
  block, in the shared test-hook imports, not inside it): the pack
  PREVIEW sends the FULL book with no `pending` field in the payload; a book
  that cannot be fetched refuses the preview by name with nothing sent to the
  bridge (`packPreview` mock asserted un-called) plus status + danger toast;
  the content reaching `pack_start` likewise carries the full book and no
  `pending`; "Start pack" resolves too, refusing with `pending_unresolved`
  (NOT `stale_preview`) for a book added after the preview whose source is
  gone, with `packStart` asserted un-called; and a cancel while the book
  fetch is in flight is not overwritten when that fetch fails late.

#### Evidence

- `frontend/src/store/packProjectRun.ts:44-52` (`serializeCurrentWorkspaceForPack`,
  no `resolvePendingDatasets` call; synchronous return type).
- `frontend/src/store/workspaceIO.ts:73` (`await get().resolvePendingDatasets()`
  inside `prepareWorkspaceState`, whose abort block is lines 69-80).
- `frontend/src/store/workbookTransfer.ts:189` and `:254` (the two sibling
  `await get().resolvePendingDatasets()` calls).
- `frontend/src/lib/workspaceSerialize.ts:217-224` (the comment this bug
  falsifies; now corrected in place at `:217-232`).
- Agent verification: read `packProjectRun.ts` in full, confirmed no
  `resolvePendingDatasets`/`pending` reference besides the unrelated poll
  timer names; compared against both sibling export paths that do call it.
  Not yet reproduced against a live backend pack run.
- Owner verification: — needed to confirm the severity call (P1 vs P2) and the
  chosen abort-vs-resolve UX before implementation.

#### Completion record

- PR/commit: the BUG-011 fix commit, 2026-09-13 (`fix(pack): Pack Project
  resolves pending datasets before serializing`).
- Automated tests: the 5 new specs in `frontend/src/store/packProject.test.ts`
  (file: 61 passing). Full frontend suite green: 634 files / 10,381 tests.
- Agent verification: every new spec sabotage-verified — removing the resolve
  call fails **5** specs, not the 4 originally reported here (correction,
  review round below): the four data/refusal specs PLUS "cancelling while
  the book fetch is in flight is not overwritten when that fetch fails
  late", which times out in `vi.waitFor` waiting for `phase === "scanning"`
  because no fetch is ever started once the resolve call itself is gone.
  Removing the preview abort fails only the preview-refusal spec; removing
  the Start-pack abort fails only the Start-pack refusal spec; removing the
  generation check added after the new `await` fails only the late-cancel
  spec. Source restored byte-identical after each round (`diff` clean).
- Structural note: the resolve step pushed `store/packProjectRun.ts` to 498
  lines against the 500-line `.ts` ceiling, so the cohesive workspace-CONTENT
  slice (`serializeCurrentWorkspaceForPack`, `refusePack`,
  `deriveProjectName`, `contentFingerprint`) was extracted to the new
  `store/packProjectContent.ts` — 424 and 97 lines respectively, no pin
  raised. It is reached only through the already-lazy `packProjectRun.ts`
  chunk, so the eager bundle is unchanged (916,182 B before and after,
  budget 920,400).
- Owner verification: still open — the severity call (P1 vs P2) and, now that
  the abort exists, whether "abort the whole pack" is the right product
  choice versus packing everything that IS resolvable and listing the dead
  books as blockers. The fix deliberately matches the sibling Save path
  rather than inventing a third behaviour.
- Not reproduced against a live backend pack run (the bridge is mocked, as it
  is for every spec in this file) — unchanged from the report.

#### Adversarial review round (2026-09-13)

An adversarial review of the fix commit above found 2 CONFIRMED code
findings (each with a failing probe), 3 doc findings, and 5 nits. This
follow-up commit closes:

- **Finding #1 (CONFIRMED):** `runStartPackProject`'s own book-resolve await
  had NO generation guard at all — the exact bug the pack PREVIEW path was
  already guarded against. A cancel/reset DURING "Start pack"'s resolve step
  was silently overwritten once the (now-stale) fetch settled: cancelling
  during a FAILING fetch flipped back to `failed` with a bogus danger toast
  after the user had already cancelled; during a SUCCEEDING fetch it could
  resurface as `stale_preview`. Closed by capturing `generation` (read only,
  never bumped — Start doesn't itself start or end an attempt) and
  `preview` before the await, then bailing if either changed
  (`store/packProjectRun.ts`'s `runStartPackProject`).
- **Nit 3 (folded into #1):** the phase guard alone could not stop a second
  "Pack Project" click during that same window (`phase` stays
  `awaiting_confirmation` until the resolve AND fingerprint checks both
  pass) — a pre-fix double click ran two concurrent attempts. Closed with an
  in-flight flag in `store/packProject.ts`, set before the lazy `import()`
  — deliberately NOT by moving `phase` to `packing` early, which would have
  rerouted Cancel through the backend `packCancel` call for a copy that was
  never actually started, with no poll loop yet running to resolve it.
- **Finding #2 (CONFIRMED):** `serializeCurrentWorkspaceForPack` re-read the
  store after `resolvePendingDatasets()` but never re-checked `pending` on
  it. `resolvePendingDatasets()` only awaits the books that were pending
  when IT was called, so a lazy import landing WHILE that `Promise.all` was
  still in flight was still serialized straight from its decimated preview
  rows plus a stray `pending` field — this bug's own payload, through a
  narrower window. Closed with a post-await re-check in
  `store/packProjectContent.ts` that refuses ("…a book was still loading")
  instead of serializing.
- **Finding #5 (naming the book):** the refusal named only the operation and
  the raw fetch error, never the book — the original Fix checklist's claim
  ("the siblings name the operation too") was only two-thirds true (two of
  the three sibling sites DO name the book). Closed: the `catch` in
  `serializeCurrentWorkspaceForPack` now looks up the failing book via
  `lib/bookData.ts`'s `lastBookError` (the same lookup
  `lib/workbookTransfer.ts:195-196` already uses) and includes its `.name`
  when a reason was actually recorded for it. (Round 2 finding #5, below:
  this only adopted the NAME half of that lookup — the reason quoted
  alongside it was still the raw thrown error, which could belong to a
  DIFFERENT book. Fixed in round 2, not here.)
- **Doc findings #3/#4:** the original sabotage table understated round 1
  (fails **5** specs, not 4 — corrected in the Completion record above,
  naming the fifth); two stale cross-references to `packProjectRun.ts` that
  should say `store/packProjectContent.ts` (`lib/workspaceSerialize.ts` and
  `store/packProject.ts`, the latter pre-dating this bug) are fixed.
- **Nit 1 (status):** the transient "fetching N books before packing…"
  status was never replaced on success; `serializeCurrentWorkspaceForPack`
  now sets a status once every requested book has actually arrived,
  mirroring the Save sibling's habit of always ending on a terminal status.
- **Nits 4/5:** the test line-range citation above corrected to `:731-894` —
  imperfectly: the review round below (finding 6) found the TRUE range at
  this commit was already `:731-900` (this commit's own 6-line addition to
  that block, missed) and, after round 2's own further additions, the
  Fix-checklist bullet above now cites the current `:734-903` (round 3 found
  this was still short by one — see that section below); the
  Active-queue Owner column set to "Claude (agent)"; the shadowing
  `type Set` alias in `packProjectContent.ts` renamed to `SetPack`.
- **Tests:** 4 new specs in `frontend/src/store/packProject.test.ts`, plus 2
  existing specs strengthened to actually assert the book name finding #5
  adds (their titles already claimed "by name" without checking it) — file
  now 65 passing (was 61). All new/strengthened assertions sabotage-verified
  (source restored byte-identical after each round — see the commit body's
  table).
- **Residual — NOT fixed here, and this claim was WRONG for two of its three
  sites** (out of scope: `store/workspaceIO.ts` and the other BUG-010 files
  are being edited concurrently for BUG-010): recorded here as the identical
  "re-read after resolve without re-checking `pending`" window that
  finding #2 closed for Pack Project still existing in `store/workspaceIO.ts`'s
  Save path (`:73-82`) AND in both `store/workbookTransfer.ts` export paths.
  **Round 2 correction:** the workbook-transfer half was false —
  both paths call `buildTransferPackage` (`lib/workbookTransfer.ts`) AFTER
  their own resolve await, and that function re-checks `pending` on the
  fresh state it receives and refuses if anything still is
  (`lib/workbookTransfer.ts:182-183`) — a re-check of its own, already
  closing this for workbook Copy/Duplicate. Only `store/workspaceIO.ts`'s
  Save/Save As path is genuinely still open. `lib/workspaceSerialize.ts`'s
  comment is narrowed accordingly in round 2, below.
- **Not attempted:** nit 2 ("Start pack's resolve can essentially never
  rescue a pack, only buy a better error code") and nit 6 (an unverifiable
  "pushed to 498 lines" claim in the Structural note above) needed no code
  change and are left as the review recorded them.
- **Bundle:** the nit-3 in-flight flag lives in `store/packProject.ts`,
  which is EAGER (unlike `packProjectRun.ts`/`packProjectContent.ts`, both
  reached only through the store's lazy `import()`), so it is the one part
  of this round's fix that could move the pin. Measured after `npm ci` and
  clearing `node_modules/.vite`: 916,182 B at this commit's parent ->
  916,197 B here, +15 B, 4,203 B under the unmoved 920,400 budget — nowhere
  near forcing a pin move either direction. **Round 2 correction:** the
  parent SHA this bullet named was an orphaned commit from a since-rewritten
  branch — reachable today only as `bc8f14fa`, two commits back — not this
  commit's real parent (`762e00c1`, per `git rev-parse <this commit>^`). The
  real parent measured 916,380 B, so the true delta was +4 B, not +15 B —
  see the round 2 section below for the full re-measurement.
- Owner verification: unchanged from the original fix — still open (the
  severity call and abort-vs-partial-pack choice).

#### Adversarial review round 2 (2026-09-13)

A second adversarial review of the round-1 review commit above (`384f2bc9`)
found one CONFIRMED code regression that round 1's own fix introduced (nit
3's in-flight flag had no escape hatch), one CONFIRMED code finding half-fixed
(finding #5 adopted only the book NAME, not its reason), one nit never
actually closed (N1's status line still lied), one FALSE residual claim
written into three places, and a set of stale file:line references — several
newly created by round 1's own edits. This follow-up commit closes:

- **`startInFlight` survives a fetch that never settles:** round 1's in-flight
  guard (nit 3, above) was cleared ONLY in `startPackProject`'s own `finally`
  — which never runs while the awaited `runStartPackProject(...)` call is
  still pending. `serializeCurrentWorkspaceForPack`'s book-resolve await has
  no timeout, so one hung `fetchBookData` pinned the guard true FOREVER: a
  reset, or a cancel, followed by a fresh preview could not recover Start
  pack for the rest of the session. Closed by clearing the flag directly and
  synchronously in both `resetPackProject` and `cancelPackProject`
  (`store/packProject.ts`), independent of whether the stuck fetch ever
  settles. A `resetStartInFlightForTests()` export mirrors
  `packProjectRun.ts`'s existing `resetGeneration`/`resetThrottle`/
  `resetPollSequencing` test-reset role, wired into this file's own
  `beforeEach`/`afterEach`.
- **The refusal's reason now stays paired with its own book:** round 1's
  finding #5 fix used `lastBookError` only to pick WHICH book to name, but
  still quoted the raw thrown `e` as the reason — so a still-pending dataset
  with a STALE recorded error (from an earlier attempt; a fetch failure never
  clears `pending`, and `lib/bookData.ts`'s `_bookErrors` is cleared only on
  success) could be named alongside a completely different book's error text,
  whenever it sorted earlier in `datasets` order than whichever book actually
  caused THIS rejection. Closed by taking the REASON from the same
  `lastBookError` lookup as the name, truncated via `truncateReason`, exactly
  mirroring `lib/workbookTransfer.ts:195-196` in full now, not half.
  `packProjectContent.ts` states inline that only the first failing book in
  `datasets` order is ever named, mirroring `lib/workbookTransfer.ts:184`'s
  own stated rule. The sibling refusal for "a book was still loading" (round
  1's finding #2 fix) is named too now (nit 5) — the datum was already
  sitting in that branch's own predicate.
- **N1 actually closed:** the status line no longer reads "…packing…" once
  the pack has actually left the in-flight state — the preview reaching
  `awaiting_confirmation` now sets a real "N dataset(s) ready — review the
  pack preview" status (nothing has been copied yet, so "packing" was never
  true there), and the Start path's poll loop reaching `completed` now sets
  a real outcome ("packed N dataset(s) to `<bundle_dir>`") via a new
  `notePackOutcome` export in `packProjectContent.ts` — kept there, not in
  `packProjectRun.ts`, so that module's own documented "never touches
  `useApp` directly" boundary holds. One spec per path, both sabotage-checked
  (deleting either `notePackOutcome` call fails its own spec, 0 others).
- **The FALSE residual claim, corrected:** round 1 recorded the "re-read
  after resolve without re-checking `pending`" window as still open on
  BOTH `store/workspaceIO.ts`'s Save path AND both `store/workbookTransfer.ts`
  export paths. The workbook half was wrong — both paths call
  `buildTransferPackage` (`lib/workbookTransfer.ts`) AFTER their own resolve
  await, and that function re-checks `pending` on the fresh state it
  receives and refuses if anything still is (`lib/workbookTransfer.ts:182-183`)
  — already closing this for workbook Copy/Duplicate. Narrowed in
  `lib/workspaceSerialize.ts`'s comment, this entry's own "Residual" bullet
  above, and the round-1 change-log row — only `store/workspaceIO.ts`'s
  Save/Save As path (`:73-82`) remains genuinely open. `store/workspaceIO.ts`,
  `store/workbookTransfer.ts`, `lib/workbookTransfer.ts`, and the other
  BUG-010 files were read-only for this fix — they are being edited
  concurrently for BUG-010.
- **Stale file:line references recounted:** every citation in this entry's
  Fix checklist above (`packProjectContent.ts`'s function/type/refusePack
  ranges, both callers in `packProjectRun.ts`, both abort blocks, the
  regression-test range) re-measured against this commit and corrected —
  several had drifted since round 1 added ~50 lines to `packProjectContent.ts`
  and ~24 to `packProjectRun.ts` without updating any of them. The regression
  spec range moved again, purely from lines added ABOVE it in this file's
  shared test hooks, not inside the block itself.
- **Nits fixed:** the nonexistent `packProjectContent.test` mention in
  `packProject.test.ts` (there is no such file; `packProjectContent.ts` is
  exercised only through this test file) rewritten; the spec titled "…is
  rejected by the phase guard…" renamed to name `startInFlight` as the actual
  mechanism (`phase` itself never moves during that window); the "N books
  loaded — packing…" status restored its count in the singular case
  (`"1 book loaded — packing…"`, not "book loaded — packing…").
- **Numbers re-measured against the REAL parent, `a99ebb6d`** (this commit's
  `HEAD~1` — the round-1 commit's own bundle bullet had named an orphaned SHA
  from a since-rewritten branch, reachable today only as `bc8f14fa`, not any
  ancestor of this work): scoped `packProject.test.ts` 70 passing (was 65, +5
  new specs); full `npx vitest run` 636 files / 10,433 passed + 2 expected
  fail (10,435), 0 `FAIL`; eager bundle 916,384 B (parent) -> 916,408 B (this
  commit), +24 B, 3,992 B under the unmoved 920,400 budget — nowhere near a
  pin move; `uv run pytest -q tests/test_repo_integrity.py` 12 passed
  (plans/ touched). **Round 3 correction:** rebase drift struck again after
  this — the work actually landed on top of `cccf70d1`
  (`git rev-parse 1aa8d4bd^` = `cccf70d1`, not `a99ebb6d`, which is merely an
  ancestor four commits back), so `916,384 B`/`916,408 B` above were real
  measurements of the WRONG tree. `cccf70d1` itself measures `916,453 B`
  (matching BUG-010's own entry/change-log row for that commit), so the
  correct pair is `916,453 B` (parent) -> `≈916,477 B` (this commit, the same
  `+24 B` delta) -> `≈3,923 B` headroom, not `3,992 B`. The `+24 B` delta and
  "nowhere near a pin move" conclusion are unaffected — see the round 3
  section below for the full account and this round's own (unrelated)
  numbers.
- **Not attempted:** round 1's own nit 2 ("Start pack's resolve can
  essentially never rescue a pack, only buy a better error code") and nit 6
  (the unverifiable "pushed to 498 lines" Structural-note claim) needed no
  code change in round 1 and still need none here — left as both rounds
  recorded them.
- Owner verification: unchanged — still open (the severity call and
  abort-vs-partial-pack choice).

#### Adversarial review round 3 (2026-09-13)

A third adversarial review of the round-2 fix commit (`1aa8d4bd`) found two
CONFIRMED code findings — one a genuinely NEW hole the round-2 fix itself
introduced, one a gap round 2's own doc-promise overclaimed — plus two doc
findings (a fifth recurrence of the wrong-parent-SHA mistake, and an
off-by-one spec-range citation) and six nits. This follow-up commit closes:

- **`startInFlight` is now attempt-scoped, not global (finding #1):** round
  2's fix cleared the guard synchronously from `resetPackProject`/
  `cancelPackProject`, closing "stuck forever" — but `startPackProject`'s own
  `finally` stayed UNCONDITIONAL, so a LATE-settling (not eternally hung)
  abandoned attempt's `finally` could clear a flag a NEWER attempt was
  currently holding through its own resolve window, reachable whenever a
  re-pending book resolves back to byte-identical content (a relink/re-fetch
  of an unchanged book — a real shape, not a contrived one). The reviewer
  drove this to two concurrent `packStart` calls. Closed with a `startEpoch`
  token in `store/packProject.ts`: every attempt captures the epoch when it
  takes the flag, `finally` only clears it if no reset/cancel/newer-start has
  bumped the epoch since, and `resetPackProject`/`cancelPackProject` (and the
  test-only `resetStartInFlightForTests`) bump it whenever they clear the
  flag. One probe reproduces the reviewer's exact repro (an abandoned attempt
  settling late while a newer one is mid-resolve): exactly one `packStart`
  call, the extra click rejected.
- **`failed`/`cancelled` terminals also end on a real outcome, universally,
  not only for the two paths round 2 happened to catch (finding #2):**
  round 2's `notePackOutcome` closed the stale "…packing…"/"…review the pack
  preview" transient only for `awaiting_confirmation` and `completed` — every
  OTHER way this store reaches `failed` or `cancelled` (a backend failure
  reported through polling, a cancel actioned before packing ever starts, a
  stale-preview or bridge-unavailable failure inside "Start pack" itself)
  left whichever status line was already standing uncorrected. Closed in
  full, not narrowed: two small choke-point helpers in
  `store/packProjectRun.ts` (`noteFailed`/`noteCancelled`) now sit behind
  EVERY `failed`/`cancelled` transition in that file, including `pollOnce`'s
  own poll-driven ones and `cancelPackProject`'s pre-packing direct branch
  (which never goes through polling at all). Three new specs: a poll-driven
  `failed` (asserts the actual error text, not a stale transient), a
  poll-driven `cancelled`, and cancelling before packing starts (the direct
  branch, no poll involved).
- **The recorded parent SHA, fifth recurrence — this time genuine rebase
  drift, not mis-naming:** round 2's own "measured against the real parent"
  correction was itself measured against `a99ebb6d`, an ancestor four commits
  back, not `1aa8d4bd`'s actual `HEAD~1` (`cccf70d1`) — the work was rebased
  onto more commits after being measured. Corrected in place above: the
  round-2 bundle bullet, and the change-log row below. This round's own
  numbers are measured the way `agent_rules.md`'s standing rule requires —
  `git rev-parse HEAD~1` printed AFTER committing, not before.
- **Spec-range off-by-one, same class round 2 was itself correcting:** the
  Fix-checklist bullet's `:734-902` was one line short of the block's actual
  close (`:903`) — recounted and corrected to `:734-903` in both places it
  appeared in this entry.
- **Nits:** `lib/bookData.ts`'s `truncateReason` docstring updated to name
  its new third consumer (`store/packProjectContent.ts`, added when BUG-011
  first landed but never folded into that comment); the stale "next describe
  block below" cross-reference in `packProject.test.ts` renamed to say which
  block; the two round-2 status specs (preview-ready, completed) now use a
  non-zero, non-one `summary.datasets` count each (2 and 1) so the assertions
  actually pin the "N dataset(s)" text and both the singular and plural
  branches, rather than passing on `toContain("review the pack preview")`
  alone against a manifest whose count was 0; one clarifying clause added to
  `packProjectContent.ts`'s refusal comment about the named book potentially
  being merely slow rather than the actual cause (nit 5) — narrowing that
  fully is left as an explicit owner call, not folded in here. **Not
  attempted:** the previous round's own ceiling-number nit (`wc -l` vs
  `split("\n").length` in a commit body, a historical citation with nothing
  live to fix) and the `pollOnce` ordering nit (`notePackOutcome` firing
  synchronously while the matching `phase`/`resultPath` `set` goes through
  the 200ms throttle) — cosmetic, unexercised by any spec, and out of scope
  for this round's four findings.
- **Numbers, measured against this commit's REAL parent** (`git rev-parse
  HEAD~1`, printed after committing) **= `26869ddb`** (an unrelated
  `fix(export)` commit — this round's own worktree branched directly from
  it, so no rebase drift is possible here): `packProject.test.ts` scoped run
  clean; full `npx vitest run` not re-run this round (the machine was
  contended) — the last verified full-suite count remains the reviewer's own
  measurement at `1aa8d4bd`, **636 files / 10,444 passed + 2 expected fail
  (10,446)**, 0 `FAIL`; `tsc -b --force`/`eslint --max-warnings=0` clean;
  `npm run build` clean after `rm -rf node_modules/.vite`, eager bundle
  **916,466 B at `26869ddb` (parent) -> 916,466 B here, +0 B** — neither file
  this round's fix actually changes is eager: `store/packProject.ts` (the
  F1 fix) turned out to already be reached only through the lazy
  `PackProjectPanel` chunk, not the entry script or modulepreload list (grep
  of `index.html` confirms `packProject-*.js` is absent from both), and
  `store/packProjectRun.ts`/`store/packProjectContent.ts` (the F2 fix) are
  the already-lazy chunk documented at the top of this file; the
  `lib/bookData.ts` docstring edit is comment-only and is stripped by
  minification regardless. Verified by rebuilding `26869ddb` itself in a
  throwaway `git worktree add` (never `cp -r` a worktree) and diffing the
  entry chunk byte-for-byte against this commit's build: `514,175 B` in both,
  same value. `uv run pytest -q tests/test_repo_integrity.py` — 12 passed
  (plans/ touched).
- Owner verification: unchanged — still open (the severity call and
  abort-vs-partial-pack choice); nit 5's "named book may be merely slow"
  narrowing is a new, separate open judgment call from this round.

#### Residual closed (2026-09-13): Save/Save As now closes finding #2's window too

Round 1's Residual bullet and round 2's correction of it left one real gap
open: `store/workspaceIO.ts`'s `prepareWorkspaceState` — the shared preface
for Save and Save As — re-read the store after its own
`await get().resolvePendingDatasets()` but never re-checked `pending` on
that re-read, the identical window finding #2 closed for Pack Project. It
was left open at the time because `store/workspaceIO.ts` and the other
BUG-010 files were being edited concurrently for that bug; BUG-010 has
since landed and been through its own review round, so this follow-up
commit closes it:

- **The fix, mirroring `packProjectContent.ts`'s own post-await re-check
  verbatim:** `prepareWorkspaceState` (`frontend/src/store/workspaceIO.ts`)
  re-checks `s.datasets` for a still-`pending` entry right after the
  `const s = get();` re-read (resolve call `:73`, re-check `:81-96`) and
  refuses the save — `"couldn't load full data for every book: \"<name>\" was
  still loading"`, same status + danger-toast shape as the sibling
  fetch-failure `catch` immediately above it — rather than letting a book
  that turned pending DURING the resolve await reach `serializeWorkspace`
  with its downsampled preview rows (and a stray `pending` field). Both Save
  and Save As share this one preface function, so one fix closes it for
  both entry points, exactly like Pack Project's preview/Start-pack pair
  shared `serializeCurrentWorkspaceForPack`.
- **`lib/workspaceSerialize.ts`'s `pending` comment updated to say so:** the
  comment previously narrowed itself, twice, to name `store/workspaceIO.ts`
  as the one export path still carrying this window. It now states the
  guarantee holds on every explicit export path — Save, Save As, workbook
  Copy/Duplicate, and Pack Project all resolve pending datasets first AND
  refuse rather than serialize a book that turns pending again during that
  resolve.
- **Regression test:** `frontend/src/store/workspaceIO.test.ts`'s new
  `describe("BUG-011 residual — a book that goes pending DURING the resolve
  await (Save/Save As)")` — same shape as `packProject.test.ts`'s sibling
  spec for finding #2: a lazy book's fetch is held open, a second lazy book
  is added to the store while the first is still in flight, then the first
  resolves. Asserts the save is refused by name (`"book2.opj" was still
  loading"`), the danger toast carries the same text, `saveBlob` (the
  browser-download fallback this path exercises) is never called, and the
  book that turned pending is still `pending` afterwards (a `currentProject`
  assertion that could not fail was removed in the review round).
  Sabotage-verified: removing the re-check fails exactly this one new spec
  (41 other specs in the file untouched), restored byte-identical after.
- Scope: `store/workspaceIO.ts` and `lib/workspaceSerialize.ts` were the only
  files this residual named as open; `store/workbookTransfer.ts` and
  `lib/workbookTransfer.ts` were already closed (round 2's correction) and
  are untouched here.
- **Bundle:** measured against `2920e34a`, which the agent named as the
  parent; the commit's real parent on the branch is `dafaa333` (the PR #359
  merge, whose tree is identical — the review round corrected the SHA; sixth
  recurrence of the ancestor-vs-parent citation) — it builds to
  916,466 B eager (rebuilt in a throwaway `git worktree add` with its own
  `npm ci`, never a `cp -r` of a worktree), this commit to 916,645 B, +179 B,
  3,755 B under the unmoved 920,400 B budget.
- Owner verification: unchanged from the original fix and every review round
  since — still open (the severity call and abort-vs-partial-pack choice,
  and nit 5's "named book may be merely slow" narrowing from round 3). This
  residual closure is a code-verifiable fix, not a resolution of either
  open owner call.

---

## ~~BUG-012 — a saved figure's x-axis break reaches export/reopen but never renders on screen~~ **FIXED 2026-09-14**

**Priority:** P2 — the document and the export were correct and agreed with
each other; only the live canvas disagreed with both. No data was lost or
altered, but a user who reopened their own saved figure saw a plot that
silently stopped matching what they exported, with no indication anything was
wrong — exactly the kind of screen/export mismatch the P4.2 matrix exists to
catch.

**State:** FIXED 2026-09-14. `Stage/useEffectiveComposition`'s durable
fallback now derives the paneled break from the document's canonical
`plot.axisBreaks.x` through `lib/facet.durableComposition`, which wraps the
SAME `breakCompositionFromBreaks` builder the live `breakAtGaps` gesture
constructs its arrangement with — one construction site, so a reopened figure
cannot panel differently from the one the user drew. See the Completion
record.

**Reported:** 2026-09-14, by the P4.2 canonical regression matrix
(`1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`) — a design-time
finding from the matrix's structural comparison, not yet surfaced by a user
report.

**Investigated:** root cause confirmed by reading the composition/fallback
chain, not inferred — see Confirmed implementation evidence below.

**Suggested implementation owner/model:** Claude (agent) — fixed 2026-09-14.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D1.

#### User-visible problem

A user draws an x-axis break on a plot (the store's `breakAtGaps` action),
saves the workspace, and reopens it (or exports the figure without
reopening). The `FigureDocument` faithfully carries the break —
`plot.axisBreaks.x` round-trips through save/reopen, and an export of that
document draws the break — but the on-screen canvas, after a reopen, renders
the series as one continuous, unbroken line. The exported figure and the
reopened document both say "this plot has a break here"; the screen the user
is actually looking at does not show one.

#### Confirmed implementation evidence (as filed — the state BEFORE the fix)

- `frontend/src/lib/figureDocument.ts:44`, `:179-182`, `:295`, `:426` —
  `FigureDocument.plot.axisBreaks` (`{x, y, y2}`) is the canonical, persisted
  home for break ranges; `axisBreaks.x` round-trips through
  `createFigureDocument` and the parse/validate path (`axisBreaks()` at
  `:295`, consumed at `:426`) unchanged.
- `frontend/src/lib/figureSpec.ts:376` — `buildFigureSpecFromDocument` reads
  `document.plot.axisBreaks.x` into `extras.xBreaks`, and `:177` folds it into
  `overrides.x_breaks` on the wire `FigureSpec` — every export of a document
  with a break draws it.
- `frontend/src/store/useApp.ts:539`, `:1359-1390` — the ONLY code path that
  ever makes the CANVAS draw a break is the `breakAtGaps` store action, which
  builds a transient panel arrangement held in `AppState.composition`
  (`store/useApp.ts:371`) — a live-session render cache, not a field on
  `FigureDocument` and never persisted.
- `frontend/src/components/Stage/useEffectiveComposition.ts:33-41` — the ONE
  hook `PlotStage.tsx` (`:135`) and `MultiPanelStage.tsx` read for "what
  panels are actually showing." Its own header explains the fallback
  contract: when the transient `composition` is `null` — exactly the state
  right after a workspace reopen, since `composition` is never serialized —
  it falls back to `facetCompositionFromBinding(active, facetKey, xKey,
  yKeys)`, a DURABLE fallback keyed on `facetKey` only. There is no
  equivalent durable fallback keyed on `document.plot.axisBreaks.x`, so a
  reopened document with a break renders as an ordinary, unbroken single
  panel until the user re-applies `breakAtGaps` by hand.
- Test: `frontend/src/lib/regressionMatrix.test.ts:318`,
  `it("DIVERGENCE (BUG-012): a saved x-break reaches export and reopen; the
  screen has no field to render it from", ...)` — pins BOTH measured values
  (export `[[2, 3]]`, reopen `[[2, 3]]`, screen `[]`) and asserts they
  differ, plus the underlying reason: rebuilding the document from
  `figureDocumentToPlotView(figure)` — the canvas's ENTIRE input — yields
  `plot.axisBreaks.x: []`, so `PlotView` cannot carry the break at all.
  (Converted 2026-09-14 from a bare `it.fails`, which passed on any throw and
  so could have gone green for the wrong reason.) The surrounding matrix's
  own narrowed-equality table (`regressionMatrix.test.ts:108-110`,
  `DIVERGENT.break`, `legs: ["export", "reopen"]`) exists specifically to
  carve this field out of the main screen≡export/reopen assertions so the
  divergence stays visible rather than silently passing.

#### Why this priority

P2 as filed. The evidence supports keeping it there rather than raising to
P1/P0: nothing is corrupted (the document and export both hold the correct,
complete break data — `axisBreaks.x` is never lost, only unrendered), and the
mismatch has a workaround (re-apply `breakAtGaps` after every reopen).
Priority is capped below P1 because a break is a presentation aid, not a
value the analysis reads — but the fact that this happens on EVERY reopen of
EVERY document with a break, unconditionally and with no error or notice,
argues for keeping it toward the upper end of P2 rather than P3.

#### Reproduction checklist

- [x] Starting state and sample data identified — the `break` fixture in
  `frontend/src/lib/regressionMatrixFixtures.testkit.ts` (a `FigureDocument`
  with `plot.axisBreaks.x: [[2, 3]]`).
- [x] Exact actions recorded — reopen (`reopenProject`) or export
  (`projectExport`) a document carrying `plot.axisBreaks.x`, then compare
  against the live screen projection (`projectScreen`).
- [x] Actual result recorded — export and reopen both carry
  `xBreaks: [[2, 3]]`; the screen projection carries `xBreaks: []`.
- [x] Expected result recorded — the screen should render the same break the
  document persists and the export draws.
- [x] Reproduced by an agent —
  `frontend/src/lib/regressionMatrix.test.ts`'s
  `it("DIVERGENCE (BUG-012): a saved x-break reaches export and reopen; the
  screen has no field to render it from", ...)`.

#### Fix checklist

- [x] Give `useEffectiveComposition`'s durable fallback a break-aware branch
  (an `axisBreaks`-driven composition builder analogous to
  `facetCompositionFromBinding`), or otherwise make a reopened document
  re-derive the same panel arrangement `breakAtGaps` would have produced live.
  **Done:** `lib/facet.breakCompositionFromBreaks` is that builder and is the
  ONE construction site — `store/useApp.ts`'s `breakAtGaps` builds its live
  arrangement with it too (net-zero lines; that file sits on its size pin) —
  and `lib/facet.durableComposition` wraps it together with the facet fallback
  so the PRECEDENCE has a single definition as well. No new persisted field:
  the ranges are read from the canonical `plot.axisBreaks.x` the export path
  already uses.
- [x] Confirm `MultiPanelStage.tsx`'s panel-break render path can consume
  that fallback exactly as it consumes a freshly-applied `breakAtGaps`
  composition — no separate render branch. **Done** — it consumes the
  `Composition` prop, so one break-mode branch renders both; pinned at the DOM
  layer by `MultiPanelStage.test.tsx`'s "renders one uPlot per segment from
  the document alone, with no live gesture". One gate change was required: the
  mount predicate (now the shared `multiPanelShowing`, which
  `useLiveSnapshotPublish`'s `altModeShowing` also calls instead of restating
  it) treats a break arrangement as its own explicit intent, because an
  AUTHORED break has no `stackMode` toggle to restore the way the
  `breakAtGaps` gesture does.
- [x] Add a regression test at the DOM/render layer (not only the structural
  payload) that a workspace SAVE → RELOAD round-trip shows the break on
  screen, per this repo's "test at the layer the user experiences" discipline.
  **Done** — the DOM case above renders the real component through the real
  hook from a reopened-shaped store and asserts each panel's x SLICE, not just
  the panel count (the plain per-channel stack would also make two).
- [x] INVERT the divergence assertion in `regressionMatrix.test.ts` — it is
  now `it("BUG-012: a saved x-break reaches export, reopen AND the screen it
  is drawn on", ...)`, asserting `projectScreen(...).xBreaks` equals both
  other legs' `[[2, 3]]`. The screen leg MEASURES that value from the panel
  geometry the shared derivation produces (`screenXBreaks`), so the equality
  is still evidence about the product; the `PlotView`-cannot-carry-a-break
  pins are kept, because that is still true and is exactly why the fix reads
  the document instead.
- [x] Drop the `break` fixture's `DIVERGENT` narrowing — done; `break` now
  compares field-for-field like `plain`, and its committed golden gained
  `"xBreaks": [[2, 3]]` — the only golden that changed, every other one
  byte-identical after a full regeneration.

#### Acceptance criteria

- [x] A figure with a saved x-axis break renders the break on screen
  immediately after a workspace reopen, with no user action required.
- [x] `projectScreen(document, dataset).xBreaks` equals
  `projectExport(document, dataset).xBreaks` for the `break` fixture — the
  equality BUG-012's divergence test is inverted into.
- [x] The fix does not change `breakAtGaps`'s existing live-session
  behavior — applying a break interactively during the same session still
  works exactly as before: the action's own store tests are unchanged and
  green, the live `composition` still wins over both durable bindings (pinned
  by a test), and the shared builder keeps the action's "fewer than two panels
  is not a break" refusal.

#### Completion record

- Date: 2026-09-14
- PR/commit: `fix(stage): BUG-012 …` on `claude/repo-evaluation-l7y7k9`
  (parent `b749f804` — the cherry-pick's real parent on this branch; the
  originally-recorded `45f43070` was stale), followed by
  `fix(stage): BUG-012 review round …` (2026-09-15, the entry below).
- Bundle: eager JS 910,263 → 910,547 B against a 920,400 B budget, measured
  on this branch (`b749f804` → the BUG-012 commit). The commit message's own
  `919,781 → 920,078` pair was measured on the pre-cherry-pick `45f43070` and
  does not describe this branch.
- Code: `lib/facet.ts` (`breakCompositionFromBreaks`, `durableComposition`),
  `components/Stage/useEffectiveComposition.ts` (the durable fallback plus the
  shared `multiPanelShowing` mount predicate),
  `components/Stage/PlotStage.tsx` and
  `components/Stage/useLiveSnapshotPublish.ts` (both now ask that ONE
  predicate, and PlotStage threads the ONE composition instead of two panel
  arrays), `store/useApp.ts` (`breakAtGaps` builds through the shared builder,
  net-zero lines), `lib/regressionMatrixLegs.testkit.ts` (the screen leg
  measures its breaks off the rendered arrangement).
- Automated tests: `components/Stage/useEffectiveComposition.test.tsx` (new —
  fallback, drift guard against the live gesture, precedence, no-break
  document, the two-panel refusal, and the mount predicate),
  `components/Stage/MultiPanelStage.test.tsx` (new DOM case),
  `store/plotRecipes.test.ts` (new — a recipe's captured break ranges rebuild
  panels end to end), `lib/regressionMatrix.test.ts` (divergence inverted,
  narrowing dropped), plus the regenerated `break.json` golden.
- Agent verification: `tsc -b --force`, `eslint src --max-warnings=0`, and
  `vitest run src/lib src/store src/components/Stage src/architecture.test.ts`
  all green; every new test sabotage-verified (remove the break fallback → the
  hook, DOM and matrix tests all fail; make the live gesture's build drift
  from the shared builder → the drift guard fails, **and so do three
  `store/useApp.test.ts` cases** in the `useApp breakAtGaps (gap #21 last
  residual)` block — "auto-detects the gap, builds paneled segments, activates
  the dataset, and turns on stack mode", "honors row exclusion (guard #11) —
  an excluded row never enters a break panel" and "accepts an explicit breaks
  override instead of auto-detecting". The original record said "only the
  drift guard", which the 2026-09-15 review round re-measured as wrong (4
  failures, not 1); drop the break clause
  from the mount predicate → only the mount test fails; flip the facet/break
  precedence → only the precedence test fails).
- Owner verification: open — a real reopened figure on screen.
- Notes: PRECEDENCE, defined and tested: when a figure carries BOTH a facet
  binding and saved breaks, the facet grid wins — mirroring the export path,
  where `routes/export_figures.py` branches on `if req.facets:` before the
  flat renderer is reached and `calc/figure_facets.render_facets_figure`
  honors a narrow override subset that excludes `x_breaks`. Also worth
  recording: the live `breakAtGaps` gesture writes NO durable field of its own
  (it only sets the transient `composition`), so the break this fix restores
  is always an AUTHORED one — the Figure Builder's breaks panel or a plot
  recipe, the only writers of `plot.axisBreaks.x`. The report's narrative of a
  `breakAtGaps` gesture surviving save/reopen was therefore never reachable;
  everything else in it reproduced exactly.

#### Review round — 2026-09-16 (`fix(stage): BUG-012 review round …`, committed 00:18 UTC)

An adversarial review of the fix commit confirmed the derivation and the
shared-builder claim but found four behaviour defects and one coverage hole
riding on top, all closed in `fix(stage): BUG-012 review round …`:

- **F2 — screen and export elided DIFFERENT x-ranges** whenever the authored
  break endpoints were not sample points. `lib/facet.breakPayloads` sized each
  panel from the segment's own data extent; the export
  (`calc/figure_break.render_breaks_impl`) sizes it from the BREAK BOUNDS
  (`bounds`: data min → `b0`, `b1` → next `b0`, … → data max) and sets its
  `width_ratios` from them. Measured on x = 0..5 with `axisBreaks.x =
  [[2.2, 2.8]]`: screen panels `[0, 2]` / `[3, 5]` (elides `(2, 3)`, widths
  2 : 2) vs export `[0, 2.2]` / `[2.8, 5]` (elides `(2.2, 2.8)`, widths
  2.2 : 2.2). `BreakPanel.xRange` is now `[max(segment lo, data min),
  min(segment hi, data max)]` — the same list, by construction. A **no-op for
  every `suggestBreaks` output** (`[finite[i], finite[i + 1]]`, both endpoints
  data points), so the live `breakAtGaps` gesture's panels are unchanged;
  pinned by `facet.test.ts`'s "is a NO-OP for suggestBreaks' own output".
- **F3 — the stack toggle could no longer switch an authored break off.**
  `setStackMode(false)` cleared `composition` and `facetKey`, but the durable
  fallback rebuilt the panels from `plot.axisBreaks.x` on the very next
  render, so the control was inert and silently so. It now also clears the
  FOCUSED document's `plot.axisBreaks.x` through the declared write chokepoint
  (`store/windowDocuments.clearFocusedXBreaks` →
  `withPlotWindowDocument`). A user action deleting a field; the persisted
  `.dwk` contract for `plot.axisBreaks` is untouched.
- **F4 — a stale break panelled a DIFFERENT dataset after a plain Library
  click.** `createPlotWindowDocument` inherited `previous.plot.axisBreaks`
  verbatim, while `datasetViewDefaults` nulls `facetKey` on a genuine switch
  precisely because a channel-indexed binding cannot carry across datasets.
  Measured: window on d1 with `[[2, 3]]`, `setActive("d3")` (unrelated, same
  x range) → the stage panelled d3 at d1's gap, no gesture, no toggle. The two
  genuine-dataset-switch rebind sites now pass `resetAxisBreaks`
  (`focusedRebindPatch`, gated on the same `s.activeId !== id` test its
  `viewPatch` uses, and `rebindWindow`'s background branch); re-activating the
  already-active dataset keeps the break, as `breakAtGaps`' own trailing
  `setActive` requires.
- **F5 — background windows still drew a reopened break as one line.**
  `BackgroundPlotWindow` built only the FACET half of the fallback and kept a
  local `stackMode &&` gate with no break clause, so a workspace reopened with
  several break figures showed the break in the focused window and BUG-012's
  original symptom in every other one. It now derives through the shared
  `durableComposition` and mounts through the shared `multiPanelShowing`.
- **F1 — the hook's channel wiring was unpinned.** Every BUG-012 test ran
  against a single-channel dataset with `xKey: null, yKeys: null`, so dropping
  either from the hook's `durableComposition` call was invisible (measured:
  both sabotages left the whole BUG-012 test set green). The fixture is now
  two-channel with `xKey: 0, yKeys: [1, 0]`.

Also closed in the same commit: direct unit coverage for both durable builders
and the F2 cases in `lib/facet.test.ts` (there was none — they were reached
only through the Stage hook, the DOM case and the matrix testkit); an
`architecture.test.ts`-style ratchet, kept in `lib/facet.test.ts`, that
`breakComposition(` is called from `lib/facet.ts` only (the "ONE construction
site" invariant was a convention — reintroducing a second identical builder
left 1236/1236 tests green); a facet+break assertion on the EXPORT leg, which
needed the matrix's export leg to model `routes/export_figures.py`'s
`if req.facets:` branch (the wire carries `x_breaks` for a faceted figure but
`calc/figure_facets` applies only `lim_keys=("x_lim",)`, so reading the field
raw claimed a break the renderer never draws); `breakAtGaps` computing
`analysisData(ds)` once instead of twice (via `breakCompositionFromData`); a
self-test for the now-unreachable `DIVERGENT`/`without()` narrowing machinery,
which is KEPT rather than deleted so the next divergence has one documented
place to be recorded; and the matrix header/describe-title drift about which
divergences are fixed.

**Residuals (measured, deliberately not fixed here):**

- **Row exclusion can drop the SCREEN break while the export keeps it.**
  `breakCompositionFromBreaks` refuses fewer than two surviving panels —
  `breakAtGaps`' own refusal, and the right screen behaviour — but
  `lib/figureSpec.ts:189-191` (`:177` when this was written; the emission
  moved) sends `overrides.x_breaks` whenever the document carries any, with
  no equivalent test. Measured: excluding every row above
  the break collapses the screen to an ordinary plot while an export of the
  same document still draws a broken axis. Pinned as behaviour (not as a
  divergence) by `facet.test.ts`'s "honors row exclusion (analysisData)". A
  real fix belongs on the export side (`figureSpec`/the renderer), not here.
- **⊞ "snapshot to new window" is a silent no-op for a reopened break
  figure.** `altModeShowing` is true for any break composition, so
  `publishLivePlotSnapshot(null)` runs and `snapshotToNewWindow()` returns
  without a toast. Identical to facet, per-channel stack, polar and stat —
  none is snapshottable, because the frozen-XY snapshot kind cannot represent
  a multi-panel canvas — so this is correct for what is on screen; it is only
  a NEW class of figure reaching it. A fix is a new snapshot kind, not a line.

#### Round 3 — 2026-09-17 (`fix(stage): BUG-012 round 3 …`)

A second adversarial review of the review commit confirmed F1-F5 and their
sabotage pins, and found three defects riding on the fix plus two
claim-vs-code mismatches. All closed in one commit:

- **The IMPORT path never got F4's reset — there were THREE genuine-switch
  rebind sites, not two.** `store/windowDocuments.rebindFocusedPlotWindow`
  (called only by `addDataset`, `store/useApp.ts`'s single entry point for
  import/paste/demo/merge/append) rebinds the FOCUSED window to a brand-new
  dataset and applies the same `datasetViewDefaults` that nulls `facetKey`,
  but never received `resetAxisBreaks`. Measured on this tree with the
  one-line fix reverted: a window on d1 with `[[2, 3]]`, then
  `addDataset(d2)` over an overlapping x range → the document kept
  `[[2, 3]]`, the durable fallback built panels `[[0, 2], [3, 5]]` and
  `multiPanelShowing` was true, i.e. F4's exact symptom via
  File ▸ Import — the commonest way a new dataset reaches the focused window.
  The reset is UNCONDITIONAL there: the dataset was constructed moments ago
  and is not yet in the store, so it can never be the already-active one that
  `setActive` exempts. Pinned by `useEffectiveComposition.test.tsx`'s
  "F4 (import leg)" case, through the real store action.
- **Round-1 NIT 17's refactor lost the `!breaks?.length` short-circuit**, so
  `analysisData(dataset)` — `droppedRows` → `pruneExcluded`, a full copy of
  `time` + `values`, plus a Data Filter predicate scan when one is active —
  ran on the ORDINARY no-break path, on the focused Stage hook AND on every
  background plot window, for every plain XY figure. Measured on this tree
  (50 000 rows, one excluded row, no facet, no break, 100 calls): **561.2 ms
  without the guard, 0.0 ms with it** (0.2 ms vs 0.0 ms with no exclusions).
  The guard is restored in `lib/facet.breakCompositionFromBreaks`; the
  comment `BackgroundPlotWindow.tsx` had added in the same review round
  ("short-circuits before scanning any rows") is true again and now cites the
  test that keeps it true. Pinned as the load-INVARIANT property — a wrapped
  `analysisData` is asserted NOT to be called — not as a wall-clock bound.
- **Every `setStackMode` marked the project dirty and scheduled an
  autosave.** `clearFocusedXBreaks` returned `windows.map(…)`, and `map`
  always allocates, so `plotWindows` got a fresh identity on every toggle
  including the overwhelmingly common case where no window holds a break.
  `useWorkspaceAutosave.shouldAutosave` compares `plotWindows` by identity,
  so the toggle flipped the title bar's ● marker, restarted the 800 ms
  autosave debounce and re-rendered all four `plotWindows` subscribers. It
  now returns the SAME array when nothing changed, pinned by a `toBe` on
  `plotWindows` plus `shouldAutosave(after, before) === false`, with the
  converse (a real break DOES change both) pinned beside it.
- **`setStackMode(TRUE)` clears the authored break as well — deliberate, and
  now stated and tested.** The review found the clear unconditional while
  every claim and test covered only `false`. Kept unconditional after
  reasoning from `useEffectiveComposition`'s own precedence:
  `multiPanelShowing` short-circuits on `breakPanelsOf(composition) !== null`
  ahead of every `stackMode` clause, so a break left in place would pre-empt
  the per-channel stack the user just asked for — the ON direction would be
  inert in precisely the way F3 fixed for OFF. It is also what the toggle's
  own comment already promised for every other arrangement ("a manual toggle
  (on OR off) always drops any spatial arrangement"), and it is symmetric
  with the `facetKey: null` on the same line. Undo restores it.
- **Claim narrowed: "screen ≡ export by construction" holds for in-extent,
  non-empty breaks only.** `BreakPanel.xRange`'s doc claimed its bounds were
  "exactly the `bounds` list the export renderer builds". Three shapes the
  wire accepts break that (see the new residual below); the doc now states
  the precondition and points at the residual.

Nits closed in the same commit: the test named "clamps a break endpoint that
sits outside the data range" used endpoints INSIDE it (it pins the ±Infinity
outer sentinels) — renamed, with a genuine out-of-range case added beside it;
`rebindWindow`'s background-branch reset, the one new behaviour of the review
round with no test at all (sabotaging it to `false` left the whole scope
green), now has two — including the same-dataset re-drop, which drops the
break deliberately because that branch re-applies `datasetViewDefaults`
wholesale and resets `facetKey` (the channel-keyed binding per-technique view
memory deliberately does not carry) with it; `xKey`/`yKeys` can instead come
back from that memory on a technique-tagged dataset, narrowed and pinned by
a third test after a round-3 review nit (NIT 1); the NIT-13
"one construction site" ratchet no longer fires on a mere COMMENT naming
`breakComposition(` (it strips comments first, with the corpus-safe
string-preserving single-pass form `architecture.test.ts` arrived at); and the
F5 DOM test asserts TWO uPlot instances INSIDE EACH window frame instead of a
total of four (a regression moving a panel between the windows would have
passed).

**Residuals added (measured, deliberately not fixed here):**

- **Three wire-valid break shapes draw differently on screen and on export.**
  `lib/facet.breakPayloads` drops a segment with no rows (`rows.length === 0`)
  and clamps each bound to the data extent; `calc/figure_break.py:85-91`
  builds `len(breaks) + 1` bounds unconditionally, sets `width_ratios =
  [max(hi - lo, 1e-9)]` and applies `ax.set_xlim(lo, hi)` with no clamp, and
  `calc/figure_overrides.py:63-76` rejects only `lo >= hi` and unsorted or
  overlapping pairs — never an out-of-range one. On x = 0..5: a break WHOLLY
  outside the data (`[[7, 8]]` or `[[-3, -2]]`) leaves one surviving panel, so
  the screen refuses the arrangement and draws an ordinary plot while the
  export draws 2 panels, one of them with an inverted `set_xlim`; an EMPTY
  middle segment (`[[1.2, 1.4], [1.6, 1.8]]`) is 2 screen panels (widths
  1.2 : 3.2) against 3 on export (1.2 : 0.2 : 3.2); an interior bound past the
  data max (`[[2, 3], [7, 8]]`) is 2 screen panels (2 : 2) against 3 on export
  (2 : 4 : 1e-9). Reachable in practice because the Figure Builder's breaks
  panel accepts any numbers (`workshops/figurebuilder/PropertyPanels.tsx:150-159` enforces only
  `from < to` and non-overlap against the breaks already authored) and `store/plotRecipeApply.ts` carries
  `visual.axisBreaks` onto a DIFFERENT dataset. Behaviour is unchanged from
  before BUG-012's fix — only the claim was new. The empty-middle-segment case
  is pinned by `lib/facet.test.ts`'s "DIVERGENCE (residual)" so it cannot
  change silently; a real fix is symmetry (drop empty-segment panels in
  `render_breaks_impl` too, or stop dropping them here).
- **A break authored while a facet binding exists is silently inert on BOTH
  legs, and skips wire validation.** Screen: `lib/facet.ts`'s
  `durableComposition` resolves `facet ?? break`. Export:
  `routes/export_figures.py:364`/`:440` branch on `if req.facets:` before the
  flat renderer, and `calc/figure_facets.py` never reads `x_breaks` (zero
  occurrences; its only two `break` mentions are a docstring contrasting the
  facet grid with `calc.figure_break`'s shared-y one, `:212-213`). So the two agree — but the Figure Builder's breaks panel still
  accepts and persists ranges that draw nothing anywhere, with no feedback,
  and `calc/figure_overrides._validate_overrides` never runs on the facet
  path, so an `x_breaks` pair that would 400 the flat export is accepted in
  silence. Precedence itself is correct and tested; this is the missing
  authoring feedback beside it.

**Round-3 verification:** `tsc -b --force`, `eslint src --max-warnings=0`,
`vitest run src/lib src/store src/components/Stage src/components/windows
src/architecture.test.ts`, `freeze-regression-matrix.mjs --check` and
`pytest -q tests/test_repo_integrity.py` all green; every new test
sabotage-verified. Eager bundle, both trees built after `npm ci`:
**913,293 B** at `e0ab164c` (the real parent — `git rev-parse HEAD^`;
`8a8d92b1` originally cited is five commits back, corrected 2026-09-17 round-3
review NIT 3) → **913,348 B** here, **+55 B**, 7,052 B inside the 920,400 B
budget. No budget move. `store/useApp.ts` (2322) and
`store/windows.ts` (749) stay at their exact ceiling pins — the round-2 commit
held them there by packing new arguments onto existing lines (up to ~220
characters); nothing enforces a line length (there is no eslint `max-len`
rule and no prettier gate), so this is a readability cost, not a rule
violation, and no pin was raised.

---

## ~~BUG-013 — a waterfall view's offset never reaches the export wire~~ **FIXED 2026-09-14**

**Priority:** P2 — a whole view TYPE mis-exports (overlaid instead of
staggered curves), with a workaround (manually offset before export, or
accept the wrong figure) but no data loss.

**Reported:** 2026-09-14, by the P4.2 canonical regression matrix
(`1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`) — a design-time
finding from the matrix's structural comparison, not yet surfaced by a user
report.

**Investigated:** root cause confirmed by reading the compose pipeline and
the `FigureSpec` wire contract, not inferred — see Confirmed implementation
evidence below.

**Suggested implementation owner/model:** Unassigned.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D2.

#### User-visible problem

A user turns on a waterfall view (`view.waterfall`, a positive offset
fraction), which visibly staggers every series vertically on screen so
overlapping curves become readable. Exporting that same view — to PDF/SVG,
or via Copy figure — produces a figure with every series drawn at its
ORIGINAL, un-offset position: the export looks like the waterfall was never
applied, even though the screen the user is looking at clearly shows it.

#### Confirmed implementation evidence

*As filed (2026-09-14, before the fix) — kept verbatim as the record of what
was measured. Every line-numbered claim below describes the PRE-FIX tree; see
the Completion record for what the code does now.*

- `frontend/src/lib/plotdata.ts:364` (`DisplayCompose.waterfall: number`) and
  `:377-382` (`composeDisplayPayload`) — the FIRST step of the canonical
  on-screen compose pipeline is `applyWaterfall(payload, o.waterfall)`
  (`:521`, "Vertically offset each series for a waterfall view"), so every
  on-screen render of a waterfall view is offset before anything else runs.
- `frontend/src/lib/api/figures.ts` — the `FigureSpec` interface (`:43` on,
  the wire contract every export/reopen path serializes to) has no
  `waterfall` field anywhere; a whole-file grep finds exactly one `waterfall`
  mention (`:117`), an unrelated comment about a still-unbuilt 2-D/
  heatmap/surface figure type.
- `frontend/src/lib/figureSpec.ts` (`buildFigureSpecForView`, lines 136-395 —
  the ONE function every export path routes through, per the module's own
  header) never reads or applies `st.waterfall` anywhere in its body —
  confirmed by grep, zero `waterfall` references in the file.
- Test: `frontend/src/lib/regressionMatrix.test.ts:347`,
  `it("DIVERGENCE (BUG-013): the canvas offsets a waterfall by 0.8125; the
  export wire has no waterfall field at all", ...)` — pins BOTH measured
  values (screen `0.8125`, export `0`) and asserts they differ, plus the
  wire-level reason: `buildFigureSpecFromDocument`'s spec has no key matching
  `/water|offset|stagger/i` and `spec.dataset.values[1][1]` is the raw,
  un-offset `2.25`. (Converted 2026-09-14 from a bare `it.fails`.)
  The matrix's own `DIVERGENT.waterfall` table entry
  (`regressionMatrix.test.ts:108-110`, `legs: ["export"]`) exempts ONLY the
  export leg — reopen restores the raw `view.waterfall` fraction from the
  document and the canvas re-applies it identically, so it is specifically
  the wire spec sent to export that never carries the offset.

#### Why this priority

P2 as filed. Matches the evidence: this is substantial friction (an entire
view type exports wrong) with a workaround (manual offset, or accepting the
wrong exported figure), not data loss or a scientifically incorrect stored
value — the document and the live data are both untouched, only the exported
RENDERING is wrong.

#### Reproduction checklist

- [x] Starting state and sample data identified — the `waterfall` fixture in
  `frontend/src/lib/regressionMatrixFixtures.testkit.ts`, a `FigureDocument`
  whose `view.waterfall` is a positive fraction.
- [x] Exact actions recorded — export the document (`projectExport`) and
  compare its `waterfallOffset` to the live screen projection
  (`projectScreen`).
- [x] Actual result recorded — the screen's `waterfallOffset` is `0.8125`
  (`regressionMatrix.test.ts:221-223`); the exported `FigureSpec` carries no
  waterfall field at all, so `projectExport(...).waterfallOffset` is `0`.
- [x] Expected result recorded — the exported figure should offset each
  series by the same fraction the canvas shows.
- [x] Reproduced by an agent —
  `frontend/src/lib/regressionMatrix.test.ts`'s
  `it("DIVERGENCE (BUG-013): the canvas offsets a waterfall by 0.8125; the
  export wire has no waterfall field at all", ...)`.

#### Fix checklist

- [x] Decide where the offset should be applied for export — a THIRD shape,
  chosen over both options as filed: the wire carries `waterfall_offsets`, a
  per-plotted-series shift in Y DATA UNITS (not the raw fraction), resolved
  client-side and simply ADDED to each series by the backend. Rationale, in
  full, in `frontend/src/lib/waterfallOffset.ts`'s header: a server-side
  `fraction × y-range` cannot reproduce the canvas' number, because the range
  the canvas measures includes hidden series (filtered out of `y_keys`),
  excluded/filter-dropped rows (`applyWaterfall` runs BEFORE
  `maskExcludedPayload`, while `pruneToLiveDataset` strips them from the wire
  `dataset`) and, for a decimated fetch, extremes the wire never sees — so
  option (B)-style re-derivation would have re-opened this very divergence the
  moment a user hid a series. Pre-applying the offset to `dataset.values`
  (option A as filed) was rejected for the opposite reason: it lies on the
  wire. The chosen shape keeps `dataset` truthful and declares the offset
  beside it.
- [x] Whichever shape is chosen, use the SAME offset formula `applyWaterfall`
  uses — enforced by CONSTRUCTION, not by duplication: the span/step scan moved
  out of `applyWaterfall` into `lib/waterfallOffset.waterfallStep`, which both
  the canvas and the wire builder call. Per-series indices are the UNFILTERED
  display positions `lib/figureSpec.ts` already derives for BUG-015's colours.
- [x] Confirm reopen continues to round-trip `view.waterfall` unchanged — the
  reopen leg is untouched and `screen ≡ reopen` still passes for the fixture.
- [x] INVERT the divergence assertion in `regressionMatrix.test.ts` — now
  `it("BUG-013: the export wire carries the canvas' 0.8125 waterfall offset")`,
  a single `toBeCloseTo` equality plus the two honesty pins (the offset rides
  its own field; `spec.dataset.values[1][1]` is still the raw `2.25`).
- [x] Drop the `waterfall` fixture's export-only `DIVERGENT` narrowing — the
  table now lists `break` only.

#### Acceptance criteria

- [x] Exporting a waterfall view produces a PDF/SVG with each series
  visibly offset by the same amount the on-screen canvas shows —
  `tests/test_export_vector_structure.py`'s
  `test_waterfall_offsets_shift_each_series_by_its_own_amount` measures each
  series line's position in the RENDERED axes (hit-map pixel box converted
  back to data units) and finds the requested shift; its sibling
  `..._widen_the_autoscaled_axis_to_fit_the_stagger` proves the axis range
  grows to fit the offsets, as the canvas autoscale does.
- [x] `projectExport(document, dataset).waterfallOffset` equals
  `projectScreen(document, dataset).waterfallOffset` for the `waterfall`
  fixture — the equality BUG-013's divergence test is inverted into.
- [x] The reopen leg is unaffected —
  `projectReopen(...).waterfallOffset` continues to equal the screen's.

#### Completion record

- PR/commit: fixed 2026-09-14 on `claude/repo-evaluation-l7y7k9`, one commit
  `fix(export): BUG-013 — carry the waterfall stagger to the export wire`
  (`50b30a04`, parent `ff45a200` — corrected 2026-09-16, review NIT 7: the
  originally recorded `ebefa693` is the pre-cherry-pick commit and is not in
  this branch's history). Nine files:
  `frontend/src/lib/waterfallOffset.ts` (new — `waterfallStep` +
  `waterfallWire`), `lib/plotdata.ts` (`applyWaterfall` now calls the shared
  step; 11 lines freed, so the `architecture.test.ts` pin ratchets 658 → 650),
  `lib/figureSpec.ts` (+3 lines: the spread that emits the field),
  `lib/api/figures.ts` + `lib/figureContract.ts` (the wire field and its
  `derived("plot.waterfall.verticalOffset")` classification — the `satisfies
  FieldContractMap<FigureSpec>` guard forces every new spec field to be
  classified), `src/quantized/calc/plotting.py` (`apply_waterfall_offsets`),
  `src/quantized/routes/export_figures.py` (`FigureRequest.waterfall_offsets`,
  applied in the shared `_figure_series` — so `/figure`, `/figure-hitmap` and
  the page-panel route in `routes/export_page.py` all honour it), plus the
  regenerated `frontend/api/openapi.json` / `lib/api/schema.d.ts`.
- Automated tests: `frontend/src/lib/waterfallOffset.test.ts` (new, 9 tests —
  step math, canvas/wire agreement column by column, the four refusals, and
  the DISPLAY-position rule for a hidden series);
  `lib/figureSpec.test.ts`'s `FigureSpec waterfall_offsets (BUG-013)` block
  (7 tests, every expected number derived by RUNNING `applyWaterfall`, never
  hardcoded); `lib/regressionMatrix.test.ts`'s inverted
  `BUG-013: the export wire carries the canvas' 0.8125 waterfall offset` plus
  the now-unnarrowed `waterfall > screen ≡ export`;
  `tests/test_calc_plotting.py`'s four `apply_waterfall_offsets` tests,
  including `test_apply_waterfall_offsets_matches_the_canvas_golden` — the
  CROSS-LANGUAGE pin, whose dataset/offsets/shifted values are the same
  literals `waterfallOffset.test.ts` pins from the real canvas implementation,
  compared at 1e-12; `tests/test_export_vector_structure.py`'s four new
  route-level structural tests.
- Agent verification: sabotage table (mutation → tests that turned red):
  (1) `waterfallWire` returns `{}` unconditionally → 7 red, incl.
  `figureSpec.test.ts > … > emits the canvas' offset per plotted series`,
  `… > a HIDDEN series keeps its stagger slot`,
  `regressionMatrix.test.ts > … > waterfall > screen ≡ export` and the
  inverted BUG-013 pin, and 3 in `waterfallOffset.test.ts`;
  (2) `apply_waterfall_offsets` returns its input unchanged → 4 red
  (`test_apply_waterfall_offsets_matches_the_canvas_golden`,
  `…_degrades_on_a_short_or_bad_offset_list`,
  `test_waterfall_offsets_shift_each_series_by_its_own_amount`,
  `…_widen_the_autoscaled_axis_to_fit_the_stagger`);
  (3) the route passes `None` instead of `req.waterfall_offsets` → the two
  `test_export_vector_structure.py` waterfall tests red, proving the thin
  adapter itself is covered and not just `calc/`.
  Gate: `ruff check src tests tools` clean; `mypy src` clean (295 files);
  `pytest` — 62 passed across
  `test_export_vector_structure/test_calc_plotting/test_openapi_snapshot/test_repo_integrity`,
  324 passed + 1 skipped across
  `test_api_export/test_api_export_page/test_calc_figure/test_calc_figure_page`;
  `tsc -b --force` and `eslint src --max-warnings=0` clean;
  `vitest run src/lib src/architecture.test.ts` — 5221 passed, 0 failed;
  `node scripts/freeze-regression-matrix.mjs --check` clean and no committed
  golden changed (they are the SCREEN projection, which this fix does not
  touch). Eager bundle measured on a `npm ci`-fresh build of each tree, on the
  BRANCH (corrected 2026-09-16, review NIT 7 — the figures first recorded here
  were measured against `ebefa693`, an ancestor this branch does not contain):
  **919,693 B** at `ff45a200` → **919,877 B** at `50b30a04`, a **+184 B**
  delta, 523 B inside the then-current 920,400 B budget. No budget move.
- Owner verification: pending.
- Notes: two DOCUMENTED residuals, both inherited rather than introduced. A
  `group_col` request omits the field (the backend synthesizes one series per
  level, which does not align 1:1 with `y_keys` — the same reason
  `series_styles` is documented as unapplied there; see BUG-016), and a
  `facets` request omits it (that branch renders from its own resolved panel
  payloads, per `FigureRequest.facets`' own contract). Omitting is the honest
  response: the renderer never receives an offset it would mis-apply. Both
  combinations already export unstyled today. Also: the matrix's screen leg
  measures the offset of the second DISPLAYED series while the export leg
  reads the second PLOTTED one; the two index spaces coincide for every
  fixture (none both hides a series and sets a waterfall), and the export leg
  says so in place.

#### Review round — 2026-09-16 (`fix(export): BUG-013 review round …`)

An adversarial review of `50b30a04` returned **2 CONFIRMED, 1 CONFIRMED-narrow
and 5 NITs**. All eight are addressed here; three of them changed behaviour.

- **CONFIRMED 1 — offsets were emitted for `stackMode`/`polarMode`/`statMode`,
  where the canvas staggers nothing.** A regression this fix introduced, not an
  inherited residual: `PlotStage` early-returns to `MultiPanelStage`/
  `PolarStage`/`StatStage` before the XY overlay exists, and
  `useMultiPanelStage` never calls `composeDisplayPayload` at all, so a user who
  left the waterfall slider up and switched to stacked panels got an export
  staggered in a way the screen never was. Reproduced on BOTH entry points
  (`stackMode` is a canonical binding, so it round-trips through a document):
  offsets `[0, 74.75, 149.5]` for all three modes from `buildFigureSpec`, and
  the same list from `buildFigureSpecFromDocument`. `waterfallWire` now asks the
  predicate the canvases ask — `seriesStyleCycle.overlayModesMatchTheCanvas`,
  the view-mode half of `overlayExportsSeriesStyles`, split out so each clause
  still has exactly one definition. It subsumes the old hand-rolled `groupKey`/
  `facets` refusals.
  **Deliberate narrowing, against the review's suggested one-liner:** the
  waterfall asks the MODE half only, not `displayListsAgree`. That clause exists
  because the dash/marker/colour CYCLE is keyed by positions the two sides derive
  independently; the waterfall's positions are the ones BUG-014 already resolves
  against the canvas' own channel list, so folding it in would have exported the
  two real series of an X-as-Y view OVERLAID — re-opening this very bug for a
  view whose stagger is otherwise reproduced exactly. See finding 3.
- **CONFIRMED 2 — the step was resolved from the full dataset; the canvas
  resolves it from the fetched payload.** Fixed by the review's option (a), the
  "by construction" one, because the plumbing turned out to be cheap:
  `usePlotPayload` ALREADY returns the raw pre-compose `payload`
  (`PlotPayloadResult.payload`), so the focused Stage's own publish effect
  (`Stage/useLiveSnapshotPublish`, which already no-ops in the alternate render
  modes and clears on unmount) now also publishes that payload's y-span through a
  module-scope seam in `lib/waterfallOffset.ts` — the same imperative-ref shape
  `lib/plotsnapshot.ts` uses for the display bundle, keyed by dataset id so
  `exportActive`'s documented refocus race cannot stagger one dataset by
  another's span. `buildStageFigureSpec` reads it at command time and threads it
  through both branches. The SPAN travels rather than the step, so a request
  whose `waterfall` fraction differs from the live view's still scales the
  canvas' measured range correctly.
  Measured, driving the real hook with `fetchPlot` mocked at the network
  boundary (20 000 rows, excursion in rows `[0,100)`, `xLim [5000,6000]`,
  `waterfall 0.25`): screen shift **0.25**, export offset **0.25** on BOTH the
  live-view fallback and the canonical-document path. Before: 0.25 vs 495.25.
  **Option (b) — filtering the wire's rows to `st.xLim` — was NOT shipped, on
  either path, because it would create two NEW divergences.** The canvas windows
  its payload only when `shouldRefetchWindow(xLim, baseDecimated)` holds
  (`lib/plotDecimate.ts:383`), i.e. only for a SERVER-DECIMATED base: (i) a
  dataset under `DECIMATE_MIN_POINTS` with axis limits set keeps drawing from the
  full payload, so a windowed wire would disagree with it; and (ii)
  `components/windows/BackgroundPlotWindow.tsx:164-188` does not pass `xLim` to
  `usePlotPayload` at ALL, so a background window — and the Figure Builder
  window-target preview built from its document — never windows, and a windowed
  wire would disagree there too. `components/windows/PanelCell.tsx` likewise
  passes no `xLim`. Option (a) has no such blind spot: every canvas that exists
  publishes the span it actually measured.
  The commit-body rationale that cited **decimation** as a reason to resolve
  client-side was inverted and has been corrected in
  `lib/waterfallOffset.ts`'s header: min/max bucket decimation PRESERVES each
  series' extremes by construction (`calc/decimate.py`), so that case was never a
  divergence; the windowed re-fetch is what trims, and it is what the seam fixes.
- **Finding 3 (narrow) — the `allowExplicitXAsY` one-slot shift: CLOSED by
  BUG-014, verified by probe, now pinned.** Probed against this branch's tip
  (`7dfcde07`) with `xKey:0, yKeys:[0,1,2], waterfall:0.25`: the canvas draws
  channels `[1,2]` at offsets `[0, 74.75]`, and the wire emits
  `[149.5, 0, 74.75]` for `y_keys [0,1,2]` — every channel the canvas draws now
  lands on the canvas' own offset, and only the extra X-as-Y curve (which the
  canvas never draws) sits on the parked slot past the end. `resolveDisplaySeries`
  resolving positions against the CANVAS list is what closed it. A new test pins
  the offset and the palette colour TOGETHER, since they are the same position
  and pinning one alone would let them drift apart again.
- **NIT 4 — module ceilings.** Both files named were at or one line under their
  limit. `lib/figureSpec.ts` **498 → 486** (architecture-test metric,
  `split("\n").length`, ceiling 500): the P3.3 cycle derivation and its rationale
  moved to `lib/figureSpecSeries.resolveSeriesCycle`, which now returns the
  `CycleView` the waterfall wire reuses — one object, asked twice.
  `routes/export_figures.py` **494 → 485** (`splitlines()`, ceiling 500): the two
  new field-doc strings live in `routes/export_figures_schema.py`, the sibling
  that exists for exactly this reason. Both are ≥ 14 lines under.
- **NIT 5 — the NaN guard.** `applyWaterfall` used `fraction <= 0` and
  `waterfallWire` used `!(fraction > 0)`, so a hand-built view with a NaN
  fraction made the canvas NaN every value column while the wire quietly omitted
  the field. Both now call `waterfallOffset.waterfallApplies`.
- **NIT 6 — the wire field's doc reached no generated artefact.**
  `waterfall_offsets` and `series_styles` are now documented with
  `Field(description=…)`, so `frontend/api/openapi.json` and `lib/api/schema.d.ts`
  carry the contract. `series_styles` mattered most: it is a loose
  `dict[str, Any]` whose keys — BUG-014's `legend` among them — can be described
  nowhere else. Regenerated with `tools/dump_openapi.py` + `npm run api:types`.
- **NIT 7 — the completion record's coordinates.** Corrected above: parent
  `ff45a200` (not the pre-cherry-pick `ebefa693`), and the bundle figures
  re-stated as measured on this branch.
- **NIT 8 — the commit trailer.** Unchanged: it is this session's prescribed
  attribution line, not an ad-hoc choice. Flagged for the owner rather than
  silently rewritten.

Sabotage table (mutation → tests that turned red):

| # | Mutation | Red |
|---|---|---|
| 1 | `waterfallWire` drops the mode predicate (keeps only `groupKey`) | 6 — `waterfallOffset.test.ts` "emits nothing for a grouped or faceted request" + "…for a stacked, polar or statistics view"; `figureSpec.test.ts` "is ABSENT for a faceted request" + the three "is ABSENT for a `<mode>` view" |
| 2 | `waterfallWire` ignores the published span | 3 — `waterfallOffset.test.ts` "uses the published span instead of re-measuring the DataStruct"; both `waterfallExportSpan.test.ts` parity cases |
| 3 | the publish effect measures `displayPayload` (post-waterfall) instead of `payload` | 3 — `useLiveSnapshotPublish.test.ts` "is measured BEFORE the waterfall is applied"; both parity cases |
| 4 | `waterfallApplies` becomes `!(fraction <= 0)` (NaN passes) | 2 — `waterfallOffset.test.ts` "refuses zero, negative and NaN fractions" + "so a NaN fraction leaves the canvas payload untouched AND the wire empty" |
| 5 | `readLiveWaterfallSpan` drops the dataset-id guard | 2 — `waterfallOffset.test.ts` "the seam hands back a span only for the dataset it was measured from"; `useLiveSnapshotPublish.test.ts` "is refused for a DIFFERENT dataset" |
| 6 | `resolveDisplaySeries` positions against the REQUEST's list, not the canvas' | 2 — `figureSpec.test.ts` "the X-as-Y branch staggers AND colours the canvas' channels by the CANVAS' slots" + the existing P3.3 colour sibling |
| 7 | `waterfall_offsets` loses its `Field(description=…)` | 1 — `tests/test_openapi_snapshot.py::test_committed_openapi_json_matches_live_schema` |

Gate (all foreground): `ruff check src tests tools` clean; `mypy src` clean
(296 files); `pytest -q` over
`test_openapi_snapshot/test_repo_integrity/test_export_vector_structure/test_calc_plotting/test_api_export`
— **188 passed, 1 skipped**; `tsc -b --force` and `eslint src --max-warnings=0`
clean; `freeze-regression-matrix.mjs --check` clean, no committed golden changed;
`check-bundle-size.mjs` OK.

**Corrected 2026-09-17 (round 3, NIT 6) — the vitest and bundle numbers first
recorded here were measured against the wrong parent.** `git rev-parse
da00c042^` is **`56bb3599`**, not `7dfcde07`: three commits sit between them
(`91a2aa3a`, `950b3a9b`, `56bb3599` itself), one of which (`91a2aa3a`) edits
eagerly-reachable modules, so the original
"910,528 B at `7dfcde07` → 911,045 B, +517 B" was not attributable to this
commit. Re-measured on the real pair: **910,971 B** at `56bb3599` →
**911,488 B** at `da00c042`, **+517 B**, 8,912 B inside the 920,400 B budget.
No budget move. The accompanying claim that the scoped vitest run left one
failure in `store/plotRecipes.test.ts` "already fixed later on the branch by
`950b3a9b`" was also wrong and is withdrawn rather than re-worded: `950b3a9b`
is `da00c042`'s GRANDparent and was already in the tree, and re-running
`vitest run src/lib src/components/Stage src/store src/architecture.test.ts`
with `src/store` in scope on `da00c042` gives **53 files / 930 tests, 0
failed**.

#### Review round 3 — 2026-09-17 (`fix(export): BUG-013 round 3 …`)

A second adversarial review, of `da00c042`, returned **4 CONFIRMED and 4 NITs**.
Every one is closed or recorded below; four changed behaviour, and each of those
went in behind a test that fails without it.

- **CONFIRMED 1 — the span was published under the STORE's current dataset while
  that dataset's fetch was still in flight.** `Stage/useLiveSnapshotPublish` read
  the key from `args.active.id`, which the store advances SYNCHRONOUSLY on a
  dataset switch, while the span itself came from `usePlotPayload`'s payload
  STATE, which keeps the PREVIOUS dataset's rows for the whole fetch round trip
  (only a switch to `null` clears it). So `readLiveWaterfallSpan(newDataset)`
  handed out the old dataset's number for the length of a network round trip.
  Measured on the real hook pair with `fetchPlot` mocked at the network
  boundary: d1 span **200**, d2 span **2**, and an export of d2 taken mid-flight
  staggered by **50** instead of **0.5** — a hundred times too much, and 25x d2's
  entire y-range. Fixed at the source: `usePlotPayload` now carries the dataset
  id WITH the payload in a single `useState` (`PlotPayloadResult.
  payloadDatasetId`) and the publish keys off that, so the seam cannot name a
  dataset whose rows it has never seen. Mid-flight the old dataset's span stays
  published under the OLD id — which is what the canvas is still drawing — and
  the new dataset simply has no published span until its rows arrive.
- **CONFIRMED 2 — a FROZEN document's stagger was scaled by the LIVE dataset's
  span.** `buildStageFigureSpec` read the span for `ds.id` and threaded it into
  the frozen branch too, contradicting this file's own contract that "a frozen
  document is self-contained and intentionally ignores any live dataset". The
  span is now dropped in `buildFigureSpecFromDocument`, in the same place and on
  the same condition `liveDataset` already is. Measured at the
  `buildStageFigureSpec` layer: snapshot span 2, live span 200, `waterfall 0.25`
  — offsets **[0, 0.5]**, where the live span gave **[0, 50]**, i.e. 25x the
  snapshot's whole y-range and a curve flung off the figure.
- **CONFIRMED 3 — the no-live-canvas fallback measured the span over channels
  the canvas never draws.** It scanned the REQUEST's `displayChannels`, which
  under `allowExplicitXAsY` (passed unconditionally by
  `buildFigureSpecFromDocument`) keeps the X channel as a Y series. Positions
  were already resolved against the canvas' list (BUG-014); the step was not.
  `resolveDisplaySeries` now also RETURNS `canvasChannels` — the list it already
  computed — and the wire measures over it, so span and positions come from one
  index space. Measured on a fixture whose X channel lies outside the others'
  range: export **[500, 0, 250]** against canvas shifts **[0, 49.75]**, now
  **[149.5, 0, 74.75]** against the canvas' own **[0, 74.75]**. The existing
  X-as-Y pin was re-based onto that fixture: it used to pass by coincidence,
  because in the shared fixture channel 0's values sat INSIDE channels 1-2's, so
  both spans were 299 either way. It now asserts the step numerically.
- **CONFIRMED 4 (narrow) — the fallback also ignored `dropTrailingEmptyRows`.**
  Both `fetchPlot` return paths end in it, so no canvas has ever measured a raw
  DataStruct; the fallback did. The fallback now BUILDS the payload its own
  canvas would draw — `buildColumns` over `canvasChannels` and the request's x
  channel, then `dropTrailingEmptyRows`, the literal tail of `fetchPlot`'s
  offline path — and measures that. Measured on the Origin over-allocation
  artefact `plotdata.ts` documents (trailing rows reading exactly 0 in x and
  every y): export **18.75** against canvas **6.25**, now 6.25 on both. The
  header sentence that called the old fallback "what its own canvas-less
  `buildColumns` would measure anyway" was false in both these ways and has been
  replaced with what the code now does.
- **NIT 5 — a grouped view with `y2Keys` set: closed.** The canvas degrades such
  a view to a plain ungrouped overlay (`usePlotPayload`'s `groupCol`) and
  staggers it, and the live export route puts no `group_col` on the wire for it
  either — but the refusal was keyed on the view's RAW `groupKey`, so the screen
  staggered and the PDF overlaid: BUG-013's original symptom, still open for this
  one combination. The degrade rule now has ONE definition,
  `lib/plotGroupSplit.canvasGroupCol`, asked by the canvas and by
  `waterfallWire`; the wire additionally refuses on the `group_col` it actually
  EMITS, so a document binding that rides the wire still refuses even when the
  live view would have degraded. The P3.3 style cycle is deliberately NOT
  changed — it keeps asking `overlayExportsSeriesStyles` on the raw binding, the
  same question both canvas hooks ask, so canvas and export still agree there.
  **Overclaimed — narrowed 2026-09-17 (round 4 review): closed only on
  `buildFigureSpec` (the live-view builder), which this module's own header
  documents as reached ONLY through `buildStageFigureSpec`'s rare fallback in
  production. The canonical `buildFigureSpecFromDocument` route real exports
  take still emitted `group_col` from the RAW binding — genuinely closed in
  round 4, below.**
- **NIT 6 — the mis-based gate/bundle numbers: corrected in place above.**
- **NIT 7 — the Figure Builder's own export: RECORDED, not threaded.**
  `components/workshops/figurebuilder/previewExport.ts:55` and
  `figurebuilder/canonicalReadiness.ts:60` call `buildFigureSpecFromDocument`
  with no span, so they take the fallback while `Export figure…` on the focused
  Stage takes the canvas' windowed span — two staggers for one figure whenever a
  committed zoom has narrowed a server-decimated payload. Threading the seam
  there would be wrong, not merely more work: it is written by the FOCUSED Stage
  canvas alone, while the Figure Builder renders a TARGET window that need not be
  focused (`figurebuilder/canonicalSession.ts` documents focus as not a styling
  input), so the preview would change when the user clicked another window — the
  class `components/windows/BackgroundPlotWindow.tsx`'s header names. Closing it
  properly means per-window published spans. Named as a residual in
  `lib/waterfallOffset.ts`'s header with both file:line coordinates.
- **NIT 8 — covered by CONFIRMED 1's test.** `waterfallExportSpan.test.ts` now
  varies the dataset and reads the seam mid-flight; it was the only end-to-end
  test of the seam and it used one dataset and one window, which is exactly why
  the key mismatch went unnoticed.

Also closed while there: `waterfallWire`'s "fewer than two series" guard now
counts the CANVAS' channels rather than the request's, because that is what
`applyWaterfall` counts — an X-as-Y request can carry two display channels while
the canvas draws one curve and staggers nothing.

Sabotage table (mutation → tests that turned red; scope
`src/lib/waterfallOffset.test.ts src/lib/figureSpec.test.ts
src/components/Stage/waterfallExportSpan.test.ts
src/components/Stage/useLiveSnapshotPublish.test.ts
src/components/Stage/usePlotPayload*.test.ts src/store/plotRecipes.test.ts
src/lib/regressionMatrix.test.ts`, 233 green unsabotaged):

| # | Mutation | Red |
|---|---|---|
| 1 | the publish keys the span by the STORE's active dataset again | 1 — `waterfallExportSpan` "names no span for a dataset whose fetch is still in flight" |
| 2 | the frozen branch is handed the live span again | 1 — `figureSpec` "a FROZEN document's stagger comes from its snapshot, never the live canvas' span" |
| 3 | `resolveDisplaySeries` returns the request's list as `canvasChannels` | 1 — `figureSpec` "the X-as-Y branch staggers AND colours the canvas' channels by the CANVAS' slots" |
| 4 | the fallback skips `dropTrailingEmptyRows` | 1 — `waterfallOffset` "measures the fallback over the rows a canvas would draw, trailing padding dropped" |
| 5 | the group refusal reads the view's RAW binding again | 1 — `figureSpec` "rides a grouped view that a secondary Y axis degraded to a plain overlay" |
| 6 | `payloadDatasetId` is taken from the params instead of the fetched state | 1 — `waterfallExportSpan` "names no span for a dataset whose fetch is still in flight" |
| 7 | the fallback span is measured over the request's `yKeys` | 3 — both new `waterfallOffset` fallback tests + the X-as-Y pin |

Gate (all foreground, on the round-3 commit): `tsc -b --force` and
`eslint src --max-warnings=0` clean; `vitest run src/lib src/components/Stage
src/store src/architecture.test.ts` — **406 files / 7809 tests passed, 0
failed**; `pytest -q tests/test_repo_integrity.py` — **12 passed**. No backend
file changed, so the export/OpenAPI suites are untouched by this round.
`check-bundle-size.mjs` OK, 7.0 kB under budget. Eager bundle, both trees built
in the same checkout after `rm -rf node_modules/.vite`: **912,846 B** at the
parent `0565b674` → **913,186 B** here, **+340 B**. No budget move.

**Corrected 2026-09-17 (round 4, NIT 3) — this bundle pair was measured
against the wrong parent AGAIN, the same mistake round 3 corrected once
already (this file's NIT 6, just above — whose own "four commits" is also
corrected to three, in place).** `git rev-parse fe50280f^` is **`f0d33783`**,
not `0565b674` — `0565b674` is the base of the worktree this work was
cherry-picked from, and three commits with eager frontend edits
(`caa10f88`, `8a8d92b1`, `230a174a`) sit between the two. Re-measured on the
real pair, both trees built in a scratch `git worktree` after `npm ci` and
`rm -rf node_modules/.vite`: **912,953 B** at `f0d33783` → **913,293 B** at
`fe50280f`, **+340 B** — the delta the original record quoted happens to be
right even though its base was wrong.

#### Review round 4 — 2026-09-17 (`fix(export): BUG-013 round 4 …`)

A third adversarial review, of `fe50280f`, returned **1 CONFIRMED (medium), 1
CONFIRMED (test gap) and 3 NITs**. Round 3's CONFIRMED 1-4 were re-attacked and
hold; this round's findings are about round 3's OWN fix and its own record.

- **CONFIRMED 1 — round 3's `group_col` degrade fix reached only the branch
  `figureSpec.ts` itself never calls in production.** `figureSpec.ts`'s
  `group_col` field, and the `groupCol` it fed `waterfallWire`, both read the
  RAW `extras.groupKey` binding, not the degraded value `plotGroupSplit.
  canvasGroupCol` computes — the exact function the CANVAS (`Stage/
  usePlotPayload`) and `waterfallWire`'s own internal fallback already asked.
  Round 3's new test ("rides a grouped view that a secondary Y axis degraded
  to a plain overlay") only exercised `buildFigureSpec`, the live-view
  builder that `buildStageFigureSpec`'s own header documents as reached ONLY
  through its rare invariant-violation fallback — not
  `buildFigureSpecFromDocument`, the canonical route "Copy figure"/"Export
  figure…" actually take. Reachable with one legend click on that real route:
  bind a group column, bind a secondary axis, then hide the y2 series (the
  canvas degrades on the RAW y2 binding regardless of hidden state, so the
  screen shows a plain, staggered overlay). Measured on that exact document
  fixture (`dataset`'s channels 1-3, `groupKey:0, y2Keys:[3], hiddenChannels:
  [3], waterfall:0.25`), before the fix: `group_col:0`, `y_keys:[1,2]`, NO
  `waterfall_offsets` — a grouped, un-staggered export of an ungrouped,
  staggered screen, BUG-013's own symptom. Fixed by extracting `lib/
  figureSpecGroup.ts`'s `resolveGroupCol` (funds the fix against `figureSpec.
  ts`'s 500-line ceiling rather than raising it): it keeps the existing
  grouped+REALLY-rendered-secondary-axis throw on the raw binding (a genuine
  conflict, unchanged — `richView()`'s existing throw test still passes
  unmodified), and everywhere else degrades `group_col` through
  `canvasGroupCol`, reused verbatim for the `groupCol` `waterfallWire` is
  given. After the fix, the same fixture emits no `group_col` and offsets
  `[0, 74.75]` — the canvas' own numbers, not hardcoded. The stale doc comment
  claiming `buildFigureSpec`'s fallback branch "should not occur in practice"
  is corrected in place: it is the ONLY way `buildFigureSpec` is reached in
  production, and testing it directly (as round 3 did) is exactly how a fix
  got marked closed on a branch users don't reach.
- **CONFIRMED 2 (test gap) — the `groupCol` argument `waterfallWire` takes was
  untested; investigated and narrowed rather than closed as specified.**
  Sabotaging the raw-vs-degraded computation (finding 1's mutation) is caught
  by the new test above. Separately sabotaging the `waterfallWire` CALL SITE —
  dropping the `groupCol,` line from `figureSpec.ts`'s call entirely — does
  **NOT** turn the new test red: measured directly (`tsc -b --force` clean,
  `vitest run src/lib/figureSpec.test.ts` 83/83 green with that line deleted).
  Traced why: `waterfallWire`'s own internal fallback is `args.groupCol ??
  canvasGroupCol(args.view.groupKey, args.view.y2Keys)`, and `args.view` here
  is `resolveSeriesCycle`'s `cycleView`, whose `groupKey` is `extras.groupKey
  ?? st.groupKey` and whose `y2Keys` is `st.y2Keys` — the SAME two inputs
  `figureSpecGroup.resolveGroupCol` computes `group_col` from, for BOTH
  callers (`buildFigureSpecFromDocument`'s `st.groupKey` is always literally
  `document.bindings.groupKey`, i.e. `extras.groupKey`, by construction —
  `figureDocumentToPlotView` line ~208 — so the two never differ; the live
  route's `extras.groupKey` is always `undefined`, which is nullish either way
  it is read). So after the finding-1 fix, the explicit argument is
  mathematically redundant with the callee's own fallback in every caller
  this codebase has — not a coincidence of one fixture, a structural
  invariant of the call graph. Left in place anyway (it is what the code
  comment already documents as "keyed on what the request ACTUALLY carries",
  self-documenting and harmless), but the "must go red when dropped" bar in
  the brief cannot be met honestly; the finding-1 test above is the real
  regression guard for the behaviour this argument was meant to protect
  ("the wire still refuses offsets when it emits `group_col` … or, after fix
  1, emits neither" — it emits neither, and the offsets ride).
- **NIT 3 — the round-3 record's bundle numbers and commit-count claim:
  corrected in place above** (this section's own preamble).
- **NIT 4 (test gap) — `canvasColumns`' `xKey` argument was untested.**
  Sabotage (`waterfallOffset.ts`: `canvasColumns(args.data, args.canvasChannels,
  null)` instead of `args.view.xKey`) left the existing suite green. It is
  live: the Origin over-allocation padding rule keys off the ACTUAL x column,
  and a request whose x channel is a value column (not `time`) can have a
  DIFFERENT trailing-zero pattern than `time` does. New test, measured (not
  hardcoded from the review): real `xKey` drops the padded tail -> range
  `[50,75]` -> step **6.25**; `xKey:null` (the sabotage) sees `time` as
  finite/non-zero throughout, drops nothing -> range `[0,75]` -> step
  **18.75**. Sabotage-verified: reverting to `null` turns exactly this one
  test red (17/18 -> the new one).
- **NIT 5 — the regression matrix's REOPEN leg measured the waterfall over a
  raw, un-dropped `buildColumns`.** `regressionMatrixReopen.testkit.ts`'s
  `waterfallOffsetFor` now wraps its `buildColumns` call in
  `dropTrailingEmptyRows`, matching the EXPORT leg's own fallback
  (`waterfallOffset.canvasColumns`) so a future padded fixture cannot report a
  false `reopen != export` divergence. `freeze-regression-matrix.mjs --check`
  stays clean — no current matrix fixture has trailing empty rows, exactly as
  the screen leg's own comment already notes for its own (deliberate) omission
  of this step — so this is a defensive fix, not new coverage; sabotaging it
  (reverting to the raw `buildColumns`) leaves `regressionMatrix.test.ts`
  green, confirmed. Non-vacuous: probed directly against the finding-4 padded
  fixture outside the suite — `18.75` without the drop, `6.25` with it, the
  same two numbers NIT 4 pins.

Sabotage table (scope `src/lib/figureSpec.test.ts src/lib/waterfallOffset.
test.ts src/lib/regressionMatrix.test.ts`, restored byte-identical after
each):

| # | Mutation | Result |
|---|---|---|
| S1 | `figureSpecGroup.resolveGroupCol` returns the raw `groupKey` instead of `canvasGroupCol(...)` (keeps the throw) | RED 1 — `figureSpec` "degrades group_col exactly like the canvas when the y2 channel is hidden, and the offsets ride" |
| S2 | drop the `groupCol,` line from `figureSpec.ts`'s `waterfallWire` call | GREEN — 83/83 unchanged; investigated, see CONFIRMED 2 |
| S3 | `waterfallOffset.ts`: `canvasColumns(args.data, args.canvasChannels, null)` instead of `args.view.xKey` | RED 1 — `waterfallOffset` "measures the padding drop against the REQUEST's x channel, not always `time`" |
| S4 | `regressionMatrixReopen.testkit.ts`: revert to the raw `buildColumns`, no `dropTrailingEmptyRows` | GREEN — `regressionMatrix.test.ts` 47/47 unchanged (no current fixture has trailing padding; see NIT 5) |

Gate (all foreground): `npx tsc -b --force` and `npx eslint src
--max-warnings=0` clean; `npx vitest run src/lib src/components/Stage
src/store/plotRecipes.test.ts src/architecture.test.ts` — **328 files / 6124
tests passed, 0 failed**; `node scripts/freeze-regression-matrix.mjs --check`
clean, no committed golden moved; `uv run pytest -q tests/
test_repo_integrity.py` — **12 passed**. No backend file changed. Eager
bundle: the `+0 B` delta above was measured against a CHERRY-PICK base
(`b3fb6668` = the worktree commit's own parent), not this commit's real
parent — flagged as this file's own recurring mistake (see NIT 3, round 5
review) and corrected here rather than left stale. Re-measured (round 5
review) at the real pair, both trees built in a scratch `git worktree` after
`npm ci` + `rm -rf node_modules/.vite`: `git rev-parse 1fcc4137^` =
`19018015` → **913,249 B** at `19018015` → **913,249 B** at `1fcc4137`,
**+0 B** — the same conclusion (`figureSpecGroup.ts` eagerly reachable
through the unchanged `figureSpec.ts` import graph, net line-count change
small enough to fall out in minification), now against the tree this commit
actually built on.

#### Review round 5 — 2026-09-17 (`fix(export): BUG-013 round 5 …`)

A fourth adversarial review, of `1fcc4137`, returned **2 CONFIRMED** and
**5 NITs**, all on round 4's OWN fix and its own record; round 3's CONFIRMED
1-4 were not re-attacked this round.

- **CONFIRMED 1 — round 4 kept a throw the canvas does not have.**
  `figureSpecGroup.ts`'s `resolveGroupCol` refused (threw) a group bound with
  a REALLY RENDERED (not merely hidden) secondary axis, reasoned as "a
  genuine conflict, not a degrade case." But `Stage/usePlotPayload`'s own
  `canvasGroupCol` call reads the RAW `y2Keys` binding with no
  plotted/hidden distinction at all — the screen has always degraded THIS
  exact combination to a plain, staggered overlay too, reachable with one
  click (bind Group, right-click a series -> Y2). Measured with the throw
  deleted: `{y_keys:[1,2,3], y2_keys:[3], group_col: absent,
  waterfall_offsets:[0, 74.75, 149.5]}` — byte-for-byte the canvas' own
  numbers, and the backend accepts it (`export_figures.py` rejects only
  `group_col` combined with `y2_keys`, and a degrade emits no `group_col` at
  all). Fixed by deleting the throw: `resolveGroupCol` is now `canvasGroupCol`
  itself, one function, one answer, for every cell. `computeCanonicalReadiness`
  needed no change — with nothing left to throw on the GROUP path,
  the Figure Builder's preview naturally reports `"ready"` instead of
  `"invalid-spec"` for a grouped+y2 view, canExport flips to true, and no new
  UI/warning channel was invented (none existed to reuse, per the brief's own
  qualifier). `"invalid-spec"` itself is not dead: `figureSpecFacets.ts:101`'s
  "no visible series to export" still throws it, for its own, unrelated
  reason (round-5-review NIT 6). Sabotage (S1 below) shows the fix is
  covered by a new 7-cell truth table (`figureSpec.test.ts`) plus 6 existing
  test sites across 4 files that pinned the old throw, all rewritten to
  assert the degrade instead: `figureSpec.test.ts` (3 sites),
  `useFigureBuilder.test.ts`, `copyFigureCommand.test.ts`,
  `exportFigureCommand.test.ts`.
- **CONFIRMED 2 — the live `buildFigureSpec` route could read two different
  answers for one request.** `waterfallWire`'s `groupCol` argument was
  optional with an internal fallback, `args.groupCol ?? canvasGroupCol(args.
  view.groupKey, args.view.y2Keys)`. `??` treats an explicit `null` (a
  resolved, degraded answer) the same as an omitted argument, so it did NOT
  suppress the second reading — it invited it. On the live `buildFigureSpec`
  route, `extras.groupKey` is always `undefined` (the legacy builder
  structurally cannot carry a group binding at all — a known, separate
  limitation `buildStageFigureSpec`'s document routing exists to close), so
  `group_col` on the wire was ALWAYS absent regardless of `st.groupKey`,
  while `waterfallWire`'s fallback still read the view's raw `st.groupKey`
  for the offset refusal alone. Measured (`st.groupKey:0`, no y2, waterfall
  0.25): `group_col` absent, `waterfall_offsets` ALSO absent — the field
  says "ungrouped", the refusal says "grouped", precisely the two-answers
  case the round-4 commit body claimed was now impossible. Fixed by making
  `groupCol` REQUIRED on `waterfallWire`, no fallback: both fields now read
  the one value `figureSpec.ts` already resolved with `resolveGroupCol`
  before calling in. A pre-existing test ("a grouped view with NO secondary
  axis still refuses") pinned the OLD two-answer behaviour and was rewritten
  to assert the new one-answer contract instead (sabotage S2 below).
- **NIT 3 — the round-4 record's absolute bundle pair named a cherry-pick
  base, corrected in place above** (this section's own preamble).
- **NIT 4 — `figureSpec.ts`'s line count, corrected in place above; round 5's
  own edits left it at 497/500 (`split("\n").length`), unchanged from round 4
  — comments trimmed to offset the doc additions the fix needed, so the
  3-line headroom is preserved rather than spent.**
- **NIT 5 — the reopen leg's waterfall doc contradicted itself, reworded in
  place** (`regressionMatrixReopen.testkit.ts`'s `waterfallOffsetFor`): the
  opening line now says what it actually measures (the export leg's own
  columns, through the screen leg's own `measureWaterfall`) instead of a
  since-contradicted "same way the screen leg measures it."
- **NIT 6 — `figureMode` (`regressionMatrix.testkit.ts`) hand-copied the
  degrade predicate instead of calling `canvasGroupCol`, and its comment
  ("figureSpec.ts refuses the combination outright") went stale the moment
  finding 1 landed.** Now calls `canvasGroupCol` directly — one fewer
  hand-synced copy of the rule, matching this module's own "two
  implementations drift apart" warning. `legacyFigure.ts:87`'s `group_col:
  state.docGroupCol ?? undefined` is confirmed still benign (verified: no
  `y2`/`waterfall` token anywhere in that module) and left as is, noted per
  the brief.
- **NIT 7 — the `groupCol` argument stays required and is no longer
  redundant** after fix 2 (round 4's "redundant... left in place anyway" note
  is moot now that dropping it would be a compile error, not just an
  unreachable-in-practice branch).
- **NIT 8 (named residual) — on the LIVE route, the wire's curve SET still
  does not match the canvas' after this fix; only the stagger STEP does.**
  `buildFigureSpec` (`lib/figureSpec.ts:125-129`) is the legacy/live builder
  "Copy figure"/"Export figure…" fall back to when no canonical document
  applies (`buildStageFigureSpec`'s rare fallback, round-4 CONFIRMED 1's own
  finding) — its `extras` parameter has no `groupKey` field at all, so it
  structurally cannot carry a group binding onto the wire regardless of this
  fix. Measured (`st.groupKey:0, yKeys:[1,2,3], waterfall:0.25`, 4 rows, 2
  group levels): wire emits `group_col` absent, `y_keys:[1,2,3],
  waterfall_offsets:[0, 99.75, 199.5]`; the canvas (`Stage/usePlotPayload.ts`,
  `applyGroupSplit` at `:340`) draws **6** split series, staggered across 6
  slots with that SAME step. Before this fix the live route emitted neither
  `group_col` nor `waterfall_offsets` at all (a flat, un-staggered 3-curve
  figure) — the fix is still a net improvement on BUG-013's own "does the
  export look like the screen" axis, and matches the canvas' own stagger
  amount — but the exported curve SET (3 curves) is not the canvas' curve set
  (6 split series), so this residual is not closed by this commit. Closing it
  needs `buildFigureSpec` to gain a `groupKey` field (or for every "Copy
  figure"/"Export figure…" caller to route through
  `buildFigureSpecFromDocument` instead, closing round-4 CONFIRMED 1's
  fallback rather than widening the legacy builder) — out of this round's
  scope, tracked here rather than left implicit in "the figure is the
  canvas."

Sabotage table (scope `src/lib/figureSpec.test.ts src/lib/waterfallOffset.
test.ts src/components/workshops/figurebuilder/useFigureBuilder.test.ts`,
restored byte-identical after each):

| # | Mutation | Result |
|---|---|---|
| S1 | Restore a throw in `figureSpecGroup.resolveGroupCol` for ANY grouped+non-empty-`y2Keys` binding (measured broader than round 4's exact plotted-only throw, on purpose) | **RED 10** — `figureSpec.test.ts` (6: the truth table's cells 4/5/6/7, the rewritten "exports grouping…" test, "degrades group+secondary-axis the SAME way…", "degrades group_col exactly like the canvas when the y2 channel is hidden"), `useFigureBuilder.test.ts` (1), `copyFigureCommand.test.ts` (1), `exportFigureCommand.test.ts` (1) — every rewritten degrade test plus 3 pre-existing hidden-y2 tests, since this broader throw also fires on the hidden/solo'd/not-plotted cells |
| S2 | Restore `args.groupCol ?? canvasGroupCol(args.view.groupKey, args.view.y2Keys)` inside `waterfallWire` | RED 1 — `figureSpec` "group_col absent implies waterfall_offsets present here too, even for a view the CANVAS still splits" |
| S3 | Drop the `groupCol,` line from `figureSpec.ts`'s `waterfallWire` call | tsc **compile error** (`groupCol` is now required, not a silently-green runtime gap — closes round 4's CONFIRMED-2 test gap structurally) |
| S4 | `figureMode` reverts to the hand-copied predicate (`groupKey !== null && !(y2 && y2.length > 0)`) | GREEN — the two predicates are extensionally identical; the fix is a de-duplication, not new coverage (matches NIT 6's own framing) |

Gate (all foreground): `npx tsc -b --force` and `npx eslint src
--max-warnings=0` clean; `npx vitest run src/lib src/components/Stage
src/components/workshops/figurebuilder src/store/plotRecipes.test.ts
src/architecture.test.ts` — **350 files / 6586 tests passed, 0 failed**;
`node scripts/freeze-regression-matrix.mjs --check` clean, no committed
golden moved; `uv run pytest -q tests/test_repo_integrity.py` — **12
passed**. No backend file changed. Eager bundle, three trees built after
`npm ci` + `rm -rf node_modules/.vite` (the first two in scratch `git
worktree`s, the third the worktree this commit was made in): `19018015` and
`1fcc4137` both **913,249 B** (see the round-4 record correction above);
this commit **913,181 B**, **-68 B** — comment trims (finding 1's throw
removal, finding 2's doc rewrite) outweighing the small amount of new test
code, none of which is eagerly reachable.

**Record correction (round-5-review CONFIRMED 1 / NIT 5, added after the
fact):** every number in the paragraph above was measured on the
**pre-cherry-pick worktree**, whose parent was `1fcc4137`, not on the
branch — `git rev-parse 97eeb1a4^` is `65ecbf81` (BUG-014 round 5), which
sits between `1fcc4137` and `97eeb1a4` and lands inside both the recorded
vitest scope and eager code. Re-measured on the branch at `97eeb1a4` itself,
exact recorded scope, foreground, clean tree: **351 files / 6602 tests
passed, 0 failed** (`65ecbf81` alone added `frontend/src/lib/
sanitizeRecord.test.ts` plus 16 tests across four existing files — the exact
+1 file / +16 test delta). `65ecbf81`'s own commit body independently
records "Eager bundle 913,249 -> 913,348 B (+99)", so the branch total at
`97eeb1a4` is **913,348 − 68 = 913,280 B**, not the recorded 913,181 B — the
**−68 B delta above is still a fair ISOLATED measurement of this diff** (its
base tree differs from the branch by this diff alone), only the recorded
absolute was wrong. Restated pair, both SHAs named: parent `65ecbf81` =
**913,348 B**, `97eeb1a4` = **913,280 B** (arithmetic from two committed
records, not a fresh build of either). The CONFIRMED 1 paragraph above ("Five
… test sites") is corrected in place to **six** (`figureSpec.test.ts` had
three rewritten sites, not two).

---

## ~~BUG-014 — a renamed legend loses its unit on screen but keeps it on export~~ **FIXED 2026-09-15**

**Priority:** P3 — cosmetic only: the figure and its data are correct on
both legs, the legend wording simply disagrees between screen and export.

**Reported:** 2026-09-14, by the P4.2 canonical regression matrix
(`1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`) — a design-time
finding from the matrix's structural comparison, not yet surfaced by a user
report.

**Investigated:** root cause confirmed by reading both the frontend label
builder and the backend's label formatting, not inferred — see Confirmed
implementation evidence below.

**Suggested implementation owner/model:** Claude (agent) — fixed 2026-09-15.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D3.

#### User-visible problem

A user renames a series' legend label — for example to "Loop 1" — on a
channel whose unit is "au". On screen, the legend shows exactly "Loop 1" and
nothing else: a rename fully replaces the displayed label, unit included.
Exporting the same figure shows "Loop 1 (au)" instead — the backend
re-appends the channel's unit to the rename, producing a label the user
never asked for and does not see on screen.

#### Confirmed implementation evidence

(As FILED, 2026-09-14, before the fix. The line numbers and the three code
shapes named below — `seriesLabels?.[i] ?? …`, the `dataset.labels[ch]`
rewrite, and the unconditional `f"{s.label} ({s.unit})"` — describe the code
the bug was found in; the Completion record names what replaced them. Kept
verbatim as the record of the finding.)

- `frontend/src/lib/uplotOpts.ts:694` (`seriesLabels?: (string |
  undefined)[]` on the opts builder's args) and `:907` — the on-screen
  legend label is built as `args.seriesLabels?.[i] ?? (s.unit ? `${s.label}
  (${s.unit})` : s.label)`. An explicit rename supplies a value at
  `seriesLabels[i]`, which REPLACES the whole label — unit included — via the
  `??` short-circuit; there is no code path that re-appends a unit onto a
  rename.
- `frontend/src/lib/figureSpec.ts:200-204` — the wire `dataset` sent to
  export only rewrites `data.labels[ch]` to the raw rename text
  (`st.seriesLabels[ch] ?? label`): this changes the CHANNEL LABEL the
  backend receives, not a fully-resolved legend string with a unit already
  decided.
- `src/quantized/routes/export_figures.py:234` and `:267` (inside
  `_figure_series`, part of `_resolve_figure`'s codepath) — every exported
  series name is unconditionally built as `f"{s.label} ({s.unit})" if
  s.unit else s.label`: the backend always re-appends the channel's OWN unit
  to whatever label string it receives, with no way to mark a label as
  "already complete, do not append a unit."
- Net effect: a rename lands on `dataset.labels[ch]` (becomes `s.label`
  server-side) and is then unit-appended a SECOND time by the backend,
  producing "Loop 1 (au)", while the screen shows exactly "Loop 1".
- Test: `frontend/src/lib/regressionMatrix.test.ts:368`,
  `it('DIVERGENCE (BUG-014): a renamed series reads "Loop 1" on screen and
  "Loop 1 (au)" in the export', ...)` — builds a document with
  `view.seriesLabels: { 0: "Loop 1" }` on a channel with unit "au"
  (`renamedFigure()`, `regressionMatrix.test.ts:447`) and pins BOTH measured
  strings (screen "Loop 1", export "Loop 1 (au)") plus the wire bytes behind
  them (`spec.dataset.labels[0] === "Loop 1"` AND `spec.dataset.units[0] ===
  "au"` — the two the backend re-joins), then asserts they differ.
  (Converted 2026-09-14 from a bare `it.fails`.)

#### Why this priority

P3 as filed. The evidence supports keeping it there: the plot itself is
correct on both legs (same data, same series, same colours), only the legend
STRING differs — a wording/polish mismatch, not a data or scientific
correctness issue, and not something that could plausibly be mistaken for a
different measurement.

#### Reproduction checklist

- [x] Starting state and sample data identified — a `FigureDocument` with
  `view.seriesLabels: { 0: "Loop 1" }` on a channel whose unit is "au",
  built by `renamedFigure()` (`regressionMatrix.test.ts:447-463`).
- [x] Exact actions recorded — rename series 0's legend label, then compare
  `projectScreen(...).series[0].label` to `projectExport(...).series[0]
  .label`.
- [x] Actual result recorded — screen: "Loop 1"; export: "Loop 1 (au)".
- [x] Expected result recorded — the exported legend label should match the
  renamed on-screen label exactly.
- [x] Reproduced by an agent —
  `frontend/src/lib/regressionMatrix.test.ts`'s
  `it('DIVERGENCE (BUG-014): a renamed series reads "Loop 1" on screen and
  "Loop 1 (au)" in the export', ...)`.

#### Fix checklist

- [x] Decide the contract: **the backend learns to distinguish "raw channel
  label, append the unit" from "user-supplied legend text, use verbatim."**
  The frontend does NOT send a fully-resolved string in `dataset.labels`: a
  rename is a presentation choice, not a data edit, so the wire `dataset`
  now carries the DATA's own labels and units (any data-table/CSV consumer
  of the same spec still sees the real column names) and the rename rides
  its own optional field, `series_styles[i].legend` — the EXISTING per-series
  presentation object, aligned 1:1 with `y_keys` exactly as
  `color`/`width`/`line`/`marker` already are. Additive and optional: a
  request with no rename is byte-identical to before.
- [x] Whichever shape is chosen, thread a rename through distinctly from an
  un-renamed channel label so the unit-appending format applies only to the
  latter. The composition moved into the pure layer as
  `calc.figure_labels.series_display_name(label, unit, legend)` — legend
  verbatim when present, `"label (unit)"` otherwise — and
  `routes/export_figures_labels.py` (a new route-layer sibling) reads the
  loose `legend` key off the wire and applies it to the series names AND to
  the auto-derived solo-axis titles, which `uplotOpts`' `soloLabel` also
  reads off the resolved legend.
- [x] Confirm an UN-renamed series (no `seriesLabels` entry) still gets its
  unit appended on export exactly as today — the common case must not
  regress. `tests/test_export_vector_structure.py`'s
  `test_an_unrenamed_series_still_gets_its_unit_appended` renders the real
  SVG and reads the legend group's `<text>` entries.
- [x] INVERT the divergence assertion in `regressionMatrix.test.ts` — the
  export-side "Loop 1 (au)" pin and the `.not.toBe` are gone, replaced by the
  screen-equals-export equality, and the test is renamed to drop the
  `DIVERGENCE` prefix. It is kept non-vacuous by pinning the wire's own bytes
  (`dataset.labels[0] === "Signal"`, `units[0] === "au"`,
  `series_styles[0].legend === "Loop 1"`) and asserting the screen's text
  differs from the `"label (unit)"` the backend would otherwise compose from
  them.

#### Acceptance criteria

- [x] A series renamed on screen exports with the identical legend text, no
  unit re-appended — measured in the rendered SVG, not only on the wire
  (`test_a_renamed_series_renders_its_legend_text_exactly`: the legend group
  reads `["Loop 1", "Series B (au)", "Series C (au)"]`). True on EVERY branch
  as of the review round: the flat/solo/y2 paths since 2026-09-15, the FACET
  panels since 2026-09-16 (they shipped `"Loop 1 (au)"` until then — see the
  review round below), the `group_col` branch by the documented substitution
  (the rename replaces the channel-label half of the per-level template).
  ONE residual, pinned rather than fixed: an EMPTY rename — see the review
  round's finding 4.
- [x] An un-renamed series continues to export with its unit appended
  exactly as before (no regression).
- [x] `projectExport(renamed, dataset).series[0].label` equals
  `projectScreen(renamed, dataset).series[0].label` — the equality
  BUG-014's divergence test is inverted into. The FACET leg of the same
  equality (`projectExport(...).facet` vs `projectScreen(...).facet`) is
  pinned alongside it as of the review round.

#### Completion record

- PR/commit: `fix(export): BUG-014 …` on `claude/repo-evaluation-l7y7k9`
  (parent `50b30a04`). The wire gains ONE optional field,
  `series_styles[i].legend`; `FigureRequest.series_styles` is a list of loose
  dicts by design ("a bad/unrecognized value in ANY of these keys degrades
  gracefully"), so `frontend/api/openapi.json` and
  `frontend/src/lib/api/schema.d.ts` are BYTE-IDENTICAL after regenerating
  them (`uv run python tools/dump_openapi.py`, `npm run api:types`) — the
  schema never enumerated those keys. No persisted contract changed either:
  a rename still lives in `view.seriesLabels`, `sanitizeExportSeriesStyles`
  deliberately does NOT restore a `legend` from a saved
  `publication.seriesStyles`, and no document version moved.
- Module-ceiling work this required: `frontend/src/lib/figureSpec.ts` was at
  499 of 500 lines, so the per-series half was extracted to
  `frontend/src/lib/figureSpecSeries.ts` (display/plotted/position
  resolution, the legend overlay, the `series_styles` assembly and
  `exportErrorSpans`) with its own `figureSpecSeries.test.ts`;
  `src/quantized/routes/export_figures.py` was at 499, so label resolution
  moved to `routes/export_figures_labels.py` and `_tick_fmt` moved beside
  its own `TickFormatSpec` in `routes/export_figures_schema.py`. No pin was
  raised and no comment shaved.
- Known limit: the `group_col` branch expands each channel into one series
  PER LEVEL, so a rename cannot name a finished series there. It replaces the
  channel-label half of `build_grouped_series`' `"{label} ({group}={level})"`
  template instead (new optional `y_legends` argument), which reproduces the
  pre-fix wire byte-for-byte — grouped export parity as a whole stays
  BUG-016. Facet panels ship FINISHED series strings that no per-series field
  on the request can reach, so their labels are resolved client-side —
  **originally from a request-local relabelled copy of the DataStruct, which
  re-created this very bug inside the facet branch** (`"Loop 1 (au)"`) and
  was corrected in the review round below.
- Automated tests: `tests/test_export_vector_structure.py` — five new
  structural tests reading the rendered SVG's legend group (rename verbatim;
  un-renamed unchanged; a renamed SOLO series' auto-derived axis title;
  a non-string `legend` degrading instead of 422ing; the grouped branch).
  `frontend/src/lib/figureSpecSeries.test.ts` — new file, 15 tests.
  `frontend/src/lib/figureSpec.test.ts` — the rename/blank-rename wire tests,
  the updated byte/deep-equal wire shape, and the publication-styles branches.
  `frontend/src/lib/regressionMatrix.test.ts` — the inverted BUG-014 test.
  `frontend/src/lib/exportParity.test.ts` and `exportFigureCommand.test.ts` —
  the two pre-existing "rename rewrites `dataset.labels`" pins, rewritten to
  the honest wire.
- Agent verification: sabotage table (each reverted in turn, then restored) —
  (a) `withSeriesLegends` returning `styles` unchanged → 11 failures across
  `figureSpecSeries.test.ts`, `figureSpec.test.ts`, `regressionMatrix.test.ts`,
  `exportParity.test.ts` and `exportFigureCommand.test.ts`; (b)
  `series_display_name` ignoring its `legend` argument → 2 backend failures
  (`test_a_renamed_series_renders_its_legend_text_exactly`,
  `test_a_renamed_solo_series_titles_its_axis_with_the_same_text`);
  (c) the grouped branch ignoring `y_legends` → 1 backend failure
  (`test_a_grouped_export_folds_the_rename_into_its_per_level_labels`);
  (d) `solo_axis_label` recomposing from the channel instead of the resolved
  name → 1 backend failure (the solo-axis test).
  Gate: `uv run ruff check src tests tools`; `uv run mypy src` (296 files);
  `uv run pytest -q tests/test_openapi_snapshot.py tests/test_repo_integrity.py
  tests/test_export_vector_structure.py tests/test_api_export.py
  tests/test_calc_figure.py`; `npx tsc -b --force`;
  `npx eslint src --max-warnings=0`;
  `npx vitest run src/lib src/architecture.test.ts`;
  `node scripts/freeze-regression-matrix.mjs --check` clean (the canonical
  payload is unchanged — the goldens are SCREEN projections and no fixture is
  renamed); `node scripts/check-bundle-size.mjs` green.
- Bundle (measured): parent `50b30a04` **919,877 B** eager -> **919,877 B**,
  a **+0 B** delta — the per-file eager byte list is identical entry for
  entry. The split did NOT grow the eager graph: `lib/figureSpecSeries.ts`
  lands in the same lazy `figureSpec` chunk its caller does (that chunk grew
  6.64 kB -> 7.34 kB). Both builds were run after `npm ci`, with vite's
  transform cache cleared, and `node scripts/check-bundle-size.mjs` reports
  898.3 kB eager of the 898.8 kB budget, unmoved.
  **Those two numbers are the ORIGINAL commit's pair (`bdf3b32a` on top of
  `50b30a04`).** What landed on `claude/repo-evaluation-l7y7k9` is a
  cherry-pick, `7dfcde07`, whose real parent is `3804e643`; re-measuring
  `3804e643..7dfcde07` will not reproduce them, and nothing was re-measured
  for the cherry-pick. The +0 B claim itself still holds structurally (no
  eager module gains an import, `figureSpecSeries.ts` is reached only from
  the already-lazy `figureSpec.ts`, and no ratchet pin moved).
- Owner verification: pending — rename a series' legend on screen, export the
  figure, and confirm the PDF's legend reads exactly what the on-screen
  legend reads. Worth doing on a FACETED view too (the review round's
  finding 2).
- Notes: —

#### Adversarial review round (2026-09-16)

An adversarial review of `7dfcde07` returned 2 CONFIRMED + 6 NITs; the
root-cause fix itself was measured correct on fourteen view configurations
and nothing was reverted. Closed by
`fix(export): close the BUG-014 review — facet panels honour a legend rename
verbatim on screen and export`, on top of `da00c042`:

- **Finding 1 (CONFIRMED) — the recorded frontend gate could not see the
  suite it broke.** The gate line above reads `npx vitest run src/lib
  src/architecture.test.ts`; that glob excludes `src/store` **structurally**,
  and `frontend/src/store/plotRecipes.test.ts` was RED at `7dfcde07`
  (`expected [ '2theta', 'Intensity', 'Ierr' ] to include 'Corrected
  intensity'` at `:996` — the spec still asserted the pre-fix wire, where a
  rename rewrote `dataset.labels`). So a green scoped gate was recorded on a
  tree whose `npm test` was red. It was repaired two commits later by
  `950b3a9b`, which re-points that spec at the honest wire and is strictly
  stronger (it pins the positive, the negative, and the whole style object
  including `legend`). Standing correction, now in `agent_rules.md`: any
  change to the export WIRE must include `src/store` in the vitest scope.
- **Finding 2 (CONFIRMED) — the FACET branch still exported the bug's exact
  string; fixed.** With `facetKey` bound and `seriesLabels: {1: "Loop 1"}` on
  a unit-`au` channel, facet EXPORT panels read `Loop 1 (au)` (the panel label
  was composed as `${relabelled} (${unit})` from a request-local relabelled
  DataStruct) while facet SCREEN panels read `Signal (au)` (the grid's
  `buildOpts` call passed no `seriesLabels` at all) — three different strings
  for one series. Pre-existing, not a regression, but the acceptance criteria
  above were ticked without a carve-out and nothing tested it. Both legs now
  apply ONE rule, `lib/figureSpecSeries.ts`'s new `seriesDisplayLabel(label,
  unit, legend)` (rename verbatim, else `"label (unit)"` — the same rule
  `uplotOpts.buildOpts` and `calc.figure_labels.series_display_name` apply):
  `lib/figureSpecFacets.ts` takes the channel-keyed renames and composes with
  it, the relabelled `facetData` copy in `lib/figureSpec.ts` is deleted, and
  `Stage/useMultiPanelStage.ts` passes the store's `seriesLabels` into the
  facet grid. `lib/facet.ts`'s `FacetPanel` now carries `channels` (the
  dataset channel behind each payload series) because the default
  (`yKeys === null`) channel list is resolved per row-slice and can differ
  panel to panel, so neither consumer can reconstruct it from the binding.
  Tests at both layers: `lib/figureSpecFacets.test.ts` (new file, 8 tests) and
  `Stage/MultiPanelStage.test.tsx`'s "a legend rename reaches every facet
  panel's legend, verbatim" (which reads the label real `buildOpts` put on the
  real uPlot options), plus a facet row in `regressionMatrix.test.ts`'s
  BUG-014 test asserting the two legs' facet projections are EQUAL.
- **Finding 3 (NIT) — `lib/spatialPageExport.ts` shipped decoded Origin
  captions as `dataset.labels`; fixed the same way.** Measured on the wire
  the builder produced: `_figure_series` resolved
  `['Decoded caption (au)', '_nolegend_ (au)']` before and
  `['Decoded caption', '_nolegend_']` after. **The `(au)` suffix disappearing
  IS the BUG-014 rule applied consistently** — a decoded caption is
  presentation, so the unit is not re-appended to it. The `_nolegend_`
  sentinel still suppresses by its leading `_` either way, and the wire
  `dataset` now keeps the workbook's own column names (which is what that
  function's `fallbackYLabel` already read).
- **Finding 4 (NIT) — RESIDUAL, pinned not fixed: an EMPTY rename.** `""` is
  honoured verbatim on the wire and by `series_display_name`, but matplotlib
  drops a zero-length label from the legend exactly as it drops a leading-`_`
  one, so the series loses its legend ROW on export while uPlot still draws a
  blank row with its swatch on screen. "Identical text on both legs"
  therefore degenerates to "blank row vs no row" for `""` alone. Pinned by
  `test_an_empty_rename_drops_the_series_from_the_rendered_legend`
  (measured: `['Series B (au)', 'Series C (au)']`). Deliberately NOT papered
  over with a `" "`: which leg should move is the owner's call, and a space
  would silently change what the user typed. (The pre-fix wire rendered
  `" (au)"` here, so this is a change from one divergence to another. The
  rename UI itself cannot produce this residual — `store/useApp.ts`'s
  `setSeriesLabel` trims and `delete`s the override on a blank/whitespace-
  only rename — so `""` can only reach a document via a restored/hand-edited
  `.dwk` or the `overlayCurveLabels`/dual-selection merge paths, added
  2026-09-17, round 3 finding 4.)
- **Finding 5 (NIT) — stale `FigureRequest` field docs.** The
  `series_styles` description already gained `legend` in `da00c042`
  (BUG-013's own review round moved it to `export_figures_schema.py` as a
  `Field(description=...)`). Left to fix and fixed here: `group_col`'s
  comment claiming "`series_styles` is not applied in this path either" (its
  STYLE keys are not; its `legend` key IS), the same claim echoed inside
  `WATERFALL_OFFSETS_DOC`, and `FigureFacet`'s docstring, which pointed at
  `lib/figureSpec.ts` for a builder that now lives in `figureSpecFacets.ts`
  and said nothing about a panel label being FINISHED text. Comment/
  description-only; `frontend/api/openapi.json` and
  `frontend/src/lib/api/schema.d.ts` regenerated and committed (the two
  `Field(description=...)` strings do reach the generated artefacts).
- **Finding 6 (NIT) — a fixture assertion posing as a product one.**
  `test_a_renamed_series_renders_its_legend_text_exactly`'s last line rebuilt
  `_renamed_payload(...)` and asserted a property of the fixture helper. It
  now hoists the payload it actually POSTs, asserts the label AND unit on
  that object before the request, and adds `"Series A" not in svg` — so the
  test can only pass if the rename reached the renderer through the
  presentation field.
- **Finding 7 (NIT) — an untested behavioural claim, now pinned.**
  "`sanitizeExportSeriesStyles` deliberately does not restore a `legend`"
  appears in the code comment, the commit body and this entry, but the
  allowlist dropped it only incidentally. `publicationStyles.test.ts` now
  pins both halves (a legend beside a valid key is stripped; an entry whose
  only key is a legend becomes `null`).
- **Finding 8 (NIT) — record hygiene.** The bundle pair's parent is corrected
  above, and the duplicated empty `Agent verification` / `Owner verification`
  / `Notes` template rows are removed.
- Module ceilings this round: `Stage/useMultiPanelStage.ts` sat exactly on its
  791-line pin, so the facet render leg was extracted to the new
  `Stage/facetGridRender.ts` (`renderFacetGrid` + `resizeFacetGrid`); the pin
  ratchets DOWN to 787. `lib/figureSpec.ts` 483, `lib/figureSpecFacets.ts`
  104, `lib/figureSpecSeries.ts` 280, `lib/spatialPageExport.ts` 287,
  `routes/export_figures.py` 490, `routes/export_figures_schema.py` 125 —
  all under 500, none pinned, no pin raised. (Corrected 2026-09-17, round 3
  finding 5: these two Python counts were originally recorded by
  `split("\n")`, one more than `tests/test_repo_integrity.py`'s own
  `splitlines()` rule gives — the TS counts beside them already matched
  `architecture.test.ts`'s `split("\n").length` exactly.)
- Agent verification (review round): sabotage table, each reverted with
  `git checkout --` and the worktree verified clean afterwards —

  | sabotage | failing tests |
  |---|---|
  | `figureSpecFacets.ts` composes ``` `${label} (${unit})` ``` again instead of `seriesDisplayLabel` | 5 — `figureSpecFacets.test.ts` ×4, `regressionMatrix.test.ts`'s BUG-014 facet row |
  | `facetGridRender.ts` passes `seriesLabels: undefined` to `buildOpts` | 1 — `MultiPanelStage.test.tsx` "a legend rename reaches every facet panel's legend, verbatim" |
  | `facet.ts` returns an EMPTY `FacetPanel.channels` (payload itself untouched) | 6 — `figureSpecFacets.test.ts` ×4, `regressionMatrix.test.ts` ×1, `MultiPanelStage.test.tsx` ×1. (Corrected 2026-09-17, round 3 finding 6: reaching 11 and moving the committed `facet` golden needs ALSO starving `buildColumns` of its channel list — a strictly larger edit than the reported field alone; see the round 3 entry.) |
  | `spatialPageExport.ts` builds no `legends` at all | 1 — `spatialPageExport.test.ts` "carries decoded partial legend entries as presentation…" |
  | `publicationStyles.ts` restores a string `legend` | 1 — `publicationStyles.test.ts` "deliberately does NOT restore a legend…" |
  | `series_display_name` uses `if legend:` (drops `""`) | 1 — `test_an_empty_rename_drops_the_series_from_the_rendered_legend` |
  | `series_display_name` ignores `legend` entirely | 3 — the renamed, renamed-solo-axis and empty-rename tests |

  Gate: `uv run ruff check src tests tools` (All checks passed);
  `uv run mypy src` (296 files, no issues);
  `uv run pytest -q` over `test_export_vector_structure.py`,
  `test_api_export*.py`, `test_api_report_export.py`,
  `test_io_report_export.py`, `test_repo_integrity.py`,
  `test_openapi_snapshot.py`, `test_calc_figure.py` → **298 passed, 1
  skipped**; `npx tsc -b --force` (exit 0);
  `npx eslint src --max-warnings=0` (exit 0);
  `npx vitest run src/lib src/store src/components/Stage
  src/architecture.test.ts` → **406 files, 7779 tests, 0 failed** (the
  `src/store` scope finding 1 says was missing, included deliberately);
  `node scripts/freeze-regression-matrix.mjs --check` → 1 test passed (the
  `facet` golden is unchanged — no fixture carries a rename).
- Bundle (measured, review round): parent `da00c042` **911,488 B** eager ->
  this commit **911,526 B**, **+38 B** (one new eagerly-reachable module
  boundary, `Stage/facetGridRender.ts`, split out of a file that was already
  eager; no new module enters the eager graph). `node
  scripts/check-bundle-size.mjs` reports 890.2 kB of the 898.8 kB budget, up
  from 890.1 kB — 8.7 kB of headroom, budget unmoved. Both builds ran in the
  same worktree with `node_modules/.vite` cleared, against a `node_modules`
  installed by `npm ci` from the same (unchanged) lockfile.
  **Correction (2026-09-17, round 3 finding 3): `da00c042` is not this
  commit's parent — `git rev-parse HEAD~1` of `8a8d92b1` is `caa10f88`, four
  commits later than `da00c042`, and the three commits in between
  (`2d8b9b57`, `0565b674`, `caa10f88`) all touch eager frontend source. The
  **real** pair, re-measured in a scratch worktree with `node_modules/.vite`
  cleared after `npm ci`: `caa10f88` **912,915 B** eager -> `8a8d92b1`
  **912,953 B**, **+38 B** — the same delta by coincidence, on the correct
  SHAs this time; do not reuse the `da00c042`/911,488/911,526 numbers above
  for anything.

#### Round 3 (2026-09-17) — closes the round-2 review's remaining findings

A second adversarial review of `8a8d92b1` returned 3 CONFIRMED + 4 NITs.
Closed by `fix(stage): BUG-014 round 3 — background facet grids honour the
rename; a null rename derives the label`, on top of `230a174a`:

- **Finding 1 (CONFIRMED) — a BACKGROUND window's facet grid still ignored
  the rename.** `components/windows/BackgroundAltModes.tsx`'s
  `BackgroundStackWindow` (the SECOND caller of `useMultiPanelStage` — the
  facet grid a background window renders when it carries a durable
  `view.facetKey`, per the L2 fix `BackgroundPlotWindow.tsx` already made)
  passed `seriesStyles` but not `seriesLabels`, so a renamed channel read its
  derived `"Signal (au)"` in every panel of a background window's facet grid
  while the focused stage, the flat export, and the facet export all read
  the rename verbatim — a fourth string for the same series, on the one leg
  the round-2 fix did not reach. Fixed by passing `seriesLabels:
  view.seriesLabels` beside `seriesStyles`, mirroring where the flat
  background leg already gets it (`BackgroundPlotWindow.tsx`'s
  `BackgroundXYWindow`). The new `useMultiPanelStage.ts` param doc claim ("a
  background window passes nothing … it renders the stack mode only") was
  also false — `BackgroundPlotWindow.tsx`'s own module doc says a background
  window renders the facet grid too, for a durable `facetKey` — corrected in
  place, net line count unchanged (787/787, zero headroom, per round-2
  finding 7 below). Pinned by the background twin of
  `MultiPanelStage.test.tsx`'s facet-rename test, added to
  `BackgroundPlotWindow.test.tsx`.
- **Finding 2 (CONFIRMED) — `seriesDisplayLabel` was `!== undefined`, not the
  `??` its own doc claimed.** A `null` legend (reachable: `sanitizePlotView`
  casts a restored/hand-edited `.dwk`'s `seriesLabels` to
  `Record<number, string>` without validating each value is a string) shipped
  `label: null` on the facet wire — a 422 on the backend — while every other
  leg (the screen, the flat export via `series_styles[i].legend`, the
  backend's own `if legend is not None`) degrades gracefully. One-token fix:
  `return legend ?? (unit ? \`${label} (${unit})\` : label);`. Pinned by
  `seriesDisplayLabel("Signal", "au", null)` -> `"Signal (au)"` and a facet
  spec built with `seriesLabels: {1: null}` carrying the derived label in
  `figureSpecFacets.test.ts`.
  **`sanitizePlotView` validation — residual, not fixed.** Whether
  `sanitizePlotView` should drop non-string `seriesLabels` entries: it
  should (the flat and facet legs both now degrade gracefully for a `null`
  *value* reaching `seriesDisplayLabel`, but a non-string *key-to-value* pair
  surviving sanitization is still a latent contract gap upstream of it), but
  `frontend/src/lib/plotview.ts` measures 981/981 lines against
  `architecture.test.ts`'s own pin (zero headroom, the same state
  `useMultiPanelStage.ts` was in going into round 2) — implementing the
  filter needs a new helper, which this round does not have room for without
  moving a pin. Recorded as a residual: `frontend/src/lib/plotview.ts:757-760`
  (`seriesLabels: typeof o.seriesLabels === "object" && ... ? (o.seriesLabels
  as Record<number, string>) : {}` — cast through unvalidated).
- **Finding 3 (CONFIRMED) — record hygiene, the bundle pair, again.** See the
  correction above this section. Also re-measured this round's OWN commit
  against its parent. **Corrected in round 4 (2026-09-17):** the parent used
  here was `230a174a`, the PRE-CHERRY-PICK base, not `git rev-parse
  e0ab164c^` = **`59d79a68`** (three commits touching nine eager source
  modules land in between), so the `912,953 B` recorded for both sides was
  neither commit's number. Re-measured on the real pair, same method:
  `59d79a68` **913,293 B** eager -> `e0ab164c` **913,293 B**, **+0 B**. The
  DELTA claim survives (the commit adds no import and no eager module); the
  absolute figures did not. Every pair measured in scratch worktrees (`git
  worktree add` off the scratchpad, `npm ci`, `node_modules/.vite` cleared,
  `node <scratchpad>/exactbytes.mjs <tree>/src/quantized/web`), per
  `agent_rules.md`'s standing bundle-measurement rule.
- **Nit 4 — closed.** The `""` residual note now says `setSeriesLabel`
  trims-and-deletes a blank/whitespace-only rename, so the rename UI itself
  cannot produce it — only a restored/hand-edited `.dwk` or the
  `overlayCurveLabels`/dual-selection merge paths can (edited into the
  Finding 4 entry above).
- **Nit 5 — closed.** The round-2 "Module ceilings this round" line recorded
  `routes/export_figures.py 491, routes/export_figures_schema.py 126` by
  `split("\n")`; `tests/test_repo_integrity.py`'s own `splitlines()` rule
  gives **490** / **125** (both measured against the current tree — neither
  file changed since). Corrected in place above.
- **Nit 6 — closed.** The round-2 sabotage table's `channels: []` row claimed
  11 failures for "an EMPTY `FacetPanel.channels`"; the literal edit
  (emptying only the reported field, payload untouched) gives 6. Reaching 11
  and moving the committed `facet` golden needs ALSO starving `buildColumns`
  of its channel list — a strictly larger edit. Reworded in place above to
  describe the literal edit's own count, with a note on what a larger edit
  would take.
- **Nit 7 — follow-up recorded, not extracted.** `Stage/useMultiPanelStage.ts`
  is still exactly on its 787-line pin after this round's doc-only edit (net
  zero lines). The next feature touching this file will need to extract a
  sibling module first — flagged here rather than done speculatively.
- Agent verification (round 3): each new/changed assertion sabotaged and
  reverted, worktree verified clean afterwards —

  | # | sabotage | failing test(s) |
  |---|---|---|
  | 1 | `BackgroundAltModes.tsx`'s `BackgroundStackWindow` reverted to omit `seriesLabels` | 1 — `BackgroundPlotWindow.test.tsx` "a legend rename reaches every facet panel's legend, verbatim, in a BACKGROUND window too" |
  | 2 | `seriesDisplayLabel` reverted to `if (legend !== undefined) return legend;` | 2 — `figureSpecSeries.test.ts` "degrades to the derived label for a null legend, not `!== undefined`", `figureSpecFacets.test.ts` "a null rename (a hand-edited document's `seriesLabels`) degrades to the derived label" |

  Nothing stayed green under sabotage; both restores verified with
  `npx vitest run` passing again and `git diff` clean before the real fix
  was reapplied.
- Gate: `npx tsc -b --force` (exit 0, no output); `npx eslint src
  --max-warnings=0` (exit 0, no output); `npx vitest run src/lib/figureSpec
  src/lib/regressionMatrix.test.ts src/lib/plotview src/components/Stage
  src/components/windows src/store/plotRecipes.test.ts
  src/architecture.test.ts` -> **66 files, 1202 tests, 0 failed** (no `FAIL`
  lines; no GridViewport.perf / freezeRegressionMatrixCheck flakes to
  re-run); `node scripts/freeze-regression-matrix.mjs --check` -> 1 test
  passed (the `facet` golden unchanged — this round touches no fixture);
  `uv run pytest -q tests/test_repo_integrity.py` -> **12 passed**.
- Module ceilings this round: `Stage/useMultiPanelStage.ts` 787/787 (doc fix
  only, net zero lines — see Nit 7); `lib/figureSpecSeries.ts` **291** on the
  committed tree (the `279 (was 280)` first recorded here was measured on the
  pre-cherry-pick base `230a174a`, which lacks `fe50280f`'s +11 lines —
  corrected in round 4; the one-line `if`/`return` collapse is still what
  this round contributed, i.e. 292 -> 291); `lib/plotview.ts` 981/981
  (untouched — see Finding 2's residual); no pin raised. All by
  `architecture.test.ts`'s own `split("\n").length` rule.

#### Round 4 (2026-09-17) — the stack and break panels, and the sanitizer residual

A third adversarial review of `e0ab164c` returned 2 CONFIRMED + 3 NITs.
Closed by `fix(stage): BUG-014 round 4 — stack and break panels honour the
rename; non-string renames are dropped at the sanitizer`, on top of
`b3fb6668`:

- **Finding 1 (CONFIRMED) — the plain STACK and paneled X-BREAK legs still
  showed the derived label.** Round 3 fixed the facet grid; the other two
  legs of the same render effect still called `buildOpts` with no
  `seriesLabels`. That is visible, not cosmetic: `buildOpts` sets
  `legend: { show: false }` and `PlotStage.tsx` mounts `MultiPanelStage`
  INSTEAD of `PlotViewport` + `PlotLegend`, so the only slot a series' name
  appears in is the panel's Y-AXIS label (`uplotOpts`' `soloLabel`, fed by
  the same resolved `labels` array `seriesLabels` overrides) — while the
  EXPORT of those same views carries the rename (`lib/figureSpec.ts`'s
  `legends = plotted.map((ch) => st.seriesLabels[ch])` ->
  `series_styles[i].legend`; a stack or break view exports as the flat
  figure). Screen and export therefore disagreed in two more legs, focused
  and background alike. Fixed by projecting the channel-keyed renames onto
  each leg the way `facetGridRender.ts` already did: the stack leg gets
  `plotted.map((ch) => seriesLabels[ch])` (one entry per panel — `splitPayload`
  makes exactly one single-series panel per plotted channel, the same
  indexing `styleList` uses), and the break leg gets the panels' own channel
  list, re-derived as `yKeys ?? defaultDenseChannels(analysisData(active))`
  because a `BreakPanel` (unlike a `FacetPanel`) carried no `channels` field.
  **That derivation was WRONG and is replaced in round 5 below.** It assumed
  every break panel holds the same channel set; `breakPayloads` in fact
  resolves each panel's list over that panel's own x-slice, so with a null
  `yKeys` the panels can legitimately differ, and the fail-closed guard —
  which compared only `breakPanels[0]`'s series COUNT — let every
  equal-count/different-membership case through and mislabeled it.
  **Funded by an extraction, not a pin bump** (round 3's Nit 7 flagged this
  exact need): `Stage/useMultiPanelStage.ts` was ON its 787-line pin, so the
  STACK and BREAK render legs moved to `Stage/stackPanelRender.ts` (102
  lines) and `Stage/breakPanelRender.ts` (112 lines) — the siblings
  `facetGridRender.ts` already set the pattern for — and the pin ratcheted
  **787 -> 757**.
  The param doc that asserted "the plain stack mode ... never showed a legend
  rename either way" is rewritten to state what the three legs actually do
  (and, per Nit 5, that a background window renders the x-break arrangement
  too, from `document.plot.axisBreaks.x` via `durableComposition`).
- **Finding 2 (CONFIRMED) — the `sanitizePlotView` residual understated a
  CRASH, and its "no room" justification did not hold.** Round 3 recorded
  leaving `seriesLabels` unvalidated as a latent gap. Measured: a `null`
  degrades everywhere (round 3's `??`), but any OTHER non-string value
  reached `buildOpts` -> `richLabelAst` -> `richtext.hasMarkup`, whose
  `s.includes("$")` threw an UNCAUGHT `TypeError` and took the Stage canvas
  down — strictly worse than the 422 the same value causes on the facet wire
  (`FigureFacetSeries.label: str`). The deferral reason ("981/981, no room
  for a helper") also did not survive arithmetic: the four-line unchecked
  ternary collapses to one call plus one import. Fixed by validating values
  with the SAME helper the two sibling restore paths already used, now a
  single copy in the new leaf module `lib/sanitizeRecord.ts`
  (`keyedRecord`/`isString`): `lib/plotRecipeIO.ts`'s `strKeyedRecord` and
  `lib/techniqueViewMemory.ts`'s `strRecord` are deleted in favour of it, so
  all three `.dwk`/recipe restore paths validate this field through one
  function. `lib/plotview.ts` ratchets **981 -> 980**; no pin raised. (One
  behaviour nuance, **corrected in round 5 below**: the shared helper passes
  KEYS through verbatim, where `strRecord` used to normalize them with
  `Number(k)`. The "`"01"` now never matches a channel" claim holds only for
  `lib/plotview.ts`'s map — measured. On the technique-memory path
  `applyTechniqueMemory` iterates with `Number(key)`, so a `"01"` in
  `seriesLabels` still lands on channel 1; what silently changed there is
  `TechniqueViewMemory.labels`, which IS read by numeric index. Round 5 gives
  that file back its numeric keys.)
  Two stale test comments that cited the unvalidated cast as the reason a
  `null` is reachable (`figureSpecSeries.test.ts`, `figureSpecFacets.test.ts`)
  are corrected in place: the `.dwk` route is closed, the type hole is not,
  so those tests now pin the degrade rule itself.
- **Nit 3 — closed.** Round 3's bundle pair and `lib/figureSpecSeries.ts`
  line count were both measured on the pre-cherry-pick base; both corrected
  in place above with re-measured numbers (`59d79a68` -> `e0ab164c`,
  913,293 -> 913,293 B; `figureSpecSeries.ts` 291).
- **Nit 4/5 — closed** with Findings 1 and 2 (the ceilings line and the
  param doc's missing x-break arrangement).
- Agent verification (round 4): each new/changed assertion sabotaged and
  reverted, `git status --porcelain` clean afterwards —

  | # | sabotage | failing test(s) |
  |---|---|---|
  | 1 | `stackPanelRender.ts`: drop the per-panel `seriesLabels` from `buildOpts` (the pre-fix stack leg) | 4 — `MultiPanelStage.test.tsx` "reaches the renamed channel's STACK panel verbatim…", "keys a STACK rename by CHANNEL, not by panel position", "SCREEN label == EXPORT legend … in a stack view"; `BackgroundPlotWindow.test.tsx` "… in a BACKGROUND window too" |
  | 2 | `breakPanelRender.ts`: drop `seriesLabels` from `buildOpts` (the pre-fix break leg) | 3 — `MultiPanelStage.test.tsx` "reaches EVERY x-break panel verbatim", "SCREEN label == EXPORT legend … in an x-break view"; `BackgroundPlotWindow.test.tsx` "a legend rename reaches every X-BREAK panel, verbatim, in a BACKGROUND window too" |
  | 3 | `useMultiPanelStage.ts`: drop the break fail-closed guard (project even on a length mismatch) | 1 — `MultiPanelStage.test.tsx` "passes no renames at all when the view's channel selection no longer matches the built panels" |
  | 4 | `plotview.ts`: restore the unchecked `seriesLabels` cast | 3 — `plotview.test.ts` "keeps string renames and drops every other value type", "leaves the canvas builder with nothing that can throw in richtext"; `figureSpecFacets.test.ts` "a NUMBER rename in a restored view never reaches the facet wire" |
  | 5 | `useMultiPanelStage.ts`: key the stack renames by POSITION instead of channel | 1 — `MultiPanelStage.test.tsx` "keys a STACK rename by CHANNEL, not by panel position" |

  Sabotage 5 is why that test exists: the first version of the stack tests
  used `yKeys = [0, 1]`, where position and channel coincide, and survived it.
- Gate: `npx tsc -b --force` (exit 0, no output — it caught a missing
  `onReadout` in a new test that vitest, which does not typecheck, ran
  green); `npx eslint src --max-warnings=0` (exit 0, no output); `npx vitest
  run src/lib/plotview src/lib/figureSpec src/lib/regressionMatrix.test.ts
  src/lib/richtext src/components/Stage src/components/windows
  src/store/plotRecipes.test.ts src/architecture.test.ts` -> **68 files,
  1287 tests, 0 failed** (0 `^ FAIL` lines in the saved log); `node
  scripts/freeze-regression-matrix.mjs --check` -> 1 test passed (no fixture
  touched); `uv run pytest -q tests/test_repo_integrity.py` -> **12 passed**.
- Bundle (exact eager bytes, `npm ci` + `node_modules/.vite` cleared on both
  sides): parent `git rev-parse HEAD~1` = **`b3fb6668`** **913,348 B** ->
  this commit **913,249 B**, **−99 B**. Two new eager modules
  (`stackPanelRender`/`breakPanelRender`) are code MOVED out of a module that
  was already eager, and `sanitizeRecord.ts` replaces two inline copies, so
  the net is a small reduction.
- Module ceilings this round (`architecture.test.ts`'s own
  `split("\n").length`): `Stage/useMultiPanelStage.ts` **757** (pin 787 ->
  757); `lib/plotview.ts` **980** (pin 981 -> 980); new
  `Stage/stackPanelRender.ts` 102, `Stage/breakPanelRender.ts` 112,
  `lib/sanitizeRecord.ts` 43; `lib/plotRecipeIO.ts` 377 (was 384),
  `lib/techniqueViewMemory.ts` 233 (was 241). No pin raised.

#### Round 5 (2026-09-17) — the break panels carry their own channel list

A fourth adversarial review of `3dee67df` returned 1 CONFIRMED regression,
2 confirmed record/doc defects and 5 nits. Closed by
`fix(stage): BUG-014 round 5 — break panels carry their own channel list;
technique memory keeps numeric keys`, on top of `1fcc4137`:

- **F1 (CONFIRMED, a REGRESSION against round 4's parent) — the break leg's
  re-derivation mislabeled silently, and its fail-closed guard could not
  see it.** `useMultiPanelStage.ts` derived ONE channel list
  (`yKeys ?? defaultDenseChannels(analysisData(active), xKey)`) over the
  WHOLE dataset and applied it positionally to every panel, guarding only
  that its length matched `breakPanels[0].payload.series.length`. But
  `lib/facet.breakPayloads` builds each panel from its own x-slice and
  resolves `yChannels ?? defaultDenseChannels(<that slice>, xKey)` there, so
  with a null `yKeys` — the DEFAULT view, and what `breakAtGaps` passes for a
  non-active dataset — panels legitimately hold different channels, and any
  equal-count/different-membership pair walked through the guard. Measured on
  `3dee67df` (all three reproductions are now committed tests, and all three
  fail against that commit's files):
  * a 23-row set where channel 2 is finite only in the 2-row segment after
    the gap (under the whole dataset's 10% density floor, densest in its own
    panel) and channel 0 only before it: panels hold `[0,1]` then `[1,2]`,
    whole-data derivation `[0,1]` (same LENGTH), rendered
    `[["RENAMED-FIELD","Signal (au)"],["RENAMED-FIELD","Aux (V)"]]` — panel
    1's channel-1 curve wearing channel 0's rename;
  * the same shape with two channels, so both panels are single-series and
    `soloLabel` paints the Y-AXIS: measured
    `["RENAMED-FIELD","RENAMED-FIELD"]` on panels whose data is channel 0
    then channel 1. That is strictly worse than before round 4, which passed
    no renames and let panel 2 read its correct derived `"Aux (V)"`;
  * `yKeys [0,1]` then `breakAtGaps` then the ordinary `setYKeys([1,2])` (two
    ChannelsCard toggles; `setYKeys` does not clear `composition`): panels
    still hold `[0,1]`, measured `["SIGNAL-NAME","AUX-NAME"]` on both.
  Fixed the way round 2 fixed the facet grid: `BreakPanel` gains
  `channels: number[]`, resolved ONCE in `breakPayloads` and handed to the
  same `buildColumns` call, and `breakPanelRender.ts` takes the store's
  channel-keyed map and projects `p.channels.map((ch) => seriesLabels[ch])`
  PER PANEL — exactly what `facetGridRender.ts` does with `FacetPanel`. The
  `breakLabels` memo and its fail-closed guard are deleted (with the
  `analysisData`/`defaultDenseChannels` imports they were the only users of),
  and the guard's test is replaced by the three reproductions above. Exact
  beats heuristic: the guard's own failure mode left screen showing derived
  labels while the export shipped the rename.
- **F2 (CONFIRMED) — the doc promise the break leg rested on was false.**
  `breakPanelRender.ts`, `useMultiPanelStage.ts` and this plan's round-4
  Finding 1 all asserted "every break panel is the SAME channel set sliced to
  its own x-segment". `lib/facet.ts`'s `FacetPanel.channels` already
  documented the opposite for the identical construction. All three are
  rewritten to the true rule (the per-panel list is carried on the panel);
  round 4's Finding 1 above is corrected in place.
- **F3 (CONFIRMED, low severity) — the round-4 `"01"` claim was wrong for the
  technique-memory path, and left that file internally inconsistent.**
  Measured: `applyTechniqueMemory` iterates `Object.entries` and calls
  `resolve(Number(key))`, so a `"01"` in a persisted `seriesLabels` still
  lands on channel 1 — no behaviour change at all there. The claim holds only
  for `lib/plotview.ts`'s map. What DID change unstated is
  `TechniqueViewMemory.labels`, which is read by numeric index
  (`remembered.labels[ch]`): a `"01"` now misses and silently takes the
  "never captured a label -> by-index passthrough" branch instead of the
  relocate-or-drop one. `numRecord` in the same file still normalized keys,
  so the file disagreed with itself. Fixed by making the KEY POLICY explicit
  and per-consumer: `lib/sanitizeRecord.ts` gains `numKeyedRecord` (keys
  through `Number`, non-finite keys dropped, same value guard) plus an
  `isFiniteNumber` guard, and `techniqueViewMemory.ts` routes all three of
  its channel-indexed maps (`seriesLabels`, `labels`, `errKeys`) through it —
  restoring the numeric normalization its own `strRecord`/`numRecord` always
  had. `keyedRecord` keeps verbatim keys for the string-keyed callers
  (`plotRecipeIO`'s signature-entry ids) and for `lib/plotview.ts`. The new
  `lib/sanitizeRecord.test.ts` (N5 — the module had no direct test) pins both
  policies, including `"01"` in each direction.
- **N4 — closed, not recorded.** `labelList`/`styleList`/`errorBarsList`
  recomputed synchronously from `plotted` while `payload` only moved when
  `fetchPlot` resolved, so between a channel toggle and its payload landing
  the OLD payload's panels rendered wearing the NEW lists. Measured on
  `1fcc4137`: hiding channel 0 of three renamed channels rebuilt three panels
  as `[{series:"N1",firstY:10},{series:"N2",firstY:100},{series:"Aux (V)",firstY:1000}]`
  — every panel wrong for a frame. The stack payload is now stored together
  with the channel list it was fetched for and all three lists derive from
  that snapshot, so the transient cannot exist (measured: 8 uPlot
  constructions across the toggle before, 5 after — the three
  wrong-labelled intermediates are gone). Pre-existing for `styleList` and
  `errorBarsList` since before round 4; fixed for all three at once.
- **N7 — narrowed in the docs, and the untested half pinned.**
  `uplotOpts.soloLabel` returns a label only when exactly ONE series sits on
  an axis, so a MULTI-channel break panel has no legend and no solo axis
  label: no series name appears on screen there at all while the export still
  carries the rename. `breakPanelRender.ts`'s header now says so instead of
  claiming unqualified screen==export parity. **Residual:** that shape stays
  unreachable-by-design for a rename until a break view grows a legend
  (adjacent to FEATURE-001). The other half of the nit — a y2 channel's stack
  panel painting the rename on `axes[2]`, correct but untested — is now
  pinned by `MultiPanelStage.test.tsx` "paints a renamed Y2 channel's STACK
  panel on the SECONDARY axis".
- **N8 — recorded as a residual (pre-existing, out of scope). Widened by
  review round 5 (N3): also ignores `seriesOrder` and `channelRoles`.**
  `lib/facet.breakPayloads` (`frontend/src/lib/facet.ts:247`) resolves each
  panel's channels as `yChannels ?? defaultDenseChannels(sliced, xKey)` —
  never `plotdata.effectiveChannels`, so it honours neither `hiddenChannels`
  nor `y2Keys`: measured with `hiddenChannels [1]` and `y2Keys [2]`, a break
  panel's series are `Field`/`Signal`/`Aux` all on axis 0 — the hidden
  channel drawn, the y2 channel on the primary axis — while the flat view
  and the export drop/split them. It also drops the user's `seriesOrder` and
  never filters a `channelRoles` label/ignore column. Measured (review round
  5, `frontend/src/lib/facet.ts:247` vs `frontend/src/lib/plotdata.ts:237`):
  `effectiveChannels(data, null, null, {2:"label"}, [1,0])` -> `[1, 0]`
  (role-filtered, user-ordered) while `breakPayloads(data, null, null,
  [[lo,hi]]).channels` -> `[0, 1, 2]` on every panel (unfiltered,
  dataset-natural order) — a `label`-role column is drawn as a curve in
  every break panel and the user's draw order is dropped. Same root cause
  and the same prerequisite (`channels` on the panel), so it belongs in this
  one residual bullet with `hiddenChannels`/`y2Keys`. `store/useApp.ts`'s
  `breakAtGaps` (:1359) passes only `xKey`/`yKeys`. Carrying `channels` on
  the panel is the prerequisite for fixing it, not the fix.
- **N4 (review round 5) — the screen/export parity paragraph in
  `breakPanelRender.ts:24-28` narrows "screen == export" to a break panel
  that HAS a visible name slot (single series on its axis), but that is not
  the only divergence on the very fixture round 5 is built around —
  membership is a second, larger one. Measured on `divergentData()` with a
  LIVE `breakAtGaps([[20,100]])`: screen panels read
  `[["RENAMED-FIELD","Signal (au)"], ["Signal (au)","Aux (V)"]]` while the
  export spec carries `series_styles` for only 2 channels (`[0,1]`,
  whole-dataset `effectiveChannels`) and `x_breaks: undefined` — no break at
  all — because a LIVE `breakAtGaps` writes no durable field
  (`store/plotRecipes.ts:63`, an already-documented GAP). Panel 2's
  on-screen channel is therefore not in the export at all. Pre-existing and
  orthogonal to the round-5 rename fix; recorded here beside N8 since the
  in-source comment (round-5 change scope) stays narrowed to the
  visible-slot caveat alone.**
- **N6 — noted, no action.** `plotview.test.ts` importing `buildOpts` pulls
  the uPlot chain into a pure-lib test (+0.4 s); the assertion it buys is
  worth it.
- Agent verification (round 5): every new/changed assertion sabotaged and
  reverted, the worktree clean afterwards —

  | # | sabotage | failing test(s) |
  |---|---|---|
  | 1 | `breakPanelRender.ts`: pass `seriesLabels: undefined` to `buildOpts` (the pre-round-4 break leg) | 5 — `MultiPanelStage.test.tsx` "reaches EVERY x-break panel verbatim", "SCREEN label == EXPORT legend … in an x-break view", "labels each break panel by ITS channels…", "puts the renamed channel's name on the Y-AXIS of its OWN panel only", "labels a break panel by the channels it was BUILT from…" |
  | 2 | `lib/facet.ts`: store the WHOLE-dataset channel list on each panel (`defaultDenseChannels(data, …)`) | 3 — `facet.test.ts` "carries each panel's OWN channel list, which can differ panel to panel"; `MultiPanelStage.test.tsx` "labels each break panel by ITS channels…", "puts the renamed channel's name on the Y-AXIS of its OWN panel only" |
  | 3 | restore round 4's three files verbatim (`facet.ts`, `breakPanelRender.ts`, `useMultiPanelStage.ts` as of `3dee67df`) — i.e. the regression itself | 3 — the three reproductions, with the measured wrong labels `["RENAMED-FIELD","RENAMED-FIELD"]` and `["SIGNAL-NAME","AUX-NAME"]` |
  | 4 | `sanitizeRecord.ts`: `numKeyedRecord` passes keys verbatim | 3 — `sanitizeRecord.test.ts` "relocates a non-canonical numeric key onto its channel", "drops a key that is not a finite number at all"; `techniqueViewMemory.test.ts` "normalizes a non-canonical numeric key onto its channel…" |
  | 5 | `sanitizeRecord.ts`: `keyedRecord` normalizes keys through `Number` | 3 — `sanitizeRecord.test.ts` "keeps only entries whose value passes the guard", "leaves a non-canonical numeric key EXACTLY as written", "preserves the object's own key order" |
  | 6 | `stackPanelRender.ts`: drop the per-panel `seriesLabels` | **6** (corrected — review round 5, N5 below; was undercounted as 4) — the three round-4 stack tests, "paints a renamed Y2 channel's STACK panel on the SECONDARY axis", `MultiPanelStage.test.tsx` "never dresses a stack panel in another channel's rename while a re-fetch is in flight", and `BackgroundPlotWindow.test.tsx` "a legend rename reaches the renamed channel's STACK panel, verbatim, in a BACKGROUND window too" |
  | 7 | `lib/facet.ts`: `breakPayloads` ignores an explicit `yChannels` | **8** (corrected — review round 5, N5 below; was undercounted as 2) — the 2 `facet.test.ts` bindings tests, the 3 round-4 `MultiPanelStage.test.tsx` break tests, the round-5 "built from" test, `useEffectiveComposition.test.tsx`'s durable-fallback test, and `BackgroundPlotWindow.test.tsx` "a legend rename reaches every X-BREAK panel, verbatim, in a BACKGROUND window too" |
  | 8 | `useMultiPanelStage.ts`: derive the three per-panel lists from `plotted` again (the N4 shape) | 1 — `MultiPanelStage.test.tsx` "never dresses a stack panel in another channel's rename while a re-fetch is in flight" (8 constructions instead of 5) |

  Sabotage 7's first version of that test used the single-channel fixture,
  where the explicit list and the density default coincide, and survived it;
  it is now written against the divergent fixture.
- Gate: `npx tsc -b --force` (exit 0, no output); `npx eslint src --max-warnings=0`
  (exit 0, no output); `npx vitest run src/lib/facet.test.ts
  src/lib/composition.test.ts src/lib/sanitizeRecord.test.ts
  src/lib/techniqueViewMemory src/lib/plotview
  src/lib/regressionMatrix.test.ts src/components/Stage src/components/windows
  src/store/useApp.test.ts src/architecture.test.ts` -> **66 files, 1516
  tests, 0 failed** (0 `^ FAIL` lines in the saved log); `node
  scripts/freeze-regression-matrix.mjs --check` -> 1 test passed (the golden
  did NOT move — `BreakPanel` is not serialized into it); backend
  `tests/test_repo_integrity.py` -> **12 passed**.
- Bundle (exact eager bytes, `npm ci` on both sides, `node_modules/.vite`
  cleared before the local build): parent (this commit's `HEAD~1`) =
  **`1fcc4137`** **913,249 B** -> this commit **913,348 B**, **+99 B**
  (891.9 kB against the 898.8 kB budget, 6.9 kB under). The added bytes are
  the per-panel `channels` resolution, the per-panel projection and the
  payload/channel snapshot object; the round-4 entry's −99 B is exactly
  reversed.
- Module ceilings this round (`architecture.test.ts`'s own
  `split("\n").length`): `Stage/useMultiPanelStage.ts` **753** (pin 757 ->
  753); `Stage/breakPanelRender.ts` 124 (was 112); `lib/facet.ts` 384 (was
  369); `lib/sanitizeRecord.ts` 78 (was 43); `lib/techniqueViewMemory.ts` 231
  (was 233); `Stage/stackPanelRender.ts` 102 (unchanged). No pin raised.

#### Review round 5 — 2026-09-17 (`fix(lib): numeric record keys must be non-negative integers; canonical spelling wins a collision`)

A fifth adversarial review, of `65ecbf81`, returned **CLEAN**: the round-5 fix
itself is correct, minimal and exactly as advertised (regression reproduces on
the real parent with the recorded labels, `BreakPanel.channels` is provably
the array `buildColumns` consumed, all 14 of the review's own sabotages were
caught, and the N4 snapshot survives a forced out-of-order fetch / StrictMode
/ unmount-mid-flight race). It closed **2 CONFIRMED low-severity findings**,
both in `numKeyedRecord` — the one piece of `65ecbf81` that was itself new,
untested validation logic — plus **5 NITs** on the round's own record.

- **F1 (CONFIRMED, low severity) — fixed.** `Number("")` and `Number(" ")`
  are both `0` and finite, so `numKeyedRecord`'s bare `Number.isFinite`
  check let a blank or whitespace-only key from a hand-edited/truncated
  `.dwk` silently relocate onto channel 0 (measured: `labels: {"":
  "GHOST"}` -> `{0: "GHOST"}`, and the paired `errKeys`/`seriesLabels` maps
  the same way). `"0x10"`, `"1.5"` and `"1e0"` were also accepted and
  parked on an unreachable non-canonical channel forever; `"-1"` likewise.
  Checked `git show 3dee67df^:frontend/src/lib/techniqueViewMemory.ts` for
  the pre-round-4 behaviour: `numRecord`/`strRecord` both did bare
  `out[Number(k)] = val`, which trims whitespace and accepts a leading zero
  through `Number`'s own coercion but has the same `""`/`" "` -> `0` hazard
  and no integer/sign check at all. `numKeyedRecord` now accepts a key only
  when `key.trim()` matches `/^\d+$/` (so `""`, `" "`, `"0x10"`, `"1.5"`,
  `"-1"` and `"1e0"` are all dropped) and the parsed value is
  `Number.isInteger`; `"01"` and `" 1 "` still normalize onto channel `1`,
  matching the pre-round-4 helpers via `trim()`. Channel indices are
  decided to be non-negative by construction, so a negative key is dropped
  rather than parked unreachable — a deliberate narrowing past what
  `Number()` alone would still coerce, documented in the module header.
  Tests: `sanitizeRecord.test.ts` (new, written FAILING first against
  `65ecbf81`) plus a `.dwk`-shaped repro in `techniqueViewMemory.test.ts`
  using the review's own `{"": "GHOST"}` fixture.
- **F2 (CONFIRMED, low severity) — fixed.** A key collision resolved to the
  NON-canonical spelling regardless of file order (`{"1":"one","01":
  "oh-one"}` and the reverse both gave `{1: "oh-one"}`), because
  `Object.entries` always enumerates array-index-like keys — which is
  exactly the canonical, no-leading-zero decimal spelling — ascending and
  BEFORE any other string key, regardless of the source object's own
  insertion order. `numKeyedRecord` now keeps only the FIRST value written
  for a given normalized key (`!(key in out)`), so processing entries in
  that (always-canonical-first) order makes the canonical spelling win a
  collision in either file order without any extra bookkeeping. Tested both
  orders in `sanitizeRecord.test.ts`.
- **N3 — closed; folded into N8 above**, which now also records that
  `breakPayloads` ignores `seriesOrder` and `channelRoles`
  (`frontend/src/lib/facet.ts:247`), not only `hiddenChannels`/`y2Keys`.
- **N4 — closed; recorded beside N8 above** (the narrowed screen/export
  parity paragraph in `breakPanelRender.ts:24-28` misses a membership
  divergence, orthogonal to the round-5 rename fix).
- **N5 — closed; the sabotage table above is corrected in place.** Re-ran
  both sabotages myself against the round's own declared gate scope
  (`src/lib/facet.test.ts src/lib/composition.test.ts
  src/lib/sanitizeRecord.test.ts src/lib/techniqueViewMemory src/lib/plotview
  src/lib/regressionMatrix.test.ts src/components/Stage
  src/components/windows src/store/useApp.test.ts src/architecture.test.ts`
  — the same scope this round's own Gate line above uses): row 6
  (`stackPanelRender.ts` drops the per-panel `seriesLabels`) fails **6**,
  not the recorded 4 and not the review's own suggested 5; row 7
  (`lib/facet.ts`'s `breakPayloads` ignores an explicit `yChannels`) fails
  **8**, not the recorded 2 and not the review's own suggested 7. The
  review's re-verification (`bug014_review5.md`) used a narrower scope that
  excludes `src/components/windows` and `src/lib/regressionMatrix.test.ts`,
  which is why it undercounted both rows by exactly one
  `BackgroundPlotWindow.test.tsx` rename test that each sabotage also
  breaks (a STACK-panel rename test for row 6, an X-BREAK-panel rename test
  for row 7). The corrected counts and test names are measured against the
  scope this round's own Gate line records, restored clean after each
  (`git diff --stat` empty on both files post-restore).
- **N6 — noted, no action needed.** `useMultiPanelStage.ts` sits exactly at
  its `architecture.test.ts` pin, **753/753** (`split("\n").length`,
  confirmed), zero headroom: the next line added to this hook must be
  funded by an extraction first.
- **N7 — noted, no code change (the comment lives in source at its
  753/753 pin, with no room to add a clause).** `useMultiPanelStage.ts:233`
  ("Derived from this snapshot instead, the two cannot disagree") is
  accurate for `payload` <-> `channels` (both come from the one snapshot),
  but not for `channels` <-> `active`: `errorBarsList` (:282-285) derives
  from `payload.channels` (the snapshot) while reading `active.data`
  (live), and the fetch effect does not null `payload` when `active`
  changes, so across a dataset switch an old channel index can apply to the
  new dataset's data for one frame. Strictly better than before this round
  (panel count always matches the payload, which it did not when the list
  came from `plotted`), and no test moves — recorded here since the pin
  leaves no room to narrow the in-source wording itself.
- Gate (this review round): `npx tsc -b --force` (exit 0); `npx eslint src
  --max-warnings=0` (exit 0); `npx vitest run src/lib/sanitizeRecord.test.ts
  src/lib/techniqueViewMemory src/lib/plotview src/lib/plotRecipeIO
  src/architecture.test.ts` -> all passed (see the F1/F2 commit's own report
  for the exact count); `uv run pytest -q tests/test_repo_integrity.py` ->
  passed.

---

---

## ~~BUG-015 — hiding a series shifts later series' export palette colour, not the canvas'~~ **FIXED 2026-09-14**

**Priority:** P2 — a visible, wrong-looking export (recoloured series) with a
workaround (temporarily un-hide, export, re-hide, or manually recolour after
export), no data loss. Matches the same class of bug `SeriesCycle` was
already built to fix for the live Stage export — this is that fix not
reaching a saved document's export path.

**Scope correction (2026-09-15, review NIT 4):** "a saved document's export
path" UNDER-STATES it. `store/prefs.ts:105` defaults `autoSeriesStyles` to
`false`, and the positional correction was gated on that preference, so the
LIVE Stage export (Copy figure / Copy figure (vector) / Export figure…) was
equally broken for every user who never turned it on — which is the default.
Measured on the fix commit's own parent: Stage export, `hiddenChannels: [1]`,
cycle OFF → parent `#8fe08f`, fixed `#d9a3ff` (the screen's slot). The fix
covers that path too, at the same chokepoint and by the same mechanism (it
derives `positions` in `buildFigureSpecForView`, which BOTH entry points route
through), so no separate change was needed for it.

**Reported:** 2026-09-14, by the P4.2 canonical regression matrix
(`1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`) — a design-time
finding from the matrix's structural comparison, not yet surfaced by a user
report.

**Investigated:** root cause confirmed by reading the canvas display-list
builder, the export channel filter, and `buildExportStyles`, not inferred —
see Confirmed implementation evidence below.

**Suggested implementation owner/model:** Claude (agent) — fixed 2026-09-14.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D4.

#### User-visible problem

A user hides the first of two plotted series (via the legend). On screen,
the second series keeps its ORIGINAL palette colour — hiding a series never
reflows the colours of the series still visible. Exporting the same figure
(PDF/SVG) recolours the second series as if it were now first in line: the
exported colour does not match what the user sees on screen. This is true of
BOTH export paths — a saved document's, and the live Stage export with the
`autoSeriesStyles` preference off, i.e. its default (see the scope
correction above).

#### Confirmed implementation evidence

(As FILED, 2026-09-14, before the fix. Line numbers and the two code shapes
called out below — `pos = cycle?.[i] ?? i` and the conditional `seriesCycle` —
describe the code the bug was found in; the Completion record names what
replaced them. Kept verbatim as the record of the finding.)

- `frontend/src/lib/uplotOpts.ts:1309` (`const show = !args.hidden?.[i];`)
  and the surrounding series builder (e.g. `:1329`) — a hidden series stays
  IN the canvas' display list at its ORIGINAL index with `show: false`;
  every later series' colour call (`seriesColor(i, style)`) still uses the
  untouched, original index `i`, so hiding never shifts anyone's colour on
  screen.
- `frontend/src/lib/figureSpec.ts:195` (`const plotted =
  displayChannels.filter((ch) => !st.hiddenChannels.includes(ch));`) — the
  export wire's channel list DROPS hidden channels entirely, so the second
  series shifts to index 0 in the filtered list sent to export.
- `frontend/src/lib/exportStyles.ts:25-40` (`buildExportStyles`) — colours
  each entry by `pos = cycle?.[i] ?? i` (`:40`), where `i` is the index into
  the ALREADY-FILTERED `plotted` array; with `cycle: null` (the common case
  for a saved document — see below), `pos` is simply the filtered position,
  so the remaining series is coloured as though it were first.
- `frontend/src/lib/figureSpec.ts:382` (`buildFigureSpecFromDocument`) never
  sets `extras.autoSeriesStyles`, so `buildFigureSpecForView`'s
  `seriesCycle` (`figureSpec.ts:253-262`, gated on `extras.autoSeriesStyles`)
  is `null` for every saved-document export — the positional correction
  `SeriesCycle` provides is opt-in only for the LIVE Stage export
  (`buildStageFigureSpec`) per `figureSpec.ts:226-249`'s own doc and
  `exportStyles.ts:31-38`'s comment, and never reaches a saved document's
  export path.
- Test: `frontend/src/lib/regressionMatrix.test.ts:390`,
  `it("DIVERGENCE (BUG-015): hiding a series leaves the next one on palette
  slot 1 on screen and slot 0 on export", ...)` — builds a document with
  `yKeys: [0, 1]`, `hiddenChannels: [0]` (`hiddenFigure()`,
  `regressionMatrix.test.ts:465`), asserts both legs draw exactly channel
  `[1]`, and pins BOTH measured colours — screen `TEST_SERIES_PALETTE[1]`
  (`#ffb37f`, the series' ORIGINAL position), export `TEST_SERIES_PALETTE[0]`
  (`#7fb3ff`, its FILTERED position) — then asserts they differ.
  (Converted 2026-09-14 from a bare `it.fails`.)

#### Why this priority

P2 as filed. Matches the evidence: substantial, visible friction (an
exported figure's series colours do not match the legend/screen the user
authored it against) with a workaround, not data loss — and the audit's own
framing that this is a recurrence of a class of bug already fixed once
elsewhere (`SeriesCycle` for the live Stage export) supports treating it as
more than cosmetic polish.

#### Reproduction checklist

- [x] Starting state and sample data identified — a `FigureDocument` with
  `yKeys: [0, 1]`, `hiddenChannels: [0]`, built by `hiddenFigure()`
  (`regressionMatrix.test.ts:465-480`).
- [x] Exact actions recorded — hide the first of two series, then compare
  `projectScreen(...).series[0].color` (the remaining, second series) to
  `projectExport(...).series[0].color`.
- [x] Actual result recorded — screen keeps the second series' original
  palette colour (its original position, 1); export recolours it as if it
  were the first series (filtered position 0).
- [x] Expected result recorded — the exported figure's series colours
  should match the screen's, hidden series or not.
- [x] Reproduced by an agent —
  `frontend/src/lib/regressionMatrix.test.ts`'s BUG-015 test (named
  `DIVERGENCE (BUG-015): …` when filed; inverted and renamed by the fix, see
  the Completion record).

#### Fix checklist

- [x] Give `buildFigureSpecFromDocument`'s export path the same positional
  correction `SeriesCycle`/`extras.autoSeriesStyles` already provides the
  live Stage export (`figureSpec.ts:253-262`), so `buildExportStyles`'s
  `pos` is computed from the UNFILTERED display index, not the filtered
  `plotted` index. Done at the shared chokepoint rather than on the document
  path: `buildFigureSpecForView` — which BOTH `buildStageFigureSpec` and
  `buildFigureSpecFromDocument` route through — now derives `positions`
  unconditionally, and `buildExportStyles` takes them as their own
  argument, separate from the cycle opt-in.
- [x] Confirm the fix does not also turn on the (opt-in) auto dash/marker
  CYCLE feature itself for saved documents — only the palette-POSITION
  correction, not `autoSeriesStyles`'s wider styling behaviour, should apply
  universally. `buildExportStyles`'s third argument is now the positions and
  its fourth a boolean `cycle`; the cycle gate (`overlayExportsSeriesStyles`
  + `extras.autoSeriesStyles`) is untouched, and
  `figureSpec.test.ts`'s pre-existing "a saved FigureDocument is independent
  of the preference" block still asserts `line: undefined` throughout.
- [x] Add a case with more than one hidden series (e.g. hiding series 0 of
  three) to confirm the fix generalizes past the two-series minimal repro —
  `figureSpec.test.ts`'s "generalizes past the two-series repro: hiding 0 AND
  1 leaves channel 2 on slot 2", plus the three-channel `hidden` matrix
  fixture.
- [x] INVERT the divergence assertion in `regressionMatrix.test.ts` — the two
  palette-slot pins and the `.not.toBe` are gone, replaced by the
  screen-equals-export equality (kept non-vacuous by pinning the screen
  slots and asserting they differ from the filtered ones), and the test is
  renamed to drop the `DIVERGENCE` prefix.

#### Acceptance criteria

- [x] Hiding a series on screen and exporting the figure produces the SAME
  palette colour for every remaining series as the screen shows.
- [x] `projectExport(hidden, dataset).series[i].color` equals
  `projectScreen(hidden, dataset).series[i].color` — the equality
  BUG-015's divergence test is inverted into; `hidden` is now a full member
  of the matrix, so `screen ≡ export` and `screen ≡ reopen` assert the whole
  canonical payload for it, not just the colours.
- [x] An export with NO hidden series is byte-identical to before the fix
  (no regression to the common, all-visible case) — with nothing hidden
  `plotted` IS the display list, so every position equals the old index;
  `figureSpec.test.ts`'s "with NOTHING hidden the wire is unchanged" pins it,
  and re-freezing the regression-matrix goldens wrote only the new
  `hidden.json`, leaving the other nine byte-identical.

#### Completion record

- PR/commit: `fix(export): BUG-015 …` on `claude/repo-evaluation-l7y7k9`
  (parent `e479f5da`). Product change is three lines of behaviour across
  `frontend/src/lib/exportStyles.ts` (new `positions` argument, taken always;
  `cycle` demoted to a boolean), `frontend/src/lib/figureSpec.ts` (`positions`
  derived unconditionally from `displayChannels`) and
  `frontend/src/lib/spatialPageExport.ts` (call-site update — that panel's
  `plotted` IS its canvas' list, so it passes `null` positions). No persisted
  contract changed: the positions are derived at export-build time from
  `yKeys`/`seriesOrder`/`hiddenChannels`, all of which a saved document
  already carries, so there is NO new document field and no schema bump.
- Automated tests: `frontend/src/lib/figureSpec.test.ts` — new block "hidden
  series keep their palette slot on the export wire (BUG-015)" (4 tests:
  slots 1 and 2 for a hidden 0 of three; hiding 0 AND 1; the dash/glyph half
  under the cycle; the nothing-hidden no-op).
  `frontend/src/lib/exportStyles.test.ts` — "OFF: the positions still hold —
  no dash is invented, and no palette skew either (BUG-015)" (rewritten from
  the test that used to assert the skew).
  `frontend/src/lib/regressionMatrix.test.ts` — "BUG-015: hiding a series
  leaves the survivors on palette slots 1 and 2 on BOTH screen and export"
  (the inverted divergence), "hidden — the hidden channel is drawn by nobody,
  and the survivors keep their slots", and the `hidden` fixture's own
  `screen ≡ export`, `screen ≡ reopen` and golden tests.
- Agent verification: sabotage table (each reverted in turn, then restored) —
  (a) `positions` back to the filtered index in `figureSpec.ts` → 6 failures
  including `regressionMatrix` `hidden > screen ≡ export`, the inverted
  BUG-015 test, all three new `figureSpec.test.ts` BUG-015 assertions and the
  pre-existing P3.3 "a HIDDEN channel does not renumber the survivors";
  (b) `seriesColor(pos[i], …)` back to `seriesColor(i, …)` in
  `exportStyles.ts` → 6 failures including both `exportStyles.test.ts`
  palette-parity tests; (c) the reopen leg's display position back to the
  filtered index → `hidden > screen ≡ reopen`.
  Gate: `uv run pytest -q tests/test_repo_integrity.py`;
  `npx tsc -b --force`; `npx eslint src --max-warnings=0`;
  `npx vitest run src/lib src/architecture.test.ts` (274 files, 5205 tests);
  `npx vitest run src/components/Stage src/components/workshops/figurebuilder
  src/components/workshops/figurepage` (73 files, 1236 tests);
  `node scripts/freeze-regression-matrix.mjs --check` clean;
  `node scripts/check-bundle-size.mjs` green.
- Bundle (measured 2026-09-15, review NIT 5 — the number the record was
  missing): parent `e479f5da` **919,781 B** eager -> this commit `ebefa693`
  **919,781 B**, a **+0 B** delta. Both built after `npm ci` in a scratch
  worktree, with vite's transform cache cleared between them; the two builds
  really are different trees (every content hash moved, and the LAZY
  `figureSpec` chunk grew 6.57 kB -> 6.60 kB) — the eager graph simply did not
  gain a byte, because `exportStyles.ts`'s added statement lives in a lazy
  chunk and no eager import was added.
- Owner verification: pending — export a figure with a series hidden and
  confirm the PDF's colours match the legend on screen. Worth doing from the
  LIVE Stage (Copy figure / Export figure…) as well as from a saved document:
  both were broken and both are fixed (see the scope correction above).
- Notes: the REOPEN leg of the regression matrix (`lib/regressionMatrixReopen
  .testkit.ts`) carried the same skew in its own projection and was corrected
  to the unfiltered display position; it is a testkit, not product code, but
  the `hidden` fixture's `screen ≡ reopen` is what now holds it there.
- Review follow-up (2026-09-15, NIT 1 — landed with the BUG-014 commit): as
  shipped on 2026-09-14 the positions were `displayChannels.indexOf(ch)`, i.e.
  slots in THIS REQUEST's display list, which is the canvas' list only while
  `seriesStyleCycle.displayListsAgree` holds. `buildFigureSpecFromDocument`
  passes `allowExplicitXAsY: true` unconditionally, so a channel used as both
  X and Y stays in the export's list while the canvas always drops it, and the
  two index spaces then differ — making the comment's "the canvas' own display
  list" false in exactly the case the surrounding block names as the
  exception. The positions are now resolved against the CANVAS list itself
  (`lib/figureSpecSeries.ts`'s `resolveDisplaySeries`), so the claim is true on
  every branch; a channel the canvas never draws is parked past the end of that
  list rather than stealing a drawn channel's slot. Two further nits from the
  same round landed with it: `indexOf` collapsed a duplicated `yKeys` channel
  onto one palette slot (the slots now come from a per-channel queue, so each
  occurrence gets its own, as `uplotOpts`' index-keyed `seriesColor` does), and
  `exportStyles.ts` regained its `?? i` guard for a short `positions` array.
  Pinned by `figureSpecSeries.test.ts`, by colour assertions beside
  `figureSpec.test.ts`'s x-as-y cycle test, and by a ragged-positions test in
  `exportStyles.test.ts`.

---

## BUG-016 — a grouped figure's per-series styling reaches the canvas but is dropped from the export

**Priority:** P2 — a visible, wrong-looking export (a figure the user styled
red/dashed/3px comes back default-coloured, solid and default-width) with a
workaround (un-group, style each level individually, or restyle after export),
no data loss. The same class as BUG-015: the exported figure does not match the
figure the user authored on screen.

**Reported:** 2026-09-14, by the adversarial review round of the P4.2 canonical
regression matrix — found while checking whether the matrix's GROUP-mode
style comparison was load-bearing. It was not: the matrix compared
`spec.series_styles`, a wire field the renderer provably never reads on this
branch, so the comparison passed while the exported curve was solid. A
design-time finding, not yet surfaced by a user report.

**Investigated:** root cause confirmed by reading the backend resolver's
`group_col` branch and the canvas' group-split style mapping, and by measuring
both paths — see Confirmed implementation evidence below.

**State:** **FIXED 2026-09-17.** See Implementation and the Completion record.
The one design question the filing left open — what a grouped export should do
about COLOUR — is decided and recorded there, measured off the canvas rather
than chosen.

**Suggested implementation owner/model:** Claude (agent), 2026-09-17.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D5.

**Related:** FEATURE-001 (per-series styling ignored by FACETED plots). The two
are siblings but NOT the same entry, and the difference is the whole point:
facets ignore styling on BOTH paths, so screen and export agree and a user sees
their styling stop mattering immediately. Grouping honours styling on screen and
discards it only in the export, so the mismatch is invisible until the PDF comes
out. A fix for one does not fix the other — FEATURE-001 additionally has to
solve "different panels resolve different channel sets, so one style list cannot
serve the grid", which a grouped figure does not have (every level belongs to
ONE channel and shares that channel's one style).

#### User-visible problem

A user plots one Y channel split by a categorical column ("Batch"), styles that
channel red, dashed, 3 px, and sees the canvas draw three red dashed 3 px curves
— one per level — exactly as intended. Exporting the same figure to PDF/SVG
produces three curves in matplotlib's default colour cycle, all solid, all at
the default line width. Nothing warns that the styling was discarded.

#### Confirmed implementation evidence

- `src/quantized/routes/export_figures.py:81-85` — `FigureRequest.group_col`'s
  own doc states the choice outright: *"`series_styles` is not applied in this
  path either (it's 1:1-with-`y_keys`, which doesn't align with the synthetic
  per-level series) -- matplotlib's default color cycle takes over, exactly like
  the screen, which never assigns per-level colors either."* The parenthetical
  is right about COLOUR and wrong about everything else: the screen does not
  assign per-LEVEL colours, but it does give every level of a channel that
  channel's dash, width, marker, step and fill.
- `src/quantized/routes/export_figures.py:236-238` — the implementation. The
  `group_col` branch returns
  `_ResolvedFigure(grouped.x, g_series, x_label, y_label, None, [False] * len(g_series), "")`
  — the fifth positional field is `styles` (`_ResolvedFigure`, `:169-181`), so
  every per-series style is `None` for a grouped export. Measured directly
  against the resolver: a `FigureRequest` with
  `series_styles=[{color:'#ff0000', line:'dashed', width:3}]` resolves to
  `styles=None` when `group_col=1` is set and to the styles verbatim when it is
  not.
- `frontend/src/lib/figureSpec.ts:310` — `buildFigureSpecFromDocument` still
  PUTS the style on the wire: `group_col` is emitted from `extras.groupKey`,
  and `series_styles` (`:321`) is built unconditionally. So the wire carries a
  style the renderer will ignore, which is why a wire-level comparison cannot
  see this bug.
- `frontend/src/lib/figureSpec.ts:232-233` — the frontend already KNOWS about
  the backend's behaviour, but only narrowly: `overlayExportsSeriesStyles`
  refuses to auto-CYCLE styles for `group_col`/`facets` because those are
  *"documented as ignoring `series_styles` in `routes/export_figures.py`"*. The
  raw user-authored styles are still sent, and the mismatch is never surfaced.
- `frontend/src/lib/plotGroupSplit.ts:55-61` (`groupSplitChannelMap`) and
  `frontend/src/components/Stage/usePlotPayload.ts:226-230` (`styleList`) — the
  canvas side. The channel map repeats each fetched channel once per level, and
  `styleList` maps each DISPLAY position back through it to that channel's one
  `seriesStyles[ch]` entry, which `buildOpts` then applies to every level.
- Measured on the matrix's `group` fixture (channel 0 styled `width: 2,
  line: "dashed"`, levels ordered C/A/B): the canvas draws
  `Signal (Batch=C) (au)`, `Signal (Batch=A) (au)`, `Signal (Batch=B) (au)`,
  every one with `dash: [8, 4]` and `width: 2`; the wire carries
  `series_styles: [{color: …, width: 2, line: "dashed"}]` alongside
  `group_col: 6`; the backend resolves that to `styles=None`.
- Test: `frontend/src/lib/regressionMatrix.test.ts`'s BUG-016 test — reads the
  three per-level strokes out of the real `buildOpts` options object
  (`screenDrawnStyles`, `regressionMatrixLegs.testkit.ts`), reads
  `group_col`/`series_styles` out of the real `FigureSpec` and takes the level
  count from the wire's own `cat_levels`. It pinned the backend's contract as a
  named constant (`STYLE_DROPPED_BY_THE_GROUP_BRANCH = null`) and asserted the
  two differed; since the fix it is the same measurement with the assertion
  INVERTED and renamed ("a grouped figure's levels carry the channel's style on
  screen AND in the export"). Structural, like the rest of the matrix — it does
  not render a PDF, which is why the fix also adds rendered-layer tests.
- `frontend/src/lib/regressionMatrix.testkit.ts` — `styleComparable("group")`
  was narrowed to `false` for exactly this reason, so the matrix's leg-to-leg
  comparison stopped reporting agreement on a field one side ignored. It now
  returns `{shape: true, color: false}` for GROUP; see the Fix checklist.

#### Why this priority

P2, matching BUG-015 rather than FEATURE-001's P3. The distinction is
screen/export AGREEMENT: FEATURE-001 is P3 because both paths ignore styling, so
nothing the user sees is contradicted by what they get. Here the canvas honours
the styling and the export silently does not, so the user's own reference — the
figure on screen — actively misleads them about what the PDF will contain.
Not P1: the data and the analysis are untouched, every level is still drawn and
still labelled, and the workaround (un-group and plot the levels as separate
channels) exists.

#### Reproduction checklist

- [x] Starting state and sample data identified — the `group` fixture in
  `frontend/src/lib/regressionMatrixFixtures.testkit.ts` (one Y channel,
  `groupKey: 6` over the categorical "Batch" column with explicit
  `level_order: [2, 0, 1]`, and `seriesStyles: { 0: { width: 2, line:
  "dashed" } }`).
- [x] Exact actions recorded — style a grouped channel, then compare the
  per-level strokes the canvas resolved (`screenDrawnStyles`) against what the
  backend's `group_col` branch will render.
- [x] Actual result recorded — canvas: three curves, each `dash: [8, 4]`,
  `width: 2`; export: three curves with `styles=None`, i.e. solid and
  default-width in matplotlib's default cycle.
- [x] Expected result recorded — the exported grouped figure should carry the
  channel's dash/width/marker/step/fill on every level, exactly as the canvas
  draws them.
- [x] Reproduced by an agent — `frontend/src/lib/regressionMatrix.test.ts`'s
  BUG-016 test (filed as `DIVERGENCE (BUG-016): ...`; the fix inverted and
  renamed it, per the Fix checklist).

#### The colour rule, MEASURED (2026-09-17)

The filing left "what about colour" open. It was settled by reading what the
canvas actually does and reproducing that, not by choosing something new.

`Stage/usePlotPayload.ts` builds `styleList[i] = seriesStyles[plotted[i]]` over
`plotGroupSplit.groupSplitChannelMap`, so every level of a channel is handed
that channel's ONE style object, and `lib/uplotOpts.buildOpts` applies it
verbatim. Colour goes through `lib/seriesStyleCycle.seriesColor(i, style)`,
which has two halves:

1. an EXPLICIT `style.color` wins at every display position. Measured on the
   matrix's `group` fixture with `color: "#ffe066"` added: all three levels
   draw `#ffe066`.
2. with NO explicit colour it falls back to the palette token at the series'
   OWN display position, and a grouped canvas' display positions are per-LEVEL.
   Measured on the fixture as committed (no colour): the three levels draw
   `#7fb3ff`, `#ffb37f`, `#8fe08f` — palette slots 0, 1, 2.

So the rule the export now implements is: **expand the channel's whole style
onto every level, colour included — and send a colour only when the user chose
one.** Half 1 is reproduced exactly (the wire carries the explicit colour, the
backend gives it to every level). Half 2 cannot be carried by a list that is
1:1 with `y_keys` — one entry cannot hold three colours — so
`lib/exportStyles.buildExportStyles` OMITS `color` for a grouped request rather
than sending the channel's own palette slot, which would have painted every
level one hue: a NEW divergence, and worse than the bug. With no `color` key
matplotlib's own property cycle colours the levels, which is the pre-fix
rendering, unchanged. Both sides therefore CYCLE per level.

The RESIDUAL is wider than "the two palettes differ", and round 2's review
(NIT 6) measured how. The screen indexes its palette by ABSOLUTE display
position, and matplotlib's cycle is not advanced by a line that carries an
explicit `color=`. So with two grouped channels over three levels and channel 0
explicitly coloured, channel 1's three levels are canvas slots **3/4/5** but
export **C0/C1/C2** — the export restarts while the screen keeps counting.
Measured 2026-09-17, both halves: matplotlib renders channel 1's three artists
`#1f77b4`/`#ff7f0e`/`#2ca02c` (C0/C1/C2) after three `#ffe066` lines, and
`seriesColor` reads slots 3/4/5 (on the test palette
`#d9a3ff`/`#ffd27f`/`#7fe0e0`). A HIDDEN channel skews it the same way. So the
gap is **different palettes AND different cycle offsets**, and a
palette-for-palette substitution alone would not close it. Still out of scope —
a palette question, not a styling-dropped one — but recorded as what it is.

#### Implementation

- `src/quantized/calc/figure_group_styles.py` (NEW, pure) —
  `expand_grouped_series_styles(styles, n_channels, n_series)`. Series `i`
  belongs to channel `i // n_levels` (the channel-major/level-minor nesting
  `build_grouped_series` produces), so each channel's style is repeated once
  per level, as its own dict. Two keys cannot expand verbatim and the module
  doc says why: `color_by`/`colormap` are DROPPED (the canvas builds its
  `colorByColumns` map only when `groupCol === null`, so a grouped canvas draws
  an ordinary line — honouring it would put a point cloud and a colourbar in
  the PDF that the screen never showed), and a `fill: {"vs": p}` is re-indexed
  to `p * n_levels`, which is what the canvas' own
  `uplotFill.resolveFillBands` resolves via `plotted.indexOf(vs)` over the
  expanded channel map. A list that cannot be reconciled (no channels, or a
  series count that is not a whole multiple) returns `None` and renders as
  before, the same degrade-gracefully contract `resolve_style_channels` keeps.
- `src/quantized/routes/export_figures.py` — the `group_col` branch passes
  `resolve_style_channels(...)`'s output through that expander instead of
  returning `styles=None`. Three lines; the mapping is all in `calc/`.
- `src/quantized/routes/export_figures.py`'s `group_col` field doc and
  `export_figures_schema.SERIES_STYLES_DOC` / `WATERFALL_OFFSETS_DOC` — the
  contract text, corrected. The old text claimed the screen "never assigns
  per-level colors either", which is half true and was the load-bearing half
  of the wrong decision; `WATERFALL_OFFSETS_DOC` cited `series_styles` being
  unapplied as the reason offsets are unapplied, and now gives the reason that
  is actually still true of offsets (one offset per channel cannot say how far
  to stagger each level). OpenAPI + `lib/api/schema.d.ts` regenerated.
- `frontend/src/lib/exportStyles.ts` (`grouped` parameter),
  `figureSpecSeries.resolveSeriesPresentation`, `figureSpec.ts` and
  `figurebuilder/legacyFigure.ts` — the "omit a palette-derived colour for a
  grouped request" half of the rule, at the one place colours are resolved. An
  EXPLICIT colour still ships.
- `frontend/src/lib/exportStyles.stripDerivedColors` (round 2) — the same rule
  for a PINNED `publication.seriesStyles` array, which round 1 shipped
  verbatim on the ground that it is "that document's final word". It is not,
  about colour: the array is itself a previous `buildExportStyles` run on a
  FLAT request, which always bakes the channel's palette slot into `color`
  whether or not the user chose one. See "The pinned array" below.
- `frontend/src/lib/plotSpecFigure.ts` (round 2) — the Graph Builder →
  Publication Preview handoff carries the channel styles for a grouped spec
  instead of dropping them. See "The Graph Builder handoff" below.
- `src/quantized/routes/export_figures.py` (round 2, review NIT 5) — round 1
  left it at exactly 500 of its 500-line ceiling, passing with ZERO headroom
  (`tests/test_repo_integrity.py` fails on `> 500`), so the next line added
  there would have failed the build. The route-internal `_ResolvedFigure`
  dataclass moved to `export_figures_schema.py`, whose stated remit is exactly
  that — pure data shape with no route logic. It is `_`-prefixed and not
  pydantic, so no OpenAPI surface and no call site moved
  (`routes.export_page` reads the returned object, never the type name).
  484/500 now; the ceiling was NOT raised.

#### Round 2 — the pinned array (review F1)

`buildExportStyles`' `grouped` flag reached only the DERIVED branch. A
document that pins `publication.seriesStyles` shipped that array verbatim on
every mode, and the entry called it "that document's final word". It is not,
about COLOUR: the array is itself a `buildExportStyles` run on a FLAT request,
and that always bakes the channel's palette slot into `color` — a colour the
user never chose. Two ordinary gestures then send it on a grouped request:
reopening a grouped `FigureDoc` saved before this commit, and applying a graph
style template (`useGraphTemplates.saveStyleTemplate` builds the array flat by
design, so a template stays portable onto a flat figure).

Measured by the review: one channel, `{width: 2, line: "dashed"}`, pinned with
the palette hex `#7fb3ff`, split over three levels — canvas
`#7fb3ff`/`#ffb37f`/`#8fe08f`, export `#7fb3ff` x3. Pre-fix the same document
exported matplotlib's cycle, i.e. three hues that at least matched the canvas
structurally. So round 1 made that document WORSE, by the commit's own rule.

The fix recovers the truth the array does not record. `stripDerivedColors`
(`lib/exportStyles.ts`) drops an entry's `color` when it resolves to exactly
the palette slot `seriesColor` would produce at that entry's DISPLAY position,
and keeps anything else — the canvas gives an explicit colour to every level
too. Applied on the grouped branch of `figureSpecSeries.resolveSeriesPresentation`
and inside `legacyFigure`'s shared `exportStyles` helper, so the preview, the
export and the doc that "Save as figure" persists cannot disagree. The
ambiguity is one-sided and deliberate: a user who hand-picks the exact hex of
the slot their series already sits in gets the cycling render, which is what
the canvas draws for that series anyway; guessing the other way is the
regression above. No new persisted field, so nothing has to migrate.

`useGraphTemplates` deliberately keeps building its template FLAT: a template
is style-only and portable, so the grouped rule is applied where the grouped
request is built, not where a colour is saved.

#### Round 2 — the Graph Builder handoff (review F2)

`lib/plotSpecFigure.ts` still set `seriesStyles: groupCol !== null ? null :
stylesForMark(...)`, justified by the SAME half-truth this commit corrected in
`routes/export_figures.py` ("the screen doesn't assign per-level colors
either" / `buildXY` never touches `seriesStyles`). The live Stage does hand
every level its channel's style, so a grouped Graph Builder plot opened in
Publication Preview exported solid and default-width beside a dashed 2 px
canvas — BUG-016 unfixed on that entry path, with the entry claiming FIXED.
It now calls `stylesForMark(spec, liveSeriesStyles, groupCol !== null)`, i.e.
carries the channel styles under the same `grouped` rule, and the module doc
plus the pinning test (`plotSpecFigure.test.ts`) are inverted to match. The
ERROR-well gate one line above deliberately stays: a style is identical for
every level of a channel, so one `yKeys`-aligned entry says it completely,
while an error span is per-ROW and cannot be split across the levels its rows
were partitioned into.

#### Fix checklist

- [x] Decide the contract for `series_styles` under `group_col`: expand the
  1:1-with-`y_keys` style list to the synthetic per-level series server-side
  (each level inheriting its source channel's style, which is exactly what the
  canvas does), rather than dropping it. `calc.plotting.build_grouped_series`
  already knows which channel each synthetic series came from. — done in
  `calc.figure_group_styles`, from that function's own nesting.
- [x] Keep COLOUR out of scope unless deliberately chosen: the canvas colours
  levels by display position and the backend by its own cycle, and making those
  agree is a separate decision from honouring dash/width/marker/step/fill.
  Whatever is decided, say so in `export_figures.py:81-85`'s doc, which is the
  contract this bug is measured against. — DELIBERATELY CHOSEN, and only half
  of it: an explicit colour is honoured on every level (that is the reported
  symptom); the palette fallback is not carried, and the two palettes still
  differ. See "The colour rule, MEASURED" above; the field doc now says so.
- [x] Update `figureSpec.ts:232-233`'s `overlayExportsSeriesStyles` reasoning
  if `group_col` stops ignoring `series_styles` — the predicate currently cites
  the backend behaviour this fix would change. — the predicate still REFUSES a
  grouped view, on the narrower ground its doc now gives: the P3.3 cycle is
  keyed by DISPLAY POSITION and a grouped canvas' positions are per-level, so
  one channel-aligned entry cannot say "level 1 solid, level 2 dashed". The
  canvas refuses through the same predicate, so neither side cycles.
  `figureSpecSeries.resolveSeriesCycle`'s doc is corrected the same way.
- [x] Add a backend test at the RENDERED layer (the
  `tests/test_export_vector_structure.py` family) that a grouped export's
  curves carry the requested dash/width — a wire-level assertion cannot see
  this bug, which is how it survived. — four, reading the SVG's own artists:
  every level red/dashed/3px with the requested SQUARE marker glyph; two
  channels not bleeding into each other's levels; the unstyled control still
  cycling; and `color_by` dropped.
- [x] INVERT the divergence assertion in `regressionMatrix.test.ts`'s
  `it("DIVERGENCE (BUG-016): ...", ...)` — drop the
  `STYLE_DROPPED_BY_THE_GROUP_BRANCH` constant and the `.not.toEqual`, and
  assert the exported per-level styles EQUAL the canvas'. The fix makes the
  current assertion RED; it is not an `it.fails` that would silently become an
  "unexpected pass". — done; it also pins the canvas' three per-level palette
  slots and that the wire carries no `color`, which is the colour rule above.
- [x] Set `styleComparable("group")` back to `true` in
  `regressionMatrix.testkit.ts` and regenerate `group.json`
  (`node frontend/scripts/freeze-regression-matrix.mjs`), so the matrix
  compares grouped styling leg-to-leg again once the two paths agree. — with
  one honest narrowing: it now returns `{shape, color}` rather than a boolean,
  and GROUP is `{shape: true, color: false}`. Every leg compares
  width/dash/marker/step/fill for a grouped figure; colour is the half the wire
  cannot carry, so nothing pretends to compare it. `group.json` regenerated —
  the ONLY golden that moved, and only by `width: null -> 2` and
  `dash: null -> [8, 4]` on its one channel.

#### Acceptance criteria

- [x] A grouped figure styled dashed/3 px on screen exports as dashed/3 px on
  every level. — `test_a_grouped_export_draws_every_level_with_its_channel_style`.
- [x] An UNGROUPED export is byte-identical to before the fix (no regression to
  the common, 1:1-with-`y_keys` case). — the flat branch is untouched
  (`resolve_style_channels` -> `_ResolvedFigure` as before), the `grouped` flag
  defaults to `false` at every producer, and the eight other matrix fixtures'
  goldens did not move.
- [x] A grouped export with NO per-series styles set is byte-identical to
  before the fix (the default-cycle rendering is unchanged when there is
  nothing to honour). — `styles is None` returns `None` from the expander;
  `test_a_grouped_export_with_no_series_styles_still_cycles_its_levels` pins the
  rendering (three levels, three cycle colours, nothing dashed).
- [x] The matrix's `group` fixture passes `screen ≡ export` with
  `styleComparable("group")` comparing per-series styling again — see the
  narrowing recorded one section up.

#### Completion record

- PR/commit: `fix(export): BUG-016 — a grouped figure's levels export with
  their channel's style, as the canvas draws them`.
- Automated tests: `tests/test_calc_figure_group_styles.py` (13, new — the pure
  mapping); `tests/test_export_vector_structure.py`'s four new grouped-styling
  tests (the RENDERED layer); `regressionMatrix.test.ts`'s inverted BUG-016
  test plus the `group` fixture's own `screen ≡ export ≡ reopen` + golden.
  BACKEND coverage of the expansion is
  `tests/test_calc_figure_group_styles.py` plus those four rendered-layer
  tests — NOT the frontend BUG-016 matrix test, whose "EXPORT" half re-derives
  the per-level expansion in TypeScript from the wire and would stay green if
  the backend rule changed (review NIT 7; the test is a screen-vs-WIRE
  structural pin, which is all it claims to be).
- Round-2 tests (2026-09-17, all sabotage-verified): the `grouped` flag and
  `stripDerivedColors` are unit-pinned in `lib/exportStyles.test.ts` (10 cases —
  derived-colour omission, explicit-colour survival, display-position keying,
  hex case folding, no-mutation, by-reference return); the pinned-array strip
  in `lib/figureSpecSeries.test.ts` (6) and
  `figurebuilder/legacyFigure.test.ts` (6, including "the saved doc gets the
  same array the preview renders"); the Graph Builder handoff in
  `lib/plotSpecFigure.test.ts` (inverted + a flat control + a mark-vocabulary
  case). Round 1's F3 gap is closed: sabotaging `legacyFigure`'s `grouped`
  argument now fails `"derives no palette colour for a grouped doc, and keeps
  the rest of the style"`, where it previously left 713/713 green.
- Agent verification: every new test sabotage-verified (the expander's channel
  index, its `color_by` drop, its `fill` re-index, the route's use of it, and
  the frontend's colour omission each broken in turn and the naming test
  confirmed red). Backend `ruff`/`mypy`/`pytest` green; frontend `tsc -b
  --force`, `eslint --max-warnings=0` and `vitest src/lib src/store
  src/architecture.test.ts` green.
- Owner verification: open — a real grouped figure exported to PDF and compared
  against the screen.
- Notes: the palette difference for an UNCOLOURED grouped channel (screen
  `--series-N`, export matplotlib's `C0/C1/C2`) is deliberately still open, and
  the CYCLE OFFSET diverges with it; see "The colour rule, MEASURED".
- `legend` asymmetry (review NIT 8): `calc.figure_group_styles._level_style`
  pops `legend` from each expanded per-level entry while the FLAT branch leaves
  it in the dict `resolve_style_channels` hands the renderer. Both are inert —
  `calc.figure._plot_kwargs` names every key it reads, and `legend` is consumed
  one layer up (flat: `figure_labels.series_display_name`; grouped: the
  `"{legend} ({group}={level})"` template `series_legends` feeds
  `build_grouped_series`). The pop is kept on the grouped side only because
  that is the branch that MINTS new per-level dicts, and a per-level entry
  carrying the channel's rename would read as a per-LEVEL label, which it is
  not. Recorded in the module rather than made uniform.
- Bundle (review NIT 9, CORRECTED in round 3 — round-2 review F5). The round-1
  body cited parent `fbccbe05`; the landed parent is `6686c23d` (`git rev-parse
  93208f66^`). Round 2's own line then cited `b6408e6c`, which is the parent of
  the WORKTREE commit `922d8a4e` was cherry-picked from, not of `922d8a4e` —
  whose real parent is `c1757fb1` (P2.8). Re-measured on the real pair
  (`rm -rf node_modules/.vite`, `npm run build`, exact eager bytes):
  `c1757fb1` **916,718** -> `922d8a4e` **916,718 B (0)**. The DELTA round 2
  recorded was right; both ABSOLUTES were an ancestor's, taken before P2.8
  landed. Round 1's pair is left as recorded (`6686c23d` -> `93208f66`
  913,376 -> 913,376, 0) — it was measured on its own real parent. The zero is
  real, not a stale read: every module this work touches (`exportStyles`,
  `figureSpecSeries`, `plotSpecFigure`, `legacyFigure`) lands in LAZY chunks,
  and that is where the growth shows — round 1 +68 B total (`figureSpec` +39,
  `useFigureBuilder` +29) and round 2 +327 B (`figureSpec` +246,
  `useFigureBuilder` +74, `GraphBuilderPanel` +7), with the eager `index`
  chunk byte-identical in size across all four builds (only its embedded
  lazy-chunk hashes, which are fixed-width, changed).

#### Round 3 — the pinned array records its own provenance (review F1-F7)

Round 2's fix asked the wrong question. `stripDerivedColors` decided whether a
pinned `color` was the user's by RE-RESOLVING `seriesColor` at export time and
comparing hexes, which reads two pieces of state that are not the ones the
array was pinned against:

- the PALETTE. `--series-N` is redefined by every theme flip
  (`styles/colors.css`), by all five presets (`lib/palettes.ts`'s
  `applyPalette`) and, for slot 1, by an accent switch. After any of those the
  pinned hex matches no live slot, every derived colour is classified "chosen",
  and the backend paints all three levels that one hue — round 1's regression,
  whole (review F1, measured).
- the POSITION. The comparison was fed THIS request's canvas display positions
  (BUG-015's), while every producer of a pinned array builds it in plain index
  order. `buildFigureSpecFromDocument` passes `allowExplicitXAsY`
  unconditionally, so an ordinary `xKey:1, yKeys:[1,2]` document resolves
  positions `[1,0]`; hiding a channel after the pin shifts the rest. Both were
  measured shipping the derived colour (review F2).

So the answer is RECORDED at the producer instead of recovered later.
`buildExportStyles` sets `ExportSeriesStyle.colorDerived` on every colour it
emits — `true` for the palette slot, `false` for a colour the user picked
(a literal or a `--series-N` SWATCH, which resolves to a palette hex and is
still a pick: review F3's case, now recorded rather than guessed). It is
camel-cased because it is the one key there that is NOT a wire field:
`sanitizeExportSeriesStyles` persists it, and the single wire boundary
`exportStyles.toWireSeriesStyles` removes it from every request. The grouped
rule is applied at that same boundary, so `resolveSeriesPresentation`'s derived
and pinned branches are now SYMMETRIC (review F3): an explicit colour that
happens to equal a palette slot survives on both, where round 2 kept it when
derived and dropped it when pinned. `stripDerivedColors` and its
palette-equality comparison are gone, along with the `positions` argument the
strip never should have had.

DESIGN CHOICE, measured. The alternative considered was to pin no derived
colour at all and let the flat export re-derive it from the palette at render
time. It was rejected because it is not byte-identical for existing documents.
Measured on a pre-provenance pinned flat array
(`[{color: slot0, width: 2}, {color: "#ffe066"}, {width: 2, line: "dashed"}]`)
through `buildLegacyFigureSpec`, `e93b193b` and this commit agree exactly:
`[{"color":"#7fb3ff","width":2},{"color":"#ffe066"},{"width":2,"line":"dashed"}]`
under the pinning palette AND under a switched one. Re-deriving would have
changed 1 of those 3 entries with the palette unchanged (entry 2 has no colour
today — the shape `plotSpecFigure` and every grouped build emit — and would
gain one) and 2 of 3 after a palette switch. A pinned FLAT figure keeping the
hex it was saved with is also what the round-2 test framed as desirable, and it
stays pinned.

MIGRATION, deliberate and scoped. An entry with a `color` and NO `colorDerived`
key is a pre-provenance pin — any `.dwk` FigureDoc, graph style template or
promoted `FigureDocument` saved before this commit, which is four producer
paths in all (`legacyFigure.buildLegacyFigureDoc`,
`useGraphTemplates.saveStyleTemplate`, `plotSpecFigure.plotSpecToFigureDoc`,
and `figureDocumentPublication` promoting any of those). For those entries ONLY,
and on a GROUPED request only, the colour is dropped when it equals the palette
slot at the entry's OWN ARRAY INDEX — the index every one of those producers
builds in (`positions = null`), so the question is about the pin's position and
not the request's. Flat requests are untouched. The sanitizer deliberately does
NOT default the missing flag either way: `true` would discard a colour the user
chose on every grouped export of an old document, `false` would keep round 1's
one-hue regression for the same documents. RESIDUAL, pinned by two tests rather
than left implicit: a pre-provenance document exported under a DIFFERENT
theme/preset than it was pinned under still reads its derived colour as chosen
and paints one hue per channel. Re-saving such a figure writes provenance and
retires the residual for that document permanently. **[CORRECTED by round 4,
review F1: that last sentence was false when written — `legacyFigure` returns a
doc-seeded `docSeriesStyles` verbatim, so a reopened document re-persisted its
flagless array unchanged. It is true as of round 4, which assigns the provenance
at LOAD; see the round-4 section below. FALSE AGAIN as of round 5, which
removes the load-time assignment: loading and re-saving no longer retire the
residual, only re-pinning does; see the round-5 section below.]**

Also closed this round:

- **F4** — the `slot === null` unresolvable-slot clause, which round 2's
  sabotage left green because nothing reached it. It is still live (only from
  the migration path now) and is pinned. The case F4 named (`#abc` against an
  `oklch` token) turns out NOT to reach it: measured in the test environment,
  `resolveToHex("#abc")` is `#aabbcc` and `resolveToHex("oklch(...)")` is
  `#000000`, so the hex comparison decides it — pinned as its own case so the
  comment cannot rot. What DOES make both sides null is a colour that paints
  nothing (`resolveToHex`'s documented alpha-0 return), and with the guard gone
  those compare EQUAL and strip a colour the sanitizer restored.
- **F6** — the strip is no longer applied at PERSIST time. `legacyFigure`'s
  shared helper now returns the DOCUMENT form and `buildLegacyFigureSpec` alone
  applies the wire rules, so "Save as figure" stops writing the stripped array
  into `config.seriesStyles`. The saved doc keeps colour AND provenance, which
  is what lets it reproduce the same wire under any later palette.
- **F7** — the miscounted test list above (9 -> 10), and the round-2 test
  "strips nothing once the palette the array was built against is gone" is
  deleted: it framed a palette-dependent guess as the document's word, which is
  exactly the behaviour this round removes.

Round-3 tests (all sabotage-verified): `lib/exportStyles.test.ts` (19 cases in
the BUG-016 block — provenance recording, the wire boundary, a THEME FLIP
between pin and export in both directions, position-invariance, flat
byte-identity under a palette switch, and the pre-provenance migration rule
with its residual and its unresolvable-slot guard); `lib/figureSpecSeries.test.ts`
(8, including the `allowExplicitXAsY` `[1,0]` positions and a channel hidden
after the pin, both measured off the real `resolveDisplaySeries`);
`figurebuilder/legacyFigure.test.ts` (10, including F6's save and a
pre-provenance fixture document taken through `sanitizeExportSeriesStyles`);
`lib/publicationStyles.test.ts` (3, the persistence contract and the absent
third state); `lib/spatialPageExport.test.ts` (1, the third wire boundary);
`lib/regressionMatrix.test.ts` (1, screen `buildOpts` vs wire for a PINNED
grouped document under a changed palette); and the RENDERED half in
`tests/test_export_vector_structure.py`
(`test_a_grouped_export_cycles_the_levels_of_a_styled_but_UNCOLOURED_channel`
— the real route, reading the SVG's own artists: the width/dash expand onto
every level while the three strokes stay distinct).

Sabotage: 17 of 17 RED (the scoped suite is 644 tests). S8 — dropping the
`slot === null` guard — is the clause round 2's own sabotage (its S6) left
green, and it is red now.

Bundle, round 3 — **CORRECTED in round 4 (review F4)**. The pair was recorded
against `e93b193b`, which is FOUR commits back, and labelled `git rev-parse
HEAD~1`; the real parent of `4b1efb2d` is `b6282a5b`. Re-measured on that real
pair (`npm ci`, `rm -rf node_modules/.vite`, `npm run build`, exact eager bytes
both sides): `b6282a5b` **910,287** -> `4b1efb2d` **910,371 B (+84)**. The
DELTA round 3 recorded was right; both ABSOLUTES belonged to an ancestor, taken
before the slice-3 lazy seams and `35b97380` landed. The method, stated because
stating it is what round 3 got wrong: resolve the parent with `git rev-parse
HEAD~1` IN THE COMMITTED WORKTREE, never from a brief or a review. **The kB
restatement in this paragraph was left behind by that correction and is fixed
in round 5 (review F5):** 910,371 B is **889.0 kB** against the 898.8 kB
budget, **9.8 kB under**. The superseded "895.4 kB ... 3.5 kB under" was
916,890 B — the round-3 absolute this paragraph exists to correct. The growth
is `publicationStyles.ts`'s sanitizer branch, which is in the EAGER persistence
graph; `exportStyles`/`figureSpecSeries`/`legacyFigure` are lazy as before.


#### Round 4 — provenance is assigned ONCE, at LOAD (review F1-F9) **[RETIRED by round 5]**

Round 3 recorded provenance at the PRODUCER, which was right, but left a third
state — "no flag at all" — for every array pinned before the key existed, and
had the WIRE boundary guess it on each request from the palette live at export
time. The review measured three things wrong with that, and they are one
design problem:

- **F1.** "Re-saving such a figure writes provenance and retires the residual"
  was FALSE, in all three places it was written. `legacyFigure.ts`'s shared
  helper returns `state.docSeriesStyles` verbatim whenever a document seeded it
  (`useFigureBuilder.ts:105`), and nothing clears that within a session, so
  "Save as figure" on a reopened pre-provenance document wrote the SAME
  flagless array back. The residual was permanent, not self-retiring.
- **F3.** The `.dwk` FigureDoc path never ran `sanitizeExportSeriesStyles` at
  all: `figuredoc.migrateConfig` spread `config.seriesStyles` verbatim out of
  the persisted JSON. Measured through the real `sanitizeFigureDocs` +
  `buildLegacyFigureSpec`: a persisted `colorDerived: "no"` (truthy) dropped a
  colour the user CHOSE from a grouped export, and `colorDerived: null`
  (falsy) shipped a derived one — round 1's regression, back.
- **F2.** `lib/originTemplate.ts` is a fifth, NON-legacy producer of flagless
  arrays: every `.otp`/`.otpu` template imported tomorrow arrives through
  `sanitizeImportedTemplate`, whose colours are explicit RGB hexes decoded from
  the file (`io/origin_project/templates.py`'s `_HEX_RE`). Measured:
  `toWireSeriesStyles([{color:"#7fb3ff",width:3,marker:true}], true)` ->
  `[{width:3,marker:true}]` — the Origin colour dropped from exactly the export
  the template was imported to style.

THE FIX — **RETIRED BY ROUND 5 BELOW.** The load-time comparison described in
this paragraph is gone: it read the LIVE palette, which is not the document's,
so it misclassified any pre-provenance document opened under a different theme
and then froze that answer on the next save (round-5 review F1). Everything
this paragraph says about the `.dwk`/graph-template paths reaching the
sanitizer at all, about a malformed flag, and about the five producers still
stands. Round 4's own words follow, for the record. The round-2 palette
comparison is kept, but it runs exactly ONCE, at
LOAD, in `publicationStyles.sanitizeExportSeriesStyles`, and its answer is
written onto the entry. An entry with a `color` and no BOOLEAN `colorDerived`
is marked `true` when the colour resolves to the palette slot at its own ARRAY
INDEX — index order is what every producer of a pinned array builds in
(`positions = null`) — and `false` otherwise, including when the live slot is
unresolvable (`resolveToHex` null: "chosen" loses per-level cycling on one
document where the other side loses a colour outright). A string, number or
`null` flag is treated as ABSENT and migrated by the same rule, which is F3's
two cases. Every persistence path runs through that sanitizer now:
`figuredoc.migrateConfig` (the `.dwk` FigureDoc `config`, new this round),
`figuredoc.loadGraphTemplates` (the saved template store, new this round),
`figureDocument` (a canonical document's `publication`) and `nameKeyedRecipes`
(an imported template FILE). The PRODUCER enumeration is therefore five, not
four: `legacyFigure.buildLegacyFigureDoc`,
`useGraphTemplates.saveStyleTemplate`, `plotSpecFigure.plotSpecToFigureDoc`,
`figureDocumentPublication` — all via `buildExportStyles` — and
`originTemplate.sanitizeImportedTemplate`, which now records `colorDerived:
false` on every entry carrying a colour (F2).

Consequently `toWireSeriesStyles` asks no palette question at all. A flag that
is still absent there is UNVOUCHED — an array minted by something that never
recorded provenance — and a GROUPED request omits its colour, because shipping
one it cannot vouch for paints every level that single hue (round 1's
regression, "worse than the bug") while omitting it falls back to matplotlib's
cycle, which is what the pre-BUG-016 export did. FLAT requests are untouched,
so a pinned flat figure is still byte-identical.

"Re-saving writes provenance" is now TRUE and is tested rather than asserted:
`legacyFigure.test.ts` loads a pre-provenance `.dwk` through the real
`sanitizeFigureDocs` and saves it back with `buildLegacyFigureDoc`, and the
saved `config.seriesStyles` carries the flag. **FALSE AGAIN AS OF ROUND 5, on
purpose:** it was true only because the load had already guessed, and the guess
could be wrong. A re-save now round-trips a pre-provenance document unchanged;
RE-PINNING is what retires the residual. See round 5.

RESIDUALS, named (F5, F6, F7):

- **The inference can misclassify** — **WITHDRAWN IN ROUND 5; there is no
  inference any more.** This bullet named only the direction that loses a
  colour and described the freeze as the mitigation. Round-5 review F1 measured
  the other direction on the real path: a pre-provenance figure whose colours
  ARE palette A's slots, saved under A and opened under B, had both recorded as
  CHOSEN and both shipped to a grouped export — round 1's one-hue regression,
  whole — and the freeze then made it permanent where round 3's per-export
  guess at least self-corrected when the user returned to their own theme. F2
  measured the second half: `loadGraphTemplates` never wrote back, so for the
  template store the answer was re-decided on every load and still flipped with
  the theme, which "assigned ONCE, at LOAD" did not describe. Superseded by the
  round-5 residual list below.
- **A pinned FLAT figure keeps its pinned colours after a theme flip, by
  design.** The canvas redraws in the new palette while the export sends the
  hex the document was saved with, so canvas != export there. It is the
  byte-identity ruling recorded under round 3's DESIGN CHOICE, stated here as
  the user-visible consequence it has: measured, a pinned pair
  `[#7fb3ff, #ffb37f]` exports those two while the canvas draws
  `[#ffcccc, #ccffcc]`. Pre-existing, pinned by a test, and NOT a regression;
  a figure that should track the palette is re-derived by a dataset re-import
  (`figureDocumentReimport` clears `publication.seriesStyles`) or by rebuilding
  it.
- **F7 is FIXED, not recorded** (round 5 simplified the projection and closed
  the three guard clauses the round-4 review left unguarded — see below).
  A pinned array is now re-cut to `y_keys`:
  `figureSpec.ts` passes the request's own `displayChannels` to
  `resolveSeriesPresentation`, which projects the pin index-for-index onto the
  plotted channels. Measured before: pin `[#aa0000,#00aa00,#0000aa]` for
  channels 0/1/2, hide channel 0 -> `y_keys [1,2]` with all THREE entries on
  the wire, so the backend read the hidden channel's colour for the first
  plotted series (and the BUG-014 legend overlay was mis-aligned with it). It
  fails closed: unless the pin's length equals `displayChannels` exactly and
  every plotted channel is consumed, the array is returned untouched. What it
  cannot fix, and what remains a named residual, is a pin taken against a
  DIFFERENT channel SELECTION (the pin's own index space is not persisted with
  it), which is why the guard is length-exact rather than best-effort.

BACKEND (F9). `series_styles` is a loose `dict[str, Any]` by design, so a
leaked `colorDerived` was accepted and ignored — frontend-only enforcement of
a "never on the wire" promise. `routes/export_figures_schema.py` now carries
`DOCUMENT_ONLY_STYLE_KEYS` + `reject_document_only_style_keys`, wired as a
`field_validator` on `FigureRequest.series_styles` (so `/figure`,
`/figure-hitmap` and, through `PagePanelSpec.figure`, `/figure-page` all
inherit it) and a leak is a 422 naming the entry index. Deliberately a narrow
allow-nothing LIST rather than `extra="forbid"` on a strict sub-model: the
field's own doc promises that an unrecognized key degrades gracefully, and
that promise is kept — only this one key, whose presence means the client
skipped the wire boundary and therefore never filtered the colour beside it
either, is refused. `calc/` is untouched and pure.

Round-4 tests (all sabotage-verified): `lib/publicationStyles.test.ts` (6 new
— the migration in both directions, case folding, the unresolvable-slot guard,
the malformed-flag cases, and "a real flag is never overridden");
`lib/exportStyles.test.ts` (4 — the UNVOUCHED rule at the wire, flat vs
grouped, and its palette-independence); `figurebuilder/legacyFigure.test.ts`
(4 — the `.dwk` load path end to end, the malformed flags, the RE-SAVE, and
the absent/null `seriesStyles` configs); `lib/figuredoc.test.ts` (2 — the
graph-template store's migration and its unchanged tolerance);
`lib/originTemplate.test.ts` (3 — the decoded colours recorded as chosen and
reaching a grouped wire); `lib/figureSpecSeries.test.ts` (2 — the `y_keys`
re-alignment and its fail-closed guard); `tests/test_api_export.py` (3 — the
422 on `/figure` and on a page panel, and the unrecognized-key control that
still renders).

Sabotage: 17 of 17 RED, against a scoped suite of 356 frontend tests (the
eleven files above plus `figureSpec`, `regressionMatrix` and
`spatialPageExport`) and the 3 backend cases. Both directions of the migration,
its `slot === null` guard, the malformed-flag branch, "a real flag is never
overridden", each of the two new load paths, the Origin producer (flagged /
not flagged), the UNVOUCHED wire rule (flat and grouped), the `y_keys`
re-alignment and its fail-closed guard, the by-reference return, and the
backend guard in both directions (not raising, and raising too widely).

Bundle, round 4 — **CORRECTED in round 5 (review F4), for the fourth round
running and the third time under a `git rev-parse HEAD~1` label.** The pair was
recorded as parent `b621c5fa` **910,371** -> **911,180 B (+809)**; `git
rev-parse 1b285a14^` is **`2074fba4`**, two commits later (`c29fc0e3`, a
plans-only commit, and `2074fba4`, P2.8 round 3, sit between), so both
absolutes belonged to a tree this commit was not built on. Re-measured by the
orchestrator on the landed trees (`npm ci`, `rm -rf node_modules/.vite`, exact
eager bytes both sides): `2074fba4` **910,824** -> `1b285a14` **911,634 B
(+810)**. The DELTA was right to within a byte; the absolutes were not. The
growth is attributable per chunk:
`figureDocument` +554, `plural` +156, `index` +98, `useApp` +1 — the
persistence graph gaining the migration predicate and, with it, the 37-line
`lib/color.ts` leaf that `resolveToHex` lives in. That leaf is the price of
running the comparison at load instead of at the wire, and it is paid once per
document rather than once per export.


#### Round 5 — no palette inference, ever; an unvouched colour fails closed (review F1-F9)

Rounds 3 and 4 asked the same question in two different places and neither had
the information to answer it. "Is this flagless pinned colour the palette slot
the canvas gave the series, or one the user picked?" can only be answered
against the palette the PIN was taken under, and that palette is persisted
NOWHERE — not in a `.dwk` FigureDoc, not in a `FigureDocument`'s
`publication`, not in the graph-template store, not in an exported template
file. Round 3 compared against the palette live at EXPORT time (so the answer
flipped with the theme, once per request); round 4 compared against the palette
live at LOAD time and then persisted the result, which is worse in the way that
matters: review F1 measured a pre-provenance figure whose colours are palette
A's slots, saved under A and opened under B, coming back with both marked
`colorDerived: false` and both shipped to a GROUPED export — round 1's one-hue
regression — and the next save froze that. Review F2 measured the other new
load path, `loadGraphTemplates`, never writing back at all, so for the template
store the answer was re-decided per load and still moved with the theme,
freezing only as a side effect of saving or deleting ANY template.

THE RULE, decided rather than re-litigated: **fail closed.** The ambiguity is
genuine and unrecoverable from the stored data, so the repo's own standard
applies — document the gap, do not fake it (`CLAUDE.md`, "when scipy has no
equivalent ... document the gap"). `publicationStyles.sanitizeExportSeriesStyles`
records what the document SAYS and nothing more: a boolean `colorDerived`
beside a colour passes through, and anything else — a string, a number, `null`,
or no key at all — leaves the entry UNVOUCHED. `isPaletteSlot` and every call
to it are deleted, so `seriesColor` is no longer reachable from the sanitizer
and `lib/color.resolveToHex` leaves the eager persistence graph again.
`exportStyles.toWireSeriesStyles` keeps the rule it already had for an
unvouched entry: its colour is omitted on a GROUPED request (matplotlib cycles
the levels, which is what the pre-BUG-016 export did and what the canvas
draws), and kept on a FLAT one.

What round 4 got right and round 5 keeps: `figuredoc.migrateConfig` and
`figuredoc.loadGraphTemplates` still run the sanitizer, which is the real F3
fix — the `.dwk` path validated nothing at all before, and a persisted
`colorDerived: "no"` (truthy) or `null` (falsy) flipped provenance at the wire.
A malformed flag is DROPPED rather than coerced, so it lands in the same
UNVOUCHED bucket as an absent one. Neither call reads the theme now, which is
pinned by a test: the same stored bytes sanitize identically under two
different palettes.

PROVENANCE IS RECORDED BY PRODUCERS, and all five still do: `buildExportStyles`
(the Figure Builder pin, `useGraphTemplates.saveStyleTemplate`,
`plotSpecFigure.stylesForMark` for the Graph Builder handoff,
`spatialPageExport`, and `figureSpecSeries`' derived branch) and
`originTemplate.sanitizeImportedTemplate`, whose decoded hexes are chosen by
construction (`colorDerived: false`). Each is covered by a test that reddens
when the producer stops recording.

F3 — THE PIN RE-CUT, SIMPLIFIED. `figureSpecSeries.alignPinnedToPlotted` had
four guard clauses; the round-4 review sabotaged three of them GREEN and showed
one (`next === plotted.length`) unreachable by construction. It has exactly one
non-test caller, `figureSpec.ts`, which passes `plotted` = the document's
`displayChannels` minus the hidden channels, in the same order and by the same
test — so re-cutting the pin is that same filter applied to the pin's own
indices. It now takes a `PinnedAlignment { displayChannels, hiddenChannels }`
(the pair `resolveDisplaySeries` filtered `plotted` with, passed straight from
the one call site so the two cannot disagree) and is two lines: fail closed
when the pin's length is not the display list's, otherwise drop the entries
whose channel is hidden. Both surviving conditions redden under sabotage, and
so do the three mutations that stayed green in round 4.

RESIDUALS, named:

- **A pre-provenance document's CHOSEN colours do not reach a GROUPED export
  until the figure is re-pinned.** Flat exports are unaffected — they carry
  every colour the document was saved with — and a DERIVED colour is handled
  correctly by construction: omitting it is exactly what a vouched-derived
  entry gets, so the levels cycle and the export matches the canvas. The cost
  is confined to a colour the user actually picked on a grouped export of a
  document saved before the key existed. **Loading and re-saving do NOT retire
  it** (the sanitizers add nothing, deliberately); **re-pinning does** — any
  action that runs `buildExportStyles` again records the real answer, which is
  a figure rebuilt from the live plot and saved, a graph template saved from it
  and applied, or a dataset re-import (`figureDocumentReimport` clears
  `publication.seriesStyles`). Documents saved by any build from round 3 on are
  unaffected.
- **A pin whose LENGTH differs from the display list's is left whole; a
  SAME-length pin taken against a different channel SELECTION is re-cut by
  position, not left whole.** The re-cut is index-for-index against the
  document's display list, so a pin whose length is not that list's has no
  correspondence to filter and fails closed — and the BUG-014 legend overlay
  rides that same un-recut array, so a 4-entry pin against 2 `y_keys` ships 4
  entries with the renames on entries 0 and 1. Measured and pinned by a test
  rather than left unremarked (round-4 review F3 measured it and the entry did
  not mention the legend half). Re-cutting it on a guess would be the silent
  corruption instead. A pin whose length happens to MATCH the current display
  list but was taken against a different channel selection is NOT caught by
  this guard: it is filtered by position against a foreign index space
  (round-5 review F3's reproduction — pin taken over `[0,1]`, selection
  changes to `[2,3]`, channel 2 hidden -> the pin's channel-1 entry is applied
  to channel 3). Pre-existing, not a regression: round 4's forward walk did
  the same for the same input. Named here because the guard is length-only;
  the pin's own index space is not persisted with it, so nothing at this
  layer can detect the mismatch.
- **A pinned FLAT figure keeps its pinned colours after a theme flip, by
  design.** Unchanged from round 4 — see that entry's bullet.

BACKEND. Unchanged apart from one test: review F7 noted that `/figure-hitmap`
was claimed to inherit the 422 guard and does, with nothing covering it, so the
third route now has its own case (plus a non-vacuous 200 control). The guard,
`DOCUMENT_ONLY_STYLE_KEYS` + `reject_document_only_style_keys` on
`FigureRequest.series_styles`, is otherwise untouched. `calc/` is untouched and
pure.

HYGIENE (F9). `lib/figureSpec.ts` was 499 lines against the hard 500-line
ceiling. `buildStageFigureSpec` — Stage copy/export's ROUTING decision, as
opposed to the two BUILDERS the rest of the module is — moved verbatim to
`lib/figureSpecStage.ts` (403 + 119 lines), imported directly by its two
callers rather than re-exported, since it imports `figureSpec.ts` and a barrel
there would close a cycle. No comment was shortened to fit.

Round-5 tests: `lib/publicationStyles.test.ts` (4 new, replacing the 6 the
migration had — a flagless slot-coloured entry stays unvouched, the same
document sanitizes identically under two palettes, a malformed flag is dropped,
and a real boolean survives either palette); `lib/exportStyles.test.ts` (1 —
the fail-closed rule stated in one place, including that a dropped malformed
flag lands in the same bucket); `figurebuilder/legacyFigure.test.ts` (4,
rewritten — review F1's scenario end to end on the real `.dwk` load path under
both palettes, the flat export keeping every colour, the malformed flags, and
"re-saving adds nothing, re-pinning retires it" through the builder's fresh
state (`docSeriesStyles` undefined) — the three real retirement routes
(round-5 review F6) are a fresh builder mount, save-a-graph-template-then-
apply-it, and `figureDocumentReimport` clearing `publication.seriesStyles`);
`lib/figureSpecSeries.test.ts` (4 — filtering by channel rather than index, a
duplicated channel kept and hidden as a pair, the fail-closed path measured
WITH its legend overlay, and a caller that passes no alignment);
`lib/figureSpec.test.ts` (1 — the re-cut through
`buildFigureSpecFromDocument`, the CALL SITE, which no test reached: sabotaging
the alignment argument away left the whole scoped suite green until this
existed); `lib/figuredoc.test.ts` (1 new + 1 rewritten);
`tests/test_api_export.py` (1 — the `/figure-hitmap` 422, review F7). Three
pre-existing expectations lost a `colorDerived` the round-4 migration had been
adding (`figureDocument`, `nameKeyedRecipes` ×2) and one round-trip test is
now lossless outright rather than "lossless up to one additive migration".

Sabotage: **15 of 15 RED** against a scoped suite of 437 tests over 13 files
(baseline green). The sanitizer inferring from the palette again, coercing a
malformed flag, dropping a real one, or restoring a lone flag; the wire reading
unvouched as chosen or applying the grouped rule to flat requests;
`buildExportStyles` not recording provenance; Origin templates not marked
chosen; `migrateConfig` or `loadGraphTemplates` skipping the sanitizer; the
re-cut by channel SEARCH (round-4 S14a, collapsing a duplicated channel), the
re-cut without its length guard (S14b) and no re-cut at all (S14c) — all three
GREEN in round 4 and all three RED now — plus the re-cut filtering by entry
index, `figureSpec.ts` passing no alignment, and the backend guard not raising.

Bundle, round 5: parent **`c3e37a78`** (`git rev-parse f94d32d6^`; the P2.8
round-5 commit that changed only a style value and comments) — built in a
scratch worktree after `npm ci` + `rm -rf node_modules/.vite` and measured
with the same exact-bytes script on both sides: **911,785** -> **911,295 B
(−490)**, i.e. 890.4 kB -> **889.9 kB** against the 898.8 kB budget, **8.9 kB
under**. `9c6abc5a` (P2.8 round 4, one commit further back) measures
identically to `c3e37a78` — both 911,785 B — so the reported delta and budget
line are correct either way; only the stated parent SHA was wrong, round 5's
own review (F1) found it named the wrong commit again. A REDUCTION, and
attributable per chunk: `figureDocument`
**−554** — exactly the +554 round 4 added to that chunk — because deleting
`isPaletteSlot` takes `seriesColor` and the 37-line `lib/color.ts` leaf back out
of the eager persistence graph; `index` **+65** and `useApp` **−1** for the
`PinnedAlignment` pair and the comment-only deltas. The
`lib/figureSpec.ts` -> `lib/figureSpecStage.ts` extraction is eager-neutral:
both are lazy, and the split moved code rather than adding any.

---

## BUG-017 — a dataset with a NaN or ±Infinity cell cannot be reopened after Save

**Priority:** P1 — data loss: the affected dataset's `.dwk` cannot be reopened
at all, and the failure takes the WHOLE workspace down with it (one bad
dataset refuses every dataset in the file). No workaround inside the app once
saved; only recovery is hand-editing the JSON or restoring an older save.

**Reported:** 2026-09-15, by the round-3 adversarial review of the P2.1
peak-table digest work (`b8cb5e16`) — found while measuring the digest's
`.dwk` round trip (`xrd_review3.md` NIT 4) as a durability side-check, not a
peak-table defect. Pre-existing and outside that commit's diff; recorded here
rather than against the peak-table entry.

**Investigated:** root cause confirmed by probe (below), not inferred.

**State:** **FIXED 2026-09-16.** See the Implementation, Tests and Completion
record sections; the two design rulings the original filing left open (what a
pre-fix `null` cell means, and whether a malformed entry should still take the
whole workspace down) are decided and recorded there, with one residual site
left open and named by file:line.

**Suggested implementation owner/model:** Claude (agent), 2026-09-16.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P2.1 (found via its
round-3 review; the peak-table fingerprint is a downstream SYMPTOM, not the
cause — see the `-0` half below).

#### User-visible problem

A dataset containing a `NaN` cell (reachable today by `insertRows`, whose
blank rows are minted as `Number.NaN` — see evidence) or a `±Infinity` cell
(reachable by any correction/formula that can produce one, e.g. a divide by
zero) is saved successfully, but the saved `.dwk` can never be opened again:
`parseWorkspaceDataset` throws `dataset N ("<name>") has an invalid data
structure` for THAT dataset, and `parseWorkspace` has no per-dataset recovery
— the exception propagates out of the whole load, so every OTHER dataset in
the same workspace file also fails to open. The user's only path back into
their project is hand-editing the saved JSON. Separately, a cell holding `-0`
silently becomes `0` on reopen — not a throw, but a silent value change and,
for a dataset with a durable peak table (`PRIMARY_SOFTWARE_AUDIT_PLAN` P2.1),
enough to flip `peakTableMatchesData` to false and discard an otherwise-valid
saved fit for no user-visible reason.

#### Confirmed implementation evidence

- `frontend/src/lib/workspaceSerialize.ts:198` — `serializeWorkspace`'s
  per-dataset map does `data: d.data` **inline**, with no replacer. The whole
  document is then handed to a single `JSON.stringify` elsewhere in the same
  function, and `JSON.stringify` turns `NaN`/`Infinity`/`-Infinity` into
  `null` and leaves `-0` indistinguishable from `0` (`JSON.stringify(-0)` is
  the string `"0"`) — neither is a bug in this file, but this is the one place
  a dataset's numeric payload crosses the JSON boundary with no NaN/±Infinity/
  -0 handling of its own.
- `frontend/src/lib/workspaceDatasetParse.ts:38-40` — `isNumberArray`:
  `Array.isArray(v) && v.every((x) => typeof x === "number")`. A `null` in the
  array (what a serialized NaN/±Infinity cell becomes) fails `typeof x ===
  "number"`, so any row or value column that held one is rejected.
- `frontend/src/lib/workspaceDatasetParse.ts:75-108` (`isDataStruct`,
  `parseWorkspaceDataset`) — `isDataStruct` calls `isNumberArray` on `time`
  and (transitively, per row) on `values`; when it returns false,
  `parseWorkspaceDataset` throws `` `dataset ${i} ("${String(dd.name ??
  "")}") has an invalid data structure` `` (`:107`). This is a per-dataset
  parse called from `parseWorkspace`'s `o.datasets.map(...)` with no
  try/catch around each entry, so the thrown error aborts the `.map` and the
  whole `parseWorkspace` call.
- `frontend/src/store/cellEdit.ts:129-131` (`insertRows`) —
  `` const blankRow = () => d.data.labels.map(() => Number.NaN); `` mints a
  `NaN` in every value column for each inserted blank row, and the same
  function pads `time` with `Number.NaN` too (`padRows(d.data.time, span,
  Number.NaN)`). So a plain "insert a row" followed by "save" is enough to
  reach the bug with no error-path or malformed-import involved.
- **Probe, run end to end against the real code** (`serializeWorkspace` ->
  `JSON.parse`/`JSON.stringify` -> `parseWorkspace`, a minimal one-dataset,
  one-column workspace, 2026-09-15):
  - a `NaN` cell: `parseWorkspace` **throws** exactly
    `dataset 0 ("scan.dat") has an invalid data structure`, and the workspace
    fails to load.
  - a `-0` cell: parses without error; the round-tripped value reads back as
    `0` (`Object.is(v, -0)` is false) — a silent, non-throwing change.
  These match `xrd_review3.md`'s independent measurement
  (`peakTableMatchesData` -> false for the `-0` case; the identical throw
  message for the `NaN` case) — same bug, found by two different probes.

#### Why this priority

P1, not P2: this is category "the project cannot be reopened", the same class
BUG-011 (Pack Project shipping preview rows) and the P0/P1 entries in this
file reserve for actual data loss, and it needs no rare input — inserting a
row is a normal, common action, and `insertRows`'s blank cells are `NaN` by
construction, not by user error. It differs from the peak-table digest's
`-0` half (recorded as fail-safe in `xrd_review3.md` NIT 4, and left there
rather than duplicated here): the NaN half is not fail-safe, it is a hard
failure that blocks reopening the file.

#### Reproduction checklist

- [x] Starting state and sample data identified — a one-dataset workspace,
  one value column, three rows.
- [x] Exact actions recorded — `insertRows` a blank row (or otherwise write a
  `NaN`/`±Infinity` cell), `serializeWorkspace`, round-trip through
  `JSON.parse(JSON.stringify(...))` (what a real Save/Open does via the file
  on disk), `parseWorkspace` the result.
- [x] Actual result recorded — `parseWorkspace` throws `dataset 0
  ("scan.dat") has an invalid data structure`; the entire workspace fails to
  open. Separately, a `-0` cell parses but reads back as `0`.
- [x] Expected result recorded — the workspace should reopen with the
  dataset's `NaN`/`±Infinity`/`-0` cells intact, exactly as saved.
- [x] Reproduced by an agent — probe above, run against the real
  `serializeWorkspace`/`parseWorkspace` (see Confirmed implementation
  evidence). Committed as a regression suite 2026-09-16:
  `frontend/src/lib/nonFiniteCells.test.ts` reproduces the probe's exact
  path, but mints the NaN through the app's own `insertRows` action rather
  than writing one by hand.

#### Investigation

- [x] Likely owning components/modules identified —
  `lib/workspaceSerialize.ts`, `lib/workspaceDatasetParse.ts`.
- [x] Root cause confirmed rather than inferred — the probe above, plus the
  cited `isNumberArray`/`JSON.stringify` behavior.
- [x] Related workflows and persistence paths checked (2026-09-16) — every
  site that JSON-encodes a `DataStruct`'s numeric cells was enumerated by
  grepping `JSON.stringify` across `frontend/src/lib` and `frontend/src/store`
  and reading each hit. Exactly three encode dataset cells for PERSISTENCE
  (narrowed from an earlier "every JSON boundary" framing — see the fourth,
  non-persistence site below, missed by this same grep-and-read pass):
  - `lib/workspaceSerialize.ts:281`'s `JSON.stringify(doc, null, 2)` — the
    `.dwk` Save/Save As path AND, through the same function, `lib/autosave.ts`
    (localStorage/IndexedDB generations) and
    `store/packProjectContent.ts`'s `serializeCurrentWorkspaceForPack`. ALL
    THREE are covered by this one fix; `contentFingerprint`'s
    `JSON.parse`→`JSON.stringify` re-encode (packProjectContent.ts:174)
    passes the sentinels through unchanged, and the round-trip test here
    deliberately includes that extra hop.
  - `lib/workbookTransfer.ts`'s `buildTransferPackage` — a SEPARATE
    `JSON.stringify(pkg)` over live `Dataset`s, with the identical hole:
    `parseTransferPackage` feeds the text back through `parseWorkspace`, so a
    blank inserted row's NaN made workbook Copy→Paste (and Duplicate) refuse
    the whole workbook with `"… has an invalid data structure"`. FIXED here
    too, with the same encoder.
  - **RESIDUAL, recorded not fixed:** `lib/figureDocument.ts:442`
    (`serializeFigureDocument`) freezes a `DataStruct` snapshot inside a
    figure document, which rides along in the same `.dwk` under
    `editableFigures`. It does NOT throw — `normalizeFrozenDataStruct`
    (`lib/figureDocument.ts:309-334`) already maps every `null` cell to `NaN`
    by an explicit, documented contract — but that normalization is lossy in
    the two ways this fix removes elsewhere: `+Infinity`/`-Infinity` both come
    back as `NaN` (sign and kind gone) and `-0` comes back as `+0`. Left
    alone deliberately: it is a fail-soft path with its own versioned
    document contract, so changing its wire is a separate, versioned decision
    rather than the same edit.
  - **FOURTH SITE, missed by the original "exactly three" count, benign by
    contract:** `lib/api/http.ts:58` (`fetchJSON`, plus the same
    `JSON.stringify(body)` shape at `:142` `postBlob` and `:165`
    `postDownload`) stringifies request bodies carrying a full `dataset:
    DataStruct` — routed there by `lib/api/plot.ts`, `lib/api/rsm.ts`,
    `lib/api/figures.ts` and `lib/api.ts` via `lib/api/datasetCache.ts`. This
    is a LIVE REQUEST wire, not a persistence boundary, which is why "every
    JSON boundary" (the commit subject, unchanged — see Completion record)
    overclaimed scope that "every persistence boundary" would not have: it
    is inside the same grepped tree and does encode dataset cells, yet
    appeared in neither the "exactly three" list nor the "checked and NOT
    affected" list below. The consequence is benign: the backend documents
    `null` as its own non-finite wire form
    (`src/quantized/routes/_payload.py`'s module docstring), and
    `DataStruct.create`'s `np.asarray(..., dtype=float)` turns a JSON `None`
    back into `nan` (measured: `np.asarray([1,None,3],dtype=float)` ->
    `[1. nan 3.]`), so the API round trip is NaN-safe and lossy only for
    `±Infinity`/`-0` — the same shape as the `figureDocument` residual below.
    Not fixed here (not a persistence path, and not part of this fix's
    scope); recorded as a residual for the same reason `figureDocument` is.
  - Checked and NOT affected (no DataStruct cells cross them):
    `lib/plotRecipe.ts:260`, `lib/plotspec.ts:792`,
    `lib/pageDocumentActions.ts:198`, `lib/panelwindow.ts:117`,
    `lib/dragaxis.ts:29`, `lib/template.ts:38` — all carry view/spec state or
    drag payloads, not measured data. `lib/clipboard.ts`/`lib/clipboardGrid.ts`
    write TSV text, not JSON.
  - `lib/originBookRoles.ts` (named speculatively in the original filing)
    holds no serializer at all — it only decides `errorRoles`; the pack-project
    export it was cited for goes through `serializeWorkspace`, above.
- [x] Existing plan overlap reconciled — this is the pre-existing bug
  `xrd_review3.md` NIT 4 named and deliberately did not fix as part of the
  P2.1 peak-table digest work; filed here instead of folded into that entry.

#### Implementation

- [x] Minimal safe behavior defined — an encoder/decoder PAIR in its own
  module, `frontend/src/lib/nonFiniteCells.ts`, applied symmetrically at the
  two ends of the `.dwk` boundary: `workspaceSerialize.ts`'s per-dataset map
  calls `encodeDataStruct` on `data` and `raw`, and
  `workspaceDatasetParse.ts` validates with `isWireCellArray` and decodes
  with `decodeDataStruct` before `sanitizeDataStruct` ever sees the arrays.
  A new module rather than either existing file (282 and 264 lines) so
  neither is bulked toward the 500-line ceiling, and so the ONE other site
  with the same hole (`lib/workbookTransfer.ts`) shares the same code.
  SENTINELS CHOSEN: `"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"` — exactly
  what `String(value)` produces for each, so the saved file is
  self-describing to a human reading the JSON, rather than the `"__NaN__"`
  spelling this box originally proposed. The collision argument is
  unchanged by the shorter spelling and is the one that matters: these
  strings only ever appear inside `time`/`values`, which are numeric by
  contract (text cells live in the `metadata` row sidecars,
  `lib/rowSidecars.ts` — never in `values`), so no legitimate cell can be
  mistaken for one.
- [x] Failure and ambiguous-data behavior defined — **RULING: a pre-fix
  `null` cell stays a REJECTION**, not a silent `NaN` or `0`. Reasons: (a)
  `null` is genuinely ambiguous — NaN, `+Infinity` and `-Infinity` all wrote
  the same `null`, so reading it as NaN would fabricate a specific value the
  file does not contain; (b) `null` is equally what truncated or
  hand-corrupted JSON looks like, and this box's own original text asked for
  it to stay "a real rejection for genuinely malformed data". The practical
  cost is bounded and one-way: a `.dwk` saved by a PRE-fix build with a
  non-finite cell remains unopenable (hand-editing the JSON is still the
  recovery, as before), while every file written from this commit on
  round-trips exactly. Recorded in the code at
  `lib/workspaceDatasetParse.ts`'s cell-check comment and pinned by the test
  "still REFUSES a pre-fix null cell rather than guessing which value it was".
- [x] Data integrity and backward compatibility considered — four
  directions; three pinned directly by a test, the fourth (no collision)
  argued structurally and cross-checked by an existing test rather than a
  dedicated one:
  - **New code, old file:** a `.dwk` with no sentinels decodes by reference
    and parses exactly as before (test: "parses a pre-fix .dwk (plain
    numbers, no sentinels) exactly as before").
  - **New code, ordinary data:** `encodeCells`/`encodeDataStruct`/
    `encodeDatasetCells` return their INPUT object when nothing needs a
    sentinel, so the object graph `JSON.stringify` walks is literally the
    one it walked before — byte-identical output, no `WORKSPACE_VERSION`
    bump, no new field (tests: "returns the input array/struct/dataset by
    reference…" and "writes a finite dataset's payload with the exact bytes
    it had before"). "Byte-identical" is scoped to ORDINARY data: a dataset
    that legitimately holds a `-0` cell DOES change the saved bytes (`0` ->
    `"-0"`) the moment this fix lands, same as a NaN/±Infinity cell does —
    that is the fix working as intended (a `-0` was previously silently lost,
    per the peak-fingerprint symptom above), not a regression, but it means
    "byte-identical" is not universal and should not be read as such.
  - **Old build, new file:** an old build cannot be changed, so what it DOES
    was measured and pinned instead — its `isNumberArray` (`typeof x ===
    "number"`) fails on a sentinel string, so `isDataStruct` fails and it
    throws its usual `dataset N ("name") has an invalid data structure`.
    That is the same clear refusal it already gave for such a dataset before
    this fix: loud, never a silently wrong number (test: "makes an OLD build
    refuse a sentinel-bearing .dwk loudly instead of corrupting it", which
    runs the pre-fix predicate verbatim against real new-serializer output).
  - **No collision** with a legitimate text cell (sentinels only ever appear
    inside `time`/`values`, which are numeric by contract — text lives in the
    `metadata` row sidecars, `lib/rowSidecars.ts`/`textColumns.ts`, never in
    `values`) has no test of its own, but is cross-checked by the strict
    rejection the decoder already needs for a different reason: "accepts a
    number or the four sentinels, and rejects null and other strings"
    (`nonFiniteCells.test.ts` ~line 99) asserts `isWireCellArray([1, "nan",
    3])` and `isWireCellArray([1, "0", 3])` are both `false` — any string
    that ISN'T exactly one of the four sentinels fails closed rather than
    being silently accepted as data, which is the property that makes a real
    string cell impossible to confuse with a sentinel.
- [x] UI wording/tooltips/accessibility included where relevant — **RULING:
  a malformed dataset entry STILL takes the whole workspace down**; it does
  NOT degrade to a per-dataset skip-with-warning through BUG-010's
  `notifyMigrationWarnings` channel. Considered and rejected because the
  "safer" option is the more destructive one here: a skipped dataset is
  invisible in the Library, and the user's very next Save would write the
  workspace WITHOUT it — turning a fully recoverable file into a permanent
  loss. Refusing to open leaves the file on disk untouched and names the
  offending dataset. What this fix changes is narrower than "unreachable for
  any file the app itself wrote": the ordinary NaN/±Infinity/-0 cell VALUES
  this app writes are unreachable through this throw from this commit on,
  but a pre-fix save with a non-finite cell still refuses (its `null`
  predates the fix), and a hole/explicit `undefined` in a values row would
  still serialize to `null` and still refuse — no known app path mints one
  today (the three cell writers in `store/cellEdit.ts` are bounds-guarded,
  and `padRows`/`insertBlanks`/`blankRow` all build with `Array.from`), so
  that is a latent edge, not a live one. Recorded in
  `parseWorkspaceDataset`'s doc comment ("WHY A MALFORMED ENTRY STILL TAKES
  THE WHOLE WORKSPACE DOWN").

#### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward — 17 specs in
  the new `frontend/src/lib/nonFiniteCells.test.ts`, each round trip run as
  `serializeWorkspace` → `JSON.stringify(JSON.parse(text))` → `parseWorkspace`
  (the extra re-encode hop is deliberate: it is what
  `packProjectContent.contentFingerprint` does to the same text). NaN,
  `+Infinity`, `-Infinity` and `-0` all recover exactly, `-0` asserted with
  `Object.is`.
- [x] A VERSIONED round-trip test — "parses a pre-fix .dwk (plain numbers, no
  sentinels) exactly as before" (an old document still loads unchanged) and
  "still REFUSES a pre-fix null cell rather than guessing which value it was"
  (the ruling recorded above, pinned so it cannot drift silently). Plus the
  reverse direction: "makes an OLD build refuse a sentinel-bearing .dwk
  loudly instead of corrupting it".
- [x] `insertRows`' blank rows specifically — the NaN reaches the test
  through `useApp.getState().insertRows("d1", 1, 1)`, i.e. the app's own
  action, never a hand-written NaN; and a second spec asserts the OTHER
  dataset in the same workspace loads too (the "whole workspace goes down"
  half of the bug).
- [x] Relevant focused tests pass — `npx vitest run src/lib src/store
  src/architecture.test.ts`: 358 files, 7,076 tests, 7,075 passed. The one
  failure is unrelated and load-induced:
  `src/lib/freezeRegressionMatrixCheck.test.ts` times out at its own 30 s
  budget when the whole scope runs in parallel (it spawns a NESTED `vitest`
  run via `scripts/freeze-regression-matrix.mjs`); run on its own on the same
  tree it passes in 19.6 s, and the script it drives imports only the
  regression-matrix testkits — none of the four files this commit touches.
- [x] Type-check/build/repository gates pass — `npx tsc -b --force` (exit 0),
  `npx eslint src --max-warnings=0` (exit 0), the scoped vitest above,
  `npm run build` after `rm -rf node_modules/.vite`, and
  `uv run pytest -q tests/test_repo_integrity.py`.
- [x] Agent verifies acceptance criteria — every sentinel round trip, the
  byte-identity pin, both compatibility directions, the autosave path, the
  workbook-transfer path and the peak-table fingerprint, each sabotage-
  verified (7 sabotages, table in the commit body).
- [ ] Owner verifies when required — a real Save/reopen of a project
  containing an inserted blank row, in the running app on Windows.

#### Completion record

- PR/commit: `fix(workspace): BUG-017 — round-trip NaN/±Infinity/-0 cells
  through every JSON boundary` (2026-09-16). That subject is the commit's own
  immutable wording; scope note (2026-09-16 review round): it covers every
  PERSISTENCE JSON boundary (`.dwk`/autosave/Pack Project and workbook
  transfer) — a fourth JSON boundary, `lib/api/http.ts`'s live request
  bodies, is a separate, benign-by-contract residual, not covered by this
  commit — see the Investigation section's fourth-site bullet.
- Automated tests: `frontend/src/lib/nonFiniteCells.test.ts` — 18 specs as of
  the 2026-09-16 review round (17 from the original fix, encoder/decoder
  contract; byte-identity for ordinary data; the `insertRows` NaN round trip
  and its whole-workspace half; ±Infinity; `-0` via `Object.is`; `raw` through
  the `.dwk` path; pre-fix document compatibility both ways; two autosave
  specs; the workbook Copy/Paste package; the `peakDataFingerprint` survival
  check; plus one added by that review round, closing a test gap it found:
  `raw` with a NaN and a `-0` through the workbook-transfer package
  specifically — `encodeDatasetCells`'s `raw` branch was unguarded by any of
  the original 17, sabotage-verified, see that round's notes below).
- Agent verification: 2026-09-16 — the original probe's two symptoms are
  both gone (the NaN case now reopens; the `-0` case now reads back
  `Object.is(v, -0) === true`), and every new spec was sabotage-verified by
  breaking the code it guards and restoring the source byte-identical.
- Owner verification: —
- Notes: one residual recorded and deliberately not fixed —
  `lib/figureDocument.ts:442`'s frozen figure snapshot is lossy for
  `±Infinity` (both become `NaN`) and `-0` (becomes `+0`) but never throws;
  see the Investigation section's third bullet for why it is a separate,
  versioned decision. A second, benign residual recorded by the 2026-09-16
  review round: `lib/api/http.ts`'s live request bodies (see the
  Investigation section's fourth-site bullet).
- **2026-09-16 review round (test gap + doc corrections):** re-read the
  landed commit (`0565b674`, parent `2d8b9b57` — NOT the `56bb3599` the
  original commit body measured against, which was `d3de75e2`'s parent
  before this fix was rebased onto `2d8b9b57` for landing) and closed five
  items: (1) added the `raw`-through-workbook-transfer test above, sabotage-
  verified (`encodeDatasetCells` ignoring `raw` → that one new test fails;
  the pre-existing `.dwk`-path `raw` test is unaffected by this specific
  sabotage because `serializeWorkspace` never calls `encodeDatasetCells` — it
  calls `encodeDataStruct` directly on `data`/`raw` — so only the branch this
  round actually guards, the workbook-transfer path, needed a new test); (2)
  reworded the "unreachable for any file the app itself wrote" overclaim in
  both this entry and `workspaceDatasetParse.ts`'s doc comment (see above and
  that file's `parseWorkspaceDataset` doc); (3) added the missed fourth
  JSON-encode site (`lib/api/http.ts`) to the Investigation enumeration and
  narrowed "every JSON boundary" to "every persistence boundary" in this
  entry's own wording (the commit subject itself is unchanged, per the note
  above); (4) reworded "four properties/three directions, each pinned by a
  test" to name the no-collision property as argued-and-cross-checked rather
  than independently pinned; (5) noted that a `-0` cell changes saved bytes
  (in contract) and re-measured the eager bundle pair for the actual landed
  parent: **911,982 B at `2d8b9b57`** (this fix's real `HEAD~1`, built with
  `rm -rf node_modules/.vite && npm run build` in a scratch worktree) **->
  912,846 B at `0565b674` (+864 B)**, 7,554 B under the unmoved 920,400 B
  budget — the delta matches the commit body's own `+864 B` exactly (the
  absolute totals differ only because the commit body measured against
  `56bb3599`, an ancestor of the actual parent `2d8b9b57`, not because the
  fix's own footprint changed).

---

## FEATURE-001 — per-series styling does not apply to faceted plots (screen or export)

**Priority:** P3 — nothing is lost or corrupted, and screen and export AGREE
today (both ignore it). It is a missing capability, not a defect: a user who
styles a series and then facets sees their styling quietly stop mattering, with
no warning. P3 rather than P2 because the data and the analysis are untouched.

**Reported:** 2026-09-09, by Claude, while auditing PRIMARY_SOFTWARE_AUDIT_PLAN
P3.3's "contrast and non-color encodings" box. Filed AFTER a fix was built,
reviewed twice, and deliberately reverted — the reasons are the valuable part of
this entry.

#### What is actually true

- `calc/figure_facets.py`'s `draw_facet_grid` calls
  `_plot_kwargs(st.line_width, st.marker_size, None)` — a hardcoded `None`
  where the flat renderer passes the per-series style spec.
- `components/Stage/useMultiPanelStage.ts`'s facet branch passes NO
  `seriesStyles` to `buildOpts` either, unlike its sibling branches.
- So the export is CONSISTENT with the screen. This was originally reported as
  "faceted export silently drops styles", which framed a missing feature as an
  export regression.

#### Why the obvious fix is wrong (two rounds of review)

1. **`series_styles` cannot be forwarded.** It is indexed by `y_keys`, which
   `lib/figureSpec.ts` sends as `plotted` — hidden-channel-FILTERED and
   `seriesOrder`-REORDERED. Facet panels are built from the RAW `st.yKeys`,
   because the on-screen grid honours neither. An existing passing test
   (`figureSpec.test.ts`, "does not throw for an all-hidden FACETED view")
   already demonstrates the divergence: `y_keys` comes back `[]` while `facets`
   still carries every series. Forwarding would draw a chosen dash on the WRONG
   curve.
2. **A separate facet-indexed list is ALSO insufficient.** Building one from
   `st.yKeys ?? defaultDenseChannels(...)` fails whenever `yKeys` is null,
   because `lib/plotdata.ts`'s `buildColumns` re-runs the `defaultDenseChannels`
   DENSITY heuristic on each ROW-SLICED panel. Measured on a QD-shaped fixture
   (M_DC finite only on level-0 rows, M_AC only on level-1 rows): panel 0
   resolved `[level, M_DC]`, panel 1 resolved `[level, M_AC]`. The panels differ
   from the whole-dataset list AND FROM EACH OTHER.
3. **Therefore `draw_facet_grid`'s "every panel shares one series order"
   assumption is false**, and no single style list can serve the grid.

#### What a real fix has to decide first

- **Should every panel show the same channel set?** Comparing like with like is
  the point of small multiples, so pinning one channel list for the whole grid
  is defensible — and would make one style list valid. But it changes what the
  screen renders (panels would show empty series), so it is a product decision,
  not an implementation detail to settle silently.
- Otherwise the wire needs per-PANEL styles, or a channel index per facet
  series so styles can be matched by channel rather than position.
- Either way the fix must land on the SCREEN and the EXPORT together, or it
  breaks the parity invariant `lib/figureSpecFacets.ts` documents ("renders the
  SAME faceted grid Stage shows").

#### Reproduction

- [x] Confirmed by reading both renderers (`figure_facets.py`,
  `useMultiPanelStage.ts`).
- [x] The per-panel channel divergence measured directly with a throwaway probe
  over the real `facetPayloads`, not inferred.
- [ ] Confirmed visually on owner data.

#### Implementation

- [ ] Product decision: one channel set per grid, or per-panel styles.
- [ ] Screen and export together.
- [ ] A fixture where panels WOULD resolve different channels, so whichever rule
  is chosen is pinned against the case that broke the first two attempts.

#### Completion record

_(empty — open. The reverted attempt is commit-logged; `docs/testing.md` kept
the monkeypatch lesson it produced.)_

---

## BUG-007 — RESOLVED, AND IT WAS A MISDIAGNOSIS: a `void`-ed async call in a test, not module-init order

**Priority:** was P2 — **CLOSED the same day, fixed, and kept in the register
because the misdiagnosis is the lesson.** There is no module-init-order problem.
A sibling test fired an async store action without awaiting it, so its assertion
was vacuous and its `set()` landed during a LATER test; one extra `await
import()` shifted that leak by a microtask tick and exposed it. I filed the
symptom as an exotic bundler/ordering hazard and withheld a real ~1 kB bundle
reduction for it. A review found the real cause in one pass.

**Reported:** 2026-09-09, by Claude, while paying for BUG-006's fix out of the
bundle budget rather than raising the pin a second time.

**Investigated:** bisected to a single line; root cause NOT established.

#### Reproduction (exact, one line)

In `store/split.ts`, replace the static

```ts
import { splitColumn, sliceDataStruct, tooManyGroups } from "../lib/datasetsplit";
```

with the equivalent dynamic import inside the already-`async`
`splitDatasetByColumn`:

```ts
const { splitColumn, sliceDataStruct, tooManyGroups } = await import("../lib/datasetsplit");
```

Then `npx vitest run src/store/selectionInvariant.test.ts` fails:

```
× restoreFromTrash yields the tree selection only when the restore IS an activation
  AssertionError: expected 'ds-<generated>-3' to be 'd1'
```

`restoreFromTrash("dataset:d1")` restores a dataset carrying a FRESHLY MINTED
id instead of `d1`. Revert that one line and it passes; every other file in the
same working tree is unchanged either way. It fails when the file is run ALONE,
so it is not a cross-file ordering artifact of the parallel runner.

#### The actual cause (found by review, 2026-09-09)

`store/selectionInvariant.test.ts` had:

```ts
it("splitDatasetByColumn (context-menu split acts on any row, selected or not)", () => {
  void useApp.getState().splitDatasetByColumn("d1", 0);   // <- never awaited
  expect(invariantHolds()).toBe(true);
});
```

`splitDatasetByColumn` awaits `resolveDataset` on its first line, so at the
moment of the assertion **nothing has happened yet** — the assertion could not
fail. The action's `set()` then resolved during whichever test happened to be
running next. With a STATIC import the timing put it somewhere harmless; adding
one `await import()` moved it into the `restoreFromTrash` test, which then saw a
dataset it did not expect and reported a generated id.

Fixed by making the test `async` and awaiting the call — which repairs the
vacuous assertion and the leak together. The lazy import then lands with nothing
else changed, and the reduction was collected (see
`frontend/scripts/check-bundle-size.mjs`'s history block: 913,869 measured,
1,001 bytes off what the commit would otherwise have needed).

#### The lesson, which is why this entry stays

A `void`-ed promise in a synchronous test is two bugs wearing one coat: an
assertion that cannot fail, and cross-test state leakage whose landing point
depends on unrelated microtask timing. When an innocuous change "breaks" a
distant test, suspect an un-awaited async call before suspecting the bundler.
And a withheld optimization deserves re-examination before it is paid for with a
budget raise — this one was blocked by a phantom, and the raise it justified was
unnecessary.

#### Why it looked odd at the time

`restoreFromTrash` ALREADY uses exactly this pattern — it `await import()`s
`store/trashRestore.ts` (see `store/trash.ts`'s header, which documents the
deferral as a deliberate bundle win). So a dynamic import in a store slice is
established practice here; adding a SECOND one in a sibling slice is what
changes behaviour, which is the part that makes no obvious sense.

Candidate mechanisms, none confirmed:
- Two module instances of something (`store/useApp.ts`'s id counters live at
  module scope), so `nextDatasetId` is not the counter the test's expectation
  was built against.
- The restore's workbook self-heal (`trashRestore.ts`'s
  `deriveWorkbooks([restored], s.folders, nextWorkbookId)`) taking a different
  branch, cascading into a new dataset id.
- A test-setup assumption about which modules are already evaluated.

#### What is blocked by it

A measured **720-byte** eager-bundle reduction — `lib/datasetsplit.ts` (~3.5 kB
of pure splitting/slicing math) leaving the eager graph entirely, since
`store/split.ts` is its only eager consumer and every other importer already
sits behind a lazy panel. Measured 913,869 with the change vs 914,894 without:
bigger than BOTH of today's pin raises combined, so collecting it would put the
ratchet tighter than it has been all session. Full rationale in
`frontend/scripts/check-bundle-size.mjs`'s history block.

#### Investigation checklist

- [x] Bisected to the single import line.
- [x] Confirmed it fails with the file run alone (not a parallel-run artifact).
- [x] Root cause established — NEITHER of the guesses. An un-awaited async
  store action in a sibling test (`void ...splitDatasetByColumn(...)`).
- [x] The TEST was wrong, on both counts: vacuous assertion and leaked `set()`.
  The store's restore behaviour was never at fault.
- [x] Reduction collected and the pin LOWERED to 913,893 — 696 bytes tighter
  than the day started, repaying both of today's raises.

#### Completion record

- PR/commit: the Group M review-round commit (2026-09-09).
- Automated tests: `store/selectionInvariant.test.ts`'s
  "splitDatasetByColumn (context-menu split acts on any row, selected or not)"
  is now `async`/awaited; the whole file and `store/split.test.ts` pass with the
  lazy import in place.
- Agent verification: cause reproduced, fix verified, reduction collected.
- Owner verification: not required — test-only correctness plus a measured
  bundle reduction.

---

## UX-003 — a failed lazy chunk load unmounts the React root: 30 `lazy()` sites, no error boundary

**Priority:** P3 — recoverable by reloading the page, and it needs a chunk
fetch to fail (offline right after a deploy, or a stale cached `index.html`
referencing a since-rotated hash); but when it does happen the whole app
goes blank with no message at all
**State:** **FIXED** 2026-09-19 — see Completion record below
**Reported:** 2026-09-15 by agent (adversarial review of the `b749f804` bundle diet)
**Investigated:** measured, then fixed — see below
**Suggested implementation owner/model:** Unassigned
**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.1 (the lazy-seam
diet), `plans/BUNDLE_HEADROOM.md` slice 2

#### User-visible problem

Every code-split panel in the app is reached through React's
`lazy()` + `<Suspense>`. If the chunk behind one cannot be fetched, the lazy
component's promise rejects, and React propagates that rejection up looking
for an error boundary. There is none: measured 2026-09-15,
`grep -rln "componentDidCatch|getDerivedStateFromError|ErrorBoundary" frontend/src`
returns **0 files**, against **28** `= lazy(` sites (updated 2026-09-18,
`BUNDLE_HEADROOM.md` slice 4 review round;
`grep -rn "= lazy(" src --include="*.ts*" | grep -v "\.test\."` — same command
the previous rounds used): 17 sites at filing time, 19 after slice 3 (two more
sites in modules already on this list), 28 after slice 4, which both adds
sites to three of the original nine modules
(`components/Library/Library.tsx`, `components/Stage/PlotStage.tsx`,
`components/Stage/Stage.tsx`) and introduces three new lazy-bearing modules —
`components/Library/LibrarySections.tsx` (extracted from `Library.tsx`,
carrying eight sites: the six new flat-section seams plus two pre-existing
sites that moved with the extraction), `components/Stage/PlotStageOverlays.tsx`
and `components/Stage/PlotStageMenus.tsx` (one seam each — `PlotResultChips`,
`PlotContextMenu`). Full current module list and per-module counts: `main.tsx`
1, `App.tsx` 3, `AppOverlays.tsx` 1, `components/Library/Library.tsx` 3,
`components/Library/FigureRow.tsx` 1, `components/Library/LibrarySections.tsx`
8, `components/Stage/Stage.tsx` 2, `components/Stage/PlotStage.tsx` 3,
`components/Stage/PlotStageOverlays.tsx` 1, `components/Stage/PlotStageMenus.tsx`
1, `components/windows/WindowCanvas.tsx` 2, `components/windows/DocumentWindow.tsx`
2 — sums to 28.

**Re-measured 2026-09-19 (this fix, before touching any file):** the same
`grep -rn "= lazy(" src --include="*.ts*" | grep -v "\.test\."` returns **30**
on the tree this fix started from, not 28 — `components/windows/WindowCanvas.tsx`
had gained a third site (`BackgroundPlotWindow`, present since the original
E-c1 bundle pass and apparently never folded into this count) and
`components/Library/Library.tsx` a fourth (`LibraryFlatRows`, added by
`BUNDLE_HEADROOM.md` slice 6, 2026-09-19, after this entry's count was last
updated). Both are now accounted for in the fix below, which reaches every
one of the 30 by construction (each was mechanically converted from
`lazy(load)` to `lazyRegion(load, label)`, verified by
`grep -rn "= lazy(" src --include="*.ts*" | grep -v "\.test\."` returning
**0** afterward — the only 3 remaining hits are inside `lib/lazyRegion.tsx`
itself, the one place `lazy()` is still called).

So the failure mode is: the user clicks something that opens a lazy panel,
the fetch fails, and **the entire React root unmounts** — a blank window,
no toast, no status line, no console error the user would ever see. The
project state is not lost on disk, but everything unsaved in memory is, and
the only recovery is a page reload. React additionally caches the rejected
payload for that `lazy()` component, so even if the root survived, the next
gesture would not retry.

This is a whole CLASS, not one panel. It is filed now because the
2026-09-14 bundle diet's commit body claimed "chunk-load failures are
reported, never silent" and "a failed load is never cached, so the next
gesture retries" without qualification. Both are true of the three seams
that go through `commands/fileCommands.ts`'s `runLazy` or
`store/workbookTransfer.ts`'s own `fail()`; **neither is true of any
`lazy()`-shaped seam**, including that commit's own
`components/Library/OriginSavedPreviewWindow.tsx`. The claims were narrowed
in both plans on 2026-09-15; the missing boundary itself was deliberately
NOT added in that review round, because a root error boundary is a design
decision about what the app shows and offers when a subtree dies, not a
one-line patch to slip into a bundle-diet follow-up.

#### Reproduction

- [x] Starting state and sample data identified — any project; the Library
  figure row's saved-Origin preview ("▣") is the cheapest lazy trigger
- [x] Exact actions recorded — make the chunk unfetchable (DevTools offline,
  or delete the built chunk from `src/quantized/web/assets/`), then click a
  control whose panel is `lazy()`
- [x] Actual result recorded — measured in a scratch spec at `b749f804`
  (`vi.mock` of the lazy module throwing, then clicking "▣" on a
  `saved_preview` row): root HTML length after the click **0**, row present
  **false**, toasts **0**, `console.error` lines **0**
- [x] Expected result recorded — a failed panel/window/section degrades only
  that region; the rest of the app (and every other open window/panel) stays
  usable; the failure is visible (a named message, not silence); a retry
  after the underlying fetch would now succeed actually recovers
- [x] Reproduced by an agent

#### Investigation

- [x] Likely owning components/modules identified — the twelve modules that
  hold a `lazy()` declaration (see the per-module count above, now 30 sites
  across 12 modules) plus `AppOverlays.tsx`'s `lazyPanel()` factory, which is
  the ONE call site 52 workshop-panel/dialog seams already funnel through
- [x] Root cause confirmed rather than inferred — measured, both halves
  (0 boundaries, 30 sites) by the same greps, 2026-09-19
- [x] Related workflows and persistence paths checked — autosave is
  untouched by this fix (a failed chunk fetch no longer takes down the tree
  that `useWorkspaceAutosave` runs inside, which is itself strictly safer
  than before, but forcing an autosave from inside the boundary was
  considered and rejected — see Implementation below)
- [x] Existing plan overlap reconciled — `lazyRegion()` is now the seam
  itself (every `BUNDLE_HEADROOM.md` slice already converts a bare `lazy()`
  call to a `lazyRegion()` call with a one-word label), so a future slice
  adding a seam adds boundary coverage for free instead of growing this gap

#### Implementation

- [x] Minimal safe behavior defined — **decision: (b) one boundary per
  region, not (a) one root boundary** (too coarse: the whole app still goes
  away with an app-wide message for a one-panel failure) **— plus (c), a
  retry that rebuilds `lazy()`** (the only way to defeat React's cached
  rejection; see `src/lib/lazyRegion.tsx`'s header for the mechanism).
  Granularity follows how the seams are already grouped in
  `architecture.test.ts`'s own `SEAMS` list and the modules that hold a
  `lazy()` declaration: Library (`Library.tsx`/`LibrarySections.tsx`/
  `FigureRow.tsx`, label `"Library"`/`"Preview"`), Plot
  (`PlotStage.tsx`/`PlotStageMenus.tsx`/`PlotStageOverlays.tsx`, label
  `"Plot"`), Stage tabs (`Stage.tsx`, label `"Map"`/`"Worksheet"`), Window
  (`WindowCanvas.tsx`/`DocumentWindow.tsx`, label `"Window"`), the three
  App-shell workspaces (`App.tsx`, each its own label), the calc-only deep
  link (`main.tsx`), and the AppOverlays panel/dialog family (label
  `"Panel"`, one factory covering 52 call sites). A failed panel/window/
  section degrades only itself; a failed Library section does not take the
  Stage down, and vice versa.
  **Review round 2 residual (deliberately NOT finished):** within the 30
  direct seams, several distinct components still share one coarse label
  (`"Library"` × 9, `"Window"` × 5, `"Plot"` × 5) — "which region failed?"
  is only fully answered for the 52 `lazyPanel()` sites, each of which DOES
  carry a distinguishable label. Splitting the 30 to match was built and
  measured: it pushed eager bytes from 876,437 B to 876,645 B, over the
  876,469 B budget by 176 B. Reverted rather than touch the pin — the
  per-call-site label strings cost real, permanent eager bytes for a
  diagnostic that already narrows to one of ~5 components per coarse label
  via the stack trace `componentDidCatch` logs. Revisit if/when a diet
  slice reopens enough headroom.
- [x] Failure and ambiguous-data behavior defined — the boundary
  distinguishes a load failure from a render error rather than catching
  everything: `taggedLoader()` wraps only the loader's own failure (sync
  throw or async rejection) in a `LoadFailure` marker class (`instanceof`
  checked, never by mutating the caught value, which would throw on a
  frozen/non-extensible rejection and lose the tag); `getDerivedStateFromError`
  re-throws anything that isn't a `LoadFailure`, handing it to the next
  boundary up (or letting it crash) exactly as if lazyRegion were not
  there. A genuine bug in an already-loaded component's own render is
  therefore never mislabeled "failed to load" — round 2's HIGH finding.
- [x] Data integrity and backward compatibility considered — no autosave
  hook added: the boundary is a pure render-layer catch, forcing a save
  from inside `componentDidCatch`/`getDerivedStateFromError` would run
  arbitrary async I/O from an error path or during a React render commit,
  which is a bigger risk than the failure being fixed. In-memory state
  elsewhere in the app is untouched by design (criterion 1) — nothing new
  is lost by not writing
- [x] UI wording/tooltips/accessibility included — `role="alert"` (assistive
  tech announces it immediately, matching `Toaster`'s own live region
  convention), the Unicode glyphs `⚠`/`↻` per CLAUDE.md's icon rule (no
  emoji), and colors read from the `--danger`/`--glass-border` design
  tokens (`src/styles/platform.css`'s `.qzk-lazy-fail` block) — never
  hardcoded

#### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward — sabotage-
  verified three ways, see Completion record
- [x] Relevant focused tests pass
- [x] Type-check/build/repository gates pass
- [x] Agent verifies acceptance criteria
- [ ] Owner verifies when required

#### Completion record

- PR/commit: fixed in this worktree's branch across three rounds — initial
  fix, then two adversarial-review rounds each finding and closing real
  defects (see the session's reported SHAs); not yet merged
- Automated tests: `src/lib/lazyRegion.test.tsx` (12 tests) +
  `src/AppOverlays.lazyFailure.test.tsx` (1 test) = **13 tests total**:
  root/sibling survival, retry recovery against a loader that rejects once
  then resolves, a second failure+retry, props pass through, an unaffected
  sibling region, a render error from a successfully-loaded component
  propagating to an OUTER boundary instead of showing the retry UI (and the
  mirror case — a real load failure still shows it), a retry on one
  mounted instance NOT remounting or resetting a sibling instance of the
  same seam (mount count + local state both asserted unchanged), a fresh
  mount of a previously-failed seam recovering without Retry, N simultaneous
  fresh mounts of one seam all settling within a single fixed microtask
  batch (proof the per-instance design stays cheap — no serialization), a
  frozen/non-extensible rejection still showing the retry UI (proof tagging
  doesn't mutate the caught value), and a loader that throws synchronously
  still being caught. Plus the REAL AppOverlays composition root
  (`AppOverlays.lazyFailure.test.tsx`) with a real module path
  (`ShortcutsDialog`) mocked to reject then resolve, and a SECOND, healthy
  overlay (`WhatIsThis`) opened alongside it whose content is asserted
  present throughout — real evidence a sibling survives, not the vacuous
  `container.isConnected` check round 2's review correctly rejected. One
  pre-existing test (`components/windows/WindowCanvas.test.tsx`'s w2 polar
  canvas check) was changed from a fixed `setTimeout(10)` sleep to a
  `waitFor` on the canvas's own presence — kept, a strict improvement. A
  second change to that file (a `waitFor` around a "No dataset" text check)
  was tried in round 1, challenged in round 2 as unmotivated, re-measured
  (the synchronous check passes 3/3 when the WHOLE file runs, because
  earlier tests in the file warm the seam's `resolved` cache before this
  one reaches it — it only fails when run in isolation, which the gate
  never does) and reverted to the parent's synchronous form. The full
  frontend suite is green.
- Agent verification: sabotage table (7 sabotages across the fix's three
  rounds; each applied, run, confirmed reddened, then reverted and
  re-confirmed clean) —

  | # | Sabotage | Tests that reddened |
  |---|---|---|
  | 1 | Remove the boundary (`getDerivedStateFromError` commented out) | 8/10 unit tests in `lazyRegion.test.tsx` (root-survival, both retry tests, sibling-unaffected, fresh-mount, N-mounts-batch excluded) + the `AppOverlays.lazyFailure.test.tsx` test |
  | 2 | Break retry's cache-busting (skip building a fresh `lazy()` on retry) | exactly the two retry-recovery tests in `lazyRegion.test.tsx` + the `AppOverlays.lazyFailure.test.tsx` test |
  | 3 | Fallback renders `null` instead of the message+button | 7/10 unit tests + the `AppOverlays.lazyFailure.test.tsx` test |
  | 4 | Catch every descendant error unconditionally (finding #1 — no load-vs-render distinction) | exactly "does NOT show the load-failure UI for a render error…" |
  | 5 | Reintroduce ONE module-scoped `current`, re-read by every render, reassigned by any instance's retry (finding #2) | **3 tests**, not 1 as first reported: "retrying one mounted instance does not remount or reset a sibling…", "a fresh mount of a previously-failed seam is not stuck…", and "N simultaneous mounts…" (a correction — the first report of this sabotage understated it) |
  | 6 | Tag a load failure by mutating the caught value (finding #2, round 2 LOW) instead of wrapping it | exactly "still shows the retry UI for a load failure that cannot be mutated (frozen rejection)" |
  | 7 | Drop the try/catch around the loader's synchronous call (finding #3, round 2 LOW) | exactly "still shows the retry UI for a loader that throws synchronously" |

- Owner verification: —
- Notes: filed by the 2026-09-15 review round of `b749f804`; that round
  narrowed the two over-broad claims in the plans and left the boundary
  itself to this item. Fixed 2026-09-19 across three rounds:
  - **Round 1:** `src/lib/lazyRegion.tsx` (new) is a drop-in replacement
    for `lazy()`. All 30 `lazy()` declarations were converted; AppOverlays'
    `lazyPanel()` factory (52 call sites) now delegates to
    `lazyRegion(load, "Panel")` in one place. Every now-redundant
    per-call-site `<Suspense>` wrapper was removed (lazyRegion carries its
    own).
  - **Round 2** (adversarial review found two HIGH + three MED): fixed the
    load-vs-render conflation (finding #1 — see Implementation) and the
    module-scoped mutable "current" that let one instance's retry silently
    remount a sibling instance of the same seam (finding #2). The fix is a
    hybrid, not a pure per-instance rebuild: each mounted `Region` owns its
    own retryable `lazy()` via `useState`'s lazy-initializer form (set once
    per mount, replaced only by THAT instance's own retry — this is what
    makes retry safe for siblings), but a fresh mount's initializer first
    checks `resolved`, a plain module-scoped cache written ONLY by a
    successful resolution and read ONLY by a fresh instance's own
    initializer, never by an already-mounted one. That keeps the common
    (never-fails) case behavior-identical to plain `lazy()` — once any
    instance has loaded a seam, every LATER mount renders synchronously
    from the cache — while a failure is never cached past its own
    instance, which also closed finding #3 (a plain remount recovers) for
    free. Also fixed: the vacuous `AppOverlays.lazyFailure.test.tsx`
    assertion (finding #4) and the 52 `lazyPanel()` labels, mechanically
    derived per import-path basename instead of one shared `"Panel"`
    string (finding #6).
  - **Round 3** (second adversarial review, both HIGH fixes confirmed
    sound; three LOW + one factual correction remained): the load-failure
    tag moved from mutating the caught rejection (`err[SYMBOL] = true`,
    which throws on a frozen/non-extensible value and loses the tag — the
    original bug, reappearing under a corner case) to wrapping it in a
    `LoadFailure` marker class carrying the original as `.cause`, checked
    with `instanceof` — tagging can now never fail. The loader's call is
    also wrapped in try/catch, not just `.catch()`, so a loader that throws
    synchronously (not reachable through today's 30+ `() => import(...)`
    call sites, but defensive) is tagged the same way. Reverted a
    `WindowCanvas.test.tsx` change round 1 made without justification (see
    Automated tests above), corrected this record's own sabotage-count
    claim (5→3, see the table), and closed a stale raw-source-text
    assertion in `HelpDialog.test.tsx` that the per-panel labels broke
    (asserted the exact `lazyPanel(() => import(...))` call text, which
    gained a second argument).

  **Eager bundle cost** (measured after `npm ci` + a cleared
  `node_modules/.vite`, via the repo's `exactbytes.mjs`; every prior number
  quoted for this fix before this round used a STALE cache and is
  corrected here — see the strikethrough note below): base `281ee552`
  measures **875,755 B**, round 1's tree (`4735f944`) measures
  **875,005 B** (−750 B — removing ~30 `<Suspense>` wrappers outweighed the
  new boundary code), and this final tree measures **876,437 B** — **+682 B**
  over round 1 (the `LoadFailure` wrapper class, the load-vs-render
  distinction, and the hybrid per-instance/cache design all cost real,
  permanent bytes) and **+682 B over the base**, against the unmoved
  `876,469 B` `EAGER_JS_BUDGET`: **32 B of headroom**. The budget pin was
  not touched, and the per-seam label split described in Implementation
  above was reverted specifically because it would have crossed this line.

  ~~Earlier note (superseded, kept for the record per the doc-promise
  audit rule): a prior version of this entry reported round 1 at
  `875,005 B` / `1,464 B` headroom and attributed later movement to "a
  stale `.vite` cache". That attribution was WRONG. `875,005 B` is exactly
  reproducible for `4735f944` with a genuinely cleared cache — the number
  was correct, not stale. The `1,323 B` gap to this round's `876,328 B`
  interim measurement (before the label revert) was this fix's OWN round 2
  delta (the `LoadFailure` class, try/catch, `componentDidCatch`
  cause-extraction, and the per-instance/cache hybrid), mistaken for a
  cache artifact. No cache lied; a commit's real cost was misattributed.
  `CLAUDE.md`'s existing "vite's transform cache also lies" lesson records
  a genuine instance of that failure mode elsewhere — this was not a
  second one, and is corrected rather than left to imply it was.~~

---


## BUG-018 — one Escape closes TWO stacked backdrop dialogs (and silently answers a pending confirmation)

**Priority:** P2 — a destructive-action confirmation can be answered by a keystroke the user aimed at the dialog above it  
**State:** **FIXED** 2026-09-19 (`5d6ef1b9`) — option 1 built, measured, sabotage-verified; owner verification remains  
**Reported:** 2026-09-19 by Claude (agent), from the adversarial review of `cee0494f`  
**Investigated:** 2026-09-19 — root cause confirmed in code and measured in jsdom on `490243f9`; the reviewer reproduced it independently in real Chromium  
**Suggested implementation owner/model:** —  
**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P3.3, residual R1 (narrowed round 8), R12, R13

#### User-visible problem

Two backdrop dialogs can be open at once, and one Escape closes both.

The reachable path uses no mouse. `useGlobalShortcuts`' `?` branch has no
"a dialog is already open" guard, and these dialogs `stopPropagation()` only
on `Escape`, so every other key still reaches the window-bubble global
shortcuts while a dialog is open. So `Ctrl+,` (Preferences), then `?`
(Shortcuts sheet, which opens ON TOP), then ONE `Escape` takes
`[role="dialog"]` from 2 to 0. `Ctrl+K` and the Help command are the same
shape.

The sharpest case is Preferences over a `ConfirmDialog`. `askConfirm` is the
app's styled replacement for `window.confirm` on destructive actions ("Remove
all", …). With a confirmation pending and Preferences opened above it, one
Escape dismisses Preferences **and resolves the confirmation `false`** — the
user answers a question they were not looking at, with a keystroke aimed at
something else. It resolves to the safe answer, which is why this is P2 and
not P1; but the gate on an irreversible action is being operated by accident,
and the user is given no indication it happened.

#### Reproduction

- [x] Starting state and sample data identified — no data needed; any build
- [x] Exact actions recorded — `Ctrl+,`, then `?`, then one `Escape`
- [x] Actual result recorded — see the table below
- [x] Expected result recorded — one Escape closes the INNERMOST dialog only;
      the next Escape reaches the one below it
- [x] Reproduced by an agent — in real Chromium (keyboard only, by the
      reviewer) and in jsdom against the real components (four stacked pairs)

Measured on `490243f9`, real components, `user.keyboard("{Escape}")` at
`document.activeElement`, after letting a macrotask elapse:

| stacked pair | after ONE Escape | intended |
|---|---|---|
| Preferences + Shortcuts | 2 → **0** dialogs | 2 → 1 |
| Preferences + Help | 2 → **0** dialogs | 2 → 1 |
| Preferences over a pending `ConfirmDialog` | 2 → **0**, and the confirm **resolved `false`** | 2 → 1, confirm still **pending** |
| a LONE backdrop dialog (control) | 1 → 0 | 1 → 0 — correct, unchanged |

#### Investigation

- [x] Likely owning components/modules identified
- [x] Root cause confirmed rather than inferred
- [x] Related workflows and persistence paths checked
- [x] Existing plan overlap reconciled

**Root cause.** All ten backdrop dialogs register their Escape handler as
`window.addEventListener("keydown", onKey, true)` and call
`e.stopPropagation()`. `stopPropagation()` does not stop other listeners on
the **same node in the same phase** — that needs `stopImmediatePropagation()`
— so when two of these are mounted, both handlers run on one keystroke. The
ten: `CombineWorkbooksDialog`, `ConfirmDialog`, `HelpDialog`,
`PreferencesDialog`, `RecoveryChoiceDialog`, `ReimportAllDialog`,
`SeparateWorksheetsDialog`, `ShortcutsDialog`, `SplitDatasetDialog`,
`TextFormatHelp` (all under `frontend/src/components/overlays/`).
`WhatIsThis.tsx` uses the same listener shape but is a MODE, not a backdrop
dialog, and is mutually exclusive with them.

**Not a regression.** The Escape effects are byte-identical to their state
before `cee0494f`; that commit added focus-in/trap/restore and did not touch
Escape. What `cee0494f` did do is close P3.3's residual R1 and flip the audit
row to "window capture, kept" on the claim that a backdrop dialog "can never
be out-ranked" and that "joining the registry buys nothing". That is true for
a dialog over a NON-dialog surface — verified, and the
`menu ▸ gesture ▸ window ▸ workspace ▸ selection ▸ app` ladder in
`frontend/src/lib/escapeStack.ts` is not disturbed by these dialogs — and
false for dialog-over-dialog, which is the one case that ladder exists to
settle. R1 is narrowed accordingly in the audit plan.

**A fix was built and reverted (2026-09-19); start from this, not from
scratch.** All ten dialogs were migrated onto
`useEscapeSurface("window", …)`, keeping each dialog's close semantics.
Measured: it **works** — Preferences over Shortcuts went 2 → 1 → 0 on two
Escapes, and Preferences over a pending confirm closed Preferences first with
the confirm still pending, resolving `false` only on the second Escape.

It was reverted because it broke a different guarantee. `escapeStack`'s
dispatcher returns early on `isEditingTarget(event.target)`
(`INPUT`/`TEXTAREA`/`SELECT`/`contenteditable`), and **four of the ten
dialogs land focus on exactly such a control by design**: Help's search box,
`SeparateWorksheets`' and `CombineWorkbooks`' Name field, `SplitDataset`'s
Column select. Measured: with Help open and focus on its search box, Escape
did nothing at all, twice; `SeparateWorksheets` would not close from its own
documented landing spot. The scoped `components/overlays` suite went from 268
green to 9 failed / 264 passed across 7 files — four of those nine are this
genuine regression, the rest are synchronous `fireEvent` tests meeting the
registry's one-macrotask deferral.

So the migration needs one of:
1. a new top tier in `escapeStack` for true modals that bypasses the
   `isEditingTarget`, `cmdkOpen` and `.qzk-ctx` early returns (a change to a
   dispatcher that has produced an inversion in each of rounds 2–5 — it needs
   its own review round, not a drive-by); or
2. `stopImmediatePropagation()` plus a shared "topmost modal" sequence number.
   `useDialogFocus.ts`'s `trapStack` already computes exactly this ordering
   for Tab, allocates its `seq` once per component instance, and could be
   reused rather than reinvented.

Option 2 is the smaller change and does not touch the ladder; option 1 is the
one that makes "one ordered walk" true for every surface in the app. Either
way, the four editing-target landing spots are the acceptance criterion.

**FIXED 2026-09-19 (`5d6ef1b9`) — option 1.** `lib/escapeStack.ts` gains a
`modal` layer ranked above `menu`, and all ten backdrop dialogs are surfaces on
it. Option 2 was rejected for the reason recorded above: it would have left ten
dialogs permanently outside the single ordered walk, which is the split that
produced this bug.

**The bypass rule chosen: THE CLAIMANT resolves to a modal**
(`ordered[0].layer === "modal"`), not "a modal is registered anywhere". The two
coincide while `modal` is the top rank, but the claimant form is the narrower
statement of the same rule — it can only suspend a guard for a keystroke a
modal is actually going to be offered, and it stays correct if a layer is ever
added above this one. Nothing BELOW a modal is offered the key either, whether
the modal claims it or declines it, so a modal that DECLINES cannot hand a text
field's Escape down to a workspace or the app fallbacks — the surfaces the
bypassed guards existed to protect.

**Stated precisely (round-9 review; the first wording said "TRAPS Escape",
which is more than the code can deliver).** A modal outranks every surface in
the registry, and — because its claim is resolved SYNCHRONOUSLY at keydown and
marks the event with `preventDefault()` — any listener that honours
`defaultPrevented` and runs after the dispatcher stands down. It cannot stop a
listener that ignores `defaultPrevented`, and it does not try to beat one that
claims BEFORE the dispatcher runs (window-capture or document-bubble — how
`SymbolPalette` claims, and how the `WhatIsThis` mode still owns Escape
outright); such a claim is already visible in `defaultPrevented` and correctly
wins.

**That synchronous resolution is a round-9 review fix, and it was a measured
regression before it.** The layer was first built on the DEFERRED walk. With
Preferences open and a window-BUBBLE listener of `usePeakWizard`'s exact shape
(its marker-edit pause, live at step ② whenever there is something to pause and
not gated on focus being inside its own window — residual R11), the pause
claimed the key during the dispatch and `walk`'s own `defaultPrevented` re-read
then aborted the dialog's close: **the pause fired and `prefsOpen` stayed
`true`** — Escape dead for the dialog — where the parent tree's per-dialog
window-capture `stopPropagation()` had shielded it and the dialog closed.
Reachable with no mouse: Peak Analyzer at step ②, then `Ctrl+,` / `?` / Help.
Resolving `modal` at keydown and marking the key is rounds 5–6's fix for the
`gesture` layer applied to the same class of problem; after it, the pause does
not fire and the dialog closes. Pinned at both levels: "stops a LATE
window-bubble consumer from killing a MODAL's claim"
(`lib/escapeStack.test.ts`) and "a window-bubble claimant behind the dialog
cannot swallow the dialog's Escape" (`stackedDialogEscape.test.tsx`).

**A deliberate DECLINE traps; a THROW does not** (re-review). No dialog
declines today — all ten `return true` unconditionally — but `offer()` catches
a thrown handler, and folding that into "declined" would have made one broken
dialog disable Escape for the whole app while it stayed mounted. `offer()` now
distinguishes the two: the deferred walk still treats a throw as a decline (it
has no trap to lift), while under a modal a throw lifts the trap and the layers
below get the key. Pinned both ways in `lib/escapeStack.test.ts`.

**Known residual this fix makes worse, recorded not guessed at:** an Escape
pressed mid-IME-composition. `isComposing` is checked nowhere in the tree, so
this is pre-existing, but the synchronous `preventDefault()` now suppresses the
composition's own cancel as well as closing the dialog. Booked as P3.3
residual **R14**, explicitly UNVERIFIED — neither jsdom nor headless Chromium
can drive a real IME, and an unmeasured keyboard-dispatch change is what
rounds 2–5 each regressed on.

**The four editing-target landing spots, measured individually** (jsdom, real
components, `user.keyboard("{Escape}")` at the dialog's own landing spot, one
test each, each in its own dialog's test file):

| landing spot | tag `isEditingTarget` bails on | reverted attempt | this fix |
|---|---|---|---|
| Help's search box | `INPUT` | dead (nothing, twice) | closes on ONE Escape |
| `SeparateWorksheets`' Name field | `INPUT` | dead | closes on ONE Escape |
| `CombineWorkbooks`' Name field | `INPUT` | dead | closes on ONE Escape |
| `SplitDataset`'s Column select | `SELECT` | dead | closes on ONE Escape |

**A second blocker the first attempt never reached, found and fixed here.**
`CombineWorkbooks`, `SeparateWorksheets` and `SplitDataset` call
`e.stopPropagation()` for EVERY key in the dialog box's React `onKeyDown`.
Measured in jsdom: a React synthetic `stopPropagation()` calls
`stopPropagation()` on the NATIVE event at the React root container, which is
below `window` — so the registry's window-BUBBLE listener was unreachable from
inside those three dialogs. Escape is now let through there; every other key
still stops, exactly as before.

**Close semantics preserved.** `ReimportAll` still calls `cancel()`,
`RecoveryChoice` still `applyCancelRecovery()`, and `ConfirmDialog` keeps ENTER
on its own window-capture listener — the `e.repeat` safeguard and the
"a focused button activates itself" rule are about that dialog's own
destructive-action gate, not the Escape ladder, so only Escape moved. The
registry's own `event.repeat` guard covers Escape.

**`WhatIsThis.tsx` is deliberately untouched.** It uses the same listener shape
but is a MODE, not a backdrop dialog, and is mutually exclusive with them; its
window-capture `stopPropagation()` therefore still owns Escape outright while
the mode is on.

**R12 is NOT addressed and its wording is unchanged by this fix.** Two
`aria-modal="true"` dialogs can still be mounted at once — this fix changes who
gets the KEY, not the ARIA surface — and `aria-modal` still hides the toaster
and status-bar live regions. Closing it needs the `inert`-plus-live-region-
hoisting design decision R12 records.

#### Implementation

- [x] Minimal safe behavior defined — one Escape closes the innermost open
      backdrop dialog and nothing else; nothing below a modal is offered the
      key, whether the modal claims it or declines it, and the claim is
      resolved at keydown and marks the event so a later `defaultPrevented`-
      honouring listener stands down (see the precise statement above for what
      that does and does not cover)
- [x] Failure and ambiguous-data behavior defined — a dialog whose landing
      spot is a text field or `<select>` must still close on Escape from that
      control (the four named above); measured in the table in Investigation,
      one test each, from the real landing spot
- [x] Data integrity and backward compatibility considered — `ReimportAll`
      still calls `cancelReimportAll()` (coordinator-review G1), and
      `ConfirmDialog` keeps Enter's `e.repeat` safeguard on its own
      window-capture listener (only Escape moved)
- [ ] UI wording/tooltips/accessibility included where relevant — **NOT done,
      and deliberately out of scope here**: see R12 (two concurrent
      `aria-modal` dialogs, and `aria-modal` hiding the toaster and status-bar
      live regions). This fix changes who gets the KEY, not the ARIA surface,
      so R12's wording is unchanged by it

#### Tests and acceptance

- [x] Regression test written and failing in the correct direction —
      `frontend/src/components/overlays/stackedDialogEscape.test.tsx` PINS
      the defect in the house `DIVERGENCE (BUG-0xx)` style: it asserts the
      concrete values both sides produce and asserts they differ from the
      intended ladder, with the intended value recorded inline next to each.
      Fixing the bug inverts each `ACTUAL` expectation to its `INTENDED` one.
- [x] Relevant focused tests pass — the scoped `components/overlays` +
      `lib/escapeStack` + `architecture.test.ts` suite is 26 files / 358 tests
      GREEN (the reverted attempt left 9 failed / 264 passed across 7 files)
- [x] Type-check/build/repository gates pass — `tsc -b --force` and
      `eslint src --max-warnings=0` clean; full vitest 680 files / 11552
      passed; `npm run e2e` 62 passed / 1 skipped and
      `region-tool-escape.spec.ts` 6/6 consecutive clean runs, all under
      `CI=1` so no foreign dev server could be reused
- [x] Agent verifies acceptance criteria — 2026-09-19, see the tables above
- [ ] Owner verifies when required

#### Completion record

- PR/commit: filed 2026-09-19; **fixed 2026-09-19 in `5d6ef1b9`**
- Automated tests: `stackedDialogEscape.test.tsx`, inverted from the
  `DIVERGENCE` pin to an assertion of the ladder and extended to all four rows
  of the table above (Preferences+Shortcuts, Preferences+Help, Preferences over
  a pending `ConfirmDialog`, and the lone-dialog control). Four landing-spot
  cases, one per dialog, in `HelpDialog.test.tsx`,
  `SeparateWorksheetsDialog.test.tsx`, `CombineWorkbooksDialog.test.tsx` and
  `SplitDatasetDialog.test.tsx`. R13's three missing Escape-reachability pins
  (`fireEvent.keyDown(window, …)`) added to Separate, Combine and ReimportAll.
  Five synchronous `fireEvent` Escape tests converted to wait on STATE rather
  than a tick (the registry's walk is deferred one macrotask) — state waits, so
  the weak-wait ratchet is unmoved.
- Agent verification: five sabotages, each reverted after measuring — bypass
  forced off (9 RED, including all four landing spots); Combine's box re-stops
  Escape (2 RED); Shortcuts' handler returns `false` (1 RED, the
  Preferences+Shortcuts row); ReimportAll never registers (2 RED, including its
  new R13 pin); `ConfirmDialog` reclaims Escape on window capture (1 RED, the
  pending-confirm row).
- Owner verification: —
- Notes: the reviewer's Chromium reproduction and this entry's jsdom
  measurements agreed exactly. See P3.3's round-8 record for the reverted
  migration's full measurement and round 9's for what shipped. Bundle:
  888,754 B eager against the parent's (`8f79207d`) 888,562 B, +192 B, 221
  chunks either side — no seam moved, and the pin is untouched.

---

## BUG-019 — the per-technique view memory stored the whole app state, so every dataset switch compounded the workspace until the main thread stalled

**Priority:** P1 — silent state corruption that grows without bound; the visible failure is "every plot is blank"  
**State:** Verified complete (agent); owner verification on real data outstanding  
**Reported:** 2026-09-19 by owner  
**Investigated:** 2026-09-19, Claude (agent); adversarially reviewed the same day  
**Suggested implementation owner/model:** —  
**Related plan:** PLOT_WORKFLOW_PLAN item 5 (per-technique view memory); reported against RSM_CUTS_PLAN's box-integration flow, which is NOT where the defect lives

### User-visible problem

Verbatim: *"when I did a xrdml 3d data set and a box integration, the preview looked good, but then when I hit apply, it made a new plot that was empty, and when I toggled to previously plotted right data, they are also blank."*

The ROI box preview is pure client-side math in a rAF (`lib/roiMath.ts`), so it
is unaffected and looks correct. Apply lands a perfectly good dataset — and
then the plot area is empty, and so is every previously plotted dataset the
user switches back to.

**What the user IS told, corrected after review.** An earlier version of this
entry claimed "nothing is reported". That is false, and the claim is narrowed
here: `lib/autosave.ts:88` stores the real failure message in `health.error`,
`useWorkspaceAutosave.ts` calls `reportAutosaveHealth` **and** `setStatus`, and
`components/Shell/StatusBar.tsx:139-145` renders a persistent `role="alert"`
"⚠ autosave failing" carrying that message in its tooltip (pinned by
`StatusBar.test.tsx:96,102`) — the owner's screenshot showed that indicator.
What is NOT reported is the stall itself: while the main thread is inside the
serialize there is no frame to paint, and nothing anywhere names "your
workspace has grown too large to save". The one genuinely wrong surface was
the status wording, fixed with this entry: `flushAutosaveNow` hardcoded
"autosave failed (storage full or unavailable)" for every failure, but
`saveAutosave`'s single catch also covers `serializeWorkspace`, so a
`RangeError: Invalid string length` was blamed on the disk. It now names the
real reason and keeps the generic wording only when there is none.

### Reproduction

- [x] Starting state and sample data identified
- [x] Exact actions recorded
- [x] Actual result recorded
- [x] Expected result recorded
- [x] Reproduced by an agent

Driven against the RUNNING app (`qz --no-browser`, real backend, real built
SPA, Chromium via Playwright, `?harness` for state reads), on the owner's
sequence: import a 1-D XRDML scan and plot it, open a 220x220x5 RSM
(`metadata.is2D`/`map_shape`/`axis1_name`, the shape `io/xrdml.py::_build_2d`
emits — the owner's `m3learning_rsm.xrdml` is 465,885 x 5, roughly 10x this),
arm the Integration box, set `store.mapRoi`, click the commit bar's `∫ 2Theta`,
then toggle between the cut and the previously plotted scan.

`JSON.stringify(techniqueViewMemory).length`, measured at each step:

| step | with the defect | after the fix |
|---|---|---|
| prior scan plotted | 5,440,727 | 171 |
| on the map | 16,322,222 | 344 |
| after Apply (new cut plot) | 16,322,222 | 344 |
| toggle 1 (back to the prior scan) | 16,322,222 | 344 |
| toggle 2 | 32,387,084 | 344 |
| toggle 3 | 69,957,577 | 344 |
| toggle 4 | 123,592,932 | 344 |
| toggle 5 | 214,798,775 | 344 |
| toggle 6 | 359,639,968 | 344 |
| toggle 7 | `RangeError: Invalid string length` | 344 |
| toggle 10 | page unresponsive, >45 s, measurement abandoned | 344 |

A second run on two ordinary imported XRDML files (no synthetic data, 6,474
and 50 rows) reached 73.9 MB in ten switches and then stopped answering ANY
page evaluation from switch nine onward — no further output in the remaining
600 s. On the fixed build the identical probe runs all 26 switches, the map
stays at 344 bytes, and both datasets keep the same canvas ink every time
(537,953 / 51,795 — byte-identical measurements, so nothing about the drawing
changed).

**Expected:** the remembered view for a technique is a handful of channel
indices and two axis scales. It must not grow with the library, and must not
grow at all as the user moves between datasets.

### Investigation

- [x] Likely owning components/modules identified
- [x] Root cause confirmed rather than inferred
- [x] Related workflows and persistence paths checked
- [x] Existing plan overlap reconciled

**Root cause.** `lib/techniqueViewMemory.ts`'s `captureTechniqueView` ended
with `return { ...memory, [tech]: { ...liveView, labels } };`. `liveView` is
typed `LiveViewSource` — nine fields — but that interface is satisfied
STRUCTURALLY, and three of its four callers pass something enormously wider:

| call site | what it passes | probed size of one entry (`281ee552` vs fixed) |
|---|---|---|
| `store/windows.ts:151` (`focusedRebindPatch` — the shared body of `setActive` and `rebindWindow`'s focused branch, i.e. every Library click and every plot-intent activation) | the whole `AppState` | 177 B -> 347 B on a trivial library, unbounded on a real one |
| `useWorkspaceAutosave.ts:283` (the 800 ms-debounced autosave, which then `JSON.stringify`s the result) | the whole `AppState` | 1,567,653 B -> 347 B |
| `store/workspaceIO.ts:102` (File ▸ Save / Save As, into the `.dwk`) | the whole `AppState` | same path as autosave |
| `store/windows.ts:492` (background-window rebind) | a full `PlotView` | 177 B -> 347 B — over-wide but bounded and non-recursive |

**The growth relation, corrected after review.** It is NOT `2 x size(k-1)`.
The copied state includes `techniqueViewMemory` itself, so each capture nests
the map built by the one before it — but only the slot being written is
replaced, and the OTHER slots are left holding their own older copies. With a
single technique repeatedly captured the recursion is therefore LINEAR
(`size(k) = size(k-1) + C`). Alternating between two techniques — exactly what
"switch to the map, switch back" does — makes each slot absorb the other one
generation late: `size(k) ≈ size(k-1) + size(k-2) + C`, i.e. Fibonacci-like,
with the ratio tending to φ ≈ 1.62. Measured on `281ee552` alternating two
techniques: 80,340 -> 241,003 -> 482,002 -> 883,664 -> 1,526,325 -> 2,570,648
-> 4,257,632 -> 6,988,939 (ratios 3.0, 2.0, 1.83, 1.73, 1.68, 1.66, 1.64).
The field numbers in the reproduction table show the same 1.6x. More
techniques in rotation compound faster still. `datasets` sets the constant `C`,
which is why a 3-D RSM — the biggest single object the library ever holds —
makes it fatal after a handful of switches instead of dozens.

**Why Apply produces an empty plot, and why previously plotted data blanks
too.** Neither plot's DATA is wrong; nothing is mutated and no view field is
clobbered. Every measured payload was correct and complete at every step. The
failure is that the thread that draws is the thread that serializes. Autosave
subscribes to the store, and a changed `activeId`/`datasets` passes
`shouldAutosave`, so **every dataset switch and every dataset add schedules a
full workspace `JSON.stringify` 800 ms later** — of a structure that has just
grown by a factor of ~1.6. Landing the cut adds a dataset (bigger `C`) and
makes it active; the switch back to the previously plotted dataset compounds
again. React has already torn down the old uPlot instance and the
`/api/plot/series` promise has not resolved, so what the user is looking at
while the main thread is inside that `JSON.stringify` is an EMPTY plot frame —
for the new cut and, on the next toggle, for the old dataset as well.

**What was ruled out, by measurement rather than by reading.** The backend box
cut is correct (`POST /api/rsm/box` against a synthetic RSM returns a 21-row,
2-column DataStruct with the right `time`/`values`/`labels`/metadata, grid path,
`is2D` cleared). `cut_result` does not leak `is2D`/`map_shape` into the cut, so
the Stage correctly routes to the plot tab. No DataStruct is mutated in place:
`useCutLanding` → `addDataset` stores the parsed response as-is and
`buildSelectionOverlay`/`assembleOverlay` allocate fresh arrays. The
dataset-handle cache (`lib/api/datasetCache.ts` + `routes/_datasetcache.py`)
resends the full dataset on a 409 and was never implicated. The full ROI flow —
canvas commit bar, ROI panel Run, and batch "Apply to selected", in both
angular and Q space, on 50-point and 90,000-point maps — lands correct data and
keeps every plot drawing once the memory growth is removed.

**Separately filed:** the cut-id collision first noted here as a footnote is
now BUG-020, with its own reproduction. It reproduces the owner's symptom
class ("Apply made a new plot that was empty/wrong") independently of this
stall, which is why demoting it to a footnote was wrong.

### Implementation

- [x] Minimal safe behavior defined
- [x] Failure and ambiguous-data behavior defined
- [x] Data integrity and backward compatibility considered
- [x] UI wording/tooltips/accessibility included where relevant

One change, in the pure layer, at the single point every caller funnels
through: `captureTechniqueView` now stores
`{ ...projectLiveView(liveView), labels }`, where `projectLiveView` names the
nine `LiveViewSource` fields explicitly and is annotated `: LiveViewSource`, so
omitting a newly-added field is a compile error. Fixing it inside the capture
(rather than adapting each call site) is what makes it hold for all four
callers and for any future one — the interface stays structurally satisfiable,
which is what the call sites rely on, but what gets STORED no longer depends on
how wide the caller's object happens to be.

Behaviour of the memory itself is unchanged: the same nine fields are captured,
re-keyed by label and applied exactly as before (the existing round-trip,
re-key, shape-mismatch and sanitizer tests all still pass untouched). No schema
change: a `.dwk` written before this fix is read through
`sanitizeTechniqueViewMemory`, which already projected to these same fields on
load, so an oversized persisted map degrades to a correct small one rather than
failing. `LiveViewSource`'s doc comment now says why the projection exists,
since the sentence it replaces ("no adapter needed at either call site") is
what invited the bug.

Second, smaller change (see "What the user IS told" above): the autosave
failure status now names the real reason instead of always blaming storage.

### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward
- [x] Relevant focused tests pass
- [x] Type-check/build/repository gates pass
- [x] Agent verifies acceptance criteria
- [ ] Owner verifies on the real `m3learning_rsm.xrdml` workflow

`lib/techniqueViewMemory.test.ts`
- "stores only the nine declared view fields, never the wider object handed
  in" — captures from an `AppState`-shaped source and asserts the entry's key
  set exactly. The expected list is PARSED out of the `LiveViewSource`
  interface (the `PlotView` precedent at `architecture.test.ts:2238`), with a
  degraded-parse guard, so it cannot rot as the interface changes.
- "repeated captures that re-feed the previous map do not grow it" — feeds each
  capture's own output back in, as the store does, and asserts the serialized
  size stops moving.
- "remembers a log X axis, not just a log Y" — added after review found
  `xScale` was the one projected field with NO coverage anywhere: replacing it
  with a literal `"linear"` passed all 684 files / 11,592 tests.

`store/techniqueMemoryGrowth.test.ts` (new file) drives the owner's sequence
through the REAL store actions — `setActive`, then `useCutLanding.land()` with
the measured `/api/rsm/box` response, then `setActive` back:
- asserts the cut lands, and that both the new cut and the previously plotted
  dataset still produce drawable columns through the stage's own
  `effectiveChannels` + column packing;
- asserts no entry carries `datasets`/`plotWindows`/`techniqueViewMemory`, and
  that the map stays under 4 kB across ten switches and stops changing.

`useWorkspaceAutosave.test.ts` — two cases pinning that a serialization failure
is reported as itself and that the generic wording survives a message-less
throw.

Both memory files guard against vacuity (the store test asserts a capture
actually happened and that both technique slots are populated — without a real
`metadata.technique` tag, `techniqueOf` returns `"generic"` and every
assertion would hold on an empty map).

**What these tests deliberately do NOT claim.** The blank canvas is a
main-thread stall, not a data change; jsdom has no rendering and no autosave
timer pressure, so it cannot show a canvas going blank. These tests pin the
state size and shape that DECIDE whether the stall happens; the user-visible
half is the before/after table above, measured against the running app.

#### Completion record

- PR/commit: the branch's `fix(store): the technique view memory must store a view, not the whole app state`
- Automated tests: 7 new across three files, every one sabotage-verified
- Agent verification: before/after measured against the running app on the owner's own sequence (table above)
- Owner verification: outstanding
- Notes: the adjacent cut-id defect is now BUG-020, filed and fixed in the same commit

---

## BUG-020 — a landed cut reused an id already in the library, so Apply plotted the old cut and one delete destroyed both

**Priority:** P2 — silent data loss (one delete removes two datasets) and a wrong plot, reachable by a plain reopen-and-cut  
**State:** Verified complete (agent), including the four workshop follow-ups; owner verification outstanding
**Reported:** 2026-09-19, found by Claude (agent) while investigating BUG-019; confirmed by the adversarial review of `f8d72f43`  
**Investigated:** 2026-09-19, Claude (agent)  
**Suggested implementation owner/model:** —  
**Related plan:** RSM_CUTS_PLAN item 8 (the shared cut-landing hook)

### User-visible problem

`components/Stage/useCutLanding.ts` — the ONE landing path every cut commit
shares (the map's inline ∫ bar, the ROI panel's Run, and the batch "Apply to
selected") — minted dataset ids from a PRIVATE module counter:

```ts
let _seq = 0;
…
const id = `cut-${++_seq}`;
```

That counter resets on every page load; the library does not. Autosave restore
runs at startup, so a session that reopens a workspace containing `cut-1` and
then lands one new cut ends up with two datasets carrying that id. Nothing
dedupes: `store/useApp.ts:817`'s `addDataset` appends, and
`store/removeDatasets.ts:48` filters by id. Every id-keyed lookup in the app
then resolves to whichever came first.

This reproduces the owner's reported symptom class — "Apply made a new plot
that was empty/wrong" — independently of BUG-019's stall, which is why it is
its own entry rather than a note inside that one.

`store/idSeq.ts`'s whole documented purpose is to prevent exactly this: "One
counter per PROCESS … Ids are therefore unique across the whole workspace
regardless of prefix." This hook was the one minting site that did not use it.

### Reproduction

- [x] Starting state and sample data identified
- [x] Exact actions recorded
- [x] Actual result recorded
- [x] Expected result recorded
- [x] Reproduced by an agent

Reload the app (fresh module graph, so the private counter restarts) with a
library restored from autosave that already holds `cut-1`, then land one cut.
Measured with the defect present:

- the library holds `['cut-1', 'cut-1']` — the landed dataset never becomes
  separately addressable;
- `activeId` is `cut-1`, and `datasets.find(...)` returns the FIRST match, so
  the plot shows the OLD cut's rows (`values[0] === [10]`, not the new `[99]`);
- `removeDatasets(['cut-1'])` leaves `[]` — one delete destroys both.

**Expected:** a landed cut gets a library-unique id; Apply plots the cut just
made; deleting it leaves everything else alone.

### Investigation

- [x] Likely owning components/modules identified
- [x] Root cause confirmed rather than inferred
- [x] Related workflows and persistence paths checked
- [x] Existing plan overlap reconciled

No code anywhere depends on the `cut-` prefix (grepped: the only occurrences
were the minting line itself). The collision is confined to this one minting
site; every other dataset-minting path in the store already draws from
`store/idSeq.ts`.

### Implementation

- [x] Minimal safe behavior defined
- [x] Failure and ambiguous-data behavior defined
- [x] Data integrity and backward compatibility considered
- [x] UI wording/tooltips/accessibility included where relevant (none — ids are not user-visible)

`useCutLanding` now calls `nextDatasetId()` from `store/idSeq.ts`. Ids become
`ds-<t36>-<n>` like every other minted dataset, which embeds a timestamp as
well as the per-process counter, so a restored id from an earlier session
cannot be reminted. Nothing else changes: the returned id still flows to the
batch tool's `plotSelectedTogether`, and the name/status/error contract is
untouched.

Datasets already saved with a `cut-N` id keep it and keep working — the fix
only changes what NEW cuts are named, which is what removes the collision.

### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward
- [x] Relevant focused tests pass
- [x] Type-check/build/repository gates pass
- [x] Agent verifies acceptance criteria
- [ ] Owner verifies

`components/Stage/useCutLanding.test.ts` (new file), three cases against a
`vi.resetModules()` reload with a restored `cut-1` in the library — the reload
is what makes the page-load half real, and the store is taken from the SAME
fresh module graph as the hook so the assertions read what the hook wrote:
unique ids after landing; the ACTIVE dataset holds the new cut's rows; deleting
the landed id leaves the restored dataset alive. All three fail with the
private counter restored.

#### Completion record

- PR/commit: the branch's `fix(store): the technique view memory must store a view, not the whole app state`
- Automated tests: 3 new, sabotage-verified (restoring the private counter reddens all three)
- Agent verification: reproduction above measured on both trees
- Owner verification: outstanding
- Notes: found while investigating BUG-019; filed separately because it stands on its own

#### 2026-09-20 follow-up — repository-wide producer audit (ChatGPT-Sol)

The later BUG-021 review found the same collision shape in four workshop
hooks. `useBaseline`, `useHysteresis`, `useMagTools` (both Background and
Units), and `useReflectivity` (both simulation outputs) now mint their durable
dataset ids with `nextDatasetId()`. Critical self-review then found that
inventory was incomplete: demo/sample loading, folder/template batch outputs,
worksheet extraction/transforms, Import Wizard, SQLite, Dataset Math,
Digitizer, Tabulate and both FFT reductions had the same durable private-id
shape and now use the shared sequence too. Reflectivity's private counter remains only
for the visible names “Reflectivity model N” and “SLD profile N”; it no longer
defines identity. `architecture.test.ts` pins all four producers to the shared
sequence and rejects the six retired id prefixes. The four focused hook suites
pass (80 tests).

---
## BUG-021 — the Background tab runs the M(T) tool on an M(H) loop, and reports the 422 as `[object Object]`

**Priority:** P0 — a silently wrong scientific result (the corrected loop is
sheared down by Ms), reported by the owner from real VSM data  
**State:** **FIXED** 2026-09-20 — four reported defects plus six more found in
adversarial review, each reproduced first and each guarded by a
sabotage-verified test; owner verification on the reported file remains  
**Reported:** 2026-09-19 by owner, using the Magnetometry workshop ▸ Background
tab on a real M(H) hysteresis loop (x = Magnetic Field, −15,000…+15,000 Oe;
y = Moment, emu; strong linear diamagnetic slope; visible gaps where branches
break off mid-curve)  
**Investigated:** 2026-09-19 by Claude (agent) — every defect reproduced by
measurement before any code changed  
**Numbering note:** filed as BUG-019 on the branch and renumbered on rebase —
`main` had already taken BUG-019/BUG-020 for unrelated defects.

### User-visible problem

Pressing "Subtract background →" printed, in red, literally:

```
[object Object],[object Object],[object Object],[object Object]
```

and the owner separately asked why the control is called "High-T fraction",
which makes no sense for M(H). They were right, and that complaint was the
visible symptom of the deeper defect: the tab was running the M(T) analysis on
an M(H) loop.

### The four reported defects, and how each was reproduced

**1. The error-extraction path mis-rendered a FastAPI validation error.**
`frontend/src/lib/api/http.ts`'s `ensureOk` read the body as
`{ detail?: string }` — an unchecked cast. FastAPI's 422 sends `detail` as an
ARRAY of `ValidationError` objects (the repo's own generated
`frontend/src/lib/api/schema.d.ts` says so), so the array was assigned to a
`string` and interpolated. `ensureOk` is the SINGLE error-extraction path for
every backend fetch in the app (its own header says so), so this was reachable
from every endpoint.
*Measured:* posting the loop's body to the real route returned a 422 whose
`detail` was a 4-element list; `String(detail)` is exactly the reported line.

**2. The 422 itself: non-finite values become `null` in the request body.**
`JSON.stringify(Number.NaN)` is `null`, and every series field on these routes
is pydantic `list[float]`, which rejects `null` once per element. The loop's
four gaps produced exactly four validation entries — which is why there were
four `[object Object]`s.
*Measured:* the request body was built with **node**'s own `JSON.stringify`
(Python's `json.dumps` writes a non-standard bare `NaN` literal and would have
masked the bug — the first attempt at this reproduction returned 200) and
posted to the live route: `null` count 4, status 422, `detail` a 4-entry list
with `loc` `["body","moment",7/8/22/31]` and `msg` "Input should be a valid
number". Same family as BUG-017; the `.dwk`/autosave/Pack Project/clipboard
paths were fixed there, the API REQUEST path never was.

**3. The scientific bug: the Background tab used the M(T) tool on M(H) data.**
`useMagTools.ts` unconditionally called `subtractMagBackground` →
`calc.magnetometry.subtract_mag_background`, a ONE-SIDED linear fit over the
top `auto_fraction` of the x-range, correct for a high-temperature tail and
wrong for a loop. That function's own docstring says "Do not use that on a
hysteresis loop." The hook also named the x axis `temperature`
unconditionally, which is how it went unnoticed.
*Measured*, on a synthetic saturated loop (Ms 1e-3 emu, Hc 200 Oe, true
χ −3e-8 emu/Oe, true offset 5e-5 emu):

| | slope | second value | Ms pair | squareness | mean M at &#124;H&#124;>0.9·Hmax |
|---|---|---|---|---|---|
| raw | — | — | (+6.44e-4, −5.43e-4) | 0.7733 | +5.00e-5 |
| M(T) tool (what shipped) | −3.0000e-08 | intercept **1.0500e-03** | (+2.1e-19, **−2.000e-03**) | **1.0000** | **−1.00e-03** |
| M(H) tool (correct) | −3.0000e-08 | offset **5.0000e-05** | (+1.000e-03, −1.000e-03) | 0.4589 | −1.3e-19 |

The one-sided window sits entirely in the +H tail, so the intercept it removes
is `offset + Ms`, not `offset`. The corrected loop's plateaus land on `0` and
`−2·Ms`, and squareness reads a meaningless 1.0000. Both tools recover the
susceptibility correctly; only the vertical term differs, and it is the one
that destroys the result.

**4. The labelling.** "High-T fraction" and "Fits a line to the high-T tail of
M(T) and subtracts it" are correct ONLY for M(T). The two paths also have
different natural defaults (`auto_fraction` 0.1 vs `hi_fraction` 0.7).

### Six more found in adversarial review of the first cut

**5. The first fix REINTRODUCED the silent misdispatch, mirror-imaged.**
`magXAxis` read `metadata.x_column_name` alone, while the app's six other
label resolvers (`plotdata.ts`, `plotspec.ts`, `ChannelsCard.tsx`,
`quickFigureMapping.ts`, `panelwindow.ts`, `peakTableFit.ts`) all read
`x_column_long || x_column_name`. `io/origin_project/opj.py` puts Origin's
SHORT column name there — a bare letter — and the human label in
`x_column_long`, so `detectMagXKind`'s whole-word symbol rule fired on it: an
M(T) curve with `x_column_name:"B"`, `x_column_long:"Temperature"` classified
as **field** and silently ran the hysteresis routine. Fixed by reading
`x_column_long` first; Origin's unrecovered-x `"Row"` then correctly lands on
`unknown` and fails closed.

**6. Defect 2 was fixed at 1 of 3 call sites.** `useHysteresis.ts` still sent
raw series from both `hysteresisAnalysis` (fired AUTOMATICALLY in an effect on
dataset activation) and `subtractHysteresisBackground`, so the owner's same
gapped loop still 422'd in the Hysteresis workshop — legible after fix 1, but
still broken. Both now filter. `selectedFitData` (`fitselection.ts`) is
deliberately left alone: it is a shared primitive behind every fit path, and
the filtering belongs at the request boundary, not in it.

**7. A documented no-op was reported as success.** `subtract_hysteresis_background`
returns `(m, 0.0, 0.0)` unchanged when fewer than `min_points` exceed
`hi_fraction*max|H|` or the span is degenerate; the panel printed "removed:
χ 0, offset 0" and "removed χ·H background and re-centred the loop". It now
says no background was found, as the sibling `useHysteresis` already did.
Reachable by raising High-field fraction, or on a minor loop.

**8. A stale readout survived a dataset change.** `fit`/`warning`/`error`
cleared only on `setBgMode`. Run M(T) on dataset A, click loop B: the panel
re-labelled to M(H) and still showed A's slope/intercept. The readout is now
tagged with the dataset ids it is ABOUT (its source and the corrected dataset
it wrote) and shown only while one of those is active. **Ownership is derived,
not cleared by an effect** — an effect keyed on the active id fires on the
app's own `addDataset`, which activates the dataset just written, wiping the
readout in the same turn that produced it (measured: 8 tests red).

**9. The Units tab destroyed good x.** `dropGapRows` pairs the coordinates, so
a finite field value on a moment-gap row came back `NaN`, and the first
commit's own test pinned that. A unit conversion is a scalar multiply per
axis, so no row can influence another: `substituteGaps`/`restoreSubstituted`
(new, in the same module, with the distinction documented) send a finite
placeholder per gap PER AXIS and discard its converted result, so each axis
keeps exactly the gaps it started with. `convert()` also gained the
minimum-data guard it lacked.

**10. Record drift.** A line count and a missing bundle number, corrected here.

### Five more from the re-review (round 3)

**11. The bare-letter hole — the SAME defect class, third recurrence.**
Reading `x_column_long` first was right but not sufficient:
`io/origin_project/opj.py`'s `_label_for` falls back to the bare Origin SHORT
designation when the worksheet carried no Long Name, so `x_column_long` can
ITSELF be "B", "H" or "T". With a blank Unit row the whole-word symbol rule
fired on that letter and an M(T) curve in Origin column B or H silently ran
the hysteresis routine (an M(H) loop in column T, the M(T) one). Closed at the
root: a LONE symbol — the whole label is one letter — is not evidence of a
quantity and now yields `unknown`, the same fail-closed answer Origin's "Row"
already got. A recognisable unit is consulted first and still decides on its
own, so "H"/"Oe" and "T"/"K" are unaffected; only a bare letter with no
corroborating unit falls through to the user.

**12. The derived dataset recorded no x identity.** A derived dataset's x is a
bare `time` column, so the inherited `x_column_*` hints are all any later
reader has. When x came from a CHANNEL they described the SOURCE's original
time column, so the panel could flip to "Cannot tell M(T) from M(H)" the
instant its own output became active, and a second run could dispatch off
metadata for a different quantity. Both outputs now stamp the real identity
(`stampXIdentity`), and the converted dataset stamps `x_column_long` too —
without it the new precedence would read a stale inherited long name.

**13. A minor loop was claimed to be re-centred.** The one-sided branch of
`subtract_hysteresis_background` removes a slope and deliberately does NOT
centre (offset exactly 0, a symmetric centre being undefined). The status line
now says "not centred — high field on one side only" in that case.

**14. The Hysteresis workshop dropped gap rows with no notice.** Its automatic
analysis now surfaces the same "N of M rows are gaps" warning the Background
tab gives, on both its paths, rendered in the panel.

**15. `convert()` refused too little and too much.** Its guard only fired when
BOTH axes were all-gap; one all-gap axis now converts the other and warns that
the output column is empty, rather than silently minting it.

### The fix

- `lib/api/errorDetail.ts` (new) renders any `detail` shape as one short line
  — `body.moment.7: Input should be a valid number`, deduplicated, capped at
  three, with the TOTAL entry count appended when anything is left out (a
  "+N more" computed off deduplicated lines would be a lie). It never throws:
  it runs while another error is already being reported. `ensureOk` handles a
  string detail inline and `await import()`s this module only on the
  non-string path, so the formatter's bytes stay out of the eager bundle.
- `lib/api/finitePairs.ts` (new) holds BOTH gap contracts and the reason they
  differ. For a FIT, **drop**: `dropGapRows` removes a row when either
  coordinate is non-finite and records that row's original index;
  `restoreGapRows` scatters the result back to those indices, leaving `NaN` at
  the gaps, and THROWS on a length mismatch rather than returning a shifted
  column. **Ruling:** a gap in a measured loop is missing data, so the fit must
  never see a stand-in — dropping is the only encoding under which
  `np.polyfit` cannot be handed an invented value — and row alignment is
  preserved by construction. The alternative (teach the backend to accept and
  ignore non-finite entries) was rejected: it changes the wire contract and the
  OpenAPI schema for every caller, and moves the "which rows were real"
  bookkeeping to the side of the boundary that does not own the dataset. For a
  row-INDEPENDENT transform, **substitute** (finding 9).
- `lib/magDataKind.ts` (new) decides M(T) from M(H) **from declared metadata
  only**: the x unit when recognisable (Oe/kOe/T/mT/G/A/m… ⇒ field; K/°C/°F ⇒
  temperature), else the x label ("field"/"magnetic"/whole-word H or B ⇒ field;
  "temp"/"kelvin"/whole-word T ⇒ temperature), and a label and unit that
  DISAGREE yield `unknown` rather than a winner. Shape heuristics
  (non-monotonic x, symmetry about zero) are deliberately NOT a decider:
  guessing the analysis from the shape of the data is the failure mode being
  fixed, in a new costume. **Unknown fails closed** — the panel disables the
  action, says what it could not determine, and offers Auto / M(T) / M(H).
- `useMagTools.ts` dispatches on that, keeps the two fractions in SEPARATE
  state (0.1 for M(T), 0.7 for the loop, never crossed), and reports the right
  quantity for each path — the M(H) route returns an **offset**, not an
  intercept. `magXY`'s output is no longer called `temperature`.
- Prose swept: `routes/magnetometry.py`'s module docstring, both frontend API
  wrappers, the hook and the panel headers now say the tab covers two distinct
  routines. The backend function is genuinely about high-T and still says so.

### Tests and acceptance

- [x] Reproduction recorded for all four reported defects (above), each
      measured before any code changed
- [x] Regression test per defect and per review finding, each sabotage-verified
- [x] Relevant focused tests pass
- [x] Type-check/build/repository gates pass
- [ ] Owner verifies on the reported VSM file

#### Completion record

- PR/commit: see the branch's commit
- Automated tests: `lib/api/errorDetail.test.ts`, `lib/api/http.test.ts`,
  `lib/api/finitePairs.test.ts`, `lib/magDataKind.test.ts`,
  `components/workshops/magtools/useMagTools.test.ts`,
  `components/workshops/magtools/MagToolsPanel.test.tsx`,
  `components/workshops/hysteresis/useHysteresis.test.ts`,
  `tests/test_api_magnetometry.py`
- Agent verification: 19 sabotages over three rounds, each restored
  byte-identical — see the commit body's table
- Owner verification: pending
- Line counts (measured with `wc -l`, no new pin): `useMagTools.ts` 472 of
  500, `MagToolsPanel.tsx` 201 of 400, `useHysteresis.ts` 155,
  `magDataKind.ts` 152, `finitePairs.ts` 137, `errorDetail.ts` 101,
  `HysteresisPanel.tsx` 75
- Bundle, re-measured on the CURRENT base (`2e9ed223`, which carries vite
  8.3.0 and vitest 5.0.1 — a re-chunk would have moved this, so it was
  measured there rather than carried over): 877,081 B eager at the parent ->
  877,336 B here, **+255 B**, 846 B under the unmoved 878,182 B budget. Both
  measured after `npm ci`, main's in a throwaway worktree removed afterwards.
  `errorDetail` is still emitted as its own chunk with zero `modulepreload`
  references in `index.html`, so the lazy-import claim still holds under the
  new vite
- Notes: no route or request/response model changed — only a module docstring
  — so `schema.d.ts` needs no regeneration and
  `tests/test_openapi_snapshot.py` passes. The "autosave failing" banner the
  owner saw at the same time was investigated and is NOT this bug's NaN cause
  (`saveAutosave` is measured returning `true` with `autosaveHealth().error`
  null on NaN/`-0` cells, because `serializeWorkspace` applies BUG-017's
  sentinel encoder); it is **BUG-019 on `main`** — the per-technique
  view-memory compounding, whose `JSON.stringify` failure raises that exact
  banner. A separate filing was drafted and dropped as a duplicate.

---

## BUG-022 — `selectedFitData` leaves reachable 422s on six fit call sites

**Priority:** P1 — the owner's own gapped hysteresis loop still fails in Curve
Fit; legible since BUG-021's `errorDetail.ts`, but still a failure
**State:** Verified complete (agent); owner verification outstanding
**Reported:** 2026-09-20 by Claude (agent), reviewing BUG-021
**Implemented scope:** the six request boundaries listed below; `selectedFitData` intentionally unchanged

### The defect

`lib/fitselection.ts`'s `selectedFitData` (`:33-53`) packs `x`/`y` straight
out of the analysis view and does **not** filter non-finite values. Every
consumer posts that pair to a pydantic `list[float]` route, where a
`JSON.stringify`d `NaN` arrives as `null` and is rejected once per element —
the identical mechanism BUG-021 fixed for magnetometry:

| Caller | Route |
|---|---|
| `useCurveFit.ts:211-212` | `routes/fitting.py:49` |
| `useEquationFit.ts:181+` | `routes/fitting.py:55` |
| `useModelScan.ts:67` | `routes/fitting.py:129` |
| `useBumpsFit.ts:74` | `routes/fitting.py:184` |
| `usePeakWizard.ts:154` | `routes/fitting.py:263` |
| `autoGuess` | `routes/fitting.py:342` |

A measured loop with gaps therefore 422s in Curve Fit exactly as it did in the
Background tab.

### The ruling BUG-021 already made, and why it was not applied here

BUG-021 deliberately left `selectedFitData` alone: it is a shared primitive
behind every fit path, and the filtering belongs at the REQUEST BOUNDARY, not
inside a selection helper (a fit hook may legitimately want to know that rows
were dropped, and a silent filter inside the selector would hide that from all
six). That reasoning stands; this entry is the boundary work not yet done.

`lib/api/finitePairs.ts` already provides the contract to apply —
`dropGapRows` + `restoreGapRows` for anything that fits, `substituteGaps` +
`restoreSubstituted` for anything elementwise — including the row-alignment
guarantee and the throw-on-mismatch that keeps a corrected column from
shifting. Each site also needs BUG-021's user notice ("N of M rows are gaps"),
not a silent drop.

### Reproduction and acceptance

- [x] Mechanism identified and each call site named (above), code-read
- [x] Regression coverage for Curve Fit, auto-guess, Equation Fit, Model Scan,
  Bumps, and Peak Analyzer
- [x] Fitted overlays restore gaps at their original row indices
- [x] User notice names the number of excluded rows
- [x] Type-check and focused tests pass
- [ ] Owner verifies the original gapped hysteresis file in Curve Fit

### Implementation record — 2026-09-20 (ChatGPT-Sol)

Filtering is applied immediately before each backend request, not inside
`selectedFitData`. Curve Fit also projects a resolved `dy` vector through the
same `keep` indices, so weighted and unweighted fits see identical rows. For
the three paths that return a per-input fitted curve (registry, equation and
Bumps), `restoreGapRows` reconstructs the analysis-row result before the
existing excluded/filter-row expansion reconstructs full dataset length.
Peak Analyzer filters its range-cut working segment once, remaps `kept` to the
original rows, and therefore keeps baseline overlays aligned while making
baseline, find, fit and integrate requests safe. Zero finite pairs fail with a
plain-language error rather than making a guaranteed-invalid request.

Critical self-review found the original six-site inventory was incomplete.
The durable recalc path and pipeline replay could reintroduce the same 422
after a successful interactive fit; both now filter at their own request
boundary, align `dy` through the same kept indices, and restore recalc
overlays. The older Peaks workshop now gets finite inputs from `peakInputs` and
notifies once when its automatic analysis excludes gaps. Grouped fits and ROI
fit/integrate were inspected and already filter both coordinates before their
requests, so they needed no behavior change.

---

## BUG-023 — frozen figures and static snapshot windows lose non-finite identity

**Priority:** P2
**State:** Open — code-proven in the v0.26.1 independent audit
**Reported/investigated:** 2026-09-20 by ChatGPT-Sol
**Suggested owner/model:** Claude Sonnet for the persistence contract; ChatGPT-Sol for reopen/export acceptance

Frozen editable-figure data and static plot-window bundles are copied into the
workspace document without BUG-017's numeric-cell codec. Native JSON rewrites
NaN and both infinities to `null`, and `-0` to `0`; the load sanitizers cannot
recover the original value. The affected static-window fields include plotted
data, error bars, and colour-by values. Ordinary datasets are already protected.

- [ ] Reuse one established non-finite codec at both frozen payload boundaries.
- [ ] Preserve backward compatibility with existing finite/`null` projects.
- [ ] Add direct and full-workspace round trips for NaN, ±Infinity, and -0.
- [ ] Compare a reopened frozen figure and snapshot window with the pre-save display/export.

Full evidence, reproduction, and gate expectations are in
`POST_RELEASE_PROBLEM_AUDIT.md`.

## UX-005 — Quick Plot refusal guidance advertises an already-shipped feature

**Priority:** P1
**State:** Complete — present-tense actionable refusal guidance shipped
**Reported/investigated:** 2026-09-20 by ChatGPT-Sol
**Suggested owner/model:** Inexpensive ChatGPT/Codex frontend model

When inference refuses a dataset, the app says Configure Quick Plot “arrives
with the Quick Figure Builder (PR G)”. Both the configuration command and
builder already ship beside Quick Plot. Replace the internal roadmap sentence
with a concise present-tense instruction naming the available next action, and
update the tests that currently pin the stale copy.

- [x] Replace both refusal messages and keep map-specific advice accurate.
- [x] Remove internal PR labels from rendered copy in the touched workflow.
- [x] Update focused menu/palette/workbook tests and run the frontend gate.

**Evidence (2026-09-20):** Generic and unsupported data now direct users to
**Configure Quick Plot…** to assign columns and preview an editable figure;
2-D map data retains the scientifically specific Map view guidance. The four
focused Quick Plot/Library test files pass (81 tests), forced TypeScript,
frontend lint, clean frontend build/bundle (857.4 kB eager, within the 857.6
kB budget), and repository-integrity tests (13 passed). Implementation commit:
see the UX-005 branch history and pull request.

Full evidence and acceptance wording are in `POST_RELEASE_PROBLEM_AUDIT.md`.

## UX-006 — the installed CLI cannot report its own version

**Priority:** P3
**State:** Open — reproduced against the published v0.26.1 wheel
**Reported/investigated:** 2026-09-20 by ChatGPT-Sol
**Suggested owner/model:** Claude Haiku-class or inexpensive Codex backend model

`qz --version` exits as an unrecognized argument, forcing release support to
import Python internals to identify the installed build.

- [ ] Add `--version` from the canonical `quantized.__version__` value.
- [ ] Test both installed command aliases without launching the server/browser.
- [ ] Add the probe to the wheel smoke test and run package gates.

Full reproduction and acceptance expectations are in
`POST_RELEASE_PROBLEM_AUDIT.md`.

## UX-007 — workbook Properties is a disabled roadmap placeholder

**Priority:** P2
**State:** Open — code-proven in the v0.26.1 action registry
**Reported/investigated:** 2026-09-20 by ChatGPT-Sol
**Suggested owner/model:** ChatGPT/Codex mid-tier frontend model; Claude review for projection consistency

The workbook right-click menu always disables **Properties…**, gives it an
empty action, and explains the dead end with “arrives with Details/Properties
(PR D)”. PR D already shipped the Details renderer while unified Properties
remained deferred. Prefer a bounded read-only inspector built from the
canonical workbook projection; otherwise remove the dead menu item until that
surface exists.

- [ ] Choose the read-only-inspector or temporary-removal contract.
- [ ] Do not create a second interpretation of Origin workbook structure.
- [ ] Keep Tree/Details/Tiles behavior and focus restoration consistent.
- [ ] Replace the stale-copy assertion with behavior/accessibility coverage.

Full scope and acceptance criteria are in `POST_RELEASE_PROBLEM_AUDIT.md`.

## New issue template

Copy this section for each new report. Assign the next stable ID (`BUG-###`, `UX-###`, `PERF-###`, or `FEATURE-###`). Never renumber an existing item.

### ID — concise title

**Priority:** P0/P1/P2/P3 — reason  
**State:** Open / In progress / Blocked on owner / Verified complete  
**Reported:** YYYY-MM-DD by owner/agent  
**Investigated:** —  
**Suggested implementation owner/model:** —  
**Related plan:** —

#### User-visible problem

Describe what the user did, what happened, and why it matters. Include filenames/data types when relevant, but do not add private data to the repository.

#### Reproduction

- [ ] Starting state and sample data identified
- [ ] Exact actions recorded
- [ ] Actual result recorded
- [ ] Expected result recorded
- [ ] Reproduced by an agent or explicitly marked owner-only

#### Investigation

- [ ] Likely owning components/modules identified
- [ ] Root cause confirmed rather than inferred
- [ ] Related workflows and persistence paths checked
- [ ] Existing plan overlap reconciled

#### Implementation

- [ ] Minimal safe behavior defined
- [ ] Failure and ambiguous-data behavior defined
- [ ] Data integrity and backward compatibility considered
- [ ] UI wording/tooltips/accessibility included where relevant

#### Tests and acceptance

- [ ] Regression test fails before the fix and passes afterward
- [ ] Relevant focused tests pass
- [ ] Type-check/build/repository gates pass
- [ ] Agent verifies acceptance criteria
- [ ] Owner verifies when required

#### Completion record

- PR/commit: —
- Automated tests: —
- Agent verification: —
- Owner verification: —
- Notes: —

---

## UX-004 — the Library's node-type marks collide: one glyph meant up to five different things

**Priority:** P1 — the same surface and the same workflow as UX-001, and the
reason UX-001's own "make the node type explicit" fix did not land for the
owner.
**State:** Fixed and test-locked on the collision half (objective, measured).
The density half is a design judgement awaiting the owner's eye — see
"What is measured and what is judgement" below.
**Reported:** 2026-09-19 by owner — *"loading this origin project, it's pretty
impossible to parse that many icons"*.
**Related:** UX-001 (same surface; this is its icon-audit residual finished
properly, not a contradiction of it — see "Reconciliation with UX-001").

### User-visible problem

Importing an Origin project brings in folders, workbooks, worksheets, graphs,
pages and notes at once — hundreds of Library rows. Their type marks are not
telling them apart, because several kinds wear the *same* mark and the marks
that do differ differ only by hatch direction at 12px.

### Measured collision inventory (2026-09-19, before the fix)

Three mutually contradicting kind→glyph maps existed, none aware of the
others. Every site was read, not sampled:

| glyph | code point | everything it meant | sites |
|---|---|---|---|
| `▦` | U+25A6 | **Folder**, **Figure page**, **Worksheet**, *"open the source workbook"* (command), *"New folder"* (command) | `FolderRow.tsx:301`, `ArtifactRows.tsx:51`, `PagesSection.tsx:72`, `TilePreview.tsx:31`, `CollectionsSection.tsx:29`, `DetailsRow.tsx:266`, `FigureRow.tsx:112`, `Library.tsx:285` |
| `▤` | U+25A4 | **Workbook**, **Report** | `WorkbookRow.tsx:137`, `ArtifactRows.tsx:53`, `ReportsSection.tsx:36`, `TilePreview.tsx:30`, `CollectionsSection.tsx:29`, `DetailsRow.tsx:266` |
| `▥` | U+25A5 | **Worksheet**, and **Origin figure + Editable figure + Publication figure + Figure page + Report** (all five at once) | `DatasetRow.tsx:317`, `CollectionsSection.tsx:29-30` |
| `⌁` | U+2301 | **Origin figure**, and in Tiles *all three* figure kinds | `FigureRow.tsx:91`, `TilePreview.tsx:33-35` |
| `◇` | U+25C7 | **Editable figure** | `ArtifactRows.tsx:47`, `EditableFiguresSection.tsx:49` |
| `◉`/`❄` | U+25C9 / U+2744 | **Publication figure**, live vs frozen — the *type* mark was swapped out to carry a *status*, so a frozen publication figure had no type mark at all | `ArtifactRows.tsx:49`, `SavedFiguresSection.tsx:66` |
| `▰` `▧` `≡` | | **Folder**, **Figure page**, **Report** — but only in Tiles | `TilePreview.tsx:29,36,37` |
| `·` | | **Worksheet** (Collections) and **everything that is not a folder or a workbook** (Details) | `CollectionsSection.tsx:29`, `DetailsRow.tsx:266` |

Two corrections to the report that prompted this entry: there is **no Matrix
node kind** — `ArtifactRows.tsx:51`'s `rows×cols` row is a figure **page**, and
`LibraryNodeKind` has exactly eight members; and the drag handle `⠿` and menu
cue `⋯` were **already** resting cues (`shell.css:390,468`: `opacity: 0`,
revealed on row hover and on focus), so they were never part of the resting
noise.

Non-type glyphs a Library row can also paint, for completeness: `⠿` drag
(resting cue), `⋯` more actions (resting cue), `▸`/`▾` caret, `●` stale,
`↻` recomputed-from-fit, `⇢` derived worksheet, `∿` preview toggle,
`⊞` open in a new window, `▣` saved Origin preview, `G` remake in Graph
Builder, `▲`/`▼` move (flat card only), `└ sheet N` chip.

### What changed

- **One source of truth:** `frontend/src/components/Library/nodeIcons.ts`
  (`LIBRARY_NODE_GLYPH`, `LIBRARY_NODE_LABEL`, `FROZEN_MARK`). The three rival
  maps are deleted; every Library view (Tree, Tiles, Details, Collections and
  the five flat sections) reads this one.
- **A vocabulary separated by SILHOUETTE, not hatch:** folder `▰` (solid
  slanted bar), workbook `▤` (the one ruled box), worksheet `≡` (free rules,
  no box), origin-figure `⌁` (zigzag trace), editable-figure `◇` (outline
  diamond), publication-figure `◆` (solid diamond), page `▭` (wide empty
  rectangle), report `¶` (pilcrow). `▦` and `▥` — the two marks that meant
  several things at once — are **removed from the vocabulary entirely**.
- **Type and status are two channels:** a publication figure keeps a stable
  `◆` and, when frozen, a separate `❄` mark beside the name. Previously the
  type mark itself was replaced.
- **The two commands that NAME a kind wear that kind's mark** rather than
  inventing one: "New folder" (`Library.tsx`) and "open the source workbook"
  (`FigureRow.tsx`, which wore the *folder* mark `▦`).
- **Density (judgement, not measurement):** the preview toggle `∿` was the
  last control still painted at rest on every worksheet row. It now follows
  the drag handle's and menu button's existing resting-cue recipe —
  `opacity: 0`, revealed on row hover, on `:focus-visible`, and whenever the
  preview is open. Opacity only: it keeps its box, its tab order and its
  `aria-label`/`aria-pressed`. A worksheet row at rest now paints exactly one
  mark (its type glyph) plus text.
- **Colour is not a channel.** Every glyph inherits `currentColor` from its
  row's design tokens, so the vocabulary is identical in every theme, accent,
  density and the greyscale/print paths, and no information is carried by hue
  (the CVD concern from `PRIMARY_SOFTWARE_AUDIT_PLAN.md` P3.3 does not arise).
  `FolderRow`'s existing folder-colour tint stays, as decoration on top of an
  already-distinct shape.

### What the design system specified

`plans/design/DESIGN_GUIDE.md` §Iconography specifies the **medium**, not a
node vocabulary: inline Unicode glyphs inheriting `currentColor` and the
surrounding font-size, thin/geometric, no icon font, no SVG sprite, **never
emoji**, and a substitution rule (a thin ~1.5px-stroke line set, flagged) if
the Unicode set runs out. It names tool glyphs only — `✥` pan, `⛶` box-zoom,
`✛` cursor, `▾`/`▸` chevrons — and, notably, assigns **`▤`/`▥` to panel
toggles**, so using them as node types was already double duty. No Library
node-type vocabulary was specified, so this defines one in that idiom; the
guide's constraints are all met (single BMP codepoints, no emoji presentation,
asserted by test).

### Enforcement (the most valuable artifact here)

`frontend/src/components/Library/nodeIcons.test.ts` — 11 cases:

- **injectivity** over the complete kind set (no two kinds share a glyph; the
  label map too), and completeness (the hand-written kind list must match
  `LibraryNodeKind`, so a ninth kind cannot slip in unmarked);
- each glyph is one non-blank BMP character below U+1F300 with no U+FE0F —
  the repo's "Unicode glyphs, never emoji" rule, made checkable;
- **disjointness**: no command/status glyph reuses a type mark, *unless* the
  table declares that the command names that kind — and then it must really
  wear that kind's mark;
- **non-rot**: every command/status glyph in that table still appears in the
  file the table names, no Library component declares a kind-keyed
  `KIND_GLYPH` of its own any more, and the two retired marks `▦`/`▥` appear
  nowhere in this directory's rendered code (comments excepted — they are the
  record of what each site used to draw).

`nodeIconRenderSites.test.tsx` (new, review round 1) closes the level below
that: injectivity proves the *vocabulary* is sound and the accessibility audit
proves each mark is *labelled*, but neither proved the **wiring** — that a
given render site reaches for its OWN kind's entry. The reviewer pointed
`ReportsSection.tsx` and `SavedFiguresSection.tsx` at `LIBRARY_NODE_GLYPH
.folder` and the whole suite stayed green, i.e. a Report/Folder and a
Publication-figure/Folder collision could be reintroduced with nothing red.
The closure is **table-driven** rather than two more one-off cases, so the
next kind added cannot be missed: the table is asserted to cover every member
of `LIBRARY_NODE_KINDS`, and each entry renders its site and asserts the glyph
under that kind's title, plus that no other kind's mark leaked into the row.
It lists the eight sites that name a kind **literally** — the only ones that
can be miswired; `ArtifactRows`, `CollectionsSection`, `DetailsRow` and
`TilePreview` index the map by `node.kind` and are correct by construction,
and `Library.tsx`'s toolbar button is a command covered by `nodeIcons.test.ts`.

`rowIconAccessibility.test.tsx` gains two describe blocks: the rendered mark
of each row kind **is** the one the shared map declares (four kinds rendered
together produce four different characters — the owner's complaint, at the DOM
layer), and the preview toggle stays in the DOM, focusable, named, hidden by
`opacity` only with the hover/focus/`aria-pressed` rules parsed out of
`shell.css` rather than assumed. That file's header now records *why* the
earlier audit missed this: it asserted each mark was **labelled**, never that
two marks were **distinguishable** — the gap this entry closes.

### Reconciliation with UX-001

UX-001's interaction checklist item "make the node type explicit" stays ticked
and is **not** reverted: every kind still carries a type mark, and no mark was
deleted for the sake of deleting one. What that pass could not know is that
the marks it chose (`▥` for worksheet, keeping `▦`/`▤`) already meant other
things in five files it did not touch. UX-001's own open research box —
"a full icon/badge audit across every row kind is still open", closed
2026-09-12 as an *accessibility* audit — is what left the distinguishability
half unchecked. `LibraryTree.compactRows.test.tsx`'s "≥6 worksheet rows"
acceptance evidence is untouched and still passes.

### What is measured and what is judgement

- **Measured, objective:** every collision in the table above was read out of
  the source at the cited line, and the injectivity test would have failed on
  the pre-fix map. The fix to that half is not a matter of taste.
- **Judgement, needs the owner's eye — one case named explicitly** (review
  round 1): editable-figure `◇` and publication-figure `◆` are distinguished
  **only by fill**. That is the same class of hairline distinction this entry
  condemns in `▦`/`▥`/`▤`'s hatch direction, softened only by the argument
  that solid-vs-outline is a coarser contrast than hatch and that the two are
  genuinely one family. It is a judgement call, not a measured result: if the
  owner cannot tell them apart in the tree, `◆` should move to a different
  shape rather than a different fill.
- **Judgement, needs the owner's eye:** the *choice* of the eight marks, and
  the density change (hiding `∿` at rest). No screenshot of the owner's actual
  Origin project exists here, so the aggregate-density claim — "a worksheet
  row at rest now paints one mark plus text" — is derived from the code and
  the stylesheet, not from a rendered tree at the owner's row count, font and
  density setting. It is exactly the sort of claim `jsdom` cannot settle.

### Deliberately NOT done

- **No mark was deleted.** Dropping the worksheet glyph outright was
  considered (it is the most numerous row, has no caret, and carries unique
  `N pts · Mch` meta, so hierarchy alone nearly identifies it) and rejected:
  it would silently un-tick UX-001's "make the node type explicit" box across
  Tree, Tiles, Details and Collections. It is the obvious next density lever
  if the owner still finds the tree noisy — raise it with a screenshot.
- `⠿` and `⋯` were left alone: already resting cues, already correct.
- `Library.tsx` took the single minimal edit its in-flight state allows (the
  "New folder" button's glyph, now the shared constant + an import);
  `LibraryFlatRows.tsx` was not touched at all.
- Command glyphs outside a Library row (`Shell/TitleBar.tsx`'s `▤`/`▥` panel
  toggles, `Stage/*`, the workshops) are out of scope — they are a different
  surface and the design guide assigns `▤`/`▥` to panel toggles there.

### Acceptance criteria

- [x] No two Library node kinds render the same mark, over the complete kind
  set — `nodeIcons.test.ts`, sabotage-verified.
- [x] One source of truth; no component declares its own kind→glyph map —
  `nodeIcons.test.ts`, sabotage-verified.
- [x] Every render site draws its OWN kind's mark, over the complete kind set
  — `nodeIconRenderSites.test.tsx`, sabotage-verified at both sites the
  review round found unguarded.
- [x] The same entity looks the same in Tree, Tiles, Details and Collections
  — all four now read `LIBRARY_NODE_GLYPH`.
- [x] Accessibility does not regress: every icon-only control keeps an
  accessible name, every badge a title, and the newly hidden resting cue
  stays focusable and announced — `rowIconAccessibility.test.tsx`.
- [x] Marks work in every theme/accent/density and in greyscale — they carry
  no colour information; enforced by construction (`currentColor`), stated
  here rather than test-claimed.
- [ ] Owner confirms, on the reported Origin project, that the eight marks
  read apart at a glance and that the tree is quieter.

### Completion record

- PR/commit: committed on the worktree branch (not pushed, per task
  instructions).
- Automated tests: `nodeIcons.test.ts` (new, 11 cases),
  `nodeIconRenderSites.test.tsx` (new, 9 cases — review round 1),
  `rowIconAccessibility.test.tsx` (+7 cases), `PagesSection.test.tsx`
  (expectation updated to the shared constant).
- Owner verification: pending — the density and mark-choice halves above.

---

## Change log

| Date | Author | Change | Evidence/status |
|---|---|---|---|
| 2026-09-08 | ChatGPT-Sol | Created living tracker; added BUG-001 and UX-001 from owner screenshots and code inspection | Both open |
| 2026-09-09 | Claude | BUG-001: parser-declared roles in `io/ncnr.py` + the missing `metadata.error_roles` reader; corrected one investigation line that measurement disproved | BUG-001 partially implemented, still open pending render/round-trip and owner checks |
| 2026-09-09 | Claude | Added BUG-003 (Data Filter: a stale kind-mismatched predicate survives a column type change invisibly) from the Data Filter categorical-wiring slice | Display-masking half implemented + sabotage-verified; row-filtering half open pending owner call |
| 2026-09-09 | Claude | Verified Tabulate/Stat Stage `is_categorical` wiring (PRIMARY_SOFTWARE_AUDIT_PLAN); added BUG-004 (Stat Stage: a stale groupCol/facetCol survives a column type change) and fixed it fully (display + computation, self-contained hook) | BUG-004 fixed + sabotage-verified; Tabulate confirmed self-healing (no analogous bug), also sabotage-verified |
| 2026-09-13 | Claude | Recorded the Group AF outcome on BUG-009's load-path item (`.dwk` load refusing `excludedRows`/`filter` on a pending dataset): built, adversarially reviewed, reverted before reaching `main`; wrote the net-regression finding and the unbuilt plan of record into the item honestly. Added BUG-010 (`migrationWarnings` unreachable on recovery/append/workbook-import loaders) and BUG-011 (Pack Project serializes a pending dataset's preview rows, unlike Save/Save As and workbook transfer) from the same review | Both new entries are design-time findings, code-read and cited by file:line, not yet fixed; BUG-009's item stays `[ ]` open, code unchanged from pre-attempt |
| 2026-09-13 | Claude | BUG-011 fixed: both Pack Project serialization entry points (the preview and "Start pack") now `await resolvePendingDatasets()` before `serializeWorkspace` and abort with a named `pending_unresolved` error + status + danger toast when a book can't be fetched, mirroring `workspaceIO.ts`'s Save path. The workspace-content slice moved to the new `store/packProjectContent.ts` so the 500-line `.ts` ceiling was met by extraction, not a pin raise; `lib/workspaceSerialize.ts`'s `pending` comment corrected to name all three explicit export paths | All four Fix-checklist boxes ticked with file:line evidence; 5 new specs, each sabotage-verified (4 sabotage rounds, source restored byte-identical); full frontend suite 634 files / 10,381 tests green; eager bundle unchanged at 916,182 B (budget 920,400). Owner call on abort-vs-partial-pack left open in the entry |
| 2026-09-13 | Claude | Added and fixed BUG-010 (`migrationWarnings` reached the user on a plain File ▸ Open only — autosave recovery, silent autosave restore, Append workspace, and workbook Paste all folded or dropped the notice): one shared `notifyMigrationWarnings` toast helper (`store/toasts.ts`) called from all four sites; `duplicateWorkbook` deliberately excluded (structural non-goal, pinned by test) | BUG-010 fixed + sabotage-verified (one regression test per site); `uv run pytest -q tests/test_repo_integrity.py` passed |
| 2026-09-13 | Claude | Adversarial review round on the BUG-011 fix (commit `1b7ec2cf`): closed both CONFIRMED code findings — "Start pack"'s own book-resolve await had no generation guard (a cancel/reset during it was silently overwritten, and a second click ran a second concurrent attempt), and a book that turned pending DURING the resolve await was still serialized from its preview rows. Also named the failing book in the refusal (finding #5), corrected two stale cross-references and an understated sabotage count, added a status on the resolve step's success path, and renamed a shadowing `type Set` alias. Recorded `workspaceIO.ts`'s narrower window as a residual rather than fixing it (those files are being edited concurrently for BUG-010) — but WRONGLY recorded the same residual against `workbookTransfer.ts` too, which the round 2 review below found already closed | 4 new specs + 2 existing specs strengthened (65 passing, was 61), every new/strengthened assertion sabotage-verified byte-identical after restore; `tsc -b --force`/`eslint --max-warnings=0`/scoped vitest/`npm run build` all clean; `uv run pytest -q tests/test_repo_integrity.py` 12 passed; eager bundle reported as +15 B against an orphaned parent SHA — round 2 re-measured against the real parent (`762e00c1`) and found +4 B |
| 2026-09-13 | Claude | Adversarial review round on the BUG-010 fix (commit `762e00c1`): closed the one real coverage gap — File ▸ Open / Open without layout (`lib/openWorkspaceReplace.ts`'s `replaceWorkspace`/`replaceWorkspaceSafely`) never called `notifyMigrationWarnings`, so it was the one load path with a status-line fold but no toast, contradicting the entry's own "shows both" claim. Also: gave the helper a longer, non-clobberable TTL (`TOAST_ACTION_TTL`) since it is the ONLY surface on two sites; added direct unit tests for the helper's "one toast, never one per warning"/"(+N more)" rules; replaced `duplicateWorkbook`'s un-failable "pinned by its own test" assertion with a structural one against a live-state round trip; corrected three stale design sentences, four off-by-one file:line citations, and one non-existent symbol name (`parseWorkbookPackage` -> `parseTransferPackage`) in the plan entry; removed a stray doubled blank line before `## New issue template` | 3 new specs (`lib/openWorkspaceReplace.test.ts` x3) + 4 new specs (`store/toasts.test.ts` x4) + 1 test strengthened (`store/workbookTransfer.test.ts`), every one sabotage-verified, source restored byte-identical; `tsc -b --force`/`eslint --max-warnings=0`/full vitest (636 files, 10422 passed + 2 expected-fail, 0 FAIL)/`npm run build` all clean; `uv run pytest -q tests/test_repo_integrity.py` 12 passed; eager bundle +69 B (916,384 B at the `a99ebb6d` parent -> 916,453 B here), 3,947 B under the unmoved 920,400 B budget |
| 2026-09-13 | Claude | Second adversarial review round on the BUG-011 fix: closed a regression the FIRST review round introduced (`startInFlight` had no escape hatch — a `fetchBookData` that never settles pinned Start pack rejected forever, recoverable neither by Cancel nor Reset), finished finding #5 (the refusal's reason now comes from the SAME `lastBookError` lookup as the name it's paired with, not the raw thrown error, so a stale reason can no longer be quoted against the wrong book), and closed nit N1 for real (a real terminal status on both the preview-ready and pack-completed paths, not another in-flight claim). Corrected the FALSE "still open on `workbookTransfer.ts` too" residual (already closed there via `buildTransferPackage`'s own re-check) in three places, and recounted every stale file:line citation this entry carried, several created by the first review round's own edits | 5 new specs (packProject.test.ts 70 passing, was 65), every new assertion sabotage-verified byte-identical after restore (see the commit body's table); `tsc -b --force`/`eslint --max-warnings=0` clean; full `npx vitest run` 636 files / 10,433 passed + 2 expected fail, 0 `FAIL`; `npm run build` clean, eager bundle 916,384 B (real parent `a99ebb6d`) -> 916,408 B here, +24 B, 3,992 B under budget; `uv run pytest -q tests/test_repo_integrity.py` 12 passed |
| 2026-09-13 | Claude | Third adversarial review round on the BUG-011 fix: closed a NEW hole round 2's own fix introduced (`startInFlight` was cleared by an unconditional `finally`, so a late-settling abandoned attempt could clear a flag a NEWER attempt owned — closed with an attempt-scoped `startEpoch` token), and widened round 2's `notePackOutcome` terminal-status fix from two named paths (`awaiting_confirmation`, `completed`) to EVERY `failed`/`cancelled` transition in `packProjectRun.ts` via two choke-point helpers, so the entry's own "closed" claim is now actually true rather than narrowed. Corrected a FIFTH recurrence of the wrong-parent-SHA mistake (genuine rebase drift this time — round 2 measured against an ancestor four commits back, not its real `HEAD~1`) and an off-by-one spec-range citation (`:734-902` -> `:734-903`); fixed a stale cross-reference nit, a `truncateReason` docstring missing its third consumer, and pinned the "N dataset(s)" count in two existing specs that previously passed against a manifest whose count was always 0 | 4 new specs (1 attempt-scoping probe for finding #1, 3 terminal-status specs for finding #2 — poll-driven `failed`, poll-driven `cancelled`, and `cancelled`'s own pre-packing branch), every new assertion sabotage-verified byte-identical after restore; `tsc -b --force`/`eslint --max-warnings=0` clean; scoped vitest (`src/store` + `workspaceSerialize.test.ts` + `architecture.test.ts`) 1754 passed, 0 `FAIL` (full suite not re-run this round — machine contended; last verified full-suite count is the reviewer's own 636 files / 10,444 passed + 2 expected fail at `1aa8d4bd`); `npm run build` clean after `rm -rf node_modules/.vite`, eager bundle 916,466 B at the real parent `26869ddb` -> 916,466 B here, +0 B (neither touched file is eager: `store/packProject.ts` is reached only through the lazy `PackProjectPanel` chunk, and the `packProjectRun.ts`/`packProjectContent.ts` chunk was already lazy); `uv run pytest -q tests/test_repo_integrity.py` 12 passed |
| 2026-09-13 | Claude | Closed BUG-011's last recorded residual: `store/workspaceIO.ts`'s `prepareWorkspaceState` (the shared preface for Save and Save As) now re-checks `pending` on the store it re-reads after `resolvePendingDatasets()`, mirroring `packProjectContent.ts`'s own finding #2 fix, and refuses the save by name rather than serializing a book that turns pending during that await. `lib/workspaceSerialize.ts`'s `pending` comment updated to say the guarantee now holds on every explicit export path (Save, Save As, workbook transfer, Pack Project) | 1 new spec (`workspaceIO.test.ts`), sabotage-verified (removing the re-check fails exactly this spec, 41 others in the file untouched), source restored byte-identical; `tsc -b --force`/`eslint --max-warnings=0` clean; scoped vitest (`workspaceIO.test.ts` + `src/store` + `architecture.test.ts`; the row first cited a `workspaceSerialize.test.ts` that does not exist) 1755 passed, 0 `FAIL`; `npm run build` clean after `rm -rf node_modules/.vite`, eager bundle 916,466 B at the real parent `dafaa333` (the agent cited `2920e34a`, an ancestor with the identical tree) -> 916,645 B here, +179 B, 3,755 B under the unmoved 920,400 B budget; `uv run pytest -q tests/test_repo_integrity.py` 12 passed |
| 2026-09-14 | Claude (agent) | Filed BUG-012..BUG-015, one per divergence documented as an `it.fails` by the P4.2 canonical regression matrix (commit `1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`): D1 a saved x-axis break reaches export/reopen but never renders on screen after reopen (P2); D2 a waterfall view's offset never reaches the export wire (P2); D3 a legend rename loses its unit on screen but keeps it on export (P3); D4 hiding a series shifts later series' export palette colour but not the canvas' (P2). Each entry cites the underlying code by file:line (re-verified against the code, not copied from the test's own comments) and names its reproducing `it.fails` test; none is fixed here — plans-only, tests-only slice, no source touched | Design-time findings, code-read and file:line-cited; reproducing tests are the pre-existing `it.fails` block in `regressionMatrix.test.ts` (not new); `uv run pytest -q tests/test_repo_integrity.py` run to confirm the plan edit alone does not break repository-integrity checks |
| 2026-09-14 | Claude (agent) | Filed BUG-016 (P2): a grouped figure's per-series styling reaches the canvas — `plotGroupSplit.ts`'s channel map gives every level its source channel's style and `buildOpts` applies it — but `routes/export_figures.py`'s `group_col` branch (`:81-85` documents the choice, `:236-238` returns `_ResolvedFigure(..., None, ...)`) drops `series_styles` outright, so the exported curves are solid, default-width and default-coloured. Found by the 2026-09-14 adversarial review round of the P4.2 regression matrix, which showed the matrix's own GROUP style comparison was reading a wire field the renderer never consults. Same round: renamed BUG-012..BUG-015's reproducing tests (the five bare `it.fails` pins became explicit `DIVERGENCE (BUG-01x)` tests asserting BOTH concrete values and their difference) and updated each entry's fix checklist to say the fix INVERTS the assertion rather than flipping an `it.fails`. Not fixed here — tests/fixtures/plans only, no product code touched | Design-time finding, code-read and file:line-cited, and measured on both paths (canvas: three levels at `dash: [8, 4]`, `width: 2`; resolver: `styles=None` under `group_col`). Reproducing test: `regressionMatrix.test.ts`'s `DIVERGENCE (BUG-016)` (new this round). `uv run pytest -q tests/test_repo_integrity.py`; `npx tsc -b --force`; `npx eslint src --max-warnings=0`; `npx vitest run src/lib/regressionMatrix.test.ts src/lib/figureSpec.a8.test.ts src/architecture.test.ts` |
| 2026-09-19 | Claude (agent) | Filed UX-004 (P1) from an owner report on the same surface as UX-001, and fixed its objective half. Measured, by reading every site: three mutually contradicting kind→glyph maps, in which `▦` meant Folder AND Figure page AND Worksheet AND two different commands, `▤` meant Workbook AND Report, `▥` meant Worksheet AND all five artifact kinds at once, and a frozen publication figure had NO type mark because `❄` replaced it. Corrected two details of the report while confirming it: there is no Matrix node kind (the `rows×cols` row is a figure page; `LibraryNodeKind` has eight members), and `⠿`/`⋯` were already resting cues. Fixed with one source of truth, `frontend/src/components/Library/nodeIcons.ts`, a vocabulary separated by SILHOUETTE rather than hatch (`▰ ▤ ≡ ⌁ ◇ ◆ ▭ ¶`), `▦`/`▥` retired from the vocabulary outright, type and status split into two channels, and the two kind-naming commands wearing their kind's mark. Density: the preview toggle `∿` joins the drag handle and menu button as an opacity-only resting cue (still focusable, still announced). Recorded in the entry which half is measured and which is design judgement the owner must eyeball, since no screenshot of the reported project exists here | `nodeIcons.test.ts` (new, 11 cases — injectivity over the complete kind set, completeness, no-emoji, command/status disjointness, and three non-rot checks) + 7 new cases in `rowIconAccessibility.test.tsx`, whose header now records that the earlier UX-001 audit checked marks were LABELLED, never DISTINGUISHABLE — the gap that let this ship. Every new assertion sabotage-verified (see the commit body's table); `npx tsc -b --force`, `npx eslint src --max-warnings=0`, full `npx vitest run`, `npm run build` + bundle ratchet, and `uv run pytest -q tests/test_repo_integrity.py` all clean — numbers in the commit body |
| 2026-09-15 | Claude (agent) | Filed UX-003 (P3) from the adversarial review of `b749f804` (the four-lazy-seam bundle diet): that commit claimed "chunk-load failures are reported, never silent" and "a failed load is never cached, so the next gesture retries" without qualification, but neither holds for a `lazy()`-shaped seam — measured 2026-09-15, `frontend/src` has **0** files matching `componentDidCatch\|getDerivedStateFromError\|ErrorBoundary` against **17** `= lazy(` sites in nine modules, so a failed chunk unmounts the React root with no toast, no status and no console error. Narrowed the claim in `PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.1 and `BUNDLE_HEADROOM.md` slice 2 rather than adding a boundary, which is its own design decision. Same round: `lib/clipboard.ts` gained `copyTextAsync` so workbook Copy starts its clipboard write inside the click's own task (the chunk `await` was spending the user activation), and every `runLazy(...).then(f).catch(...)` became the two-argument `.then(f, onLoadFailure)` so a loaded handler's throw is no longer swallowed with the load's | Design-time finding for UX-003, code-read and measured by grep; the two code fixes ship with it and are sabotage-verified. `uv run pytest -q tests/test_repo_integrity.py`; `npx tsc -b --force`; `npx eslint src --max-warnings=0`; scoped vitest; `node scripts/check-bundle-size.mjs` |
| 2026-09-15 | Claude (agent) | Filed BUG-017 (P1): a dataset with a NaN or ±Infinity cell cannot be reopened after Save — `workspaceSerialize.ts:198`'s `data: d.data` has no NaN/±Infinity replacer, `JSON.stringify` turns them into `null`, and `workspaceDatasetParse.ts:38-40`'s `isNumberArray` rejects `null`, so `parseWorkspaceDataset` throws and takes the WHOLE workspace load down with it (not just the one dataset); `cellEdit.ts:129-131`'s `insertRows` mints `Number.NaN` for every blank inserted row, so it is reachable by a plain, common edit. `-0` separately round-trips silently to `0` (fail-safe only where a peak-table fingerprint is watching it). Found closing the round-3 review of the P2.1 peak-table digest (`xrd_review3.md` NIT 4) as a pre-existing bug outside that commit's diff; not fixed here — plans-only. Verified by a probe against the real `serializeWorkspace`/`parseWorkspace` before filing (run in a scratch, uncommitted `*.test.ts`, then removed) | Probe result: NaN case throws exactly `dataset 0 ("scan.dat") has an invalid data structure`; `-0` case reads back as `0` (`Object.is` false). `uv run pytest -q tests/test_repo_integrity.py` run to confirm the plan/bugs-doc edit alone does not break repository-integrity checks; no product code touched, no regression test committed yet (see the entry's Tests and acceptance) |
| 2026-09-16 | Claude (agent) | **BUG-017 fixed** (P1, data loss): a dataset holding a `NaN`, `±Infinity` or `-0` cell now survives every JSON boundary the app puts it through. New `frontend/src/lib/nonFiniteCells.ts` owns ONE encoder/decoder pair — a value `JSON.stringify` cannot represent is written as the string `String(value)` gives for it (`"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"`) and read straight back — applied symmetrically by `lib/workspaceSerialize.ts` (`data` and `raw`) and `lib/workspaceDatasetParse.ts` (`isWireCellArray` + `decodeDataStruct` before `sanitizeDataStruct`). Its own module so neither of those files (282/264 lines) is bulked toward the 500-line ceiling. The same hole existed separately in `lib/workbookTransfer.ts`'s `buildTransferPackage` (its own `JSON.stringify(pkg)`, re-parsed through `parseWorkspace`, so workbook Copy/Paste and Duplicate refused the whole workbook) and is fixed with the same helper; `lib/autosave.ts` and `store/packProjectContent.ts` share `serializeWorkspace` and are covered by the one change. NO schema bump and NO output change for ordinary data: the encoders return their INPUT object when nothing needs a sentinel, so the graph `JSON.stringify` walks is literally the pre-fix one. Two rulings recorded in the code and the entry: a pre-fix `null` cell stays a REJECTION (it meant NaN, +Infinity OR -Infinity — reading it as NaN would fabricate a value the file does not contain), and a malformed entry still refuses the WHOLE workspace rather than skipping one dataset with a warning (a skipped dataset is invisible and the next Save would delete it permanently; refusing leaves the file intact — and the throw is now unreachable for any file the app itself wrote). One residual recorded, not fixed: `lib/figureDocument.ts:442`'s frozen figure snapshot never throws but is lossy for `±Infinity` (both become `NaN`) and `-0` | 17 new specs (`frontend/src/lib/nonFiniteCells.test.ts`), the NaN minted through the app's own `insertRows`; every one sabotage-verified across 7 sabotages (encoder NaN/±Inf branches → 9 fail; encoder `-0` branch → 5; decoder → 8; cell check reverted to number-only → 10; byte-identity by-reference return → 1; `workbookTransfer` call site → 1; cell check widened to accept `null` → 2), source restored byte-identical. `npx tsc -b --force` exit 0; `npx eslint src --max-warnings=0` exit 0; `npx vitest run src/lib src/store src/architecture.test.ts` 358 files / 7,076 tests, 7,075 passed — the single failure, `freezeRegressionMatrixCheck.test.ts`, is an unrelated 30 s timeout under full-scope parallelism (it spawns a NESTED vitest run) and passes in 19.6 s alone on the same tree. `npm run build` after `rm -rf node_modules/.vite`: eager bundle 910,971 B at the real parent `56bb3599` → 911,835 B here, **+864 B**, 8,565 B under the unmoved 920,400 B budget. `uv run pytest -q tests/test_repo_integrity.py` 12 passed |
| 2026-09-19 | Claude (agent) | Filed BUG-018 (P2): all ten backdrop dialogs in `components/overlays/` claim Escape with `window.addEventListener("keydown", …, true)` + `stopPropagation()`, which does not stop a same-node same-phase sibling, so two stacked dialogs both act on ONE keystroke — measured 2 → 0 open `[role="dialog"]` for Preferences+Shortcuts, Preferences+Help and Preferences over a pending `ConfirmDialog`, the last also resolving the confirmation `false` on the keystroke that dismissed Preferences. Pre-existing (the Escape effects are byte-identical to before `cee0494f`); what was new was R1 being CLOSED and the audit row flipped to "window capture, kept" on the claim that a backdrop dialog can never be out-ranked — true over a non-dialog surface, false dialog-over-dialog. The preferred fix was BUILT and MEASURED (all ten onto `useEscapeSurface("window", …)`; it does fix the ladder, confirm stays pending on the first Escape) and then REVERTED: `escapeStack`'s `isEditingTarget` early return made Help, Separate, Combine and Split Escape-DEAD from their own documented landing spots (an `<input>`/`<select>` each), 9 failed / 264 passed. Narrowed R1 instead, corrected the audit row, recorded NITs 4 and 5 as residuals R12/R13, and fixed review NIT 3 (Preferences landed on the first Theme segment, which under `theme: "light"` is an `aria-selected="false"` "Dark" button; it now lands on the SELECTED one, pinned in both themes) | 3 new specs (`components/overlays/stackedDialogEscape.test.tsx`) + 1 new 2-case `it.each` (`PreferencesDialog.test.tsx`), all sabotage-verified across 5 sabotages, source restored byte-identical; round 7's per-dialog focus-hook sabotage property re-verified after the landing-spot change (Preferences alone → RED 2/10). Also corrected the FIFTH-recurrence wrong-parent bundle record on `cee0494f`: its parent is `4179b166`, not `b10bcad3` (three commits back, with two P4.1 commits that moved 218 eager lines between them) — re-measured in a throwaway worktree, `4179b166` **889,496 B** → `cee0494f` **889,498 B**, +2 B; the delta was right, both absolute numbers were wrong by 21 B |
| 2026-09-19 | Claude (agent) | **BUG-019 fixed** (P1, silent state corruption) and **BUG-020 filed + fixed** (P2, silent data loss). BUG-019: `lib/techniqueViewMemory.ts`'s `captureTechniqueView` spread its capture source whole (`{ ...liveView, labels }`), and `LiveViewSource` is satisfied STRUCTURALLY — so the three callers that hand it the entire `AppState` (`store/windows.ts:151`'s `focusedRebindPatch`, `useWorkspaceAutosave.ts:283`'s debounced autosave, `store/workspaceIO.ts:102`'s Save/Save As) stored `datasets`, `plotWindows` AND the PREVIOUS `techniqueViewMemory` in every entry. Only the slot being written is replaced, so a single technique recurses linearly but ALTERNATING two — switch to the map, switch back — makes each slot absorb the other one generation late: `size(k) ~ size(k-1) + size(k-2) + C`, Fibonacci-like, ratio -> phi ~ 1.62 (an earlier revision of this row said `2 x size(k-1) + C`; measured on `281ee552`: 80,340 -> 241,003 -> 482,002 -> 883,664 -> 1,526,325 -> 2,570,648 -> 4,257,632 -> 6,988,939, ratios 3.0, 2.0, 1.83, 1.73, 1.68, 1.66, 1.64). Autosave `JSON.stringify`s that map on the thread that draws, 800 ms after every dataset switch and every dataset add, which is why the owner's ROI box integration produced an empty new plot AND blanked previously plotted datasets — the data was never wrong, the main thread simply stopped. Fixed by projecting the capture source down to its nine declared fields inside `captureTechniqueView`, so it holds for all four callers and any future one; no schema change and no behaviour change to the memory itself. Two review corrections carried in the same commit: the earlier claim that "nothing is reported" was FALSE — `lib/autosave.ts:88` + `StatusBar.tsx:139-145` do render a persistent `role="alert"` autosave-failing indicator — so the claim is narrowed to the stall itself, and the one genuinely wrong surface (a status line hardcoded to "storage full or unavailable" for what was a `serializeWorkspace` failure) now names the real reason. BUG-020: `Stage/useCutLanding.ts` minted `cut-N` ids from a private page-lifetime counter instead of `store/idSeq.ts`'s collision-free sequence — filed with its own reproduction rather than left as a footnote, since it reproduces the owner's "Apply made a new plot that was empty/wrong" symptom class independently of the stall | Measured before/after against the RUNNING app (Playwright + real backend) on the owner's exact sequence: `JSON.stringify(techniqueViewMemory).length` 5,440,727 -> 16,322,222 -> 32,387,084 -> 69,957,577 -> 123,592,932 -> 214,798,775 -> 359,639,968 -> `RangeError: Invalid string length` -> page unresponsive >45 s; after the fix a flat 344 B across all 26 switches with identical canvas ink (537,953 / 51,795) every time. A second run on two ordinary imported XRDML files hit 73.9 MB in ten switches and stopped answering any page evaluation from switch nine for the remaining 600 s. BUG-020 probed on both trees: `['cut-1','cut-1']`, `activeId` resolving to the OLD rows, and `removeDatasets` emptying the library, versus unique ids and an independent delete after. 10 new tests across four files, all sabotage-verified — the whole-object spread and the recursion-only variant each redden 4 (2 in `lib/techniqueViewMemory.test.ts`, 2 in `store/techniqueMemoryGrowth.test.ts`); restoring the private cut counter reddens all 3 in `Stage/useCutLanding.test.ts`; hardcoding the autosave wording reddens both new `useWorkspaceAutosave.test.ts` cases; and a per-field sweep of `projectLiveView` (scope: the two memory files + `store/windows.test.ts`) now reddens on EVERY one of the nine — xKey 4, yKeys 8, yScale 5, xScale 2, seriesStyles 9, seriesLabels 8, seriesOrder 2, errKeys 8, hiddenChannels 8 (the previous row claimed 1 for a dropped field, which was the weaker `hiddenChannels: []` variant, and `xScale` had NO coverage at all before this round). `npx tsc -b --force` 0; `npx eslint src --max-warnings=0` 0; SCOPED `npx vitest run` over the six affected/adjacent files (`lib/techniqueViewMemory.test.ts`, `store/techniqueMemoryGrowth.test.ts`, `Stage/useCutLanding.test.ts`, `useWorkspaceAutosave.test.ts`, `store/windows.test.ts`, `architecture.test.ts`) 6 files / 138 passed, 0 `FAIL` — the FULL suite is NOT verified on this tree: two attempts were killed by host contention (a second agent's gate running concurrently), not by a test failure, so CI is the remaining gate; `uv run ruff check src tests tools` 0; `uv run mypy src` 0 (297 files); `uv run pytest -q tests/test_repo_integrity.py` 13 passed (12 + the new heading guard). Eager bundle 875,755 B at the parent `281ee552` -> 876,018 B here, +263 B, 451 B under the unmoved 876,469 B budget |
| 2026-09-20 | Claude (agent) | **BUG-021 fixed** (P0, owner-reported from a real VSM hysteresis loop; filed as BUG-019 on the branch and renumbered on rebase, `main` having taken that number). Four reported defects, each reproduced by measurement first: (1) `lib/api/http.ts`'s `ensureOk` — the app's SINGLE error-extraction path — cast the error body to `{ detail?: string }`, so FastAPI's array-shaped 422 `detail` rendered as `[object Object],[object Object],[object Object],[object Object]`; new `lib/api/errorDetail.ts` formats any shape, `await import()`ed only on the non-string path so its bytes stay out of the eager bundle. (2) The 422 itself: `JSON.stringify(NaN)` is `null` and every series field is pydantic `list[float]`, one error per gap — new `lib/api/finitePairs.ts` DROPS gap rows before a fit and scatters the result back to their original indices, throwing rather than returning a shifted column. (3) The scientific bug: the Background tab always called the M(T) one-sided high-T fit, which `subtract_mag_background`'s own docstring forbids on a loop — new `lib/magDataKind.ts` decides from the DECLARED x label/unit and `useMagTools.ts` dispatches, failing closed to a user choice when unknown. (4) The labelling: description, control label, per-path default (0.1 vs 0.7, separate state) and reported quantity (offset, NOT intercept) follow the path actually selected. Adversarial review then found six more, all closed here: the first cut read `x_column_name` ALONE while six other resolvers read `x_column_long || x_column_name`, so an Origin short column name ("B", "H", "T") reintroduced the silent misdispatch mirror-imaged; the NaN filter covered 1 of 5 call sites, leaving the Hysteresis workshop's AUTOMATIC analysis still 422ing on the owner's same loop; a documented no-op (`slope=offset=0`) was reported as a successful subtraction; the readout survived a dataset change and sat under the other path's label; the Units tab paired the coordinates and so destroyed a good field value over a moment gap (fixed with a substitute-not-drop pair for elementwise transforms, plus the minimum-data guard it lacked); and a line count and a missing bundle number were corrected. The readout's ownership is DERIVED, not cleared by an effect — an effect keyed on the active id fires on the app's own `addDataset` and wiped the readout in the same turn that produced it (measured: 8 tests red). The co-occurring "autosave failing" banner was investigated and NOT filed separately: it is BUG-019's `JSON.stringify` failure, not a NaN failure. A THIRD round then closed five more: `_label_for` falls back to the bare Origin SHORT designation when there is no Long Name, so `x_column_long` can ITSELF be "B"/"H"/"T" and the bare letter still reached the detector (closed at the root — a LONE symbol no longer classifies on its own and fails closed, while a recognisable unit still decides alone); a derived dataset recorded no x identity, so the panel could flip to "Cannot tell M(T) from M(H)" the instant its own output became active; a minor loop was claimed to be "re-centred" when that branch deliberately does not centre; the Hysteresis workshop dropped gap rows with no user notice; and `convert()`'s guard refused only when BOTH axes were all-gap. Two pre-existing defects were FILED, not fixed: **BUG-022** (`selectedFitData` does not filter, and all six consumers post to `list[float]` routes — the owner's same loop still 422s in Curve Fit) and a note on **BUG-020** that four more call sites mint ids from a page-lifetime counter, which this fix's readout ownership now keys on | Measured before the fix: a node-`JSON.stringify` body → 4 `null`s → HTTP 422 with a 4-entry `detail` list (`loc` `["body","moment",7/8/22/31]`); and on a synthetic saturated loop the M(T) tool removed intercept 1.0500e-03 (true offset 5.0000e-05), leaving plateaus at 0 / −2.000e-03 and squareness 1.0000 against the M(H) tool's ±1.000e-03. Autosave ruled out by `lib/nonFiniteCells.test.ts`'s two autosave cases passing on this tree. Re-gated on the CURRENT base `2e9ed223` (vite 8.3.0 + vitest 5.0.1) after `npm ci`, not carried over from the earlier base: `npx tsc -b --force` exit 0; `npx eslint src --max-warnings=0` exit 0; full `npx vitest run` 693 files / 11,740 passed + 2 expected fail, 0 `FAIL`; `npm run build` clean, eager bundle 877,081 B at the parent -> 877,336 B here, **+255 B**, 846 B under the unmoved 878,182 B budget, with `errorDetail` still emitted as its own chunk and zero `modulepreload` references to it in `index.html` (main's own bytes re-measured on this base in a throwaway worktree, removed after); `uv run ruff check src tests tools` 0; `uv run mypy src` 0 (297 files); `uv run pytest -q -n auto tests -k magnetometry` 22 passed / 2 skipped; `uv run pytest -q tests/test_repo_integrity.py tests/test_openapi_snapshot.py` 14 passed (no schema drift). 19 sabotages over three rounds, every source file restored byte-identical. |
