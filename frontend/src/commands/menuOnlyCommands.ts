// The commands only the menus and the palette read, so they stay out of the
// first-paint core list (appCommandsCore.ts): the Insert measures and Plot's
// browse-graph group. `buildAppActions` (appCommands.ts) spreads this one list.

import type { Action } from "../store/commands";
import { browseGraphCommands } from "./browseGraphCommands";
import { measureInsertCommands } from "./measureInsertCommands";

export const menuOnlyCommands: Action[] = [...measureInsertCommands, ...browseGraphCommands];
