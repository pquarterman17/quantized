// The Plot menu's "Plot in new window" body, split out of plotCommands.ts and
// loaded on the click (bundle diet, plans/BUNDLE_HEADROOM.md slice 34): it is
// the only eager reader of `lib/plotInNewWindow.ts` and `lib/commandTarget.ts`,
// so both leave the entry chunk with it. The store handle comes in as a
// parameter, as in commands/fileCommandsLazy.ts.

import type { StoreGet } from "../lib/exportActive";
import { commandTargetId } from "../lib/commandTarget";
import { plotInNewWindow } from "../lib/plotInNewWindow";
import { toast } from "../store/toasts";

/** Plot > Layout > Plot in new window: the Tree-highlighted row, else the plotted one (UX10 P0-1). */
export function runPlotInNewWindow(s: StoreGet): void {
  const id = commandTargetId(s());
  if (!id) {
    toast("no active dataset", "danger");
    return;
  }
  plotInNewWindow(id);
}
