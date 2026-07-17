// Playwright E2E harness (GUI_INTERACTION_PLAN #15 — "real-browser interaction
// coverage"). jsdom (the vitest environment `npm test` runs under) cannot
// validate canvas hit targets, native pointer capture, real HTML5 drag/drop,
// or high-DPI (deviceScaleFactor) rendering — this project runs the same
// journeys through a REAL Chromium browser against the REAL FastAPI backend
// serving the built SPA, exactly as a user would run `qz`.
//
// Server under test: the app is normally launched via `qz` (see
// src/quantized/cli.py), which serves the API *and* the built SPA (vite's
// `build.outDir` in vite.config.ts points at `../src/quantized/web`, and
// `src/quantized/app.py` mounts that directory at `/` when present). So the
// prerequisite is `npm run build` — see README.md — then `webServer` below
// launches the real headless backend (`qz --no-browser`) on a dedicated port
// distinct from the default :8000 (so a running `qz --dev`/`qz` on the
// developer's machine never collides with the e2e run). `--no-browser` also
// means QZ_AUTO_SHUTDOWN never gets armed (see cli.py `_serve`), so the
// server doesn't self-terminate when Playwright's browser contexts churn
// their /api/ws lifecycle connections between tests.
//
// Zoom matrix (the plan's "100/125/200% Windows-scaling matrix"): three
// projects at deviceScaleFactor 1.0 / 1.25 / 2.0. Running every spec at every
// scale would triple an already browser-heavy suite for marginal extra
// coverage, so only journeys tagged `@core` — the ones that directly exercise
// canvas hit-testing / pointer capture / native drag-and-drop, the exact
// gaps jsdom can't cover — run in the 125%/200% projects; every spec (core
// and non-core) runs at the 100% baseline.

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Distinct from the app's default :8000 and from `qz --dev`'s :5173 proxy
// target, so a developer's already-running instance is never disturbed.
const PORT = 8934;
// package.json has "type": "module", so this file loads as ESM — no
// __dirname global; derive it from import.meta.url instead.
const here = path.dirname(fileURLToPath(import.meta.url));
// frontend/e2e -> frontend -> repo root (where pyproject.toml + `uv run qz`
// resolve from).
const REPO_ROOT = path.resolve(here, "../..");

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    // Plain executable + args (no shell pipes/redirects) so this runs
    // identically under Windows cmd.exe and a POSIX shell.
    command: `uv run qz --no-browser --port ${PORT}`,
    cwd: REPO_ROOT,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium-100",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "chromium-125",
      grep: /@core/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.25 },
    },
    {
      name: "chromium-200",
      grep: /@core/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 },
    },
  ],
});
