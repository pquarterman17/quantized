# One editor per plot object: contract (plan item 50)

The rules for making the double-click popup the only editor for an axis, a curve and the legend, so the right panel stops offering a second, differently behaving copy of the same fields.

**Parent:** `ORIGIN_FEATURE_GAP_PLAN.md`, item 50 (owner decision OG23).
**Status:** Active
**Created:** 2026-11-27
**Updated:** 2026-11-27

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
- **The ledger.** Every item 50 PR appends its rows to the ledger below, in the same PR.

### Reversal ledger

Each row says what changed, where, and what reverses it. A full docked switch would:

1. set `OBJECT_EDITOR = "panel"`;
2. make a double-click select the object and scroll the panel to its section, instead of opening the popup (`AxisDropZones.tsx`, `curveDoubleClick.ts`, `useLegendBox.ts`);
3. mount the popup-only fields in the panel cards. These are the Axis dialog's ticks, breaks, top axis, grid and crossing, which never had a panel twin;
4. decide whether the popups stay as an advanced view or go.

| PR | Change | File(s) | To reverse |
|---|---|---|---|
| #1186 | Contract and OG23 booked | `plans/` | Edit OG23 in the gap plan |
