// Which saved input column no longer fits the live source, by name. A stale
// result's recovery note used to say only that "a column they use is missing or
// changed"; the reader then had to guess which one. The columns a snapshot used
// are recorded on its envelope (`selection.channels`: index, label, unit), so
// each is checked against the source as it is now. Read-only, no persisted field.
//
// Caveat on "became non-numeric": a text column is stored as float codes plus a
// level table, so it cannot be told from a grouping column that was always
// categorical. A saved channel that carried a unit was numeric, so only those
// are reported when they turn categorical; a column with no finite value at all
// is reported whatever its unit.

import type { AnalysisResult } from "./analysisResult";
import { isCategoricalChannel } from "./categorical";
import type { Dataset } from "./types";

/** One plain sentence fragment per problem column, in the saved channel order.
 *  Empty when the source is absent, the result recorded no channels, or every
 *  recorded column still matches. */
export function snapshotColumnIssues(result: AnalysisResult, source: Dataset | undefined): string[] {
  const channels = result.selection?.channels;
  if (!source || !channels?.length) return [];
  const { labels, values } = source.data;
  const issues: string[] = [];
  for (const channel of channels) {
    const name = `“${channel.label}”`;
    const here = labels[channel.index];
    if (here !== channel.label) {
      const moved = labels.indexOf(channel.label);
      issues.push(moved >= 0
        ? `${name} moved from column ${channel.index + 1} to column ${moved + 1}`
        : here === undefined
          ? `${name} is no longer in “${source.name}”`
          : `column ${channel.index + 1} (saved as ${name}) is now “${here}”`);
      continue;
    }
    if (isCategoricalChannel(source.data, channel.index) && channel.unit) {
      issues.push(`${name} is now a text (categorical) column`);
    } else if (!values.some((row) => Number.isFinite(row[channel.index]))) {
      issues.push(`${name} has no numeric values now`);
    }
  }
  return issues;
}
