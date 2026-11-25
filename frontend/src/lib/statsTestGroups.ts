// Statistical tests: the families the workshop's "Test" select groups its
// options under (UX menus audit M3). `TestDef.family` stays the fine-grained
// tag the catalog and the result copy use; this maps each tag to one of the
// ten select groups, in a fixed display order. Pure so the grouping is
// unit-testable. Within a group tests keep catalog order.

import { STATS_TESTS, type TestDef } from "./statsTests";

/** Select groups in display order; `families` are the `TestDef.family` tags. */
const GROUPS: readonly { label: string; families: readonly string[] }[] = [
  { label: "Normality", families: ["Normality"] },
  { label: "Comparisons", families: ["Compare two", "Compare groups", "Multiple comparisons"] },
  { label: "Screening", families: ["Screening"] },
  { label: "Variance", families: ["Variances"] },
  { label: "Equivalence and intervals", families: ["Equivalence", "Intervals"] },
  { label: "Regression and classification", families: ["Regression", "Correlation", "Classification"] },
  { label: "Proportions and counts", families: ["Proportions", "Categorical"] },
  { label: "Survival", families: ["Survival"] },
  { label: "Quality control (SPC)", families: ["Quality (SPC)"] },
  { label: "Life data (reliability)", families: ["Reliability (life data)"] },
  { label: "Planning", families: ["Planning"] },
];

export interface TestGroup {
  label: string;
  tests: readonly TestDef[];
}

/** The catalog split into select groups. A test whose family is not mapped
 *  falls into a trailing "Other" group rather than disappearing. */
export function statsTestGroups(tests: readonly TestDef[] = STATS_TESTS): TestGroup[] {
  const mapped = new Set(GROUPS.flatMap((g) => g.families));
  const groups: TestGroup[] = GROUPS.map((g) => ({
    label: g.label,
    tests: tests.filter((t) => g.families.includes(t.family)),
  })).filter((g) => g.tests.length > 0);
  const other = tests.filter((t) => !mapped.has(t.family));
  if (other.length > 0) groups.push({ label: "Other", tests: other });
  return groups;
}
