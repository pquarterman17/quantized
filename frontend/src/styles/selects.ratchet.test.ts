// Ratchet (UX audit 7, lane G2): every JSX `<select>` carries `qz-select`
// (or comes from the `Select` primitive, which adds it), so all native pickers
// share one height (--row-h), outline and focus ring. The audit found a Model
// select 18 px tall beside a Weighting select 28 px in the same window.
// The allowlist is EMPTY and may only shrink.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Index just past the `>` that closes the opening tag starting at `from`
 *  (skips `{...}` expressions, strings, and arrow `=>`). */
function tagEnd(s: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === quote && s[j - 1] !== "\\") quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && s[j - 1] !== "=") return j;
  }
  return s.length;
}

const ALLOWLIST: string[] = [];

describe("native <select> styling ratchet", () => {
  it("every JSX <select> has qz-select", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of walk(SRC)) {
      if (!f.endsWith(".tsx") || /\.test\./.test(f)) continue;
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/<select(?=[\s>])/g)) {
        const lineStart = s.lastIndexOf("\n", m.index) + 1;
        if (/^\s*(\/\/|\*|\/\*)/.test(s.slice(lineStart, m.index))) continue;
        seen++;
        const tag = s.slice(m.index, tagEnd(s, m.index + 7));
        if (!tag.includes("qz-select")) {
          bad.push(`${relative(SRC, f)}:${s.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(seen).toBeGreaterThan(40); // the scan is not vacuous
    expect(bad.filter((b) => !ALLOWLIST.includes(b))).toEqual([]);
  });
});
