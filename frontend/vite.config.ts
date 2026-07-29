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
    // CI (PR #94, run 30497138054): a reused fork worker hit V8's default
    // old-space limit late in the run and died — "Worker exited unexpectedly"
    // / "JavaScript heap out of memory" — with ALL 5,043 tests passing, so
    // vitest exited 1 on the unhandled error alone. The 348-file jsdom suite
    // accumulates heap in long-lived forks; give each fork explicit headroom
    // instead of riding node's RAM-dependent default. Raises no assertion and
    // changes nothing about scheduling — only the per-worker heap ceiling.
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=6144"],
      },
    },
  },
});
