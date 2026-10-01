// Plot Recipe apply preview+confirm (P1.3 wave 3, Lane D deliverable 4).
// Renders `pendingRecipeApplication` (store/plotRecipes.ts) -- the mapping
// preview (which recipe field resolved to which CURRENT column), the
// unmatched-field list, and any warnings verbatim (they already name
// candidates/collisions, see plotRecipeMatch.ts's `candidateList`) -- with
// TWO actions:
//   - Cancel: `cancelPendingRecipeApplication`.
//   - Apply mapped fields (the primary action): `confirmPendingRecipeApplicationPartial`,
//     applying the fresh resolution's resolved subset and dropping whatever
//     didn't match.
//
// ORCHESTRATOR RULING A (code-review finding 1, this wave): a plain "Confirm"
// button (`confirmPendingRecipeApplication`) used to sit here too, but it can
// NEVER succeed from this dialog -- `pendingRecipeApplication` only ever
// exists when `unmatched.length > 0` (a clean match applies immediately,
// never stages), and this dialog is MODAL (blocks dataset edits while it's
// up), so a plain re-resolve from here always reproduces the IDENTICAL
// unmatched set. Under the old wording that re-stage falsely claimed "the
// dataset changed" even though nothing did. Removed entirely rather than
// patched: `confirmPendingRecipeApplication` remains in the store as public
// API (a future NON-modal caller -- one that can't guarantee the dataset
// held still -- is exactly where its re-resolve/re-stage semantics are
// correct), and its message is fixed at the store layer (plotRecipes.ts) to
// say "still unmatched" rather than "the dataset changed" when the fresh
// resolution's unmatched set is identical to the staged one -- see
// plotRecipes.test.ts for that coverage. This dialog just never calls it.
//
// F4.4 SPATIAL: a v3 recipe's panel bindings that did not resolve (a sibling
// dataset by name, or a column by label) are listed ONCE, each with a picker
// -- choosing a stand-in calls `rebindPendingRecipePanel`, which re-resolves
// and replaces the staged entry in place; the plain unmatched list below
// then no longer names them. With nothing left unmatched the primary action
// reads plainly "Apply".
//
// Modal-backdrop convention borrowed from QuickPlotWithDialog/SplitDatasetDialog.

import { useId, useRef } from "react";

import type { RecipePanelIssue } from "../../lib/plotRecipeMatch";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { useDialogFocus } from "./useDialogFocus";
import { Button } from "../primitives";
import { RecipeThumbnail } from "../workshops/recipemanager/RecipeThumbnail";

/** Human-readable "recipe field -> current column" rows, built straight off
 *  the resolution's already-re-keyed indices + the live dataset's labels --
 *  no separate lookup table, so this can never show a mapping the resolution
 *  didn't actually produce. */
function mappingRows(
  mapping: { xKey: number | null; yKeys: number[]; y2Keys: number[]; groupKey: number | null; facetKey: number | null },
  labels: readonly string[],
): { field: string; value: string }[] {
  const labelOf = (i: number): string => labels[i] ?? `column ${i + 1}`;
  const rows: { field: string; value: string }[] = [];
  if (mapping.xKey !== null) rows.push({ field: "X axis", value: labelOf(mapping.xKey) });
  if (mapping.yKeys.length) rows.push({ field: "Y series", value: mapping.yKeys.map(labelOf).join(", ") });
  if (mapping.y2Keys.length) rows.push({ field: "Y2 series", value: mapping.y2Keys.map(labelOf).join(", ") });
  if (mapping.groupKey !== null) rows.push({ field: "Group", value: labelOf(mapping.groupKey) });
  if (mapping.facetKey !== null) rows.push({ field: "Facet", value: labelOf(mapping.facetKey) });
  return rows;
}

const PANEL_ROLE = { x: "X axis", y: "Y series", y2: "Y2 series" } as const;

/** The same wording `lib/plotRecipePanels.ts` puts in `unmatched`, so a
 *  rebind row and the plain list can never disagree on a field's name. */
function issueName(issue: RecipePanelIssue): string {
  return issue.kind === "dataset"
    ? `Panel ${issue.panel + 1} dataset ("${issue.name}")`
    : `Panel ${issue.panel + 1} ${PANEL_ROLE[issue.role]} ("${issue.label}")`;
}

function PanelRebindRow({ issue, datasets }: { issue: RecipePanelIssue; datasets: readonly Dataset[] }) {
  const rebind = useApp((s) => s.rebindPendingRecipePanel);
  const name = issueName(issue);
  const options =
    issue.kind === "dataset"
      ? datasets.map((d) => ({ value: d.id, label: d.name }))
      : (datasets.find((d) => d.id === issue.datasetId)?.data.labels ?? []).map((l, i) => ({ value: String(i), label: l }));
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
      <span style={{ flex: 1 }}>{name}</span>
      <select
        aria-label={name}
        value=""
        title="Pick the dataset or column this panel should use instead"
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          void rebind(
            issue.panel,
            issue.kind === "dataset" ? { datasetId: v } : { channels: { [issue.label]: Number(v) } },
          );
        }}
      >
        <option value="">{issue.kind === "dataset" ? "Choose a dataset…" : "Choose a column…"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </li>
  );
}

export default function PlotRecipeApplyDialog() {
  const pending = useApp((s) => s.pendingRecipeApplication);
  const datasets = useApp((s) => s.datasets);
  const dataset = pending ? datasets.find((d) => d.id === pending.datasetId) : undefined;
  const confirmPartial = useApp((s) => s.confirmPendingRecipeApplicationPartial);
  const cancel = useApp((s) => s.cancelPendingRecipeApplication);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // P3.3: Escape lives on the dialog box's React `onKeyDown` and nothing used
  // to move focus into the box, so Escape was dead unless the user had
  // clicked a button first. Focus-in also traps Tab and restores the opener.
  useDialogFocus(dialogRef, pending !== null);

  // Hooks above run unconditionally (SplitDatasetDialog's discipline) -- the
  // "nothing pending" return comes after.
  if (!pending) return null;

  const labels = dataset?.data.labels ?? [];
  const rows = mappingRows(pending.resolution.resolved.mapping, labels);
  const panelIssues = pending.resolution.panelIssues;
  const panelNames = new Set(panelIssues.map(issueName));
  const unmatched = pending.resolution.unmatched.filter((m) => !panelNames.has(m));
  const dropped = pending.resolution.unmatched.length;
  const warnings = pending.resolution.warnings;

  return (
    <div className="qz-overlay-backdrop" onMouseDown={cancel}>
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
          e.stopPropagation();
        }}
      >
        <h2 id={titleId}>Apply Plot Recipe “{pending.recipe.name}”</h2>
        {/* F4.2: what the recipe looks like, captured when it was saved. */}
        <RecipeThumbnail preview={pending.recipe.preview} label={pending.recipe.name} />
        {rows.length > 0 && (
          <table className="qzk-recipe-mapping" style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {rows.map((r) => (
                <tr key={r.field}>
                  <td className="qzk-ds-meta" style={{ paddingRight: 12 }}>{r.field}</td>
                  <td>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {panelIssues.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="qzk-ds-meta">Missing panel bindings ({panelIssues.length}):</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {panelIssues.map((issue) => (
                <PanelRebindRow key={issueName(issue)} issue={issue} datasets={datasets} />
              ))}
            </ul>
          </div>
        )}
        {unmatched.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="qzk-ds-meta">Unmatched fields ({unmatched.length}):</div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {unmatched.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div style={{ marginTop: 8, color: "var(--warning, var(--danger))" }}>
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}
        <div className="qz-btn-row" style={{ marginTop: 12 }}>
          <Button onClick={cancel}>Cancel</Button>
          <Button
            variant="primary"
            title={dropped > 0 ? "Applies the recipe using only the fields that matched, dropping the rest -- data loss, use with care" : "Applies the recipe as a new figure"}
            onClick={() => void confirmPartial()}
          >
            {dropped > 0 ? `Apply mapped fields (drops ${dropped} unmatched)` : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
