# Multi-layer graph pages: stacked panels and top-X layers (B1/B2)

Evidence record for two layer-composition defects found by the visual check
against Origin's own rendered graphs (`tools/visual/origin_preview_*`):
stacked multi-panel pages that collapsed to one panel (B1), and a top-X
overlay layer drawn as a separate stacked panel (B2). Established 2026-11-20.

## B1a: `.opj` column names of 8 or more characters (backend)

**Symptom.** About 24 `XMCD.opj` `GraphT*` pages: Origin draws three stacked
panels (intensity / difference / asymmetry), we drew only the top one.

**Not geometry.** The layer frames decode on all three layers and tile the
page exactly as Origin's export shows (`GraphT106680019e9`: frames
`708..2126`, `2126..2836`, `2836..3546` page units on a `6400 x 4800` page).
Layers 2 and 3 were dropped later because they had no curves.

**Cause.** Each of those layers has a valid curve anchor (`opj_curves.py`),
ids 351 and 352, but `column_id_map` had no entry for them. Their
column-storage blocks exist, with the same u16 id at offset 4, in book
`T106680019e9`, named `difference` and `asymmetry`. `_column_short_name` read
the name at `0x12` through an 8-byte window, so any name of 8 or more
characters had no NUL inside it and the column was skipped.

**Fix.** Read the field's real width, 12 bytes (`_SHORT_NAME_FIELD`, also #780 Lane D; see `curve_bindings_opj.md`): `0x12`
to `0x1D`, at most 11 characters and a NUL. `0x1E` starts a separate u16
(`0x0009` in 5,832 of the 6,103 corpus column blocks, the value the `.opj`
writer emits; the writer also truncates names to 11). Every real column in
the corpus ends its name inside those 12 bytes (longest: 11 characters). The
read stops at the first NUL, so a wider window (`windows.py` scans 20) finds
the same names on real columns and differs only on junk past the field: two
non-column `hc2convert.opj` entries.

**Evidence.**
- Independent COM oracle `specimens/ground_truth/XMCD/index.json` (per graph,
  per layer plot lists): decoded curves correct 166 -> 244 of 245, wrong 0 ->
  0; layers whose curve list matches exactly 60 -> 127 of 128. The one miss
  (Graph25 layer 1) is unrelated and unchanged. Locked in
  `tests/test_io_origin_figures_opj_curves.py` (realdata, `XMCD` = 239 drawn: since #780 the 5 plots Origin hides are left out as
  `hidden_in_origin`, and `test_io_origin_opj_curve_record.py` counts them).
- Whole corpus (all 75 non-synthetic `.opj`, public and owner), measured
  with a 20-byte window: it adds 582 id entries, changes 3 and removes none
  (the 12-byte window gives the same map minus the two `hc2convert` junk
  entries). All 69 curve
  anchors it newly resolves are in `XMCD.opj`; unresolved anchors corpus-wide
  go 91 -> 22. The 3 changed entries were garbage before and are unused by
  any anchor (`XMCD` ids 182/376 read `('6 ', 'z?')`, now the real columns
  `averages`/`difference5`; `hc2convert` id 27756 is junk either way).
- Origin's exports (`_exports/XMCD/GraphT*.png`) show the three panels; the
  re-render shows them stacked in the decoded frames.

## B1b: stacked layers that each plot several books (frontend)

**Symptom.** `Fixed Lambdas SI.opju` Graph5/6: two stacked layers (4 and 6
books) drawn as one panel holding the clicked layer's curves.

**Cause.** The apply built a cross-book overlay for the CLICKED layer and
returned before the spatial multi-panel apply; that apply also needs every
layer on one dataset, which a cross-book layer is not.

**Fix** (`store/originApplyPanels.ts`). A window of 2+ layers that is not a
double-Y or top-X pair builds one overlay per cross-book layer (stamped with
that layer as source and entry, so a re-apply refreshes it in place) and
applies the panels on them. It does so only when the layout is trusted
(decoded tiled or page geometry, no dropped overlay layer); otherwise nothing
is committed and the old clicked-layer overlay apply runs (fail closed).

Corpus reach (`scan_pairs`, all 455 files): about 50 multi-layer pages have a
cross-book layer and are not a double-Y pair (Fixed Lambdas Graph5/6,
MnN_Diffusion_PNR Graph18/19/22, SuperlatticeFits Graph14/16, XMCD
Graph34/37/Merged, PALS, SOP_meas, Figure-1).

## B2: a top-X overlay layer (frontend)

**Symptom.** SerialCore `Bqqbar.opju` Graph2: one frame with the mu axis at
the bottom and a 1/mu axis on top (Origin's saved preview). We drew two
stacked panels.

**Rule** (`lib/originOverlayFigure.ts`, `overlayTopXPair`), the mirror of the
A8 double-Y pair: exactly two layers, both with curves, decoded frames that
coincide, the SAME Y range and Y scale, a DIFFERENT X range, both X linear
with a non-zero span. The upper layer's curves join the host's overlay with
their X mapped linearly onto the host's X (both axes span the same frame
width, so the range ends line up), and a linear top axis labels it in the
upper layer's units. A log X fails closed to the panel apply.

Corpus distribution: of all 2-layer pages with coinciding frames, 650 have
the same X and Y, 54 are double-Y, 1 is both-differ, and exactly 1 is top-X
(Bqqbar Graph2). Top-X relations inside 4- and 9-layer pages
(`fig_pairs.opju` specimen, SOP_meas Graph40) are not touched.

**Inference, not decoded:** which side the second X axis is drawn on. Two
coinciding layers would overlap their tick labels if both used the bottom,
and Origin's preview shows it on top; the axis-side flag itself is not
decoded. Owner COM check: for `Bqqbar.opju` Graph2 layer 2, read
`layer2.x2.showAxes` / `layer2.x.showAxes` (expect top shown, bottom hidden).

## Re-render against Origin's own images

Base (PR #779 head) and this change rendered with
`tools/visual/origin_preview_shots.mjs` over 9 projects (111 pages): 65 pages
byte-identical, 46 changed. Every changed page reviewed against Origin's
export or saved preview moved toward it:

- XMCD `GraphT*` (24 pages): one panel -> Origin's three stacked panels.
- XMCD Graph11/14/18/21/26/27 (the C1 "missing curve" pages): curves on
  long-named columns (`averages`, `difference`, ...) are now drawn, so each
  page draws Origin's curve count: Graph11/14/18 2 -> 3, Graph21/26/27 1 -> 2.
- XMCD Merged / Graph34 / Graph37, Moke Graph10, SuperlatticeFits Graph14,
  PALS (6 pages), Figure-1 Graph1, SOP_meas composites: every layer as its own
  panel in the decoded layout instead of the clicked layer only.
- Fixed Lambdas SI Graph5/6: the two stacked panels with all 12 curves.
- RockingCurve Graph3 panel (c): the multi-X layer now draws each curve on its
  recorded X, so the 2θ = 2.2° curve runs to 2.0 with its peak at 1.1, as in
  Origin's export (before: cut at 1.0, peak at 0.7).
- Bqqbar Graph2: one plot with the 1/mu top axis.

Gallery minimum: Moke (8 pages) and RockingCurve (4) are unchanged except
Moke Graph10 and RockingCurve Graph3, both closer to Origin as above. PNR.opj
is a git-LFS pointer in this extract and was not rendered.

## Not fixed here

- Bqqbar Graph2's short orange segment near x = 100 is a layer-1 curve
  binding question (curve decode), not layer composition.
- The XMCD `GraphT*` layer 2/3 Y titles (`difference (arb. units)`, ...) are
  not decoded (`y_title` is empty), and the LabTalk button script still shows
  as text (A7).
