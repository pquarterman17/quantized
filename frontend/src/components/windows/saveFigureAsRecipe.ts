// Save-as-Recipe entry point (P1.3 wave 3, Lane D deliverable 2) -- the
// `figureLifecycleUi.ts` `saveFigureAs` sibling, same "prompt for a name via
// the existing `askParams` dialog primitive, then delegate to the one store
// action" shape. Split into its OWN module (rather than living alongside
// `saveFigureAs` in the always-eager `figureLifecycleUi.ts`) purely for the
// MAIN_PLAN #29 bundle-size budget: `useWindowCommands.ts`'s "Save as Plot
// Recipe…" command is only ever needed after an explicit user gesture, so
// its `run()` dynamically imports this file (see that file's registration)
// rather than paying for it on every app boot -- the SAME "anything only
// needed after a user action can be a dynamic import()" rule
// `store/plotRecipes.ts`'s own `recipeLibs()` follows for
// `lib/plotRecipeMatch.ts`.

import { useApp } from "../../store/useApp";
import { plotWindowDatasetId } from "../../store/windowDocuments";

/** `saveAsPlotRecipe` itself owns the "focused window bound to THIS dataset"
 *  validation and its own status message on failure (dataset vanished, or
 *  the focused window isn't a plot window on it) -- this wrapper only
 *  resolves the FOCUSED window's dataset id up front so the dialog isn't
 *  even offered when there's nothing to capture. */
export async function saveFocusedFigureAsRecipe(): Promise<void> {
  const state = useApp.getState();
  const windowId = state.focusedWindowId;
  const window = windowId ? state.plotWindows.find((w) => w.id === windowId) : undefined;
  const datasetId = window && window.kind === "plot" ? plotWindowDatasetId(window) : null;
  if (!datasetId) {
    state.setStatus("Save as Plot Recipe unavailable: no focused plot window");
    return;
  }
  const { askParams } = await import("../overlays/ParamDialog");
  const params = await askParams("Save as Plot Recipe", [
    { key: "name", label: "Name", type: "text", default: window!.title || "Untitled Plot Recipe" },
  ]);
  if (params) await useApp.getState().saveAsPlotRecipe(String(params.name), datasetId);
}
