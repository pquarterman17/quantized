// Screen == export for a widthless line: one rule, `plotTemplates.canvasLineWidth`.
//
// Every export builder sends the width a canvas draws an unstyled series at
// (`lib/exportLineWidth.ts`) by calling `canvasLineWidth(template, pref)`. A
// canvas that re-derived the width inline ("Screen -> the pref, else the
// template's lineWidth") could drift from that call without any test noticing,
// and the PDF would silently stop matching the screen. So every canvas that
// hands uPlot a `baseLineWidth` must compute it with the same helper, and only
// `lib/plotTemplates.ts` may read a template's `lineWidth`.
//
// Sabotage: put any one site back to
// `plotTemplate === "screen" ? defaultLineWidth : resolveTemplate(plotTemplate).lineWidth`
// and both checks below name it.

import { describe, expect, it } from "vitest";

const modules = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const sources = (): [string, string][] =>
  Object.entries(modules).filter(([p]) => !/\.test\.(ts|tsx)$/.test(p));

/** A `baseLineWidth` VALUE handed over: a JSX prop (`baseLineWidth={…}`) or an
 *  object-literal field (`baseLineWidth: …`). Not a read (`args.baseLineWidth`),
 *  a shorthand pass-through (`baseLineWidth,`) or a type (`baseLineWidth?:`). */
const ASSIGNMENT = /(?<![.\w])baseLineWidth\s*(?:=\s*\{|:)\s*([^,;}\n]*)/g;

function assignments(): { file: string; value: string }[] {
  return sources().flatMap(([file, src]) =>
    [...src.matchAll(ASSIGNMENT)].map((m) => ({ file, value: m[1].trim() })),
  );
}

describe("canvas line width: one rule for screen and export", () => {
  it("every canvas computes its baseLineWidth with canvasLineWidth", () => {
    const found = assignments();
    // Not vacuous: the Stage, the multi-panel stage and the background windows all pass one.
    expect(found.length).toBeGreaterThanOrEqual(5);
    const inline = found.filter((a) => !a.value.startsWith("canvasLineWidth(")).map((a) => `${a.file}: ${a.value}`);
    expect(inline).toEqual([]);
  });

  it("only lib/plotTemplates.ts reads a plot template's lineWidth", () => {
    const READ = /(?:resolveTemplate\([^)]*\)|\btemplate)\.lineWidth\b/;
    const readers = sources()
      .filter(([p, src]) => !p.endsWith("/lib/plotTemplates.ts") && READ.test(src))
      .map(([p]) => p);
    expect(readers).toEqual([]);
  });
});
