# Hc2 data.opju: Graph40's bars and Graph34 (not decoded)

Findings from 2026-11-20 on the two remaining Hc2 gaps after the curve-colour
change (`curve_colors.md`). Neither cleared the evidence bar in
`CLAUDE.md` ("Origin graph-recovery safety"), so nothing was implemented.
Each section ends with the COM query that would settle it.

## Graph40: the magenta bars are not error-bar plots

Origin's saved preview of Graph40 ("Graph32 - Copy", `Book2`/`Book3` column
E vs T with fit lines) draws short vertical magenta bars on three points of
each scatter. They were read as Y error bars (plan item 74). The bytes do not
support that:

| check | result |
|---|---|
| error-bar DataPlots in the file (record byte 76 `0xE7`/`0xE9`) | **0** in the whole of `Hc2 data.opju` (2,738 in the 36 corpus files that have them) |
| record byte 37 = `0x30` (the "partner" byte) | 0 in Hc2. Corpus-wide byte 37 = `0x30` occurs on 3,605 records, every one an error-bar plot (`0xE7/0xE9`), and on no other record (7,108 `0x21`, 592 `0x01`, ...): it is a second marker of the same thing byte 76 already gates, not a separate token form |
| tokens in Graph40's layer | 8 (2 scatters, 6 fit lines; 2 hidden), none undecoded |
| Y-error designations in `Book2`/`Book3` | none (A = X, B-F = Y; `Book2` F empty) |
| Graph39 (same layout, fits on `Book2`/`Book3` D) | no bars in its preview |

Where the bars sit: on the upper curve at T = 1.34, 4.8, 7.85, which are rows
1, 9 and 12 of `Book2` E, exactly the endpoints of the two fits stored for
Graph40 plot 1 (`Data='[Graph40]1!1"Nb/Au Hc2 (T)"[1:9]'` and `[9:12]`, the
NLFit operation XML at file offsets 11,692,870 and 14,944,204). The lower
curve's fits store `[9:14]` and `[2:14]`; its bars sit at rows 1(?), 9 and 14,
so that match is only partial at preview resolution. The likeliest reading is
Origin's fit data-range markers (Data Selector), drawn on the fitted layer,
not data. quantized draws neither; nothing is drawn wrong.

COM check: open `Hc2 data.opju`, then
`win -a Graph40; layer -c; loop(i,1,count){type "$(i) %(i,@D) $(layer.plot$(i).type)";}`
(expected: 8 plots, none of type 231/233). Then hide the data markers
(Data > Hide Data Markers, or remove the fit range in the Data Selector) and
re-export with `expGraph type:=png pages:=Graph40`: if the magenta bars
disappear while every curve stays, they are range markers and the item closes
with no decode work; if they stay, run `get -e` on each plot to find the
error dataset Origin draws them from.

## Graph34 (xi_GL vs T): two independent decode gaps

The page has a saved preview (3 scatters: black squares "Nb", red circles
"Nb/Al", blue triangles "Nb/Au", xi_GL 0-70 nm vs T 0-9 K) and is listed in
fidelity `unrecovered_graphs`. Both of the following block it; fixing one
alone produces no figure.

1. **The axis record does not parse.** Graph34 has one layer anchor (file
   offset 11,257,271, length prefix present). Its run-length axis record
   reads, by the chunk grammar of `curve_style_color.opju_style_record`:
   X 0..9 step 2 (round doubles, one value token each, as in Graph33), but Y
   0 .. 6.97e-8 step 2e-8 -- the data are in metres, the axis is labelled in
   nm -- and the two non-round doubles arrive as ONE 16-byte literal
   (`87 10 b3 7a ea 05 5d ca 72 3e 3a 8c 30 e2 8e 79 55 3e`). The
   `opju_axis_real_form` parser expects a separate value token per double, so
   every separator pass fails and the layer is skipped (`continue`, fail
   closed). The tick labels' x1e9 display factor is a second, undecoded field.
2. **Its plot ids are not in the column-id table.** The three tokens name
   ids 1774 (symbol 2, palette red), 1775 (symbol 3, palette blue) and 1777
   (symbol 1, palette black) with X ids 1773 / 1776. The id table jumps from
   1766 (`Book2` Z) to 1814 (`Book2` A): no record carries 1767-1813. The
   data are imported: `Book4` ("Nb/Al xi", "Nb/Au xi") and `Book5` ("B")
   hold the xi values (1.3e-8 .. 6.5e-8 m), consistent with
   1773-1775 = `Book4` A-C and 1776-1777 = `Book5` A-B, but that mapping is
   an inference (order + legend), not a decoded binding.

The colours of the three tokens (310 = `FF`) already decode; only the
binding and axis are missing.

COM check: `win -a Graph34; layer -c; loop(i,1,count){type "$(i) %(i,@D) %(i,@X)";}`
(expected `Book4_B` / `Book4_C` / `Book5_B` against `Book4_A` / `Book5_A`),
`type "$(layer.y.from) $(layer.y.to) $(layer.y.inc)"` (expected 0, 6.97e-8,
2e-8) and the Y tick-label factor (`layer.y.label.divideby` or the
Tick Labels > Display "Divide by" setting; expected 1e-9). With that, a
specimen that plots a column of 1e-8-scale values against a 0..9 X in a new
project and saves it gives the controlled axis record to extend the parser
against.
