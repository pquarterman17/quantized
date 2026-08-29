// P3.3 (accessibility) — the app must honour the OS-level "reduce motion"
// setting, not only its own Preferences toggle.
//
// `styles/index.css` has always carried an app-wide motion kill-switch, but it
// was gated solely on `[data-reduce-motion]`, which `store/prefs.ts` sets from
// the Preferences ▸ Appearance switch and which defaults to false. A user who
// has set "reduce motion" at the OS level — the setting people with vestibular
// disorders set once and expect every app to respect — therefore still got the
// full transition/animation surface unless they also found the in-app toggle.
// Only two specific rules in shell.css consulted the media query.
//
// These assertions read the stylesheet source rather than a rendered page
// because jsdom does not evaluate `@media (prefers-reduced-motion)`, so a DOM
// test here would pass whatever the CSS said.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "index.css"), "utf8");

/** Pull the body of the first at-rule/selector block matching `head`. */
function blockAfter(source: string, head: string): string {
  const i = source.indexOf(head);
  if (i < 0) return "";
  // Walk braces from the first `{` after the head to its match.
  const start = source.indexOf("{", i);
  let depth = 0;
  for (let j = start; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}") {
      depth--;
      if (depth === 0) return source.slice(start + 1, j);
    }
  }
  return "";
}

// The four declarations that actually stop motion. Kept in one place so the
// media-query sweep and the preference sweep cannot drift apart.
const REQUIRED = [
  "transition-duration",
  "animation-duration",
  "animation-iteration-count",
  "scroll-behavior",
];

describe("reduced motion", () => {
  it("honours the OS prefers-reduced-motion setting app-wide", () => {
    const block = blockAfter(css, "@media (prefers-reduced-motion: reduce)");
    expect(block, "index.css must carry an OS-level reduced-motion sweep").not.toBe("");
    // Applies to everything, not a hand-listed set of selectors — a new
    // transition anywhere must be covered without anyone remembering to.
    expect(block).toMatch(/\*\s*,/);
    expect(block).toContain("::before");
    expect(block).toContain("::after");
    for (const decl of REQUIRED) {
      expect(block, `OS sweep must set ${decl}`).toContain(decl);
    }
    // `!important` so it beats the specific rules it is overriding.
    expect(block).toContain("!important");
  });

  it("keeps the in-app Preferences toggle working as an independent override", () => {
    const block = blockAfter(css, "[data-reduce-motion] *");
    expect(block, "the preference sweep must survive").not.toBe("");
    for (const decl of REQUIRED) {
      expect(block, `preference sweep must set ${decl}`).toContain(decl);
    }
  });
});
