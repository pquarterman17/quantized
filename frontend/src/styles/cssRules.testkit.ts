// Stylesheet-assertion helpers, lifted verbatim out of
// LibraryDetails.parity.test.tsx (L1.4) when the Tile workspace's drag/drop
// landed and needed the SAME three checks against the SAME sheet. Sharing them
// rather than copying them is the point: a "does any rule actually paint this
// cue?" assertion that drifts between two renderers stops being evidence.
//
// Not a `.test.ts` file, so vitest's `src/**/*.test.{ts,tsx}` never collects
// it; and nothing under the app's import graph reaches it, so it never enters
// a production bundle.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `styles/shell.css` as text. Read from disk, the established pattern here
 *  (styles/reducedMotion.test.ts, workshops/peaks/PeakTable.test.tsx): Vite's
 *  CSS pipeline claims `.css` imports, so `?raw` returns an empty string. */
export function readShellCss(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell.css"), "utf8");
}

/** Every style rule in the sheet, flattened out of its `@media`/`@container`
 *  blocks. Parsed from the text rather than through jsdom's CSSOM so an
 *  unsupported modern property can never silently drop a rule these tests are
 *  looking for. */
export function flatRules(css: string): { selector: string; body: string }[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (prelude.startsWith("@")) out.push(...flatRules(body));
    else out.push({ selector: prelude, body });
    i = j;
  }
  return out;
}

/** Does this selector reach `el` when a pointer is over its row/tile?
 *  `:hover` is exactly what the pointer supplies, so it is erased before
 *  matching; a `:focus`-gated rule is NOT an answer for either flat
 *  renderer's grip, which is `aria-hidden` and has no tabindex, so those
 *  selectors are discarded. */
export function reachesOnHover(selector: string, el: Element): boolean {
  if (selector.includes(":focus")) return false;
  return selector.split(",").some((part) => {
    const stripped = part.trim().replace(/:hover/g, "");
    try {
      return stripped !== "" && el.matches(stripped);
    } catch {
      return false;
    }
  });
}

/** Does this rule body declare exactly `prop: value`? */
export function declares(body: string, prop: string, value: string): boolean {
  return new RegExp(`(^|[;{\\s])${prop}\\s*:\\s*${value}\\s*(;|$)`).test(body.trim());
}
