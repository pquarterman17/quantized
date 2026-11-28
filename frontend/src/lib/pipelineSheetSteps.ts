// How the script exporter (lib/pipeline.ts) treats the worksheet-structure steps recorded by Protect / Unprotect,
// Pivot (long to wide, wide to long) and Insert column into similar sheets. None has a `quantized.api` equivalent
// (the API has no pivot, no sheet lock and no per-sheet column insert), so each is "NOT REPRODUCED" with its own
// reason rather than the generic one. Whether a later step may still run differs: a lock changes no data, so the
// steps after it still replay; a pivot makes a NEW worksheet and an insert edits other sheets, so the steps after
// them were recorded on data the script does not have and stop the replay, as any other unmapped data step does.

export interface SheetStepEmit {
  lines: string[];
  changesData: boolean;
  unmapped: string;
}

const RULES: readonly { re: RegExp; why: string; changesData: boolean }[] = [
  {
    re: /^qz\.(protectSheet|unprotectSheet)\(/,
    why: "sheet protection is a lock the app keeps on a worksheet; a script edits no worksheet through the app's edit paths, so there is nothing to lock",
    changesData: false,
  },
  {
    re: /^qz\.pivot\(/,
    why: "the time-series pivot (long to wide) has no quantized.api equivalent: the API has no pivot or reshape",
    changesData: true,
  },
  {
    re: /^qz\.unpivot\(/,
    why: "stacking columns under a key (wide to long) has no quantized.api equivalent: the API has no pivot or reshape",
    changesData: true,
  },
  {
    re: /^qz\.insertIntoSimilarSheets\(/,
    why: "inserting a column into every similar worksheet edits several worksheets of the open project, which quantized.api does not hold",
    changesData: true,
  },
];

/** The emit for a recorded "ui" step this module knows, else null. */
export function sheetStepEmit(code: string): SheetStepEmit | null {
  const rule = RULES.find((r) => r.re.test(code));
  return rule ? { lines: [], changesData: rule.changesData, unmapped: rule.why } : null;
}
