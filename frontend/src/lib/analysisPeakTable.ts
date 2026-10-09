import { csvTextCell } from "./csvCell";
import type { PeakTable, PeakTableEntry } from "./peakTable";

const numeric = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "" : String(value);

/** Full-fidelity, spreadsheet-safe export of the peak table authority. */
export function analysisPeakTableCsv(table: PeakTable): string {
  const header = [
    "included", "center", "center_1sigma", "fwhm", "fwhm_1sigma",
    "height", "height_1sigma", "area", "area_1sigma", "background",
    "eta", "eta_1sigma", "model", "status",
  ];
  const row = (peak: PeakTableEntry): string => [
    peak.excluded ? "false" : "true",
    numeric(peak.center), numeric(peak.centerErr), numeric(peak.fwhm), numeric(peak.fwhmErr),
    numeric(peak.height), numeric(peak.heightErr), numeric(peak.area), numeric(peak.areaErr),
    numeric(peak.bg), numeric(peak.eta), numeric(peak.etaErr),
    csvTextCell(peak.model), csvTextCell(peak.status),
  ].join(",");
  return `${header.join(",")}\n${table.peaks.map(row).join("\n")}\n`;
}
