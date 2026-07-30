// "Coming from JMP" migration tips for the Help hub (J17 in JMP_GAP_PLAN).
//
// quantized targets JMP users, and this guide maps daily JMP workflows to their
// quantized equivalents. Accuracy discipline: every `quantized` string below names
// a real, verified menu label / tool (cross-checked against commands/*.ts and
// worksheet menus). A tip that points at a nonexistent menu path is worse than
// no tip. jmpTips.test.ts pins the shape; tool references resolve against the
// shared command metadata.

import type { HelpItem } from "./helpContent";

export interface JmpTip {
  id: string;
  /** What you'd do in JMP. */
  jmp: string;
  /** How to do it in quantized. */
  quantized: string;
  keywords?: string;
}

export const JMP_TIPS: readonly JmpTip[] = [
  {
    id: "formula-column",
    jmp: "Data > New column from formula (computed column)",
    quantized:
      "Right-click a column header in the worksheet and choose New column from formula…. The formula language supports row-scoped arithmetic (addition, subtraction, multiplication, division, exponents, trigonometry, and standard functions).",
    keywords: "formula column computed derived row formula data math",
  },
  {
    id: "local-data-filter",
    jmp: "Rows > Data Filter (filter rows by column ranges and levels)",
    quantized:
      "Data ▸ Data filter (live per-column row filter)… sets up conditions on one or more columns (range, level-set, or logical) with AND combining. The filter applies to all downstream analyses.",
    keywords: "data filter rows exclude condition level range local",
  },
  {
    id: "exclude-rows",
    jmp: "Rows > Exclude / Hide (remove rows from an analysis)",
    quantized:
      "Right-click a row in the worksheet and choose Mask row to exclude it. Masked rows are skipped in analyses and plots. Unmask all rows to restore them.",
    keywords: "exclude hide rows mask row selection delete remove",
  },
  {
    id: "tabulate",
    jmp: "Analyze > Tabulate (grouped summary statistics by column)",
    quantized:
      "Data ▸ Tabulate (group summary stats by column)… groups rows by one or more columns and calculates statistics for selected value columns (count, sum, mean, std, min, max).",
    keywords: "tabulate group summary statistics aggregate table",
  },
  {
    id: "split-by-group",
    jmp: "Rows > Split (separate data by factor levels) or Analyze > By (run a platform separately for each level)",
    quantized:
      "Distribution and Fit Y by X have a native By column (optional select) that runs the analysis once per level and sections the results, no data duplication. Other tools still need Data ▸ Split by column value… (creates one derived dataset per distinct value) to run an analysis once per group.",
    keywords: "split by group by column factor level group by separate",
  },
  {
    id: "join",
    jmp: "Tables > Join (combine two tables by matching key columns)",
    quantized:
      "Data ▸ Join datasets by key… combines two open datasets by matching values in selected key columns (inner, left, right, or full join).",
    keywords: "join merge combine key match datasets tables",
  },
  {
    id: "stack-unstack",
    jmp: "Tables > Stack (convert columns to rows) or Unstack (pivot rows to columns)",
    quantized:
      "Data ▸ Stack columns to long form… reshapes wide columns into category and value columns in long form. Unstack / pivot to wide form… pivots category and value columns into separate columns.",
    keywords: "stack unstack pivot reshape transpose long wide form",
  },
  {
    id: "graph-builder",
    jmp: "Analyze > Graph Builder (interactive plot construction by dragging columns into roles)",
    quantized:
      "Plot ▸ Graph Builder (drag columns into X/Y/Group wells)… builds a plot by dragging data channels into X, Y, Group, and Facet roles. The mark type (scatter, line, box, etc.) morphs as you change the column structure.",
    keywords: "graph builder plot chart drag group facet x y",
  },
  {
    id: "distribution",
    jmp: "Analyze > Distribution (histogram, quantiles, normality test for one or more columns)",
    quantized:
      "Analyze ▸ Distribution (histogram + normality of a column)… inspects one column with a histogram, quantiles, descriptive statistics, distribution fit, and normality verdict (Shapiro-Wilk / Anderson-Darling).",
    keywords: "distribution histogram normality quantile descriptive stats",
  },
  {
    id: "test-chooser",
    jmp: "Analyze > Test Chooser (guided statistical test selection and execution)",
    quantized:
      "Analyze ▸ Test chooser (which stats test? + run it)… recommends a statistical test based on your data shape and assumptions, explains the test's conditions, and runs it with results and interpretation.",
    keywords: "test chooser statistics hypothesis test guide anova t-test",
  },
  {
    id: "saved-script-to-pipeline",
    jmp: "File > Save / Run Script (JSL scripts save and replay an analysis sequence)",
    quantized:
      "Data ▸ Pipeline (edit + re-run recorded steps)… records every transformation and analysis; open it to inspect, edit, and rerun the steps. For headless scripting, export a Python recipe and run quantized.api in script mode.",
    keywords: "script pipeline recipe save replay recalc reproduce reproducible",
  },
];

/** Normalize a tip into a searchable HelpItem so the one Help search finds
 *  it. Matches on the JMP term (title) and the quantized answer + keywords. */
export function tipToHelpItem(t: JmpTip): HelpItem {
  return {
    key: `jmp:${t.id}`,
    title: t.jmp,
    detail: t.quantized,
    meta: "Coming from JMP",
    keywords: `jmp migration jsl ${t.keywords ?? ""}`,
  };
}
