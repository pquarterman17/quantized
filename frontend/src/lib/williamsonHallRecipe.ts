import type { AnalysisResult } from "./analysisResult";
import type { PeakTable } from "./peakTable";
import type { Dataset } from "./types";

export interface WilliamsonHallPeakRow { twoTheta: number; fwhm: number }

export interface WilliamsonHallRecipe {
  rows: WilliamsonHallPeakRow[];
  wavelengthA: number;
  kFactor: number;
  instrumentalBroadeningDeg: number;
  sourceKind: "manual" | "peak-table";
  peakTableFingerprint?: string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Fingerprint only the peak-table inputs that feed this reduction. The raw
 * worksheet is guarded separately by analysisDataFingerprint. */
export function williamsonHallPeakTableFingerprint(table: PeakTable): string {
  const serialized = JSON.stringify({
    fittedAt: table.provenance.fittedAt,
    source: table.provenance.fingerprint ?? null,
    wavelengthA: table.provenance.wavelengthA ?? null,
    peaks: table.peaks.filter((peak) => !peak.excluded).map((peak) => [peak.center, peak.fwhm]),
  });
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995); b ^= b >>> 15;
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

export function williamsonHallRecipe(result: AnalysisResult): WilliamsonHallRecipe | null {
  if (result.producer.id !== "williamson-hall") return null;
  const value = result.parameters?.recipe;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.rows) || raw.rows.length < 2 || raw.rows.length > 10_000 ||
      !finite(raw.wavelengthA) || raw.wavelengthA <= 0 || !finite(raw.kFactor) || raw.kFactor <= 0 ||
      !finite(raw.instrumentalBroadeningDeg) || raw.instrumentalBroadeningDeg < 0 ||
      (raw.sourceKind !== "manual" && raw.sourceKind !== "peak-table") ||
      (raw.sourceKind === "peak-table" && typeof raw.peakTableFingerprint !== "string")) return null;
  const rows: WilliamsonHallPeakRow[] = [];
  for (const item of raw.rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (!finite(row.twoTheta) || row.twoTheta <= 0 || row.twoTheta >= 180 ||
        !finite(row.fwhm) || row.fwhm <= 0) return null;
    rows.push({ twoTheta: row.twoTheta, fwhm: row.fwhm });
  }
  return {
    rows, wavelengthA: raw.wavelengthA, kFactor: raw.kFactor,
    instrumentalBroadeningDeg: raw.instrumentalBroadeningDeg,
    sourceKind: raw.sourceKind,
    ...(typeof raw.peakTableFingerprint === "string" ? { peakTableFingerprint: raw.peakTableFingerprint } : {}),
  };
}

export function williamsonHallPeakBindingMatches(result: AnalysisResult, source: Dataset): boolean {
  const recipe = williamsonHallRecipe(result);
  if (!recipe || recipe.sourceKind !== "peak-table") return recipe !== null;
  return !!source.peakTable && recipe.peakTableFingerprint === williamsonHallPeakTableFingerprint(source.peakTable);
}
