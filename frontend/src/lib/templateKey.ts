// The localStorage key for saved analysis templates / transformation
// recipes (lib/template.ts's persistence). Split out into its own tiny,
// EAGER-safe module (finding #10) — lib/contextActions.ts is eager and
// deliberately avoids importing lib/template.ts itself (its parser, and
// P2.5's transformation-recipe fields, stay in the lazy chunk; see that
// file's own `hasSavedTemplates` comment), so it used to duplicate the
// string literal instead. A module holding only a constant, with no
// imports of its own, costs nothing to pull into the eager bundle and
// gives both sides one place to agree on the key.
export const TEMPLATES_KEY = "qz.analysisTemplates";
