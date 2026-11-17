import { csvTextCell } from "./csvCell";
import { roundToError } from "./fitValueFormat";
import type { PeakTable, PeakTableEntry } from "./peakTable";

const numeric = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "" : String(value);

const usable = (e: number | null | undefined): e is number =>
  typeof e === "number" && Number.isFinite(e) && e > 0;

/** A value and its 1σ, both PDG-rounded (lib/fitValueFormat's rule, the one
 *  every on-screen table uses) and written as plain spreadsheet numbers
 *  ("28.4398", "5.94e-4"); without a usable σ the value at full precision —
 *  there is no uncertainty to round it to (UX audit 9 #3: 15-digit floats
 *  beside a σ of 2e-4 claimed a precision the fit does not have). */
function pair(value: number, err: number | null | undefined): [string, string] {
  const r = Number.isFinite(value) && usable(err) ? roundToError(value, err) : null;
  if (!r) return [numeric(value), numeric(err)];
  const t = r.mag === 0 ? "" : `e${r.mag}`;
  return [r.value + t, r.error + t];
}

type ErrKey = "centerErr" | "fwhmErr" | "heightErr" | "areaErr" | "etaErr";
const COLUMNS: readonly [string, (p: PeakTableEntry) => number | null, ErrKey | null][] = [
  ["center", (p) => p.center, "centerErr"],
  ["fwhm", (p) => p.fwhm, "fwhmErr"],
  ["height", (p) => p.height, "heightErr"],
  ["area", (p) => p.area, "areaErr"],
  ["background", (p) => p.bg, null],
  ["eta", (p) => p.eta, "etaErr"],
];

/** Full-fidelity, spreadsheet-safe export of the peak table authority. A
 *  `<name>_1sigma` column is written only when some row has that σ. */
export function analysisPeakTableCsv(table: PeakTable): string {
  const withErr = (k: ErrKey | null): k is ErrKey => k !== null && table.peaks.some((p) => usable(p[k]));
  const header = ["included"];
  for (const [name, , k] of COLUMNS) header.push(name, ...(withErr(k) ? [`${name}_1sigma`] : []));
  header.push("model", "status");
  const row = (peak: PeakTableEntry): string => {
    const cells = [peak.excluded ? "false" : "true"];
    for (const [, get, k] of COLUMNS) {
      const v = get(peak);
      if (!withErr(k)) { cells.push(numeric(v)); continue; }
      const [vs, es] = v === null ? ["", ""] : pair(v, peak[k]);
      cells.push(vs, es);
    }
    cells.push(csvTextCell(peak.model), csvTextCell(peak.status));
    return cells.join(",");
  };
  return `${header.join(",")}\n${table.peaks.map(row).join("\n")}\n`;
}
