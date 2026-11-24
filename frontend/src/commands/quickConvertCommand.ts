// "Quick Convert…" (File > Export): the body behind the command in
// commands/fileCommands.ts, imported on click so the open flag's store stays off
// the startup path. The window itself is a lazy panel (AppOverlayPanels).

import { useQuickConvertPanel } from "../store/quickConvertPanel";

export function runQuickConvert(): void {
  useQuickConvertPanel.getState().openPanel();
}
