// Pure calibration math for the graph digitizer: map image-pixel coordinates to
// data coordinates from two reference points per axis (linear axes). The canvas
// interaction lives in the workshop; this is the testable core.

/** A clicked axis reference: the pixel coordinate along that axis + its data value. */
export interface AxisRef {
  px: number;
  value: number;
}

/** Affine 1-D map: ``value = scale·pixel + offset``. */
export interface LinearMap {
  scale: number;
  offset: number;
}

/** Build the 1-D map from two reference points (degenerate -> constant). */
export function linearMap(a: AxisRef, b: AxisRef): LinearMap {
  const dpx = b.px - a.px;
  if (dpx === 0) return { scale: 0, offset: a.value };
  const scale = (b.value - a.value) / dpx;
  return { scale, offset: a.value - scale * a.px };
}

export function applyMap(m: LinearMap, px: number): number {
  return m.scale * px + m.offset;
}

export interface Calibration {
  x: LinearMap;
  y: LinearMap;
}

/** Calibrate from two X refs (pixel x) and two Y refs (pixel y). The Y direction
 *  (canvas y grows downward, data y usually upward) is captured automatically by
 *  the two reference values, so no flip is needed. */
export function calibrate(x1: AxisRef, x2: AxisRef, y1: AxisRef, y2: AxisRef): Calibration {
  return { x: linearMap(x1, x2), y: linearMap(y1, y2) };
}

/** Map an image pixel (px = clientX-relative, py = clientY-relative) to data. */
export function pixelToData(cal: Calibration, px: number, py: number): [number, number] {
  return [applyMap(cal.x, px), applyMap(cal.y, py)];
}

/** Map traced pixel points to data, sorted by x ascending (a tidy dataset). */
export function tracedToData(
  cal: Calibration,
  points: { px: number; py: number }[],
): { x: number[]; y: number[] } {
  const mapped = points.map((p) => pixelToData(cal, p.px, p.py));
  mapped.sort((a, b) => a[0] - b[0]);
  return { x: mapped.map((m) => m[0]), y: mapped.map((m) => m[1]) };
}
