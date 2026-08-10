// Unit tests for the sector-wedge geometry (RSM_CUTS_PLAN item 12) — the
// pure hit-test/drag math classifySectorHit/applySectorDrag/sectorSpan are
// built on. Coverage: each of the 4 field handles is picked correctly and
// nearer than the interior; precedence (handle beats interior, outside is
// null); a seam-crossing sector (phiMin > phiMax numerically) hit-tests and
// rotates exactly like a non-wrapping one — the case the plan calls out as
// "where this will break".

import { describe, expect, it } from "vitest";

import type { RoiSector } from "./roi";
import { applySectorDrag, classifySectorHit, sectorCursor, sectorHandlePositions, sectorSpan } from "./roiSector";

const DEG = Math.PI / 180;
/** A point at radius r, azimuth phiDeg — the same convention the module
 *  under test uses (phi = atan2(z, x), 0 = +x axis, CCW). */
function polar(r: number, phiDeg: number): [number, number] {
  return [r * Math.cos(phiDeg * DEG), r * Math.sin(phiDeg * DEG)];
}

// A plain quarter-annulus, no wrap: 2 <= |Q| <= 4, 0 <= phi <= 90.
const QUARTER: RoiSector = { qMin: 2, qMax: 4, phiMin: 0, phiMax: 90 };

// A 20deg sector straddling the +-180 seam: 170 -> 190 (stored as phiMax=-170,
// i.e. phiMax < phiMin numerically) — legal per lib/roi.ts::sectorFromCenter's
// own "no silent wrapping" doc.
const SEAM: RoiSector = { qMin: 2, qMax: 4, phiMin: 170, phiMax: -170 };

describe("sectorSpan", () => {
  it("is the plain difference for a non-wrapping sector", () => {
    expect(sectorSpan(QUARTER)).toBeCloseTo(90);
  });

  it("wraps correctly across the seam", () => {
    expect(sectorSpan(SEAM)).toBeCloseTo(20);
  });

  it("treats an exact zero-width sector as a full circle (MATLAB parity, item 21)", () => {
    expect(sectorSpan({ qMin: 1, qMax: 2, phiMin: 45, phiMax: 45 })).toBe(360);
  });
});

describe("classifySectorHit — non-wrapping sector", () => {
  it("picks qMin when near the inner arc", () => {
    const [x, y] = polar(2, 45); // exactly on the inner arc, mid-angle
    expect(classifySectorHit(QUARTER, x, y, 50)).toEqual({ kind: "handle", field: "qMin" });
  });

  it("picks qMax when near the outer arc", () => {
    const [x, y] = polar(4, 45);
    expect(classifySectorHit(QUARTER, x, y, 50)).toEqual({ kind: "handle", field: "qMax" });
  });

  it("picks phiMin when near the low-angle edge", () => {
    const [x, y] = polar(3, 0); // mid-radius, right on the phiMin ray
    expect(classifySectorHit(QUARTER, x, y, 50)).toEqual({ kind: "handle", field: "phiMin" });
  });

  it("picks phiMax when near the high-angle edge", () => {
    const [x, y] = polar(3, 90);
    expect(classifySectorHit(QUARTER, x, y, 50)).toEqual({ kind: "handle", field: "phiMax" });
  });

  it("picks interior when well inside, away from every boundary", () => {
    const [x, y] = polar(3, 45);
    expect(classifySectorHit(QUARTER, x, y, 50)).toEqual({ kind: "interior" });
  });

  it("is null outside the annulus entirely", () => {
    const [x, y] = polar(10, 45);
    expect(classifySectorHit(QUARTER, x, y, 50)).toBeNull();
  });

  it("is null angularly outside the sector even at a valid radius", () => {
    const [x, y] = polar(3, 180);
    expect(classifySectorHit(QUARTER, x, y, 50)).toBeNull();
  });

  it("a handle within tolerance beats the interior even just inside the boundary", () => {
    // 1px (in data units, at pxPerUnit=50 -> 0.02 data units) inside qMax.
    const [x, y] = polar(3.98, 45);
    expect(classifySectorHit(QUARTER, x, y, 50)).toEqual({ kind: "handle", field: "qMax" });
  });
});

describe("classifySectorHit — seam-crossing sector", () => {
  it("interior spans across the +-180 seam correctly", () => {
    const [x, y] = polar(3, 180); // inside [170, 190]
    expect(classifySectorHit(SEAM, x, y, 50)).toEqual({ kind: "interior" });
  });

  it("picks phiMin at the 170deg edge", () => {
    const [x, y] = polar(3, 170);
    expect(classifySectorHit(SEAM, x, y, 50)).toEqual({ kind: "handle", field: "phiMin" });
  });

  it("picks phiMax at the -170deg (=190deg) edge", () => {
    const [x, y] = polar(3, -170);
    expect(classifySectorHit(SEAM, x, y, 50)).toEqual({ kind: "handle", field: "phiMax" });
  });

  it("is null just past the seam-crossing sector's far side", () => {
    const [x, y] = polar(3, 0); // well outside [170, 190]
    expect(classifySectorHit(SEAM, x, y, 50)).toBeNull();
  });
});

describe("applySectorDrag — each handle changes only its own field", () => {
  it("qMin handle only changes qMin", () => {
    const [x, y] = polar(2.5, 45);
    const next = applySectorDrag(QUARTER, { kind: "handle", field: "qMin" }, x, y);
    expect(next.qMin).toBeCloseTo(2.5);
    expect(next.qMax).toBe(QUARTER.qMax);
    expect(next.phiMin).toBe(QUARTER.phiMin);
    expect(next.phiMax).toBe(QUARTER.phiMax);
  });

  it("qMax handle only changes qMax", () => {
    const [x, y] = polar(5, 45);
    const next = applySectorDrag(QUARTER, { kind: "handle", field: "qMax" }, x, y);
    expect(next.qMax).toBeCloseTo(5);
    expect(next.qMin).toBe(QUARTER.qMin);
    expect(next.phiMin).toBe(QUARTER.phiMin);
    expect(next.phiMax).toBe(QUARTER.phiMax);
  });

  it("phiMin handle only changes phiMin", () => {
    const [x, y] = polar(3, 20);
    const next = applySectorDrag(QUARTER, { kind: "handle", field: "phiMin" }, x, y);
    expect(next.phiMin).toBeCloseTo(20);
    expect(next.qMin).toBe(QUARTER.qMin);
    expect(next.qMax).toBe(QUARTER.qMax);
    expect(next.phiMax).toBe(QUARTER.phiMax);
  });

  it("phiMax handle only changes phiMax", () => {
    const [x, y] = polar(3, 70);
    const next = applySectorDrag(QUARTER, { kind: "handle", field: "phiMax" }, x, y);
    expect(next.phiMax).toBeCloseTo(70);
    expect(next.qMin).toBe(QUARTER.qMin);
    expect(next.qMax).toBe(QUARTER.qMax);
    expect(next.phiMin).toBe(QUARTER.phiMin);
  });

  it("qMin cannot cross qMax (clamped, never inverts)", () => {
    const [x, y] = polar(10, 45); // way past qMax=4
    const next = applySectorDrag(QUARTER, { kind: "handle", field: "qMin" }, x, y, { minRadialGap: 0.1 });
    expect(next.qMin).toBeCloseTo(3.9);
  });

  it("a null hit is a no-op", () => {
    expect(applySectorDrag(QUARTER, null, 3, 3)).toBe(QUARTER);
  });
});

describe("applySectorDrag — interior rotate preserves span", () => {
  it("rotates a non-wrapping sector, shifting both bounds by the same amount", () => {
    const [sx, sy] = polar(3, 45); // gesture start, inside the sector
    const startPhi = Math.atan2(sy, sx) / DEG;
    const [mx, my] = polar(3, 65); // dragged +20deg
    const next = applySectorDrag(QUARTER, { kind: "interior" }, mx, my, { startPhi });
    expect(next.phiMin).toBeCloseTo(20);
    expect(next.phiMax).toBeCloseTo(110);
    expect(sectorSpan(next)).toBeCloseTo(sectorSpan(QUARTER));
  });

  it("a seam-crossing sector stays seam-crossing (and the same span) after a rotate", () => {
    const [sx, sy] = polar(3, 180); // gesture start, inside [170,190]
    const startPhi = Math.atan2(sy, sx) / DEG;
    const [mx, my] = polar(3, -170); // physically 190deg, dragged +10deg from 180
    const next = applySectorDrag(SEAM, { kind: "interior" }, mx, my, { startPhi });
    expect(sectorSpan(next)).toBeCloseTo(sectorSpan(SEAM), 5);
    // Still seam-crossing in the SAME raw sense (phiMin numerically > phiMax) —
    // never silently renormalized into a non-wrapping representation.
    expect(next.phiMin).toBeGreaterThan(next.phiMax);
    expect(next.phiMin).toBeCloseTo(180, 5);
    expect(next.phiMax).toBeCloseTo(-160, 5);
  });

  it("rotating by a full lap returns to the same span (sanity)", () => {
    const [sx, sy] = polar(3, 45);
    const startPhi = Math.atan2(sy, sx) / DEG;
    const [mx, my] = polar(3, 45); // no net movement
    const next = applySectorDrag(QUARTER, { kind: "interior" }, mx, my, { startPhi });
    expect(next.phiMin).toBeCloseTo(QUARTER.phiMin);
    expect(next.phiMax).toBeCloseTo(QUARTER.phiMax);
  });
});

describe("sectorHandlePositions", () => {
  it("places qMin/qMax at the angular midpoint, phiMin/phiMax at the radial midpoint", () => {
    const pos = sectorHandlePositions(QUARTER);
    const [qmx, qmy] = polar(2, 45);
    expect(pos.qMin.x).toBeCloseTo(qmx);
    expect(pos.qMin.y).toBeCloseTo(qmy);
    const [qMx, qMy] = polar(4, 45);
    expect(pos.qMax.x).toBeCloseTo(qMx);
    expect(pos.qMax.y).toBeCloseTo(qMy);
    const [pmx, pmy] = polar(3, 0);
    expect(pos.phiMin.x).toBeCloseTo(pmx);
    expect(pos.phiMin.y).toBeCloseTo(pmy);
    const [pMx, pMy] = polar(3, 90);
    expect(pos.phiMax.x).toBeCloseTo(pMx);
    expect(pos.phiMax.y).toBeCloseTo(pMy);
  });

  it("uses the seam-aware angular midpoint for a wrapping sector", () => {
    const pos = sectorHandlePositions(SEAM); // span 20, mid = 170+10 = 180
    const [mx, my] = polar(3, 180);
    expect(pos.qMin.x).toBeCloseTo(2 * Math.cos(180 * DEG));
    expect(pos.qMin.y).toBeCloseTo(2 * Math.sin(180 * DEG));
    expect(pos.qMax.x).toBeCloseTo(4 * Math.cos(180 * DEG));
    void mx;
    void my;
  });
});

describe("sectorCursor", () => {
  it("is crosshair for any handle", () => {
    expect(sectorCursor({ kind: "handle", field: "qMin" })).toBe("crosshair");
    expect(sectorCursor({ kind: "handle", field: "phiMax" })).toBe("crosshair");
  });
  it("is grab for the interior (distinct from a rect's 'move')", () => {
    expect(sectorCursor({ kind: "interior" })).toBe("grab");
  });
  it("is default for no hit", () => {
    expect(sectorCursor(null)).toBe("default");
  });
});
