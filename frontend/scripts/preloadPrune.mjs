// Bundle diet slice 8 (plans/BUNDLE_HEADROOM.md): stop paying, in eager
// bytes, for preload hints that can never do anything.
//
// For every dynamic `import()` in a chunk, Vite writes the target's whole
// transitive static-import closure into that chunk as a preload list
// (`__vite__mapDeps([...])` plus one shared file-name table per chunk). For a
// lazy seam reached from the entry chunk, most of that closure IS the entry
// graph -- `useApp`, `react`, `index` itself -- so every seam carried ~50 file
// names of chunks that were already fetched and evaluated before the line
// holding the `import()` could even run. Measured on `3ccf4972`: 18,363 B of
// the entry chunk (20,680 B across all eager chunks) were those lists.
//
// A chunk's own static-import closure is, by ES module semantics, fully
// fetched before any of that chunk's code executes, so hinting any of it again
// is a guaranteed no-op: Vite's preload helper finds the existing
// `<link rel="modulepreload">` (or its own earlier one) and returns. Dropping
// exactly those entries therefore changes no fetch, no ordering and no error
// path; every dependency that is NOT yet loaded (the seam's own lazy chunk and
// the lazy chunks it shares with other seams) is kept, so the parallel
// preloading the lists exist for is untouched. CSS never reaches this filter
// (Vite appends a seam's CSS after `resolveDependencies`), and the HTML
// entry's own modulepreload tags are passed through unchanged.
//
// The build FAILS if that promise is ever broken on the real output: see the
// plugin's `writeBundle` below and scripts/preloadVerify.mjs.

import { verifyPreloadLists } from "./preloadVerify.mjs";

/** Every chunk file name `host` statically imports, transitively (not `host`
 *  itself). `bundle` is Rollup/Rolldown's output bundle object. */
export function staticClosure(bundle, host) {
  const seen = new Set();
  const visit = (name) => {
    const chunk = bundle[name];
    if (!chunk || chunk.type !== "chunk") return;
    for (const dep of chunk.imports) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      visit(dep);
    }
  };
  visit(host);
  seen.delete(host);
  return seen;
}

/** Chunks every page has fully fetched before ANY app code runs: each HTML
 *  entry chunk plus its static closure, intersected across entries (this app
 *  has one, `index.html`, so this is exactly its `<script type="module">` +
 *  `<link rel="modulepreload">` set -- what `check-bundle-size.mjs` calls
 *  eager). ES modules link the whole static graph before evaluating any of
 *  it, so no `import()` anywhere can execute before these are loaded. */
export function alwaysLoaded(bundle) {
  let common = null;
  for (const [name, chunk] of Object.entries(bundle)) {
    if (chunk.type !== "chunk" || !chunk.isEntry) continue;
    const set = staticClosure(bundle, name);
    set.add(name);
    common = common === null ? set : new Set([...common].filter((f) => set.has(f)));
  }
  return common ?? new Set();
}

/** The pure filter: drop from `deps` every file certainly loaded by the time
 *  the host chunk's own code runs -- its own static closure, plus the
 *  `always` set (`alwaysLoaded`). `closureOf(host)` returns the former
 *  (memoized by the caller). Order of the kept entries is preserved. */
export function pruneLoadedDeps(deps, host, closureOf, always = new Set()) {
  const loaded = closureOf(host);
  return deps.filter((dep) => !loaded.has(dep) && !always.has(dep));
}

/** Wires the filter into a Vite config: a plugin whose `generateBundle` runs
 *  FIRST (`order: "pre"`) to capture the bundle, and a
 *  `build.modulePreload.resolveDependencies` that consults it when Vite's own
 *  `vite:build-import-analysis` writes the lists later in the same hook. */
export function preloadPrune() {
  let bundle = null;
  let always = new Set();
  const cache = new Map();
  const closureOf = (host) => {
    let set = cache.get(host);
    if (!set) {
      set = bundle ? staticClosure(bundle, host) : new Set();
      cache.set(host, set);
    }
    return set;
  };
  return {
    plugin: {
      name: "qz:preload-prune",
      apply: "build",
      generateBundle: {
        order: "pre",
        handler(_opts, output) {
          bundle = output;
          always = alwaysLoaded(output);
          cache.clear();
        },
      },
      // The gate: re-derive every list's requirements from the EMITTED code
      // (scripts/preloadVerify.mjs) and fail the build on any lost chunk.
      async writeBundle(_opts, output) {
        const chunks = {};
        for (const [name, c] of Object.entries(output)) {
          if (c.type !== "chunk") continue;
          chunks[name] = { code: c.code, css: [...(c.viteMetadata?.importedCss ?? [])], isEntry: c.isEntry };
        }
        const { sites, checked, violations } = await verifyPreloadLists(chunks);
        if (checked === 0) this.error("preload-verify: found no preload list to check -- has Vite's output format changed?");
        if (violations.length > 0) {
          this.error(
            `preload-verify: ${violations.length} preload list(s) lost a needed chunk:\n  ${violations.slice(0, 20).join("\n  ")}`,
          );
        }
        console.log(`preload-verify: OK -- ${checked} preload lists checked (${sites} wrapped import() sites), 0 violations`);
      },
    },
    // Vite passes only the JS deps here and appends the CSS deps after the
    // result, so a pruned list lists its CSS last. Harmless: the preload
    // helper inserts the CSS links in their own original relative order, and
    // a JS modulepreload never takes part in the cascade.
    resolveDependencies(_filename, deps, { hostId, hostType }) {
      // `html`: the entry's own <link rel="modulepreload"> tags -- the eager
      // set itself. Never touch those.
      if (hostType !== "js") return deps;
      return pruneLoadedDeps(deps, hostId, closureOf, always);
    },
  };
}
