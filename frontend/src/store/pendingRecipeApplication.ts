// The staged Plot Recipe application a preview+confirm dialog shows. Moved
// out of store/plotRecipes.ts (type-only, so it costs no bytes) to fund the
// `onCancel` hook under that file's 500-line ceiling.

import type { PlotRecipe } from "../lib/plotRecipe";
import type { RecipePanelBinding, RecipeResolution, ResolvedRecipeApplication } from "../lib/plotRecipeMatch";

/** A recipe resolution with `unmatched` fields, staged for a preview+confirm
 *  UI rather than applied immediately -- see store/plotRecipes.ts's module
 *  doc. */
export interface PendingPlotRecipeApplication {
  recipe: PlotRecipe;
  datasetId: string;
  resolution: Extract<RecipeResolution, { resolved: ResolvedRecipeApplication }>;
  /** Run once when the user CANCELS this preview (never on confirm, never
   *  when a new workspace simply replaces it). The Recipe Manager sets it to
   *  take back a transformation run made only for this apply (F4.2c (b)). A
   *  confirm that re-stages carries it over to the new pending entry. */
  onCancel?: () => void;
  /** F4.4 SPATIAL: the user's explicit answers to missing panel bindings
   *  (`rebindPendingRecipePanel`), keyed by panel index. Re-applied on every
   *  re-resolve of this pending entry, so a confirm honours them. */
  panelBindings?: Readonly<Record<number, RecipePanelBinding>>;
}
