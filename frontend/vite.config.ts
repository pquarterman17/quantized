/// <reference types="vitest/config" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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

const pkgVersion = (): string => {
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

// Dev: proxy /api to the FastAPI backend (`qz` / uvicorn on :8000).
// Build: emit into the backend package so `qz` can serve the SPA statically.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion()),
    __BUILD_SHA__: JSON.stringify(gitSha()),
  },
  build: {
    outDir: "../src/quantized/web",
    emptyOutDir: true,
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
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
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
