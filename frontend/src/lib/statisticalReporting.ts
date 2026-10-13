import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";

export interface StatisticalReportingSummary {
  interpretation: string | null;
  effectSizes: string[];
  intervals: string[];
  assumptions: string[];
  adjustments: string[];
  missingData: string[];
}

// Match evidence labels as labels, not arbitrary substrings.  Loose matches
// made "beta" look like eta, "adjusted R²" look like a p-value adjustment,
// and "Multiple regression" look like a multiple-comparisons table.
const EFFECT = /\b(?:effect(?: size)?|cohen(?:'s)? d|cram[eé]r(?:'s)? v|omega(?: squared)?)\b|(?:^|\W)eta(?: squared)?(?:\W|$)|(?:^|\W)(?:adjusted\s+)?r(?:²|\^2)(?:\W|$)|\bodds ratio\b/i;
const INTERVAL = /confidence|prediction|\bci\b|\blower\b|\bupper\b/i;
const ASSUMPTION = /assumption|normal|shapiro|levene|homosced|equal variances|balanced|estimable|constant variable|approximate/i;
const ADJUSTMENT = /\b(?:multiple comparisons?|adjusted p(?:-value)?|p(?:-value)? adjustment|tukey|dunnett|bonferroni|holm|fdr|benjamini(?:-hochberg)?)\b/i;
const MISSING = /\b(?:missing data|missing values?|listwise deletion|non-finite (?:source )?(?:rows?|values?)|complete rows?)\b/i;

function shown(value: string | number | null): string {
  if (value === null) return "unavailable";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumSignificantDigits: 6 });
  return value;
}

function unique(values: readonly string[], limit = 12): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function rowContext(table: AnalysisResultTable, row: readonly (string | number | null)[]): string {
  const parts: string[] = [];
  for (let index = 0; index < Math.min(2, row.length); index += 1) {
    const value = row[index];
    if (typeof value === "string" && value && !EFFECT.test(table.columns[index] ?? "")) parts.push(value);
  }
  return parts.length ? ` (${parts.join(" · ")})` : "";
}

function columnEvidence(result: AnalysisResult, pattern: RegExp): string[] {
  const evidence: string[] = [];
  for (const table of result.tables ?? []) {
    table.columns.forEach((column, columnIndex) => {
      if (!pattern.test(column)) return;
      for (const row of table.rows) {
        const value = row[columnIndex];
        if (value === null || value === "") continue;
        evidence.push(`${table.title ?? "Result"}: ${column} = ${shown(value)}${rowContext(table, row)}`);
      }
    });
  }
  return evidence;
}

function scalarEvidence(result: AnalysisResult, pattern: RegExp): string[] {
  return Object.entries(result.scalarValues ?? {}).flatMap(([key, value]) =>
    pattern.test(key) && key !== "Interpretation" ? [`${key}: ${shown(value)}`] : []);
}

function warningEvidence(result: AnalysisResult, pattern: RegExp): string[] {
  return result.warnings.filter((warning) => pattern.test(warning));
}

function intervalEvidence(result: AnalysisResult): string[] {
  const evidence = scalarEvidence(result, INTERVAL);
  for (const table of result.tables ?? []) {
    const columns = table.columns.filter((column) => INTERVAL.test(column));
    if (!columns.length) continue;
    evidence.push(`${table.title ?? "Result"}: ${table.rows.length.toLocaleString()} saved row${table.rows.length === 1 ? "" : "s"} with ${columns.join(" / ")}.`);
  }
  return evidence;
}

function adjustmentEvidence(result: AnalysisResult): string[] {
  const evidence = scalarEvidence(result, ADJUSTMENT);
  for (const table of result.tables ?? []) {
    const matched = ADJUSTMENT.test(table.title ?? "") || table.columns.some((column) => ADJUSTMENT.test(column));
    if (matched) evidence.push(`${table.title ?? "Multiple comparisons"}: ${table.rows.length.toLocaleString()} saved comparison${table.rows.length === 1 ? "" : "s"}.`);
  }
  return evidence;
}

/** A producer-neutral evidence index for the common statistical workspace.
 * It only reports values already saved in the durable result. Absence is
 * explicit: it never turns "not recorded" into "assumption passed". */
export function statisticalReporting(result: AnalysisResult): StatisticalReportingSummary {
  const interpretation = typeof result.scalarValues?.Interpretation === "string"
    ? result.scalarValues.Interpretation
    : null;
  const effectSizes = unique([
    ...scalarEvidence(result, EFFECT),
    ...columnEvidence(result, EFFECT),
  ]);
  const intervals = unique(intervalEvidence(result));
  const assumptions = unique([
    ...scalarEvidence(result, ASSUMPTION),
    ...columnEvidence(result, ASSUMPTION),
    ...warningEvidence(result, ASSUMPTION),
  ]);
  const adjustments = unique(adjustmentEvidence(result));
  const missingData = unique([
    ...scalarEvidence(result, MISSING),
    ...warningEvidence(result, MISSING),
  ]);
  return {
    interpretation,
    effectSizes: effectSizes.length ? effectSizes : ["No effect size was recorded for this result."],
    intervals: intervals.length ? intervals : ["No confidence or prediction interval was recorded for this result."],
    assumptions: assumptions.length ? assumptions : ["No assumption check was recorded for this result."],
    adjustments: adjustments.length ? adjustments : ["No multiple-comparison adjustment was recorded for this result."],
    missingData: missingData.length ? missingData : ["The missing-data policy was not recorded for this result."],
  };
}
