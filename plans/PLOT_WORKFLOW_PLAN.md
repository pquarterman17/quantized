# Plot Workflow Plan — import→plot: auto when repetitive, custom when not

Restore the technique-aware "auto plot" the MATLAB Boson GUI had — without
giving up the Origin-class custom path — by making the existing silent
auto-plot technique-smart, fixing the repetitive/batch case, and leaving
recipes (PRIMARY P1.3) as the opt-in layer for custom-but-recurring plots.
Owner-set design, 2026-07-31.

**Status:** Active
**Parent:** `plans/MAIN_PLAN.md`
**Created:** 2026-07-31
**Updated:** 2026-07-31

---

## Context

### How the pieces fit together

Import already auto-plots: `addDataset` (`store/useApp.ts:1078`) activates
the new dataset, retargets the focused unpinned window, switches the Stage
to plot/map (`lib/stagetab.ts`), and resets the view via
`datasetViewDefaults` (`store/windows.ts:110`). The defaults are
technique-blind: x = the parser's designated sweep column, y = the
density-filtered channel set (`defaultDenseChannels`, `lib/plotdata.ts:161`),
always linear. The parser's identity — which the MATLAB side used to drive
per-technique defaults (log-y for SIMS/RSM, XRD peak mode, panel labels via
`applyParserAnalysisConfig`) — is discarded at the io/ boundary: only
`qd.py`/`ncnr.py` stamp `instrument_type`, only `ncnr.py` writes
`default_value_channels`, and the frontend reads none of it for plot
decisions. Batch imports leave N datasets with only the last plotted, and
every dataset switch wipes styles/channels by design. The overlay-dataset
mechanism exists (`buildOverlayDataset`, `useApp.ts:1289`) but is reachable
only from Origin figure apply.

### Data / control flow (target)

```
parser (io/) ──> DataStruct.metadata.technique  (closed vocabulary + parser name)
                      │
        import ──> addDataset ──> datasetViewDefaults(ds)
                      │                 │
                      │        technique defaults table (item 2)
                      │        else per-technique view memory (item 5)
                      │        else density heuristic (today's fallback)
                      │
        batch import (≥2 same-technique) ──> overlay offer toast (item 4)
        Library multi-select ──> "Plot selected together" (item 3)
        P1.3 recipes (later) ──> keyed on the same technique tag, opt-in
```

### Resolved decisions (owner, 2026-07-31, via structured Q&A)

- **Trigger: silent defaults.** The technique table feeds
  `datasetViewDefaults` directly — importing an XRD file just IS a
  log-intensity-vs-2θ plot, no prompt, fully editable. (Boson's model.)
- **Batch: offer overlay.** Same-technique batch import raises a toast
  offering one overlay plot; declining keeps today's behavior. "Plot
  selected together" ships regardless.
- **Sequencing: Layer 1 now, pre-P1.3.** Explicit owner scope call: this
  plan does NOT wait for Gate A. P1.3's recipes later build on the same
  technique tag; P1.4 (categorical channels) is NOT a dependency of any
  item here.
- **View reset: per-technique memory.** Last-used view remembered per
  technique tag; switching among same-technique datasets keeps the view,
  switching technique gets that technique's memory (or defaults). Reset
  stays only for shape mismatch.
- Confidence framing (from the MATLAB TemplateEngine precedent):
  parser-identified technique = high confidence = silent; recipe match
  (P1.3, later) = suggest subtly; never auto-apply cross-technique.

### Dependency map

- Item 1 (technique tag) is the foundation — items 2, 4, 5 read it.
- Item 3 (plot selected together) is independent — can ship first.
- Items 4 and 5 are independent of each other.
- Item 6 is the P1.3 interface note — no standalone work.

## Tier 1 — High Impact

1. **[ ] Technique tag contract** — every parser stamps
   `metadata.technique` from a closed vocabulary (`magnetometry.mvsh`,
   `magnetometry.mvst`, `xrd.powder`, `xrd.rsm`, `reflectometry`, `sims`,
   `transport`, `spectroscopy`, `generic`, …) plus the parser name.
   - [ ] Vocabulary defined in ONE module (io side), documented in the
         DataStruct contract; frontend mirrors the type
   - [ ] Sweep all parsers in `io/`; content-ambiguous ones (generic CSV)
         stamp `generic` — never guess
   - [ ] QD parsers pick mvsh/mvst from the sweep column they already
         detect (`_X_SWEEP_FALLBACKS`, `io/qd.py:99`)

2. **[ ] Standard-plot defaults table** — technique → default view (y
   channels, log/linear axes, error bars on/off), applied silently inside
   `datasetViewDefaults`; density heuristic stays as the `generic`
   fallback. The auto-plot BECOMES the standard plot; everything remains
   editable after.
   - [ ] Table is data, not switch statements (the Boson
         `applyParserAnalysisConfig` lesson)
   - [ ] XRD/SIMS/RSM default log intensity (the MATLAB defaults,
         `updateControlsForActiveDataset.m:197-228`); reflectometry log R
         (subsumes ncnr's `default_value_channels` special case)

3. **[x] ~~"Plot selected together" command~~** SHIPPED 2026-07-31
   (`d32254b`) — Library multi-select → ONE merged overlay dataset
   (curve per dataset, labelled by dataset name, y = `primaryChannel`),
   via `buildSelectionOverlay` extracted from the Origin-only
   `buildOverlayDataset` core. Menu + palette + Library context menu
   (hidden unless multi-select). 2-D maps skipped by name in the toast;
   refuses when <2 plottable remain. Deliberately distinct from the
   pre-existing "Overlay in one plot" panel window (which keeps
   datasets separate) — documented at the command registration.

## Tier 2 — Medium Impact

4. **[ ] Batch-import overlay offer** — importing ≥2 same-technique
   files raises a toast: "N similar files — overlay in one plot?";
   accept builds the item-3 overlay, decline keeps N datasets with the
   last active. Mixed-technique batches don't offer.

5. **[ ] Per-technique view memory** — remember the last-used view
   (channels, scales, styles) per technique tag; on dataset switch, a
   same-technique dataset gets the remembered view (shape permitting),
   a different technique gets its own memory or the item-2 defaults.
   Replaces the blanket `datasetViewDefaults` reset for same-technique
   switches; shape mismatch still resets.
   - [ ] Persists in `.dwk` alongside other view state
   - [ ] Interacts with the WORKSHEET #14 owner gate (view-state
         persistence) — this is PLOT view state, not worksheet state;
         keep the boundary explicit

## Tier 3 — Nice-to-Have

6. **[ ] P1.3 recipe interface note** — when P1.3 lands, recipes key on
   the SAME technique tag (its "technique scope" field), suggestions use
   the confidence framing above, and the item-2 built-in table becomes
   the zero-recipe fallback tier. No standalone work now; this item
   exists so P1.3's implementer finds the contract.

## Completed

*(nothing yet — plan created 2026-07-31 from the owner design session)*
