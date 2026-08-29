// The allowlist of `localStorage` slots the diagnostics bundle may name.
//
// WHY AN ALLOWLIST AND NOT A PREFIX MATCH. `store/diagnostics.ts` used to
// report every `qz.`-prefixed key verbatim, on the reasoning that the app owns
// that namespace so the names are its own. That holds only while every key is
// a fixed literal — which is true today (the ratchet in `architecture.test.ts`
// proves it) but is not a property the namespace itself guarantees. The moment
// a feature persists per-object state under a composed key — `qz.figure.<user
// title>`, `qz.project.<path>` — the KEY becomes user content, and a bundle
// whose whole promise is "shape, never content" starts shipping unpublished
// sample names in its most innocuous-looking section. Naming the safe slots
// explicitly makes that impossible by construction rather than by convention.
//
// Unknown slots are not dropped: `collectDiagnostics` aggregates them into a
// count and a byte total, so the section still answers the question it exists
// to answer ("what is filling my quota?") without ever printing a name it has
// not vetted.
//
// KEEPING THIS HONEST. This list duplicates key constants that live next to
// the code using them, which is deliberate — those modules stay readable on
// their own, and the registry-plus-ratchet pairing is the same idiom as
// `channelRemap`'s field registries. `architecture.test.ts` fails the build
// when a `"qz.…"` literal appears in `src/` without a matching entry here, so
// the duplication cannot drift silently: adding a slot is a two-line change
// with a red build in between, and forgetting the entry is loud rather than a
// quiet new field in a shared report.

/** Every `localStorage` slot this app writes, as of the ratchet's last run.
 *  Sorted to match the report's own ordering, and to keep diffs minimal. */
export const KNOWN_STORAGE_KEYS: readonly string[] = [
  "qz.analysisTemplates",
  "qz.autosave",
  "qz.calcHistory",
  "qz.customFitModels",
  "qz.graphTemplates",
  "qz.interactionHints.seen",
  "qz.interactionPrefs",
  "qz.libraryViewPrefs",
  "qz.peakRecipes",
  "qz.plotPerfPrefs",
  "qz.plotRecipes",
  "qz.prefs",
  "qz.recent",
  "qz.recentProjects",
  "qz.session.active",
  "qz.toolbarPrefs",
  "qz.workingPaths",
] as const;

const KNOWN = new Set(KNOWN_STORAGE_KEYS);

/** True when `key` is a vetted slot whose NAME is safe to print. */
export function isKnownStorageKey(key: string): boolean {
  return KNOWN.has(key);
}
