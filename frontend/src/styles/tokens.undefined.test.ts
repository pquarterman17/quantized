// Guard (UX audit 7, lane G1): every `var(--x)` the app reads must resolve to a
// property something DEFINES. An undefined custom property is silent: the
// declaration is dropped at computed-value time, so `font-size: var(--type-
// small)` falls back to the inherited size and `fill="var(--bg-1)"` paints
// black. The audit found 14 such names (576-use `.qzk-ds-meta` aside, e.g.
// --type-small x30, --warning x12); this test keeps the count at zero.
//
// A name is DEFINED when it is declared in any stylesheet under src/ (a
// `--name:` declaration) or assigned at runtime by TS/TSX code (a quoted
// `"--name"` key, e.g. `style.setProperty("--lw", ...)`, `{ ["--sw"]: c }`).
// A name USED is any `var(--name` in a stylesheet or a .ts/.tsx source, with
// comments stripped first (docs mention `var(--x)` as an example).

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

const isTest = (f: string) => /\.(test|testkit)\.[tj]sx?$/.test(f) || /\.spec\./.test(f);
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const FILES = walk(SRC).filter((f) => /\.(css|tsx?)$/.test(f) && !isTest(f));

/** Names declared in CSS, or assigned as quoted keys in TS/TSX. */
export function definedProps(): Set<string> {
  const defined = new Set<string>();
  for (const f of FILES) {
    const src = stripComments(readFileSync(f, "utf8"));
    if (f.endsWith(".css")) {
      for (const m of src.matchAll(/(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1]);
    } else {
      for (const m of src.matchAll(/["'`](--[A-Za-z0-9_-]+)["'`]/g)) defined.add(m[1]);
    }
  }
  return defined;
}

/** `var(--name` reads, per file. A name followed by `${` is a dynamic prefix
 *  (`var(--series-${i})`) — it is checked by the series tokens' own tests. */
export function usedProps(): { name: string; file: string }[] {
  const used: { name: string; file: string }[] = [];
  for (const f of FILES) {
    const src = stripComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)(\$\{)?/g)) {
      if (m[2]) continue;
      used.push({ name: m[1], file: relative(SRC, f) });
    }
  }
  return used;
}

describe("design-token references", () => {
  it("finds a plausible number of definitions and uses (the scan is not vacuous)", () => {
    expect(definedProps().size).toBeGreaterThan(60);
    expect(usedProps().length).toBeGreaterThan(500);
    expect(definedProps().has("--surface-1")).toBe(true);
    expect(definedProps().has("--lw")).toBe(true); // runtime-assigned, via setProperty
  });

  it("every var(--x) used in a stylesheet or TSX resolves to a defined property", () => {
    const defined = definedProps();
    const undef = new Map<string, Set<string>>();
    for (const { name, file } of usedProps()) {
      if (defined.has(name)) continue;
      if (!undef.has(name)) undef.set(name, new Set());
      undef.get(name)!.add(file);
    }
    const report = [...undef].map(([n, fs]) => `${n}  (${[...fs].join(", ")})`);
    expect(report).toEqual([]);
  });

  it("the aliases this lane added still resolve to real tokens (no alias chain ends nowhere)", () => {
    const css = readFileSync(join(SRC, "styles", "colors.css"), "utf8") + readFileSync(join(SRC, "styles", "typography.css"), "utf8");
    const defined = definedProps();
    for (const m of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*var\((--[A-Za-z0-9_-]+)\)/g)) {
      expect(defined.has(m[2]), `${m[1]} -> ${m[2]}`).toBe(true);
    }
  });
});
