# One editor per plot object: contract (plan item 50)

The rules for making the double-click popup the only editor for an axis, a curve and the legend, so the right panel stops offering a second, differently behaving copy of the same fields.

**Parent:** `ORIGIN_FEATURE_GAP_PLAN.md`, item 50 (owner decision OG23).
**Status:** Complete (2026-11-28, #1187, #1188, #1189, #1194). Kept while OG23 is on the revisit list: the code cites E1–E11, and the reversal ledger below is what a docked switch starts from.
**Created:** 2026-11-27
**Updated:** 2026-11-28

## Context

### The problem

Double-clicking an axis, a curve or the legend does two things at once:

- The first click selects the object (`PlotSelectionLayer`). The right panel then shows that object's fields in its Selection section and hoists its card (`Inspector.tsx`).
- The double-click opens the object's popup (`FigureDialogs.tsx`: Axis, Plot details, Legend) over a dimmed backdrop.

The two editors behave differently:

- **The panel** writes the plot as you type, with one undo step per change.
- **The popup** edits a draft, and nothing changes until Apply.
- **A click on the backdrop** closes the popup and throws the draft away without asking. The panel shows through the backdrop, so clicking it to edit there is exactly that click.

### Today's twins

| Object | Right panel | Popup |
|---|---|---|
| Axis (X, Y, Y2) | Selection: scale, limits and title (`AxisQuickFields`). Axes card: scale, limits, tick format. Titles & labels card: axis titles | Axis dialog: everything except the title text |
| Curve | The Series style card, hoisted on selection | Plot details: colour, line, symbol, error bars |
| Legend | `LegendControls`, in Selection and in the Axes card | Legend dialog |

**Out of scope, because nothing is duplicated:**

- In-place edits: an axis title typed on the canvas, a legend row renamed, a worksheet header, a map label.
- The graph-layer and colour-gradient popups, which have no panel twin.
- The map tab, which has no popup.

## Decisions

**E1. The popup is the only editor** for an axis (X, Y, Y2 and the Y3+ right axes), a curve and the legend. Every way in opens it: double-click, the right-click menu, the Plot menu, the command palette, and the panel's Edit… button.

**E2. The panel's Selection section** names the selected object and shows one Edit… button that opens its popup.

- No editable field for a selected axis, curve or legend stays in the panel.
- The object picker stays, so the keyboard reaches every popup: pick, Tab to Edit…, Enter.

**E3. Nothing is lost.** Before a control leaves the panel, the popup has it, writing the same store field.

- Each popup lane's PR body has a table: panel control, then popup field, then the test that covers it.
- Lane D hides only what those tables list (E11: hidden behind one switch, not deleted).
- A control with no home in a popup is a defect in lanes A–C, and lane D leaves it showing.

**E4. Plot-wide settings stay in the panel:**

- grid lines, the axis box, the plot template, showing the legend, and the plot title;
- anything else that applies to the whole graph, not to one axis or curve;
- which columns are plotted, and on which axis (the Channels card). That is the plot's structure, not curve style.

Two further rules:

- The Axes card gains X axis…, Y axis… and Y2 axis… launchers (Y2 only when it is drawn), so a popup opens without selecting first.
- Each axis's scale, limits, tick format and title leave the panel.

**E5. Popups keep draft + Apply**, as today:

- nothing changes until Apply;
- Apply commits one undo step and closes;
- Cancel and Esc discard.

Item 44 (live preview, an Apply that stays open, OK) is a separate decision and is not taken here.

*Superseded 2026-11-28 by item 44 (#1243) for the Axis, Plot details, Legend and Color gradient popups: Apply writes and stays open, OK applies and closes, Cancel and Esc keep what was applied, and the session is one undo step. Other dialogs keep the rule above until OG24 is answered.*

**E6. An outside click on an edited popup asks before discarding.**

- The choice is Discard or Keep editing. It is shown inside the app, through the shared confirm store (`store/confirmDialog.ts`) or an inline bar in the popup, never `window.confirm`.
- An unedited popup closes on an outside click, as today.
- "Edited" is tracked by the host (`FigureDialogs.tsx`): any input or change event inside the popup marks it. So every figure popup gets the rule without wiring each dialog.
- Esc stays an explicit Cancel.

**E7. Plot details becomes the whole curve editor.**

- It has one tab per part, taking whatever the Series style card holds today; for example Line, Symbol, Error bars, Fill and bars, Labels.
- Each tab is its own component, under the 400-line ceiling.
- The Series style sub-controls are reused. They take a value and an onChange over the draft instead of writing the store.
- A control that needs live data, such as a column picker, may read the store but writes the draft.

**E8. No saved-state change.** Every field is an existing store field, so there is no new `.dwk` field, no forward-compatibility rung and no migration.

**E9. Tests follow the user's path.**

- **Every popup field:** double-click the object on the Stage (or press Edit… in the panel), change the field and press Apply. Then assert both the store and what is drawn or exported.
- **Cancel, Esc and an outside click** leave both unchanged.
- **Panel tests stay.** They render the panel components directly, so they keep passing while E11's switch hides the components. A new test pins that the switch hides them.
- **Help text, the user guide and palette entries** that point at a removed panel control are updated in the same lane.

**E10. Lane order and file ownership.**

- Lanes A (axis), B (curve) and C (legend, plus E6) touch separate files and run in parallel.
- Lane D (the panel) starts after all three merge. It owns:
  - `InspectorSelection.tsx`;
  - `AxisQuickFields.tsx`;
  - `AxesCard.tsx`;
  - `TitlesCard.tsx`;
  - `Inspector.tsx`;
  - `SeriesStyleCard.tsx`.
- Lanes A–C edit those files only to keep them compiling when a shared sub-control's props change.

**E11. The choice is reversible: one switch, and a ledger.** The owner may switch back to the docked direction (the right panel as the only editor), so lane D must not make that expensive.

- **One switch.** Lane D adds `frontend/src/lib/objectEditorMode.ts`, which exports `OBJECT_EDITOR: "popup" | "panel"`, set to `"popup"`. Every panel change lane D makes reads it:
  - the Selection section's Edit… button in place of the quick fields;
  - the Axes card's launchers in place of its per-axis controls;
  - the axis titles in the Titles card;
  - the Series style card and the legend controls.

  `"panel"` restores today's panel exactly. Nothing is deleted: the panel components, and the tests that render them directly, stay.
- **The popup work serves both directions.** Lane B's value / onChange sub-controls mount just as well in a panel card over live setters. Lane A's title field and lane C's legend fields are the fields a docked panel would need too.
- **The ledger.** Every item 50 PR body has a `## Reversal` section: what changed, in which files, and what a docked switch would do with it. The orchestrator copies it into the ledger below when the PR lands.

### Reversal ledger

Each row says what changed, where, and what reverses it. A full docked switch would:

1. set `OBJECT_EDITOR = "panel"`;
2. make a double-click select the object and scroll the panel to its section, instead of opening the popup (`AxisDropZones.tsx`, `curveDoubleClick.ts`, `useLegendBox.ts`);
3. mount the popup-only fields in the panel cards. These are the Axis dialog's ticks, breaks, top axis, grid and crossing, which never had a panel twin;
4. decide whether the popups stay as an advanced view or go.

| PR | Change | File(s) | To reverse |
|---|---|---|---|
| #1186 | Contract and OG23 booked | `plans/` | Edit OG23 in the gap plan |
| #1187 | Legend corner picker as a standalone value/onChange field (`LegendPositionField`) | `figuredialogs/LegendPositionField.tsx`, `LegendDialog.tsx` | Mount it in a panel card over `setLegendPos` |
| #1187 | An outside click on an edited figure popup asks Discard / Keep editing (E6) | `figuredialogs/DiscardGuard.tsx`, `FigureDialogs.tsx` | Keep it while any popup stays; delete with the popups otherwise |
| #1188 | Axis popup gains the title text (`AxisTitleField`, value/onChange), Y2 "Same as Y" scale and "Same format as Y", and X date / clock tick modes | `AxisDialog.tsx`, `AxisTitleField.tsx`, `lib/axisDialogModel.ts`, `lib/axisDialogParity.ts`, `lib/figureDialogActions.ts` | Mount `AxisTitleField` in a panel card over `setXAxisLabel` / `setYAxisLabel` / `setY2AxisLabel`; the panel's own `TickFormat` already covers the rest |
| #1189 | Plot details becomes a tabbed curve editor over one draft (Line, Symbol, Error bars, Fill and bars, Marks); Apply folds into one undo step | `PlotDetailsDialog.tsx`, `figuredialogs/curve/*`, `store/commitCurveDraft.ts`, `Inspector/SeriesSymbolErrorControls.tsx` (optional `parts`) | Each tab takes `{channel, style, setSeriesStyle, ctx}`: a panel card mounts it with the live `setSeriesStyle` and `pickSeriesYError` |
| #1194 | The switch: `OBJECT_EDITOR = "popup"` with the `objectEditorIsPopup()` accessor | `lib/objectEditorMode.ts` | Set it to `"panel"`: the one edit that restores the panel |
| #1194 | Selection shows the name plus Edit… instead of the quick fields and legend controls | `Inspector/InspectorSelection.tsx` | `"panel"` brings back `AxisQuickFields`, `LegendControls` and the old hint |
| #1194 | No card is hoisted for a curve or axis; Series style card not mounted | `Inspector/Inspector.tsx` | `"panel"` brings back the hoisting and the card |
| #1194 | Axes card: X / Y / Y2 / Y3+ launchers instead of scale, limits and tick format; legend corner hidden | `Inspector/AxesCard.tsx`, `Inspector/LegendControls.tsx` (`corner` prop) | `"panel"` brings back the per-axis controls and the corner |
| #1194 | Titles & labels card shows only the plot title | `Inspector/TitlesCard.tsx` | `"panel"` brings back the X, Y, Y2 rows |
| #1194 | One legend-corner option list | `lib/legendPositions.ts` | Nothing; used in both modes |
| #1194 | Panel-behaviour tests mock `"panel"`; six e2e specs drive the popups (`e2e/utils/objectPopup.ts`) | Inspector tests, `frontend/e2e/specs/*` | The mocked tests keep the panel path covered; the old e2e steps are in git history |
| #1205 | The Axis popup keeps one draft per axis tab; an Apply commits every edited axis as one undo step, its limits included (`store/historyNav.ts`) | `AxisDialog.tsx`, `lib/axisDraftsCommit.ts`, `store/historyNav.ts` | Nothing; the popup stays as an advanced view in either direction |
| #1205 | Plot details' Error bars tab gains an error-column picker (value/onChange) | `figuredialogs/curve/ErrorBarsTab.tsx` | Mount it in a panel card over a live setter |
| #1205 | The discard bar sits below the scrolling fields | `FigureDialogs.tsx`, `DiscardGuard.tsx` | Nothing |
| #1220 | Legend double-click by part: the swatch opens Plot details for its curve, the label renames inline, the rest opens the Legend popup | `Stage/PlotLegend.tsx` (`onRowDoubleClick`), `Stage/useLegendBox.ts` | In docked mode these double-clicks select the object and scroll the panel to it |
| #1243 | Axis, Plot details, Legend and Color gradient popups: Apply keeps the popup open, a new OK applies and closes, Cancel and Esc keep what was applied | `figuredialogs/ApplyButtons.tsx`, `AxisDialog.tsx`, `PlotDetailsDialog.tsx`, `LegendDialog.tsx`, `ColorGradientDialog.tsx` | Put back the single Apply (apply, then close) and Cancel in each dialog: E5 as first written |
| #1243 | One undo step per popup session: the Applies fold into one history entry, never one another action pushed meanwhile | `store/popupSession.ts`, `lib/useApplySession.ts` | Stop wrapping Apply writes in `useApplySession`; each Apply then records its own step |
| #1243 | The outside-click Discard question covers only edits after the last Apply | `figuredialogs/DiscardGuard.tsx` (`markApplied`), `FigureDialogs.tsx` (`AppliedContext`) | Drop the provider; "edited" then stays set after an Apply |
| #1243 | After an Apply the Axis popup re-reads its drafts, Plot details re-bases its error column, and Color gradient skips an unchanged write | `AxisDialog.tsx`, `curve/useCurveDraft.ts`, `PlotDetailsDialog.tsx`, `ColorGradientDialog.tsx` | Remove the re-seed lines; a repeated Apply then rewrites an equal value |
