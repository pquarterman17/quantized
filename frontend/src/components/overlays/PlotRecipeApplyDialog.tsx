// Plot Recipe apply preview+confirm (P1.3 wave 3, Lane D deliverable 4).
// Renders `pendingRecipeApplication` (store/plotRecipes.ts) -- the mapping
// preview (which recipe field resolved to which CURRENT column), the
// unmatched-field list, and any warnings verbatim (they already name
// candidates/collisions, see plotRecipeMatch.ts's `candidateList`) -- with
// three actions:
//   - Confirm: `confirmPendingRecipeApplication` (re-resolves, applies only
//     on a clean fresh match, else RE-STAGES with a "dataset changed" status
//     -- this dialog just re-renders off the fresh `pendingRecipeApplication`
//     + `status` the store set, no special-casing needed here).
//   - Apply anyway (drop unmatched): the wave-3 booked action,
//     `confirmPendingRecipeApplicationPartial` -- deliberately the SECONDARY
//     (ghost-variant) button with explicit wording, since it is a data-losing
//     opt-in, never the default choice.
//   - Cancel: `cancelPendingRecipeApplication`.
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
  const status = useApp((s) => s.status);
  const dataset = useApp((s) => (pending ? s.datasets.find((d) => d.id === pending.datasetId) : undefined));
  const confirm = useApp((s) => s.confirmPendingRecipeApplication);
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
        {status.includes("dataset changed") && (
          <p className="qzk-ds-meta" style={{ color: "var(--warning, var(--danger))" }}>
            {status}
          </p>
        )}
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
          {unmatched.length > 0 && (
            <Button
              variant="ghost"
              title="Applies the recipe using only the fields that matched, dropping the rest -- data loss, use with care"
              onClick={() => void confirmPartial()}
            >
              Apply anyway (drop {unmatched.length} unmatched)
            </Button>
          )}
          <Button variant="primary" onClick={() => void confirm()}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
