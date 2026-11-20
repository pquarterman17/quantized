# Graph-page text, tick-label "Divide by", and style holders (lane M)

Round-2 lane M, 2026-11-20. Each item lists what was proven, the evidence,
and what is left for an owner COM check. Code: `figure_layers.py`,
`annotation_marks.py`, `opj_page_marks.py`, `opj_tick_divide.py`,
`opju_curves_allcols.py` / `opju_figure_curves.py`; frontend
`lib/originTickDivide.ts`.

## A7: LabTalk button objects are not drawn (`.opj`)

A graph text object with a "Programming Control" script has four blocks
after its 133-byte header: format (103 B), caption text, then the **script**.
Every other text object's fourth block is empty (0 B or a single NUL).
Header payload byte **57** is non-zero on exactly the objects with a script.

- Both corpora: 1,337 text objects carry a script (all in owner `XMCD.opj`);
  all have byte 57 = 1. All 2,032 others have byte 57 = 0, including 238
  whose script block is a lone NUL. Old-format `.opj` (107-byte headers,
  public `gh_jgonera_openopj/support/test.opj` "Maximize Origin" / `win -z;`)
  is not covered: those layers still fall back to the flat text scrape.
- Origin's own exports of every XMCD `GraphT*` page draw none of the 10
  buttons per page ("rescale plot", "shift +10 meV", ...), while the plain
  text objects on the same pages are drawn (positive control).
- Rule: byte 57 set **and** a non-empty script block. Such an object is not
  drawn: neither its caption nor its script reaches `annotations` or
  `annotation_marks`. Each layer counts them in `script_objects_not_drawn`,
  a fidelity omission.

## Page-attached text (`.opj`)

Header payload byte **40, bit 0** set = the fraction pair at 19/27 is
relative to the **page** (`frac * page size`), not the layer frame.

- Independent field: the object's page-unit box at offsets 3-10, proven
  earlier against the annotations COM oracle. Over every `Text*`/`Legend`
  object in a graph window of both corpora with a box, frame and page size
  (771): with the bit set, 252 of 254 land on their box as page fractions
  (the 2 misses are button objects, never drawn). With the bit clear, 526 of
  529 land as layer fractions, and none lands as page fractions only.
- COM oracle: `ground_truth/Moke/annotations.json` and `graph_extras.json`
  report exactly these objects as `attach = 1` (Moke Graph10 "(a)", "(b)",
  the Graph4 / Graph10 lower legends). Their x1/y1 match our page fractions.
  The legend test used to accept them because the raw numbers are the same
  in both readings. It now compares them in page space only.
- `.opju` page attachment is not decoded.

## Free text placed on the panel Origin draws it beside (`.opj`)

On a multi-layer page, a layer's free text can sit beside another layer:
Moke Graph10 keeps "(b)" (page-attached) in layer 1. XMCD `GraphT*` keeps
the lower panels' Y titles as rotated free text in layer 1, left of
layers 2 and 3, whose own `YL` titles are blank.

- `opj_page_marks.place_window_marks` moves each mark to the panel whose
  frame is vertically nearest the object's box centre. It converts the page
  anchor to that panel's data coordinates. Single-layer pages are unchanged.
- Rotation is the format block's u16 at offset 2, in tenths of a degree.
  Every `YL`/`YR` title reads 900 and every `XB`/`XT` 0 (243 and 334
  objects). Every wide horizontal `Text*` box reads 0 (204). Tall boxes read
  900 or 450.
- An upward (900) text wholly left of a panel's frame and centred in its
  height fills that panel's **blank** Y title. An unrotated text wholly below
  the frame and centred in its width fills a blank X title. Otherwise it
  stays a mark.
- XMCD `GraphT1066all` (and the other GraphT pages) now render as Origin's
  export: three panels titled "intensity (arb. units)", "difference (arb.
  units)", "asymmetry (%)", with X title "photon energy (eV)" and no buttons.
  Moke Graph10's "(b)" and lower legend sit at the bottom panel's top left.

## Tick-label "Divide by" (`.opj`)

Small named objects `OB` / `OT` / `OL` / `OR` (bottom, top, left, right
axis; header type byte `0x06`). Their next block is the factor as a
NUL-terminated decimal string. `0` = none. These were mislabelled
"composite-layout axis-break sub-objects" and ignored.

- Origin's exports: Moke Graph10 `OB = 10` on layers 1-2 (+-7000 Oe drawn as
  -600..600 under "H (mT)"), `OL = 10` on layer 3 (0..3000 drawn as 0..300),
  `OR = 10` on layer 4 (400..1500 drawn as 40..140). SuperlatticeFits
  Graph10 `OR = 10` (250..420 drawn as 25..40). Graph14 `OB = 0.1` / `10`
  (Q 0.03..0.5 drawn as 0..5; Z 0..2300 drawn as 0..200). MnN_Diffusion_PNR
  Graph6 `OB = 0.1`.
- Negative controls: XMCD `OB = 0` (760..820 eV drawn as is), Moke Graph10
  layer 3 `OR = 0`.
- Corpus distribution (every `.opj` graph window, both corpora): `OB` 0.1
  x88, 10 x40, 0 x50; `OR` 10 x15, 0 x21; `OL` 10 x8, 0.00291 x2; no `OT`.
  Only owner projects set a non-zero factor.
- Origin draws **no** "x10" text: the screen and the export apply it as
  `AxisFormat.divide` with `divideMark: false`. On the single-plot,
  double-Y (right axis = the upper layer's), overlay and spatial-panel paths
  (`SpatialPanel.fmt`, per panel). A workspace carrying it is gated for v0.34.
- `.opju` carries no such objects. UnpolPlots Graph1's X factor (10) and the
  Hc2 Y factor (1e-9, `hc2_open_gaps.md`) stay undecoded. COM:
  `type $(layer.x.label.divideby)`. A specimen saved with and without the
  factor would locate the field.

## Style holders are not plots (`.opju`)

Origin saves plot-style templates as objects named `Style`, `Style1`, ...
Their first field is shaped like a curve token
(`<flag> 01 01 01 80 01 <ordinal>`), preceded by `a2|a3 01 28 aa 00 80`.

- Both corpora: 5 such hits, in SerialCore Bqqbar (4) and MeyerJackson
  Minis "Figure 3 and 4" (1). Each is followed by `0x84`/`0x80`, where every
  one of the 897 plot tokens is followed by `0x83`.
- Read as plots, Bqqbar's four (A, B, C, D) came first in the file and won
  the per-layer `(book, y)` dedup against the real plot tokens. Graph2
  layer 1 drew A, B, C and D against A, including a short D-vs-A segment.
  Without them the real tokens bind **B vs A (line) and D vs C (points)**,
  their recorded X and style. That is what Origin's saved preview shows.

## Diagnosed, not changed

- **XMCD Graph25** (one plot in COM, no curve record): the window has only
  the two template curve headers (`_202`, `_232`) and no curve anchor. No
  anchor for `[T11066all]C` exists outside Graph11/22/24/28 anywhere in the
  file. Origin's own export of Graph25 is an **empty** graph with an
  unresolved `%(1)`/`%(2)` legend, so the empty, fail-closed render matches
  Origin. The COM plot list entry is stale.
- **SuperlatticeFits Graph14 layer 3** shows all three curves (Nb, Nb/Al,
  Nb/Au) since #781's per-layer overlays. Re-rendered against the export.
- **Top-X inside pages with 3+ layers.** In both corpora the only such
  windows meeting the #781 `overlayTopXPair` conditions are SOP_meas Graph40
  layers 5/9 and CV-TEST Graph1 layers 1/2 (no curves). SOP_meas Graph40
  panel (c) is a SHAP plot whose layers 5/9 are horizontal-bar layers
  (exchanged axes, plot-kind lane), not a top X axis. `fig_pairs` Graph1
  (COM: one graph, 4 layers) has no pair with equal Y and different X. No
  extension was made.
- **Figure_1 (mobilebandwidth) Graph1.** Origin draws grouped columns at
  category positions 1..8 labelled with column A's numbers 5..12. The
  decoded axis (0.5..8.5) is that index range, but A imports as a numeric X
  (5..12), so the bars fall at 5..12. The column carries no text values. How
  Origin marks a numeric column categorical is not decoded (category-axis
  lane). The grouped column style is plot-kind work. Both belong to the
  concurrent lanes.

## Owner COM checks left

- XMCD GraphT1066all: open a button object's Programming Control dialog and
  confirm "Script, Run After" is Button Up, to name byte 57 (read here only
  as "has a script").
- Bqqbar is public: `win -a Graph2; layer -s 1; loop(i,1,count){type
  "%(i,@D) %(i,@X)";}`, expected `BqqbarFit_B`/`_A` and `BqqbarFit_D`/`_C`.
- UnpolPlots (`.opju`): `win -a Graph1; type $(layer.x.label.divideby)`.

## Ledger entries (to merge)

For `docs/origin_re/DECODE_LEDGER.md`. Form: field/behaviour → evidence →
guarding test.

- `.opj` button object = header byte 57 set + non-empty 4th (script) block; not drawn → 1,337/1,337 vs 0/2,032 corpus split; XMCD GraphT* exports draw no buttons → `tests/test_io_origin_opj_page_text.py::test_script_object_needs_both_the_flag_and_a_script_block`, `::test_button_caption_and_script_are_not_drawn_and_are_counted`, `::test_realdata_no_labtalk_script_is_drawn`
- `script_objects_not_drawn` fidelity omission → per-layer count → `tests/test_io_origin_opj_page_text.py::test_button_caption_and_script_are_not_drawn_and_are_counted`
- `.opj` text/legend header byte 40 bit 0 = page-attached (fractions × page size) → page box 252/254 vs 0 layer-bit-clear page-only; COM `attach = 1` (Moke annotations/graph_extras) → `tests/test_io_origin_opj_page_text.py::test_attach_bit_reads_the_pair_as_page_fractions`, `tests/test_io_origin_annotation_marks.py::test_realdata_legend_positions_match_com_oracle`, `::test_realdata_annotation_positions_expanded_oracle_sweep`
- `.opj` text rotation = 103-byte format block u16 @2, tenths of a degree → YL/YR 900 (243), XB/XT 0 (334), wide Text 0 (204) → `tests/test_io_origin_opj_page_text.py::test_text_rotation_reads_tenths_of_a_degree`
- Multi-layer page: mark re-homed to the vertically nearest panel frame → Moke Graph10 "(b)" vs export → `tests/test_io_origin_opj_page_text.py::test_page_attached_label_lands_on_the_panel_it_sits_beside`, `::test_single_layer_marks_are_left_in_place`
- Upward (900) text wholly left of a panel fills its blank Y title → XMCD GraphT* vs export → `tests/test_io_origin_opj_page_text.py::test_rotated_text_left_of_a_panel_is_that_panels_y_title`, `::test_unrotated_text_left_of_a_panel_stays_a_mark`
- Unrotated text wholly below a panel fills its blank X title → XMCD GraphT* "photon energy (eV)" vs export → UNGUARDED
- `.opj` `OB`/`OT`/`OL`/`OR` (type 0x06) = tick-label "Divide by" per axis side; 0 = none → Moke Graph10, SuperlatticeFits Graph10/14, MnN Graph6 exports; XMCD negative control → `tests/test_io_origin_opj_page_text.py::test_tick_divide_object`, `::test_tick_divide_needs_the_factor_object_type`, `::test_tick_divide_reaches_the_figure` (corpus values vs exports: UNGUARDED, no machine-readable oracle)
- Origin "Divide by" drawn without the "×factor" text (`divideMark: false`), screen and export, all apply paths → Origin exports show none → `frontend/src/lib/originTickDivide.test.ts`, `frontend/src/lib/axisDivideLabel.test.ts::an imported Origin axis' Divide by draws no factor text`, `tests/test_axis_extras.py::test_origin_divide_scales_labels_without_the_factor_text`, `frontend/src/lib/workspaceForwardCompat.test.ts::AxisFormat.divideMark`
- `.opju` "Divide by" (UnpolPlots Graph1, Hc2) → no `O*` objects in `.opju` → UNGUARDED (undecoded)
- `.opju` style-holder (`Style\d*` + `a2|a3 01 28 aa 00 80`) curve tokens are not plots → 5 corpus hits, tail 0x84/0x80 vs 0x83 on 897 plot tokens; Bqqbar Graph2 and Minis Graph67 previews → `tests/test_io_origin_opju_style_holder.py::test_a_token_opening_a_style_holder_is_detected`, `::test_other_objects_are_not_style_holders`, `::test_style_holder_tokens_add_no_curve`, `::test_realdata_bqqbar_curves_come_from_plot_records`
- Regression fixed: style-holder tokens won the `(book, y)` dedup and dropped the real tokens' recorded X/style (Bqqbar D vs A) → preview → `tests/test_io_origin_opju_style_holder.py::test_realdata_bqqbar_curves_come_from_plot_records`
- XMCD Graph25 has no curve anchor; Origin's own export is empty → file scan, export → UNGUARDED (count covered indirectly by `tests/test_io_origin_figures_opj_curves.py::test_realdata_curve_bindings_precision_and_recall_floor`)
- Origin realdata tests resolve the corpus via `conftest.TEST_DATA_CORPUS` (`tests/origin_corpus.py`); LFS pointer = absent → 68 previously silent skips now run under the owner plugin → UNGUARDED (test infrastructure)
