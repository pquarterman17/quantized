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
// Modal-backdrop convention borrowed from QuickPlotWithDialog/SplitDatasetDialog.

import { useApp } from "../../store/useApp";
import { Button } from "../primitives";

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

export default function PlotRecipeApplyDialog() {
  const pending = useApp((s) => s.pendingRecipeApplication);
  const dataset = useApp((s) => (pending ? s.datasets.find((d) => d.id === pending.datasetId) : undefined));
  const confirmPartial = useApp((s) => s.confirmPendingRecipeApplicationPartial);
  const cancel = useApp((s) => s.cancelPendingRecipeApplication);

  // Hooks above run unconditionally (SplitDatasetDialog's discipline) -- the
  // "nothing pending" return comes after.
  if (!pending) return null;

  const labels = dataset?.data.labels ?? [];
  const rows = mappingRows(pending.resolution.resolved.mapping, labels);
  const unmatched = pending.resolution.unmatched;
  const warnings = pending.resolution.warnings;

  return (
    <div className="qz-overlay-backdrop" onMouseDown={cancel}>
      <div
        className="qzk-glass qz-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
          e.stopPropagation();
        }}
      >
        <h2>Apply Plot Recipe “{pending.recipe.name}”</h2>
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
            title="Applies the recipe using only the fields that matched, dropping the rest -- data loss, use with care"
            onClick={() => void confirmPartial()}
          >
            Apply mapped fields (drops {unmatched.length} unmatched)
          </Button>
        </div>
      </div>
    </div>
  );
}
