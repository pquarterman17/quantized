// The Send-to-report dialog's Report picker labels. Extracted from
// lib/sendFigureToReport.ts (which re-exports both names) to keep that module
// under the 500-line ceiling when the fitted-plot send requirement landed.

import type { ReportEntry } from "./report";

/** The "make a new report" choice in the Report picker. */
export const NEW_REPORT = "New report";

/** One picker label per report, index-aligned with `reports` and unique
 *  (a select can only hand back the label): the report's name, with its id
 *  appended when that name collides — with another report, with
 *  {@link NEW_REPORT}, or with another report's id-suffixed label (a second
 *  pass). A pathological set still colliding after that is numbered by
 *  position, which is unique by construction. */
export function reportChoices(reports: readonly ReportEntry[]): string[] {
  const colliding = (ls: string[]) =>
    ls.map((l) => l === NEW_REPORT || ls.indexOf(l) !== ls.lastIndexOf(l));
  let labels = reports.map((r) => r.name);
  for (let pass = 0; pass < 2; pass++) {
    const bad = colliding(labels);
    labels = labels.map((l, i) => (bad[i] && l === reports[i].name ? `${l} (${reports[i].id})` : l));
  }
  return colliding(labels).some(Boolean) ? labels.map((l, i) => `${i + 1}. ${l}`) : labels;
}
