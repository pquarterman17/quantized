# `.opj` curve bindings from the anchor record (2026-11-20)

Evidence record for three changes to `io/origin_project/opj_curves.py` (Lane
D of the visual-correctness sweep). Same format as `curve_visibility.md`.
The `.opj` curve anchor is the 519/515-byte record that the `.opju` curve
token serializes (`curve_style_color` module docstring), so fields proven on
`.opju` carry over byte for byte. No corpus bytes or values are in the repo;
the realdata tests compute their expectations at test time.

## 1. The column short-name field is 12 bytes (C1: missing curves)

**Symptom.** Owner `XMCD.opj` Graph11/14/18/21/26/27: Origin draws 2-3 curves,
quantized drew 1-2, and nothing said a curve was missing.

**Root cause.** `column_id_map` read the column-storage block's short name
with an 8-byte window (`_cstring(payload, 0x12, 8)`), so every name of 8-11
characters (`averages`, `difference`, `diffNormAB`) returned `None`. The
column's id never entered the map and `extract_curves` dropped the plot at
`if info is None: continue`. The worksheet reader (`windows.py`) reads the
same field with a 20-byte window, which is why those columns imported fine.

**The field.** Every column block has the next field at 0x1E: `averages\0\0\0\0`,
`average\0\0\0\0\0`, `difference\0\0`, `difference5\0` all put byte `09`/`0B`
at 0x12 + 12. That is a 12-byte field, 11 characters + NUL, which matches the
11-character truncation `opj._drop_unbacked_columns` documents for liborigin's
`column-dataid-collision` specimen.

**Corpus distribution (both corpora, 103 `.opj`).** Accepted short-name lengths
with the 12-byte window are 1-11 only (3051, 714, 991, 43, 576, 6, 125, 211,
132, 135, 105). The old 20-byte probe also admitted two 14- and 17-character
strings, which were report-sheet junk (`s.A.Dependency`, `tring}=Basic Plot`).
The 12-byte window rejects those. Curve anchors that resolve rise from
1099 to 1177 of 1202. All 78 new ones are in `XMCD.opj`, and two ids there
change from a junk window-`6` block to their real column.

**Oracle.** The owner COM plot list (`specimens/ground_truth/XMCD/index.json`)
shows 244 of XMCD's 245 plots decoded (drawn, or left out as hidden, see 3),
with 0 contradicting COM. Before the change: 166. The one plot not reached
(Graph25, `T11066all` C) has no curve anchor in its layer at all, which is a
separate gap. Origin's exports `_exports/XMCD/Graph11/18/26.png` draw exactly
the curves now decoded (Graph18: red `difference`, blue `normA`, yellow `normB`).
Moke 39/39 and XRD 12/12 (the existing recall floors) are unchanged.

**Fail closed.** A real plot (anchor + DataPlot) whose id still resolves to no
column is now left out with reason `column_not_resolved` (`x_not_resolved`
when its book has no inferable X) in `curve_sheet_omitted`. Fidelity reports
it as `curves_left_out`. It keeps its plot index, so legend captions and
colour increments still count it. Public specimens that carry such plots
(`CV-TEST`, `XRD1`, `XRD3`, `3dband-origin`, `strings_testing`, the LabPlot
`two_layers…`/`single_layer…` files, `origin8_test_tree_import`) now report
the loss instead of a silent empty graph. 18 more public layers become
actionable for that reason.

## 2. The record's own X (C5: hc2convert's "text X")

**Symptom.** Owner `hc2convert.opj` Graph1/4/6-11 drew empty. The visual sweep
read this as "column A is mixed text/numeric and its numbers were lost".

**Root cause.** That reading was wrong. `A6221LockinD3_A` is a pure Text &
Numeric dataset: 707 rows, all tag 1 (the instrument's TDI header text),
0 numeric cells, so the text-only decode is right. The bug was the X:
`.opj` never decoded a curve's X. It inferred the nearest preceding
X-designated column, which is `A` for these books. Origin plots them against
`AE` ("multi[1]:Control:Magnet Output", -5.5..5.5 T), and its exported Graph1
runs -6..6.

**The field.** Offsets 35-36 of the anchor = X column id, 37-38 = the
designation pair (`21 61`). This is exactly `opju_curve_token_x.X_FIELD`,
COM-verified on `.opju`, including `Hc2 data.opju` (record X `AE`/`AC`/`R`).
`_record_x` reuses `bind_x`: same marker mask, same fail-closed reasons
(`x_not_a_column`, `x_column_unknown`, `x_other_book`). A box/histogram plot
with X id 0 keeps its shipped binding (`rowless_kind`; `histogram.opj`).

**Evidence.**

* Controlled specimen: `hc2convert.opj` is an earlier save of `Hc2 data.opju`.
  For every curve both projects decode (89), the `.opj` record X equals the
  `.opju` COM-verified X: 89 agree, 0 disagree. Before, all 89 bound `A` or
  `AG`. Every hc2convert X is now a numeric column of its book.
* Rendered oracle with a data-level discriminator: `Moke.opj` Book4 has `E = -A`
  row for row. Graph2/8/9 records name `A`, while the inference said `E`.
  Origin's export of Graph8 draws Kerr signal B high at negative field, which
  is B against `A`. Against `E` the loop is mirrored.
* Distribution (1202 anchors, both corpora): pair `21 61` 1000, `30 61`/`30 21`
  (error-bar plots, left out anyway) 167, `21 21` 25, others 10. Of the
  1175 records whose X resolves, 914 agree with the inference. The 261 that
  disagree are error-bar plots (whose field names the Y they decorate, pair
  `30`, not read), plus hc2convert (82) and Moke Graph2/8/9 with its three
  probe copies.
* Negative control: a record without a valid pair keeps the inference
  (synthetic test). The error-bar `30 61` pair is never read as X.

**Frontend agreement (`xRecorded`).** A curve whose X comes from this field
carries `xRecorded`, exactly like a `.opju` curve, so the apply's A2 rule
(`lib/originRecordedX.ts`) draws it against that X even where the frontend's
nearest-preceding-X (in channel order) would pick another column. Without
it the backend and the plot could disagree. Data-level case: `Moke.opj`
Book4 lists its channels in a different order from the worksheet, and the
frontend's nearest-preceding X for `M` and `H` is `I` (128 rows), while the
record names `C` (52 rows, the same length as `M`) and `E` (161 rows, the
same length as `H`). An X the reader only infers carries no flag and never
wins. On the 111 Origin-exported owner `.opj` pages (Moke, hc2convert,
XMCD, SuperlatticeFits, MnN_Diffusion_PNR, XRD) and Moke Graph1/7/12, the
renders with and without the flag are pixel-identical: the multi-X figures
already went through the per-curve-X overlay, which reads the backend X. So
the flag closes a latent disagreement in the single-X path; it changes no
current render in the corpus.

## 3. Hidden plots (offset 38 `21`)

`.opju` already leaves out a plot whose offset 38 reads `21`
(`curve_visibility.md`). The `.opj` anchor carries the same byte. 25 `.opj`
data plots read `21 21`. On every one with an Origin export, Origin does not
draw the plot:

* XMCD Fe-EY (plots 2-3 hidden): the export shows only "As deposited";
* XMCD Mn-EY (plots 1-2 hidden): only the teal "525 C";
* XMCD Co-Ey (plot 2 hidden): only "As deposited";
* SuperlatticeFits Graph10: the hidden `Book5` F (layer 1, also plotted shown in
  layer 2) and `Book13` D (layer 4) do not appear in the export's panels.

COM's plot list includes hidden plots (it did on `.opju` too). In the XMCD
score above, the 5 hidden plots are matched as left out, not missing. The
public templates `EMISSION.opj`/`FTIR.opj`/`PARTICLE SIZE.opj` lose 2/3/5
drawn curves to this rule. They hold no worksheet data, so nothing visible
changes.

## Not proven here: owner COM checks

* `hc2convert.opj` Graph13 (record X `R`) and Graph20-34 (`AC`, `Book3_F`) have
  no export. COM: `win -a Graph13; layer -c; type %(1,@X)`. Expected `R`.
* XMCD Graph25: Origin lists one plot (`T11066all` C) but the layer has no
  curve anchor. Find where that plot is stored.

## Related `.opju` findings: diagnosed, not changed

Both previews below disagree with the decode, but the bytes do not show
which one is stale. Nothing was changed.

* **C2: public `tech_gabp/UNTITLED.opju` Graph2.** Its one curve token names
  Y id 2 = `Book1_B` (9 rows, 0.08-0.35), the same id as Graph1/Graph3, whose
  previews match B. Graph2's preview, axis (1..16, 0..550) and Y title
  ("驻留时间 /S") all match `Book1_C` (16 rows, Graph5's column). The two
  reconstructed records are byte-identical except offset 11 (u32: 9 in Graph1,
  16 in Graph2) and the container byte. Across the public corpus u32@11
  equals the bound column's row count in only 9,504 of 11,461 records, so it
  cannot overrule the id. Most likely column B was overwritten after Graph2
  was drawn and the preview is stale. Origin re-opened would then draw B on
  the 0..550 axis, which is what quantized draws. COM:
  `win -a Graph2; layer -c; type %(1,@D)` (expected `Book1_B`).
* **C3: public `MeyerJackson Minis … amplitude - rise time data.opju`
  Graph60.** The token binds `Book31` G (mean amplitude, +11.8..+76.9 pA)
  against record X `B`. The preview and the decoded axis (-85..-5) show the
  same points negative. No sheet of `Book31` holds the negated values, and its
  fit sheet (`Book31@9`) fits positive G, which points to a sign flip of the
  column after Graph60 was drawn. COM: `type %(1,@D)` and `$(layer.y.from)`.
* **C3: owner `UnpolPlots.opju` Graph1 (×10 X).** This is not a data fault. The
  X data (Z, -10..255.8 Å) and the decoded axis (-10..270, step 50) match the
  owner's COM axis check (structural report x_range "ok"). Origin's tick
  labels read 0..25 because of the axis's tick-label "Divide by" factor (10),
  a display field that is still undecoded **in `.opju`** (the same field as the
  ×1e9 Y factor in `hc2_open_gaps.md`). COM: `type $(layer.x.label.divideby)`
  (expected 10). A specimen saved with and without the factor would locate it.
  In `.opj` the factor is decoded and applied (`OB`/`OL`/`OR` objects, lane M:
  [`page_text_and_tick_divide.md`](page_text_and_tick_divide.md)).
