import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import type { WilliamsonHallResult } from "./reductionTypes";
import type { Dataset } from "./types";
import type { WilliamsonHallRecipe } from "./williamsonHallRecipe";
export type { WilliamsonHallPeakRow, WilliamsonHallRecipe } from "./williamsonHallRecipe";

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function resultTables(recipe: WilliamsonHallRecipe, output: WilliamsonHallResult): AnalysisResultTable[] {
  const [slope, intercept] = output.fit_line;
  return [{
    title: "Summary", columns: ["quantity", "value", "unit"], rows: [
      ["Crystallite size", output.grain_size_nm, "nm"],
      ["Microstrain", output.microstrain, ""], ["R²", output.r2, ""],
      ["Wavelength", recipe.wavelengthA, "Å"], ["K factor", recipe.kFactor, ""],
      ["Instrumental broadening", recipe.instrumentalBroadeningDeg, "°"],
      ["Included peaks", recipe.rows.length, ""],
    ],
  }, {
    title: "Peak inputs", columns: ["2θ", "FWHM", "2θ unit", "FWHM unit"],
    rows: recipe.rows.map((row) => [row.twoTheta, row.fwhm, "°", "°"]),
  }, {
    title: "Williamson–Hall fit", columns: ["4 sin(θ)", "β cos(θ)", "fitted β cos(θ)"],
    rows: output.plot_x.map((x, index) => [x, output.plot_y[index] ?? null, slope * x + intercept]),
  }];
}

export function williamsonHallAnalysisResult(
  id: string, source: Dataset, recipe: WilliamsonHallRecipe, output: WilliamsonHallResult,
  createdAt = new Date().toISOString(),
): AnalysisResult {
  const crystalliteSize = finite(output.grain_size_nm) ? output.grain_size_nm : null;
  const resolutionClamped = recipe.instrumentalBroadeningDeg > 0
    ? recipe.rows.filter((row) => row.fwhm <= recipe.instrumentalBroadeningDeg).length : 0;
  return {
    version: ANALYSIS_RESULT_VERSION, id,
    name: `Williamson–Hall · ${source.name}`,
    producer: { id: "williamson-hall", label: "Williamson–Hall", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Analysis: "Williamson–Hall", "Crystallite size (nm)": crystalliteSize,
      Microstrain: output.microstrain, "R²": output.r2,
      Interpretation: crystalliteSize === null
        ? "Crystallite size is undefined because the fitted intercept is not positive."
        : `Crystallite size ${crystalliteSize.toPrecision(4)} nm; microstrain ${output.microstrain.toPrecision(4)}.`,
    },
    parameters: { recipe: {
      rows: recipe.rows.map((row) => ({ ...row })), wavelengthA: recipe.wavelengthA,
      kFactor: recipe.kFactor, instrumentalBroadeningDeg: recipe.instrumentalBroadeningDeg,
      sourceKind: recipe.sourceKind,
      ...(recipe.peakTableFingerprint ? { peakTableFingerprint: recipe.peakTableFingerprint } : {}),
    } },
    tables: resultTables(recipe, output),
    warnings: [
      "Williamson–Hall uses an unweighted linear fit; saved peak uncertainties are not used.",
      ...(recipe.rows.length === 2 ? ["Only two peaks were fitted; a line is exact and R² cannot assess model adequacy."] : []),
      ...(output.r2 < 0.8 ? ["The linear fit has R² below 0.8; inspect phase mixing and peak choices before interpreting size or strain."] : []),
      ...(output.microstrain < 0 ? ["The fitted microstrain is negative; inspect instrumental broadening, phase mixing, and peak choices."] : []),
      ...(resolutionClamped ? [`${resolutionClamped} peak width${resolutionClamped === 1 ? " was" : "s were"} not broader than the instrument correction and ${resolutionClamped === 1 ? "was" : "were"} clamped by the calculation.`] : []),
      ...(crystalliteSize === null ? ["The fitted intercept is not positive, so crystallite size is undefined."] : []),
    ],
    createdAt,
  };
}
