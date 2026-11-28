// The commands only the menus and the palette read, so they stay out of the
// first-paint core list (appCommandsCore.ts): the Insert measures, Plot's
// browse-graph group and the Help learning aids (item 45). `buildAppActions` (appCommands.ts) spreads this one list.

import type { Action } from "../store/commands";
import { browseGraphCommands } from "./browseGraphCommands";
import { buildLearningCommands } from "./learningCommands";
import { measureInsertCommands } from "./measureInsertCommands";

export const menuOnlyCommands: Action[] = [...measureInsertCommands, ...browseGraphCommands, ...buildLearningCommands()];
