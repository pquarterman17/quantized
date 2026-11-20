# Origin per-curve visibility (shown / hidden)

Evidence record for the `.opju` hidden-plot decode (decode plan items 42, 52
and 70; code in `io/origin_project/opju_curve_token_x.py`, `token_hidden`).
Established 2026-11-20 without a live Origin session, from four independent
oracles listed below. The owner's COM confirmation query is at the end.

## The field

A curve token is the sparse form of the 519-byte curve-anchor record
(`curve_style_color` module docstring). Offsets 35-36 hold the plot's X column
id (item 70) and offsets 37-38 a pair that was read as a designation marker
(`21 61`, or `21 21` on "some" tokens). The pair's second byte carries the
plot's visibility:

| offset 38 | meaning | records (corpus, `.opju`) |
|---|---|---|
| `61` (bit `0x40` set) | plot shown | 10,921 (`21 61` 7,275, `30 61` 3,646) |
| `21` (bit `0x40` clear) | plot HIDDEN in the graph | 253 (`21 21` 248, `30 21` 5) |
| anything else | not read (fail closed: drawn as before) | 743 (`01 60` and rarer pairs) |

Only the exact byte `21` is read as hidden. The record must walk to offset 38
(the same walk `token_x_id` uses); an unwalkable record is not hidden.

## Evidence

### 1. Controlled specimen: the same plots before and after hiding

`origin/hc2convert.opj` is an earlier Origin save of the same research
project as `origin/Hc2 data.opju`. Its Graph3/7/9/15/22 plot only the raw
lock-in columns (`E/G/I`, Graph22 `C/E/G`), and Origin's own exported PNGs of
it (`origin/_exports/hc2convert/Graph7.png`, `Graph9.png`) draw them. In
`Hc2 data.opju` the user later added the normalized `R/RN` columns
(`AR/AT/AV`, Graph22 `AL/AN/AP`), plotted them in the same layers and hid the
raw ones.

The `.opj` anchor record and the `.opju` token record are the same 519-byte
layout, so the two saves can be diffed record by record for every
`(graph, book, column)` both contain:

| pairs | differing offsets (excluding offset 0, a container framing byte that differs on every record) |
|---|---|
| 15 raw lock-in plots, shown in `hc2convert`, hidden in `Hc2 data` | **38 only**: `61` -> `21`, on all 15 |
| 71 other shared plots (shown in both) | none |
| 15 other shared plots (fit curves re-pointed at new columns, one recoloured group) | 4-6, 18, 35-36, 310, 362, 482-483, 515-516 -- never 38 |

Same graph, book, column, X id, style, colour and size: the single bit that
changed is the one the hiding changed.

### 2. Origin-rendered oracle: the embedded page previews

Every `.opju` page carries a PNG preview Origin rendered when it saved the
project (`graph_preview.py`). Where the preview can be read decisively it draws
exactly the `61` plots:

| project / page | hidden (`21`) | shown (`61`) | preview |
|---|---|---|---|
| Hc2 data Graph3, 7, 9, 15, 22, 35 | 18 (raw `E/G/I`, `C/E/G`) | 18 (normalized) | 3 normalized curves, y 0..1; no raw curve (their 0.08-0.38 plateaus are absent); legend 3 entries |
| Hc2 data Graph36 | 6 (`C` black scatter, `B@3` black line, 3 red fits, `M`) | 5 | red + blue scatter and red + blue lines; nothing black |
| Hc2 data Graph39 / 40 | 1 / 2 fit lines | 5 / 6 | legend after the decode equals Origin's (`%(4)` / `%(7,@LG)` caption gone) |
| public EIS Graph1 | 5 (sheets 1, 2, 6, 7, 8) | 3 | 3 scatter series, 3 legend entries |
| public UV_vis_DRS_Tauc Graph1 / Graph2 | 3 / 1 | 3 / 2 | 3 / 2 lines, matching legends |
| public 拟合 (gabp) Graph1-3 | 1 orange scatter each | blue scatter + 2 lines | no orange scatter |
| public Figure_12 Graph2 | 1 (green `#009E73`) | 2 | 2 lines (red, blue), no green |
| public Figure_15 Graph2 | 1 | 3 | 3 series (Cubic, Reno, BBR) |
| public PALS Graph11 / Graph4 | 1 pink line / 1 red scatter | 2 / 1 | black + red / blue only |
| public Fig3_e Graph1 | 5 Y-error plots (`30 21`) | 5 lines | 5 lines, no error bars |
| public pedotpss_IV Graph7 | 19 | 27 | re-plotting the imported data: the 27 shown reproduce the preview; the 46 add crossing curves with deep dips (e.g. to 4e-5 at bias -0.2) the preview does not have |

Consistent but not decisive at preview resolution (legend counts match the
shown plots, colours overlap): Absorption-D3 (76 hidden: every `*wat` book
hidden, every `*vac` shown, legends list the `vac` plots only), Discretewithsum
Graph1 (legend 14 entries = 14 drawn after the decode, 16 before),
cleaned_data Graph6/9 (legend 4 = 4 shown). Not checkable at preview
resolution: SOP_meas (11), Figure-1 (55); no preview: RSOS_TC_all,
Figure2-c. No preview contradicts the field.

### 3. Distribution: no confound with style, connect mode or book

The 228 hidden records that reconstruct to the full 519 bytes (of 253) span
every common plot style (byte 76: line 143, scatter 57, line+symbol 3,
`0xcb` 20, error bar 5) and byte 17 values 0, 1, 8, 12 and 97 (the byte-17 connect-mode field that was reverted in
PR #32 is independent of it). Hidden and shown plots share books in the same
layer (Hc2 Graph3: one book, three of each; EIS: one column over 8 sheets),
so unlike the `PNR.opj` case below the bit does not track book membership.

### 4. Negative controls

* 0 of 428 records in the COM-built specimen projects (every plot created
  shown) and 0 of the 365 generated plot-type corpus records read `21`.
* 0 of the 83 records of the COM-verified RockingCurve, UnpolPlots, Fixed
  Lambdas SI and XAS `.opju` projects read `21`; their drawn curves are
  unchanged by the decode.
* The Hc2 graphs whose COM plot lists match quantized (Graph1, 2, 4, 6, 8, 10,
  11, 13-21, 23-26) contain no `21` record and are unchanged.

## What a COM plot list does and does not say

A COM `layer.plot` enumeration (`%(i,@D)`, the `plots` arrays in
`specimens/ground_truth/*/index.json`) lists a hidden plot like any other:
item 70's 2026-11-15 sweep reported Hc2's raw lock-in plots as plotted, and
Discretewithsum Graph1 lists `Mid1_E@5` twice (one record hidden, one
unreadable). It is a binding oracle, never a visibility oracle.

## Behaviour

`extract_curves_by_id` leaves a hidden plot out of `curves` and lists it in
`curve_sheet_omitted` with reason `hidden_in_origin` and its full binding
(`book`, `x`, `y`, `recorded`), so the data stays imported and the Recover
window names it. `hidden_in_origin` wins over any other omission reason.
Fail closed in the other direction: when another token of the same layer
names the same column without the hidden byte, the curve stays drawn -- also
when that shown token carries another column id that binds the same (book, Y,
sheet) and so collapses into the same curve (Absorption-D3 Graph1 layer 2: six
`CuSCH3vac B` plots, three hidden; the kept curve kept its own reason,
`sheet_unknown`, instead of being reported hidden -- since 2026-11-20 the
six ids align to six sheets, so they no longer collapse: three are drawn and
three reported hidden, `validation_log.md` "curve sheets"). The
figure's fidelity reports `curve_visibility` as recovered, and a layer whose
only omissions are hidden plots reports no curve loss
(`fidelity_manifest.md`).

Corpus diff vs main (590 `.opju`, 2026-11-20): 228 drawn curves leave 58
layers in 17 projects, every one a `21` record; 0 curves added; 20 curves that
were already omitted for another reason (Hc2 Graph37's four `x_token_differs`
fits among them) are now `hidden_in_origin`. `.opj` reading is unchanged.

## Not decoded (yet)

* `.opj`: the anchor record has the same offset 38. `XMCD.opj` (5),
  `SuperlatticeFits.opj` (10 + 1) and `MnN_Diffusion_PNR.opj` (23 `30 21`)
  carry `21` there, and `hc2convert.opj` / `Moke.opj` / `XRD.opj` none. Not
  applied: no rendered oracle was checked for those graphs.
* `PNR.opj` Graph25 (item 42): its T++/T-- lines are not drawn by Origin, yet
  the 2026-07-11 byte scan found no anchor byte separating them, offset 38
  included. Whatever hides them there is a different mechanism (for example
  a line style of "none"), not this bit. Still open.
* Hidden Y-error tokens (`30 21`, Fig3_e Graph1) are left out as
  `hidden_in_origin` and never attach as bars (`error_bars.md`). Graph2,
  with the same plots shown, draws them.

## The COM check that would settle it

Two steps, on a machine with Origin 2026b (the exact LabTalk/`originpro`
accessor for a data plot's Show state was not verifiable here, so step 1
pins it before step 2 relies on it):

1. **Controlled specimen.** In a new project plot three columns of one book
   as line plots in one layer, hide plot 2 (Layer Contents: select it, "Hide";
   or Plot Details: clear "Show"), save as `hidden_probe.opju`, then show it
   again and save as `shown_probe.opju`. Expected: `extract_figures_opju`
   draws plots 1 and 3 and reports plot 2 `hidden_in_origin` in the first
   file, and draws all three in the second; a byte diff of the two files'
   plot-2 records differs at offset 38 only (`21` vs `61`). While the
   specimen is open, find the property that reads the state (candidates:
   LabTalk `layer.plot2.show`, `set <dataset> -h`, `originpro`
   `GLayer.plot_list()[1].obj.get_int('show')`) and keep the one that reads
   0 for the hidden plot and 1 for the others.
2. **Sweep.** With that property, for every plot of every layer of
   `Hc2 data.opju`, `EIS.opju`, `UV_vis_DRS_Tauc.opju`,
   `PALS_10_585_v2.opju`, `Figure_12.opju`, `Absorption-D3.opju`,
   `pedotpss_IV_2019-08-01.opju` and `SOP_meas.opju` record
   `(page, layer, plot index, %(i,@D), show)` into
   `specimens/ground_truth/<stem>/visibility.json`. Expected: show = 0
   exactly on the plots this decode reports `hidden_in_origin` (Hc2
   Graph3/7/9/15/22/35 raw `E/G/I` / `C/E/G`; Graph36 `C`,
   `B@3/15/27/29`, `M`; Graph37 `B@3/5/7/29`; Graph39 `B@43`; Graph40
   `B@43`, `B@47`) and 1 everywhere else, in particular on every
   COM-identical Hc2 graph (Graph1, 2, 4, 6, 8, 10, 11, 13-21, 23-26).
   The same sweep over `XMCD.opj`, `SuperlatticeFits.opj`,
   `MnN_Diffusion_PNR.opj` and `PNR.opj` decides the `.opj` follow-up.
