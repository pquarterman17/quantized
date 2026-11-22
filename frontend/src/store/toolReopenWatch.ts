// A reopen session lives while its tool is open (lane RO2). The tool's panel
// ends the session when it UNMOUNTS (components/workshops/resultcommit/
// useReopenSession.ts), but a panel that never mounted (its lazy chunk failed)
// never unmounts either: the session would outlive the tool and seed a later,
// manual open from the old result. This watcher ends it the moment the tool's
// open flag goes false, whether or not the panel ever mounted.

import { useAnalysisExtras } from "./analysisExtras";
import { useToolReopen } from "./toolReopen";
import { useApp } from "./useApp";

const watchers = new Map<string, () => void>();

/** End the `tool` session when `isOpen` turns false (call AFTER the opener
 *  has set the tool's open flag). Replaces an earlier watch of the same tool;
 *  stops itself once its session is gone or replaced. */
export function endSessionWhenClosed(tool: string, isOpen: () => boolean): void {
  watchers.get(tool)?.();
  const nonce = useToolReopen.getState().sessions[tool]?.nonce;
  const offs: (() => void)[] = [];
  const stop = () => {
    offs.forEach((off) => off());
    if (watchers.get(tool) === stop) watchers.delete(tool);
  };
  const check = () => {
    const session = useToolReopen.getState().sessions[tool];
    if (!session || session.nonce !== nonce) { stop(); return; }
    if (!isOpen()) {
      stop();
      useToolReopen.getState().end(tool);
    }
  };
  offs.push(useApp.subscribe(check), useAnalysisExtras.subscribe(check), useToolReopen.subscribe(check));
  watchers.set(tool, stop);
}
