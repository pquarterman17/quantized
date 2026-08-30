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
// description, but `commands/relinkCommands.ts` publishes through a runtime
// registry (a hook mounted by Stage.tsx) rather than `buildAppActions`, so it
// never reaches the catalog Help searches — a `?` here would open an empty
// result list. Three modules use that pattern, hiding four commands from Help
// and the palette: relink-sources, paste-workbook, take-over-editing and
// open-as-copy. That is a P3.1 coverage gap in its own right (the existing
// "no undocumented command ships" guards only see the static set) and is
// booked rather than papered over here.

/** The topic for a workshop window, or undefined when it has none. */
export function workshopHelpTopic(id: string): string | undefined {
  return WORKSHOP_HELP[id];
}
