import { BUILTIN_PLOT_RECIPES } from "../../../lib/builtinPlotRecipes";
import type { PlotRecipe } from "../../../lib/plotRecipeSchema";
import type { BatchRecipeChoice } from "../../../store/batchFigureBuild";

export type BatchFigurePhase = "idle" | "checking" | "review" | "creating" | "done";

export const SCOPE_LABEL = { project: "Project", global: "Global", "built-in": "Built-in" } as const;
export const STATUS_LABEL = { ready: "Ready", partial: "Needs review", blocked: "Cannot build" } as const;
export const STATUS_TONE = { ready: "ok", partial: "warn", blocked: "danger" } as const;
// "pdf-pages": ONE PDF with a page per figure (gap-audit-2 #10), not a ZIP.
export const EXPORT_FORMATS = ["pdf", "pdf-pages", "svg", "png", "tiff"] as const;
export const exportFormatLabel = (f: (typeof EXPORT_FORMATS)[number]): string => (f === "pdf-pages" ? "PDF, one file (a page each)" : `${f.toUpperCase()} (ZIP)`);
export function batchRecipeChoices(
  project: readonly PlotRecipe[],
  global: readonly PlotRecipe[],
): BatchRecipeChoice[] {
  return [
    ...project.map((recipe) => ({ key: `project:${recipe.id}`, scope: "project" as const, recipe })),
    ...global.map((recipe) => ({ key: `global:${recipe.id}`, scope: "global" as const, recipe })),
    ...BUILTIN_PLOT_RECIPES.map((recipe) => ({ key: `built-in:${recipe.id}`, scope: "built-in" as const, recipe })),
  ];
}
