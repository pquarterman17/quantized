// Paste workbook — command palette entry (PR I, L0.23). Published into the
// shared command registry (store/commands.ts's `useCommands`), mirroring
// commands/relinkCommands.ts's own registry-publish pattern: pasting targets
// the Library ROOT (the plan's confirmed L0.23 "Paste is offered on a
// destination folder and on Library background/root" — this ships the root
// half; a folder-targeted "Paste" context-menu row is deferred until this
// codebase grows a folder/root context-menu surface to host it, the same
// "expose a complete, independently-tested action contract for that UI to
// call directly" scoping PR J slice 1 and PR K slice 1 already used —
// store/workbookTransfer.ts's `pasteWorkbookFromClipboard` already accepts a
// `targetFolderId` for exactly that follow-up).
//
// Copy/Duplicate are per-workbook menu rows instead (lib/workbookContextActions.ts)
// since they act ON a specific existing workbook, unlike Paste.

import { useEffect } from "react";

import { useCommands, type Action } from "../store/commands";
import { useApp } from "../store/useApp";

export function useWorkbookTransferCommands(): void {
  useEffect(() => {
    const actions: Action[] = [
      {
        id: "paste-workbook",
        group: "File",
        section: "Project",
        label: "Paste workbook",
        description: "Paste a workbook copied from this or another Quantized instance, at the Library root.",
        keywords: "paste workbook copy clipboard transfer cross-instance",
        run: () => void useApp.getState().pasteWorkbookFromClipboard(),
      },
    ];
    useCommands.getState().setMenuCommands("workbook-transfer", actions);
  }, []);
}
