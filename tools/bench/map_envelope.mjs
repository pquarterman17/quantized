// PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 FINAL residual M1 — browser-side 2-D map
// rendering/interaction at 500^2, 1000^2, 2000^2. `docs/performance_envelope.
// md`'s "Residuals" section left this explicitly unmeasured: the backend half
// (import + matplotlib contourf render) was measured (envelope.py), but never
// through the real app's own Canvas2D map viewer (components/Stage/
// MapStage.tsx).
//
// Same discipline as frontend_envelope.mjs / workspace_envelope.mjs: drive
// the REAL app (real FastAPI backend, real built SPA, real Chromium) via the
// Command Palette; measure only, never monkeypatch frontend/src (the two
// download-capture spots patch the PAGE's own runtime from the outside, same
// as a test harness stubbing fetch).
//
// A 2-D XRDML dataset auto-routes `stageTab` to "map" on import
// (lib/stagetab.ts's `nextStageTab`), so no tab click is needed — the same
// `waitForCanvasPaint` used for F1's uPlot canvas works unchanged here
// (MapStage paints into the same `.qzk-stage canvas` selector).
//
// Usage:
//   cd tools/bench && npm install   # one-time, see frontend_envelope.mjs
//   uv run python tools/baselines/make_map_fixtures.py   # 500/1000/2000 maps
//   node map_envelope.mjs [--port 8945] [--out <path>]

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

import { REPO_ROOT, killTree, parseArgs, waitForServer } from "../visual/origin_shared.mjs";
import {
  gotoHarness,
  jsHeapUsed,
  measureHoverLatencies,
  median,
  openPaletteAndLocate,
  p95,
  waitForCanvasPaint,
  waitForCountAtLeast,
  withDeadline,
} from "./envelope-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 8945); // distinct from :8000, :8934, :8793, :8942, :8944, :8946, :8947
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT_JSON = args.out
  ? args.out
  : join(REPO_ROOT, "docs", "envelope", "2026-07-27-map.json");

const LARGE_DIR = join(REPO_ROOT, "tools", "baselines", "out");
const SIZES = args.sizes ? args.sizes.split(",").map(Number) : [500, 1000, 2000];

const results = [];

function record(caseId, fixture, measurement, value, unit, notes, status = "ok") {
  const entry = { case: caseId, fixture, measurement, value, unit, notes, status };
  results.push(entry);
  const shown = value == null ? "—" : value;
  console.log(`  [${caseId}] ${measurement} = ${shown}${unit ? " " + unit : ""}${status === "unmeasured" ? " (UNMEASURED)" : ""}`);
}

function unmeasured(caseId, fixture, measurement, reason) {
  record(caseId, fixture, measurement, null, null, `UNMEASURED: ${reason}`, "unmeasured");
}

function hardwareInfo(browserVersion, playwrightVersion) {
  const cpus = os.cpus();
  return {
    os: `${os.type()} ${os.release()} (${process.platform}/${process.arch})`,
    cpu: cpus[0]?.model ?? "unknown",
    cores: cpus.length,
    total_ram_gb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    node_version: process.version,
    playwright_version: playwrightVersion,
    browser_version: browserVersion,
  };
}

async function withIsolatedBrowser(label, fn) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true });
  try {
    await fn(browser);
  } catch (e) {
    console.error(`[${label}] case group failed: ${e.stack || e.message}`);
  } finally {
    try {
      await withDeadline(() => browser.close(), 15000, `${label} browser.close()`);
    } catch {
      const proc = browser.process();
      if (proc && !proc.killed) proc.kill("SIGKILL");
    }
  }
}

async function newInstrumentedPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  return { context, page, cdp };
}

/** Same real import path as envelope-lib's importFilesViaPalette, but we need
 *  the page.waitForResponse() promise ARMED before the click (so it can't
 *  miss a response that lands before we start awaiting it) — reimplemented
 *  inline rather than composed, since the caller needs the file-chooser
 *  click and the response-arm to interleave in a specific order. */
async function importAndCapture(page, filePath, caseId, fixtureRel, mapCalls) {
  const t0 = Date.now();
  let importedOk = false;
  try {
    await withDeadline(
      async () => {
        const item = await openPaletteAndLocate(page, "Import data");
        const chooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
        await item.click();
        const chooser = await chooserPromise;
        await chooser.setFiles(filePath);
        await waitForCountAtLeast(page, "[data-ds-id]", 1, 240000);
      },
      240000,
      "map upload+parse+dataset-appear",
    );
    const importMs = Date.now() - t0;
    record(caseId, fixtureRel, "import_and_dataset_appear_ms", importMs, "ms", "click-to-dataset-row-appearing (real /api/parsers/upload path)");
    importedOk = true;
  } catch (e) {
    unmeasured(caseId, fixtureRel, "import_and_dataset_appear_ms", e.message);
  }

  if (!importedOk) return { importedOk: false };

  const stageTab = await page.evaluate(() => window.__qz.useApp.getState().stageTab);
  record(caseId, fixtureRel, "auto_routed_to_map_tab", stageTab === "map", "boolean", `stageTab="${stageTab}" after import (lib/stagetab.ts nextStageTab — a 2-D XRDML should auto-route to "map" with no click)`);

  let paintMs = null;
  try {
    paintMs = await withDeadline(() => waitForCanvasPaint(page, 180000), 180000, "first map canvas paint");
    record(caseId, fixtureRel, "time_to_first_map_paint_ms", paintMs, "ms", "dataset-appeared mark to first painted canvas pixels (MapStage's Canvas2D heatmap)");
    record(caseId, fixtureRel, "total_import_to_map_visible_ms", Date.now() - t0, "ms", "click-to-visible-map, end to end");
  } catch (e) {
    unmeasured(caseId, fixtureRel, "time_to_first_map_paint_ms", e.message);
  }

  // mapCalls is populated by a `page.on("response", ...)` listener the caller
  // installed BEFORE navigation — not a race against a single waitForResponse
  // (which observed zero matches in an earlier run: the fetch either hadn't
  // fired yet when the promise resolved via the paint-timeout path, or fired
  // more than once before this code reached it). Recording every call also
  // answers whether the multi-second paint times below are one slow regrid
  // or a re-fetch storm.
  record(
    caseId,
    fixtureRel,
    "map_api_call_count",
    mapCalls.length,
    "calls",
    mapCalls.length > 1
      ? `re-fetched ${mapCalls.length} times before settling — gaps(ms)=${JSON.stringify(mapCalls.slice(1).map((c, i) => c.t - mapCalls[i].t))}`
      : "single call, as expected",
  );
  if (mapCalls.length > 0) {
    const last = mapCalls[mapCalls.length - 1];
    const body = last.body;
    const nx = body?.x_axis?.length ?? null;
    const ny = body?.y_axis?.length ?? null;
    record(
      caseId,
      fixtureRel,
      "regrid_output_resolution",
      nx != null && ny != null ? `${nx}x${ny}` : null,
      "cells",
      `last /api/plot/map response's grid (status=${last.status}) — the DISPLAYED resolution regardless of source point count (default store.mapRes=200, method="linear"; the Inspector's "2-D map" card only offers 100/200/400 — see the ui_resolution_cap finding)`,
    );
  } else {
    unmeasured(caseId, fixtureRel, "regrid_output_resolution", "no /api/plot/map response observed at all — see fetchMap's client-fallback note on the paint-time finding");
  }

  return { importedOk: true };
}

async function runOneMapSize(browser, n) {
  const CASE = `M1-${n}`;
  const fixtureRel = `tools/baselines/out/large_rsm_map_${n}.xrdml`;
  const fixturePath = join(LARGE_DIR, `large_rsm_map_${n}.xrdml`);
  if (!existsSync(fixturePath)) {
    unmeasured(CASE, fixtureRel, "import_and_dataset_appear_ms", `fixture missing — run: uv run python tools/baselines/make_map_fixtures.py`);
    return;
  }

  const { context, page, cdp } = await newInstrumentedPage(browser);
  // Instrument every /api/plot/map round trip (not just the first) — the
  // paint-time numbers below are unexpectedly large (tens of seconds), so
  // this settles whether it's ONE slow regrid call or a re-fetch storm.
  // Route INTERCEPTION (route.fetch() + route.fulfill()), not
  // page.on("response") + response.json(): the latter reads the body via a
  // live CDP inspector-cache lookup that reliably came back "evicted" here
  // even when read synchronously inside the listener — route.fetch() has
  // Playwright perform the request itself and hand back a Response whose
  // body it already holds, no eviction race.
  const mapCalls = [];
  await page.route("**/api/plot/map", async (route) => {
    const t = Date.now();
    // Playwright's route.fetch() default timeout (30s) is shorter than a
    // real regrid at this scale (measured up to ~150s+ at 2000^2 — see
    // tools/baselines/measure_map_regrid.py) — without an explicit timeout
    // this throws INSIDE an async route handler, which Node reports as an
    // unhandled rejection (discovered the hard way: a "harness crash" on the
    // 1000^2 case that was actually just this default).
    const response = await route.fetch({ timeout: 300000 });
    const body = await response.json().catch((e) => ({ __error: e.message }));
    mapCalls.push({ t, status: response.status(), body });
    await route.fulfill({ response });
  });
  await gotoHarness(page, BASE_URL);
  const heapBefore = await jsHeapUsed(cdp);

  const { importedOk } = await importAndCapture(page, fixturePath, CASE, fixtureRel, mapCalls);
  if (!importedOk) {
    unmeasured(CASE, fixtureRel, "interaction_latency_ms", "blocked — import/paint failed");
    await context.close().catch(() => {});
    return;
  }

  const heapAfter = await jsHeapUsed(cdp);
  record(CASE, fixtureRel, "js_heap_used_bytes", heapAfter, "bytes", `before_import=${heapBefore}`);

  // ---- Interaction 1: hover/readout latency (MapStage has NO pan/zoom — a
  // static full-extent heatmap; hover-to-readout is the closest analog to
  // F1/F3's pan gesture that exists on this view). ----------------------------
  try {
    const hoverLatencies = await withDeadline(
      () => measureHoverLatencies(page, ".qzk-stage canvas", 10),
      30000,
      "map hover/readout gesture",
    );
    record(CASE, fixtureRel, "hover_latency_median_ms", median(hoverLatencies), "ms", `n=10 samples=${JSON.stringify(hoverLatencies)} — MapStage has no pan/zoom (static full-extent render); this is the closest input->next-paint analog (readout label update)`);
    record(CASE, fixtureRel, "hover_latency_p95_ms", p95(hoverLatencies), "ms", "target: <100ms (P0.4 acceptance, applied here by analogy)");
  } catch (e) {
    unmeasured(CASE, fixtureRel, "hover_latency_ms", e.message);
  }

  // ---- Interaction 2: "slice-drag" — the segment-cut tool (drag a line
  // across the map -> backend linescan -> lands as a new 1-D dataset). This
  // IS the map view's distinctive drag interaction; unlike hover it mutates
  // state (adds a dataset, flips stageTab to "plot"), so it runs LAST and
  // once, not looped like pan/zoom. -------------------------------------------
  try {
    const segBtn = page.locator('.qzk-tool-btn[title^="Segment cut"]');
    if ((await segBtn.count()) === 0) {
      unmeasured(CASE, fixtureRel, "slice_drag_latency_ms", "segment-cut tool button not present (cutSpace gating failed — unexpected for a 2Theta/Omega/Intensity XRDML mesh)");
    } else {
      await segBtn.click();
      const canvasBox = await page.locator(".qzk-stage canvas").first().boundingBox();
      if (!canvasBox) throw new Error("no bounding box for the map canvas");
      const ax = canvasBox.x + canvasBox.width * 0.3;
      const ay = canvasBox.y + canvasBox.height * 0.5;
      const bx = canvasBox.x + canvasBox.width * 0.7;
      const by = canvasBox.y + canvasBox.height * 0.5;
      const dsCountBefore = await page.evaluate(() => window.__qz.useApp.getState().datasets.length);
      const t0 = Date.now();
      await page.mouse.move(ax, ay);
      await page.mouse.down();
      await page.mouse.move((ax + bx) / 2, (ay + by) / 2);
      await page.mouse.move(bx, by);
      await page.mouse.up();
      await withDeadline(
        () => waitForCountAtLeast(page, "[data-ds-id]", dsCountBefore + 1, 60000),
        60000,
        "segment-cut result dataset landing",
      );
      const dragMs = Date.now() - t0;
      record(CASE, fixtureRel, "slice_drag_latency_ms", dragMs, "ms", "mousedown+drag+mouseup -> real /api/rsm/cut-segment call -> new 1-D linescan dataset landed (single sample — the gesture mutates state, so it isn't repeated like pan/zoom)");
    }
  } catch (e) {
    unmeasured(CASE, fixtureRel, "slice_drag_latency_ms", e.message);
  }

  // ---- Escape-hatch resolution test (2000^2 source only, to bound total
  // runtime): the UI's Inspector dropdown only offers 100/200/400, but the
  // backend route (routes/plot.py's MapRequest) accepts nx/ny up to 2000.
  // setMapRes IS a plain store action (like F2/F4/F5's createWindow etc.) —
  // reached here via the store directly because no UI control can express
  // it, exactly the documented exception for actions with no simpler UI
  // hook. --------------------------------------------------------------------
  if (n === 2000) {
    try {
      const countBefore = mapCalls.length;
      const t0 = Date.now();
      await page.evaluate(() => window.__qz.useApp.getState().setMapRes(2000));
      await withDeadline(
        async () => {
          for (;;) {
            if (mapCalls.length > countBefore) return;
            await new Promise((r) => setTimeout(r, 100));
          }
        },
        180000,
        "escape-hatch res=2000 /api/plot/map response",
      );
      const elapsed = Date.now() - t0;
      const body = mapCalls[mapCalls.length - 1].body;
      const nx = body?.x_axis?.length ?? null;
      const ny = body?.y_axis?.length ?? null;
      record(
        CASE,
        fixtureRel,
        "escape_hatch_res2000_response_ms",
        elapsed,
        "ms",
        `setMapRes(2000) via store action (UI dropdown caps at 400) -> /api/plot/map regrid at nx=${nx} ny=${ny} — worst-case regrid the UI can never reach through its own controls`,
      );
    } catch (e) {
      unmeasured(CASE, fixtureRel, "escape_hatch_res2000_response_ms", e.message);
    }
  }

  await context.close().catch(() => {});
}

// ---- crash safety -------------------------------------------------------
//
// The 2000^2 fixture (4,000,000 scattered points, 5 channels) round-trips a
// JSON DataStruct large enough (import response, and again on every
// `/api/plot/map` regrid POST) to overflow Playwright's own CDP pipe
// transport: `PipeTransport._dispatch`'s `Buffer.toString()` throws
// `ERR_STRING_TOO_LONG` on a single relayed message once it nears V8's
// ~512 MB string ceiling — an uncaught exception OUTSIDE any promise this
// script awaits (it fires from the transport's raw 'data' stream handler),
// so a plain try/catch around `runOneMapSize` cannot see it. This is itself
// P0.4 evidence: no cap/downsample exists anywhere in the import or map
// pipeline, and at this scale the payload is large enough to break standard
// browser-automation tooling, not just be slow. Guard so ONE size's crash
// can't discard the sizes that already succeeded.
let currentCase = "M1";
let currentFixture = "(none in flight)";

async function flushResults(startedAt, hardware) {
  const out = {
    plan_item: "PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 FINAL residual M1 — browser-side 2-D map rendering/interaction at 500^2/1000^2/2000^2",
    generated: startedAt,
    hardware,
    results,
  };
  await writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
}

// ---- main -------------------------------------------------------------------

async function main() {
  await mkdir(dirname(OUT_JSON), { recursive: true });
  const startedAt = new Date().toISOString();
  let hardwareRef = null;

  const crashGuard = async (err) => {
    const msg = err instanceof Error ? `${err.message}` : String(err);
    console.error(`\n[CRASH] uncaught error during ${currentCase} (${currentFixture}): ${msg}`);
    unmeasured(currentCase, currentFixture, "harness_crash", `Node-level crash (likely Playwright CDP transport overflow on an oversized message) — measurements up to this point are preserved below: ${msg}`);
    try {
      await flushResults(startedAt, hardwareRef);
      console.error(`[CRASH] partial results (${results.length} rows) flushed to ${OUT_JSON}`);
    } catch (e2) {
      console.error(`[CRASH] failed to flush partial results: ${e2.message}`);
    }
    // Best-effort: the crashed pipe leaves an orphaned chromium process this
    // script's normal browser.close()/killTree paths can no longer reach.
    if (process.platform === "win32") {
      spawn("taskkill", ["/IM", "chrome.exe", "/F", "/T"], { stdio: "ignore" }).on("error", () => {});
    }
    process.exit(1);
  };
  process.on("uncaughtException", crashGuard);
  process.on("unhandledRejection", crashGuard);

  console.log(`[setup] starting backend on :${PORT} …`);
  const backend = spawn("uv", ["run", "--no-sync", "qz", "--no-browser", "--port", String(PORT)], {
    cwd: REPO_ROOT,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const backendLogs = [];
  backend.stdout.on("data", (d) => backendLogs.push(d.toString()));
  backend.stderr.on("data", (d) => backendLogs.push(d.toString()));

  try {
    const up = await waitForServer(`${BASE_URL}/api/health`, 30000);
    if (!up) throw new Error(`backend did not come up on ${BASE_URL} within 30s:\n${backendLogs.join("")}`);

    await withIsolatedBrowser("hardware probe", async (browser) => {
      hardwareRef = hardwareInfo(browser.version(), await playwrightVersion());
    });

    // Static (code-derived, not live-timed) capability-cap finding — recorded
    // once, not per-size, since it's the same fact at every size.
    record(
      "M1",
      "frontend/src/components/Inspector/MapCard.tsx + routes/plot.py",
      "ui_resolution_cap",
      "100 | 200 | 400 (default 200)",
      "options",
      "The Inspector's 2-D map Resolution <select> hardcodes RESOLUTIONS=[100,200,400] — a source map's raw point count (500^2=250k, 1000^2=1M, 2000^2=4M) is ALWAYS regridded down to at most a 400x400 display grid through the UI. The backend route itself (MapRequest.nx/ny) accepts 2..2000 — see escape_hatch_res2000_response_ms for what the UI can never reach through its own controls.",
    );

    for (const n of SIZES) {
      currentCase = `M1-${n}`;
      currentFixture = `tools/baselines/out/large_rsm_map_${n}.xrdml`;
      await withIsolatedBrowser(`M1-${n} — 2-D map at ${n}x${n}`, (browser) => runOneMapSize(browser, n));
      await flushResults(startedAt, hardwareRef); // progressive — one crashed size can't discard the rest
    }
  } finally {
    console.log("[teardown] stopping backend …");
    await killTree(backend);
    process.off("uncaughtException", crashGuard);
    process.off("unhandledRejection", crashGuard);
  }

  await flushResults(startedAt, hardwareRef);
  console.log(`\nwrote ${results.length} result row(s) -> ${OUT_JSON}`);
  const unmeasuredCount = results.filter((r) => r.status === "unmeasured").length;
  if (unmeasuredCount > 0) console.log(`  (${unmeasuredCount} row(s) unmeasured — see notes)`);
}

async function playwrightVersion() {
  try {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, "tools", "bench", "node_modules", "playwright", "package.json"), "utf8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
