// Take Over Editing / Open as Copy — palette commands (PR I2, L0.47).
// Published into the shared command registry (store/commands.ts's
// `useCommands`), mirroring commands/relinkCommands.ts's registry-publish
// pattern. Both are disabled (with a reason) unless another instance holds the lock
// (UX audit 10, P1-1); `run()` still refuses with a toast for a palette pick
// that races a status change.
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
import { useProjectLock } from "../store/projectLock";

const body = () => import("./projectLockRun");

export function useProjectLockCommands(): void {
  useEffect(() => {
    const actions: Action[] = [
      {
        id: "take-over-editing",
        group: "File",
        section: "Project",
        label: "Take over editing",
        description:
          "Take over a project whose other editing instance is unresponsive (stale lock).",
        keywords: "lock takeover stale unresponsive concurrent single-writer Take Over Editing",
        disabled: () => useProjectLock.getState().status !== "held-by-other-stale",
        disabledReason: () =>
          useProjectLock.getState().status === "held-by-other-live"
            ? "The other instance is still responding."
            : "Only needed when another instance holds this project's lock and has stopped responding.",
        run: () => body().then((m) => m.takeOverEditing()),
      },
      {
        id: "open-as-copy",
        group: "File",
        section: "Project",
        label: "Open as copy",
        description: "Keep working without the original project's lock — saves land at a new location.",
        keywords: "copy read-only lock duplicate open as Open as Copy",
        disabled: () => {
          const { status } = useProjectLock.getState();
          return status !== "held-by-other-live" && status !== "held-by-other-stale";
        },
        disabledReason: "Only available when another instance holds this project's lock.",
        run: () => body().then((m) => m.openAsCopy()),
      },
    ];
    useCommands.getState().setMenuCommands("project-lock", actions);
  }, []);
}
