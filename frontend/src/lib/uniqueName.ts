// First free "<name>", "<name> (2)", "<name> (3)"… for the name-keyed recipe
// systems, whose `save*` functions UPSERT BY NAME — so writing under a taken
// name silently merges two records into one.
//
// Its own module, with zero imports, and that is structural rather than
// fussy. `lib/originTemplate.ts` needs it and is eagerly reachable;
// `lib/nameKeyedRecipes.ts` needs it and must NOT be, because it statically
// imports `lib/recipeIndex.ts` and all four recipe stores. With the helper
// living in `nameKeyedRecipes`, the eager side reached that module and stayed
// small only because Rollup could tree-shake everything else away — true
// today, and one module-level const away from silently pulling the sidecar
// index onto first paint. A leaf module with no dependencies cannot drag
// anything in no matter how it is imported.
export function uniqueTemplateName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}
