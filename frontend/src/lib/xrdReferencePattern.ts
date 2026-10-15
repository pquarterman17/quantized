// Pure parser and wavelength conversion for powder-XRD reference-stick files.
// No File/DOM/store imports: the importer can preview and test an untrusted
// text file before anything is added to a project.

export const MAX_REFERENCE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_REFERENCE_REFLECTIONS = 2_000;

export interface ReferenceReflection {
  twoTheta: number;
  intensity: number;
  label: string;
}

export interface ParsedReferencePattern {
  name: string;
  sourceWavelengthA: number | null;
  reflections: ReferenceReflection[];
  warnings: string[];
}

export type ReferenceAxisMode = "auto" | "two-theta";

const TWO_THETA = /^(?:2\s*theta|two\s*theta|2th|2-theta|position|pos(?:ition)?\s*\(?deg(?:rees?)?\)?|angle\s*\(?deg(?:rees?)?\)?)$/i;
const INTENSITY = /^(?:int(?:ensity)?|relative\s*intensity|rel(?:ative)?\.?\s*int(?:ensity)?|i\/i0|counts?)$/i;
const LABEL = /^(?:hkl|label|reflection|phase)$/i;
const WRONG_AXIS = /^(?:q(?:\s*[([]\s*(?:1\/)?(?:a|å|angstrom)(?:\^-?1|-1)?\s*[)\]])?|d(?:\s*-?spacing)?(?:\s*[([]\s*(?:a|å|angstrom)\s*[)\]])?|tof|time|wavelength|energy|omega|chi|phi)$/i;

function cleanHeader(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "").replace(/[_]+/g, " ")
    .replace(/\s*(?:\((?:deg(?:rees?)?|°|%|a\.?u\.?|counts?)\)|\[(?:deg(?:rees?)?|°|%|a\.?u\.?|counts?)\])\s*$/i, "")
    .replace(/\s+/g, " ");
}

function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === quote && line[i + 1] === quote) { cell += quote; i += 1; }
      else if (char === quote) quote = "";
      else cell += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === delimiter) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((v) => v.trim());
  if (line.includes(",")) return splitDelimited(line, ",");
  if (line.includes(";")) return splitDelimited(line, ";");
  return line.trim().split(/\s+/);
}

function finiteNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function wavelengthIn(lines: readonly string[]): number | null {
  for (const line of lines.slice(0, 100)) {
    const match = /(?:wavelength|lambda|λ)\s*(?:\([^)]*\))?\s*[:=,]\s*([0-9]+(?:\.[0-9]+)?)/i.exec(line);
    if (!match) continue;
    const value = Number(match[1]);
    if (value >= 0.2 && value <= 10) return value;
  }
  return null;
}

/** Parse a common CSV/TSV/semicolon/whitespace stick-pattern file.
 * A recognized labeled non-2θ axis fails closed in auto mode. Headerless
 * numeric two-column files remain supported, with an explicit preview warning. */
export function parseReferencePatternText(
  text: string,
  fileName: string,
  axisMode: ReferenceAxisMode = "auto",
): ParsedReferencePattern {
  if (new Blob([text]).size > MAX_REFERENCE_FILE_BYTES) throw new Error("Reference file is larger than 2 MiB.");
  const rawLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const sourceWavelengthA = wavelengthIn(rawLines);
  const lines = rawLines
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:#|!|\/\/)/.test(line));
  if (!lines.length) throw new Error("Reference file contains no data rows.");

  let headerIndex = -1;
  let xIndex = -1;
  let intensityIndex = -1;
  let labelIndex = -1;
  let hklIndices: [number, number, number] | null = null;
  let dataStart = 0;
  let headerless = false;

  for (let i = 0; i < Math.min(lines.length, 100); i += 1) {
    const cells = splitLine(lines[i]);
    const headers = cells.map(cleanHeader);
    const possibleX = headers.findIndex((v) => TWO_THETA.test(v));
    const possibleI = headers.findIndex((v) => INTENSITY.test(v));
    if (possibleX >= 0 || possibleI >= 0) {
      const declaredWrongAxis = headers.find((v) => WRONG_AXIS.test(v));
      if (possibleX < 0 && declaredWrongAxis && axisMode === "auto") {
        throw new Error(`The file declares a non-2θ axis (${declaredWrongAxis}). Choose “Treat first column as 2θ” only if that label is wrong.`);
      }
      headerIndex = i;
      xIndex = possibleX >= 0 ? possibleX : axisMode === "two-theta" ? 0 : -1;
      intensityIndex = possibleI;
      labelIndex = headers.findIndex((v) => LABEL.test(v));
      const h = headers.indexOf("h"), k = headers.indexOf("k"), l = headers.indexOf("l");
      if (h >= 0 && k >= 0 && l >= 0) hklIndices = [h, k, l];
      dataStart = i + 1;
      break;
    }
    if (headers.some((v) => WRONG_AXIS.test(v)) && axisMode === "auto") {
      throw new Error(`The file declares a non-2θ axis (${headers.find((v) => WRONG_AXIS.test(v))}). Choose “Treat first column as 2θ” only if that label is wrong.`);
    }
    if (cells.length >= 2 && finiteNumber(cells[0]) != null && finiteNumber(cells[1]) != null) {
      headerless = true;
      xIndex = 0;
      intensityIndex = 1;
      dataStart = i;
      break;
    }
  }

  if (xIndex < 0 && headerIndex >= 0 && axisMode === "two-theta") xIndex = 0;
  if (intensityIndex < 0 && headerIndex >= 0) intensityIndex = xIndex === 0 ? 1 : 0;
  if (xIndex < 0 || intensityIndex < 0) {
    throw new Error("Could not identify 2θ and intensity columns in this reference file.");
  }

  const parsed: ReferenceReflection[] = [];
  let skipped = 0;
  for (const line of lines.slice(dataStart)) {
    const cells = splitLine(line);
    const twoTheta = finiteNumber(cells[xIndex]);
    const intensity = finiteNumber(cells[intensityIndex]);
    if (twoTheta == null || intensity == null || twoTheta <= 0 || twoTheta >= 180 || intensity < 0) {
      skipped += 1;
      continue;
    }
    const label = labelIndex >= 0
      ? (cells[labelIndex] ?? "").trim().replace(/^['"]|['"]$/g, "")
      : hklIndices && hklIndices.every((index) => cells[index]?.trim())
        ? `(${hklIndices.map((index) => cells[index].trim()).join(" ")})`
        : "";
    parsed.push({ twoTheta, intensity, label: label.slice(0, 80) });
    if (parsed.length > MAX_REFERENCE_REFLECTIONS) {
      throw new Error(`Reference file exceeds the ${MAX_REFERENCE_REFLECTIONS.toLocaleString()}-reflection limit.`);
    }
  }
  if (!parsed.length) throw new Error("Reference file has no valid 2θ/intensity rows.");
  const maxIntensity = Math.max(...parsed.map((row) => row.intensity));
  if (!(maxIntensity > 0)) throw new Error("Reference intensities are all zero.");

  const byPosition = new Map<string, ReferenceReflection>();
  for (const row of parsed) {
    const normalized = row.intensity / maxIntensity;
    const key = row.twoTheta.toFixed(6);
    const previous = byPosition.get(key);
    if (!previous) byPosition.set(key, { ...row, intensity: normalized });
    else {
      previous.intensity = Math.max(previous.intensity, normalized);
      if (row.label && !previous.label.split(", ").includes(row.label)) {
        previous.label = [previous.label, row.label].filter(Boolean).join(", ").slice(0, 80);
      }
    }
  }
  const reflections = [...byPosition.values()].sort((a, b) => a.twoTheta - b.twoTheta);
  const warnings: string[] = [];
  if (headerless) warnings.push("Headerless file: the first two numeric columns are being treated as 2θ (degrees) and intensity.");
  if (skipped) warnings.push(`${skipped} invalid or non-data row${skipped === 1 ? " was" : "s were"} skipped.`);
  if (reflections.length < parsed.length) warnings.push(`${parsed.length - reflections.length} duplicate reflection position${parsed.length - reflections.length === 1 ? " was" : "s were"} combined.`);

  return {
    name: fileName.replace(/\.[^.]+$/, "") || "Reference pattern",
    sourceWavelengthA,
    reflections,
    warnings,
  };
}

/** Convert a reference position between wavelengths through Bragg d spacing. */
export function convertTwoTheta(twoTheta: number, sourceWavelengthA: number, targetWavelengthA: number): number | null {
  if (![twoTheta, sourceWavelengthA, targetWavelengthA].every(Number.isFinite)
    || twoTheta <= 0 || twoTheta >= 180 || sourceWavelengthA <= 0 || targetWavelengthA <= 0) return null;
  const theta = twoTheta * Math.PI / 360;
  const targetSin = Math.sin(theta) * targetWavelengthA / sourceWavelengthA;
  if (targetSin <= 0 || targetSin > 1) return null;
  return 2 * Math.asin(targetSin) * 180 / Math.PI;
}

export function convertReferencePattern(
  reflections: readonly ReferenceReflection[],
  sourceWavelengthA: number | null,
  targetWavelengthA: number | null,
): { reflections: ReferenceReflection[]; converted: boolean; dropped: number } {
  if (sourceWavelengthA == null || targetWavelengthA == null || Math.abs(sourceWavelengthA - targetWavelengthA) < 1e-9) {
    return { reflections: reflections.map((r) => ({ ...r })), converted: false, dropped: 0 };
  }
  const converted: ReferenceReflection[] = [];
  let dropped = 0;
  for (const reflection of reflections) {
    const twoTheta = convertTwoTheta(reflection.twoTheta, sourceWavelengthA, targetWavelengthA);
    if (twoTheta == null) dropped += 1;
    else converted.push({ ...reflection, twoTheta });
  }
  return { reflections: converted, converted: true, dropped };
}
