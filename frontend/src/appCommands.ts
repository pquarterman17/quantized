// The curated command registry — every File/Edit/View/Data/Analyze/Plot/Help
// action consumed by the MenuBar and the ⌘K palette. Extracted VERBATIM from
// App.tsx (MAIN_PLAN #1, component-ceiling ratchet): App builds the list once
// (store setters are stable) and hands it to both surfaces; dynamically
// published commands (e.g. windows/useWindowCommands) still go through
// store/commands, never this list. Tests that assert "command X is
// registered" scan the owning commands/*.ts module's source (see
// TextFormatHelp.test.tsx).
//
// This module itself is just the thin aggregator (MAIN_PLAN #1 follow-up,
// 2026-07-17): the per-domain command lists live in commands/*.ts, split
// out when this file hit its store-size ratchet pin (architecture.test.ts's
// STORE_PINS) with zero headroom left for upcoming features. Composing them
// here keeps every existing import path (`buildAppActions` from
// "./appCommands") unchanged.

import { buildAnalysisCommands } from "./commands/analysisCommands";
import { buildDataCommands } from "./commands/dataCommands";
import { buildFileCommands } from "./commands/fileCommands";
import { buildPlotCommands } from "./commands/plotCommands";
import { buildUiCommands } from "./commands/uiCommands";
import type { StoreGet } from "./lib/exportActive";
import type { Action } from "./store/commands";

/** Build the curated palette actions against the live store handle
 *  (`useApp.getState`) — store setters are stable, so callers build once. */
export function buildAppActions(s: StoreGet): Action[] {
  return [
    ...buildFileCommands(s),
    ...buildUiCommands(s),
    ...buildAnalysisCommands(s),
    ...buildDataCommands(s),
    ...buildPlotCommands(s),
  ];
}
