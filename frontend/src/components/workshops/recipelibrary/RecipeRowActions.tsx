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

import { useState } from "react";

import { askConfirm } from "../../overlays/ConfirmDialog";
import { supportsOperation, type RecipeDescriptor } from "../../../lib/recipeLibrary";
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
}: {
  row: RecipeDescriptor;
  /** Something in a recipe SYSTEM changed — the caller re-reads its sources. */
  onChanged: () => void;
  /** Report an outcome (both kinds) to the panel's status line. */
  onResult: (result: ActionResult) => void;
}) {
  const [busy, setBusy] = useState(false);

  /** Run one action, report it, and refresh only when it succeeded. A refusal
   *  changed nothing, so re-reading every source would be pure work. */
  const run = (act: () => ActionResult): void => {
    const result = act();
    onResult(result);
    if (result.ok) onChanged();
  };

  const primary = primaryActionLabel(row.kind);
  const scopeVerb = row.ref.scope === "project" ? "Copy to global" : "Copy to project";

  return (
    <div className="qz-recipe-row-actions">
      <Button
        size="sm"
        disabled={busy}
        title={primary === "Apply" ? "Apply to the active dataset" : `${primary} to work with this`}
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
            .finally(() => setBusy(false));
        }}
      >
        {primary}
      </Button>

      {supportsOperation(row.kind, "duplicate") && (
        <Button size="sm" disabled={busy} onClick={() => run(() => duplicateRecipe(row.ref))}>
          Duplicate
        </Button>
      )}

      {supportsOperation(row.kind, "export") && (
        <Button size="sm" disabled={busy} onClick={() => run(() => exportRecipe(row.ref))}>
          Export…
        </Button>
      )}

      {supportsOperation(row.kind, "copyScope") && (
        <Button size="sm" disabled={busy} title={scopeVerb} onClick={() => run(() => copyToOtherScope(row.ref))}>
          {scopeVerb}
        </Button>
      )}

      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={() => {
          // Confirm first: for the four name-keyed kinds this is irreversible,
          // and the dialog is the only warning the user gets.
          void askConfirm(
            `Delete "${row.name}"?`,
            deleteIsUndoable(row.ref) ? "You can undo this." : "This cannot be undone.",
            "Delete",
            true,
          ).then((confirmed) => {
            if (confirmed) run(() => deleteRecipe(row.ref));
          });
        }}
      >
        Delete
      </Button>
    </div>
  );
}
