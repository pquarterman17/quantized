// Options of the Curve Fit "Result on graph" annotation (shared by the text
// builder in components/workshops/curvefit and the session link store).

export type FitAnnotationFormat = "plain" | "latex";

export interface FitAnnotationOptions {
  format: FitAnnotationFormat;
  /** Significant figures; 0 = auto (error-rounded, PDG). */
  digits: number;
  equation: boolean;
  r2: boolean;
  n: boolean;
  units: boolean;
}

export const DEFAULT_FIT_ANNOTATION: FitAnnotationOptions = {
  format: "plain", digits: 0, equation: true, r2: true, n: false, units: false,
};
