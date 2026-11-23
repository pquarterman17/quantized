// Open the active dataset's map window and say so (WORKSPACE_LAYOUT_PLAN P5 and
// UX pass 4). The ONE place a map request is carried out and reported, shared
// by the stage-tab adapter (every Map request, the Window menu's "Open map in
// window" included) and by the Analysis window's tool launch (an "ROI cuts"
// route reveals the map it reads). A refusal is said three ways, so it is never
// only a status-bar line: the live region, a toast naming the dataset, and the
// status line (set by the store).

import { plotRef } from "../../../lib/windowLayout/refs";
import { openActiveMapWindow } from "../../../store/windowLayoutMap";
import { toast } from "../../../store/toasts";
import { announce } from "./layoutAnnounce";
import { focusTitleBar } from "./useLayoutKeyboard";

export interface OpenMapOptions {
  /** Move focus to the map window's title bar (default). Off when another window is about to take it. */
  focus?: boolean;
  /** Say what happened (default). Off when the request is a restore replaying (no sentence, no toast). */
  say?: boolean;
}

export async function openMapWindow({ focus = true, say = true }: OpenMapOptions = {}): Promise<void> {
  const result = await openActiveMapWindow();
  if (!result) return;
  if ("refused" in result) {
    if (!say) return;
    announce(result.refused);
    toast(result.refused, "info");
    return;
  }
  if (say) announce(`Map of ${result.name} ${result.existed ? "brought forward" : "opened in a window"}.`);
  if (focus) requestAnimationFrame(() => focusTitleBar(plotRef(result.id)));
}
