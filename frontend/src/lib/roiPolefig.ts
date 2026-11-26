// Branch-(ii) polar-space detection for the ROI cut tools, split out of
// lib/roi.ts (its size pin) with its meaning unchanged.

/** Branch-(ii) pole-figure detection (Resolved decisions, polar-space rule):
 *  an axis is the NATIVE azimuthal axis when its label is Phi/Psi/Chi
 *  (case-insensitive) AND it spans >=350 degrees end to end — the
 *  xrayutilities pole-figure convention (a near-full-circle phi sweep
 *  against a tilt psi/chi range). Takes each displayed axis's label + its
 *  numeric extent (the caller already has `xAxis[0]`/`xAxis[last]` etc. from
 *  the map payload — kept out of this pure module's own inputs so it stays
 *  free of any `lib/mapdata.ts` coupling). Returns which axis qualifies, or
 *  null when neither (or, deliberately, when BOTH do — an ambiguous map is
 *  never auto-routed, "never silent"). */
export function polefigAxes(
  x: { label: string; span: number },
  y: { label: string; span: number },
): "x" | "y" | null {
  const isPolar = (label: string, span: number) => /^(phi|psi|chi)$/i.test(label.trim()) && span >= 350;
  const xHit = isPolar(x.label, x.span);
  const yHit = isPolar(y.label, y.span);
  if (xHit && !yHit) return "x";
  if (yHit && !xHit) return "y";
  return null;
}
