/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: proxy /api to the FastAPI backend (`qz` / uvicorn on :8000).
// Build: emit into the backend package so `qz` can serve the SPA statically.
export default defineConfig({
  plugins: [react()],
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
    // CI (PR #94, runs 30497138054 + 30498716041): a fork worker died with
    // V8 "heap out of memory" at the very END of the run — all 5,043 tests
    // reported PASSED both times, so vitest exited 1 on the unhandled
    // worker-exit alone. Raising the per-fork old-space cap to 6 GB did NOT
    // fix it (verified applied via a heap-limit probe test), which points at
    // PHYSICAL memory pressure on the 16 GB runner: N concurrent jsdom forks
    // + the main process exhaust the box, and the allocation failure lands in
    // the fork tearing down the heaviest file. So: keep the explicit heap
    // ceiling, and on CI only, halve fork concurrency to bound peak RSS.
    // Local runs keep full parallelism; no assertion changes either way.
    //
    // NOTE (PR #94 review): originally written as `poolOptions.forks.{...}`,
    // which vitest 4 REMOVED — it printed a deprecation and applied nothing.
    // These are the vitest 4 top-level equivalents (migration guide
    // "pool rework": execArgv and maxWorkers are now direct `test` options).
    execArgv: ["--max-old-space-size=6144"],
    ...(process.env.CI ? { maxWorkers: 2 } : {}),
  },
});
