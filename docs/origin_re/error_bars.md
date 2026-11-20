# Error-bar plots: which curve they decorate (2026-11-20)

An Origin error-bar plot is a DataPlot of its own, Origin plot type 231
(Y error) or 233 (X error). quantized does not draw it as a curve
(`opju_plot_gates`, PR #704). Before this change the bars were drawn only
where the error column's worksheet designation paired it with a Y. Most
designations do not decode, or the error column is designated Y, so most
bars were lost: 1,777 public and 24 owner figures carried the fidelity code
`error_bar_plots`.

`io/origin_project/opju_error_bars.py` now reads the binding from the plot
record itself. It sets `yErr` on the curve the bars decorate, where that is
proven. Everything else stays left out as `error_bar_plot`. The `.opj` anchor
record is the same record, so `.opj` uses the same rule (`opj_curves`).

## The record

All offsets are in the 519-byte plot record (`curve_style_color`; the
`.opju` curve token is its sparse form).

| offset | data curve | error-bar plot |
|---|---|---|
| 4-5 | plotted (Y) column id | the error column's id |
| 23 | style flags | **direction**: bit `0x01` plus, `0x02` minus (`3` = both); bit `0x10` = an X-error plot |
| 35-36 | X column id | **the id of the column the bars decorate** |
| 37-38 | `21 61` (`21 21` hidden) | `30 61` (`10 60` on a non-Text & Numeric column; `30 21` hidden) |
| 76 | plot type (`0xc8` line ...) | `0xe7` (231) or `0xe9` (233) |

An error plot's "X" is the column of the curve its bars sit on. Plot order
is not the binding. The error plot can come before the curve, after it, or
several plots away from it.

## Evidence

**Rendered oracle and COM plot lists (owner corpus).**

* `Fixed Lambdas SI.opju` Graph1: COM plot list `I` (SA), `K` (Theory SA),
  `J` (dSA), then three more theory lines. `J`'s offset 35 names `I`.
  Origin's exported graph (`_exports/.../NbAl.png`) draws the bars on the
  teal SA scatter. The `K` line, which is the plot before `J`, has none. A
  "curve before it" rule would put them on `K`.
* `UnpolPlots.opju` NdNiO3NR: COM plot list `H` (dR Fresnel) FIRST, then `G`
  and `I`. `H` names `G`, and Origin's export draws the bars on `G`.
* `MnN_Diffusion_PNR.opj` Graph10 (`.opj`): `J` (dSA, designated **Y**)
  names `I` (SA). Origin's export draws Y and X bars on the SA triangles.
  quantized drew `J` as a phantom "dSA" line (`_exports/.../quantized/Graph10.png`).
  Now it draws Y bars from `J` and X bars from `dQ` on SA, with no `dSA`
  line.

**Distribution.** 3,609 error-bar records reconstruct across the two
corpora (`.opju`). 3,601 have a decoded column.

* Every X field names a column of the error column's own book.
* 3,173 name exactly one data curve of the same layer. None names two.
* The other 428 name a column the layer does not plot: 424 in
  PerceivedRisk, 4 in `calibration_for_fig4`. They stay left out.

**Direction.** The 3,601 decoded records split as follows:

* Offset 23 = `3` (both ways) on 1,458 records.
* `1` + `2` on 1,065 curves that have two error plots: the plus half and the
  minus half.
* `0x11` / `0x12` / `0x13` with byte 76 `0xe9` on all 8 `0xe9` records.
* `0x11` / `0x12` with byte 76 `0xe7` on 12 records. The 2026-11-15 COM
  sweep found exactly 12 `0xe7` tokens that Origin reads as 233.

Which half is which is proven by two independent oracles in
`Graph_Template.opju` (also in `Graphs.opju`):

* The author's own column names. `2` is on `Lower_Bound`, `LB_Layer` and
  `XerrMinus10/100/390`. `1` is on `Upper_Bound`, `UB_Layer` and
  `XerrPlus*`. That is 14 halves, 0 exceptions.
* Origin's saved page preview of `32New`. CQI (`T`) has bars from
  `U` = Lower_Bound (`2`) and `V` = Upper_Bound (`1`). The bar extents
  measured off the preview match `T - U .. T + V` at every distinguishing
  point (x = -1: 5..9, x = 3: 6..11, x = 11: 8..13). They do not match the
  swapped reading (7..11, 5..10, 7..12).

The `XerrMinus/Plus` columns of `43Lollipop` are also the 12 `0xe7`
X-error records. So bit `0x10`, not byte 76, decides the axis.

**Negative controls.**

* The 5 hidden error plots (`30 21`, public `Fig3_e` Graph1) never link.
  Origin's preview draws no bars there (`curve_visibility.md`). The same
  file's Graph2 plots the same columns of sheet 2 with SHOWN error plots
  (`30 61`). Its preview draws an error band on every curve, and all 5
  curves get their `yErr`.
* The 2 `10 40` records (BET) never link.
* The 1 record with offset 23 = `0x43` never links.
* No data curve's record links: it has no `0xe7` / `0xe9` byte.
* `Hc2 data.opju` has 0 error-bar records. Its Graph40 magenta bars stay
  undrawn, which is right (`hc2_open_gaps.md`).

## What is drawn

`attach_error_bars` runs once the books are imported. It sets
`yErr = <error column>` on the curve, and drops the plot's `error_bar_plot`
note, in two cases:

* the curve has one Y-error plot drawing both ways; or
* the curve has a plus and a minus half whose two columns hold the same
  values on every row. Then the bars are symmetric, whichever half is
  which.

The error column must be a value column of the curve's own imported book
and sheet.

The frontend pairs the channels (`originFigureSelection.figureCurveErrKeys`).
The figure's own pairing wins over a designation pairing of the same column
(`withCurveErrKeys`), and the column is hidden as a series.

* A cross-book figure carries the error column in its overlay
  (`origin_overlay_errors`, overlay schema v3).
* An X-only error span from the book's roles no longer suppresses a
  column's Y bars (`uplotOpts`). MnN Graph10 needs both.

The export draws the same bars: the view's `errKeys` reach the figure
document's error bindings.

## Still left out (`error_bar_plot`, fidelity `error_bar_plots`)

Public counts are both containers. Owner counts include the `specimens/converted` copies.

| case | public | owner |
|---|---|---|
| plus/minus halves with different values: asymmetric bars, which the figure path cannot carry yet (direction proven, see above) | 866 | 0 |
| two both-ways error plots on one curve | 420 | 0 |
| no link: X field names no plotted curve, hidden, unread flags or pair | 437 | 24 |
| X-error plots: horizontal bars come only from book roles | 13 | 12 |
| curve's book not imported | 25 | 0 |
| **attached** | **1,817 plots on 1,185 curves, 1,115 figures** | **149 plots, 109 figures** |

The bars' look is not decoded: whiskers or a filled band (PerceivedRisk
draws bands), cap and colour. quantized draws plain whiskers in the
curve's colour.

## COM checks for the owner

On a machine with Origin 2026b:

1. **The asymmetric halves on a controlled specimen.** In a new book, set
   A = X, B = Y, C = +err, D = -err with different values. Plot B with
   asymmetric Y error bars from C and D (Plot Setup: yEr+ = C, yEr- = D).
   Save it as `asym_probe.opju`.
   * Expected: C's plot record has offset 23 = `1` and D's has `2`, both
     with offset 35 = B's id.
   * Then read the direction in LabTalk with `layer.plotN.errbar.direction`
     (or Plot Details > Error Bar > Direction) for each plot. This closes
     the proof the long names and the preview already give.
2. **A two-both-ways layer.** Open `PerceivedRiskandPrediction.opju`, then
   `win -a Graph29; layer -c; loop(i,1,count){type "$(i) %(i,@D) $(layer.plot$(i).type)";}`.
   This finds which of the two both-ways error plots on one curve
   (`(3, 3)` above) Origin draws, and whether one is a band.
