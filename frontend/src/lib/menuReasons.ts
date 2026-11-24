// The one phrase for "there is no dataset to act on" (UX menus audit N2). The
// menus (commands/menuAvailability.ts) and the Analyze requirement predicates
// (lib/analysisRequirements.ts) used three wordings for the same condition:
// "Import or select a dataset first", "Needs an active worksheet" and "No
// datasets yet: import one first". Tiny and eager-safe so both can import it.

export const NEEDS_DATASET = "Import or select a dataset first";
