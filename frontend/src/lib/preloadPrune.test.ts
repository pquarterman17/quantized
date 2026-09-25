// Regression tests for the build-time preload-list pruning of bundle diet
// slice 8 (frontend/scripts/preloadPrune.mjs, wired in vite.config.ts; see
// plans/BUNDLE_HEADROOM.md). The claim that makes it safe is narrow: an entry
// is dropped from a dynamic import's preload list ONLY when that chunk is
// certainly loaded before the importing code can run -- it is in the host
// chunk's own static closure, or in the HTML entry's. Everything else (the
// seam's own lazy chunk, lazy chunks it shares with other seams, CSS) must
// survive, or the prune would start SERIALIZING fetches it used to overlap.

import { describe, expect, it } from "vitest";

import { alwaysLoaded, preloadPrune, pruneLoadedDeps, staticClosure } from "../../scripts/preloadPrune.mjs";

/** index (entry) -> useApp -> react; index dynamically imports Dialog, which
 *  statically imports shared + useApp; Panel (lazy) statically imports shared
 *  and dynamically imports Deep, which statically imports shared + extra. */
const bundle = {
  "index.js": { type: "chunk" as const, isEntry: true, imports: ["useApp.js", "react.js"] },
  "useApp.js": { type: "chunk" as const, imports: ["react.js"] },
  "react.js": { type: "chunk" as const, imports: [] },
  "Dialog.js": { type: "chunk" as const, imports: ["shared.js", "useApp.js"] },
  "Panel.js": { type: "chunk" as const, imports: ["shared.js", "index.js"] },
  "Deep.js": { type: "chunk" as const, imports: ["shared.js", "extra.js"] },
  "shared.js": { type: "chunk" as const, imports: ["react.js"] },
  "extra.js": { type: "chunk" as const, imports: [] },
  "index.css": { type: "asset" as const },
};

describe("preloadPrune (bundle diet slice 8)", () => {
  it("computes a chunk's transitive static closure, excluding the chunk itself", () => {
    expect([...staticClosure(bundle, "index.js")].sort()).toEqual(["react.js", "useApp.js"]);
    expect([...staticClosure(bundle, "Panel.js")].sort()).toEqual(["index.js", "react.js", "shared.js", "useApp.js"]);
    expect(staticClosure(bundle, "missing.js").size).toBe(0);
  });

  it("treats the HTML entry and its static closure as always loaded, and nothing lazy", () => {
    expect([...alwaysLoaded(bundle)].sort()).toEqual(["index.js", "react.js", "useApp.js"]);
    // Two entries: only what BOTH pages load is safe to assume.
    const twoPages = { ...bundle, "other.js": { type: "chunk" as const, isEntry: true, imports: ["react.js"] } };
    expect([...alwaysLoaded(twoPages)].sort()).toEqual(["react.js"]);
    expect(alwaysLoaded({}).size).toBe(0);
  });

  it("drops only certainly-loaded chunks and keeps every lazy dependency, in order", () => {
    const closureOf = (h: string) => staticClosure(bundle, h);
    const always = alwaysLoaded(bundle);
    // index -> import(Dialog): Vite lists Dialog + its closure. useApp/react
    // are already loaded; Dialog and shared are NOT and must stay preloaded
    // in parallel.
    expect(
      pruneLoadedDeps(["Dialog.js", "shared.js", "react.js", "useApp.js"], "index.js", closureOf, always),
    ).toEqual(["Dialog.js", "shared.js"]);
    // Panel (itself lazy) -> import(Deep): shared is in PANEL's own closure,
    // so it is loaded too; extra is new.
    expect(
      pruneLoadedDeps(["Deep.js", "shared.js", "react.js", "extra.js"], "Panel.js", closureOf, always),
    ).toEqual(["Deep.js", "extra.js"]);
    // Without the always-set, a host outside the entry graph keeps entries
    // it cannot prove loaded from its own closure.
    expect(pruneLoadedDeps(["Deep.js", "useApp.js"], "Deep.js", closureOf)).toEqual(["Deep.js", "useApp.js"]);
  });

  it("wires into Vite: captures the bundle first, filters js hosts, never touches the HTML preload tags", () => {
    const prune = preloadPrune();
    expect(prune.plugin.generateBundle.order).toBe("pre");
    // Before the bundle is known, nothing is pruned (fail open, not closed).
    const deps = ["Dialog.js", "shared.js", "react.js", "useApp.js"];
    expect(prune.resolveDependencies("Dialog.js", deps, { hostId: "index.js", hostType: "js" })).toEqual(deps);

    prune.plugin.generateBundle.handler({}, bundle);
    expect(prune.resolveDependencies("Dialog.js", deps, { hostId: "index.js", hostType: "js" })).toEqual([
      "Dialog.js",
      "shared.js",
    ]);
    // The entry's own <link rel="modulepreload"> list IS the eager set.
    const html = ["useApp.js", "react.js"];
    expect(prune.resolveDependencies("index.js", html, { hostId: "index.html", hostType: "html" })).toBe(html);
  });
});
