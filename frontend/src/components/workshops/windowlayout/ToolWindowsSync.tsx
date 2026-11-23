// The layout host's side of the tool windows (WORKSPACE_LAYOUT_PLAN P4): it
// watches the registry of mounted tools (store/layoutTools, fed by
// LayoutToolWindow) and keeps the layout in step. Mounted by LayoutHost.
// - a tool that mounts: its saved pin's frozen input comes back, its window
//   opens where it was (or at the bottom; one window per tool, D7), and focus
//   moves to the window's title bar (as the classic frame takes it on open);
// - a tool that unmounts (its workshop closed): its window closes, keeping the
//   placement for next time;
// - a run starting or ending (`busy`): a following pinnable tool is pinned for
//   the run and follows again after, both said out loud;
// - a pinned tool that loses the shared input selection to another tool loses
//   its pin, said out loud (store/layoutToolActions watchToolPins);
// - a saved `tool:` window for a tool this version does not have is dropped,
//   named on the status line (the codec keeps it, P0's rule for unknown ids).

import { useEffect, useLayoutEffect } from "react";

import { isModalOpen } from "../../../lib/appShortcuts";
import { toolRef } from "../../../lib/windowLayout/refs";
import { useLayoutTools } from "../../../store/layoutTools";
import { closeToolPlacement, dropUnknownTools, openToolPlacement, restoreToolPin, toolBusyChanged, watchToolPins } from "../../../store/layoutToolActions";
import { useApp } from "../../../store/useApp";
import { announce } from "./layoutAnnounce";
import { focusTitleBar } from "./useLayoutKeyboard";

/** The tools this host side has already handled, kept across remounts of the
 *  host (a Quick Figure Builder or Library tiles round trip), so an open tool is
 *  not handled as newly opened again (no focus jump, no pin re-applied). */
const seen = { current: new Map<string, { body: HTMLElement; busy: boolean }>() };

export default function ToolWindowsSync() {
  const tools = useLayoutTools();

  useLayoutEffect(() => {
    const prev = seen.current;
    const next = new Map<string, { body: HTMLElement; busy: boolean }>();
    const opened: string[] = [];
    for (const [id, tool] of tools) {
      const was = prev.get(id);
      if (!was || was.body !== tool.body) {
        restoreToolPin(id);
        openToolPlacement(id);
        opened.push(id);
      }
      if ((was?.busy ?? false) !== tool.busy) {
        const said = toolBusyChanged(id, tool.busy);
        if (said) announce(said);
      }
      next.set(id, { body: tool.body, busy: tool.busy });
    }
    for (const id of prev.keys()) if (!tools.has(id)) closeToolPlacement(id);
    seen.current = next;
    // Not cancelled by the next registry change (a tool re-publishes its fields on every render):
    // a window that is gone by then simply has no title bar to focus.
    if (opened.length) {
      requestAnimationFrame(() => {
        if (!isModalOpen()) focusTitleBar(toolRef(opened.at(-1)!));
      });
    }
  }, [tools]);

  useEffect(() => watchToolPins(announce), []);

  // A saved layout naming a tool this version does not have: drop it, and say so.
  const layout = useApp((s) => s.windowLayout);
  useEffect(() => {
    dropUnknownTools();
  }, [layout]);
  return null;
}
