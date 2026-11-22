# Workspace layout plan: plot-centred workspace with a side panel

Status: **design agreed, not started** (owner decisions 2026-11-22). Nothing
here is built until the owner signs off on the mockups:
https://claude.ai/artifact/L9GBtuAKySpMU8CGW2GW4W

## Problem

- The stage shows ONE full-screen view at a time (Plot · Map · Worksheet ·
  Workflow tabs, `components/Stage/Stage.tsx`), so checking data or running an
  analysis means leaving the plot.
- The Workflow buttons come from a hidden technique tag set at import
  (`lib/techniqueDefaults.ts` `techniqueOf`, `lib/techniqueWorkflow.ts`), so the
  button set changes shape between datasets with no explanation, and untagged
  data gets a thinner "General data" set.

## Decisions (owner, 2026-11-22)

| # | Topic | Decision |
|---|---|---|
| 1 | What sits beside the plot | Both the data and analysis, depending on the moment |
| 2 | Where | ONE right-hand panel with tabs; the plot fills the rest |
| 3 | Default state | Open on **Data** by default; easy toggle: panel-edge button, a shortcut (proposed `Ctrl+.`), View menu entry |
| 3b | Selection | Linked both ways: select points on the plot ↔ rows highlight and scroll in Data |
| 4 | Stage tabs | Removed. Map becomes a plot type in the main area; Worksheet becomes the Data tab; Workflow becomes the Analysis tab |
| 5 | Which dataset the panel shows | Follows the focused plot window, with a **pin** to lock it; a setting can make it follow the Library selection instead |
| 6 | Analysis tab layout | Progress guide on top, full searchable tool list below |
| 7 | Technique | Shown at the top of Analysis ("Detected: Powder XRD — from .xrdml · change"); when unsure, offer the close matches to pick; the choice is saved with the dataset |
| 8 | Progress guide | Same five steps for every dataset (Inspect → Clean → Plot → Analyze → Report), technique tools as extras under their step; each step shows not started / done / out of date (result-lifecycle state) and reopens what was done; the next suggested step is highlighted |
| 9 | Tools that don't fit | Shown greyed out with a one-line reason ("Needs a numeric X column"), in the guide and the tool list |
| 10 | Inspector | Becomes a third tab, **Style**: one right column with Data · Analysis · Style |
| 11 | Map controls | The Map toolbar docks on top of the map plot, as the plot toolbar does today |
| 12 | Maximise Data | Swaps: Data takes the main area and the plot shrinks into the panel as a live thumbnail; one click swaps back |
| 13 | Small screens (< ~1280 px) | The panel becomes an overlay drawer over the plot; Esc closes it |
| 14 | Opened tools | Open INSIDE the Analysis tab (back arrow returns to the guide); a pop-out button still floats a tool (second monitor) |
| 15 | Library | Unchanged, but gets an easy collapse toggle |
| 16 | Rollout | Opt-in "New layout" toggle in View first; flip the default in a later release once the owner is happy; remove the old tabs after that |

## Shape

```
┌ Library ┐┌──────────── Plot (or Map) ─────────────┐┌ Data · Analysis · Style ┐
│ (collap-││  plot toolbar / map toolbar             ││  ⟂ pin   ⟷ maximise      │
│  sible) ││                                         ││                          │
│         ││          focused plot window            ││  Data: worksheet grid    │
│         ││                                         ││  Analysis: guide + tools │
│         ││                                         ││  Style: Inspector cards  │
└─────────┘└─────────────────────────────────────────┘└──────────────────────────┘
```

## Building blocks that already exist (reuse, don't rebuild)

- Worksheet and Map already render as MDI document windows
  (`components/windows/DocumentWindow.tsx`, MULTI_PLOT_PLAN item 17): the Data
  tab hosts the same lazy worksheet chunk.
- The tool dock (`store/toolDock.ts`, UX-F) already puts an analysis window in
  the Inspector's column: the Analysis tab generalises it.
- Result lifecycle (`commitAnalysisOutput`, out-of-date marking, reopen /
  Replace, Result book) gives step state for decision 8.
- Analysis inputs resolver + "Review inputs" cards give the greyed-out reasons
  for decision 9.
- Technique detection (`techniqueOf`, parser metadata) gives decision 7's
  "detected" line; it needs a confidence + candidates output.

## Phases (each one PR, behind the opt-in toggle until P5)

- **P0 — Shell + toggle.** `layout: "classic" | "panel"` setting (View menu,
  default classic); right panel host with Data · Analysis · Style tabs, resize,
  collapse, pin, shortcut; Library collapse toggle. Style = the existing
  Inspector moved in. No behaviour change in classic.
- **P1 — Data tab.** Worksheet in the panel; maximise ⇄ swap with a live plot
  thumbnail; linked selection (plot ↔ rows) both ways; follows focused plot /
  pin / Library-selection setting.
- **P2 — Analysis tab: guide.** Five-step guide with state from the result
  lifecycle, reopen on click, next-step highlight; technique line with
  confidence, candidates and override saved on the dataset.
- **P3 — Analysis tab: tool list + in-tab tools.** Searchable, grouped tool
  list with "suggested for this data"; greyed + reason for tools that don't
  fit; tools open inside the tab with back arrow and pop-out.
- **P4 — Map + small screens.** Map as a main-area plot type with its toolbar;
  overlay drawer below the width threshold.
- **P5 — Default flip** (owner call, later release); then remove the stage
  tabs and the classic layout after a further release.

## Constraints to respect

- Bundle budget is ~0.2 kB from the pin: every phase must lazy-load its panel
  content (only the shell is eager).
- 400 lines per `.tsx`, 500 per module, `getState()` ratchet, weak-wait
  ratchet; design tokens only; JetBrains Mono for numbers.
- New behaviour is opt-in until P5 (owner rule).

## Open questions (ask, don't guess)

- Default panel width, and should Analysis remember the last opened tool per
  dataset?
- Shortcut choice (`Ctrl+.` proposed) and whether `Ctrl+1/2/3` switch the tabs.
- Does the Library collapse get its own shortcut?
- Should a multi-dataset analysis (batch, By) show all its inputs in the Data
  tab, or only the focused one?
