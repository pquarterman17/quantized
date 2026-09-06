// "Pack Project" — command palette entry (P1.7 PR 4). A minimal harness to
// exercise the store/desktopPackBridge contract this PR ships — NOT the
// real dialog (assigned to Sol; see PRIMARY_SOFTWARE_AUDIT_PLAN.md's P1.7
// entry). Mirrors commands/relinkCommands.ts's own registry-publish
// pattern; the store's run module loads lazily on the click.

import { useEffect } from "react";

import { useCommands, type Action } from "../store/commands";
import { toast } from "../store/toasts";

export function usePackProjectCommands(): void {
  useEffect(() => {
    const actions: Action[] = [
      {
        id: "pack-project",
        group: "File",
        section: "Project",
        label: "Pack Project…",
        description: "Preview a portable, self-contained copy of the open project (P1.7).",
        keywords: "pack project portable bundle export copy sources",
        run: async () => {
          const { usePackProject } = await import("../store/packProject");
          await usePackProject.getState().previewPackProject();
          const s = usePackProject.getState();
          if (s.phase === "awaiting_confirmation" && s.preview) {
            const { packable, blocked } = s.preview.manifest.summary;
            toast(`${packable} source${packable === 1 ? "" : "s"} packable, ${blocked} blocked`, "info");
          } else if (s.errors.length > 0) {
            toast(`pack preview failed — ${s.errors[0].message}`, "danger");
          }
        },
      },
    ];
    useCommands.getState().setMenuCommands("packProject", actions);
  }, []);
}
