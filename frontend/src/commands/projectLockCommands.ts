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

import { useEffect } from "react";

import { BROWSER_AUTOSAVE_LOCK_PATH } from "../useWorkspaceAutosave";
import { useCommands, type Action } from "../store/commands";
import { useProjectLock } from "../store/projectLock";
import { toast } from "../store/toasts";

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
        run: () => {
          const lock = useProjectLock.getState();
          if (lock.status !== "held-by-other-stale") {
            toast(
              lock.status === "held-by-other-live"
                ? "Take Over Editing is not available — the other instance is still responding"
                : "nothing to take over — this project is not locked by another instance",
              "danger",
            );
            return;
          }
          void lock.takeOverEditing().then((ok) => {
            toast(ok ? "took over editing" : "take over failed — the other instance is responding again", ok ? "ok" : "danger");
          });
        },
      },
      {
        id: "open-as-copy",
        group: "File",
        section: "Project",
        label: "Open as Copy",
        description: "Keep working without the original project's lock — saves land at a new location.",
        keywords: "copy read-only lock duplicate open as",
        run: () => {
          const lock = useProjectLock.getState();
          if (lock.path === BROWSER_AUTOSAVE_LOCK_PATH) {
            toast("this browser session has a single autosave slot — take over editing instead", "danger");
            return;
          }
          if (lock.status !== "held-by-other-live" && lock.status !== "held-by-other-stale") {
            toast("nothing to copy — this project is not currently read-only", "danger");
            return;
          }
          lock.openAsCopy();
          toast("opened as a copy — Save will prompt for a new location", "ok");
        },
      },
    ];
    useCommands.getState().setMenuCommands("project-lock", actions);
  }, []);
}
