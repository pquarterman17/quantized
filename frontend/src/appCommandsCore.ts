// The curated commands the shell needs at first paint (File, UI, Data, Plot).
// The Analyze group is large (descriptions and search keywords for every
// analysis tool) and only used once a menu or the palette opens, so App loads
// it right after mount (appCommands.ts, the full list) instead of shipping it
// in the entry chunk. The same full list carries the core commands'
// descriptions and keywords (commands/commandDocs.ts), so this list has none:
// only the menus' tooltips, the palette and Help read them, and none of those
// renders before the full list lands.

import { buildDataCommands } from "./commands/dataCommands";
import { buildFileCommands } from "./commands/fileCommands";
import { buildPlotCommands } from "./commands/plotCommands";
import { buildUiCommands } from "./commands/uiCommands";
import type { StoreGet } from "./lib/exportActive";
import type { Action } from "./store/commands";

export function buildCoreActions(s: StoreGet): Action[] {
  return [...buildFileCommands(s), ...buildUiCommands(s), ...buildDataCommands(s), ...buildPlotCommands(s)];
}
