// One ellipse fit from plain columns, for Ellipse fit's worksheet batch and By
// levels: summary of centre, semi-axes, tilt and the fit RMS.

import { ellipseFit } from "../../../lib/api/analysisExtras";

export const ELLIPSE_SUMMARY_HEADERS = ["Centre X", "Centre Y", "Semi-major", "Semi-minor", "Angle (deg)", "RMS", "Arc coverage (deg)"] as const;

export async function runEllipse(x: number[], y: number[], geometric: boolean): Promise<{ values: number[]; warnings: string[] }> {
  if (x.length < 5) throw new Error(`not enough finite points (n=${x.length}); an ellipse needs 5`);
  const r = await ellipseFit({ x, y, geometric });
  const warnings: string[] = [];
  if (geometric && !r.converged) warnings.push("The orthogonal refinement did not converge.");
  if (r.arc_coverage_deg < 180) warnings.push(`The points span only ${Math.round(r.arc_coverage_deg)} degrees of the ellipse; the fit is weakly constrained.`);
  return { values: [r.center_x, r.center_y, r.semi_major, r.semi_minor, r.angle_deg, r.rms, r.arc_coverage_deg], warnings };
}
