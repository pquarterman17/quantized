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

import { askConfirm } from "../../overlays/ConfirmDialog";
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
}: {
  row: RecipeDescriptor;
  /** Something in a recipe SYSTEM changed — the caller re-reads its sources. */
  onChanged: () => void;
  /** Report an outcome to the panel's status line. */
  onResult: (result: ActionResult) => void;
  /** PANEL-level, not row-level. An apply is async and reports its outcome
   *  through one shared status line, so a second apply started on another row
   *  meanwhile would both race for that line and read store state the first
   *  one is still mutating.
   *
   *  Scope, precisely: this gates the ACTION BUTTONS on every row. The inline
   *  favorite, tag and rename controls are not gated — they are synchronous
   *  and the first two touch only the sidecar, so calling this "one in-flight
   *  action at a time across the whole list" would be wider than it is. An
   *  inline rename during an in-flight apply can still write the shared result
   *  line; that is a cosmetic race, not a data one. */
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {

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

      {supportsOperation(row.kind, "duplicate") && (
        <Button size="sm" disabled={busy} aria-label={`Duplicate ${row.name}`} onClick={() => run(() => duplicateRecipe(row.ref))}>
          Duplicate
        </Button>
      )}

      {supportsOperation(row.kind, "export") && (
        <Button size="sm" disabled={busy} aria-label={`Export ${row.name}`} onClick={() => run(() => exportRecipe(row.ref))}>
          Export…
        </Button>
      )}

      {supportsOperation(row.kind, "copyScope") && (
        <Button size="sm" disabled={busy} aria-label={`${scopeVerb}: ${row.name}`} title={scopeVerb} onClick={() => run(() => copyToOtherScope(row.ref))}>
          {scopeVerb}
        </Button>
      )}

      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        aria-label={`Delete ${row.name}`}
        onClick={() => {
          // Confirm first: for the four name-keyed kinds this is irreversible,
          // and the dialog is the only warning the user gets.
          void askConfirm(
            // Names the KIND and SCOPE too: a peak recipe and a graph template
            // can both be called "Standard", and this dialog is the only gate
            // on an irreversible delete.
            `Delete ${RECIPE_KIND_LABEL[row.kind].toLowerCase()} "${row.name}" (${row.ref.scope === "project" ? "this project" : "global"})?`,
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
