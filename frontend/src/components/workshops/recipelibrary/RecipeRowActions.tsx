// P3.5 slice 3 — the per-row action strip.
//
// Its own component because the panel is close to the 400-line .tsx ceiling
// and because these buttons are one concern: turning a `RecipeDescriptor`'s
// declared capabilities into exactly the affordances that kind can honour.
//
// UNSUPPORTED OPERATIONS ARE ABSENT, NOT DISABLED. A greyed-out Duplicate on
// a Quick Plot template invites the user to hunt for the state that enables
// it; there is none, and there will not be one until that slice grows the
// action. Rename/Duplicate/Export/Copy appear only where the kind supports
// them. Apply and Delete are always present because every kind has both.

import { useRef, useState } from "react";

import { askConfirm } from "../../overlays/ConfirmDialog";
import ContextMenu, { type ContextMenuItem } from "../../overlays/ContextMenu";
import { RECIPE_KIND_LABEL, supportsOperation, type RecipeDescriptor } from "../../../lib/recipeLibrary";
import { Button } from "../../primitives";
import {
  applyOrOpen,
  copyToOtherScope,
  deleteIsUndoable,
  deleteRecipe,
  duplicateRecipe,
  exportRecipe,
  primaryActionLabel,
  type ActionResult,
} from "./recipeActions";

export default function RecipeRowActions({
  row,
  onChanged,
  onResult,
  busy,
  setBusy,
  onRename,
}: {
  row: RecipeDescriptor;
  /** Something in a recipe SYSTEM changed — the caller re-reads its sources. */
  onChanged: () => void;
  /** Report an outcome to the panel's status line. */
  onResult: (result: ActionResult) => void;
  /** PANEL-level, not row-level. An apply is async and reports its outcome
   *  through one shared status line, so a second operation meanwhile would
   *  race for that line and could read store state the first is mutating.
   *  RecipeRowActions gates this row's buttons; RecipeRow gates the inline
   *  favorite, tag, and rename controls with the same value. */
  busy: boolean;
  setBusy: (busy: boolean) => void;
  /** Open the row's inline name editor. Present only for renameable kinds. */
  onRename?: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  /** Run one action, report it, and refresh only when it succeeded. A refusal
   *  changed nothing, so re-reading every source would be pure work. */
  const run = (act: () => ActionResult): void => {
    const result = act();
    onResult(result);
    if (result.ok) onChanged();
  };

  const primary = primaryActionLabel(row.kind);
  const scopeVerb = row.ref.scope === "project" ? "Copy to global" : "Copy to project";

  const confirmDelete = (): void => {
    void askConfirm(
      `Delete ${RECIPE_KIND_LABEL[row.kind].toLowerCase()} "${row.name}" (${row.ref.scope === "project" ? "this project" : "global"})?`,
      deleteIsUndoable(row.ref) ? "You can undo this." : "This cannot be undone.",
      "Delete",
      true,
    ).then((confirmed) => {
      if (confirmed) run(() => deleteRecipe(row.ref));
    });
  };

  const secondary: ContextMenuItem[] = [
    ...(supportsOperation(row.kind, "rename") && onRename
      ? [{ label: "Rename", run: onRename } satisfies ContextMenuItem]
      : []),
    ...(supportsOperation(row.kind, "duplicate")
      ? [{ label: "Duplicate", run: () => run(() => duplicateRecipe(row.ref)) } satisfies ContextMenuItem]
      : []),
    ...(supportsOperation(row.kind, "export")
      ? [{ label: "Export…", run: () => run(() => exportRecipe(row.ref)) } satisfies ContextMenuItem]
      : []),
    ...(supportsOperation(row.kind, "copyScope")
      ? [{ label: scopeVerb, run: () => run(() => copyToOtherScope(row.ref)) } satisfies ContextMenuItem]
      : []),
    { separator: true },
    { label: "Delete", danger: true, run: confirmDelete },
  ];

  return (
    <div className="qz-recipe-row-actions">
      <Button
        size="sm"
        disabled={busy}
        // Every button below carries the recipe name in its accessible name:
        // a list of twenty rows otherwise presents twenty buttons all called
        // "Delete", and which one fires depends on remembering DOM position.
        aria-label={`${primary}: ${row.name}`}
        title={
          primary === "Apply"
            ? "Apply to the active dataset"
            // Honest about what this does: it opens the workshop, it does not
            // load this recipe into it.
            : `Open the workshop that owns ${RECIPE_KIND_LABEL[row.kind].toLowerCase()}s`
        }
        onClick={() => {
          // The only async action: a plot apply lazy-loads its matcher. The
          // busy flag exists so a double click cannot start two applies, which
          // for the plot path would create two figures.
          setBusy(true);
          void applyOrOpen(row.ref)
            .then((result) => {
              onResult(result);
              if (result.ok) onChanged();
            })
            .catch((e: unknown) => {
              // The plot path lazy-loads its matcher chunk; a failed fetch
              // rejects here and would otherwise be an unhandled rejection
              // with no user-visible sign that the click did nothing.
              onResult({ ok: false, reason: e instanceof Error ? e.message : "could not apply that recipe" });
            })
            .finally(() => setBusy(false));
        }}
      >
        {primary}
      </Button>

      <button
        type="button"
        ref={menuButtonRef}
        className="qz-btn qz-sm"
        disabled={busy}
        aria-label={`More actions for ${row.name}`}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        title="More actions"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.right, y: rect.bottom });
        }}
      >
        ⋯
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={secondary}
          onClose={() => {
            setMenu(null);
            // ContextMenu restores focus itself on Escape. Selection and
            // click-away also need a stable landing point; a selected Rename
            // subsequently transfers focus into the editor via autoFocus.
            queueMicrotask(() => menuButtonRef.current?.focus());
          }}
        />
      )}
    </div>
  );
}
