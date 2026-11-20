# Origin decode ledger

One running document for the Origin import (`.opj` / `.opju`): what is
proven, what we decided, what broke and how it was fixed. Created 2026-11-20
on `origin/main` 30b44058 (after #782). It summarises and links; the byte-level
evidence lives in the linked docs and is not duplicated here. Where this file
and a linked doc disagree, the code and its test win, and this file gets fixed.

Path conventions: tests are under `tests/` unless prefixed `frontend/src/`.
`file::test` names a test function. Docs are in `docs/origin_re/` unless
prefixed. "Corpus" means the local-only `../test-data/origin` projects;
`realdata` tests compute their expectations at run time and skip without it.
"COM" means Origin 2026b queried through COM/LabTalk.

## 1. Rules

1. Read this ledger before changing any Origin decode, binding or apply code
   (`io/origin_project/`, `frontend/src/lib/origin*`, `frontend/src/store/originApply*`).
2. Every fix, regression or newly proven fact adds an entry here in the same PR
   (a fact in section 2, a rule in 3, a regression in 4, a line in 5).
3. Every "proven" fact names its guarding test. A fact with no test is marked
   **UNGUARDED** and is not to be relied on as a contract.
4. Never weaken a guard to make a change pass. If a guard is wrong, prove it
   wrong with new evidence, change it, and say so in section 4.
5. Evidence bar (from CLAUDE.md): controlled specimen, independent
   Origin/COM/rendered oracle, plausible whole-corpus distribution, positive
   and negative controls. Synthetic tests lock proven behaviour; they cannot
   establish it.
6. Fail closed: an undecoded or unproven field is omitted and diagnosed, never
   guessed or coerced to a default.

Evidence column legend: **SPEC** controlled specimen, **COM** Origin COM/LabTalk
oracle, **PREV** Origin-rendered image (saved page preview or owner export),
**DIST** corpus distribution, **NEG** negative control, **3P** third-party
paired file.

## 2. Proven decode facts

IDs are stable; never renumber. `R-nn` points to section 4.

### 2.1 `.opju` page and window records

| ID | Field / offset | Meaning | Evidence | Doc | Guard |
|---|---|---|---|---|---|
| F-001 | page header `<type>` | LEB128 varint (2-byte form past the 127th window); continuation byte `01-7f`. Reading one byte hid every later window and put its anchors on the previous page | COM axis_ranges, 23 files: phantom layers 2 to 0 | `../../plans/ORIGIN_FILE_DECODE_PLAN.md` item 64-66, R-16 | `test_io_origin_opju_page_attribution.py::test_page_header_varint_type_enumerates` |
| F-002 | layer number | the anchor's ordinal within its graph page, decoded or not; an undecodable layer leaves a gap | COM 1,426 pages | plan item 66, R-17 | `test_io_origin_opju_page_attribution.py::test_undecodable_layer_leaves_a_gap_not_a_shift` |
| F-003 | separator 5th byte | `00 40 80 88 c0` COM-confirmed; `01 08 30 41 48` admitted after 23/23 exact vs COM; other values stay unrecovered | COM 23/23 | plan item 66 | `test_io_origin_opju_page_attribution.py::test_confirmed_separator_flags_decode`, `::test_unconfirmed_separator_flags_stay_unrecovered` |
| F-004 | embedded workbook graph header | inside a workbook span: `<namelen+2> 00 00 <name> <trail >= 80>` then `0c` (or `c1`); name 2+ chars, not a project page. 243/243 oracle pages, 0 extras | COM + NEG (1-char names) | `opju_embedded_graphs.md` | `test_io_origin_opju_embedded_graphs.py::test_embedded_header_gates_fail_closed`, `::test_embedded_headers_inside_a_workbook_are_found` |
| F-005 | `Residual*` NLFit report graph | header `fb 0a 80 01`: lives inside its host workbook, must NOT open a new page span (else the host's later columns are attributed to `Residual<N>`) | COM: 3 phantom curves | plan item 69, R-24 | `test_io_origin_opju_token_x.py::test_embedded_header_needs_both_gates`, `::test_embedded_header_does_not_steal_the_host_books_columns` |
| F-006 | id-table-less streams | with no column-id table, a page whose span holds `_cart_object` is a graph page (layers decode but were unnamed) | COM 9/9 | `opju_embedded_graphs.md` | `test_io_origin_opju_embedded_graphs.py::test_id_table_less_stream_names_its_cart_pages` |
| F-007 | page census | a page counts as recovered only when a layer is IMPORTED; fully filtered pages are reported with their saved preview | COM: 759 pages all accounted | `opju_embedded_graphs.md` | `test_io_origin_opju_embedded_graphs.py::test_manifest_reports_filtered_pages_and_embedded_graphs` |
| F-008 | saved page preview | exactly one PNG that begins and ends inside the page's span, CRCs valid, graph page owns no worksheet columns; stored as original bytes | DIST 64/64 layers, 0 ambiguous | `saved_graph_previews.md` | `test_io_origin_graph_preview.py::test_exact_page_preview_preserves_original_png_bytes`, `::test_workbook_thumbnail_is_never_attached_to_a_graph`, `::test_multiple_page_images_stay_diagnostic_only` |
| F-009 | `.opj` has no previews | no PNG signatures in the CPYA corpus; icon/EMF/DIB records are not previews | DIST | `saved_graph_previews.md` | UNGUARDED (negative census, no test) |
| F-010 | Data Connector book | a book whose page names `CSV_Connector`/`Excel_Connector` and whose every dataset header is 1 allocated / 0 used rows was saved WITHOUT its data (83 of 87 connector books carry data = NEG). Loss `data_not_saved`; its curves are omitted, never drawn | PREV + DIST | `opju_no_worksheet_data.md` | `test_io_origin_opju_no_data.py::test_curves_of_an_unsaved_book_are_omitted_with_reason_and_caption`, `::test_corpus_connector_books_are_unsaved_exactly_when_their_cells_are_absent` (realdata) |
| F-011 | graph-only project | no dataset header at all (pasted raster): imports its graph page and saved preview only; any unread record makes the import raise instead | PREV | `opju_no_worksheet_data.md` | `test_io_origin_opju_no_data.py::test_any_record_found_but_not_read_blocks_the_placeholder_import`, `::test_corpus_projects_without_any_dataset_import_their_graphs` (realdata) |
| F-012 | non-project files | LFS pointer stub, text file, empty file, swapped container are named as such, not "bad header" | DIST (5 files) | `opju_no_worksheet_data.md` | `test_io_origin_not_a_project.py::test_git_lfs_pointer_says_fetch_with_git_lfs`, `::test_other_origin_container_under_wrong_extension` |

### 2.2 `.opju` / `.opj` graph-layer record (axes)

| ID | Field / offset | Meaning | Evidence | Doc | Guard |
|---|---|---|---|---|---|
| F-020 | anchor `03 00 00 1f` (or `5f`), record-length prefixed | the FIRST sparse chunk of the `.opj` layer block. Expanded with CPYUA grammar (`01-7f` n literals, `80-bf` (t-0x80+3) zeros, `c0-ff <b>` (t-0xc0+3) repeats) the fields sit at the `.opj` offsets | COM 252 new + 9 changed layers agree (rel 1e-6); 2,934/2,937 agree with older readers; 0/222 coincidental anchors accepted | `opju_layer_record.md` | `test_io_origin_opju_layer_record.py::test_grammar_tokens`, `::test_layer_record_fields`, `::test_layer_record_fails_closed` |
| F-021 | layer block 15 / 23 / 31 | X from / to / step (f64) | as above | `opju_layer_record.md` | `test_io_origin_opju_layer_record.py::test_layer_record_fields` |
| F-022 | layer block 58 / 66 / 74 | Y from / to / step (f64) | as above | same | same |
| F-023 | layer block 55 (X scale), 98 (Y scale) | u16 scale: `01 00` linear, `08 01` log10, `04 01` log10 (byte 99 is the log flag; `04 01` only in falcon-sqh `figures.opju`, 9/9 COM `layer.y.type`) | COM | `opju_layer_record.md`, `opju_embedded_graphs.md` | `test_io_origin_opju_layer_record.py::test_layer_record_fields` (parametrized, incl. `04 01`) |
| F-024 | scale fields `80 e9`, `02 00`, others | not admitted (fail closed); `80 e9` is on workbook pages only | DIST | `opju_layer_record.md` | `test_io_origin_opju_layer_record.py::test_layer_record_fails_closed` |
| F-025 | graph pages only | fixed-offset layer records are read on GRAPH pages (and id-table-less streams), never on workbook pages: their X spans the ROW count while the curve reader binds the book's X column (44 bogus unnamed figures, R-05) | DIST (owner corpus) | `opju_layer_record.md` | `test_io_origin_opju_layer_record.py::test_record_on_a_workbook_page_is_not_read` |
| F-026 | axis record zero slot | the record is run-length compressed; an elided zero rides in the step run; specimen step tag is not a step | COM 1,777 to 1,784 matches, 7 to 0 wrong | `validation_log.md` (2026-11-15 axis spans) | `test_io_origin_opju_zero_slot.py::test_zero_to_rides_in_the_step_run`, `::test_partial_surplus_fails_closed` |
| F-027 | `.opj` layer block, same offsets | `.opj` layer-continuation payload uses the identical offsets (`_y_scale_flag` `01 00`/`08 01`) | 3P + DIST | `../origin_project_format.md` 6.1 | UNGUARDED for the `.opj` reader itself (only the `.opju` reuse is tested) |
| F-028 | `.opj` window head `0x47` | `3dband-origin.opj` Graph2: unknown layer head is reported by name, not dropped | DIST | `opju_layer_record.md` | `test_io_origin_opj_graph_windows.py::test_graph_window_with_an_unknown_layer_head_is_reported_by_name` |
| F-087 | layer block 104, bit `0x40` (read only when the record authenticates and bytes 100-101 are `00 10`) | X/Y axes exchanged: Origin's horizontal bar layout. A turned layer's one bar/column plot of a one-layer page is drawn sideways; everything else in it is left out; a 215 in an upright layer is a column | DIST 21 layers (both corpora), all sideways in PREV; NEG every other 215 layer upright (`SOP_meas` Graph67, `Graph_Template`/`Graphs` Graph1). Owner COM check open | `plot_kinds.md` (Lane P2), `opju_layer_record.py` | `test_io_origin_opju_layer_record.py::test_layer_flags`, `::test_layer_flags_fail_closed`; `test_io_origin_opju_bar_kinds.py::test_the_layer_not_the_plot_type_turns_the_bars`, `::test_realdata_bar_orientation_is_the_layers` |
| F-088 | layer block 187, bit `0x02` (same gate as F-087) | stack normalised to 100 %: a 213 layer is the Stat Stage `percent` layout; the `StackColP`/`StackColumn` template is only the fallback | DIST 3 layers (`fig_6_a` Graph2/3, `Fig_3` Graph2 L2), all 0..100 % in PREV; NEG clear on every plain stack (Etna Graph17/19, `SOP_meas` Graph20, `Graph_Template` 32New L4). Owner COM check open | `plot_kinds.md` (Lane P2) | `test_io_origin_opju_bar_kinds.py::test_stacked_columns_follow_the_layers_100_percent_flag`, `::test_realdata_grouped_stacked_and_pie` |

### 2.3 `.opju` column / dataset records

| ID | Field / offset | Meaning | Evidence | Doc | Guard |
|---|---|---|---|---|---|
| F-030 | column record offset 17 | designation code (LabTalk types 4 1 3 5 6 7 2 8 9 store 3 0 2 4 5 6 1 7 8). The marker bytes at 37-38 do NOT name the designation (`30 61` is Y-error OR X-error, `20 61` label OR Z, `21 41` disregard) | COM 458 designations, 0 right-to-wrong | plan "#72", `validation_log.md` | `test_io_origin_opju_designations.py::test_every_marker_reads_its_record_code`, `::test_unproven_ambiguous_marker_has_no_designation` |
| F-031 | column record offset 18 | short name; labels bind to the record BY NAME inside the book's own window span, never by position | COM 26,299 columns: wrong labels 781 to 0 | plan "#73" | `test_io_origin_opju_label_binding.py::test_marker_bytes_in_label_text_shift_the_positional_reading`, `::test_labels_bind_to_their_column_record_by_name` |
| F-032 | id chunk `80 <len>` | a literal run of 1-10 bytes (not a field width); `81 <len>` is the zero-low-byte form. ONE decoder for id table, curve tokens, sheet segments | COM 477/485 identical, 0 different | plan "#68/#71" | `test_io_origin_opju_id_chunks.py::test_token_id_reads_every_chunk_length`, `::test_chunk_id_zero_low_byte_and_lengths` |
| F-033 | id with LOW byte 0 | written `81 02 <hi>` in column records and `81 0[12] <hi>` in tokens; unread, 107 records were missing and broke rank alignment | COM 158 plots | plan "#67 slice 2" | `test_io_origin_opju_zero_low_segments.py::test_zero_low_column_record_enters_the_id_table`, `::test_zero_low_curve_token_is_decoded` |
| F-034 | dataset header `0x19`/`0x21`, `0x1D` | allocated rows / used rows, and the column's display begin row (rows above it are missing) | COM 7,364/7,364 columns | plan "#68/#71" | `test_io_origin_opju_id_chunks.py::test_rows_above_the_begin_row_are_missing`, `::test_begin_zero_and_past_the_end` |
| F-035 | curve id to sheet | a token's id resolves to (book, column) with NO sheet; the k-th smallest id of a name is its k-th dataset (`Book_Col@N`); unknown stays omitted. Signals H (header ref) and P (X partner) place the rest only when they agree | COM 495/498 re-bound curves identical | plan "`.opju` curves bind the sheet they plot" | `test_io_origin_opju_curve_sheets.py::test_same_column_of_two_sheets_keeps_both`, `test_io_origin_opju_sheet_signals.py::test_disagreeing_signals_prove_nothing` |
| F-036 | book renamed by case only | names matched case-insensitively (as Origin); a sheet held under both spellings proves nothing | PREV + window names + COM note | `validation_log.md` 2026-11-20 | `test_io_origin_opju_curve_sheets.py::test_off_sheet_ids_folds_a_book_renamed_by_case`, `::test_a_curve_of_a_case_renamed_book_binds_its_datasets_spelling` |
| F-037 | loose datasets | datasets no window owns are not books | COM | plan #707 | `test_io_origin_opju_loose_books.py::test_loose_books_are_the_books_no_window_owns` |
| F-038 | Numeric-format columns | decoded from the fixed record; codes match LabTalk types | COM | plan #704 | `test_io_origin_opju_numeric_columns.py::test_fixed_record_reads_a_numeric_column`, `::test_codes_match_labtalk_types` |
| F-039 | worksheet data filter `__STGCOLFILTER` | a book storing a filter: its curves are omitted (`worksheet_filter`), Origin plots only the kept rows | COM: 13/14 drew more rows than Origin | plan "#67/#68 slice" | UNGUARDED (no test names `worksheet_filter`) |

### 2.4 `.opju` curve record (519-byte record, sparse token form; the `.opj` anchor is the same record)

| ID | Field / offset | Meaning | Evidence | Doc | Guard |
|---|---|---|---|---|---|
| F-040 | 4-5 | plotted (Y) column id (for an error-bar plot, the ERROR column's id) | COM plot lists | `error_bars.md` | `test_io_origin_opju_token_x.py::test_token_x_outcomes` |
| F-041 | 35-36 (X field) | the plot's X column id; for an error-bar plot it is the id of the column the bars DECORATE. X id 0 = no column (omit), unknown id / other book also omit | COM: 380 wrong-X to 0 | plan item 70 | `test_io_origin_opju_token_x.py::test_token_x_id_reads_offset_35_and_requires_the_marker`, `::test_curve_binds_the_tokens_x_not_the_designated_partner`, `::test_curve_with_no_x_column_is_omitted_not_drawn_against_a_column` |
| F-042 | 37-38 pair | `21 61` shown, `21 21` hidden; error-bar plots `30 61` / `30 21` (`10 60` on a non-Text&Numeric column) | SPEC + PREV + DIST | `curve_visibility.md` | `test_io_origin_opju_token_x.py::test_token_hidden_reads_offset_38`, `test_io_origin_error_bars.py::test_a_y_error_plot_names_the_curve_it_decorates` |
| F-043 | **offset 38 byte `21`, partner at 37 in {`21`,`30`}** | plot HIDDEN. Same 15 plots in `hc2convert.opj` (shown) vs `Hc2 data.opju` (hidden) differ at 38 only; 86 shared shown plots never. Other values (`60`, `01`, partner `00`/`61`) are not read | SPEC + PREV (12+ projects) + NEG (0 of 428 COM-built records) | `curve_visibility.md` | `test_io_origin_opju_token_x.py::test_token_hidden_reads_offset_38`, `::test_hidden_plot_is_left_out_and_diagnosed_not_dropped`, `::test_realdata_hc2_hidden_raw_lockin_plots_are_left_out` |
| F-044 | hidden is not a COM list property | COM `layer.plot` lists HIDDEN plots; it is a binding oracle, never a visibility oracle | COM | `curve_visibility.md` | n/a (method note) |
| F-045 | 7 / 11 | plotted row range; a curve that leaves out a filled row is omitted `plot_row_range` | COM: 10 curves drew rows Origin does not | plan "#68/#71" | `test_io_origin_opju_id_chunks.py::test_plot_row_range_reads_offsets_7_and_11`, `::test_realdata_partial_plot_range_is_omitted` |
| F-046 | 17 (connect) | ONLY value 11 (`layer.plotN.line.connect` 7, step horizontal) is read, to withhold the straight line style and set step. Values 0/1/8/12/97 are NOT read (byte-17 `connect=segment2` is forbidden, R-01) | COM 69 shared records (candidate only), SPEC 39 step curves | `curve_axis_fidelity.md` | `test_io_origin_opju_numeric_columns.py::test_step_connect_withholds_the_line_style`, `test_io_origin_curve_style.py::test_connect_byte_17_never_reaches_the_style` |
| F-047 | 21 / 25 | u16/500 = line width pt / symbol size pt (92/92 COM exact) | COM | `curve_axis_fidelity.md` | `test_io_origin_curve_style.py::test_style_fields_line_width_and_symbol_size_are_1_500_pt` |
| F-048 | 23 (data curve) | style flags; > 0 means a symbol plot (gates colour reads) | COM style oracle | `curve_colors.md` | `test_io_origin_curve_style.py::test_style_fields_symbol_plot_reads_symbol_color`, `::test_style_fields_line_plot_reads_line_color` |
| F-049 | 76 = plot type | equals Origin `DataPlot::GetPlotType()` on every plot of 231 built specimens. Map below (2.7) | COM 231 specimens | `curve_axis_fidelity.md`, plot-type plan | `test_plot_corpus_import_floor.py` (realdata); synthetic: `test_io_origin_opju_plot_kinds.py::test_area_plot_type`, `test_io_origin_opju_numeric_columns.py::test_error_bar_plot_is_not_a_curve` |
| F-050 | 302-305 | symbol FILL colour (ocolor u32): `F7 FF FF FF` auto, `FC FF FF FF` (-4) on restyled symbols, explicit RGB on e.g. bubbles | SPEC (Hc2 Graph1 vs 12) + PREV | `curve_colors.md` | `test_io_origin_curve_style.py::test_style_fields_restyled_symbol_reads_through_byte_310` |
| F-051 | 306-309 | symbol EDGE colour = the plot colour COM reports; palette index (type 0, 0-based on disk) / `01 BB GG RR` / auto | COM style oracle + PREV | `curve_colors.md` | `test_io_origin_curve_style.py::test_ocolor_type1_is_colorref_bgr`, `::test_ocolor_palette_is_one_based_classic_table`, `::test_realdata_curve_style_matches_oracle` |
| F-052 | **310 is NOT a terminator** | `FF` on default records, 25/30/40/50/60 on user-restyled symbols (meaning unproven, maybe edge thickness %). Colour is read when 310 is `FF` OR the fill at 302 is a sentinel (`auto`/-4) AND byte 23 > 0. Explicit fill with non-`FF` 310 (bubbles) stays uncoloured | SPEC (Graph27 vs 29 differ at 310 only) + PREV 6/6 pages + NEG (bubbles) | `curve_colors.md`, R-04 | `test_io_origin_curve_style.py::test_style_fields_restyled_symbol_reads_through_byte_310`, `::test_style_fields_fail_closed_gates` |
| F-053 | 362 | line colour. An `auto` symbol colour (306) on a symbol plot follows an EXPLICIT line colour at 362 (palette type 0 or RGB type 1); placeholder `0x81010151` / auto yields none | PREV 657/660 hue checks; owner exports pixel-exact | `curve_colors.md` | `test_io_origin_curve_style.py::test_auto_symbol_colour_follows_an_explicit_line_colour` |
| F-055 | modifier block `SYSTEM 03 00 ce 02 01 d0 02 06 <n>` + `"<desig>\|<dataset>"` | bubble size (desig 9) / colour-map (18) column; read only when the dataset is a column of the curve's own sheet and symbol size u16@25 = 101; colour MAP only when @306 = `0x00400065`. Everything else fails closed | COM `GetModifiers` all specimens; 20/21 real | `ORIGIN_PLOT_TYPE_PARITY_PLAN.md` item 7 | `test_io_origin_opju_plot_kinds.py::test_modifier_block_entries`, `::test_unproven_modifiers_leave_the_curve_alone` |
| F-056 | graph page header record offset 61 (63 in one file) | template name, NUL-terminated, cut to 9 chars (`Line`, `OffsetSta`, `Polar`, `bubble`, `colormapp`): the only signal for polar / offset-stacked / bubble layers; sufficient, not necessary | SPEC 23 | `opju_layer_kind.py` docstring | `test_io_origin_opju_numeric_columns.py::test_page_template_names_the_layer_kind`, `::test_layer_kinds_omit_or_note` |
| F-057 | rowless box / histogram | byte 76 206 / 219 with X id 0 keeps the curve from Y alone; a box kind comes from the page template; only a SINGLE column series keeps bars | COM | `opju_stat_plots.py` | `test_io_origin_opju_stat_plots.py::test_rowless_kind_is_box_or_histogram_with_no_x_column`, `::test_only_a_single_column_series_keeps_its_bars` |
| F-058 | matrix / XYZ / ternary plots | 105/226/220 name the matrix book's own column record; 243 is Z with offset-35 chain Y then X; ternary template scatter binds (A,B,C)=(X,Y,Z); only when that plot is the layer's ONLY token | COM `GetRangeString` | `opju_map_plots.py` | `test_io_origin_opju_map_plots.py::test_a_matrix_plot_binds_its_one_matrix_book`, `::test_an_xyz_contour_binds_z_its_y_and_that_ys_x`, `::test_fails_closed` |

### 2.5 Error-bar records

| ID | Field / offset | Meaning | Evidence | Doc | Guard |
|---|---|---|---|---|---|
| F-060 | byte 76 `0xe7` / `0xe9` | Origin plot 231 (Y error) / 233 (X error): an error-bar plot is its own DataPlot, never a curve. Axis is decided by offset-23 bit `0x10`, NOT byte 76 (12 `0xe7` tokens Origin reads as 233) | COM sweep | `error_bars.md` | `test_io_origin_opju_numeric_columns.py::test_error_bar_plot_is_not_a_curve`, `test_io_origin_error_bars.py::test_bit_0x10_of_offset_23_is_an_x_error_plot` |
| F-061 | **offsets 35-36** | id of the DECORATED curve's column (plot order is not the binding: the error plot may come before, after, or several plots away). 3,214 of 3,654 name exactly one same-layer curve, none names two | PREV + COM plot lists (Fixed Lambdas, UnpolPlots, MnN Graph10) | `error_bars.md` | `test_io_origin_error_bars.py::test_a_y_error_plot_names_the_curve_it_decorates`, `::test_the_link_goes_to_the_one_kept_curve_with_that_id`, `::test_realdata_bars_attach_where_origin_plots_them` |
| F-062 | **offset 23 direction bits** | `1` plus, `2` minus, `3` both; bit `0x10` = X-error plot. Halves proven by author column names (14/14) + preview extents | PREV + 3P names | `error_bars.md` | `test_io_origin_error_bars.py::test_bit_0x10_of_offset_23_is_an_x_error_plot`, `::test_realdata_direction_halves_match_the_bound_columns_long_names` |
| F-063 | hidden / odd pairs | `30 21` (hidden), `10 40`, any other offset-23 value never link | NEG (Fig3_e Graph1 preview draws no bars) | `error_bars.md` | `test_io_origin_error_bars.py::test_anything_else_is_not_linked` |
| F-064 | what attaches | `yErr` is set only for ONE both-ways Y plot, or a plus + minus pair holding equal values; asymmetric halves, two both-ways plots, X-error and unlinked plots stay left out as `error_bar_plot` | DIST 1,845 attached | `error_bars.md` | `test_io_origin_error_bars.py::test_a_both_ways_plot_draws_its_bars_on_the_curve`, `::test_a_plus_and_minus_pair_draws_only_when_the_halves_are_equal`, `::test_anything_unproven_stays_left_out` |
| F-065 | `.opj` anchor error plots | same record: left out (no phantom "dSA" line), legend renumbered, linked the same way | PREV (MnN Graph10 export) | `error_bars.md` | `test_io_origin_error_bars.py::test_opj_error_plot_is_left_out_and_linked`, `::test_opj_figure_drops_the_error_plot_caption_and_renumbers` |
| F-066 | **offset 28** | owner-reported this session as the error BAND flag (filled band vs whiskers). NOT FOUND in code or docs on origin/main (grep: 0 hits). Bar/band look, cap and colour are not decoded; we draw plain whiskers in the curve colour | none recorded | `error_bars.md` "What is drawn" | **UNGUARDED** (not implemented; record evidence before use) |

### 2.6 `.opj` records

| ID | Field / offset | Meaning | Evidence | Doc | Guard |
|---|---|---|---|---|---|
| F-070 | column block short name at `0x12` | **12 bytes** (11 chars + NUL); `0x1E` starts a separate u16. An 8-byte window dropped every 8-11 char name (`averages`, `difference`) and their curves | COM XMCD 166 to 244 of 245; distribution lengths 1-11 only | `curve_bindings_opj.md`, `multi_layer_pages.md` B1a | `test_io_origin_opj_curve_record.py::test_short_names_up_to_eleven_chars_bind`, `::test_a_name_past_the_field_is_not_a_column`, `::test_realdata_xmcd_every_drawn_or_hidden_plot_matches_com` |
| F-071 | **curve anchor 35-38** | the plot's own X column id + pair `21 61` (same as `.opju` F-041). Overrides the nearest-preceding-X inference; fail-closed reasons `x_not_a_column` / `x_column_unknown` / `x_other_book`; histogram/box with X 0 keeps its shipped binding. Such curves carry `xRecorded` | SPEC (hc2convert vs Hc2 data: 89/89 agree) + PREV (Moke Book4 `E = -A`, Graph8 export) | `curve_bindings_opj.md` section 2 | `test_io_origin_opj_curve_record.py::test_record_x_outranks_the_nearest_preceding_x`, `::test_record_x_without_its_marker_keeps_the_inference`, `::test_record_x_naming_no_known_column_fails_closed`, `::test_realdata_hc2convert_record_x_matches_the_opju_save` |
| F-072 | anchor offset 38 `21` | hidden plot, same as `.opju` (25 `.opj` plots; XMCD Fe/Mn/Co-EY and SuperlatticeFits Graph10 exports confirm) | PREV | `curve_bindings_opj.md` section 3 | `test_io_origin_opj_curve_record.py::test_hidden_plot_is_left_out_as_hidden_in_origin` |
| F-073 | unresolved column id | a real plot (anchor + DataPlot) whose id resolves to no column is omitted `column_not_resolved` / `x_not_resolved`, keeps its plot index (legend captions, colour increments) | DIST | `curve_bindings_opj.md` section 1 | `test_io_origin_opj_curve_record.py::test_unresolved_plot_is_diagnosed_and_keeps_its_plot_index` |
| F-074 | text X column | a designated-X TEXT (category) column gives `.time` = 1..N (Origin puts row r at x = r + 1). Numeric undecoded X keeps the 0-based placeholder | DIST 59 layers, none starts at or below 0 | `curve_axis_fidelity.md` A1b | `test_io_origin_opj_typed.py::test_all_text_book_keeps_its_cells_labels_units_and_comments` (asserts `.time == [1,2,3]`) |
| F-075 | windows section | window label starts at the end of the 195-byte header region; property blocks 482-519 bytes; `0x25-0x26` are type bytes | 3P + COM | `opj_windows_section.md`, `../origin_project_format.md` 4.1 | `test_io_origin_opj_typed.py` (header-driven decode) |

### 2.7 Plot-type byte (record offset 76) to quantized kind

Origin plot type N is stored as byte `N`; line connect is NOT a plot type. COM
readback is Origin C `DataPlot::GetPlotType()` (no LabTalk property exists).

| Byte (type) | Origin | quantized | Notes |
|---|---|---|---|
| `0xc8` (200) | line | line | also polar / offset-stacked: the PAGE TEMPLATE decides (F-056); step = byte 17 = 11 |
| `0xc9` (201) | scatter | scatter | also bubble / colour-mapped (F-055), ternary (F-058) |
| `0xca` (202) | line + symbol | line + symbol | double-Y = two layers of 202 |
| `0xcb` (203) | column | column bars | only for a single column series |
| `0xcc` (204) | area | `fill: under` | fills to Y=0, not to the axis |
| `0xce` (206) | box / violin / strip | box kinds | template decides; strip colour mismatch pre-existing (plan item 76) |
| `0xdb` (219) | histogram | histogram | rowless only |
| `0x69` / `0xe2` / `0xdc` (105/226/220) | heatmap / contour / image (matrix) | map | F-058 |
| `0xf3` (243) | contour (XYZ) | map | F-058 |
| `0xe7` / `0xe9` (231/233) | Y / X error | never a curve | F-060 |
| `0xd5-0xd8` (213-216), `0xd6` | stacked column/area, bar | NOT drawn | bar fills (COM `#FDC897`) mispainted, plan item 76 |

Guards: F-049 row. Unlisted codes (207, 208, 232, 241, 249, ...) are unmapped.

### 2.8 Layout, visibility and figure-level facts

| ID | Fact | Evidence | Doc | Guard |
|---|---|---|---|---|
| F-080 | A 2-layer window with coincident decoded frames, one X range and two Y ranges is a double-Y window even across books (one overlay, layer 2 on y2). Undecoded frames keep the panel apply | PREV (Absorption-D3, 20 pages) | `curve_axis_fidelity.md` A8 | `frontend/src/store/originApplyOverlayY2.test.ts` ("pairs a 2-layer window ...", "never merges two panels ...") |
| F-081 | Two layers, same frame and Y range/scale, different linear X: ONE plot, upper curves mapped onto the host X, linear top axis. Which side the axis is drawn on is inferred, not decoded | PREV (Bqqbar Graph2), DIST 1 in 700 | `multi_layer_pages.md` B2 | `frontend/src/store/originApplyLayers.test.ts` ("pairs one frame, one Y range, two X ranges ...", "never pairs ...") |
| F-082 | Stacked windows whose layers each plot several books apply every layer as a panel on its own overlay, only when the layout is trusted | PREV (Fixed Lambdas SI Graph5/6, XMCD GraphT*) | `multi_layer_pages.md` B1b | `frontend/src/store/originApplyLayers.test.ts` ("undo takes the whole panel apply back", "fails closed to the clicked layer's overlay when the frames are undecoded") |
| F-083 | `%(?X)` / `%(?Y)` axis titles resolve from the layer's first curve (Long Name else Short Name + units; `@LL @LU @LC @C`); any other option leaves "" | DIST (x40/x31/x3/x1) | `curve_axis_fidelity.md` A6 | `frontend/src/lib/originAxisTitles.test.ts` ("resolves the @ options Origin defines, and nothing else") |
| F-084 | An overlay carries the figure's own `yErr` as a hidden column after its curve; the figure's binding beats a designation pairing | PREV | `error_bars.md` | `frontend/src/lib/originCurveErrors.test.ts`, `frontend/src/store/originApplyRecordedX.test.ts` ("keeps its Origin error bars") |
| F-085 | Origin lazy source books: an overlay built before the sources load would bake in preview rows; apply preflights full data, latest request wins | tests | `full_data_figure_apply.md` | `frontend/src/store/useApp.test.ts` (lazy source / stale-request cases) |
| F-086 | Hc2 data Graph5 is a tokenless duplicate-window page: reported with its saved preview, never drawn | DIST (owner corpus) | `opju_embedded_graphs.md` | UNGUARDED (owner-corpus only; no named test) |

## 3. Behaviour rules and owner decisions

| ID | Rule | Date / owner | Why | Code / guard |
|---|---|---|---|---|
| B-01 | **Recorded X wins.** When the file records a curve's X (`.opju` token, or `.opj` anchor 35-38) and it decoded, draw against it even where nearest-preceding-X would pick another; route through the per-curve-X overlay (segment-concatenated, row order kept). Nearest-preceding applies only when the file names no X. | owner decision 2026-11-20 (A2) | Etna Graph16, Catchment Graph6 | `lib/originRecordedX.ts`; `frontend/src/store/originApplyRecordedX.test.ts` |
| B-02 | **Inferred-X control.** An X the reader only INFERS (no `xRecorded`) never wins. | 2026-11-20 | early A2 let an inferred `.opj` X win and flipped the Moke Graph8/9 loop | `originApplyRecordedX.test.ts` ("control: an INFERRED X ...") |
| B-03 | A recorded X that did not import is never replaced: the curve is left out with a toast naming it. | 2026-11-20 | fail closed | `originApplyRecordedX.test.ts` ("a recorded X that did not import ..."); `lib/originRecordedXOmissions.test.ts` |
| B-04 | **Fail closed to an EMPTY plot.** A layer that records curves (or omitted curves), none of which resolves, draws empty with a stage note and toast, never every channel. A layer with NO curve evidence keeps the dataset-default view; map/ternary/stat layers are exempt. | 2026-11-20 (A3) | Moke Graph2 drew 11 phantom channels, hc2convert 31-33, Catchment 16 | `frontend/src/store/originApplyFailClosed.test.ts` |
| B-05 | **1 device-px floor on screen lines.** Canvas stroke width is `max(width, 1/devicePixelRatio)`. SCREEN ONLY: the export keeps the pt width (widths are one number: CSS px on canvas, pt in export; Origin's u16/500 widths apply under that rule). | 2026-11-20 (A5), implemented in #779 on owner direction | 0.5 pt lines rasterised at 50% alpha | `frontend/src/lib/uplotSeries.screenWidth.test.ts` |
| B-06 | **Pale colours keep their hue.** `resolveDrawColor` darkens (light canvas) or lightens (dark canvas) a low-contrast CHROMATIC colour instead of swapping it for the theme ink; only near-achromatic colours swap. | 2026-11-20 (A4), implemented in #779 on owner direction | JV-Study Graph1 lost all three series identities (`#00FF00`, `#FFFF80`) | `frontend/src/lib/contrastColor.test.ts` ("darkens a pale saturated colour ...", "two distinct pale colours stay distinct") |
| B-07 | **Multi-X protection.** `X,Y,X,Y,...` worksheets: each Y binds its nearest-preceding X-designated column (or its record X); never the book's first X, never a sorted X union. | CLAUDE.md | hysteresis loops | `frontend/src/store/originApplyMultiX.test.ts`; `tests/test_io_origin_opju_token_x.py::test_curve_binds_the_tokens_x_not_the_designated_partner` |
| B-08 | **Non-monotonic X.** Original row order preserved, full-range paths; any curve-render change must exercise a non-ascending fixture and check interactive/export agreement. | CLAUDE.md | hysteresis loops | `originApplyMultiX.test.ts`; Origin overlay per-curve-X path |
| B-09 | **Byte-17 `connect=segment2` is forbidden.** Origin line / line+symbol curves stay continuous unless specimen + COM + rendered reference + plausible distribution ALL prove another mode. Only 11 (step) is read. | PRs #30/#31 reverted by #32 (2026-07-16) | corpus-wide false positive | F-046; `test_connect_byte_17_never_reaches_the_style` |
| B-10 | **Fail closed on bindings.** An explicitly referenced but undecoded X/Y is omitted and diagnosed; never coerced to time/default X or a similarly named book/column. | CLAUDE.md | multi-X, hidden, `.opj` | `curve_sheet_omitted` reasons; `test_io_origin_opju_curve_sheets.py` |
| B-11 | A plot Origin hides is not a loss: `hidden_in_origin` wins over any other omission reason, data stays imported, Recover names it; a plot another token of the same layer shows stays drawn. | 2026-11-20 | Hc2 Graph3/7/9/15/22/35 | F-043 guards |
| B-12 | Fidelity codes say what was NOT PROVEN: `curve_sheet_unresolved` only for `sheet_unknown`/`x_sheet_unproven`; `error_bar_plots`; `curves_left_out`; never `exact` without an oracle gate. | 2026-11-20 | one code covered everything | `test_io_origin_opju_curve_sheets.py::test_fidelity_names_what_an_omission_did_not_prove` |
| B-13 | Fixed-offset layer records are read on graph pages only. | 2026-11-20 | R-05 | F-025 |
| B-14 | A backend visual decode needs: controlled specimen, independent Origin/COM/rendered oracle, plausible whole-corpus distribution, positive and negative controls, and gallery review (at minimum Moke, PNR, RockingCurve). | CLAUDE.md | 2026-07-13 incident | n/a |
| B-15 | "Send to Origin" (live COM) attaches to the owner's open session and asks first; it never calls `Exit()`/`Quit()`. Oracle and specimen tools dispatch `Origin.Application`, never `ApplicationSI`, and kill only an exact recorded PID. | owner gate 2026-11-15; CLAUDE.md 2026-11-15 | `ApplicationSI` attached to the owner's session | `test_origin_com.py` (no Exit/Quit); `test_plot_corpus_tools.py::test_oracle_tools_never_dispatch_applicationsi_anywhere`, `::test_origin_tools_never_kill_origin_by_image_name` |
| B-16 | Origin graph recovery is ONE pipeline: file bytes, per-curve (book, X, Y) binding, dataset construction, acquisition order, renderer path, axis state. A local field decode is not valid if the final graph is wrong. | CLAUDE.md | 2026-07-13 | n/a |
| B-17 | `.opj` is not given previews: `saved_graph_preview` stays an omission for `.opj`. | plan item 51 | no image evidence | F-009 |

## 4. Regression history: "steps backwards"

Newest cause first within each family. "Guard" is the test that now fails if it
recurs; **NO GUARD** means add one.

| ID | What broke | Introduced | Caught by | Fixed | Guard now |
|---|---|---|---|---|---|
| R-01 | Byte-17 read as `connect=segment2` (two-point segments); corpus-wide false positive broke continuous curves | #30 / #31 (2026-07-16) | corpus review, plan item 52 | reverted by #32 | `test_io_origin_curve_style.py::test_connect_byte_17_never_reaches_the_style` (added with this ledger); `test_step_connect_withholds_the_line_style`. Git history for #30-#32 is squashed away; the record is `curve_axis_fidelity.md` and plan item 52 |
| R-02 | **Phantom hidden curves.** Hc2 Graph3/7/9/15/22/35 drew 6 curves where Origin draws 3: plots the user hid gained a resolvable X | #690 (item 70, 2026-11-15) | visual check against Origin's saved previews (Hc2 disaster) | #769 (offset 38 `21`) | `test_io_origin_opju_token_x.py::test_token_hidden_reads_offset_38`, `::test_realdata_hc2_hidden_raw_lockin_plots_are_left_out`. Note: the COM plot list could not catch it (F-044) |
| R-03 | **Gallery harness broken for 9 days**: it called the removed `addOriginFigures(stem, figures, ids)`, threw on `layer`, so every visual sweep after #643 was invalid; the node process also never exited | #643 (2026-11-13) | #767 investigation | #767 | `frontend/src/test/originHarnessContract.test.ts` (CI: every store action the harness calls exists with compatible arity) |
| R-03b | Earlier harness failure: "25 pre-existing renderer failures" every sweep since 2026-07-25 were PHANTOM; a refactor removed raw `spatialPanels` and the harness kept reading it | `5cdc7303` (2026-07-19) | live-Origin verification campaign | `a8b3970a` (2026-08-21) | `tools/visual/origin_acceptance.test.mjs`, `frontend/src/store/useApp.test.ts` |
| R-03c | Harness `setLeftCollapsed?/setRightCollapsed?` calls were silent no-ops (no such store actions) | #767 | #779 review | #779 (collapse via setState) | **UNGUARDED**: `originHarnessContract.test.ts` checks actions exist, but not the optional-call (`fn?.()`) no-op form |
| R-04 | **Byte 310 read as a terminator**: every restyled symbol plot lost its colour (fidelity `some_curve_colors`), Hc2 Book2/Book3 graphs drew purple/teal/amber | colour gate in `curve_style_color` (pre-#770) | owner review of Hc2 vs Origin previews | #770 | `test_io_origin_curve_style.py::test_style_fields_restyled_symbol_reads_through_byte_310`, `::test_style_fields_fail_closed_gates` |
| R-05 | **44 bogus unnamed workbook-page figures**: the new fixed-offset layer reader also read book-page (embedded) records; their X spans the ROW count while curves bind the book's X column | #775 first draft (2026-11-20) | review of #775 (independent COM + owner corpus: Hc2 data, XAS, UnpolPlots, Fixed Lambdas SI) | #775 (graph-pages-only gate) | `test_io_origin_opju_layer_record.py::test_record_on_a_workbook_page_is_not_read` |
| R-06 | `curve_sheet_unresolved` raised for EVERY omitted curve: 1,951 public figures carried it, only Absorption-D3's 8 were truly unproven; error-bar-only layers (1,772) looked like sheet loss | #690-#693 era codes | #774 audit (item 67) | #774 | `test_io_origin_opju_curve_sheets.py::test_fidelity_names_what_an_omission_did_not_prove` |
| R-07 | **`.opj` 8-byte short-name window**: XMCD Graph11/14/18/21/26/27 and ~24 `GraphT*` pages silently lost 1-2 curves/panels (names 8-11 chars). Found twice (lane D and lane B) | `.opj` curve reader (pre-#780) | visual sweep vs Origin exports (C1, B1a) | #780 (12-byte field), #781 (shared) | `test_io_origin_opj_curve_record.py::test_short_names_up_to_eleven_chars_bind`, `::test_a_name_past_the_field_is_not_a_column` |
| R-08 | **`.opj` nearest-X guess vs recorded X**: the reader inferred X (nearest preceding X column), flipping Moke Graph2/8/9 loops and drawing hc2convert lockin graphs against the text column A. #779's doc said ".opj X inferred, never wins" and an early A2 let inferred X win and mirrored the loop | `.opj` X inference; #779 A2 first cut | Origin export of Moke Graph8 (data check `E = -A`) | #780 (reads offsets 35-38, carries `xRecorded`); #779's ".opj X inferred" wording then corrected in `curve_axis_fidelity.md` | `test_io_origin_opj_curve_record.py::test_record_x_outranks_the_nearest_preceding_x`, `frontend/src/store/originApplyRecordedX.test.ts` ("control: an INFERRED X ...") |
| R-09 | **Multi-panel page export dropped all error bars** (round 2, finding E2 of #778 review). On origin/main 30b44058 `frontend/src/lib/spatialPageExport.ts` builds panel figures with no `error_spans`, and no commit adds them | #778 review | #778 review round 2 | NOT FOUND on origin/main: verify before treating as fixed | **NO GUARD / possibly OPEN**: needs a `spatialPageExport` test asserting `error_spans` per panel with `errKeys` |
| R-10 | **A2 recorded-X conflict dropped the other layers** of a multi-layer window (per-curve-X overlay ran before the double-Y / spatial paths and returned a one-layer overlay) | #779 A2 | #779 review | #779 | `frontend/src/store/originApplyRecordedX.test.ts` ("a multi-layer window keeps its other layers (the double-Y partner is not dropped)") |
| R-11 | **Stacked-window re-apply lost edits without a discard prompt**: the confirm checked only the clicked layer's overlay, but a panel apply rebuilds every layer's overlay | #781 first cut | #781 review | #781 (`origin_overlay_panel` marker) | `frontend/src/store/originApplyLayers.test.ts` ("asks before a re-apply discards edits on ANOTHER layer's overlay"). The legacy clicked-layer-overlay-stays-silent half (marker) is **UNGUARDED** |
| R-12 | Hidden-first curve mislabelled: when two ids collapse to one curve (hidden then shown), the kept curve was reported `hidden_in_origin` and lost its `curve_sheet_unresolved` flag (Absorption-D3 Graph1 layer 2) | #769 first cut | #769 self-review | #769 | `test_io_origin_opju_token_x.py::test_a_shown_duplicate_under_another_id_unhides_the_kept_curve` |
| R-13 | Text (category) X column lost EVERY curve binding and fell back to plotting all channels | the apply's channel selection (pre-#779) | #779 review of the preview oracle | #779 (`figureChannelSelection` default row-index X) | `frontend/src/lib/originFigures.test.ts` ("binds a text (category) X column to the row-index X instead of dropping the curves") |
| R-14 | Real-form axis reader misread 3 ranges and 8 scales (corpus: ExtFig4, heatbudget, optimal_MOI fig5, SOP_meas log Y) | real-form reader (pre-#775) | #775 PREV re-check | #775 layer-record reader first | `test_io_origin_opju_layer_record_corpus.py::test_layer_record_agrees_with_real_form` (realdata) |
| R-15 | `.opju` page headers read as one byte: windows past the 127th vanished, their anchors landed on the previous page (185 phantom layers) | page scan (pre-#676) | COM axis_ranges oracle | #676 | F-001 guard |
| R-16 | Layer numbers counted only DECODED anchors, shifting later layers (SOP_meas wrong 87) | #676 intermediate | COM oracle | #676 | F-002 guard |
| R-17 | Oracle runner killed EVERY Origin started since the run began, closing the owner's window on a later timeout | `run_axis_oracle.py` first cut | review of #676 | #676 (exact PID sidecar) | `test_plot_corpus_tools.py::test_origin_tools_never_kill_origin_by_image_name` (added with this ledger) |
| R-18 | `Origin.ApplicationSI` attaches to the owner's open Origin: an oracle run loaded a corpus project into their window and `Exit()` closed it | oracle tools (2026-11-15) | incident measurement | tools dispatch `Origin.Application`; CLAUDE.md note | `test_plot_corpus_tools.py::test_only_origin_application_is_dispatched` (plot_corpus only) and `::test_oracle_tools_never_dispatch_applicationsi_anywhere` (added; all Origin tool dirs) |
| R-19 | Curves from sheet N drew sheet-1 data (token id carries no sheet); SOP_meas `old`#5 13 curves | `.opju` curve binder | COM per-plot data check | #684 | F-035 guards |
| R-20 | Positional label binding: marker bytes inside label text shifted every later column (designations/long names/units wrong in 781 cases) | `windows_opju` (pre-#706/#709) | COM `wks.col.type`/`lname$` sweep, 26,299 columns | #706, #709 | F-030, F-031 guards |
| R-21 | `Residual*` report pages opened a span, so host columns were attributed to `Residual<N>` (3 phantom curves) | page scan | COM | #690 (item 69) | F-005 guard |
| R-22 | Error-bar plots drawn as lines / as phantom curves (`.opju` pre-#704; `.opj` "dSA" line until #778) | pre-#704, `.opj` reader | owner export of MnN Graph10 | #704, #778 | `test_io_origin_opju_numeric_columns.py::test_error_bar_plot_is_not_a_curve`, F-065 guards |
| R-23 | Header gate rejected valid dataset headers (SuperlatticeFits Book12 lost column C silently); the first fix also relaxed the unproven `0x40-0x47` gate and had to be restored | header-driven reader (#643 era) | #664 review | #664 | `test_io_origin_header_gate.py::test_header_with_byte_0x12_set_is_still_a_header`, `::test_unproven_zero_byte_gate_at_0x40_still_holds` |
| R-24 | Doc/claim drift: format doc 1 still quoted the pre-rework 30.6% `.opj`/`.opju` recall; `curve_visibility.md` said `.opj` hidden not applied until #780; #779 said `.opj` X inferred | various | reviews | superseded notes; #780 | n/a (docs). Rule 2 exists to stop this |
| R-25 | A COM plot list was used as a visibility oracle: it lists hidden plots, so "COM-verified" Hc2 drew 18 extra curves | #690 verification method | #769 | #769 | F-044 (method note); R-02 guard |

## 5. Change log (newest first)

Corpus deltas are "drawn curves" unless stated; "0/0" is lost/changed.

| PR | Date | Summary | Corpus delta |
|---|---|---|---|
| #782 | 2026-11-20 | Tests: five load-sensitive timing tests made robust | n/a |
| #781 | 2026-11-20 | Multi-layer pages: stacked windows keep every panel (B1b); top-X layer draws as one plot (B2); `.opj` 12-byte name field (B1a); re-apply asks before discarding any layer's edits | 65/111 pages identical, 46 changed, all toward Origin; XMCD GraphT* 1 to 3 panels; COM XMCD 166 to 244/245 |
| #780 | 2026-11-20 | `.opj`: curve anchor X (35-38) read, `xRecorded`; full column names; hidden plots left out; auto symbol colour reads line colour; unresolved ids `column_not_resolved` | 89/89 hc2convert X agree; 78 anchors resolve (all XMCD); 657/660 hue checks; XMCD drawn 239 |
| #779 | 2026-11-20 | Rendering vs Origin previews: A1b category X 1-based, A2 recorded X wins, A3 fail-closed empty, A4 hue-keeping contrast, A5 1 px floor, A6 axis-title codes, A8 cross-book double-Y; preview-oracle tools | Etna Graph16, Catchment Graph6, Absorption-D3 20 pages now match |
| #778 | 2026-11-20 | Error-bar plots draw their bars on the curve they decorate (35-36, bits of 23), `.opju` + `.opj` | 1,845 plots / 1,135 public figures attached; owner 149 plots |
| #777 | 2026-11-20 | Account for every graph page Origin lists: embedded graph headers, filtered pages, `04 01` log-Y | oracle pages decoded 1,514 to 1,537; 759 pages all accounted; 0 phantoms |
| #776 | 2026-11-20 | Preview oracle: corpus-wide visual check against Origin's own images (tooling) | n/a |
| #775 | 2026-11-20 | Graph-layer axis records decode as the sparse `.opj` layer block | unrecovered pages 211 to 12; layers 2,991 to 3,347; curves 6,645 to 7,807; 0/0 |
| #774 | 2026-11-20 | Accurate fidelity codes; case-renamed books bind | `curve_sheet_unresolved` 1,951 to 0; +16 curves; 0/0 |
| #773 | 2026-11-20 | Non-project files named; unsaved-connector and graph-only projects open their graphs | 4 more projects import; 5 files named correctly |
| #772 | 2026-11-19 | Library groups unresolved figures under one collapsed node | UI |
| #771 | 2026-11-19 | Import opens the project's first graph | UI |
| #770 | 2026-11-19 | Restyled scatter colours (byte 310); Hc2 Graph40/34 gaps documented | 92 curves gain a colour, 0 change, 0 lose |
| #769 | 2026-11-19 | Plots Origin hides are left out (offset 38 Show bit); fixes phantom curves since #690 | 228 drawn curves leave 58 layers, 0 added |
| #768 | 2026-11-19 | Import polish (loading status, notes inside frame, fit-sheet legend labels) | UI |
| #767 | 2026-11-19 | Gallery harness repaired (broken since #643) + store-contract guard | n/a |
| #746 | 2026-11-16 | Export to Origin: six exporter fixes proven by Origin read-back (`.ogs` multi-curve join, log-axis type, UTF-8 BOM, book title, `.opj` window title, Send-to-Origin designations) | `.ogs` curves 71 to 295 match |
| #715 / #714 / #712 / #711 | 2026-11-15 | `.opju` heatmap/contour/ternary; bubble/colour-mapped/polar; box/violin/strip/histogram/single column; double-Y right layers, area and step | plot-corpus import floor pinned |
| #709 | 2026-11-15 | `.opju` labels bind to their own record by name | wrong labels 781 to 0 |
| #707 | 2026-11-15 | Window-less loose datasets dropped from the library | n/a |
| #706 | 2026-11-15 | `.opju` designations read from the record code | 458 changed, 0 right-to-wrong |
| #704 | 2026-11-15 | Numeric-format columns; error-bar plots not drawn as lines | n/a |
| #699 | 2026-11-15 | Origin plot-type corpus harness | 233 specimens |
| #695 | 2026-11-15 | One sparse id-chunk decoder, plot row ranges, begin rows | +485 curves, 477 COM-identical |
| #694 | 2026-11-15 | Zero-low-byte ids, sheet list | +146 curves, 0 vanished |
| #693 | 2026-11-15 | More curves bind their proven sheet; Recover lists every omitted curve | +828 curves, 816 identical |
| #690 | 2026-11-15 | Curve token's own X (35-36); `Residual*` report pages are not books | 380 wrong-X to 0; caused R-02 |
| #688 | 2026-11-15 | Send to Origin asks before attaching to the open session | n/a |
| #684 / #681 / #682 | 2026-11-15 | Curves bind their sheet (#684); separator flags `01/08/30/41/48` (#681); elided-zero slot and specimen step tag (#682) | COM 495/498; 23/23 exact |
| #676 | 2026-11-15 | Recover `.opju` graph pages against Origin itself (varint page types, ordinals, oracle tooling) | matches 853 to 1,381; phantoms 176 to 16 |
| #664 | 2026-11-14 | Stop dropping valid headers; re-pin #643 realdata tests | 1 of 6,507 headers newly accepted |
| #650 / #648 / #646 | 2026-11-13 | `.opj` horizontal bars, bars/columns/histograms, unrecovered graphs reported; `.opju` matrices as maps | n/a |
| #643 | 2026-11-13 | Header-driven `.opj`/`.opju` decoding, independent graph windows (broke the harness, R-03) | n/a |
| #641 | 2026-11-13 | Designations drive plots, Origin ASCII headers | n/a |
| older | 2026-07 | #25 full-data apply, #26 fidelity manifest, #27 workbook fallback, #28 saved previews, #29 curve fidelity, #30-#32 byte-17 add and revert (R-01), #44-#61 geometry/export/legends/previews. History before #641 is squashed; see the plan's Completed log | n/a |

## 6. Open questions and owner COM checks

Each link goes to a doc section holding the exact COM query.

| Topic | Question | Where |
|---|---|---|
| Hidden plots | Hide/show specimen + `visibility.json` sweep; same sweep over XMCD / SuperlatticeFits / MnN / PNR for `.opj`; PNR Graph25 T++/T-- is a different mechanism | `curve_visibility.md` "The COM check that would settle it", "Not decoded" |
| Colour byte 310 | edge-thickness specimen; sweep Hc2 Graph12/27-32/36-40 and hc2convert Graph12/27-34; group role bytes `0x21 0x20 0x11 0x01 0x00` (Absorption-D3 Graph2ABA plot 1) | `curve_colors.md` "The COM check ...", "Left open" |
| Error bars | asymmetric halves specimen (`layer.plotN.errbar.direction`); which of two both-ways plots Origin draws, band vs whisker (PerceivedRisk Graph29); offset 28 band flag (F-066) | `error_bars.md` "COM checks for the owner" |
| `.opj` bindings | hc2convert Graph13/20-34 X; XMCD Graph25 plot with no anchor; Graph2 (C2) and Graph60 (C3) preview vs data conflicts; UnpolPlots tick `divideby` | `curve_bindings_opj.md` "Not proven here", "Related `.opju` findings" |
| Embedded graphs | sparkline count rule (528 pages); where `Residual*` layers live; scale `02 00` | `opju_embedded_graphs.md` "Still open" |
| Layer record | `opju_column_fixed.expand_record` misreads a zero run followed by a repeat (`87 c3 66`); not changed, worth aligning | `opju_layer_record.md` "The record" |
| Layout | which side the top-X axis is drawn on (`layer2.x2.showAxes`); XMCD GraphT* layer 2/3 Y titles; Bqqbar orange segment | `multi_layer_pages.md` B2, "Not fixed here" |
| Hc2 gaps | Graph40 magenta bars (fit range markers?); Graph34 axis record + plot ids | `hc2_open_gaps.md` |
| No-data projects | open `61 PDOS.opju` with the CSV missing: confirm connector reports the missing source | `opju_no_worksheet_data.md` section 2a |
| Rendering | A4 pale/yellow/green curves and A5 hairlines were decided 2026-11-20 (B-05, B-06); category tick labels still print 1,2,3 where Origin prints text | `curve_axis_fidelity.md` "Not changed" |
| Fidelity | `exact` status needs an oracle gate; `.opj` previews need an independently proven page boundary | `fidelity_manifest.md`, `saved_graph_previews.md` |
| Plot types | codes 234-239, 244, 250-255 input shapes; stacked/bar colour fills (plan item 76) | `../../plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md` "Plot-type codes" |

Background references: `../origin_project_format.md` (authoritative format
reference), `ORIGIN_CONVENTIONS.md` (consolidated conventions index),
`validation_log.md` (dated COM/validation runs), `../../plans/ORIGIN_FILE_DECODE_PLAN.md`
(Completed log), `workbook_graph_builder_fallback.md`, `full_data_figure_apply.md`.
