// Lazy-import guard for the two aux-figure workshops (ternary, vector field).
//
// Both panels mount through ONE AppOverlays `lazyPanel()` seam
// (AuxFigurePanels.tsx) so the eager bundle carries only their open flags
// (auxFigureStore.ts), one stub and the two command entries. Rollup ships a module to wherever ANY importer's chunk
// lands, so one static import from an eager file would fold the whole
// workshop (preview hook, request builders, export flow) into first-paint
// JS. This grep-level guard names that at the import site, the same shape
// as architecture.test.ts's Origin-apply and KaTeX seams.

import { describe, expect, it } from "vitest";

const modules = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const WORKSHOP_DIRS = ["/workshops/ternary/", "/workshops/fieldplot/"];
const sources = () =>
  Object.entries(modules).filter(([p]) => !/\.test\.(ts|tsx)$/.test(p));
const overlays = () => sources().find(([p]) => p.endsWith("/AppOverlays.tsx"))?.[1] ?? "";

describe("ternary + vector-field workshops stay lazily mounted", () => {
  it("AppOverlays mounts the pair through one lazyPanel, gated on either flag", () => {
    const src = overlays();
    expect(src).toContain('lazyPanel(() => import("./components/workshops/ternary/AuxFigurePanels")');
    expect(src).toContain("useAuxFigureStore((s) => s.ternaryOpen || s.fieldOpen)");
    expect(src).toContain("{auxFigureOpen && <AuxFigurePanels />}");
    expect(src).not.toMatch(/import\("\.\/components\/workshops\/(ternary\/TernaryPanel|fieldplot\/FieldPlotPanel)"\)/);
  });

  it("the shared chunk gates each panel on its own flag", () => {
    const src = sources().find(([p]) => p.endsWith("/workshops/ternary/AuxFigurePanels.tsx"))?.[1] ?? "";
    expect(src).toContain("{ternaryOpen && <TernaryPanel />}");
    expect(src).toContain("{fieldOpen && <FieldPlotPanel />}");
  });

  it("outside the two workshop directories, only the open-flag store is imported statically", () => {
    const pattern = /from\s+["'][^"']*\/workshops\/(ternary|fieldplot)\/([A-Za-z]+)["']/g;
    const offenders: string[] = [];
    for (const [p, src] of sources()) {
      if (WORKSHOP_DIRS.some((d) => p.includes(d))) continue;
      for (const m of src.matchAll(pattern)) {
        if (m[2] !== "auxFigureStore") offenders.push(`${p} imports ${m[1]}/${m[2]}`);
      }
    }
    expect(offenders, "reach the workshops through AppOverlays' lazyPanel() only").toEqual([]);
  });

  it("the open-flag store imports nothing from the workshops it gates", () => {
    const store = sources().find(([p]) => p.endsWith("/workshops/ternary/auxFigureStore.ts"))?.[1] ?? "";
    expect(store).not.toBe("");
    expect(store).not.toMatch(/from\s+["']\.\//);
    expect(store).not.toMatch(/from\s+["']\.\.\/fieldplot/);
  });
});
