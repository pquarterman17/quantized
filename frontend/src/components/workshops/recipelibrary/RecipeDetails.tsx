// P3.5 slice 4 — the disclosure region a Library row's "Details" toggle
// reveals. Deliberately small and dumb: all the per-kind reasoning lives in
// `lib/recipeDetails.ts`, which this renders verbatim as a `<dl>` (fields)
// plus titled `<ul>` sections. `id` is set by the caller so the row's own
// toggle button can point `aria-controls` at it.

import type { RecipeDetails as RecipeDetailsData } from "../../../lib/recipeDetails";

export function RecipeDetails({ id, details }: { id: string; details: RecipeDetailsData | null }) {
  if (!details) {
    return (
      <div id={id} className="qz-recipe-details qz-recipe-details-gone">
        This recipe is no longer available.
      </div>
    );
  }
  return (
    <div id={id} className="qz-recipe-details">
      <dl className="qz-recipe-details-fields">
        {details.fields.map((f) => (
          <div className="qz-recipe-details-row" key={f.label}>
            <dt>{f.label}</dt>
            <dd className={f.mono ? "qz-mono" : undefined}>{f.value}</dd>
          </div>
        ))}
      </dl>
      {details.sections?.map((s) => (
        <div className="qz-recipe-details-section" key={s.title}>
          <div className="qz-recipe-details-section-title">{s.title}</div>
          {s.items.length === 0 ? (
            <div className="qz-recipe-details-empty">none</div>
          ) : (
            <ul>
              {s.items.map((item, i) => (
                // Kind-specific text lines, not identifiers — no stable key
                // exists to use besides position, and this list is never
                // reordered in place (a re-render replaces the whole array).
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default RecipeDetails;
