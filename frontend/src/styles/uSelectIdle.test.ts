// Plot audit round 3: uPlot keeps its drag-selection box mounted at 0x0 in the
// plot's top-left corner while nothing is selected. Its 1 px dashed accent
// border alone drew a 2 px dot there — visible in every stacked panel, facet
// cell and the magnifier inset (measured at 150 % display scaling). An idle
// (zero-size) box draws no border; a real drag still does.
//
// jsdom cannot compute a `border` shorthand holding `var()`, so this reads the
// stylesheet's own rules: which ones match the box, and what border they set.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const style = document.createElement("style");
style.textContent = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell.css"), "utf-8");
document.head.appendChild(style);
const rules = Array.from((style.sheet as CSSStyleSheet).cssRules).filter(
  (r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText.includes("u-select"),
);

/** The `border` declarations that apply to a `.u-select` box of this size,
 *  in source order (the selectors that zero it are the more specific ones). */
function borders(w?: number, h?: number): string[] {
  const el = document.createElement("div");
  el.className = "u-select";
  if (w !== undefined) el.style.width = `${w}px`;
  if (h !== undefined) el.style.height = `${h}px`;
  return rules.filter((r) => el.matches(r.selectorText)).map((r) => r.style.getPropertyValue("border") || r.cssText);
}

describe("the uPlot selection box", () => {
  it("draws no border while idle, and its dashed border during a drag", () => {
    expect(borders().at(-1)).toMatch(/^(0|none)/); // as mounted: no inline size at all
    expect(borders(0, 0).at(-1)).toMatch(/^(0|none)/); // cleared after a drag
    expect(borders(120, 0).at(-1)).toMatch(/^(0|none)/);
    expect(borders(120, 80)).toHaveLength(1);
    expect(borders(120, 80)[0]).toContain("dashed");
  });
});
