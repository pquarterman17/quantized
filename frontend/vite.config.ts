/// <reference types="vitest/config" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

import { preloadPrune } from "./scripts/preloadPrune.mjs";

// Build identity for the diagnostics bundle (see src/lib/buildInfo.ts). Read
// here rather than imported from package.json so the bundle never depends on
// `resolveJsonModule`, and so a tree with no `.git` (an sdist, a vendored
// copy) still builds — it just reports an unknown SHA.
//
// `fileURLToPath`, never `new URL(…).pathname`. A file URL's pathname is a URL
// component, not a filesystem path, and on Windows it comes back with the
// drive letter behind a leading slash — `/C:/Users/…/frontend/`. Node rejects
// that as a `cwd` with ENOENT, `gitSha()` swallows it, and every Windows build
// silently stamps `unknown` while the tests stay green because `"unknown"` is
// a perfectly truthy string. That is exactly what shipped in #269 and what
// review caught. `fileURLToPath` is platform-aware and yields `C:\Users\…`.
const configDir = fileURLToPath(new URL(".", import.meta.url));

// Test files that run in the `node` environment (see `test.projects` below).
const nodeEnvTests = JSON.parse(
  readFileSync(join(configDir, "src/test/nodeEnvTests.json"), "utf8"),
) as string[];

const pkgVersion =(): string => {
  try {
    return (JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as {
      version?: string;
    }).version ?? "dev";
  } catch {
    return "dev";
  }
};

const gitSha = (): string => {
  try {
    // execFileSync, not execSync: no shell, so nothing here can be influenced
    // by a directory name or an environment variable.
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: configDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
};

// Bundle diet slice 8: drop already-loaded chunks from every dynamic import's
// preload list (see scripts/preloadPrune.mjs for why that is a pure no-op at
// runtime and what it saves in eager bytes).
const prune = preloadPrune();

// Dev: proxy /api to the FastAPI backend (`qz` / uvicorn on :8000).
// Build: emit into the backend package so `qz` can serve the SPA statically.
export default defineConfig({
  plugins: [react(), prune.plugin],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion()),
    __BUILD_SHA__: JSON.stringify(gitSha()),
  },
  build: {
    outDir: "../src/quantized/web",
    emptyOutDir: true,
    modulePreload: { resolveDependencies: prune.resolveDependencies },
    // Bundle diet slice 25 (plans/BUNDLE_HEADROOM.md): write every module the
    // entry runs at startup into the entry chunk itself.
    //
    // Rolldown's automatic splitting gives each distinct "which entries reach
    // this module" set a chunk of its own, so any startup module that a lazy
    // panel also imports was split out of the entry chunk. The startup code
    // ended up in 87 chunks, every one a `<link rel="modulepreload">` fetched
    // before first paint anyway, and each boundary was paid for in eager
    // bytes: an `import{a as b,…}from"./x.js"` on one side and an `export{…}`
    // on the other, for names that never leave the startup set. Measured on
    // `d5c8ffba`: 836,984 B across 87 eager chunks; 821,796 B as the entry
    // chunk plus Rolldown's runtime. The same modules, 15,188 B less glue.
    //
    // `tags: ["$initial"]` is Rolldown's own name for "statically needed by
    // an entry". `includeDependenciesRecursively: false` is what keeps the
    // group exact, and it is NOT optional here: the default (true) also pulls
    // in whatever a captured module merely re-exports, and a re-export is how
    // this codebase keeps lazy-only halves out of the eager bundle (`export *
    // from "./foldertreeQueries"` in an eager module; architecture.test.ts's
    // REEXPORTED_LAZY_HALVES). Measured with the default: 15 lazy modules came
    // back into the startup chunk, 833,354 B.
    //
    // A group only decides which FILE a module is written to. The set of
    // modules loaded at startup is unchanged (the eager chunks' sourcemaps
    // list the same sources before and after), and lazy chunks import from
    // the entry chunk exactly as they imported from its 86 siblings.
    rolldownOptions: {
      output: {
        codeSplitting: { includeDependenciesRecursively: false, groups: [{ name: "app", tags: ["$initial"] }] },
      },
    },
    // Vite warns about any single chunk over 500 kB and suggests splitting
    // it. For the entry chunk that advice is the reverse of the measurement
    // above; `scripts/check-bundle-size.mjs` is the size gate (it fails the
    // build, this only prints), so the warning is set clear of the entry.
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: {
      "/api": {
        // qz --dev passes the backend port through (review 2026-07-11:
        // hardcoding 8000 proxied /api to the wrong server under --port).
        target: `http://127.0.0.1:${process.env.QZ_BACKEND_PORT ?? "8000"}`,
        ws: true,
      },
    },
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
    // Two projects, split by environment. Creating a jsdom environment per
    // test file was ~46% of the suite's tracked time (1,714 of them, ~0.8 s
    // each), and a file that never touches the DOM pays that for nothing.
    // `src/test/nodeEnvTests.json` lists the files that PASS in vitest's bare
    // `node` environment; everything else (every .tsx, every test that reads
    // document/window/localStorage, directly or through the code it imports)
    // stays on jsdom, so a NEW test file defaults to the safe environment.
    // A listed file that starts needing the DOM fails loudly with
    // "document is not defined": move it out of the list. Regenerate by
    // running the .test.ts files with `environment: "node"` and keeping the
    // ones that pass. (`pool: "vmThreads"` was tried and is not an option
    // here: jsdom's html-encoding-sniffer require()s an ES-module-only
    // @exodus/bytes, which the vm pools cannot load.)
    //
    // `scripts/freeze-regression-matrix.mjs` re-enters vitest's Node API with
    // `include` pointed at itself and needs jsdom; project-level `include`
    // would ignore that override and run the whole suite, so the script sets
    // QZ_VITEST_FLAT=1 and gets the single-environment shape instead.
    ...(process.env.QZ_VITEST_FLAT === "1"
      ? { environment: "jsdom" as const, include: ["src/**/*.test.{ts,tsx}"] }
      : { projects: [
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: [...configDefaults.exclude, ...nodeEnvTests],
        },
      },
      {
        extends: true,
        test: { name: "node", environment: "node", include: nodeEnvTests },
      },
    ] }),
    // Vitest's 5 s default is too tight for this suite's canvas/uPlot-heavy
    // tests once the full 300+ file run is executing in parallel: a DIFFERENT
    // file (StatStage, WindowCanvas, …) would time out on each run while every
    // one of them passed in isolation and in pairs. That is a scheduling
    // symptom, not a defect, and it matches the repo's existing note that
    // Windows runs ~5-6x slower and needs generous timing bounds. Raising this
    // weakens no assertion — it only changes how long a genuinely hung test
    // takes to fail.
    testTimeout: 20_000,
  },
});
