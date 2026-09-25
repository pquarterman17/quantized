// Build-gate check for scripts/preloadPrune.mjs (bundle diet slice 8, review
// round): proves on the REAL build output, not a synthetic bundle, that no
// dynamic import's preload list lost a chunk it needs. Ported from the
// reviewer's independent probe. The static-import graph is re-derived from
// the emitted code with es-module-lexer -- NOT from Rolldown's own `imports`
// metadata, which the prune itself trusts -- so a future bundler change to
// static-import semantics shows up here as a violation instead of passing
// silently.
//
// For every `import()` Vite wrapped in its preload helper, with host H and
// target T:
//   needs(H, T) = {T} + staticClosure(T)  -  {H}  -  staticClosure(H)
//                 -  entryClosure (every HTML entry plus its closure,
//                    intersected across entries)
// and every chunk in needs(H, T) must be in the site's list. CSS is never
// pruned, so every CSS file of every chunk Vite would have walked (T and its
// closure, stopping at H, the way Vite builds the list) must be listed too.

import { posix } from "node:path";

import { init, parse } from "es-module-lexer";

const HEADER = /^const __vite__mapDeps=\(i,m=__vite__mapDeps,d=\(m\.f\|\|\(m\.f=(\[[^\]]*\])\)\)\)=>i\.map\(i=>d\[i\]\);\n/;
const MARKER = /__vite__mapDeps\(\[([\d,]*)\]\)/g;
// An emptied list right after the specifier: `import("./X.js"),[])`.
const AFTER = /^[`'"]?\s*\)\s*,\s*(\[\])\s*\)/;

/**
 * @param {Record<string, { code: string; css: readonly string[]; isEntry: boolean }>} chunks
 *   the emitted JS chunks by file name (`assets/x.js`), with their CSS files
 * @returns {Promise<{ sites: number; checked: number; violations: string[] }>}
 */
export async function verifyPreloadLists(chunks) {
  await init;
  const statics = {};
  const dynamics = {};
  for (const [name, { code }] of Object.entries(chunks)) {
    const [imps] = parse(code);
    const dir = posix.dirname(name);
    const at = (spec) => posix.join(dir, spec);
    statics[name] = [...new Set(imps.filter((i) => i.d === -1 && i.n).map((i) => at(i.n)))];
    dynamics[name] = imps
      .filter((i) => i.d > -1 && i.n)
      .map((i) => ({ target: at(i.n), start: i.ss, end: i.e }))
      .sort((a, b) => a.start - b.start);
  }
  const closure = (host) => {
    const seen = new Set();
    const visit = (n) => {
      for (const d of statics[n] ?? []) {
        if (seen.has(d)) continue;
        seen.add(d);
        visit(d);
      }
    };
    visit(host);
    seen.delete(host);
    return seen;
  };
  let entry = null;
  for (const [name, c] of Object.entries(chunks)) {
    if (!c.isEntry) continue;
    const set = closure(name);
    set.add(name);
    entry = entry === null ? set : new Set([...entry].filter((f) => set.has(f)));
  }
  entry ??= new Set();

  let sites = 0;
  let checked = 0;
  const violations = [];
  for (const [host, { code }] of Object.entries(chunks)) {
    const header = code.match(HEADER);
    const table = header ? JSON.parse(header[1]) : [];
    const hostClosure = closure(host);
    const dyn = dynamics[host];
    // Every list site: each `__vite__mapDeps([...])` marker belongs to the
    // last import() before it (the wrapper may be `.then(...)` or an async
    // arrow that destructures the import, so the marker is not always right
    // after the specifier); plus the `import("./X"),[])` shape, which is how
    // Vite writes a list that ended up empty.
    const lists = [];
    const claimed = new Set();
    for (const mk of code.matchAll(MARKER)) {
      const owner = dyn.filter((d) => d.start < mk.index).pop();
      if (!owner) {
        violations.push(`${host}: a __vite__mapDeps list at ${mk.index} with no import() before it`);
        continue;
      }
      claimed.add(owner);
      lists.push({ target: owner.target, keys: mk[1] });
    }
    for (const d of dyn) {
      if (claimed.has(d)) continue;
      const m = code.slice(d.end).match(AFTER);
      if (m?.[1] !== undefined) lists.push({ target: d.target, keys: "" });
    }
    for (const { target, keys } of lists) {
      sites += 1;
      const listed = new Set(keys.split(",").filter(Boolean).map((k) => table[Number(k)]));
      if ([...listed].some((f) => f === undefined)) {
        violations.push(`${host} -> ${target}: list index outside its __vite__mapDeps table`);
        continue;
      }
      checked += 1;
      // What Vite's own walk collects: target and its closure, never
      // descending through the host itself.
      const walked = new Set();
      const walk = (n) => {
        if (n === host || walked.has(n)) return;
        walked.add(n);
        for (const d of statics[n] ?? []) walk(d);
      };
      walk(target);
      // Vite's own rule, not a prune: a target with nothing else to load
      // (its walk is just itself, no CSS) is written as `[]`.
      const alone = walked.size <= 1 && [...walked].every((n) => !(chunks[n]?.css ?? []).length);
      if (listed.size === 0 && alone) continue;
      const full = new Set([target, ...closure(target)]);
      for (const need of full) {
        if (need === host || hostClosure.has(need) || entry.has(need)) continue;
        if (!listed.has(need)) violations.push(`${host} -> ${target}: needs ${need}, not in its preload list`);
      }
      for (const n of walked) {
        for (const css of chunks[n]?.css ?? []) {
          if (!listed.has(css)) violations.push(`${host} -> ${target}: CSS ${css} (of ${n}) not in its preload list`);
        }
      }
    }
  }
  return { sites, checked, violations };
}
