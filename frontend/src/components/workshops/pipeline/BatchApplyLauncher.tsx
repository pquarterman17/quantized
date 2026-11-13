// "Apply to selected sheets…" (worksheet audit #15): batch processing from a
// transform dialog, without a detour through the Recipe Library. The dialog
// hands over its CURRENT setup as a one-step recipe (`build`); this opens the
// Recipe Library's own apply section (ApplyRecipeSection — lazy) on it, seeded
// with the Library selection: a preflight per picked sheet, per-item status as
// the run goes, Cancel, and ONE undo step for the whole batch
// (runTemplate.applyRecipe).

import { lazy, Suspense, useState } from "react";

import { Button } from "../../primitives";
import type { AnalysisTemplate } from "../../../lib/template";
import { useApp } from "../../../store/useApp";

const ApplyRecipeSection = lazy(() => import("./ApplyRecipeSection"));

export default function BatchApplyLauncher({
  build,
  disabledReason,
}: {
  /** The dialog's current setup as a recipe (throws to refuse, with why). */
  build: () => AnalysisTemplate;
  /** Why the setup cannot be batch-applied right now ("" = it can). */
  disabledReason: string;
}) {
  const [recipe, setRecipe] = useState<AnalysisTemplate | null>(null);
  const [error, setError] = useState("");
  const running = useApp((s) => s.pipelineRunning);
  const open = () => {
    try {
      setRecipe(build());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "this setup cannot be applied to other sheets");
    }
  };
  return (
    <>
      <Button disabled={Boolean(disabledReason) || !!recipe} title={disabledReason || (recipe ? "The batch panel is open below" : "Run this same setup on each selected Library sheet, with a preflight first")} onClick={open}>
        Apply to selected sheets…
      </Button>
      {error && <p className="qz-error" role="alert">{error}</p>}
      {recipe && (
        <Suspense fallback={<div className="qzk-ds-meta">Loading…</div>}>
          <ApplyRecipeSection recipe={recipe} onClose={() => setRecipe(null)} disabled={running} />
        </Suspense>
      )}
    </>
  );
}
