import { csvTextCell } from "./csvCell";
import type { FitSpec } from "./types";

const numeric = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "" : String(value);

export interface FitParameterRow {
  name: string;
  value: number | null;
  error: number | null;
  fixed: boolean;
}

export function fitParameterRows(spec: FitSpec, names: readonly string[] = []): FitParameterRow[] {
  const count = Math.max(spec.params?.length ?? 0, spec.errors?.length ?? 0, spec.fixed?.length ?? 0);
  return Array.from({ length: count }, (_, index) => ({
    name: names[index] ?? `p${index + 1}`,
    value: spec.params?.[index] ?? null,
    error: spec.errors?.[index] ?? null,
    fixed: spec.fixed?.[index] === true,
  }));
}

/** Spreadsheet-safe export from the live Dataset.fitSpec authority. */
export function analysisFitTableCsv(spec: FitSpec, names: readonly string[] = []): string {
  const rows = fitParameterRows(spec, names).map((row) => [
    csvTextCell(row.name), numeric(row.value), numeric(row.error), row.fixed ? "true" : "false",
  ].join(","));
  return `parameter,value,standard_error,fixed\n${rows.join("\n")}\n`;
}
