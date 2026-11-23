# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project does not (yet) commit to Semantic Versioning guarantees pre-1.0.

## [Unreleased]

### Added

- **Out-of-plane strain in the orientation-aware mismatch card** (Calculators ▸ Substrates ▸ Orientation-aware mismatch): after Compare, the card shows the in-plane strain ε∥ the film would have if coherent with the substrate net, the predicted out-of-plane strain ε⊥ = −2ν/(1−ν)·ε∥ and the film c/a. Enter the film's Poisson ratio in the new "film ν" box (0 to under 0.5); no material has a stored value and none is assumed, so with the box empty ε⊥ and c/a show "—" with the reason. They also show "—" with a reason when the strain is not equibiaxial (the two net axes differ by more than 0.1 % strain or the net angles by more than 0.5°) and, for c/a only, when no film cell axis lies along the plane normal (c/a is given for a cubic film on {100}, a tetragonal film on (001) and a hexagonal-axes film on (0001)). Changing any input clears it. Tests: `tests/test_calc_epitaxial_oop.py`, `OrientedMismatchCard.test.tsx`.
- **Miller indices and surface net in the substrate table** (Calculators ▸ Substrates): selecting a substrate now also shows its plane as indices, (h k l) or (h k i l) for hexagonal cells such as sapphire (1 1 -2 0), and the in-plane net computed from them (Si(100) is a 3.8403 × 3.8403 Å square, Si(111) a hexagonal net at 120°). The net needs the Bravais centering, which the substrate table lacks; it is taken only from the phase with the same formula whose lattice parameter agrees within 1 %. Where none does (LSAT, YSZ, MgAl2O4) the indices are shown and the net is left out with the reason; the amorphous SiO2/Si row has no plane. A label that cannot be read as indices is refused. Tests: `tests/test_calc_substrate_orientation.py`, `SubstratesTab.test.tsx`.
- **Reference tests for epitaxial relationships**: perovskite cube-on-cube on the table's SrTiO3, LSAT and LaAlO3 (1:1 match, mismatch from the lattice constants, [100] ∥ [100], no rotation), the Si(111) hexagonal net, swapping film and substrate (f → −f/(1+f)), symmetry-equivalent planes, and integer supercell area ratios (GaN/sapphire, Fe/MgO). Tests only; `tests/test_calc_epitaxial_references.py`.
- **One progress display for batch tools** (Peak analyzer batch, SIMS batch, Batch Figure Builder, Pack project): each now shows the shared determinate bar with its count and, where it has steps, the phase ("Preparing / Fitting 1/2", "Checking / Creating 3/5"); Pack project shows its file count beside bytes copied. Cancel behaves as before and is unchanged in what it keeps: a cancelled Peak batch and a stopped Batch Figure Builder or Pack project write nothing; a SIMS batch stopped while checking creates nothing, and stopped while creating keeps the profiles already created and lists the rest as stopped.
- **"Open in" for Magnetometry Units, Internal field and Curie-Weiss results, and for fit bands**: the result's menu offers "Open in Units / Internal field / Curie–Weiss / Curve Fit". The tool reopens on the result's own worksheet with its settings restored (Units: basis, geometry, sample values and units, output units; Internal field: geometry; Curie-Weiss: response basis, field column, masses and fit range; fit band: level and prediction setting), plots the channels the result was computed on, and shows the "Editing a committed result" banner. "Replace" rewrites the output in one Undo step and keeps its worksheet and result; "Add as a new output" adds another and keeps the old one. A fit band can be replaced only while the live fit is the same fit it was drawn from; for any other fit the commit adds a new output and says why. Results saved before this version cannot be reopened and say so (run the tool again); a result whose source worksheet is gone opens the tool without settings and cannot replace.
- **Kaplan-Meier curve as a worksheet or plot** (Analyze ▸ Statistics ▸ Kaplan-Meier survival): after a run, "Add curve as worksheet" writes time, S(t), 95% CI low/high, at risk and events to a new worksheet, and "Add as plot" also draws it as a step plot in its own window (S(t) with dashed CI steps; with "One curve per group" the worksheet stacks the groups under a group column and the plot splits S(t) by group). Nothing is written until you click. It is one undo step with its Library result, linked to the source worksheet, goes Out of date when the source changes, and a repeat adds nothing (the buttons say it is already added). With no current Kaplan-Meier result, or an out-of-date one, the buttons are disabled with the reason.
- **Pawley batch: Create model worksheets** (Reductions ▸ Pawley ▸ "Batch over selected worksheets"): after a batch, tick the rows you want and press "Create model worksheets" to add each sheet's observed / model / background / residual worksheet (the same output as the single run's "→ Library"). All of them land in one Undo step, each is linked to its source sheet and goes out of date when that sheet changes, a repeat adds nothing, and the batch view stays where it is (the new sheets are not activated). Rows that failed, or whose model was not kept, are shown with the reason and are not offered; a row that cannot be written is listed after the click. The per-sheet parameter table is unchanged.
- **Background estimate over selected worksheets** (Magnetometry ▸ Background ▸ "Batch over selected worksheets"): estimates the background of the same-named column in each selected worksheet against its own X axis and lists the fit (routine, slope, intercept or offset, points used, gap rows) as one table saved to the Result book. Nothing is subtracted and no worksheet is written. Auto-detect reads each worksheet's own axis, and a worksheet whose axis it cannot tell (or that lacks the column, or has under 3 usable rows) is listed with the reason instead of being skipped; an explicit M(T) / M(H) choice applies to every worksheet. Every worksheet row is used, exactly as the single Background fit does, so a batch row equals the single fit for that sheet (excluded rows are not left out). The batch is blocked while the plot X is a data column (it reads each worksheet's own X axis). Changing the data type or a fraction starts a fresh table.
- **Survival analysis in Statistical tests** (Analyze ▸ Statistics): three new tests that read the same analysis rows as the others (excluded and filtered rows left out), show the input line, and save their tables as a result. Old results still reopen.
  - *Kaplan-Meier survival*: pick a time column and a 0/1 event column (1 = event, 0 = censored). Gives the median survival with its 95% confidence interval ("not reached" when the curve stays above 50%), and the curve as a table with 95% intervals and the number at risk and events at each time. Tick "One curve per group" and pick a group column to get one curve and median per group. The curve is shown as a table; it is not drawn or added to a plot.
  - *Log-rank test (groups)*: compares the survival of two or more groups (one group column, up to 12 groups) with one chi-square test and a per-group events table.
  - *Cox proportional hazards*: time, event and one or more predictor columns, with coefficients, hazard ratios (exp of the coefficient), 95% intervals and p-values, plus the concordance and log-likelihood.
  - Refused with the reason, never coerced: negative times, an event column that is not 0/1, data with no events (all censored), a group with no events (Kaplan-Meier), a group with fewer than 2 usable rows, fewer than 2 groups for the log-rank test, a group column with more than 12 values, a Cox model with no predictor, and a Cox fit that lifelines reports as not converged (for example complete separation), which reports no coefficients instead of unreliable ones; small-scale or time-correlated predictors alone are not refused. The median's 95% interval is where the log-log pointwise confidence band crosses 50%.
- **Window layout (preview), opt-in**: View ▸ Window layout (preview), or the same switch in Preferences ▸ Interaction, turns the plot windows and the Style panel (the Inspector) into windows you can dock or float. It is off by default and nothing changes until you turn it on; turning it off brings the classic stage back, and turning it on again restores the same arrangement. What works in this preview: dock a window to the left, right or bottom edge or the centre with the ▣ ◧ ⬓ ◨ buttons on its title bar (pressing the lit button again floats it); several windows on one edge stack along it and several in the centre sit side by side; drag the splitters between regions and windows, or focus one and use the arrow keys; Window ▸ Dock all, Float all and Tile all (also on the window toolbar); a floating plot window moves and resizes like a plot window today; closing Style keeps its place and the Style button on the window toolbar reopens it; F6 and Shift+F6 move focus between the Library and the windows; Ctrl+] (View ▸ Toggle inspector) closes and reopens Style. The stage tabs are hidden while it is on. Drag a window's title bar (docked or floating) onto the left, right or bottom edge or the middle of the desk to dock it: a dashed outline previews where it will land, releasing elsewhere floats a docked window at that point, Escape cancels and puts everything back, and holding Alt while dragging disables docking. Without a mouse, Alt+Shift+M on a focused window starts move mode: arrows move a floating window (Shift: 1 px), L, R, B and C dock it left, right, bottom or centre, F floats it, Enter keeps the result and Escape cancels and restores; a banner shows while it is on. A polite screen-reader announcement says what happened (for example "Graph1 docked right, 2 of 2"). The **Data window** shows the worksheet grid of the focused plot's dataset and changes with the focus; its title bar names the dataset and says whether it is following the plot, following the Library or pinned. The ⚲ pin on its title bar keeps it on the current dataset whatever plot is focused (press it again to follow); Preferences ▸ Interaction ▸ "Data window follows" switches it from the focused plot (the default) to the Library selection. For a multi-dataset graph it shows the graph's sheet with an Input list to switch to any of its source datasets. While it shows the focused plot's dataset, rows selected in it are the plot's selected points and points selected on the plot are selected rows (the grid says "Linked to plot"); any other dataset keeps a selection of its own. If the pinned dataset is deleted, the window says so and offers Unpin instead of showing another dataset. Window ▸ "Plot | Data side by side" (also on the window toolbar and in the command palette) opens the Data window and shares the centre between it and the focused plot, leaving other windows where they are; it has no keyboard shortcut yet (Ctrl+Shift+D is Duplicate Window). The Data button on the window toolbar closes and reopens it. The pin and the follow setting are saved with the project's layout. Not yet: resizing in move mode, and the Worksheet and Map views and the Origin migration review (an action that asks for one says so on the window toolbar and offers to switch back to the classic layout). A project saved while it is on keeps its layout and opens only in this release or later. Also new in both layouts: Ctrl+B (⌘B) hides and shows the Library, like Ctrl+[.
- **Window layout (preview) usability fixes**: turning it on with two or more plot windows docks them together in the centre instead of floating them over Style, and below 1280 px wide everything starts floating (Style against the right edge, below the toolbar, never over it). A plot docked on an edge keeps at least 280 px (the centre shrinks instead), the bottom dock opens taller (320 px) with a compact plot toolbar when short, and a narrow window keeps its title before its "docked left" caption. The last plot window's Close is dimmed and says why when pressed. Closing Style or Data puts keyboard focus on its toolbar button. The move-mode banner and the "view is not in the window layout yet" notice take over the toolbar row (nothing is covered and the desk does not move), and the notice no longer switches Style's sections. A dimmed Plot | Data button explains itself when pressed. Turning the layout on says how to switch back; the toolbar has a "Classic layout" button and the command palette "Switch to the classic layout". Dock buttons are 24 px, the caption and pressed-button colours meet contrast, F6 lands on the title bar, Alt+Shift+M from the Library explains itself, Escape in move mode says "Move mode cancelled", Float all no longer stacks Style over the first plot, the empty-centre hint hides under a floating window, and Tile all leaves Style where it is. In the window layout a collapsed Library (Ctrl+B) leaves a labelled "Library" button on a narrow rail; in both layouts its hidden controls can no longer be tabbed to.
- **Window layout (preview) usability fixes, round 2**: collapsing the Library (Ctrl+B or the title-bar button) no longer squeezes the plot area into a narrow column in either layout (it gives its width to the stage, or leaves the 28 px rail in the window layout). Below 1280 px the first switch-on keeps windows floating (as before), never touching the classic plot sizes or maximized state; Data and Analysis start closed and open floating above the plots. Known issue for the owner: at that width a full-desk floating plot can still sit under the floating Style window. reopening a window that would dock under a plot covering its whole edge floats it instead, so it never opens out of sight. The Data title bar keeps its mode ("following the plot", "pinned") instead of the "docked right" caption, shows a "linked" chip while its row selection is shared with the plot, and its pin names the mode; Data announces what it now shows when the focus, pin or input changes. Pin and Close keep their 24 px size in narrow title bars. Escape out of move mode returns focus to the window's title bar. The switch-on message stays 12 seconds and while the pointer or focus is on it. Splitters are named for the dock and windows they resize and report their size. The Preferences footer no longer says every setting stays on this machine.
- **Window layout (preview): the Analysis window and tool windows**: the window toolbar's **Analysis** button (also Window ▸ Analysis window and the command palette) opens one Analysis window for the focused plot's dataset; the classic Analysis Center and Workflow commands open it too while the window layout is on. It shows the dataset's technique and where it came from (recorded at import, your choice, or not identified, with "Looks like" suggestions from the X axis and units when nothing was recorded); "Treat as" overrides it for the guide, saved on the dataset with the project and undoable (a lazily loaded Origin worksheet loads its full data first), while plot defaults and the Analyze menu keep using the recorded technique. Below that, the five steps Inspect, Clean, Plot, Analyze and Report each say not started, done or out of date (Analyze and Report turn out of date when a saved result's data changed) and why, the next step is highlighted, and clicking a step reopens it (the Data window, the data filter, the saved figure or the figure setup, the latest result, the report). Then every analysis tool, grouped and searchable: a tool that does not fit is greyed out with the same one-line reason the Analyze menu gives, and tools that suit the technique are marked "suggested". Like Data it follows the focused plot and its ⚲ pin keeps it on one dataset; while pinned to a dataset that is not focused, its tools say to focus that dataset's plot rather than run on another. Analysis tools (Curve fit, Peaks, Statistics, …) now open as their own windows, one per tool, at the bottom by default or wherever you last put them: they dock, float, drag, take part in move mode, F6 and the announcements, closing one closes the tool and reopening it puts the window back where it was, and opening an open tool brings it forward. Each follows the focused plot; Curve fit, Peaks and Hysteresis have a ⚲ pin that keeps their input on one dataset (if that dataset is deleted they refuse rather than switch), and while one of them runs it is pinned to its dataset automatically and says so, then follows again. Other tools read the focused plot directly, so their pin is dimmed and says why. The shared input selection holds one tool's input at a time, so a pinned tool loses its pin, with a message, when another tool takes it. Placements, pins and the follow setting are saved with the project's layout; a tool window for a tool this version does not have is dropped when the layout opens, and the status line names it. Escape closes a docked tool as it closes a floating one, and closing a tool gives keyboard focus back to what opened it. While the Quick Figure Builder or Library tiles take over the desk, an open tool shows in its classic floating frame and comes back to its window afterwards, unchanged. The Inspect step opens Data only when Data would show the guided dataset, and says why not otherwise. Classic mode is unchanged: tools open in the side column as before. Not yet: opening an already-open tool from the Analyze menu or the command palette does not bring its window forward (the Analysis window does), a tool open when the layout is first turned on docks at the bottom rather than staying floating, and the Inspect step counts only the Data window, for this session.

### Changed

- **Peak analyzer (wizard) input line**: the line above the steps now says what the wizard fits: rows used of the worksheet's total, its own fit range (an open end shows as start / end), and how many rows with gaps (non-finite values) were dropped; the note beside it keeps the separate counts of excluded and filtered-out rows. When there is nothing to fit (a worksheet still loading, every row excluded, or a fit range holding no finite rows) the line shows the reason instead of disappearing. The rows fitted are unchanged.
- **Replacing a linked output (Curie-Weiss)**: a worksheet that the tool itself linked to its source is no longer treated as hand-edited, so Replace is offered for it, and the link is kept after the replace.
- **Curve fit, Peaks (find, fit, batch, wizard) and the Fit Y by X report now read their input through the same shared resolver as the other analysis tools.** Which rows are analysed is unchanged (excluded and filtered-out rows are left out; where a tool already honoured a reviewed row or X-range selection it still does). What changes is the refusals: a worksheet that is still loading, an explicitly empty row selection, or no rows left after exclusions and filters now stops with the resolver's reason instead of an empty fit (in the Peak wizard the segment is simply not drawn), and a Fit Y by X report requested while a lazy Origin book is loading waits on that load and reports its failure reason.
- **Pawley "→ Library", the reflectivity FFT "→ Library", the Magnetometry background subtraction (M(T) and M(H) paths) and the Hysteresis background subtraction now follow the shared result contract**: each output is ONE Undo step together with its Library result, repeating the same action on the same data adds nothing (the status line says "already added as ...", and the Pawley and reflectivity FFT "→ Library" buttons are disabled with that reason), and the output is marked "Out of date" when its source worksheet changes, recalculated or only marked per Auto / Manual / None. A different setting (channel, cell tie, window, fit fraction) is a new computation. The graph digitizer already skips a repeat Create; it has no source worksheet, so it has no Out of date marking. Reopening these tools from their results ("Open in ...") is not yet available.
- **Magnetometry tools (Background, Units, Internal field, Curie-Weiss), Hysteresis, Baseline and the test chooser now read their input through the same shared resolver as the other analysis tools.** Which rows are analysed is unchanged (Background, Units, Internal field and Baseline use every worksheet row; Curie-Weiss, Hysteresis and the chooser leave out excluded and filtered-out rows; Hysteresis also follows a reviewed row or X-range selection). What changes is the refusals: a worksheet that is still loading, has no rows left, has no usable response, or whose plotted X column no longer exists (it used to fall back to the time column) now stops with the resolver's reason in the tool's own message line (Curie-Weiss used to stop silently when no rows remained), Hysteresis names an X-designated column as the reason it cannot be analysed instead of "No response column", and the test chooser, which waits for a lazy Origin book to load before recommending, now reports the load failure reason.

### Fixed

- **Fit buttons no longer fail silently or send empty data**: Surface fit, Ellipse fit and Optical gap now say so when the worksheet was removed or replaced while its full data loaded, or when no row is finite in every picked column (before, the button did nothing, or an empty series went to the backend). FFT thickness and Reflectivity FFT refuse a scan with blank or non-finite cells and say how many rows (before, a bare 422; dropping the rows is not done, provisional, owner to confirm) and report a vanished worksheet. The Recode mapping table and the Metadata cleanup change table are now marked "Preview (not saved)". Audit: `plans/RESULT_ACCEPTANCE_AUDIT.md` part 2.
- **Every result added to the Library now records its inputs.** A result committed by an "Add … as dataset" button (the shared result contract) now lists, for each input worksheet (up to 32 inputs and 64 channels each, with the true counts), its channels with units, the X label and unit, how many rows were included out of how many (excluded and filtered rows left out), and the X range of the included rows, beside the tool's own settings and version. Test: `store/resultLifecycleContract.test.ts`.
- **Baseline "Apply to N selected" now follows the shared result contract.** Each output is linked to its source with a Library result, goes out of date when its source changes (per the recalculation mode), and pressing Apply again for the same data adds nothing (no second set of outputs, no empty folder, no extra undo step). Still one Undo for the whole batch. Tests: `BaselinePanel.batch.test.tsx`.
- **Reflectivity fit "Add fit curves", "Add uncertainty bands" and the saved-fit curves are now one Undo step** (they used to need one Ctrl+Z per added worksheet). Test: `store/resultLifecycleContract.test.ts` (`addDatasetsOneStep`).
- **Running the same statistical test again on unchanged data no longer saves a second identical result**; it shows the saved one. A changed column, option, table or data still saves a new result. Test: `store/statisticalTestResults.test.ts`.
- **Peak analyzer batch table is dropped when the plotted channel changes**: a finished batch table no longer sits under a plot of another column. Picking other datasets, switching to another worksheet that has the same columns, and adding the batch's own table keep it; a run still in flight lands dropped.
- **Curve Fit "Write to worksheet" (result worksheet) and "Create summary worksheet" (batch) now follow the shared result contract.** Each output is one Undo step with a Library result that records its inputs, goes out of date when the fitted worksheet (or any batch input) changes, and pressing the button again for the same output adds nothing and says it is already added. The plot and panel stay where they were. Test: `components/workshops/curvefit/FitOutputSection.lifecycle.test.tsx`.
- **Reshape (transpose, stack, unstack, join, append, remove duplicates, fill missing, standardize), Dataset math, SIMS processing and comparison, and the Signal filters / Reduce XY now follow the shared result contract.** Each created worksheet has a Library result recording its inputs, goes out of date when ANY input worksheet changes, and repeating exactly the same operation on unchanged data adds nothing (the status says it is already added) instead of a second copy. A different setting or different numbers still make a new worksheet, and Pipeline Studio / macro replay still creates a new output each time. Test: `store/commitTransformOutput.test.ts`.
- **Signal Processing "Create" no longer makes a second identical worksheet**: the same recipe on the same unchanged source shows the one already made. "Re-run" from a result and pipeline replay still make a new one. Test: `lib/signalOutputGuard.test.ts`.
- **RSM map cuts (the cut tool, ROI and ruler integrate, sector / azimuthal wedge, and the peak-anchored cuts) now follow the shared result contract**: one Undo step with a Library result linked to the map, a repeat of the same cut adds nothing, and the cut goes out of date when the map changes. Test: `components/Stage/useMapRoi.test.ts`.
- **Running an analysis batch again on unchanged data with the same settings no longer saves a second identical result**; the status line says so. Changed data, settings or numbers still save a new one. Tests: `lib/analysisBatchDedupe.test.ts`, `components/workshops/analysisselection/AnalysisBatchControls.dedupe.test.tsx`.
- **Reflectivity "Add fit curves" / "Add uncertainty bands" no longer add a second copy after you reopen the file or the panel**: the curves a fit already added are found by the fit they point back to. Test: `components/workshops/reflectivity/reflFitCurves.test.ts`.
- **A digitized curve now records how it was calibrated**: its worksheet metadata holds the four reference points (pixel and axis value), the axis model and the number of traced points. Test: `components/workshops/digitizer/useDigitizer.test.ts`.

## [0.41.0] - 2026-11-22

### Added

- **Point labels from a column on any XY plot**: the Inspector has a new Point labels card. Pick a label column (text or numeric) and which points to label: all points, only the rows selected in the worksheet, or the top N by |y| (1 to 100). It is off by default, saved with the graph (and in undo), and a project that uses it is saved in a newer file version that older releases refuse to open rather than silently dropping it. The labels are laid out once and drawn in the live plot and in the vector export (PDF, SVG, EPS, PNG) from that one list, each in its curve's colour. Rows excluded from the analysis or dropped by the data filter are never labelled, nor are points with a blank label or a missing value. To keep the plot readable, crowded labels are thinned (the plot is cut into a 14 by 10 grid and each cell keeps one label, the one furthest from zero in |y|, so a 2,000-point plot shows at most 140), and the plot and the card say how many were left out. "All points" is refused above 2,000 points (nothing is drawn, with the reason shown) because a label per point is unreadable; use Top N or Selected rows there. With a label column set, the cursor readout also shows the row number and the label value of the point under the cursor. Nothing is drawn, and the plot says why, on a reciprocal axis, with exchanged X and Y, horizontal bars, a waterfall, a group, encoding, facet or secondary Y axis, curves on different X columns, or decade offsets on a log axis; a deleted label column turns the labels off. Text is cut at 32 characters.
- **Curve Fit result on the graph**: the Curve Fit Results tab has a "Result on graph" section that adds the fit as a text annotation: the equation (for closed-form models; others show `y = Model(x)`), each parameter with its uncertainty, R², and optionally N and parameter units. Choose Plain text or a LaTeX equation (mathtext, drawn the same on screen and in the PDF/SVG export; if a parameter name or unit cannot be written as LaTeX the plain text is used and the panel says so) and either automatic error-rounded digits or 2-6 significant figures. Nothing is drawn until you press "Add to graph". It is one line, anchored to the top left of the page, and an ordinary annotation: drag, resize, restyle or delete it. While the Curve Fit panel is open, a re-fit or an options change rewrites the same annotation in place (no extra Undo step); when the fit is out of date, or the fit is removed or back to a guess, the text gets "(out of date)" appended and "Add to graph" is disabled until you press Fit. Each model gets its own annotation (switching the model does not rewrite another model's). Text you edit by hand is never overwritten ("Replace my edit" regenerates it). The link to the fit lasts for the session: a reopened project keeps the annotation as plain text that no longer updates.
- **Initial-guess preview in Curve Fit**: under "Start values & bounds", tick "Preview initial guess on the plot" (off by default) to see the model drawn at the current start values, as a dotted line named "initial guess", before you fit. It follows every edit of a start value, and each parameter gets steppers: ‹ › nudge its start by 1 %, « » by 10 % (a start of 0 steps by 0.01 / 0.1, and a nudge stays inside the row's min and max). Start values you have not typed use the same data-driven auto start the fit would use. The preview is not a fit: it is not saved with the project, left out of the vector figure export (PDF/SVG), not listed as a result, not recorded in the fit recipe and not part of "Remove fit" (a screenshot or PNG of the canvas shows it, as it shows everything drawn), and it disappears when you switch it off, close the panel, or a real fit lands (edit a start value to bring it back). It is drawn only on the plot of the fitted worksheet when the plot's X is the fitted X, and not while a waterfall or decade offset shifts the plotted data (the panel says so). Models without a closed-form expression the plot can evaluate (for example Pseudo-Voigt, Voigt and the magnetic models) say so and draw nothing, and an invalid start table (a bad number, a minimum above a maximum) is refused with the reason instead of drawing a guess.
- **Fit overlays on any plot**: the Inspector has a new Fit overlays card with three options, all off by default. *Line of fit* draws the least-squares line for each plotted curve, optionally with a confidence or prediction band at 68, 90, 95 or 99 %. *LOWESS smoother* draws a locally weighted smooth curve (span 0.1 to 1). *Density ellipse* draws the 68, 90, 95 or 99 % normal-theory ellipse around the points. They draw in the live plot and in the PDF, SVG, EPS and PNG export from one calculation, are saved with the graph (and in undo), and a key on the plot and in the export names each one (for example "Line of fit: y = 2.04x + 0.31 (R² = 0.98, n = 42)"). Rows excluded from the analysis or dropped by the data filter are left out of the fit. An overlay that cannot be drawn honestly is not drawn, and the key says why: fewer than 3 points for a line, 8 for a smoother or 5 for an ellipse, all X equal, points on a straight line, more than 5,000 points for the smoother, or infinite values (blank cells are simply skipped). They are also not drawn on a log or reciprocal axis, with exchanged X and Y, on a waterfall, or on a large line plot that is thinned for display (switch the default trace to Scatter to plot every point); the export refuses a log axis or exchanged axes with an error rather than a misleading line.
- **Significance brackets and compact letters on box, violin, strip and bar plots**: in the Statistics stage's marks bar, "compare" (off by default) draws, over the groups you are plotting, either brackets with stars for the significant pairs (optionally with the exact p) or a/b/c letters (groups sharing a letter do not differ). The test is Tukey HSD over every pair, or Dunnett against a control group you pick (the first group by default); the p-values are the tests' own multiplicity-adjusted ones, with familywise alpha 0.05. The marks use exactly the groups the plot shows, so excluded and filtered rows are left out, and the value axis grows to hold them. The test, the correction and the star thresholds are written under the plot and in the exported figure, which draws the same brackets and letters (PDF, SVG, PNG, copy). Brackets show significant pairs only, and the note says so (or says no pair was significant). Nothing is drawn, and the reason is shown next to the control, when the comparison would be ambiguous: letters with Dunnett (it does not test every pair), faceted plots, a group with fewer than 2 values, fewer than 2 groups, a Dunnett control that is no longer a group, bar plots that are stacked, have several series or a fixed value range, or a plot that changed under the test. The choice is saved per plot type with the project; a project that uses it is saved in a newer file version that older releases refuse to open rather than silently dropping it.
- **Spectrogram (short-time FFT) in Signal Processing**: pick "Spectrogram · short-time FFT" to see how a signal's spectrum changes along its X axis. Choose one signal column, a window (Hann, Hamming, Blackman, flat top or none), a segment length in rows, the overlap in percent, the scaling (power spectral density, power spectrum or amplitude) and how each segment is detrended. The preview is a heat map with its segment, frequency and value ranges written out. "Add as map worksheet" creates a worksheet (X = segment centre, then frequency, then the spectrum) that the Map tab opens, linked to its source, in one Undo step; adding the same computation again is refused and names the existing worksheet, and a changed source marks it out of date. An unevenly spaced X axis is refused unless you tick "Resample an uneven axis onto an even grid" (off by default), and a segment longer than the data, an overlap of 100 % or more, or a result over 2 million cells is refused with the reason and nothing is added. Frequency is in cycles per X unit; excluded and filtered rows are left out.
- **Five more tests in Statistical tests** (Analyze ▸ Statistics), reaching statistics that existed only in the backend. Each reads the same analysis rows as the other tests (excluded and filtered rows left out), shows the input line, and saves its tables as a result like the other tests.
  - *ROC / AUC / Youden cutoff*: pick a 0/1 outcome column and a score column. Gives the AUC, the Youden-optimal cutoff (score at or above it counts as positive) with its sensitivity and specificity, and the full ROC curve table. An AUC below 0.5 is called out, since it means a lower score predicts the outcome. An outcome that is not coded 0/1, or has only one outcome, is refused.
  - *Logistic regression* and *Poisson regression*: a response and predictor columns, with coefficients, p-values and confidence intervals plus odds ratios (logistic) or rate ratios (Poisson). A logistic response that is not 0/1 and a Poisson response that is not whole counts are refused.
  - *Chi-square goodness of fit*: observed counts against equal expected counts, or against an expected-counts column. Negative or zero counts, and an expected column whose total differs from the observed total, are refused; nothing is rescaled for you.
  - *P-value adjustment*: Holm (default), Bonferroni or Benjamini-Hochberg on a column of p-values, shown next to the originals. Values outside 0 to 1 are refused.
  - Results saved before these options existed still reopen.
- **Conditional formatting for worksheet columns**: right-click a column header and choose Conditional format... to colour its cells with up to two value rules (greater than, less than, between, or NaN/empty) and one 2- or 3-colour scale over the column's own min to max. Colours come from the theme (green, amber, red, accent, two series colours), so they follow the light/dark theme and accent. The first matching value rule wins and the scale colours the rest; NaN cells, infinities and a column with a single value get no scale colour, and a reversed "between" range is refused with a message instead of applied. It is display only: stored numbers, copies, exports and plots are unchanged, a selected column or cell keeps its selection colour, and only the visible rows are coloured, so a large sheet scrolls as before. Each change is one Undo step, "Clear conditional format" removes it, and the rules follow their column when columns are inserted, deleted or moved. They are saved with the project and restored on reopen; a project that uses them is saved as a workspace v7 file, which older versions refuse to open rather than silently dropping the formatting.
- **Clean data transforms in Reshape & combine**: three new operations under Data, each previewed live (first rows, size, warnings) before Create adds one new derived worksheet; the source worksheet is never changed.
  - *Remove duplicate rows…*: by chosen key columns (X, any column, text columns) or the whole row, keeping the first or last of each group in the original row order. Text columns stay aligned. When duplicates differ in a non-key column it warns that those values are lost.
  - *Fill or drop missing values…*: linear interpolation on X (only between two present values that bracket the gap; never extrapolates), carry the previous value forward, or drop rows missing a value in the ticked columns. Anything that cannot be filled stays blank and is counted in a warning. Dropping every row, or interpolating a categorical column, is refused.
  - *Z-score / min-max / rank columns…*: z-score uses the sample standard deviation, min-max maps to 0..1, rank is 1-based with ties sharing their average rank. Blank cells stay blank; the standardized columns are renamed (for example "T (z-score)") and lose their unit. A constant column or a categorical column is refused with the reason, never turned into zeros.
  - Each is recorded as a replayable Pipeline step (one undo step, warnings stamped into the result's metadata), editable in the Pipeline panel, and replays on other files. The exported Python script marks these steps as not reproduced.

### Changed

- **Origin fit-link tables no longer clutter the Library**: opening an `.opju` project that holds many `TableN` books of `cell://` links (the small tables Origin keeps beside a fit, with rows such as Intercept and Slope) now lists them together in one collapsed "Origin link tables" group marked "linked cells not resolved", instead of dozens of text books among your own. Nothing is removed: every table is still imported and opens from the group. The values those links point to are still not recovered. Books with real numbers, or real text that merely mentions a link, stay where they were.
- **Resample, Average curves, the ROI cuts workshop (box / sector / chi cuts and the batch's cuts and summary table), the ROI gadget's FFT and Frequency count now follow the shared result contract**: each output is ONE Undo step together with its Library result, repeating the same action on the same data adds nothing (Resample's Create names the datasets already added and keeps them picked; Average says "Already added as ..."; a batch lists the cuts already added as skipped instead of counting them new; the gadget and Frequency count say so), and the output is marked "Out of date" when any of its source worksheets changes (every curve of an average, the match dataset of a resample), recalculated or only marked per Auto / Manual / None. A different box, grid or setting is a new computation. The gadget's FFT also refuses a spectrum whose worksheet changed since it was computed. Row statistics adds live formula columns to the same worksheet, not a new one, so it is unchanged. Pipeline and macro replay of Resample and Average are unchanged.

## [0.40.1] - 2026-11-22

### Fixed

- **Projects with fit overlays are saved in the newer file version**: a graph that uses Fit overlays was saved so that v0.35 to v0.38 would open it and silently drop the overlays; it is now saved in the same newer version as the other recent additions, which those releases refuse to open instead.
- **macOS installer and auto-update for 0.40**: the v0.40.0 macOS build ran out of memory while type-checking, so 0.40.0 shipped without the macOS `.dmg`, the macOS server bundle and the auto-update manifest. The release build now has enough memory (#870). No app changes since 0.40.0.

## [0.40.0] - 2026-11-22

### Added

- **"Open in <tool>" now works for the multi-source outputs**: the Peak batch table (in the Peak analyzer's Batch mode), the Batch integrate trend (in the Peaks panel's Batch integrate window) and Spin asymmetry (R++ and R--) reopen with every recorded source, the recorded settings (recipe and trend X, windows, baseline, alignment, or both channels' columns) and, for the two batches, the plotted channels they ran on. A missing source opens the tool without the settings and names how many are gone; a source changed since is named in a notice (the commit still refuses a stale computation); a Peak batch recipe that is no longer saved is not swapped for another one and blocks Run until you pick one, and an edited recipe is flagged. Replace writes into the same worksheet and result in one Undo step and goes through the column-layout check, and the replaced result now lists the worksheets it was computed from this time. A fit band still cannot reopen: its covariance, free-parameter count, weights and fit range are not recorded, and the button says so.
- **Replace says so when another result already holds the same computation**: with Replace chosen, a computation identical to a different current result (an earlier "Add as a new output") is refused with the reason, naming that result, instead of silently showing it and replacing nothing; the button explains the same. "Add as a new output" still goes to the existing result.
- **A reopened tool's editing session ends when the tool closes**, even if its panel never loaded (a failed lazy chunk), so a later manual open no longer starts from the old result's settings with Replace preselected.
- **Replace keeps your figures and plots working when a result's columns change**: "Open in <tool>" → Replace now matches columns by name. When every column a plot window, figure, saved graph, graph curve, inset, `sheet()` formula or other result uses still exists, they follow their columns (even when the new result reorders them) in the same single Undo step, and columns nothing uses may be added or dropped. If a used column would disappear, or its name is duplicated, Replace is disabled with the reason by name (for example "Replace would remove column ‘χ’ used by figure “Figure 2”") and "Add as a new output" stays available; the check runs again when you commit. A derived worksheet that reads the output blocks a column change.
- **An Origin lazy book arriving is no longer mistaken for an edit, and results are re-checked when it arrives**: installing a book's full data no longer moves a workbench run's "Out of date" key when nothing but the book arrived (a run started on the preview lands current), while a change you make to the rows still does, and an install that drops exclusions it cannot map still does. When a lazy book installs, the committed outputs and linked results built on it are checked against what they were computed on, and anything that reads the book is marked out of date if exclusions had to be dropped; Auto mode recalculates, Manual only marks, None tracks nothing, and statistical snapshot results keep judging themselves by their fingerprint.
- **Review inputs for the statistics tools**: Distribution, Outlier screening, Fit Y by X, Multivariate, Variability chart, Statistical tests and the Test chooser now open with a "Review inputs" card: the shared input line and row-policy note (including the lazy-load and failed-load refusals) plus the tool's own column picks and settings exactly as the next run will read them. A pick not made shows "not picked" and the line refuses; the data-free power test says it reads no worksheet data. Defaults and row policy are unchanged.
- **RSM peaks / strain, the ROI cuts statistics and batch summary, the Test chooser, the built-in phase indexer and the MagTools Background / Demag readouts say when a result is out of date**: a changed peak count, box, wavelength / tolerance / peak list, fraction, geometry, plotted channel or source rows marks the result "Out of date" and withholds Compute strain, the peak cuts, Export CSV, Label on plot, Run / Report and the fit / N readout until you run it again (buttons and defaults are unchanged). The roadmap's "no shared workbench shell" gap is closed with a per-tool audit table (`plans/ANALYSIS_CAPABILITY_ROADMAP.md`).
- **FFT thickness, Reflectivity FFT, Pawley and the statistical tests say when a result is out of date**: once a setting, the picked channel or the source rows change after a run, the result is marked "Out of date" and "→ Library", the Pawley reflection lines, and a statistical test's Copy / Export CSV / → Report are withheld until you run again (each still runs only on its button; a statistical test still clears its output when its picks, parameters or test change). A run whose settings changed while it was running no longer lands as current, and an answer for a dataset you have since left is dropped. Surface fit now retires its result when a start value or bound is edited (it stayed current and could be added as a worksheet), and a fit on a lazy Origin book is no longer silently discarded in Ellipse fit. Distribution, Fit Y by X, Multivariate, Variability, Outlier screening, Hysteresis, Optical gap and Williamson-Hall were audited: they already recompute or clear their result on every input change, and are now pinned by tests.
- **Refusals are told from errors by type**: the Curve fit, ODR, equation, Compare models, Global fit, Model scan and Batch integrate alerts no longer compare message text to decide whether a message is a refusal or a failure; what you see is unchanged.
- **The last result-producing tools say when a result is out of date**: Bumps / DREAM fits (model, plotted channels, rows / data and, for DREAM, the sampling budget), the reflectivity fit (parameter table, bindings, data settings, graded layers, bound data), the Curie–Weiss fit (data and fit settings, back on its source worksheet), the Peak analyzer batch (the fitted datasets) and every batch over selected worksheets (the worksheets asked for or their data; Curve fit's batch also its start table and weighting) mark a result "Out of date" and no longer apply, plot, add, export or summarize it as current until you run again. A Curve fit By table shows "Out of date" instead of the previous levels while it refits. The reflectivity DREAM run, which is always of a stored fit record, was checked and is unchanged. Applying fitted values to the reflectivity model keeps its fit current. Fixed: an older fit-band answer could replace a newer band when the transport did not abort. The reflectivity fit's curves can no longer be added after the model radiation is changed (the fit is out of date).
- **The other fit tools say when a result is out of date**: the Peaks panel's Fit all together / Fit each (when the find settings change), ODR, the custom-equation fit, Compare models, Global fit, Model scan, the Peak analyzer's model fit and Batch integrate mark a result "Out of date" once the data, channels, picks, start / bound table, windows or settings it ran with change, and an out-of-date result is no longer reported, exported, written to a worksheet or trend, drawn on the plot or applied until you run again (a fit still runs only on its button). A fit or comparison whose inputs changed while it was running no longer lands as the current result. Their refusals (nothing to fit, a bad table) show apart from request failures in the shared alert.
- **Curve fit and the Peak analyzer's Find peaks say when a result is out of date**: Curve fit's Fit now runs on the shared workbench shell (still button-only, same defaults and saved fit); the result is marked "Out of date" when the model, start / bound / held values, weighting, plotted channels or data changed since it ran, and an error clears when the settings it ran with change. Find peaks (step 2) marks its list out of date when the find settings or the trace change, without re-finding over your edits. Their failures show as the shared alert, a refusal apart from an error.
- **Closing Reshape & combine stops a Create already running**, so nothing is created after Close (and after Close during a review dialog's answer). **Resample's batch Stop** now aborts the request in flight instead of waiting for that dataset; it is reported as stopped and creates nothing. The Stop button reads "Stop".
- **Progress bars for the long Curve fit and reflectivity jobs**: model scan, bumps / DREAM, global and compare fits, and the reflectivity DREAM uncertainty run show the shared progress bar (indeterminate until the job reports a fraction), with the percentage before the message.
- **More tools on the shared preview shell**: SIMS Process / Compare / Region previews, the ternary, pie and vector-field figure previews, and Curve fit's equation check (now aborted when you keep typing) use `useWorkbenchPreview`; delays and defaults are unchanged. A figure preview's error message now clears as soon as its inputs change.
- **Previews say they are not saved**: Signal Processing (and its filters), Reduce rows, Resample / align, Reshape & combine and Baseline mark a live preview "Preview (not saved)" and show "Previewing…" while one is computing (Baseline: while an estimate is redone; the first one is the "Estimating…" button), and Baseline marks an estimate "Out of date" once the method, a setting, the anchors or the input change. The five tools now share one preview / error / commit shell (`components/workshops/workbench`); their defaults, debounce delays and outputs are unchanged.
- **Batch over selected worksheets for the XRD and reflectivity reductions and the Curie–Weiss fit**: FFT film thickness, Reflectivity FFT, Pawley refinement and Curie–Weiss each get a closed-by-default "Batch over selected worksheets" section. A worksheet is its analysis view (excluded and filtered-out rows left out) with its own X axis, and its intensity / reflectivity / susceptibility is the column with the panel's channel name; every other setting is the panel's, the same for all worksheets. A missing or duplicated column, a worksheet that records a different X-ray wavelength than the panel uses, a Q-versus-2θ mismatch or an x range in another unit (Reflectivity FFT), a non-2θ axis (FFT thickness, Pawley), or a raw-moment response (Curie–Weiss, whose sample mass belongs to one sample) is an error row, never a guess; the other worksheets still run. Cancel stops between worksheets, a settings change starts a fresh table, and one batch result lands in the Library and the Result book. The Pawley batch records the refined cell and fit quality (not the model worksheet). XRD reference sticks and the Reflectivity model fit have no batch (decided, see the analysis roadmap, D2). Single-run behaviour is unchanged.
- **Hysteresis By**: after picking a categorical column, the loop analysis runs once per level (Mean |Hc|, |Mr|, |Ms|, squareness, loop area and SFD peak, with units in the headers), on the same H and M the single run reads; a level with fewer than 20 finite field/moment pairs, or a plotted X that is not a declared magnetic field, is an error row, and By is blocked while a Library row or range selection restricts the run. **Save By result** records it like the other By tools. Williamson–Hall has no By (decided: its input is a peak list, not a column).
- **Curve fit By aborts**: changing the model, weighting, start values or levels (or closing the panel) now cancels the level fits still running instead of letting them finish unseen.
- **Peak analyzer batch** drops a finished table when the chosen recipe changes (a run in flight finishes, then is dropped); picking other datasets or moving the plotted channel keeps it.
- **Save By result for every By table**: Find peaks, Peak analyzer, Baseline, Signal Processing, Surface fit, Optical gap, Ellipse fit and Curve fit can record their By table, once a By column is picked, as one result with a row per level (the same rows the panel shows) in the Library and the Result book. The button is new and opt-in; By itself and every default are unchanged. A failed level is a Failed row, saving again without a change is refused, Undo removes the result and offers Save again, and the result goes Out of date when the worksheet changes. Curve fit's saved row holds each parameter with its error, R², RMSE, the weighting and start values, and the Library selection's rows or range when it narrowed them.
- **Batch and By for the statistics tools**: Distribution, Fit Y by X and Outlier screening can run over the worksheets selected in the Library (a new, closed-by-default "Batch over selected worksheets" section). Each worksheet is read on the column(s) with the same name as the panel's pick, on the same rows as the single run (excluded and filtered-out rows left out); a worksheet without that column, with two of that name, or (Fit Y by X) whose columns would need a different analysis is an error row, and the others still run. Cancel stops between worksheets. One batch result lands in the Library and the Result book. Outlier screening also gains **By** (each level screened on its own values), and its By table can be saved with **Save By result** as one result with a row per level. Every single-run default is unchanged.
- **Result book extended** to saved statistical tests (every Run), Williamson–Hall results, Williamson–Hall comparisons and analysis-batch results: the same "Result book" tab, with the test name as the method and a settings line of only what that test reads (alpha, alternative, groups or columns, the correction, sums of squares, criterion), the peak inputs and wavelength / K factor for Williamson–Hall, and the tool's saved settings for a batch. Sections are the saved tables in saved order, then any figures; Reopen in tool is offered only where a tool can reopen on the result (not for comparisons or batches). A result whose settings cannot be read has no book tab. Overview stays the default tab.
- **Result book** for saved Distribution, Fit Y by X, Multivariate, Variability chart and Outlier screening results: a new "Result book" tab in the result workspace reads the result top to bottom. One header names the inputs (the same input line the tool shows, while the result is current), the method, the settings, the warnings and whether it is current; below it every saved table and figure is a collapsible section in one fixed order (tables, then figures) with Copy table, Send to report (just that table), Open as worksheet and Create editable figure, plus Reopen in tool, Expand all and Collapse all. An out-of-date result shows its saved input and values with the reason, and its report, figure and reopen actions stay disabled. The other tabs and the default Overview tab are unchanged.
- **Surface fit, Ellipse fit, Peak wizard, Tabulate, Pie and Ternary** show the shared input line (what they analyse, and that excluded and filtered-out rows are left out and selected rows and the plot range are not read). Their rows and defaults are unchanged.
- **Signal Processing "Use excluded/filtered rows"**: on by default (the single run still uses every worksheet row, as before). Turn it off to run on the analysis view; the input line and its note say which, and the choice is saved with the recipe, so a saved recipe, a replay and a recalculation of the linked worksheet use the same rows.
- **Baseline, Optical gap and the magnetometry tools** (Background, Units, Internal field, Curie-Weiss) state their input and row policy in the shared input line. Their rows are unchanged (Baseline and the magnetometry conversions use every row, Optical gap and Curie-Weiss leave excluded and filtered-out rows out).
- **One input line for analysis tools**: Curve fit, Peaks, Distribution, Outlier screening, Signal Processing, Fit Y by X, Multivariate, Variability chart, Statistical tests and the Test chooser now state what they analyse in the same form ("Input: sheet · X · Y · N of M rows · range") with the exact row policy under it (whether excluded and filtered-out rows, selected rows and the plot range are used). Tools keep their own defaults; where they differ (Signal Processing uses every row, the statistics tools leave excluded and filtered-out rows out) the line says so.
- **Shared "add result as dataset" contract**: Surface fit, Optical gap and Ellipse fit outputs now land as one undo step together with a Library result; clicking Add again on the same computation creates no duplicate (the button says it is already added); a change to the source marks the output Out of date in Auto and Manual recalculation mode (None tracks nothing), and that state survives save and reopen.
- **Baseline subtract, Tabulate export, Peak batch table, Batch integrate trend and Fit band plot** now use the same contract: one undo step with a Library result, no duplicate on a repeat click (two clicks while a baseline is still being fetched make one worksheet), and the output goes Out of date when its source changes (for the two batch tables, when ANY of the datasets they summarise changes).
- **FFT thickness "→ Library", spin asymmetry and the magnetometry outputs (normalization, demag, Curie–Weiss)** now use the same contract: one undo step with a Library result, no duplicate on a repeat click, and the output goes Out of date when its source changes (for spin asymmetry, when either R++ or R-- changes). Open in tool stays disabled for them, with the reason.
- **Open in <tool>** for committed outputs of Surface fit, Optical gap, Ellipse fit, Baseline and Tabulate (result workspace and the Library result's menu): the tool reopens on the recorded source with the recorded settings. The next commit replaces the old output worksheet in place (same worksheet and Library result, one undo step), or adds a new one if you choose "Add as a new output". A missing or changed source opens the tool with a notice instead of quietly using other data, and an output worksheet edited since it was added is never replaced. Batch tables and fit bands show the action disabled with the reason.
- **Floating Column** plot type (gallery tile and a Series card "Floats from the series above" option): each bar spans two Y columns, low to high, on screen and in the exported figure.
- The cursor readout of a **stacked series** shows its running total beside its own value.
- A large Curve Fit's saved fit curve now reaches "Add to Report" from a saved figure and the Figure Builder preview and Export, as it already did on Figure Pages and batch PDFs.

### Fixed

- **A run whose rows changed while it was running no longer lands as current** in FFT thickness, Pawley, Reflectivity FFT, Surface fit, Ellipse fit and Optical gap (#863, #866).
- **An edit made while a recalculation pass runs now marks derived worksheets out of date**: a source edited mid-pass left a worksheet the pass had already re-derived reading Current over the pre-edit numbers. The edit is now applied when the pass finishes under the usual mode (Auto recalculates once, Manual marks stale, None tracks nothing); Undo/Redo history and bursts of edits are unaffected. (A cell edit to the very worksheet whose correction the pass is writing at that instant is still overwritten by that correction.)
- **Analysis results stay honest across features**: a Curie–Weiss output is no longer overwritten with its source's columns by a recalculation; undoing a Replace of an out-of-date result keeps it marked out of date; a Signal Processing run that leaves excluded/filtered rows out refuses (Create) or stays out of date (recalculation) when rows are excluded or filtered while it runs; an exclusion made during a recalculation still marks committed results out of date; changing a statistics batch setting mid-run no longer allows a second batch at once; and a saved Signal Processing By result no longer records "Use excluded/filtered rows", which By never applies.
- **Late or stale answers in the RSM, ROI and Test chooser tools**: peaks found for a dataset you left no longer appear (or draw on the map) under the next one, a strain answer after Clear is dropped, a Find peaks on a lazy Origin book no longer discards its own result, the ROI box statistics no longer show another dataset's numbers when you return to a dataset, and a Test chooser answer for columns you changed in flight is dropped.
- **An out-of-date Curve fit could still be reported or written out**: after the data, weighting or any fit setting changed, "→ Report", "Corner plot…" and the Bands / Fit report / Output to worksheet sections still acted on the old numbers; they now wait until you press Fit again.
- **Closing Reshape & combine while its unit-mismatch review was open** left the dialog up, and confirming it silently created nothing; Close now dismisses it.
- **Baseline no longer subtracts an estimate under settings it was not computed with.** Changing the method, a parameter or the anchors after Estimate used to leave Subtract enabled, and the output recorded the new settings over the old baseline; Subtract now stays disabled, with the reason, until you Estimate again. An estimate that answers after the method or dataset changed, or after Close or Clear, is dropped instead of being drawn on the plot.
- **Cancel while a Signal Processing filter (median, despike, LOWESS, (de)convolution, Hilbert, inverse FFT) or Reduce rows is creating its worksheet now creates nothing**; before, the worksheet still appeared after the window closed. A recorded transform whose answer arrives after Cancel is never added.
- **A finished batch table no longer sits under changed settings** in Find peaks, Baseline, Signal Processing, Surface fit, Optical gap and Ellipse fit: changing a setting that the per-worksheet values depend on clears the table (the saved Library result is untouched), as the statistics batches already did. A batch still running when the setting changes finishes, saves its result with the settings it ran with, and then clears. Curve fit and Hysteresis keep their tables.
- A linked **Signal Processing** worksheet whose recipe uses the analysis view ("Use excluded/filtered rows" off) now reads Out of date after a save and reopen when only the source's exclusions or Data Filter changed (its saved fingerprint covered the raw data only). Files saved before this are still judged on the raw data until saved again; a full-worksheet recipe is unchanged.
- **Fit Y by X, Multivariate, Variability chart, Statistical tests and the Test chooser** no longer compute on the downsampled preview of a not-yet-loaded Origin worksheet; the input line says it is loading and they run once the full data arrives (a report or recommendation requested meanwhile still waits for the load, as before). If that load fails the line says so and why, instead of waiting forever (this also applies to Distribution and Outlier screening).
- **Curve fit's custom equation mode** now fits the same worksheet, columns, selected rows and X range as the other models when opened from the Analysis Center or a worksheet selection (before it used the active worksheet and the plotted columns, and fell back to the active worksheet after the chosen one was deleted).
- **Distribution and Outlier screening** no longer compute on the downsampled preview of a not-yet-loaded Origin worksheet; they say the worksheet is loading and run once the full data arrives.
- **Curve fit and Peaks** no longer switch to the active worksheet when the worksheet chosen in the Analysis Center (or from a worksheet selection) has been deleted; they say it is no longer available.
- **Reflectivity model and SLD profile**: clicking Simulate or SLD profile again on an unchanged model no longer adds a second identical worksheet; it selects the existing one.
- **Excluding or filtering worksheet rows** now marks linked derived worksheets and committed analysis outputs Out of date (Auto recalculates, Manual marks them, None tracks nothing), the same as editing a cell; saved statistics results already followed the filtered/excluded view.
- **Undo and Redo of a cell edit, row exclusion or data filter** now notify recalculation like the edit itself: in Auto a linked derived worksheet or committed output is recalculated to the restored data (before, it could keep showing "Current" for data that no longer existed), Manual marks it Out of date, None tracks nothing; the Redo stack is kept.
- **Graph digitizer Create** no longer adds a second identical worksheet on a repeat click (it has no source worksheet, so there is no Out of date marking).
- **Distribution Save result** now blocks a repeat save of the same data and settings for good (before, only the open window remembered it, so reopening the window or a reopened project allowed duplicates); Save works again after Undo or deleting the result.
- **Williamson–Hall Save result** is available again after Undo removes the saved result (it stayed "already saved").

### Changed

- **Curve fit's batch table resets on a settings change, like the other plot-column batches (owner decision 2026-11-22)**: changing the model, weighting, error scaling or start table now drops the finished table (and its summary worksheet and plot chips) instead of keeping it marked "Out of date"; a batch still running when a setting changes lands dropped. Run the batch again to refit. Edits to the worksheets asked for or their data still mark the table "Out of date". The Result book stays off as the default tab and saved statistics snapshots still go "Out of date" in recalc mode None (both unchanged, recorded in the analysis roadmap).
- The input line no longer prints "X:" for tools that have no X axis (Multivariate, Variability chart, Statistical tests, Test chooser, Distribution, Outlier screening). The Baseline header now reads "Input: sheet · X · Y · rows" instead of "sheet: Y vs X".
- Optical gap, Surface fit and Ellipse fit explain a refusal (for example, no rows left after exclusions) instead of sending an empty request.
- Distribution, Fit Y by X, Variability, Outlier screening and Multivariate share one duplicate-save check and one undo step for Save result; behaviour is otherwise unchanged. Snapshot results still go Out of date by data fingerprint in every recalculation mode, including None.
- **Peak find is ~2x faster on large traces** (1M rows: 70 s to 36 s): the SNIP clip runs as a compiled `numba` kernel with the same results, and falls back to the previous numpy code where numba is unavailable.

## [0.39.0] - 2026-11-21

### Added

- **Origin plot kinds** (#787, #791, #794): stacked area, horizontal bars, grouped and stacked columns, 100 % stacks, histogram + cumulative pages, and pie / doughnut layers draw as Origin draws them. Kinds not yet supported (floating columns, vectors, bar-of-pie, ...) are left out with a note rather than drawn wrong.
- **Origin category axes** (#784, #792): text labels on screen and in export; Divide-by and Formula tick labels from `.opju` and `.opj`.
- **Origin error bars** (#778, #788): asymmetric and X errors, band style, double plots; your own error bindings survive an Origin re-apply.
- **Keyboard access to the 2-D plot** (#761): data cursor, zoom, pan, reset.
- **Analyze menu as navigator** (#764): disabled items say why, plus recent analyses and existing results.
- **Signal Processing on several sheets** (#760) groups its outputs and offers "Overlay these N".
- **Result workspace** (#765): choose which outputs to Freeze when a result has several.
- **Resizable Inspector** (#762); the Library header stays put when scrolled.

### Changed

- **Origin import opens the project's first graph** (#771) instead of the raw book; unresolved figures group under one collapsed Library node (#772).
- **Origin figures look like Origin** (#779, #781, #786):
  - no phantom curves, and the recorded X wins;
  - every panel of a multi-layer page is kept; top-axis layers draw as one plot;
  - cross-book double-Y; thin lines at a 1-pixel minimum; pale colours are darkened but keep their hue;
  - page text is placed correctly, and script buttons are hidden.
- **Tool windows dock** (#766): Baseline, Peaks, Signal Processing and Waterfall no longer cover the plot's Y axis.
- **Workspace files** holding fields older versions would drop are written as v7 (#792), so an older quantized refuses them rather than losing data.

### Fixed

- **Origin `.opju`** (#769, #770, #775, #777): hidden plots stay hidden; restyled scatter plots keep their colours; 199 more graph pages decode; every graph page Origin lists is accounted for.
- **Origin `.opj`** (#780): each curve reads its own X and full column names; hidden plots are left out; symbols take automatic colours.
- **Origin import edge cases** (#773, #774, #792): graph-only and unsaved Data Connector projects open; a book renamed only by case binds; fidelity codes are accurate.
- **Origin legends** (#793) keep a genuine "(2)" in a column name; reversed axes keep their tick labels on screen and in export.
- **Tiny Origin symbols** (#794): sizes below 2 now draw (they drew nothing before).
- **Import polish** (#768): the loading status clears; notes stay inside the frame; fit-sheet legend labels are readable.
- **Plot legend** (#763): no empty "peaks" row before peaks exist.

### Internal

- **Origin corpus regression check** (#785): `gate.py --origin` compares every project before and after a change and fails on unexplained differences.
- **Decode ledger** (#783) and a split of project docs into per-area files and skills (#789).
- **Robustness** (#767, #776, #782): the figure gallery harness is repaired; a corpus-wide visual check runs against Origin's own images; five load-sensitive timing tests are robust.

## [0.38.0] - 2026-11-17

### Added

- **XRD indexing against built-in phases** (#757):
  - Pick a phase from the built-in database (Si, Ge, Au, Ag, Cu, Al, Pt, MgO, SrTiO₃, Al₂O₃, ZnO, GaAs, ...) and a wavelength. Your peaks are matched to their (hkl) with d and Δ2θ, and the labels can be placed on the plot.
  - The Peaks window gains a d (Å) column on 2θ axes and one-click Export CSV / Copy.
- **Batch fit → parameter vs X** (#751): after a batch fit, one click plots a fitted parameter against temperature, field or the number in each sheet's name.
- **Baseline on several spectra at once** (#755):
  - Apply to N selected runs the same baseline on every selected spectrum as one undo step. Each sheet's columns are matched by name.
  - The outputs are grouped in a folder, with an Overlay these button.
- **Undo history and Edit ▸ Cut / Copy / Delete** (#758):
  - Edit ▸ Undo history lists the last 20 steps; click one to jump back, and Redo returns.
  - Cut, Copy and Delete work on the surface you last worked in.
  - The command palette now finds "peak table", "d-spacing", "Scherrer", "tau vs T" and "batch fit".

### Changed

- **Origin export** (#746): six exporter fixes, each proven by reading the export back into Origin.
- **Window titles** (#747):
  - The project name is shown in the window title.
  - The export view is titled by the window it was opened from.
  - Several dropped text files give one combined import note.
- **Journal export** (#748): multi-panel pages use the preset's real height, and the superscript minus renders in every journal preset.
- **Peak "Fit all together"** (#749) converges reliably and reports real ±1σ uncertainties, with a warning when the fit is poor.
- **Library** (#750): a single-sheet workbook is one row.
- **Multi-panel export** (#752):
  - The grid fits itself to the panels you add, starting at 1×2.
  - The save note is one line.
  - Single-series panels drop their legend.
- **One waterfall** (#753): the menu command draws the waterfall and the Channels slider tunes it, as one undo step.
- **Project round-trip** (#754):
  - A reopened project keeps markers-on-data with a dashed fit.
  - Save suggests the project or dataset name instead of `workspace.dwk`.
  - The title bar shows the project.
  - Undo straight after opening no longer empties the project.
  - Short log axes label 2 and 5 within a decade, on screen and in export.
- **Signal Processing** (#755): the preview gives a normalised curve its own scale, and the X note shows the real column name.
- **Accessibility** (#756):
  - The page has proper landmarks and a valid menu bar.
  - Help buttons sit outside card headers.
  - The Library splitter resizes with the arrow keys, and double-click resets it.
  - The Curve Fit model search shows a real list.
  - The light-theme active tab has stronger contrast.

## [0.37.0] - 2026-11-17

### Changed

- **First plot after import** (#740):
  - Monitor columns are left off the default plot: temperature against a non-temperature X, status or setpoint columns, readbacks in X's unit, and constant columns.
  - Log Y turns on for positive data spanning more than 3 decades.
  - x,y,z grids whose x and y share a unit open as a map.
  - The import toast offers a one-click undo: Linear Y, Line plot or Plot all.
- **Publication-style axis numbers** (#739):
  - Tick labels drop digit grouping and use a true minus sign.
  - Very small or very large axes show mantissas with a ×10ⁿ factor at the axis end, on screen and in export alike.
  - Each worksheet column uses one number notation.
- **Fit and peak defaults** (#737):
  - Curve Fit uses the visible X range while the plot is zoomed.
  - A poor fit shows a warning status instead of a green one.
  - The CI column wraps instead of being clipped.
  - Peak Analyzer finds at most 9 peaks and defaults to pseudo-Voigt for XRD/Raman, keeping the fit within its time limit.
  - All peak tables share one value ± error format.
- **Import recovery** (#738):
  - The import wizard always shows the file's raw lines with 1-based line numbers, even when parsing fails.
  - Failure toasts say why ("the file is empty", "header but no data rows") and fold together when several fail.
  - A "Lost connection" banner offers Reload.
- **Density and chrome** (#741):
  - Library rows are more compact.
  - Double-click opens a dataset; rename it from its name when it is open, or with F2.
  - Legend arrows appear on hover.
  - The plot toolbar is a single Tab stop.
  - Light-theme inputs and buttons are clearer.
  - Annotations show a $…$ hint with a live preview.
  - First run has a single empty state.

### Fixed

- A column holding NaN in a decimal-comma (or point-decimal) file is no longer turned into categories. Direct import and the wizard now share one numeric-column rule (#738).

## [0.36.0] - 2026-11-16

### Added

- **Auto-update from source** (#734): a worksheet can follow its file while a
  measurement is still writing it. New rows appear as the file grows; a
  half-written last line waits until it is complete. Your edits are respected:
  if you changed values, names, units or category labels, the update is one
  labelled, undoable step ("Auto-update replaced your edits"). Library ▸
  "Read the source file now" re-reads on demand.
- **Many datasets** (#735):
  - Shift-click selects a range in the Library tree, and Ctrl+A selects every
    visible dataset.
  - The selection bar's Plot makes one overlay graph with a legend. Its
    legend drops file extensions, and when every curve shares a unit, that
    unit moves to the Y title, on screen and in export.
  - Panel grids keep each panel's own X range unless the panels share an X
    quantity.
  - Multi-panel export can use datasets as sources.
  - Importing several same-shape files offers an overlay.
- **Column names from comment headers** (#732): a `#` or `%` comment line
  just above the data such as `# H (Oe)  M (emu)` now names the columns and
  sets their units. Free-text comments are left alone.
- **Decimal-comma files recognised from the whole file** (#732): a `;` or tab
  file whose other columns prove decimal commas (`0,5`) imports without the
  wizard. Any point-decimal cell keeps the old fail-safe refusal.
- **Command search finds daily-job words** (#731): save, gaussian, Tc, Oe or
  tesla, APS/Nature presets, fonts, annotate, "FC minus ZFC", axis range.
  New commands: Set Column Values…, Copy figure, Select all datasets. Curve
  fit and Peak analyzer are also listed under Analyze ▸ Fit / Peaks.
- **Analysis extras** (#725): surface fit z = f(x, y), Tauc optical-gap fit
  and ellipse fit.
- **Automation** (#727): read `.dwk` workspaces from Python, a data-operation
  API, `qz run` for headless recipes, and fuller script export.
- Tick-label prefix/suffix; recode mappings are saved in the project (#726).
- **Interactive 3-D view** on the Map tab (and in the waterfall workshop):
  drag to rotate, wheel to zoom, arrow keys / +/− / 0 from the keyboard, and a
  hover readout of x/y/z for surfaces, 3-D scatter (optional drop lines) and
  3-D waterfalls. The export draws the angle and zoom on screen. A workspace
  saving a 3-D view still saves as `.dwk` version 6.

### Changed

- **Usability pass** (#719, #720, #722, #723):
  - the Inspector follows what you have selected;
  - first-run guidance;
  - readable fit results;
  - uniform selects and icons, with one meaning per glyph;
  - one export view with a true-size preview and readable presets;
  - analysis windows dock into the Inspector column.
- Peak Analyzer starts from sensible defaults, and fit overlays no longer drive
  the Y autoscale, on screen or in export (#721).
- Import failures, Undo and the peak-fit status now report what actually
  happened; the open project follows undo/redo (#728).
- Startup loads about 19 kB less JavaScript (#724).

- 3-D map exports are now **orthographic** (no perspective, as in MATLAB and on
  screen), draw the surface at full grid resolution (up to 500 cells a side), fit the axes to the data
  without padding, and no longer depth-shade scatter points. Re-exporting an
  older 3-D figure therefore looks slightly different from the earlier file.

- Theme: Preferences > Appearance now offers "Follow system" alongside Dark and
  Light, and the page picks the OS colour scheme before first paint (no dark
  flash on a light OS). New installs follow the system; existing users who
  already saved a theme stay pinned to it until they pick "System". Help and
  meta text is larger, wraps instead of ellipsizing, and several status/muted
  colours were darkened or lightened to meet WCAG AA contrast.

### Fixed

- **Large imports with unordered X draw in seconds** (#733): a 100k-row file
  whose X is not sorted took about 3 minutes to first paint and now takes
  about 6 s; 1M rows now paint instead of hanging.
- Hysteresis: loops that sample H = 0 exactly report Mr and squareness;
  squareness is blank, not 1, when Mr or Ms is undefined (#730).

## [0.35.0] - 2026-11-16

### Added

- **Exchange X–Y axes** (plot right-click menu, like Origin's): swaps a plot's axes without
  touching the data; autoscale, bar plots and export follow the swap (#717).
  A workspace using it saves as `.dwk` version 6, which 0.34 refuses to open.
- Origin-style keyboard shortcuts, and **Ctrl+S saves back to the file you
  opened** instead of always asking where (#717). Opening or starting another
  workspace resets the target, so Ctrl+S can never write over the wrong file.
- Worksheet grid: a cell cursor with keyboard navigation (arrows, Home/End,
  PageUp/Down, Enter/Tab, F2, Esc, Delete, Ctrl+C/X/V/D/A), type-to-edit, a
  column menu (insert/add/delete/move, edit Long Name/Units/Comments, number
  format, sort on up to three keys) and a row menu (insert/delete/move
  rows), plus File ▸ New workbook.
- Worksheet import/export: a timestamp X axis shows calendar dates on
  screen, in the grid, and in every export; dotted (`14.11.2026`) and
  year-first date formats are recognised; Excel import keeps Long
  Name/Units/Comments header rows and text columns; File ▸ Export ▸ Export
  worksheet… writes CSV, TSV or Excel (Long Name/Units rows, text and date
  columns, one tab per sheet); File ▸ Import ▸ Import as sheets of one
  workbook… combines several files into one workbook with switchable sheet
  tabs.
- Analyze ▸ Average multiple curves…: averages two or more curves onto a
  common X grid (the union of every curve's X, or a set step over their
  overlap), reporting mean, sample SD, SEM and N; SEM is bound as the
  averaged curve's error bar automatically. Also at
  `POST /api/transform/average`.
- Peak labels: `{hkl}`/`{phase}` template tokens resolve to the nearest
  loaded XRD reference stick within a 0.2° 2θ tolerance (adjustable in the
  label dialog); a peak with no stick that close shows neither token.
- Error columns ▸ Computed: add √Y (counting statistics, clamped so a
  zero-count point never gets a zero error), a percent of Y, or a constant
  as a linked formula column bound as a series' Y error — it recomputes
  automatically whenever the underlying data changes.
- Axis dialog: reverse the Y or Y2 axis, a secondary top X axis (1/T,
  Bragg d-spacing, or linear), grid line styling, X label rotation and an
  axis offset — matched exactly between the screen and every export.
- Export: a multi-page PDF (one open figure per page) from the batch
  exporter; EPS alongside PDF/SVG/PNG; Plot ▸ Display ▸ Apply Graph
  Template… / Paste Format to Graphs… restyles a whole folder or Library
  selection in one undo step; the plot-type gallery adds violin, double-Y,
  polar, waterfall, stacked panels and ternary.
- Plot styling: hollow or solid symbol fill and per-series error-bar
  styling (cap, width, color), matched on screen and in export; right-click
  a brushed selection to Exclude selected points / Include selected points
  / Include all points (one undo step, honoured by fits and exports);
  double-click a curve to open Plot Details (color, line, symbol, error
  bars).
- Background (unfocused) graph windows now draw their own legend and
  shapes, so tiled windows stay visually consistent regardless of which one
  has focus.
- Live multi-dataset graphs (#661): **Plot selected together** now makes a
  graph that stays linked to its source sheets (a cell edit, a row mask or a
  re-import reaches it) instead of a frozen "overlay (N)" copy, and **Add
  curve from…** adds a curve from any dataset to an existing graph. Each Y
  is drawn against its own X column (Origin's nearest-preceding-X rule) on
  screen and in export, and the Y-axis title joins the visible curves'
  quantities ("R1, R2 (ohm) / V (V)").
- Axis dialog: the top X axis can be any expression of the bottom axis
  (`1240/x`, `sqrt(x)`), labelled only over its finite, monotonic stretch
  (#662). Log2 and probability (fraction or percent) scales, custom tick
  positions with optional labels, and an axis crossing the other at a value
  (#685). Screen and export share one contract.
- Library: tick saved editable figures and export them as one multi-page
  PDF, in tick order (#662).
- Worksheet: Find/Replace (Ctrl+F / Ctrl+H) over text or whole cells, in the
  sheet or a selection, replace-all as one undo step (#662).
- Layer Contents (#665): one dialog lists a graph's curves to remove,
  reorder, re-bind to another dataset/X/Y, or add from any dataset. Dropping
  a Library dataset or book onto a graph adds its Y columns. **Link X axis
  with…** shares zoom and pan between named graph windows; **Link Y axis
  with…** does the same for the primary Y range (#685).
- Masking: Select Rows draws a 2-D box, a right-click on a data point offers
  Mask / Unmask this point (#665), and the Lasso Mask tool masks (Shift:
  unmasks) the points inside a free-form outline (#685). All use the
  worksheet's row exclusion, so fits and exports follow.
- Data-driven marks (#667): marker size from a column (with a size key),
  drop lines to the X or Y axis, a natural cubic spline connector (strictly
  ascending X only; loops stay straight with a notice), and SD/SEM of
  replicate columns as a computed error source.
- Graph layers (#668): **Insert ▸ Inset graph / Image / Table** places
  Origin-style layers on a plot: an inset graph of any datasets' curves on
  its own axes, a PNG/JPEG/SVG image, or a table typed or filled from
  worksheet rows. Drag to move, corner grip to resize; the vector export
  draws the same layers. A graph template does not carry layers: like
  curves, they count as the graph's data.
- Peak models (#673): split (asymmetric) Gaussian, Lorentzian and
  pseudo-Voigt, Pearson VII, Fano/BWF and Doniach–Šunjić shapes, and peak
  ties by offset, ratio or area ratio (for XPS doublets), with the
  coefficient fixed or fitted and its error propagated.
- Signal ops (#674): median filter, despike, LOWESS, convolution and
  deconvolution, Hilbert envelope, inverse FFT, and Reduce XY (bin, merge
  duplicates, every Nth point), in the Signal Processing and Resample
  workshops. Rows are never re-sorted; operations that need uniform or
  monotonic X refuse other data. Also at `POST /api/transform/sigop`.
- Set Column Values (#675): a full dialog with a target picker, function /
  column / operator browsers, a From/To row range and a live preview. New
  worksheet functions `erf`, `erfc`, `gamma`, `lgamma`, `round(v, n)`,
  `floor`/`ceil` with digits, seeded `rnd`/`normal`, `interp(v, X, Y)` and
  `nan`, checked against numpy/scipy. **Fill column with** row numbers, a
  linear sequence or random values, and **Set row count**.
- Import legacy Excel `.xls` workbooks (#677). This adds `xlrd`
  (BSD-licensed) as a core dependency.
- Map tab: a contour/map of scattered XYZ points, interpolated and labelled
  as interpolated; collinear or too few points are refused (#677).
- Function Plot workshop: draw y = f(x; params) as a live curve on the
  focused graph (#677).
- Plot styling (#678): a colour gradient across a graph's curves (viridis,
  plasma, magma, cividis, cool-warm, turbo; even, reversed or ordered by the
  number in each legend label), symbol details (edge and face colour,
  transparency, draw every Nth marker) and a shaded Y error band.
- Worksheet user-parameter rows (#683): named per-column parameters
  (Temperature, Sample) under the header, usable in legends (`{Name}`) and to
  order curves.
- Fitting (#683): By-level fits honour the panel's weighting per level, and
  Global fit gains **Compare datasets**, an extra-sum-of-squares F-test of
  shared versus separate parameters.
- Curie–Weiss and demagnetization correction propagate a symmetric,
  same-unit applied-field error column in quadrature with the moment error
  instead of refusing the run (#683).
- **Copy figure** (#686) reports which formats actually reached the
  clipboard ("as vector (SVG) + PNG" or "as a 300-DPI PNG (not vector)").
  An opt-in native Windows clipboard path for `qz --desktop` puts the
  figure on the clipboard as SVG, PNG and a bitmap together, like Origin's
  *Copy Page* (see Known limitations and `docs/desktop.md`).
- `qz convert FILES... --to {csv,xlsx,dwk} --out DIR` (#687) converts Origin
  `.opj`/`.opju` projects without Origin: every book and sheet, a summary
  line per file and `convert-report.json`. A book with undecoded columns or
  an unrecovered X is reported and not written unless `--allow-partial`.
- Public Python API (#687): `quantized.api` gains `read_origin_books`,
  `convert_origin_project`, `save_table` and `fit_model`.
- Multiple Y axes (#692): assign a series to Y3, Y4, … (up to Y8) from the
  Inspector's Channels card or Plot Details. Each extra axis sits outward on
  the right with its own range, scale, tick step, number format, label and
  colour (**Plot ▸ Y Axis Settings…** or double-click the axis), on screen and
  in export.
- Saved figures keep their fit curve. A plot window's figure saves the fit
  its graph draws (with the Curve Fit band, and a Peak Analyzer fit's fitted
  background), so Save editable figure, Figure Page panels, Batch Figure
  Builder output (each worksheet's saved fit is redrawn from its parameters),
  Library multi-figure PDFs, Send to report and Analysis Results' Build
  source figure all carry it. A fit belongs to the window that drew it: other
  windows on the same worksheet do not show it, and it comes back when its
  window takes focus, after undo (also when you changed the plotted X or Y
  before fitting), and when a project or autosave reopens. If the
  worksheet's rows, excluded rows or column roles have changed since, the
  saved curve is not drawn (the export says it was left out). Fitting marks
  the project changed, so the autosave keeps it; opening a project and
  putting its saved fit back does not.
- Reopening a project made before this keeps its fit: the focused window's
  Curve Fit curve is redrawn from the saved parameters, over the rows that
  were fitted (no re-fit). If the model cannot be evaluated, the fit is out
  of date, the fit never recorded its X or Y, or its curve is not on the
  plot, nothing is drawn and the status line says why. The Curve Fit panel
  then offers Remove fit for that saved fit.

### Changed

- Peak markers and an estimated baseline are previews, not figure content:
  they are not saved with a figure and go when their panel closes. A Peak
  Analyzer model fit and its fitted background are results: closing and
  reopening the panel keeps them (its baseline step no longer replaces a
  fitted background with an estimate), and they are saved with the figure.
  (This replaces
  the gap-audit-6 lane K acceptance item "a two-peak fit reopens with the
  peaks overlay": the model curve and fitted background reopen; the peak
  markers do not.)
- API: `POST /api/export/figure`, `/api/export/figure-page` and
  `/api/export/figure-batch` take an optional `analysis_overlays` list (one
  boolean per `y_keys` entry) that marks fit, band, baseline and peak series,
  and return **422** when it is not exactly one strict boolean per `y_keys`
  entry.
- Analysis tools compute on each Y's own X (#666): baseline, magnetometry,
  batch integrate, the peak tools and Curve Fit used the plot's shared X, so
  on a sheet laid out `T1,R1,T2,R2` R2 was analysed against T1. Curve Fit
  records the X it used.
- Fit, baseline, peak and derivative overlays are drawn only on the X and Y
  they were computed on (#679, #689). Hiding a curve hides its overlays, and
  a fit whose recorded X no longer matches the plot is not drawn. Export and
  Copy figure say when they leave out an overlay the canvas draws; a legacy
  fit with no recorded X opens without the fit, with a **Re-fit** button.
- **Export script** writes a runnable Python script on `quantized.api`
  (`.py`) instead of `macro.qzm` (#687). Imports, corrections, reset and fits
  become API calls; steps with no API equivalent are kept as comments that
  say so.
- `qz convert` and `quantized.api.save_table` never overwrite an existing
  file unless asked (`--overwrite` / `overwrite=True`), and never write over
  one of their own inputs (#687).
- **Send to Origin** asks before sending to the Origin session you already
  have open, and sends nothing on cancel (#688).
- A successful import closes the Import Wizard; the worksheet shows text
  columns in the file's column order; the worksheet toolbar folds its
  less-used buttons into a "…" menu; column insert/delete/move are recorded
  in the macro (#670).
- Workspaces that use a feature v0.34.0 cannot keep are saved as `.dwk`
  version 6 (see Upgrade notes); every other workspace is still saved as
  version 4 (5 with transform steps).
- Install hints in error messages now name the real PyPI package,
  `quantized-lab` (for example `pip install quantized-lab[desktop]`). The
  bare `quantized` on PyPI is an unrelated project.
- Automatic ticks on the plot's linear, numeric main axes are spaced as
  matplotlib spaces them: about 5–9 majors instead of the ~20 a tall Y axis
  used to get. On screen, X keeps at least three ticks when its labels fit,
  but a very narrow plot (under about 215 px for a 2–298 K sweep) still shows
  two. Labels carry one decimal count per axis ("0.0090" beside "0.0095"),
  up to five decimals. Insets, Y breaks and date axes keep their own spacing.
- 0.34.0's "an export marks the same tick positions the screen drew" is
  narrowed. Only Export figure and Copy figure from the focused window, and
  that window's Publication preview, send the screen's increments, and they
  send them as hints that all three share. Batch export, Send to report,
  Figure Page and other saved figures of the same dataset never carry them.
  The export follows a hint only when the axis gets at least two ticks and
  at most one interval more than matplotlib's tick budget for that axis
  (its `get_tick_space`, capped at 9). That is the case for a default-size
  export of a typical plot, but not always for a short axis at the default
  fonts. Otherwise matplotlib spaces that axis itself, with at least three
  ticks on X, and the export warns, for example "X ticks re-spaced for the
  export size". A typed increment always wins, and an invalid hint is
  rejected (422).

### Fixed

- Leaving the app idle, switching plots and coming back no longer leaves
  stale or missing overlays, ticks or status messages (#717).
- The eager JavaScript bundle is about 6 kB smaller, so the app starts a
  little faster (#717).

- An exported PDF/SVG/EPS of a graph with a fit, band, baseline or peak
  overlay titled its Y axis "signal, fit, 95% CI low, …"; it now reads
  exactly as on screen ("signal").
- Origin `.opju` graph pages are recovered with their per-layer axis ranges,
  checked against Origin itself (#676, #681, #682).
- Origin `.opju` curves bind to the sheet they plot (#684) and to their own
  X column (#690); NLFit report graphs embedded in a workbook no longer
  attach phantom curves to it (#690).
- Origin project import no longer drops valid column headers and reports
  columns it could not read (#664).
- "Import as sheets of one workbook…" no longer offers to create a folder
  for the files (#670).

### Upgrade notes (from 0.34)

- **Hiding a curve now hides its fit, baseline and peak overlays** (#679).
  A 0.34 project saved as a "fit line only" plot (data curve hidden) opens
  with the fit hidden too. To show only the fit, make the curve transparent
  or remove its line and markers instead of hiding it.
- **Each Y now uses its own X for analyses** (#666). On a sheet with more
  than one X column, re-running an analysis saved in a 0.34 project can give
  different numbers from the ones it recorded, because 0.34 used the plot's
  shared X.
- **Export script now writes a `.py` file**, not `macro.qzm` (#687). 0.34
  never read `.qzm` back, so no file stops loading, but scripts you kept are
  a different format now. A fit step recorded before its start values and
  bounds were saved exports with a printed warning and uses automatic
  starts.
- **`qz convert` refuses to overwrite** existing files; pass `--overwrite`
  to replace earlier outputs. It never writes over an input.
- **The native Windows vector clipboard is opt-in**: set `QZ_WIN_CLIPBOARD=1`
  and run `qz --desktop` with the `desktop` extra. Otherwise Copy figure
  works as before.
- **Opening new files in 0.34.0**: a workspace that uses graph layers, Y3+
  axes, a colour gradient (on a graph or in a saved Graph Builder spec),
  linked Y axes, live multi-dataset graphs, column comments or number
  formats, the new axis options (log2, probability, custom ticks, crossing,
  grid styling, top axis, reverse, rotation, offset) or the new publication
  (export) series styles is saved as `.dwk` version 6. v0.34.0 refuses it
  ("unsupported workspace version: 6") instead of opening it without those
  features and losing them on save. A workspace without them stays version 4
  and opens in 0.34.0. The new per-series styling on a graph (hollow
  symbols, symbol details, error-bar style, size by column, drop lines,
  spline) does not bump the version: 0.34.0 keeps it, though it does not
  draw it. A copied workbook follows the same rule (transfer version 2,
  which 0.34.0 refuses to paste).
- Graph templates kept in the app and exported Plot Recipe files have no
  such gate: 0.34.0 reads the fields it knows and applies them without the
  rest. Graph templates live in the browser profile, so after going back to
  0.34.0 on the same machine, the first template 0.34.0 saves rewrites the
  list without the newer fields (gradient, Y3+ axes, new styles) of
  templates made in this version. (Recipes saved inside a `.dwk` are part of
  the version-6 rule above.)
- `qz convert` writes `.dwk` version 3, which this version migrates on open.
- A figure's saved fit curve is not gated: 0.34.0 opens such a project (it
  stays version 4) but drops the saved curves, keeping each worksheet's saved
  fit recipe. Back in this version, only the focused window's Curve Fit curve
  is redrawn from that recipe. Lost until you fit again: the Curve Fit band,
  the fit in every other window and in every editable figure (including
  Figure Pages, Build source figure and Batch Figure Builder output), and
  fits with no recipe to redraw from (Peak Analyzer and its fitted
  background, Quick Fit, equation, ODR, global, bumps and reflectivity).

### Known limitations

- The native Windows "Copy figure" is opt-in and works only in the
  pywebview window (`pip install quantized-lab[desktop]`, `QZ_WIN_CLIPBOARD=1`,
  `qz --desktop`). The Tauri desktop installer does not include it. Elsewhere
  Copy figure uses the browser clipboard: SVG where the browser allows it,
  otherwise a 300-DPI PNG.
- No EMF on the clipboard: no permissively licensed EMF writer exists, so
  Office 2016 and earlier paste the PNG.
- Extra Y axes: at most Y3–Y8. Group, encoding, facet, axis-break and
  multi-panel views draw Y3+ series on Y1 with a note, on screen and in
  export; Figure Page panels drop Y3+ axes with a note; insets skip the extra
  series; a series assigned to a missing axis falls back to Y1.
- Writing matrix books as true Origin matrices stays opt-in, as in 0.34.0.
- The exported Python script does not reproduce every step: formula
  columns, transforms, paste and append, background subtraction, data edits,
  weighted fits and fits on a row selection are written as comments, and the
  script stops at the first such data step. Error-column bindings are not
  recorded.
- 0.34.0 opens a version-4 or version-5 file that uses the new worksheet
  functions (`erf`, `gamma`, `interp`, …) or the new signal operations, but
  cannot compute them: 0.34.0's formula engine reports `unknown function
  "erf"` for such a computed column, and a recorded signal-operation step
  fails when run (`"sigop" is not a single-output transform`). The formula and the
  step are kept, so the file works again in this version.
- `.xls` import reads legacy (BIFF) workbooks. A `.xlsx`, TSV or HTML file
  renamed to `.xls` is detected by its content instead.

## [0.34.0] - 2026-11-14

A **major feature** release: the Origin-replacement sprint. Quantized can now
stand in for OriginPro for daily lab work: opening Origin projects, publication
figures, curve fitting and peaks, and worksheet operations.

- **Origin projects:** header-driven `.opj`/`.opju` readers (48/49 public `.opj`
  and 258/274 public `.opju` projects import), matrices as maps, bar/column/
  histogram graphs restored, graphs that cannot be rebuilt reported with
  Origin's saved image, designations driving plots, Set As, `.opj`/`.ogs`/
  Origin ASCII export.
- **Fitting:** 71 Origin built-in fit models with Origin's parameters, statistics
  matching statsmodels/scipy (weights, bands, adjusted R²), Curve Fit and Peak
  Analyzer usability.
- **Figures:** export matches the screen, page setup, fonts, Origin rich-text
  escapes, axis breaks, independent styled windows.
- **Worksheet:** undoable data sort, `sheet()` cross-worksheet links,
  uncertainty propagation, quoted CSV numbers, row statistics.

Known limit: writing matrix books as true Origin matrices is opt-in
(Preferences) until it has been checked by opening the file in Origin.

### Added

- Publication figures: the Export dialog sets the figure's width and height
  (in, cm, mm or px) and the right-axis label; the Publication preview's
  Canvas group sets the page size too. Page setup, Export and the preview all
  edit the same page, and Page setup now opens at the size an export already
  uses (6 × 4 in).
- Publication preview: separate title, axis-label, tick-label and legend font
  sizes, and a font picker listing the fonts the export can render. Arial and
  Helvetica render in Liberation Sans, Times New Roman in Liberation Serif;
  a font that falls back is reported.
- Labels accept Origin-style rich text — `\+( )` superscript, `\-( )`
  subscript, `\g( )` Greek, `\b( )` bold, `\i( )` italic — on screen and in
  every export (docs/rich_text_labels.md).
- Region shades span the full plot height by default, with a per-shade
  toggle; they show on log axes. A reference line or shade outside the axis
  range is marked "(off-scale)" on screen and reported by the export.
- Graph windows are independent: importing data or opening a Library item
  never restyles a window you have styled (it opens in an unedited or a new
  window), each window keeps its own plot mode, and double-clicking a Library
  dataset another window already shows brings that window forward. Windows
  maximize, tile and cascade, and closing a styled window asks first.
- Axis dialog (double-click an axis, or Plot ▸ Axis…): scale (linear, log,
  ln, reciprocal), limits, major increment, minor ticks, tick direction,
  number format, divide-by factor (its "×10ⁿ" sits at the axis end, as in the
  export) and font sizes, for X, Y and Y2.
- Y-axis breaks: Break from / Break to on the Axis dialog's Y and Y2 tabs
  (or Plot ▸ Break y-axis…) elide a stretch of the axis, with break marks, on
  screen and in every export.
- Plot ▸ Plot type… gallery (line, scatter, line + symbol, area, column,
  stacked column, box, histogram, contour); Column / Bar charts from a
  summary table draw a bound error column as the whiskers ("from column").
- Style templates, recipes and Copy / Paste Format apply to plain CSV
  datasets, carrying style only (never another graph's limits, breaks or
  annotations); error columns are bound consistently across the Channels and
  Error columns cards; an XYZ map picks its X, Y and Z columns.
- The exported legend of a waterfall lists the top trace first, as the
  screen does, and an export marks the same tick positions the screen drew.
- Worksheet column menu ▸ Set As (X, Y, Z, Y Error, X Error, Label,
  Disregard), Origin's column designations: one undoable step, saved with
  the workspace, honoured by the default plot, Graph Builder and the .ogs,
  .opj and consolidated-CSV exports.
- Origin's own ASCII export (Long Name / Units / Comments rows above the
  data) imports with names, units and comments in place, by direct import
  and in the Import wizard; when the three header rows are ambiguous the
  import says which rows it used and the wizard lets you choose them.
- Origin upload cache: opened Origin projects are kept on disk (per user,
  private, up to 2 GiB, least recently used first) so their books still
  load after a restart. `qz upload-cache [info|clear]` and Preferences ▸
  Interaction ▸ Origin upload cache ▸ Clear… remove them.
- A truncated or partly copied .opj is reported (import toast and Origin
  fidelity) instead of importing silently, for the header versions where
  the recorded file size was measured reliable.
- .ogs and .opj exports write every Origin designation (Y error, X error,
  Label, Disregard, Z, a second X) and column comments; the .ogs default
  graph plots every Y against its own X with its error bars.
- Graph Builder seeded from a worksheet or a recovered Origin graph puts
  Y-error columns in the error wells instead of listing them as series.
- Library Tree rows say how to open them ("Double-click to open").
- Curve fitting now includes 33 of Origin's built-in fit functions, with
  Origin's names, parameter order, formulas and default bounds:
  - Peak Functions: Gauss, GaussAmp, Lorentz, a true Voigt, PsdVoigt1/2,
    LogNormal and Asym2Sig.
  - Exponential: ExpDec1/2/3, ExpDecay1/2/3, ExpGro1/2 and ExpGrow1/2.
  - Growth/Sigmoidal: Boltzmann, DoseResp, Hill, Hill1, MichaelisMenten,
    Logistic, Logistic5, SLogistic1, SGompertz and SWeibull1.
  - Polynomial, Power and Waveform: Poly5, the 9th-order Poly, Allometric1,
    Sine and SineDamp.

  Polynomials of order 6, 7 and 8 and a line through the origin
  (Proportional) are added alongside them.

  Each one has a starting guess computed from the data, so most fits work
  without hand-tuned starting values. Origin's `Logistic` appears as
  "Logistic (Origin)" because the original Logistic model keeps its name.
  `docs/fit_models.md` lists every model with its formula and its Origin Help
  page. A model scan with no model list fits the original models plus nine
  of the new ones; the rest can be added to the scan by name.
- Curve Fit weighting: **Direct (weight column)** uses a column as the
  weights themselves, and **Scale errors with √(reduced χ²)** (on by default,
  as in Origin) can be turned off to treat error bars as absolute.
- Custom equation fits derive blank starting values from the data: leave a
  guess empty ("auto") instead of typing one. New functions: natural log,
  min/max, gamma, Heaviside/step, a conditional `if(cond, a, b)` with
  comparisons, the Voigt profile and Bessel functions.
- Global fits can hold parameters fixed and report errors with either
  covariance method.
- A fit that stalls on a parameter, or whose model is undefined at the
  fitted values, is reported as not converged with the reason.
- Worksheet column formulas speak more of Origin's language: `col(A)` and
  `col("Long Name")`, `cond ? a : b`, 1-based indexing and inclusive ranges
  (`A[1]`, `sum(A[1:10])`), `cumsum`, text comparison in conditions, and
  `sheet("Name", A)` to read another worksheet. A `sheet()` link follows its
  worksheet through renames, column changes, Append Project and workbook
  Duplicate/paste, and errors (never re-points) when the worksheet is
  deleted; reading itself or closing a circle is refused.
- Smoothing, the derivatives and the cumulative integral in Signal
  Processing propagate a bound Y uncertainty (squared weights, independent
  input points; the result is the diagonal only), with an inline "Drop
  uncertainty for this output" choice. A further linear step on an output's
  already-correlated uncertainty is refused with the reason.
- Data ▸ Rows & summary ▸ Row statistics: mean, SD, min, max, sum and N
  across ticked columns, per row, as computed columns in one undo step.
- Data ▸ Rows & summary ▸ Frequency count: bins a column into a new
  worksheet (bin start/end, count, cumulative count, percent, cumulative
  percent); values are binned against the table's own published edges.
- Signal Processing ▸ Apply to selected sheets…: the dialog's current setup
  on each selected worksheet, with a preflight, per-item status, Cancel and
  one undo step.
- The worksheet statistics footer also shows sum, SE of mean, variance,
  range and the missing count.
- Unstack can pivot on a text column, and defaults to the column with the
  fewest distinct values (2–20) rather than the first numeric one.
- A text column's header offers Sort by text.

- Calculators ▸ Film stack also predicts where each layer and the substrate
  appear in a reciprocal-space map for a chosen asymmetric reflection
  (H 0 L), default (103): Qx, Qz (Q = 2π/d, as in the RSM workshop), 2θ, and
  ω for grazing incidence and grazing exit. Coherent layers line up with the
  substrate in Qx; relaxed layers sit at their own.
- Calculators ▸ Film stack: build a layer stack on a substrate (add layers by
  hand or from the reference phases, reorder, remove) and get, per layer, the
  mismatch to the layer below, the Matthews–Blakeslee critical thickness,
  whether it stays coherent, the in- and out-of-plane strain, the strained c
  with its (00L) 2θ, and the cool-down thermal strain. Cube-on-cube stacks
  with a Poisson ratio per layer for now. Also at `POST /api/epitaxy/stack`.
- The orientation-aware mismatch card can now search supercells: it lists
  coincidence-lattice matches of the film plane on the substrate plane within
  a chosen strain and area, each with the cell counts, the strain along both
  axes, the in-plane rotation and the epitaxial relationship (film [uvw] ∥
  substrate [uvw]; 4-index for hexagonal cells). GaN on c-plane sapphire now
  finds the √3×√3 R30° match; TiN on Si(001) finds the 4:3 domain match. Also
  at `POST /api/epitaxy/coincidence`.
- Calculators ▸ Substrates has an orientation-aware mismatch card. Pick a
  film phase and a substrate phase with their planes (hkl or hkil); it
  compares their in-plane lattices, Bravais centering included, along both
  axes, with the area and angle mismatch. Si(100) and Si(111) now differ, and
  Fe(001) on MgO(001) gives the rotated −3.7 % match. Supercell (coincidence)
  matches are not searched yet. Also at `POST /api/epitaxy/surface-net` and
  `POST /api/epitaxy/net-mismatch`.
- Calculators ▸ Crystal and Calculators ▸ Substrates can now fill a lattice
  from a built-in table of 52 reference phases (substrates, metals, oxides,
  perovskites, semiconductors and others), ported from the MATLAB toolbox.
  On the Crystal tab the phase sets the crystal system and the whole cell; on
  the Substrates tab it sets the film's a for the mismatch and
  critical-thickness cards. The table is also served at
  `GET /api/reference/phases`.
- Magnetometry ▸ Units now normalizes the moment on a basis you choose:
  none (raw moment), mass, area, or volume. Each basis offers only its own
  output units: emu and A·m² for raw moment, emu/g and A·m²/kg for mass,
  emu/cm³, A/m and kA/m for volume, and emu/cm² and A·m²/m² for area. The
  basis is never inferred from metadata.
- The sample is described with value-and-unit rows for mass, volume, area,
  width, length, diameter and magnetic-film thickness. The magnetic-film
  thickness is labelled as distinct from the substrate. Changing a unit
  converts the entered number, so the physical value stays the same.
- A live, read-only calculation summary shows the computed area or volume,
  the divisor, the source and output units, the factor and the equation
  before you apply. A missing, zero, negative or non-numeric field disables
  Apply, and the panel names that field.
- Apply creates a new dataset and never changes the imported values. The new
  dataset's provenance records every input with its entered unit and
  canonical value, the basis, the output unit, the factor and the formula,
  so a reopened project reproduces the result exactly.
- A "Use metadata values" button fills the profile from the dataset's
  metadata. It runs only when you press it, fills only the fields the
  metadata states, and does not choose a basis. A Quantum Design
  `SAMPLE_MASS` header carries no unit, so it is filled as mg only as an
  assumption, and the panel asks you to verify it. It is not filled at all
  when the header's `MOMENT_UNITS` is not "0" or the moment is in A·m².
- Sample profiles can be saved by name and loaded into the form for other
  measurements. A saved profile is applied only when you load it. Saved
  profiles are stored in the workspace (`.dwk`), up to 200 of them, and
  saving or deleting one can be undone.
- The Units tab keeps its basis, profile and output unit when you switch to
  another Magnetometry tab and back.
- New backend route `POST /api/magnetometry/normalize`, backed by the pure
  `calc.sample_geometry` and `calc.magnetometry_normalization` modules.
  Tests check its conversion factors dimensionally, including
  1 emu/cm³ = 1000 A/m. The A/m, A·m²/kg and area-normalized units are
  documented SI extensions beyond the MATLAB `convertMagUnits`.
- Origin `.opj` matrix books open in the Map view, with Origin's X/Y
  coordinate mapping. A project holding only matrices used to fail to import.
- Origin `.opj` projects saved by Origin 7 and Origin 8 import. Origin 8
  projects used to fail entirely.

### Changed

- Origin window and template files (.ogw, .ogg, .otw, .opx, …) get an
  Origin-specific explanation instead of "no parser registered", and a
  failed binary import no longer suggests the text-only Import wizard.
- Export download names keep non-ASCII project names (RFC 5987
  `filename*`) and fold accents in the plain fallback ("Ångström run" ->
  `Angstrom_run`); .ogs book names follow Origin's short-name rule.
- The Library's first-run width follows the screen (210 px up to a 1360 px
  window, up to 264 px on wider ones) so Origin book names fit; tool
  windows open beside the Library instead of over it.
- A Y that belongs to a later X column is held back from the one-X plot and
  offered on its own X ("Plot each Y against its own X"); un-hiding it never
  draws it against the wrong X.
- The Map tab says why columns cannot be gridded (a constant axis, no row
  with all three values) instead of drawing an offline grid of them.
- Curve Fit: in an edited start-value table, every free parameter whose
  start you did not type (blank, or still the default it was seeded with)
  starts from the data-driven guess, as an untouched table does. Holding one
  parameter used to send the model's fixed defaults for all the others, and
  the fit could collapse. Batch fits do the same for each input.
- Curve Fit: fit templates keep Direct (weight column) weighting and the
  "Scale errors with √(reduced χ²)" choice; batch fits honour that switch.
  A direct-weighted fit's report, report sheet and ANOVA use the weights as
  given and leave zero-weight points out of N.
- The Peak Analyzer opens docked at the right edge, like Curve Fit, instead
  of over the Library and the plot's Y axis.
- **Curve-fit statistics now follow Origin / scipy / statsmodels.** Several
  reported numbers change meaning; `docs/fitting_statistics.md` has the
  definitions. Fits saved before this change keep their old definitions when
  they are recalculated, and the result overview says which set a fit uses;
  **Update statistics** on a saved fit moves it to the current set.
  - Parameter errors default to the covariance `(JᵀWJ)⁻¹·s²` (what Origin and
    scipy `curve_fit` report) instead of the Hessian of the SSR. Both are
    returned (`errorsJtj`, `errorsHessian`); `covariance: "hessian"` selects
    the old one.
  - Prediction bands are wider and confidence bands narrower. The prediction
    band adds the fit's residual variance (it was several times too narrow),
    per point for a weighted fit, and both bands use the residual degrees of
    freedom (the confidence band was about 1.6× too wide for a 3-parameter
    fit).
  - AIC, AICc and BIC in Diagnostics and model comparison use the same
    definition as the fit's own AIC (`2k − 2 ln L`). They are larger than
    before by the constant `n(1 + ln 2π)`; differences between models are
    unchanged. A weighted fit's AIC now includes the `Σ ln w` term.
  - RMSE is always the unweighted root-mean-square residual in the units of
    y, including for weighted and global fits. The weighted sum the fit
    minimised is reported separately as χ².
  - Zero-weight points no longer count as observations (n, degrees of
    freedom, errors, AIC).
- `POST /api/fitting/bands` takes `n_free` and `mse` (or `x_data` +
  `obs_var` for a weighted fit) instead of `dof`.
- Peak finding measures heights from the centre of the noise rather than its
  lower edge and estimates noise robustly, including correlated noise, so
  noisy patterns no longer return a flood of noise peaks. Reported heights
  and backgrounds of noisy data shift by about two noise standard deviations.
- Custom equations: `ln`, `gamma`, `heaviside`, `step`, `min`, `max`, `if`,
  `voigt`, `besselj`, `bessely`, `besseli` and `besselk` are now function
  names when called. A parameter with one of these names still works unless
  it is written with parentheses.
- A worksheet column's Sort ascending/descending sorts the data, as
  Origin's column Sort does: rows move together, Undo restores the order, and
  the status says what happened. Sorting is refused where `sheet()` links
  rows across worksheets. The display-only sort remains, labelled "View
  sorted … (data unchanged)".
- Recalc mode "off" is named None, as in Origin, and Recalculate now reruns
  every derived worksheet and fit in that mode.
- A CSV's quoted thousands-grouped numbers (`"1,234.5"`, `"$1,234.50"`,
  `"(1,234.5)"`) are read as numbers in otherwise numeric columns, with a
  note; identifiers with leading zeros, phone numbers and dates stay text.
- Comma cells left blank in a numeric column are always reported (decimal
  comma, thousands grouping, or neither), and rows the importer skips above
  the data are named in a note.

### Fixed

- Origin `.opj` Numeric columns (double, float, short, long, byte, complex)
  and Date/Time columns read their real values. Some used to come in as
  nonsense numbers, and others were dropped.
- Origin `.opj` worksheets import only the rows that were used. The blank
  rows Origin pre-allocates used to come in as zeros.
- Origin `.opj` text cells are kept: Text columns, and Text & Numeric columns
  holding text, appear as the worksheet's text columns. A workbook made only
  of text used to import empty.
- Origin `.opj` workbooks without a long name are titled by their short name
  (`Book1`). Many used to be titled "BA".
- Origin `.opj` Numeric, Date and Time columns keep their long name, unit,
  comment and X/Y designation; multi-line comments are kept whole.
- Origin `.opj` columns designated Group or Subject are labelled as such in
  the worksheet header and are no longer plotted as data series.
- Origin `.opj` files written by quantized state each column's real row
  count. Files written earlier still open in full.
- Origin `.opj` sheets other than the first keep their column names, units,
  comments and X/Y designations, and a workbook whose sheets were deleted or
  reordered no longer picks up another sheet's column names.
- An Origin `.opj` column is no longer dropped because one cell holds an
  implausibly small or large number; that cell is blanked and reported.
- An Origin `.opj` text column wider than ten characters is shown as text
  instead of being filed away as a fit-report sheet.
- Origin `.opj` imports say so when a dataset could not be recognised, when
  a matrix's X/Y coordinates were not found, and when an old-style file had
  to be read by inspecting its bytes.
- Deleting or filtering rows keeps the imaginary part of an Origin complex
  column on the same row as its real part.
- Origin `.opj` data that cannot be read is named in the import's fidelity
  summary instead of being left out silently.
- The Reshape preview reports the real result row count when its table is
  capped.
- Paste and import keep a row's empty edge cells and a short first data
  row: values no longer shift under the wrong header or lose a column, and
  direct import and the Import wizard read such files the same way.
- /api/stats/descriptive no longer fails on columns of tiny or huge values.
- A project import opens its primary book; the title and status bars name
  the sheet the Worksheet tab shows.
- Page setup margins no longer clip tick labels, axis titles or the title
  from an exported figure: they are blank border around the laid-out figure,
  and the page keeps its exact size.
- The Publication preview now renders exactly what Export writes (page size,
  error bars, transparency).
- An exported figure's autoscaled axes match the screen (x spans exactly the
  data), so data-anchored text boxes and arrows land in the same place.
- On screen, a text box is readable on a dark plot, and an inserted arrow
  shows its arrowhead.
- View-only edits to a graph window (axis scales, limits, stack mode) are
  autosaved, so a reload no longer loses them.
- An exported figure uses the same X/Y tick increment as the screen, and a
  break mark no longer overlaps the tick label at the break edge.
- X and Y breaks together: every panel keeps its data, on screen and in the
  export.
- Dialogs name their action (Rename, Apply, Export, …) instead of "Run".
- An Origin escape that cannot convert stays as typed, the same on screen
  and in the export; `\\+(` is a literal backslash.
- A region shade starting at or below zero on a log (or reciprocal) X axis
  draws from the left edge on screen and in the export alike.
- Stat-stage exports (bar, box, violin, strip, Q-Q, histogram) use the
  screen's theme colours and no longer add a title the screen does not show.
- Renaming an item to its own name, and Tile / Cascade with nothing to
  arrange, no longer leave an empty undo step.

### Security

- The Origin upload cache never follows a symlink (its sweep could delete
  files a planted link pointed to), keeps its directory 0700 / files 0600,
  and refuses a cache directory owned by another user.

## [0.33.0] - 2026-11-01

A **minor** security and maintenance release. It is the first published
release since 0.31.0: version 0.32.0 below was prepared but never tagged, so
its additions reach users for the first time in this release.

### Security

- Cleared the dependency advisories reported by the weekly vulnerability
  sweep: aiohttp, Pillow 13, certifi, opentelemetry-api, setuptools and
  msgpack (Python); rustls, rustls-webpki, tokio and webpki-root-certs
  (desktop shell); undici, zod and puppeteer-core (development tooling).
- The desktop auto-updater is built without its `zip` feature, which only
  unpacked Tauri v1 update bundles and pulled in a vulnerable `zip` crate.
  Updates still install from the signed NSIS installer, and a test now fails
  if the release config moves to a format the updater can no longer install.
- Recorded a dated accepted-risk entry for a minimatch denial-of-service
  advisory that affects only frontend development tooling and has no
  compatible fix (re-checked by 2027-01-31), and removed 15 stale entries
  from the advisory ignore list.

### Changed

- Dependency updates, including FastAPI 0.162, pydantic 2.14, React 19.3.1,
  Vite 8.3.5, Vitest 5.0.5, ESLint 10.13, Playwright 1.64,
  tauri-plugin-updater 2.14 and tauri-plugin-dialog 2.8.3.

### Fixed

- The WebKit cross-browser end-to-end tests run on CI again: the Playwright
  browser cache is keyed by OS release and CPU architecture, so a browser
  built for an older runner image is no longer reused on a newer one.

## [0.32.0] - 2026-10-15

A **minor** scientific-analysis release focused on comparing measurements
across worksheets and turning technique-specific results into durable,
editable figures. It also expands magnetometry from unit preparation into
sample-aware normalization and loaded-data analysis.

### Added

- **Cross-worksheet comparison:** correlate signals from two worksheets with
  explicit overlap/resampling review; compare Williamson–Hall crystallite
  results and hysteresis metrics across reviewed worksheet sets; and create
  editable trend figures from the resulting tables.
- **Magnetometry analysis:** normalize moment by mass or sample geometry,
  correct loaded M(H) data for internal field using an explicit demagnetizing
  geometry, and fit loaded χ(T), total-moment M(T), or mass-normalized M(T)
  data in a visible Curie–Weiss range with required field and sample context.
- **XRD references and durability:** import bounded text reference patterns as
  wavelength-aware, grouped, editable stick overlays; save Williamson–Hall
  calculations as durable results with exact peak inputs, diagnostics, and
  observed-versus-fit figures.
- **Reflectometry posterior diagnostics:** labeled correlation heatmaps,
  ranked parameter trade-offs, and complete matrix copy/export for DREAM
  results.
- Statistical result tables and figures now link supported rows and marks to
  the exact current source rows while retaining a frozen editable snapshot.

### Changed

- Saved statistical reporting now records effect sizes, intervals,
  assumptions, multiple-comparison handling, and missing-data evidence more
  consistently.
- Analysis workflows preserve multi-source freshness, exclusions, units,
  partial failures, cancellation, and the exact reviewed inputs used to make
  each result.

### Fixed

- Stale, missing, ambiguous, or changed source data now fail closed across the
  new multi-worksheet and technique workflows instead of silently replaying
  against different rows.
- The Node-current compatibility probe no longer fails because extreme
  autoscale fixture inputs round to adjacent floating-point values in
  different V8 versions; the shared frontend/backend fixture now constructs
  those inputs deterministically.

## [0.31.0] - 2026-10-13

A **minor** analysis release. Analysis output becomes durable: fits, peaks,
signal, reflectivity, and statistical results are saved in the project Library,
track whether their source data has changed, and can be reopened, re-run,
exported, reported, or turned into editable figures. A searchable Analysis
Center and shared input selection tie the tools together.

### Added

- **Durable analysis results** for Curve Fit, Peak Analysis, Signal
  Processing, Reflectivity, Statistical Tests, Distribution, Fit Y by X,
  Variability, Outlier Screening, and Multivariate (correlation/PCA). Results
  persist with the project, show Current / Out of date / Pending / Source
  missing, and refuse to report or recompute against changed data.
- **Analysis Center:** searchable launcher with Recommended, Recent, Favorites,
  All tools, and Existing results views, plus a unified Statistics workspace
  that collects saved statistical results with copy/export.
- **Shared analysis selection and batch runs:** a standard Review inputs panel,
  Run By and multi-worksheet batches with per-input status and cancellation,
  and exact saved row subsets for Curve Fit and Peaks.
- **Editable figures from saved statistical results** (histograms, group means
  with SD error bars, regression fits and intervals, PCA scree/scores,
  variance components, outlier screens).
- **Signal Processing and spectral analysis workbenches** with recipe replay.
- Improved XRD peak detection with manual peak curation.

### Changed

- Dependabot now also proposes updates for the desktop shell's Rust crates.

### Fixed

- Fortran-style `D` exponents parse correctly in imports.
- A flat channel autoscales the same on screen and in export.
- Clipboard copies of result tables neutralize spreadsheet formulas.

### Security

- Bumped `rustls` to 0.23.45 (GHSA-2mjx-qc3c-rqvc, TLS 1.3 handshake messages
  accepted across encryption-level boundaries) in the desktop updater.

## [0.30.0] - 2026-10-05

A **minor** usability and plotting release focused on making Quantized behave
like a polished desktop analysis workspace. It adds discoverable independent
plot and worksheet windows, redesigns the application menus, and makes 2-D XRD
box and sector integrations directly editable and reliable.

### Added

- **Multi-window plot and worksheet workspace:** open independent plot or table
  windows, bring them forward from the Window menu, and arrange, minimize,
  maximize, restore, or close them without losing access from another view.
- **Interactive XRD map integration:** box and sector selections expose visible
  drag handles, stay within the map, and update horizontal or vertical slice
  results as their geometry changes.

### Changed

- Rebuilt the application menu bar into compact task-based menus with one-level
  flyouts, live checked/disabled/destructive states, complete keyboard
  navigation, focus restoration, viewport clamping, and consistent shortcut
  hints. Long Data, Plot, Analyze, File, Window, and View menus no longer form
  a single scrolling wall of commands.
- Window actions now target the frontmost visible window and reveal the Plot
  workspace when needed, so commands never appear to do nothing from Map or
  Worksheet views.

### Fixed

- Fixed empty XRD slice plots and unreliable box/sector resizing, including
  clamped edge and corner dragging and regression coverage across display
  scales.
- Right-clicking an XRD map no longer begins an ROI gesture; context actions
  remain independent of primary-button drawing and resizing.
- Sector geometry is now stored per dataset and reset safely during workspace
  replacement, preventing one reciprocal-space map's selection from leaking
  into another map or a reopened project.
- Window arrangement and maximize behavior now respect the available workspace
  bounds and keep title bars reachable after layout changes.

## [0.29.0] - 2026-10-04

A **minor** release focused on turning imported instrument and Origin projects
into safe, understandable analysis workflows. It adds project-level Origin
migration review, a technique-aware workflow workspace, Pipeline Studio
preflight/replay hardening, project-aware batch figure creation, and a broad
real-data plotting and export parity pass.

### Added

- **Technique-aware Workflow workspace:** SIMS, XRD, reflectometry,
  magnetometry, transport and spectroscopy datasets now open into a guided
  analysis path with provenance, dimensions, lazy-load state, existing results
  and direct links to the appropriate tools. Unknown data stays generic rather
  than being guessed incorrectly.
- **Origin migration cockpit:** imported projects receive a dedicated review
  surface that groups graph windows, unresolved sources and fidelity issues.
  Repeated missing workbook references can be resolved atomically after a
  complete-scope preview; choices support undo/redo, workspace round-trip,
  deletion pruning and lazy workbook loading.
- Large Origin reviews now use search, 40-row paging, bulk Review later/Return
  to review actions and project-scoped state reset. A repeatable local corpus
  auditor and exact migration contracts cover representative projects up to
  the 127 MB PNR corpus file.
- **Pipeline Studio 2.0:** inspect input, step and output state; safely edit,
  reorder, duplicate, enable, disable and remove steps; preview structural
  changes without mutating data; and fail closed on broken references,
  incompatible settings or stale columns.
- Pipeline templates now replay deterministically with recursive
  canonicalization and version-1 migration. File-batch replay is cancellable,
  preserves completed files, removes partial in-flight outputs from live and
  undo/redo state, and records output provenance across Workflow, Recipe
  Library, editable figures and reports.
- **Batch Figure Builder:** apply one Plot Recipe across selected worksheets,
  workbooks or folders with ready/review/blocked preflight results, independently
  editable figure outputs, an optional multi-panel page, project-aware search
  and selection, cancellation, and an all-or-nothing ZIP export in PDF, SVG,
  PNG or TIFF.
- **SIMS:** direct depth-axis rescaling (multiply or divide x, then add an
  offset), bound to the x unit it was made for. Batch processing applies the
  same settings to several profiles; every profile is checked first and any
  warnings are reviewed once before anything is created.
- **Import coverage:** ORSO `.ort` reflectometry, multi-sheet Excel, Bruker
  multi-scan `.brml` reciprocal-space maps, additional NCNR/OPUS extensions,
  QD companion/error channels and legacy-workspace null-cell migration.
- **Origin:** a "Recover…" window for graphs whose saved curves could not be
  matched to an imported workbook — inspect a compatible workbook's columns
  or rebuild an editable plot from it.

### Changed

- Plotting defaults and exports were audited against roughly 200 real
  magnetometry, XRD, reflectometry, spectroscopy and SIMS files. Screen and
  publication rendering now share scientific unit display for Å, µm, cm⁻¹ and
  emu/cm³, log colour-bar decades, peak anchors and recovered Origin graph
  state.
- Plot navigation now handles log and reciprocal pan/zoom safely, keeps the
  second Y axis linked through navigation and history, and makes double-click
  reset return to autoscale.
- Origin/CSV export writes rich scientific graph titles; CSV files add a UTF-8
  BOM only when non-ASCII text requires it for Excel. Magnifier insets persist
  and export through SVG, PDF, Copy Figure and reports.
- Log axes on automatic number format label only their decades (1, 10, 10²…).
- Switching a plot window to another dataset now clears hand-typed axis
  titles, so the new data's own axis names show instead of the old ones.
- CI now cancels only superseded runs, preserves back-to-back `main` results,
  shards the frontend suite and keeps the required aggregate gate fail-closed.

### Fixed

- Applying recovered Origin graphs one after another no longer carries the
  previous graph's stacked, polar, grouped or second-axis state into the next.
- Fixed real-data plotting failures including positive-field-first VSM
  autoscaling, mixed X-unit overlays, XRD wavelength handling, reflectometry
  error channels, reciprocal-space map routing, log-axis error bars and
  screen-versus-export axis/layout mismatches.
- Damaged, ragged and hostile instrument files now fail with bounded, useful
  errors instead of exhausting memory or producing server errors; supported
  text, Excel, NetCDF, Bruker, SPC and JCAMP paths retain clearer parser notes.
- Map selection, multi-panel layout, annotations, error bars and inset
  rendering retain their intended state across editing, export and reload.

## [0.28.0] - 2026-10-02

A **minor** release: the 50 pull requests since `v0.27.0` lock the
local API behind a per-launch token, harden imports against hostile files,
add decimal-comma import, and close a long list of screen-versus-export
mismatches. Also new: a Project Explorer for dense Origin imports, Curve Fit
statistics and global fits, a Statistical tests workshop, and Office-ready
figure copy.

### Upgrade notes — action needed

- **Launch through `qz` (or the desktop app).** The page now needs the
  per-launch link that `qz` opens and prints. A bookmarked localhost URL
  from an earlier launch shows a locked page; use the new launch link.
- **Scripts calling the local API** must set `QZ_API_TOKEN` before starting
  the server and send it as the `X-Quantized-Token` header (`QuantizedClient`
  does this for you). See `docs/api_auth.md`.
- **The Tauri desktop app always starts its own server**; it no longer
  attaches to one that is already running.
- **CSV exports** prefix text cells and headers that start with `=`, `+`,
  `-`, `@`, tab or CR with `'`, so spreadsheets do not run them as formulas.
  Numeric cells are unchanged.
- **Request size limits:** request bodies over 256 MiB (JSON/raw) or
  512 MiB + 1 MiB (file uploads) are refused with `413`.

### Import

- **Decimal comma:** delimited text and the Import Wizard take a decimal
  separator (Auto / `.` / `,`). Auto converts a column only when the reading
  is unambiguous; an ambiguous `1,500`-style column still fails and points
  to the wizard. Semicolon-delimited decimal-comma files are detected.
- **Parser notes** (dropped rows, converted columns) show as one toast per
  import and read as sentences in Metadata.
- Sturdier text parsing: whitespace-aligned columns no longer shift, quoted
  cells are read correctly, UTF-8/UTF-16 BOM files keep their first row and
  labels, and the wizard never takes a comment line for the header.
- Excel keeps gappy leading rows; NCNR and `.refl` files handle ragged or
  cut-off rows and report what was dropped; a header-only CSV says
  "no data rows".
- **File-safety limits:** NetCDF files that point at external or virtual
  data are refused, and NetCDF, `.brml`, `.xlsx`, SPC and JCAMP imports cap
  declared sizes, so a tiny hostile file cannot exhaust memory. XRDML/BRML
  files with a DTD are refused. Damaged `.brml`/`.xlsx` files give a clear
  error instead of a server error.
- Bruker RAW patterns now decode Kα1/Kα2, so the Kα1 preference applies.
- **CIF import** loads a structure as a lattice preset for Pawley and the
  Crystal calculator.

### Plotting & export

- **Half-open limits:** a blank side of an axis or colour-limit pair is auto,
  not 0, on screen, in export, `.ogs`, save/reopen, recipes and undo. A limit
  at or below zero on a log or reciprocal axis is treated as auto.
- **Line width and marker parity:** series with no explicit width or size
  export at the width and size the canvas draws.
- **Break at gaps** now reaches the export and `.dwk`, follows row
  exclusion, and is a single undo step.
- **Excluded rows** are greyed by default, with a status-bar toggle.
  Exports, copies and Send to report ask whether to grey or omit them, and
  facet, encoded and polar plots now treat them as the canvas does.
- **Legends:** drag to resize; the legend title shows on the canvas; empty
  names drop their row on screen as in export; Y2 export legends list every
  series.
- Graph Builder **Color-by / Symbol-by / Label** encodings, including
  gradients and text factors, draw on the editable plot, the preview, box,
  violin, bar and facet plots, and in export.
- Polar views export as polar figures; waterfall plots gain an X offset;
  autoscale covers error bars; a fixed X limit no longer undoes a live zoom.
- **Copy Figure** places a 300-DPI PNG plus an Office-sized HTML image on
  the clipboard, and a text-as-outlines SVG where the browser accepts one.
  `POST /api/export/figure` and `/figure-page` accept `svg_text_as_paths`.
- PDF export embeds TrueType fonts instead of Type 3.
- Built-in Plot Recipes for XRD, reflectivity and M(H); recipes now capture
  multi-panel layouts and map views.
- Stat plots: long category labels wrap or rotate, the summary table
  persists, and bar/violin plots show raw points and summary marks.
- Ternary and vector-field workshops; vector map export.

### Analysis

- **Curve Fit:** confidence/prediction bands, diagnostics, model comparison,
  ODR when an X-error column exists, a **Global fit** mode, and a rendered
  LaTeX preview of custom equations.
- **Statistical tests** workshop: normality, two-sample, group comparison,
  regression, partial correlation and power tests, each with a plain-
  language reading.
- Peaks: Advanced find settings, batch integration with a trend dataset, and
  fits weighted by each dataset's error column.
- Reflectivity: residual plot with a linked data/model/residual/SLD view,
  spin asymmetry, and graded (spline) SLD layers that can be fitted.
- Custom demagnetization geometry by dimensions.
- Quick Plot and Quick Figure Builder pair each Y with its own X on
  `X,Y,X,Y` sheets, attach error columns with a confidence grade, and add
  Label and Grouping roles.

### Workflow

- **Project Explorer** for dense imports: focus a folder or workbook,
  breadcrumbs, Data/Figures/Reports filters, and type-ahead in the tree.
- **Pipeline steps:** transform-step parameters can be edited in the
  Pipeline panel, with undo.
- **Page rename:** an open figure page follows a rename made in the Library.
- **Snapshot to New Window** says why it did nothing in polar, stat and
  multi-panel modes.
- Find in project searches text-column cells and scrolls to the hit; rename
  a categorical level in place; export an Origin project (`.opj`, data only).
- Queued jobs and exports show progress and can be cancelled.
- Failed actions now report themselves: partial batch outcomes, failed
  loads, refused browser-storage writes and failed corrections no longer
  pass silently.
- More gestures are single undo steps; report and figure deletions can be
  undone; save/reopen keeps fit recipes, frozen figure cells and waterfall
  layout.

### Accessibility

- Every icon-only control has an accessible name; dialogs, tool windows and
  the command palette carry proper roles and labels.
- The Library tree, tab strips, segmented controls and legend entries work
  from the keyboard; floating panels move and resize by keyboard.
- Focus returns to its opener after the palette and toasts; toasts pause
  while in use; disabled controls explain why.

### Security

- Local API token, Content-Security-Policy and request body limits (see
  Upgrade notes).
- Pack Project flags sources outside the data folders or of unknown type and
  leaves them out unless you include them.
- LaTeX report and Origin `.ogs` exports escape text so labels cannot inject
  commands.

### Performance & reliability

- The first plot after an import reuses the server's parsed copy instead of
  re-uploading it; cell edits upload only the changed cells.
- Large files plot faster through a binary column transport.
- Legend, colour and width edits patch the live plot instead of rebuilding.
- Formula aggregates, worksheet sort and the stats footer are much faster
  on large data.
- Smoother canvas resizes and Library scrolling.
- Removing, adding or reimporting columns keeps figures, specs and workshop
  picks pointed at the right column.
- Fixes for stale results after switching datasets, Remove All, workspace
  replacement and project locks.

## [0.27.0] - 2026-09-27

A **minor** release: the 87 merges since `v0.26.1` add a Report workflow with
real embedded figures, live derived expressions with error propagation,
saved transformation recipes, SIMS depth-profile calibration and comparison,
persisted statistics marks, model-fit peaks, a first-plot Home onboarding
flow and contextual Help — alongside a window-drag/resize performance pass
and a batch of concurrency and data-integrity fixes.

### Report

- **Send figure to report**: any plot can be sent straight into a report,
  with block controls and export warnings surfaced inline.
- Reports now embed the actual rendered figure — not a placeholder — in
  Word, PowerPoint, HTML and LaTeX export, and the Library's **Add to
  Report** action carries source references and non-finite values through
  intact.
- Peaks "→ Report" carries model-fit errors and the fit objective with it.

### Derived data and transforms

- **Derived expressions**: Python-like formulas with units, fitted values,
  and error propagation through the expression.
- **Saved transformation recipes**, with live previews for append / join /
  reshape / split / resample-and-align onto a common grid, metadata cleanup,
  and promotion of transform outputs to factors.

### Fitting, peaks and reflectivity

- Fit models now ride the `.dwk` workspace file, so a saved fit survives
  reopening the workspace.
- Peak Analyzer gained a fit step on a mixed-shape peak model engine, a v2
  recipe with direct-add and "Fit this range", and a batch-recipe fit with
  an uncertainty/diagnostic table; fitted peak edits and model-fit errors are
  now durable and publish to the peak table.
- Reflectivity workshop: a full fit mode (engine + `/api/reflectivity/fit`),
  durable fits with history/restore/curves/report, and a DREAM posterior fit.
- Pawley whole-pattern refinement is exposed in the UI.

### Statistics

- Box/strip/variability plots persist raw-point, jitter, summary, error-bar
  and label marks with export parity, and the summary table links back to
  its selected groups.
- Point jitter and selection are now keyed to original rows.

### SIMS

- Depth-profile **calibration, background, normalization and smoothing**,
  plus log comparison, decade offsets and region measures.

### Onboarding, Help and Calculator

- A first-plot **Home** onboarding workflow walks a new user through their
  first plot.
- Contextual **Help** on major object menus.
- Calculator: atomic bond angles, copy precision, photon quick picks, unit
  converter parity, and strict XY pairing.

### Performance

- Floating-window drags and resizes are isolated from the rest of the UI,
  keep resize targets reachable at the canvas edges, and no longer show a
  gutter when maximized (the window title is preserved in full).
- Bundle diet: preload pruning, lazy dialog bodies, and taking React/
  React-DOM 19.3.0.

### Fixed

- Corrections now preserve bound uncertainty columns: additive operations leave
  their magnitudes alone, scale/unit/normalization operations propagate the
  appropriate absolute factor, and unsupported nonlinear propagation fails
  clearly instead of silently manufacturing error bars.
- Save As now refuses to overwrite raw sources recorded only on a workbook,
  including packed-project sources.
- Fast floating-window drags and resizes no longer lose their final movement or
  remain armed after pointer cancellation/window blur; clicks without movement
  no longer create empty Undo entries.
- Recent desktop files are keyed by source path, so identically named files in
  different experiment folders coexist and show compact folder context.
- Long-path test fixtures now distinguish unsupported Windows host policy from
  product failures.
- Cold first imports of heavy modules are serialized behind per-package locks
  with bounded waits, closing a startup race (BUG-032).
- The export render lock is now bounded and `savefig` calls are de-duplicated,
  closing a concurrent-export race.
- A lazy dialog body now takes focus in the task that paints it, instead of
  racing the paint (BUG-031).
- The local API now admits only the app's own origin (BUG-030); an open modal
  gates the app's global keyboard shortcuts (R15).

### Under the hood

- e2e coverage extended to Firefox and WebKit for the dialog/modality specs.

## [0.26.0] - 2026-09-18

A **minor** release: the 43 merges since `v0.25.0` add new user-facing
surfaces — a user-settable category order, nested two-factor box plots,
greyscale and dash/marker-cycled export, persistent 2-D map views and a
durable XRD peak table — alongside a large data-integrity batch (text columns
that stay on their rows, non-finite cells that survive save, screen/export
parity) and a keyboard-focus overhaul.

### Plotting and export

- Plots are now drawn with a full axis box by default — a border on all four
  sides (left y, bottom x, right y2 and top) rather than just the left-and-
  bottom "L". This matches Origin's own default and the convention most
  journals expect, and it applies to the main stage, pop-out plot windows,
  panel cells and multi-panel overlays alike. Exported figures follow: they
  previously drew tick marks along the top and right edges with no border for
  those ticks to sit on. Turn it off per plot with **Axis box (frame)** in the
  Inspector; a saved project that had it off keeps it off.
- Exported SVG figures now carry axis titles, tick labels and annotations as
  real, editable `<text>` instead of outlined glyph paths, so they can be
  retyped in Illustrator, Inkscape or Origin (mathtext stays outlined). The
  correlation heatmap's cells are now vector rather than an embedded image.
- Exported figures draw the same marker shapes as the screen; every marker
  previously exported as a filled circle.
- **Greyscale (print-safe)** export option: each series gets an evenly spaced
  grey plus a forced dash/marker cycle. It covers single figures (including
  y2, x-axis breaks and grouped figures) and every page export — Export
  page…, the Figure Page composer (whose preview turns grey too), and
  exporting a saved page from the Library. Only the export changes; the
  screen stays in colour. Error-bar caps now take their series colour in
  vector output, which also fixes caps drawn in the wrong colour in ordinary
  coloured exports.
- **Vary dash & marker** (Appearance menu, off by default) cycles line dashes
  and marker shapes by series position, so series stay distinguishable
  without relying on colour. A plot cycles on screen only when its export
  will draw the same dash and marker at the same position; grouped, faceted,
  stacked, polar and statistical views opt out on both sides.
- The `tol-bright` series palette had two identical colours; its eighth slot
  now has a distinct colour that stays distinguishable under simulated
  colour-vision deficiency and legible on the dark canvas.
- Exporting a (non-faceted) figure now leaves out excluded and Data-Filtered
  rows, as the screen does, with error bars kept aligned to the remaining
  points.
- Long exports can be cancelled: each running export shows its own
  **Cancel** control in the status bar, and nothing is written to disk once
  it is cancelled. (A clipboard copy cannot be cancelled once the image is
  produced, and some download paths are not cancellable yet.)
- Screen, export and reopened project now agree in five cases that used to
  diverge: a saved x-axis break is drawn on screen after reopening the
  project; a waterfall's per-series stagger reaches the exported figure; a
  legend rename is exported as a legend label only (the data's real label
  and units are unchanged) and shows verbatim on facet, stacked and x-break
  panels; hidden series no longer shift the other series' export colours;
  and a grouped figure exports each level with its channel's dash, width,
  marker and colour as the screen draws them.
- The baseline **Fit from region** rubber band can also bound the y range (a
  2-D box, as in the MATLAB toolbox).

### Categorical data and statistics

- **Reorder levels…** (worksheet column context menu on a categorical column)
  sets a category's display order: move levels up or down, sort by label, or
  reset to code order. The order applies wherever the categories are drawn:
  bar, box, violin and strip axes, XY group split, Tabulate, facets,
  variability charts, the Data Filter's level list and publication exports.
  Level codes are never renumbered, so formulas, filters and macros that
  refer to a code keep their meaning, and a level that appears later still
  shows up, at the end. Each reorder is one undo step.
- Box, violin and strip plots gain a **then by** picker beside **group by**,
  which draws one box per combination of the two columns that has data
  (labelled `lot = 1 / wafer = 3`). The boxes are nested in order, following
  each factor's level order. Facets nest the same way, and exports carry the
  combined labels.
- Split Dataset now honours a column's categorical levels (an explicit level
  table, or an Origin text column). A small categorical column used to be
  treated as continuous and pooled into one group named after a level code;
  children are now named after their level.
- Corrections never applies numeric transforms to categorical level codes; it
  preserves their table and order through offsets, backgrounds, unit changes,
  smoothing, normalization and derivatives. Resample preserves a coincident
  grid exactly and refuses a different grid rather than interpolating codes or
  silently mixing methods. Reimport and workspace reopen preserve the same
  categorical metadata in both raw and corrected copies.
- Duplicate, Freeze copy, Extract rows and `.opj` export keep categorical
  level labels. Duplicate and Freeze copy used to reduce them to raw codes.
- The Stat Stage no longer keeps a group-by pick on a column you have since
  marked non-categorical. Changing the type back restores the pick.

### Data integrity

- Text columns (sample ids, operators, run labels) stay attached to their
  rows through Extract, Split, row exclusions and the Data Filter, facets,
  inserting and deleting rows, Merge, x-trim corrections and lazily loaded
  Origin previews. Each of these could previously pair a text cell with
  another row's measurement, and inserting or deleting rows could delete
  text cells beyond the last numeric row, which on a text-only Origin book
  meant the whole worksheet. Resample, which creates new rows, now drops
  them.
- Worksheet cells holding NaN, ±Infinity or −0 now survive save and reopen
  across `.dwk` save, autosave, Pack Project and workbook transfer. Ordinary
  data serializes byte-identically, so this is not a file-format change.
- Opening an NCNR reductus `.refl` file now plots only the measured
  reflectivity. Its uncertainty becomes the Y error bars and its Q resolution
  the X error bars; previously these were drawn as three separate curves.
  This also works with `R`/`dR`/`dQ` naming, blank (dimensionless) units and
  extra columns. The roles survive rebinding a window, reimport and a manual
  override, and the uncertainty columns stay in the worksheet.
- The Data Filter is part of undo. A slider drag or a typed value is a single
  step, and Ctrl+Z works while a slider has focus. Previously one Ctrl+Z
  could remove both a row exclusion and a filter, a redo could wipe out a
  filter, and a cleared filter could come back.
- Automatic recalculation handles datasets upstream-first, so a derived
  dataset is never rebuilt from a stale parent. A recalculation that fails
  now leaves that dataset, and anything derived from it, marked stale
  instead of clean. If a background-subtraction reference has been deleted,
  recalculation says it ran without it.
- Lazily loaded Origin books: row exclusions and filter edits are refused
  with a message while the book is still loading, instead of being silently
  discarded when its full data arrives. If loading the full data failed, the
  message now says why and suggests relinking or re-importing; it used to
  say "try again in a moment" forever. Pack Project and Save/Save As load
  pending books first and refuse, naming the book, if one cannot be loaded.
  Pack Project could previously ship a book's preview rows as its data.
- Warnings from migrating an older project now appear on every load path
  (crash recovery, autosave restore, Append Project, workbook Paste), not
  only File ▸ Open.
- Paste and Duplicate now say when a lineage or background-subtraction
  reference could not be carried across. A dropped background reference
  changes the plotted data, so it is reported separately.

### Analysis

- XRD: fitted peaks are saved with the project as a peak table, from which a
  Williamson-Hall analysis runs in one click. Editing a cell, changing an
  exclusion or changing a unit invalidates the table instead of leaving it
  describing data that no longer exists.
- 2-D maps: each map's colormap, scale, colour limits and cut slices are
  saved with the project. Slices survive a regrid or a colour-limit change;
  a slice the new grid cannot place is parked in a strip on the stage with
  the reason and stays removable. Opening a map no longer marks the project
  modified. A map window for a dataset other than the active one has
  colour-limit fields in its own toolbar.

### Library, search and Help

- In Tree view, a worksheet is now a compact one-line row like a graph,
  where it used to be a tall card. Its sparkline preview is an opt-in toggle
  per row and is remembered. Folders, workbooks, worksheets and graphs each
  show a type glyph.
- Large Libraries: Tree and Details (which also shows search results) render
  only the visible rows once past 150, and folder counts and selection
  lookups are indexed. Keyboard navigation continues past the visible
  window, screen readers are told the full row count, and if the focused row
  scrolls out of view, arrow keys and Delete keep working.
- The Details and Tiles views gain the Tree's rename, move and drag-and-drop:
  a drag grip, the same drop cues, and keyboard rename.
- Find in project searches instrumental metadata that did not become a
  channel: text-column and other column names, label rows (where sample ids
  live) and the file's preamble comments.
- Help search finds every described command, including ones such as Relink
  Sources, Paste Workbook, Take Over Editing and Open as Copy that it could
  not reach before.

### Keyboard and accessibility

- Dialogs and workshop panels take focus when they open, keep Tab inside,
  close on Escape and return focus to where it was, and this now includes
  Split, Separate, Combine, Reimport All, Shortcuts, Text Format Help,
  Preferences and Help. Escape is handled by one ordered ladder (menu, live
  gesture, window, workspace, selection, app), so a single press closes the
  innermost thing and nothing behind it. Known issue: with Preferences open
  over a confirmation, one Escape still closes both (BUG-018).
- Screen readers announce import, export and fit progress from the status
  bar, without interrupting.
- The Library marks the dataset bound to the active window with
  `aria-current`, separately from multi-selection.

### Under the hood

- About 42 kB of JavaScript moved off the startup path into lazily loaded
  chunks, which absorbs everything above: the startup bundle (~889 kB) is
  no larger than in 0.25.0.
- The central store module (`store/useApp.ts`) shrank from 2,808 to 1,450
  lines as seven domains (recalculation, ROI gadget, row state, plot-view
  settings, reports and figure documents, bulk view appliers, workspace
  hydration) moved into their own modules, most behind a characterization
  test written before the move.
- Dependency security updates: `anyio` 4.14.2 and `js-yaml` 4.3.2. The Rust
  advisory register was re-verified; everything in it is still blocked on
  upstream Tauri/gtk releases.

## [0.25.0] - 2026-09-08

A **minor** release: the window since `v0.24.0` adds new user-facing
surfaces — Pack Project, project trash, and the import wizard's error-
binding and metadata work — alongside a performance batch and the
completion of P1.1 project lifecycle.

- Pack Project: File → **Pack Project…** (desktop app) creates a portable,
  self-contained copy of the open project next to a folder you pick — the
  packed project file plus a verified copy of every reachable source file
  — after a review step that shows each source's readiness, size, and any
  blockers. Progress is shown per file and by bytes, packing can be
  cancelled at any point, and an existing destination folder is never
  overwritten. Your open project and original data files are never
  modified. Sources that are missing or offline keep their original
  absolute paths in the packed copy. Backend: staging, verification, and
  atomic publication of the bundle (an atomic no-replace rename on Linux,
  macOS, and Windows), with a cancellable, pollable orchestration job.
- Relink Sources now detects when two datasets with different recorded
  source paths would be pointed at the same file (for example `/old/a.csv`
  and `/OLD/a.csv` after a folder move) and asks you to choose which
  dataset keeps that file instead of silently relinking both. The other
  dataset is left exactly as recorded.
- Project files (P1.1 completion): Open Project and Save As now open in
  your current working folder (the one you last imported from, opened, or
  saved into), and Save As suggests the open project's own name. Reopening
  a Recent Project after relaunching the app asks you to confirm the file
  in its own folder instead of failing with "could not be reopened"; a
  moved or deleted project offers **Locate…**; a project on a disconnected
  drive says so and waits for you to reconnect (nothing is removed or
  relinked); a project you lack permission to read is reported as such
  rather than as "not found". Quick save no longer tries to write to a
  project on a disconnected drive.
- Project trash: deleting a figure, page, report or folder now goes to trash
  rather than away. Reports and legacy publication figures recorded no undo
  entry at all before, so trash is their only recovery path. Restore is
  dependency-aware — a figure whose bound dataset is also in trash brings the
  dataset back with it and says so; if the dataset is gone entirely the figure
  restores with its binding cleared, exactly as opening a project clamps a
  dangling reference. Folder restore re-homes members and child folders still
  sitting where the delete sent them and leaves anything you have moved since.
  The panel shows counts by kind, per-row size, and the retention rules
  (128 MiB, plus the existing count and age caps; the newest entry is always
  kept). **Empty trash** names exactly what would be lost, and the Library
  dataset menu gains a **Delete permanently…** that states it bypasses trash
  and cannot be undone.
- Import Wizard — error columns. An error column is now bound to what it
  describes, and the pairing survives everything: saving an import filter and
  reapplying it used to restore the roles and silently drop every pairing, and
  a CLI or API import emitted error columns as ordinary channels with no
  record at all. Bindings are stored against raw file columns, so a saved
  filter still applies to a file whose channel numbering has shifted. The
  wizard offers the backend's inferred pairings as explicit, reviewable
  suggestions — never applied automatically — and applying one assigns the
  role and persists the binding together. A saved binding the backend has to
  reject is shown with the reason, naming the column rather than an index,
  instead of vanishing.
- Import Wizard — file preamble. Instrument header lines such as
  `Temperature: 300 K` or `##SCAN RATE=2` are parsed into structured fields
  and shown in the wizard, so a scan's conditions are readable instead of
  buried in free text. Every line is still retained verbatim and searchable as
  before. A key repeated with different values resolves to the last one and
  says so rather than overwriting silently. The wizard also shows the file's
  own label-line text separately from the column names you can edit.
- Import Wizard — categorical columns. A continuous numeric column mistakenly
  marked categorical produces one level per row; the wizard now shows that
  before import and blocks Import by default, with an explicit **Import large
  category anyway** override for the genuine case (hundreds of real sample
  IDs). Case-only collisions such as `Fe` and `fe` are reported as warnings
  and never merged — the distinction is real in some notations. Imported
  category names now also reach the Data Filter and the statistical tools
  (test chooser, box/violin/strip), which previously showed the raw numeric
  codes.
- Recipe Library: peak recipes, graph templates and fit models can be exported
  and imported as files, round-tripping losslessly; a malformed or
  wrong-shaped file is refused with a reason rather than partially loaded.
  Toolbar gains **Import recipe…**, which identifies the kind from the file
  itself. Each row gains a **Details** disclosure showing scope, schema
  version, timestamps, technique, tags and the kind's own facts (plot channels
  and marks, analysis steps, peak baseline/model/report, a fit model's
  equation and parameters, a graph template's style and override counts), plus
  the actions actually available for that row.
- Project files are saved more defensively. A save is now flushed and synced
  to disk before the atomic replace, closing a window in which a crash or
  power loss right after the rename could leave a zero-length or partial
  project file where a good one had been. Saving is refused outright — before
  any temporary file is written — when the destination is a data file the open
  project declares as one of its own sources, so Save As can no longer
  overwrite your raw data; the refusal is now reported to you rather than
  looking like a cancelled dialog.
- Extend the dataset-handle cache (`routes/_datasetcache.py`) to
  `/api/plot/series`: a committed zoom/pan on an already server-decimated
  series used to re-POST the whole dataset on every step. Measured on a
  1M x 7 dataset: ~11.8s server wall time resending the full payload on a
  windowed re-fetch vs ~0.3s reusing the handle (~38x). `PlotRequest` now
  extends `CachedDatasetRequest`; the frontend allowlist
  (`lib/api/datasetCache.ts`) adds `/api/plot/series`.
- Perf: vectorize the Debye D_3(u) heat-capacity integral in
  `calc/fit_models_special.py` (`_debye`, `_debye_einstein`) — replace the
  per-x-point `scipy.integrate.quad` loop with one fixed-order (N=32)
  Gauss-Legendre quadrature evaluated across the whole array (closed-form
  saturation above u=30, series below u=1e-4, same as before). Matches the
  old per-point quad implementation to ~1.5e-12 max relative error. A
  10k-point `evaluate()` call drops from 116ms to 17.5ms; `curve_fit(Debye)`
  at a matched 229 iterations drops from 57.7s to 7.4s (~7.8x); the
  default-registry AICc `scan_models` at 10k points drops from ~107s to
  ~88s. Golden parity (`calc_fit_models.json`) unchanged at rtol=1e-9.
- Frontend: `setCellValue`/`setCategoricalCell` (worksheet single-cell edits)
  now recompute formula columns incrementally — only the edited row — via a
  new `lib/formulaIncremental.ts`, instead of an unconditional full
  `recompute` over every row for every formula (~4.2s -> ~18ms per edit on a
  1M-row, 2-formula dataset). Falls back to the full recompute whenever a
  formula isn't provably row-local (an aggregate, `lag()`/`diff()`, a
  recode, or one already carrying an error) so correctness never depends on
  the fast path. Both cell-write actions also now patch the edited row via
  the same outer-array `.slice()` pattern `setCellBlock` uses, rather than
  a full-array `.map`.
- Fix a large `/api/parsers/upload`/`/api/import/template/upload` (Origin
  template) CSV/file import blocking every other request (job-queue
  polling, `GET /api/health`, other windows' plot fetches) for the whole
  parse: the synchronous, CPU-bound parse ran directly on the event loop
  inside these `async def` handlers instead of via `run_in_threadpool`.
  Also found and fixed two related GIL-monopolizing single-call bottlenecks
  uncovered while writing the regression test (FastAPI's default
  `jsonable_encoder`/`json.dumps` response encoding, and whole-array
  `ndarray.tolist()`/bulk `zip()` transpose calls in `io/delimited.py`) that
  each independently held the GIL long enough to stall a concurrent request
  even after the parse itself moved off the event loop; all three are now
  chunked or bypassed (`routes/parsers.py`, `routes/_payload.py`,
  `io/delimited.py`). Regression coverage in
  `tests/test_upload_concurrency.py` drives the real app under a live
  uvicorn socket and asserts `GET /api/health` stays responsive while a
  large upload is parsing.
- Perf: `io/delimited.py` (`import_csv`) gets a bulk-numeric fast path
  (`io/_delimited_fast.py`) for regular files — a lazy, on-demand
  tokenizer for layout detection plus a straight-to-`np.loadtxt` parse of
  the data block, bypassing the Python-level tokenize/transpose/convert
  stages entirely when a cheap prefix probe and the real parse both
  succeed. Any ragged row, text/NA cell, or parse failure anywhere falls
  back to the original path unchanged (verified bit-identical on every
  delimited fixture plus targeted ragged/text/NA/datetime/CRLF/semicolon
  cases). Measured on a 1M x 7 numeric CSV: `import_auto` 10.25s -> 1.88s
  wall time, 989MB -> 546MB peak memory (tracemalloc); a 100k-row file:
  0.56s -> 0.16s.
- Remove the never-wired bug-report downloader (`lib/errlog.ts`): its
  `/api/debug/report` fetch had no backend route, so the server half of
  every report silently dropped. The P3.4 diagnostics bundle is the
  supported path.
- Route every 422 calc adapter through a shared `CALC_ERRORS` mapping
  instead of one bespoke `except ValueError` per route (`routes/`).
- Share delimited-file parsing helpers across `io/` parsers and apply the
  D5 nan-row fix to the SIMS parser as well.
- Generate frontend API types from the OpenAPI schema, with CI drift
  detection so hand-edited types can't silently diverge from the backend.
- CI: parallelize backend tests with pytest-xdist, cache dependencies, and
  drop a redundant job.
- Docs: make `CLAUDE.md` the single agent-instruction file; `AGENTS.md` is
  now a pointer to it. Move the 24-pass BACKLOG reconciliation narrative
  into `plans/archive/BACKLOG_HISTORY.md`.
- Frontend: enable type-aware ESLint rules and fix the 27 floating and 25
  misused promises it found.
- Frontend: refactor `useApp` into domain-scoped store hooks
  (`useLibraryStore`, `useRoisStore`, `useWindowsStore`) over three
  slices, with an `architecture.test.ts` ratchet against calling
  `getState()` during render.
- Tooling: add `tools/gate.py`, a single cross-platform gate command
  (ruff + mypy + pytest, then npm lint/test/build) that CONTRIBUTING.md,
  README.md, and CLAUDE.md now point to first, with the individual
  commands kept after it for running one step by hand.
- Tooling: add `tools/bump_version.py` to make the release version bump's
  five file edits (plus the three lockfile regens) in one command instead
  of by hand.
- Lint `tools/` (`ruff check src tests tools`, now also enforced in CI)
  and prune three dead one-off scripts (`tools/smoke_live.py`,
  `tools/visual/build_compare_artifact.py`,
  `tools/bench/assemble_final_residuals.mjs`) that nothing in the repo
  referenced.
- Add shared `app`/`client` pytest fixtures (`tests/conftest.py`) and
  migrate 10 of the simplest `test_api_*.py` files onto them, removing
  their per-file `client = TestClient(app)` boilerplate.
- This item (9) — the gate/version-bump tooling, the `tools/` lint pass,
  the shared test fixtures, and this changelog — passes its own gate.
- Speed audit (final): defer `openpyxl` (`io/registry.py`'s `.xlsx`
  dispatch) and `periodictable` (`calc/sld_formula.py`) to inside the
  functions that actually use them instead of importing them eagerly at
  `create_app()` time, matching the existing matplotlib deferral. Measured:
  `openpyxl` costs ~0.2 s cold, `periodictable` ~0.03 s — the latter is
  deferred to keep an optional feature's dependency out of startup, not for
  its own speed. (`scipy.integrate`/`scipy.stats` deferrals considered for
  `calc/processing.py`, `calc/boxcut.py`, and `calc/fit_models_special.py`
  were reverted: `scipy.stats` is already imported eagerly by the
  statistics calc modules reachable from `create_app()`, so those three
  would have added a per-call import statement — one inside a hot
  per-point loop — for zero startup benefit.) Frontend: `PanelOverlayWindow`
  no longer rebuilds a full dropped-row set for every dataset on every
  render before its `useMemo` gate — the gate itself was also being
  defeated by a fresh `datasets` array reference every render; it now keys
  off a cheap, identity-only signature via a new
  `lib/rowstate.rowStateIdentity`.

## [0.24.0] - 2026-09-01

Shipped as a **minor** release rather than the originally planned
`v0.23.2` patch — the delta had grown to include the full P3.5 Recipe
Library, so "fixes only" no longer applied. Summarized from
`plans/RC_RELEASE_NOTES_DRAFT.md`; see that file for the complete
rc1→rc4→0.23.2-rc1/rc2 promotion history.

### Added
- **Native project lifecycle**: real Open/Save through the desktop bridge,
  named atomic saves, bounded autosave, and consent-gated crash recovery.
- **Relink & portability**: moved/renamed source files can be relinked
  with backend-enforced declared-source consent; a native folder-grant
  gesture enables real checksum verification instead of stat-only.
- **Single-writer project locking**: a second instance opening the same
  project gets read-only, Open as Copy, or a guarded Take Over, backed by
  a real cross-process lock; browser multi-tab is now also protected.
- **Workbook transfer packages**: export/import a workbook across
  instances with fresh-ID rewrite and bounded large-transfer handling.
- **Combine/split workbooks**, a **Recode workshop** (merge/rename
  categorical levels, find-replace), **derived worksheets with Freeze
  Copy**, **batch metadata & Collections**, and **Reimport/delete with
  impact preview**.
- **Quick Plot templates** and the **Quick Figure Builder**'s full
  create/edit/close/reopen/project-reload lifecycle.
- **P3.5 Unified Recipe Library**: one browse-first surface (filters,
  favourites, tags, last-used ordering, capability-aware row actions) over
  all six recipe systems that previously had separate homes.
- A copyable **diagnostic bundle** that excludes project content by
  default, and OS "reduce motion" + contextual per-workshop help.

### Fixed
- **Data loss**: re-importing a dataset with a computed column could
  destroy the base measurement data (live since v0.22.0); removing a
  computed column could silently re-fit a saved fit against the wrong
  column; two keystrokes in the peak table could delete a whole dataset
  or wipe a fit with no confirmation.
- Fifteen ordinary column names (`Kerr`, `Phase`, `Noise`, `Depth`, …)
  were being misclassified as error-bar columns, costing MOKE files real
  data channels; the error-label classifier was rewritten with explicit
  generate/rank/select stages.
- Formula integrity: deleting a computed column no longer lets later
  formulas silently read a shifted column.
- 34 HTTP 500s across 18 calculator routes are now proper 422s; three
  routes that could wedge the app for an hour on absurd input counts are
  now bounded; all error messages are ASCII.

### Performance
- Large 2-D RSM map regrid: 1M points 29.8 → 3.3 s; 4M points 141.6 →
  ~9-13 s, via a regular-grid fast path plus detection dedupe.
- Scattered-cloud maps denser than the output raster are bin-averaged
  before triangulation: 1M points 20.4 → 2.7 s; 4M points 88.2 → 4.8 s.

### Release engineering
- Every release now publishes a `SHA256SUMS` manifest covering all
  installer/build assets.
- macOS ships Apple-silicon only for this release (no Intel/x86-64 or
  universal build).

Older versions are documented in
[GitHub Releases](https://github.com/pquarterman17/quantized/releases).
