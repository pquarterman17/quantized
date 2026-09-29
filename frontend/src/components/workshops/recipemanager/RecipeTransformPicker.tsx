// One Recipe Manager row's Transform picker (F4.2c owner decision (c), "Pre-
// select but also easy override"). Per row, because each Plot Recipe records
// its own transformation: the picker starts on that one (marked "(recorded)")
// when it is still saved, and on None otherwise, with a one-sentence note
// when the recorded one is gone. Picking another entry, or None, is the one-
// action override; the choice lives in the panel and never edits the recipe.

import type { PlotRecipe } from "../../../lib/plotRecipe";
import type { AnalysisTemplate } from "../../../lib/template";
import { Select } from "../../primitives";

export function RecipeTransformPicker({
  recipe,
  transforms,
  value,
  missing,
  onChange,
}: {
  recipe: PlotRecipe;
  transforms: readonly AnalysisTemplate[];
  value: string;
  missing: string | null;
  onChange: (value: string) => void;
}) {
  const rec = recipe.transform;
  const label = (t: AnalysisTemplate): string => {
    const rev = t.revision ?? 1;
    const base = `${t.name} (r${rev})`;
    if (!rec || rec.name !== t.name) return base;
    return rec.revision === rev ? `${base} (recorded)` : `${base} (recorded as r${rec.revision})`;
  };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", paddingLeft: 58 }}>
      <label className="qzk-field-lbl">Transform</label>
      <Select
        aria-label={`Transformation for ${recipe.name}`}
        title="Saved transformation recipe to run first; the recipe is applied to its new output dataset."
        options={[{ value: "", label: "None" }, ...transforms.map((t) => ({ value: t.name, label: label(t) }))]}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {missing !== null && (
        <span className="qzk-ds-meta">{`Recorded transformation “${missing}” is no longer saved, so it defaults to None.`}</span>
      )}
    </div>
  );
}
