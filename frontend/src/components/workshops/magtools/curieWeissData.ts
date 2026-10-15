import { detectMagXKind, magXAxis } from "../../../lib/magDataKind";
import type { CurieWeissResponseBasis } from "../../../lib/api/magnetic";
import type { DataStruct, Dataset } from "../../../lib/types";

export type CurieWeissBasisChoice = "auto" | "molar" | "moment";

const FIELD_UNITS = new Set(["Oe", "T", "mT", "A/m"]);
const MOLAR_SUSCEPTIBILITY_UNITS = new Set([
  "cm3/mol", "cm^3/mol", "emu/oe/mol", "emu/mol/oe",
  "emuoe^-1mol^-1", "emumol^-1oe^-1",
]);
const SI_MOLAR_SUSCEPTIBILITY_UNITS = new Set(["m3/mol", "m^3/mol"]);

function compactUnit(unit: string): string {
  return unit.toLowerCase().replaceAll("³", "3").replace(/[\s·*()]/g, "");
}

export function isMolarSusceptibilityUnit(unit: string): boolean {
  return MOLAR_SUSCEPTIBILITY_UNITS.has(compactUnit(unit));
}

export interface FieldColumn {
  index: number;
  label: string;
  unit: string;
}

export function fieldColumns(data: DataStruct, excludedChannel: number): FieldColumn[] {
  const fields: FieldColumn[] = [];
  for (let index = 0; index < data.labels.length; index++) {
    if (index === excludedChannel) continue;
    const label = data.labels[index] ?? "";
    const unit = data.units[index] ?? "";
    if (FIELD_UNITS.has(unit) && detectMagXKind(label, unit).kind === "field") {
      fields.push({ index, label, unit });
    }
  }
  return fields;
}

export function responseBasis(choice: CurieWeissBasisChoice, unit: string): CurieWeissResponseBasis | null {
  if (choice === "molar") return "molar_susceptibility";
  if (choice === "moment") {
    if (unit === "emu") return "total_moment";
    if (unit === "emu/g") return "mass_moment";
    return null;
  }
  if (isMolarSusceptibilityUnit(unit)) return "molar_susceptibility";
  if (unit === "emu") return "total_moment";
  if (unit === "emu/g") return "mass_moment";
  return null;
}

export function curieWeissProblem(
  dataset: Dataset | null,
  xKey: number | null,
  yKey: number,
  choice: CurieWeissBasisChoice,
  sampleMassG: number,
  molarMass: number,
  fitMin: number,
  fitMax: number,
  fieldKey: number | null,
): string | null {
  if (!dataset) return "Select a dataset first.";
  const axis = magXAxis(dataset.data, xKey);
  const detected = detectMagXKind(axis.label, axis.unit);
  if (detected.kind !== "temperature") {
    return `The plotted x axis is not a declared temperature (${detected.reason}).`;
  }
  if (!["k", "kelvin"].includes(axis.unit.trim().toLowerCase())) {
    return `Curie–Weiss fitting requires absolute temperature in K; convert ${axis.unit || "the x axis"} to K first.`;
  }
  const unit = dataset.data.units[yKey] ?? "";
  if (SI_MOLAR_SUSCEPTIBILITY_UNITS.has(compactUnit(unit))) {
    return "SI molar susceptibility in m³/mol is not converted by this workflow; convert it to cm³/mol first.";
  }
  const basis = responseBasis(choice, unit);
  if (!basis) {
    return choice === "moment"
      ? `Moment unit ${unit || "(blank)"} is not supported; convert it to emu or emu/g in the Units tab first.`
      : "Cannot identify the selected response as molar susceptibility or moment. Choose its basis explicitly.";
  }
  if (!(Number.isFinite(fitMin) && Number.isFinite(fitMax) && fitMin < fitMax)) {
    return "Enter a finite fit range with minimum < maximum.";
  }
  if (basis !== "molar_susceptibility") {
    if (!(Number.isFinite(molarMass) && molarMass > 0)) return "Enter a positive molar mass.";
    if (basis === "total_moment" && !(Number.isFinite(sampleMassG) && sampleMassG > 0)) {
      return "Enter a positive sample mass for total moment.";
    }
    const fields = fieldColumns(dataset.data, yKey);
    if (fields.length === 0) return "No supported applied-field channel was found in this dataset.";
    const selected = fieldKey == null && fields.length === 1
      ? fields[0]
      : fields.find((field) => field.index === fieldKey);
    if (!selected) return "Choose which applied-field column belongs to this temperature sweep.";
  }
  return null;
}
