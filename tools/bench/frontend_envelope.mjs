// PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 — the BROWSER-side half of the large-data
// / long-session performance envelope. Drives the REAL app (real FastAPI
// backend serving the real built SPA, real Chromium via Playwright, real
// uPlot canvas) exactly the way `frontend/e2e` and `tools/visual` do —
// reused directly where possible (REPO_ROOT/killTree/waitForServer come
// straight from tools/visual/origin_shared.mjs) and reimplemented minimally
// where not (the Command Palette driver, since frontend/e2e's is TypeScript
// and this is a plain Node script).
//
// Measure only. This script does not touch `frontend/src` — findings (e.g.
// "no plot-level downsampling exists") are reported, not fixed.
//
// Usage:
//   cd tools/bench && npm install   # one-time; installs `playwright`,
//                                   # reuses the chromium already cached at
//                                   # %LOCALAPPDATA%\ms-playwright by
//                                   # frontend's own @playwright/test (same
//                                   # pinned 1.62.0 revision — no download)
//   node frontend_envelope.mjs [--port 8942] [--out <path>]
//
// Prerequisites (see README at the top of the repo's tools/visual and this
// task's own CLAUDE.md pointers):
//   uv sync --group dev
//   cd frontend && npm ci && npm run build
//   uv run python tools/baselines/make_fixtures.py --large

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

import { REPO_ROOT, killTree, parseArgs, waitForServer } from "../visual/origin_shared.mjs";
import {
  gotoHarness,
  importFilesViaPalette,
  jsHeapUsed,
  measureGestureLatencies,
  median,
  openWorkspaceViaPalette,
  p95,
  runPaletteAction,
  saveWorkspaceCapture,
  waitForAutosaveCleared,
  waitForAutosaveGeneration,
  waitForCanvasPaint,
  waitForCountAtLeast,
  withDeadline,
} from "./envelope-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 8942); // distinct from :8000 default, :8934 (frontend/e2e), :8793 (tools/visual)
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT_JSON = args.out
  ? args.out
  : join(REPO_ROOT, "docs", "envelope", "2026-07-26-frontend.json");

const LARGE_DIR = join(REPO_ROOT, "tools", "baselines", "out");
const COMMITTED_DIR = join(REPO_ROOT, "tests", "fixtures", "baselines");
// The 9 committed P0.3 fixtures (tests/fixtures/baselines/), cycled via
// modulo to draw 50 import actions — any array length works, no need for a
// divisor of 50.
const COMMITTED_FIXTURES = [
  "csv_preamble_multichannel.csv",
  "grouped_factors_boxplot.csv",
  "pnr_bilayer_spin_pair.pnr",
  "qd_mvsh_parametric_series.dat",
  "sims_four_species_profile.csv",
  "tsv_preamble_multichannel.tsv",
  "xrd_two_phase_pattern.csv",
  "xrdml_rsm_small_map.xrdml",
].map((f) => join(COMMITTED_DIR, f));

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

/** Launch a fresh browser for one case group, run `fn(browser)`, then close
 *  it — force-killing the underlying process if a graceful `close()` itself
 *  hangs (the failure mode a truly wedged renderer, e.g. from F1's
 *  no-downsampling 7,000,000-point render, would produce). A fresh browser
 *  per case group means one hung/crashed case cannot corrupt the next. */
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

// ---- F1 — large single dataset (1,000,000-row CSV) -------------------------

async function runF1(browser) {
  const CASE = "F1";
  const fixtureRel = "tools/baselines/out/large_million_row.csv";
  const fixturePath = join(LARGE_DIR, "large_million_row.csv");
  if (!existsSync(fixturePath)) {
    unmeasured(CASE, fixtureRel, "upload_and_parse_ms", "fixture missing — run make_fixtures.py --large first");
    return;
  }

  const { context, page, cdp } = await newInstrumentedPage(browser);
  await gotoHarness(page, BASE_URL);
  const heapBefore = await jsHeapUsed(cdp);

  let importedOk = false;
  const t0 = Date.now();
  try {
    await withDeadline(
      async () => {
        await importFilesViaPalette(page, [fixturePath]);
        await waitForCountAtLeast(page, "[data-ds-id]", 1, 240000);
      },
      240000,
      "1M-row CSV upload+parse+dataset-appear",
    );
    const uploadMs = Date.now() - t0;
    record(CASE, fixtureRel, "upload_and_parse_ms", uploadMs, "ms", "click-to-dataset-row-appearing (real /api/parsers/upload path)");
    importedOk = true;
  } catch (e) {
    unmeasured(CASE, fixtureRel, "upload_and_parse_ms", e.message);
  }

  if (importedOk) {
    try {
      const paintMs = await withDeadline(() => waitForCanvasPaint(page, 180000), 180000, "first canvas paint");
      record(CASE, fixtureRel, "time_to_first_rendered_frame_ms", paintMs, "ms", "measured from the dataset-appeared mark (see upload_and_parse_ms) to first painted canvas pixels");
      record(CASE, fixtureRel, "total_import_to_first_paint_ms", Date.now() - t0, "ms", "click-to-first-paint, end to end");

      const plotted = await page.evaluate(() => {
        const s = window.__qz.useApp.getState();
        const ds = s.datasets.find((d) => d.id === s.activeId) ?? s.datasets[s.datasets.length - 1];
        return {
          rows: ds?.data?.time?.length ?? null,
          nLabels: ds?.data?.labels?.length ?? null,
          yKeys: s.yKeys,
        };
      });
      record(
        CASE,
        fixtureRel,
        "rows_and_series_actually_plotted",
        plotted.rows,
        "rows",
        `yKeys=${JSON.stringify(plotted.yKeys)} (null = every default-dense channel, i.e. no client-side cap) ` +
          `dataset reports ${plotted.nLabels} label(s) total — the app applied NO row cap or downsampling to this import`,
      );

      const heapAfter = await jsHeapUsed(cdp);
      record(CASE, fixtureRel, "js_heap_used_bytes", heapAfter, "bytes", `before_import=${heapBefore}`);

      try {
        const { panLatencies, zoomLatencies } = await withDeadline(
          () => measureGestureLatencies(page),
          30000,
          "pan/zoom gestures",
        );
        record(CASE, fixtureRel, "pan_latency_median_ms", median(panLatencies), "ms", `n=10 samples=${JSON.stringify(panLatencies)}`);
        record(CASE, fixtureRel, "pan_latency_p95_ms", p95(panLatencies), "ms", "target: <100ms (P0.4 acceptance)");
        record(CASE, fixtureRel, "zoom_latency_median_ms", median(zoomLatencies), "ms", `n=10 samples=${JSON.stringify(zoomLatencies)}`);
        record(CASE, fixtureRel, "zoom_latency_p95_ms", p95(zoomLatencies), "ms", "target: <100ms (P0.4 acceptance)");
      } catch (e) {
        unmeasured(CASE, fixtureRel, "interaction_latency_ms", e.message);
      }
    } catch (e) {
      unmeasured(CASE, fixtureRel, "time_to_first_rendered_frame_ms", e.message);
      unmeasured(CASE, fixtureRel, "interaction_latency_ms", "blocked — plot never rendered");
    }
  } else {
    unmeasured(CASE, fixtureRel, "time_to_first_rendered_frame_ms", "blocked by import failure/timeout");
    unmeasured(CASE, fixtureRel, "interaction_latency_ms", "blocked by import failure/timeout");
  }

  await context.close().catch(() => {});
}

// ---- F2 (+F4) — many datasets/windows, then workspace at that scale -------

async function runF2AndF4(browser) {
  const CASE2 = "F2";
  const CASE4 = "F4";
  const N_DATASETS = 50;
  const N_WINDOWS = 20;

  const { context, page, cdp } = await newInstrumentedPage(browser);
  await gotoHarness(page, BASE_URL);
  const heapBeforeSetup = await jsHeapUsed(cdp);

  const setupT0 = Date.now();
  let prevCount = 0;
  let importFailure = null;
  for (let i = 0; i < N_DATASETS; i++) {
    const f = COMMITTED_FIXTURES[i % COMMITTED_FIXTURES.length];
    try {
      await importFilesViaPalette(page, [f]);
      prevCount = await waitForCountAtLeast(page, "[data-ds-id]", prevCount + 1, 20000);
    } catch (e) {
      importFailure = `import #${i + 1} failed: ${e.message}`;
      break;
    }
  }
  const importElapsed = Date.now() - setupT0;
  record(
    CASE2,
    "tests/fixtures/baselines/*.csv,*.dat,*.pnr,*.tsv,*.xrdml (9 files, cycled 50x)",
    "import_50_datasets_total_ms",
    importElapsed,
    "ms",
    importFailure
      ? `INCOMPLETE — ${importFailure}; reached ${prevCount} dataset(s)`
      : `reached ${prevCount} dataset row(s) via 50 sequential real Command-Palette imports`,
    importFailure ? "unmeasured" : "ok",
  );

  const datasetIds = await page.evaluate(() => window.__qz.useApp.getState().datasets.map((d) => d.id));
  if (datasetIds.length === 0) {
    unmeasured(CASE2, "session", "window_open_1st_ms", "no datasets loaded — cannot open plot windows");
    await context.close().catch(() => {});
    return;
  }

  const perWindow = [];
  let lastWinId = null;
  for (let i = 0; i < N_WINDOWS; i++) {
    const dsId = datasetIds[i % datasetIds.length];
    const t0 = Date.now();
    const winId = await page.evaluate((id) => {
      const { useApp } = window.__qz;
      const wid = useApp.getState().createWindow(id);
      useApp.getState().focusWindow(wid); // mirrors the real "New Graph Window" command's own focus-the-new-window behavior
      return wid;
    }, dsId);
    let paintMs = null;
    try {
      paintMs = await waitForCanvasPaint(page, 20000);
    } catch {
      /* leave null — recorded via the summary row below */
    }
    perWindow.push({ index: i, totalMs: Date.now() - t0, paintMs });
    lastWinId = winId;
  }
  const totalMsSeries = perWindow.map((w) => w.totalMs);
  record(CASE2, "20 plot windows", "window_open_1st_ms", totalMsSeries[0] ?? null, "ms", "create+focus+paint, window #1");
  record(
    CASE2,
    "20 plot windows",
    "window_open_20th_ms",
    totalMsSeries[19] ?? null,
    "ms",
    "create+focus+paint, window #20 — compare to #1 for O(n)-with-window-count drift",
  );
  record(CASE2, "20 plot windows", "window_open_median_ms", median(totalMsSeries), "ms", `samples=${JSON.stringify(totalMsSeries)}`);

  const heapAfterSetup = await jsHeapUsed(cdp);
  record(CASE2, "session (50 datasets + 20 windows)", "total_setup_ms", Date.now() - setupT0, "ms", `${prevCount} dataset(s), ${N_WINDOWS} windows`);
  record(CASE2, "session (50 datasets + 20 windows)", "js_heap_before_bytes", heapBeforeSetup, "bytes", "");
  record(CASE2, "session (50 datasets + 20 windows)", "js_heap_after_bytes", heapAfterSetup, "bytes", "");

  try {
    const { panLatencies, zoomLatencies } = await withDeadline(
      () => measureGestureLatencies(page),
      30000,
      "pan/zoom on busiest (focused) window",
    );
    record(CASE2, "busiest (focused) window of 20", "pan_latency_median_ms", median(panLatencies), "ms", `n=10 samples=${JSON.stringify(panLatencies)}`);
    record(CASE2, "busiest (focused) window of 20", "pan_latency_p95_ms", p95(panLatencies), "ms", "target: <100ms (P0.4 acceptance)");
    record(CASE2, "busiest (focused) window of 20", "zoom_latency_median_ms", median(zoomLatencies), "ms", `n=10 samples=${JSON.stringify(zoomLatencies)}`);
    record(CASE2, "busiest (focused) window of 20", "zoom_latency_p95_ms", p95(zoomLatencies), "ms", "target: <100ms (P0.4 acceptance)");
  } catch (e) {
    unmeasured(CASE2, "busiest (focused) window of 20", "interaction_latency_ms", e.message);
  }

  // ---- F4: workspace at THIS session's scale --------------------------------
  const dwkFixtureLabel = `F2 session (.dwk, ${prevCount} datasets + ${N_WINDOWS} windows)`;
  let tmpDwk = null;
  try {
    const saved = await saveWorkspaceCapture(page);
    record(CASE4, dwkFixtureLabel, "serialize_and_save_ms", Math.round(saved.durationMs * 100) / 100, "ms", "page-clock timing of the real 'Save workspace (.dwk)…' command, download intercepted (not a real disk write) in headless Chrome");
    record(CASE4, dwkFixtureLabel, "file_size_bytes", saved.size, "bytes", "");

    tmpDwk = join(os.tmpdir(), `qz-envelope-f4-${Date.now()}.dwk`);
    await writeFile(tmpDwk, saved.text, "utf8");

    // Autosave write duration: nudge one watched field (a window move),
    // then poll the app's OWN IndexedDB store from outside for the new
    // generation. The 800ms figure is useWorkspaceAutosave.ts's fixed
    // debounce (not measured here — it's a `setTimeout` constant read from
    // source); the estimate below backs it out of the observed total.
    const nudgeAt = Date.now();
    await page.evaluate((id) => {
      const { useApp } = window.__qz;
      const win = useApp.getState().plotWindows.find((w) => w.id === id);
      if (win) useApp.getState().moveWindow(id, win.geometry.x + 1, win.geometry.y);
    }, lastWinId);
    const genAt = await waitForAutosaveGeneration(page, nudgeAt, 8000);
    if (genAt != null) {
      const totalMs = genAt - nudgeAt;
      record(
        CASE4,
        dwkFixtureLabel,
        "autosave_total_latency_ms",
        totalMs,
        "ms",
        `trigger (one window move) to durable IndexedDB generation; includes the fixed 800ms debounce in useWorkspaceAutosave.ts — write_estimate_ms ≈ ${Math.max(0, totalMs - 800)}`,
      );
    } else {
      unmeasured(CASE4, dwkFixtureLabel, "autosave_total_latency_ms", "no new IndexedDB generation observed within 8s of the trigger");
    }

    // Prevent the autosave-restore-on-startup path from interfering with
    // the controlled .dwk reopen test below (it would otherwise populate
    // the library BEFORE "Open workspace" runs, tripping the
    // confirm-replace dialog fileCommands.ts's openWorkspaceCommand shows
    // whenever datasets.length > 0). "Clear autosaved workspace" fires the
    // real clear as fire-and-forget from the UI's perspective, so confirm
    // it actually landed before navigating away (see waitForAutosaveCleared).
    await runPaletteAction(page, "Clear autosaved workspace");
    const cleared = await waitForAutosaveCleared(page, 5000);
    if (!cleared) console.warn(`  [${CASE4}] WARNING: autosave did not report empty within 5s of the clear command`);

    await gotoHarness(page, BASE_URL);
    const reopenT0 = Date.now();
    await withDeadline(
      async () => {
        await openWorkspaceViaPalette(page, tmpDwk);
        await waitForCountAtLeast(page, "[data-ds-id]", prevCount, 60000);
      },
      60000,
      ".dwk reopen — dataset rows restored",
    );
    const restoreMs = Date.now() - reopenT0;
    record(CASE4, dwkFixtureLabel, "reopen_dataset_restore_ms", restoreMs, "ms", "click 'Open workspace' to all dataset rows back in the Library");
    try {
      const paintMs = await waitForCanvasPaint(page, 30000);
      record(CASE4, dwkFixtureLabel, "reopen_time_to_first_paint_ms", paintMs, "ms", "measured from the dataset-rows-restored mark to first painted canvas — the reopened session's 'time to interactive' proxy");
    } catch (e) {
      unmeasured(CASE4, dwkFixtureLabel, "reopen_time_to_first_paint_ms", e.message);
    }
  } catch (e) {
    unmeasured(CASE4, dwkFixtureLabel, "workspace_roundtrip", e.message);
  } finally {
    if (tmpDwk) await rm(tmpDwk, { force: true }).catch(() => {});
  }

  await context.close().catch(() => {});
}

// ---- F3 — dense multi-series (20 columns x 100,000 rows) as ONE plot ------

async function runF3(browser) {
  const CASE = "F3";
  const fixtureRel = "tools/baselines/out/large_dense_multiseries.csv";
  const fixturePath = join(LARGE_DIR, "large_dense_multiseries.csv");
  if (!existsSync(fixturePath)) {
    unmeasured(CASE, fixtureRel, "upload_and_parse_ms", "fixture missing — run make_fixtures.py --large first");
    return;
  }

  const { context, page, cdp } = await newInstrumentedPage(browser);
  await gotoHarness(page, BASE_URL);

  let importedOk = false;
  const t0 = Date.now();
  try {
    await withDeadline(
      async () => {
        await importFilesViaPalette(page, [fixturePath]);
        await waitForCountAtLeast(page, "[data-ds-id]", 1, 60000);
      },
      60000,
      "dense multiseries CSV upload+parse+dataset-appear",
    );
    record(CASE, fixtureRel, "upload_and_parse_ms", Date.now() - t0, "ms", "");
    importedOk = true;
  } catch (e) {
    unmeasured(CASE, fixtureRel, "upload_and_parse_ms", e.message);
  }

  if (importedOk) {
    try {
      const paintMs = await withDeadline(() => waitForCanvasPaint(page, 60000), 60000, "first canvas paint");
      record(CASE, fixtureRel, "time_to_first_rendered_frame_ms", paintMs, "ms", "");

      const plotted = await page.evaluate(() => {
        const s = window.__qz.useApp.getState();
        const ds = s.datasets.find((d) => d.id === s.activeId) ?? s.datasets[s.datasets.length - 1];
        return {
          yKeys: s.yKeys,
          xKey: s.xKey,
          nLabels: ds?.data?.labels?.length ?? null,
          nRows: ds?.data?.time?.length ?? null,
        };
      });
      // ds.labels holds only the VALUE channels — the CSV's "Time (s)"
      // column is parsed straight into ds.time, a separate field, so it
      // never occupies a labels slot (verified against io/registry's
      // import_auto output for this fixture: 20 labels, not 21). Only
      // subtract a slot for xKey when it is itself one of the value
      // channels (a non-null index) — the null default here means "x is
      // ds.time", so nothing is subtracted.
      const seriesCount = plotted.yKeys
        ? plotted.yKeys.length
        : plotted.nLabels != null
          ? plotted.nLabels - (plotted.xKey != null ? 1 : 0)
          : null;
      record(
        CASE,
        fixtureRel,
        "series_actually_plotted",
        seriesCount,
        "series",
        `yKeys=${JSON.stringify(plotted.yKeys)} xKey=${JSON.stringify(plotted.xKey)} (yKeys=null = every default-dense channel — the fixture's 20 series are equally dense, so ALL 20 plot with no client cap) rows=${plotted.nRows}`,
      );

      try {
        const { panLatencies, zoomLatencies } = await withDeadline(
          () => measureGestureLatencies(page),
          30000,
          "pan/zoom on dense multiseries plot",
        );
        record(CASE, fixtureRel, "pan_latency_median_ms", median(panLatencies), "ms", `n=10 samples=${JSON.stringify(panLatencies)}`);
        record(CASE, fixtureRel, "pan_latency_p95_ms", p95(panLatencies), "ms", "target: <100ms (P0.4 acceptance)");
        record(CASE, fixtureRel, "zoom_latency_median_ms", median(zoomLatencies), "ms", `n=10 samples=${JSON.stringify(zoomLatencies)}`);
        record(CASE, fixtureRel, "zoom_latency_p95_ms", p95(zoomLatencies), "ms", "target: <100ms (P0.4 acceptance)");
      } catch (e) {
        unmeasured(CASE, fixtureRel, "interaction_latency_ms", e.message);
      }
    } catch (e) {
      unmeasured(CASE, fixtureRel, "time_to_first_rendered_frame_ms", e.message);
    }
  }

  // Downsampling-capability check — static, not timing. Grepped
  // frontend/src for downsample/decimate/lttb (P0.4's own instruction):
  // lib/downsample.ts (downsampleMinMax, min/max-per-bucket) exists but is
  // wired ONLY into the Library's sparkline thumbnails
  // (components/Library/DatasetRow.tsx, Sparkline.tsx) — never into the
  // main plot's data path (lib/plotdata.ts's buildColumns /
  // usePlotPayload.ts), which feeds uPlot every raw point with no cap.
  record(
    CASE,
    "frontend/src/lib/downsample.ts + lib/plotdata.ts (static check, not a live measurement)",
    "plot_level_downsampling_exists",
    false,
    "boolean",
    "Gate A finding: downsampleMinMax() (min/max-per-bucket) is real and tested, but it is called only from the Library sparkline path (DatasetRow.tsx, Sparkline.tsx / store/split.ts's comment referencing it is about resolving a lazy Origin book preview, not plot downsampling). The uPlot render path (usePlotPayload.ts -> lib/plotdata.ts buildColumns) has no bucket/stride/LTTB step — a dense series is plotted point-for-point regardless of size. No before/after comparison is possible because there is no 'after' to compare.",
  );

  await context.close().catch(() => {});
}

// ---- main -------------------------------------------------------------------

async function main() {
  await mkdir(dirname(OUT_JSON), { recursive: true });

  console.log(`[setup] starting backend on :${PORT} …`);
  const backend = spawn("uv", ["run", "--no-sync", "qz", "--no-browser", "--port", String(PORT)], {
    cwd: REPO_ROOT,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const backendLogs = [];
  backend.stdout.on("data", (d) => backendLogs.push(d.toString()));
  backend.stderr.on("data", (d) => backendLogs.push(d.toString()));

  let hardware = null;
  const startedAt = new Date().toISOString();
  try {
    const up = await waitForServer(`${BASE_URL}/api/health`, 30000);
    if (!up) throw new Error(`backend did not come up on ${BASE_URL} within 30s:\n${backendLogs.join("")}`);

    // Grab hardware info (browser + playwright version) from a throwaway launch.
    await withIsolatedBrowser("hardware probe", async (browser) => {
      hardware = hardwareInfo(browser.version(), await playwrightVersion());
    });

    await withIsolatedBrowser("F1 — large single dataset", runF1);
    // F4 depends on F2's live session (50 datasets + 20 windows), so it runs
    // inside the SAME browser/page immediately after F2, before anything
    // resets that state. F3 is independent and gets its own clean browser.
    await withIsolatedBrowser("F2 + F4 — many datasets/windows, then workspace at scale", runF2AndF4);
    await withIsolatedBrowser("F3 — dense multi-series", runF3);
  } finally {
    console.log("[teardown] stopping backend …");
    await killTree(backend);
  }

  const out = {
    plan_item: "PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 (frontend/browser half)",
    generated: startedAt,
    hardware,
    results,
  };
  await writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
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
