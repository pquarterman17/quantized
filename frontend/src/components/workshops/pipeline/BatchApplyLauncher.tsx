// "Apply to selected sheets…" (worksheet audit #15): batch processing from a
// transform dialog, without a detour through the Recipe Library. The dialog
// hands over its CURRENT setup as a one-step recipe (`build`); this opens the
// Recipe Library's own apply section (ApplyRecipeSection — lazy) on it, seeded
// with the Library selection: a preflight per picked sheet, per-item status as
// the run goes, Cancel, and ONE undo step for the whole batch
// (runTemplate.applyRecipe). The recipe follows the dialog LIVE: it is rebuilt
// whenever the setup changes, so Apply runs what is on screen.

import { lazy, Suspense, useMemo, useRef, useState } from "react";

import { Button } from "../../primitives";
import type { AnalysisTemplate } from "../../../lib/template";
import { useApp } from "../../../store/useApp";

const ApplyRecipeSection = lazy(() => import("./ApplyRecipeSection"));

export default function BatchApplyLauncher({
  setup,
  build,
  disabledReason,
}: {
  /** Identity of the dialog's current setup: the recipe is REBUILT whenever
   *  it changes, so an open batch panel always applies what the dialog shows
   *  now — never the setup captured when the panel was opened. */
  setup: unknown;
  /** The dialog's current setup as a recipe (throws to refuse, with why). */
  build: () => AnalysisTemplate;
  /** Why the setup cannot be batch-applied right now ("" = it can). */
  disabledReason: string;
}) {
  const [open, setOpen] = useState(false);
  const running = useApp((s) => s.pipelineRunning);
  const latestBuild = useRef(build);
  latestBuild.current = build;
  const built = useMemo((): { recipe: AnalysisTemplate | null; error: string } => {
    if (!open || disabledReason) return { recipe: null, error: "" };
    try {
      return { recipe: latestBuild.current(), error: "" };
    } catch (e) {
      return { recipe: null, error: e instanceof Error ? e.message : "this setup cannot be applied to other sheets" };
    }
    // `setup` IS the dependency: a new setup means a new recipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, disabledReason, setup]);
  // While the setup is invalid the panel stays (picks and bindings kept) on
  // the last valid recipe, with Apply disabled and the reason on it.
  const shown = useRef<AnalysisTemplate | null>(null);
  if (built.recipe) shown.current = built.recipe;
  if (!open) shown.current = null;
  const recipe = shown.current;
  const blocked = disabledReason || built.error;
  // One grid item of the dialog: `minWidth: 0` lets the section's long lines
  // wrap inside the dialog instead of widening it.
  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "start", minWidth: 0 }}>
      <Button disabled={Boolean(disabledReason) || open} title={disabledReason || (open ? "The batch panel is open below" : "Run this same setup on each selected Library sheet, with a preflight first")} onClick={() => setOpen(true)}>
        Apply to selected sheets…
      </Button>
      {open && built.error && <p className="qz-error" role="alert">{built.error}</p>}
      {open && recipe && (
        <Suspense fallback={<div className="qzk-ds-meta">Loading…</div>}>
          <ApplyRecipeSection recipe={recipe} onClose={() => setOpen(false)} disabled={running || Boolean(blocked)} disabledReason={blocked || undefined} keepActive />
        </Suspense>
      )}
      {open && !recipe && !built.error && <Button onClick={() => setOpen(false)}>Close batch panel</Button>}
    </div>
  );
}
