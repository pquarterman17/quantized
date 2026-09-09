// P3.1 — one metadata source for workshop-level contextual help.
//
// The shipped P3.1 slices gave curated commands a shared one-sentence
// description and put `?` actions on five Inspector cards via `Card`'s
// `helpTopic`. Extending that to workshops could not reuse the same prop:
// measured on this tree, 59 of the 64 `<Card>`s under `components/workshops`
// are single-formula DiraCulator cards — a `?` on each is exactly the clutter
// P3.1's goal warns against — and the complex workshops render no `Card` at
// all. What every workshop DOES share is `ToolWindow`, already keyed by a
// stable id, so the affordance lives in its title bar and is driven from here.
//
// Keyed by `ToolWindow` id so panels need no per-file edit and the topic
// strings stay in one place rather than scattered as literals across 24
// components. `ToolWindow` looks its own id up; passing an explicit
// `helpTopic` still overrides.
//
// Every value is a SEARCH QUERY against the shared command metadata, not a
// separate catalog — `workshopHelp.test.ts` fails if any entry stops matching
// a real command, so a renamed command cannot leave a `?` pointing at nothing.

/** ToolWindow id → Help search query. */
export const WORKSHOP_HELP: Readonly<Record<string, string>> = {
  baseline: "Baseline background",
  calculators: "DiraCulator materials calculators",
  curvefit: "Curve fit",
  datasetmath: "Dataset math",
  digitizer: "Graph digitizer",
  graphbuilder: "Graph Builder",
  magtools: "Magnetometry",
  multivar: "Multivariate",
  "outlier-screening": "Outlier screening",
  "pack-project": "Pack Project",
  peaks: "Find peaks",
  peakwizard: "Peak analyzer",
  pipeline: "Pipeline",
  "recipe-library": "Recipe Library",
  "recipe-manager": "Plot recipes",
  "recode-workshop": "Recode",
  reflview: "Reflectometry view",
  report: "Report",
  "roi-cuts": "ROI cuts",
  rsm: "RSM analysis",
  search: "Find in project",
  "sqlite-query": "SQLite",
  statschooser: "Test chooser",
  tabulate: "Tabulate",
  variability: "Variability chart",
};

// DELIBERATELY ABSENT: "relink-sources". Its command is real and carries a
// description, and (2026-09-09) IS now searchable — `HelpDialog.tsx` merges
// the runtime registry (`useCommands`/`setMenuCommands`, which
// `commands/relinkCommands.ts`, `workbookTransferCommands.ts`, and
// `projectLockCommands.ts` publish through, rather than `buildAppActions`) in
// on open, the same snapshot `CommandPalette.tsx` already took. So a `?` here
// would now open a non-empty result list — it stays absent from this map
// because none of these four commands is a WORKSHOP's `ToolWindow` (this
// map's actual key space: `relink-sources` etc. are File-menu/palette-only
// actions with no `ToolWindow` id of their own to key off), not because
// they're unfindable. See `HelpDialog.test.tsx`'s "HelpDialog search
// includes registry-published commands" for the coverage.

/** The topic for a workshop window, or undefined when it has none. */
export function workshopHelpTopic(id: string): string | undefined {
  return WORKSHOP_HELP[id];
}
