// Ratchet: no bare `void import(...)` (PRIMARY_SOFTWARE_AUDIT_PLAN P3.4
// residual, 2026-09-29). A fire-and-forget dynamic import with no rejection
// handler turns a failed lazy-chunk load (offline right after a deploy, a
// stale HTML naming a rotated hash) into a silent no-op plus an
// unhandled-rejection console warning. The sanctioned form is `runLazy`
// (lib/runLazy.ts): a busy entry in the StatusBar while the chunk loads and
// the standard error toast if it fails, handled with
// `.then(onRun, onLoadFailure)`. A site with a deliberate reason to stay
// quiet (warming a chunk, fire-and-forget bookkeeping) or its own report
// keeps the `void import(` form but must handle the rejection IN ITS OWN
// CHAIN: an explicit `.catch(...)` or a two-argument `.then(onRun,
// onFailure)` — never `onLoadFailure`, which is silent because it assumes
// runLazy already toasted. This test reads the chain, so a `.catch`
// elsewhere in the file does not satisfy it.
//
// Kept in its own file rather than architecture.test.ts so the scanner sits
// next to the one rule it serves.

import { describe, expect, it } from "vitest";

const modules = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The expression that starts at `from`, up to the statement's `;`, a `,`
 *  separating it from a sibling, or the bracket closing whatever encloses it
 *  (a JSX `{...}`, an argument list). `top` is its depth-0 text plus the
 *  commas directly inside a depth-0 call, so `.then(onRun, onFailure)` reads
 *  as `.then(,)` (a trailing comma is not a second argument); string and
 *  template-literal contents are dropped from it. `raw` is the full text. */
function chainAt(src: string, from: number): { top: string; raw: string } {
  let depth = 0;
  let top = "";
  let i = from;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) break;
      if (depth === 0) top += ch + ch;
      i = end;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      if (depth === 0) top += ch;
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) break;
      if (depth === 0) top += ch;
    } else if (depth === 0) {
      if (ch === ";" || ch === ",") break;
      top += ch;
    } else if (depth === 1 && ch === "," && !/^\s*\)/.test(src.slice(i + 1))) {
      top += ch;
    }
  }
  return { top, raw: src.slice(from, i) };
}

/** `path:line` of every `void import(` whose own chain handles no rejection. */
function bareVoidImports(files: [string, string][]): string[] {
  const out: string[] = [];
  for (const [path, src] of files) {
    for (const m of src.matchAll(/\bvoid\s+import\(/g)) {
      const before = src.slice(src.lastIndexOf("\n", m.index) + 1, m.index);
      if (/^\s*(\/\/|\*)/.test(before)) continue; // prose in a comment
      const { top, raw } = chainAt(src, m.index);
      const handled = /\.catch\s*\(|\.then\(,\)/.test(top) && !/\bonLoadFailure\b/.test(raw);
      if (!handled) out.push(`${path}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  return out;
}

describe("no bare void import( (P3.4 residual)", () => {
  it("every fire-and-forget dynamic import goes through runLazy or ends in an explicit .catch", () => {
    const sources = Object.entries(modules).filter(
      ([p]) => !/\.test\.(ts|tsx)$/.test(p),
    );
    expect(
      bareVoidImports(sources),
      "route these through runLazy (lib/runLazy.ts) so a failed chunk load shows the standard error toast",
    ).toEqual([]);
  });

  it("the scanner tells a guarded chain from a bare one", () => {
    const files: [string, string][] = [
      ["bare.ts", 'const f = () => void import("./a").then((m) => m.run());\n'],
      ["jsx.tsx", 'onClick={() => { void import("./b").then(({ go }) => go("x.catch(")); }}\n'],
      ["guarded.ts", 'void import("./c")\n  .then((m) => m.run())\n  .catch(() => undefined);\n'],
      ["warm.ts", 'void import("./d").catch(() => {});\n'],
      ["inner.ts", 'void import("./e").then((m) => m.x.catch(() => 0));\n'],
      ["prose.ts", "// a bare `void import(...)` used to live here\n"],
      ["twoArg.ts", 'void import("./f").then((m) => m.run(1, 2), (e) => report(e, "x"));\n'],
      ["oneArgCommas.ts", 'void import("./g").then((m) => m.run(1, 2));\n'],
      ["trailing.ts", 'void import("./h").then((m) =>\n  m.run(1, 2),\n);\n'],
      ["silent.ts", 'void import("./i").then((m) => m.run(), onLoadFailure);\n'],
      ["sanctioned.ts", 'void runLazy("Loading x…", () => import("./j")).then((m) => m.run(), onLoadFailure);\n'],
    ];
    expect(bareVoidImports(files)).toEqual([
      "bare.ts:1",
      "jsx.tsx:1",
      "inner.ts:1",
      "oneArgCommas.ts:1",
      "trailing.ts:1",
      "silent.ts:1",
    ]);
  });
});
