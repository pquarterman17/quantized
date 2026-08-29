// Build identity, injected by `vite.config.ts` at build time.
//
// A diagnostic report that cannot say WHICH build produced it is a report you
// have to interrogate the reporter about before you can act on it, and
// "0.23.2" alone does not distinguish a release tag from a branch build eleven
// commits past it. So the bundle carries both the human-readable version and
// the short commit SHA.
//
// Deliberately NOT the full path, branch name, or working-tree state: a branch
// name in this repo can carry a collaborator's or a sample's name, and the
// bundle's promise is shape, never content. A short SHA is opaque, and this
// repo is public, so it identifies the build without describing the machine
// that made it.
//
// The `typeof` guards are load-bearing rather than defensive noise. `define`
// substitutes these globals textually at transform time, so any consumer that
// runs this module WITHOUT the config — a bare `tsx` invocation, a downstream
// bundler, a future SSR pass — would throw a ReferenceError on import instead
// of degrading. Diagnostics failing to load is the one failure mode that
// costs a user the report they were trying to file.

declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;

/** `package.json`'s version, or `"dev"` when built without the define. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/** Short commit SHA, or `"unknown"` when git was unavailable at build time
 *  (an sdist with no `.git`, a vendored tree) or the define is absent. */
export const BUILD_SHA: string = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "unknown";
