// A CIF's crystal structure as a lattice preset: the full cell, which axes
// Pawley ties, the lattice centering from the space group, and the crystal
// system the d-spacing calculator shows.

import { describe, expect, it } from "vitest";

import type { CrystalStructure } from "./api/structures";
import { centeringOf, crystalSystemOf, latticePreset, pawleyTieOf, structureFileName } from "./crystalStructure";

const cell = (a: number, b: number, c: number, alpha = 90, beta = 90, gamma = 90) => ({ a, b, c, alpha, beta, gamma });

function structure(over: Partial<CrystalStructure> = {}): CrystalStructure {
  return {
    name: "Si", source_name: "si.cif", formula: "Si", space_group: "F d -3 m",
    cell: cell(5.4309, 5.4309, 5.4309), atom_sites: [], ...over,
  };
}

describe("structureFileName", () => {
  it("routes .cif (any case) to the structure import, nothing else", () => {
    expect(structureFileName("Si.cif")).toBe(true);
    expect(structureFileName("/data/LaB6.CIF")).toBe(true);
    expect(structureFileName("scan.dat")).toBe(false);
    expect(structureFileName("cif")).toBe(false);
  });
});

describe("crystalSystemOf", () => {
  it("names the system from the cell's metric", () => {
    expect(crystalSystemOf(cell(5, 5, 5))).toBe("cubic");
    expect(crystalSystemOf(cell(3.9, 3.9, 12))).toBe("tetragonal");
    expect(crystalSystemOf(cell(3.2, 3.2, 5.2, 90, 90, 120))).toBe("hexagonal");
    expect(crystalSystemOf(cell(5.4, 5.4, 5.4, 60, 60, 60))).toBe("rhombohedral");
    expect(crystalSystemOf(cell(5, 6, 7))).toBe("orthorhombic");
    expect(crystalSystemOf(cell(5, 6, 7, 90, 101.2, 90))).toBe("monoclinic");
    expect(crystalSystemOf(cell(5, 6, 7, 80, 95, 100))).toBe("triclinic");
  });
});

describe("pawleyTieOf", () => {
  it("ties the lengths the cell's own metric makes equal", () => {
    expect(pawleyTieOf(cell(5, 5, 5))).toBe("abc");
    expect(pawleyTieOf(cell(3.2, 3.2, 5.2, 90, 90, 120))).toBe("ab");
    expect(pawleyTieOf(cell(5, 6, 7))).toBe("none");
  });
});

describe("centeringOf", () => {
  it("reads the lattice letter of the Hermann-Mauguin symbol", () => {
    expect(centeringOf("F d -3 m", cell(5, 5, 5))).toBe("F");
    expect(centeringOf("'I 4/m m m'", cell(3, 3, 9))).toBe("I");
    expect(centeringOf("P63/mmc", cell(3, 3, 5, 90, 90, 120))).toBe("P");
    expect(centeringOf("c 2/c", cell(5, 6, 7, 90, 100, 90))).toBe("C");
  });

  it("an R group on hexagonal axes stays R; on rhombohedral axes it is primitive", () => {
    expect(centeringOf("R -3 m", cell(3.8, 3.8, 13.1, 90, 90, 120))).toBe("R");
    expect(centeringOf("R -3 m", cell(5.4, 5.4, 5.4, 60, 60, 60))).toBe("P");
  });

  it("is null when the CIF names no usable space group", () => {
    expect(centeringOf("", cell(5, 5, 5))).toBeNull();
    expect(centeringOf("?", cell(5, 5, 5))).toBeNull();
  });
});

describe("latticePreset", () => {
  it("returns the full cell, tie, centering and system", () => {
    expect(latticePreset(structure())).toEqual({
      cell: cell(5.4309, 5.4309, 5.4309), tie: "abc", centering: "F", system: "cubic",
    });
  });

  it("fills an omitted angle with 90, the CIF dictionary's default", () => {
    const p = latticePreset(structure({ cell: { a: 4, b: 4, c: 4, alpha: null, beta: null, gamma: null } }));
    expect(p).toMatchObject({ cell: cell(4, 4, 4), tie: "abc" });
  });

  it("fails closed, saying which, when the CIF omits a length (lengths have no default)", () => {
    expect(latticePreset(structure({ cell: { a: 4, b: null, c: 4, alpha: 90, beta: 90, gamma: 90 } })))
      .toEqual({ error: "the CIF gives no b length" });
  });
});
