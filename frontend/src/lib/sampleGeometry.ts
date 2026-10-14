export const MASS_UNITS = ["µg", "mg", "g", "kg"] as const;
export const LENGTH_UNITS = ["Å", "nm", "µm", "mm", "cm", "m"] as const;
export const AREA_UNITS = ["µm²", "mm²", "cm²", "m²"] as const;
export const VOLUME_UNITS = ["µm³", "mm³", "cm³", "µL", "mL", "m³"] as const;

export type MassUnit = typeof MASS_UNITS[number];
export type LengthUnit = typeof LENGTH_UNITS[number];
export type AreaUnit = typeof AREA_UNITS[number];
export type VolumeUnit = typeof VOLUME_UNITS[number];

export interface MagNormalizationParams {
  fromField: string;
  toField: string;
  fromMoment: string;
  toMoment: string;
  sampleMass: number;
  massUnit: MassUnit;
  volumeMode: "direct" | "film" | "area" | "circle";
  sampleVolume: number;
  volumeUnit: VolumeUnit;
  sampleWidth: number;
  widthUnit: LengthUnit;
  sampleHeight: number;
  heightUnit: LengthUnit;
  sampleThickness: number;
  thicknessUnit: LengthUnit;
  sampleArea: number;
  areaUnit: AreaUnit;
  sampleDiameter: number;
  diameterUnit: LengthUnit;
}

export const DEFAULT_MAG_NORMALIZATION: MagNormalizationParams = {
  fromField: "Oe", toField: "T", fromMoment: "emu", toMoment: "emu",
  sampleMass: 0, massUnit: "mg", volumeMode: "direct", sampleVolume: 0, volumeUnit: "cm³",
  sampleWidth: 0, widthUnit: "cm", sampleHeight: 0, heightUnit: "cm",
  sampleThickness: 0, thicknessUnit: "nm", sampleArea: 0, areaUnit: "cm²",
  sampleDiameter: 0, diameterUnit: "mm",
};

const MASS_TO_G: Record<MassUnit, number> = { "µg": 1e-6, mg: 1e-3, g: 1, kg: 1e3 };
const LENGTH_TO_CM: Record<LengthUnit, number> = { "Å": 1e-8, nm: 1e-7, "µm": 1e-4, mm: 0.1, cm: 1, m: 100 };
const AREA_TO_CM2: Record<AreaUnit, number> = { "µm²": 1e-8, "mm²": 1e-2, "cm²": 1, "m²": 1e4 };
const VOLUME_TO_CM3: Record<VolumeUnit, number> = { "µm³": 1e-12, "mm³": 1e-3, "cm³": 1, "µL": 1e-3, "mL": 1, "m³": 1e6 };

function positive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function massInGrams(value: number, unit: MassUnit): number | null {
  const clean = positive(value);
  return clean === null ? null : clean * MASS_TO_G[unit];
}

export function directVolumeInCm3(value: number, unit: VolumeUnit): number | null {
  const clean = positive(value);
  return clean === null ? null : clean * VOLUME_TO_CM3[unit];
}

export function rectangularVolumeInCm3(
  width: number, widthUnit: LengthUnit,
  height: number, heightUnit: LengthUnit,
  thickness: number, thicknessUnit: LengthUnit,
): number | null {
  const clean = [positive(width), positive(height), positive(thickness)];
  if (clean.some((value) => value === null)) return null;
  const volume = clean[0]! * LENGTH_TO_CM[widthUnit] * clean[1]! * LENGTH_TO_CM[heightUnit] * clean[2]! * LENGTH_TO_CM[thicknessUnit];
  return Number.isFinite(volume) && volume > 0 ? volume : null;
}

export function areaThicknessVolumeInCm3(
  area: number, areaUnit: AreaUnit, thickness: number, thicknessUnit: LengthUnit,
): number | null {
  const a = positive(area);
  const t = positive(thickness);
  if (a === null || t === null) return null;
  const volume = a * AREA_TO_CM2[areaUnit] * t * LENGTH_TO_CM[thicknessUnit];
  return Number.isFinite(volume) && volume > 0 ? volume : null;
}

export function circularVolumeInCm3(
  diameter: number, diameterUnit: LengthUnit, thickness: number, thicknessUnit: LengthUnit,
): number | null {
  const d = positive(diameter);
  const t = positive(thickness);
  if (d === null || t === null) return null;
  const radiusCm = d * LENGTH_TO_CM[diameterUnit] / 2;
  const volume = Math.PI * radiusCm ** 2 * t * LENGTH_TO_CM[thicknessUnit];
  return Number.isFinite(volume) && volume > 0 ? volume : null;
}

export function resolvedSampleMass(units: MagNormalizationParams): number {
  return massInGrams(units.sampleMass, units.massUnit) ?? 0;
}

export function resolvedSampleVolume(units: MagNormalizationParams): number {
  const volume = units.volumeMode === "film"
    ? rectangularVolumeInCm3(units.sampleWidth, units.widthUnit, units.sampleHeight, units.heightUnit, units.sampleThickness, units.thicknessUnit)
    : units.volumeMode === "area"
      ? areaThicknessVolumeInCm3(units.sampleArea, units.areaUnit, units.sampleThickness, units.thicknessUnit)
      : units.volumeMode === "circle"
        ? circularVolumeInCm3(units.sampleDiameter, units.diameterUnit, units.sampleThickness, units.thicknessUnit)
        : directVolumeInCm3(units.sampleVolume, units.volumeUnit);
  return volume ?? 0;
}

export function normalizationProblem(units: MagNormalizationParams): string | null {
  if (units.fromMoment === units.toMoment) return null;
  if (units.toMoment === "emu/g" && resolvedSampleMass(units) <= 0) return "Enter a positive sample mass before converting to emu/g.";
  if (["emu/cm³", "A/m", "kA/m"].includes(units.toMoment) && resolvedSampleVolume(units) <= 0) {
    return "Enter positive sample geometry before converting to a volume-normalized unit.";
  }
  return null;
}

export function normalizationMetadata(units: MagNormalizationParams, fromMoment: string): Record<string, unknown> {
  const massBasis = fromMoment !== units.toMoment && units.toMoment === "emu/g";
  const volumeBasis = fromMoment !== units.toMoment && ["emu/cm³", "A/m", "kA/m"].includes(units.toMoment);
  const volumeDefinition = units.volumeMode === "film" ? {
    mode: "rectangular-film", width: units.sampleWidth, width_unit: units.widthUnit,
    height: units.sampleHeight, height_unit: units.heightUnit,
    thickness: units.sampleThickness, thickness_unit: units.thicknessUnit,
  } : units.volumeMode === "area" ? {
    mode: "area-and-thickness", area: units.sampleArea, area_unit: units.areaUnit,
    thickness: units.sampleThickness, thickness_unit: units.thicknessUnit,
  } : units.volumeMode === "circle" ? {
    mode: "circular-film", diameter: units.sampleDiameter, diameter_unit: units.diameterUnit,
    thickness: units.sampleThickness, thickness_unit: units.thicknessUnit,
  } : { mode: "direct", value: units.sampleVolume, unit: units.volumeUnit };
  return {
    from_moment: fromMoment, to_moment: units.toMoment,
    basis: massBasis ? "mass" : volumeBasis ? "volume" : "none",
    sample_mass_g: massBasis ? resolvedSampleMass(units) : null,
    sample_volume_cm3: volumeBasis ? resolvedSampleVolume(units) : null,
    volume_definition: volumeBasis ? volumeDefinition : null,
  };
}
