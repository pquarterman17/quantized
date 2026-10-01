// Take Over Editing / Open as Copy — palette commands (PR I2, L0.47).
// Published into the shared command registry (store/commands.ts's
// `useCommands`), mirroring commands/relinkCommands.ts's registry-publish
// pattern. store/commands.ts's `Action` has no `disabled` field — this
// app's palette convention is always-enabled, with `run()` itself refusing
// gracefully (a toast naming why) when the action doesn't currently apply,
// the same shape every context-action `run()` in this codebase already
// uses for its own internal refusals.
//
// N3 (coordinator review round 3): "Open as Copy" makes no sense for the
// shared browser autosave slot (`useWorkspaceAutosave.ts`'s
// `BROWSER_AUTOSAVE_LOCK_PATH`) — that backend has ONE slot per origin, no
// separate "copy destination" a post-copy write could land in, so it would
// just keep clobbering the real holder's slot. Refused here, first, before
// the ordinary read-only check — the belt (the autosave write gate ALSO
// refuses when `openedAsCopy` is set in browser-autosave mode) lives in
// `useWorkspaceAutosave.ts`'s `autosaveGateBlocked()`.
//
// Bundle diet slice 17: both bodies live in commands/projectLockRun.ts and
// load on first use. `run()` returns that promise, so `runAction` shows the
// busy label meanwhile and toasts a load failure naming the command.

import { useEffect } from "react";

import { useCommands, type Action } from "../store/commands";

const body = () => import("./projectLockRun");

export function useProjectLockCommands(): void {
  useEffect(() => {
    const actions: Action[] = [
      {
        id: "take-over-editing",
        group: "File",
        section: "Project",
        label: "Take Over Editing",
        description:
          "Take over a project whose other editing instance is unresponsive (stale lock) — L0.47.",
        keywords: "lock takeover stale unresponsive concurrent single-writer",
        run: () => body().then((m) => m.takeOverEditing()),
      },
      {
        id: "open-as-copy",
        group: "File",
        section: "Project",
        label: "Open as Copy",
        description: "Keep working without the original project's lock — saves land at a new location.",
        keywords: "copy read-only lock duplicate open as",
        run: () => body().then((m) => m.openAsCopy()),
      },
    ];
    useCommands.getState().setMenuCommands("project-lock", actions);
  }, []);
}
