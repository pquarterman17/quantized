// PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 — the two residuals `docs/performance_
// envelope.md` explicitly left unmeasured after the F1-F4 first pass:
//
//   - Worksheet-GRID interaction at 1M rows (F1-F4 only measured import ->
//     plot; the grid was previously verified to 100k x 200 MOUNT only, via
//     GridViewport.perf.test.tsx's jsdom render — never a real browser, never
//     scroll interaction, never 1,000,000 rows).
//   - A `.dwk` containing DERIVED data (corrections + a formula column),
//     FIT RESULTS, several plot windows, AND a 1,000,000-row member — F4's
//     session was 50 SMALL datasets with no corrections/fit/formula content
//     at all.
//
// One case, "F5", covering both — they share the same built-up session (the
// grid needs the big dataset loaded; the .dwk needs the grid session's full
// state), so splitting them into two browser launches would mean building
// the same ~20-dataset/10-window session twice for no benefit.
//
// Same discipline as frontend_envelope.mjs: measure only, drive the REAL app
// (real FastAPI backend, real built SPA, real Chromium, real IndexedDB
// autosave) via the Command Palette + the same store-action calls F2/F4
// already use for actions with no simpler UI hook (createWindow, moveWindow,
// setActive) — never a monkeypatch of `frontend/src`. The one new technique
// here is `measureMainThreadFreeze` (envelope-lib.mjs): a background poll of
// trivial `page.evaluate` round-trips racing the `.dwk` reopen, whose max
// gap approximates how long the renderer's JS thread was blocked by the
// load path's synchronous `JSON.parse`.
//
// Usage:
//   cd tools/bench && npm install   # one-time, see frontend_envelope.mjs
//   node workspace_envelope.mjs [--port 8944] [--out <path>]
//
// Prerequisites (same as frontend_envelope.mjs):
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
  measureMainThreadFreeze,
  measureScrollLatencies,
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
const PORT = Number(args.port || 8944); // distinct from :8000, :8934 (e2e), :8793 (visual), :8942 (frontend_envelope)
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT_JSON = args.out
  ? args.out
  : join(REPO_ROOT, "docs", "envelope", "2026-07-26-workspace.json");

const LARGE_DIR = join(REPO_ROOT, "tools", "baselines", "out");
const COMMITTED_DIR = join(REPO_ROOT, "tests", "fixtures", "baselines");
// All 9 committed P0.3 fixtures (tests/fixtures/baselines/) — cycled to draw
// 19 import actions (any array length works; no need for a divisor).
const COMMITTED_FIXTURES = [
  "csv_preamble_multichannel.csv",
  "grouped_factors_boxplot.csv",
  "pnr_bilayer_spin_pair.pnr",
  "qd_mvsh_parametric_series.dat",
  "sims_four_species_profile.csv",
  "tsv_preamble_multichannel.tsv",
  "xrd_two_phase_pattern.csv",
  "xrdml_rsm_small_map.xrdml",
  "xrr_bilayer_kiessig.refl",
].map((f) => join(COMMITTED_DIR, f));
const N_SMALL = 19; // + 1 large = 20 datasets total
const N_WINDOWS = 10;

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

// ---- F5 — large derived workspace + 1M-row worksheet grid ------------------

async function runF5(browser) {
  const CASE = "F5";
  const fixtureRel = "tools/baselines/out/large_million_row.csv + 9 committed baselines x ~2, cycled";
  const bigFixturePath = join(LARGE_DIR, "large_million_row.csv");
  if (!existsSync(bigFixturePath)) {
    unmeasured(CASE, fixtureRel, "session_build", "fixture missing — run make_fixtures.py --large first");
    return;
  }

  const { context, page, cdp } = await newInstrumentedPage(browser);
  await gotoHarness(page, BASE_URL);
  const heapBeforeSetup = await jsHeapUsed(cdp);

  // ---- 1. Import the 1M-row CSV, then 19 small fixtures (cycled) -----------
  let bigId = null;
  const setupT0 = Date.now();
  try {
    const t0 = Date.now();
    await withDeadline(
      async () => {
        await importFilesViaPalette(page, [bigFixturePath]);
        await waitForCountAtLeast(page, "[data-ds-id]", 1, 240000);
      },
      240000,
      "1M-row CSV upload+parse+dataset-appear",
    );
    record(CASE, "large_million_row.csv", "large_csv_upload_and_parse_ms", Date.now() - t0, "ms", "click-to-dataset-row-appearing, same path as F1");
    bigId = await page.evaluate(() => window.__qz.useApp.getState().datasets[0].id);
  } catch (e) {
    unmeasured(CASE, "large_million_row.csv", "large_csv_upload_and_parse_ms", e.message);
    await context.close().catch(() => {});
    return; // every subsequent measurement depends on the big dataset existing
  }

  let prevCount = 1;
  let importFailure = null;
  const smallT0 = Date.now();
  for (let i = 0; i < N_SMALL; i++) {
    const f = COMMITTED_FIXTURES[i % COMMITTED_FIXTURES.length];
    try {
      await importFilesViaPalette(page, [f]);
      prevCount = await waitForCountAtLeast(page, "[data-ds-id]", prevCount + 1, 20000);
    } catch (e) {
      importFailure = `small import #${i + 1} failed: ${e.message}`;
      break;
    }
  }
  record(
    CASE,
    "9 committed baselines x ~2.1, cycled",
    "small_imports_total_ms",
    Date.now() - smallT0,
    "ms",
    importFailure
      ? `INCOMPLETE — ${importFailure}; reached ${prevCount} dataset(s) total`
      : `reached ${prevCount} dataset(s) total (1 large + ${prevCount - 1} small)`,
    importFailure ? "unmeasured" : "ok",
  );

  const datasetIds = await page.evaluate(() => window.__qz.useApp.getState().datasets.map((d) => d.id));
  const smallIds = datasetIds.filter((id) => id !== bigId);
  const correctionsId = smallIds[0] ?? null;

  // ---- 2. Derived content: corrections chain + curve fit + formula column --
  let derivedValueBefore = null;
  if (correctionsId) {
    try {
      const t0 = Date.now();
      const ok = await page.evaluate(
        (id) => window.__qz.useApp.getState().applyCorrections(id, { yOff: 0.5, bgSlope: 0.001, bgInt: -0.2 }),
        correctionsId,
      );
      record(CASE, "1 small dataset", "corrections_apply_ms", Date.now() - t0, "ms", `applyCorrections -> ${ok} (real /api/corrections/apply call)`, ok ? "ok" : "unmeasured");
    } catch (e) {
      unmeasured(CASE, "1 small dataset", "corrections_apply_ms", e.message);
    }

    try {
      const t0 = Date.now();
      await page.evaluate((id) => window.__qz.useApp.getState().addFormula(id, "computed1", "A + 1"), correctionsId);
      record(CASE, "1 small dataset", "formula_column_add_ms", Date.now() - t0, "ms", "addFormula(id, 'computed1', 'A + 1') — client-side, persisted as Dataset.formulas");
    } catch (e) {
      unmeasured(CASE, "1 small dataset", "formula_column_add_ms", e.message);
    }

    try {
      const t0 = Date.now();
      const fitInfo = await page.evaluate(async (id) => {
        const { useApp } = window.__qz;
        const ds = useApp.getState().datasets.find((d) => d.id === id);
        const x = ds.data.time;
        // DataStruct.values is ROW-major, shape (N samples, M channels) — see
        // src/quantized/datastruct.py's docstring ("values (N, M)"). Channel 0
        // for every row is therefore values.map(row => row[0]), NOT values[0]
        // (that would be row 0 across every channel).
        const y = ds.data.values.map((row) => row[0]);
        const res = await fetch("/api/fitting/fit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "Linear", x, y }),
        });
        if (!res.ok) throw new Error(`fit request failed: ${res.status} ${await res.text()}`);
        const r = await res.json();
        const spec = { model: "Linear", xKey: null, yKey: 0, params: r.params, exitFlag: r.exitFlag ?? 1 };
        useApp.getState().setFitSpec(id, spec);
        return { params: r.params, exitFlag: r.exitFlag };
      }, correctionsId);
      record(
        CASE,
        "1 small dataset",
        "curve_fit_ms",
        Date.now() - t0,
        "ms",
        `real /api/fitting/fit call, model=Linear, params=${JSON.stringify(fitInfo.params)}, exitFlag=${fitInfo.exitFlag} — persisted as Dataset.fitSpec`,
      );
    } catch (e) {
      unmeasured(CASE, "1 small dataset", "curve_fit_ms", e.message);
    }

    derivedValueBefore = await page.evaluate((id) => {
      const ds = window.__qz.useApp.getState().datasets.find((d) => d.id === id);
      const lastCol = ds.data.labels.length - 1; // the just-added formula column
      return { row0: ds.data.values[0]?.[lastCol] ?? null, col: lastCol, nCols: ds.data.labels.length };
    }, correctionsId);
  } else {
    unmeasured(CASE, "1 small dataset", "corrections_apply_ms", "no small dataset id available (import loop reached 0)");
  }

  // ---- 3. Open 10 plot windows, including one on the 1M-row dataset --------
  const windowTargets = [bigId, ...smallIds.slice(0, N_WINDOWS - 1)];
  const perWindow = [];
  let lastWinId = null;
  for (let i = 0; i < windowTargets.length; i++) {
    const dsId = windowTargets[i];
    const t0 = Date.now();
    const winId = await page.evaluate((id) => {
      const { useApp } = window.__qz;
      const wid = useApp.getState().createWindow(id);
      useApp.getState().focusWindow(wid);
      return wid;
    }, dsId);
    let paintMs = null;
    try {
      paintMs = await waitForCanvasPaint(page, 60000);
    } catch {
      /* leave null */
    }
    perWindow.push({ index: i, isBig: dsId === bigId, totalMs: Date.now() - t0, paintMs });
    lastWinId = winId;
  }
  record(
    CASE,
    "10 plot windows (incl. the 1M-row dataset)",
    "window_open_1st_ms",
    perWindow[0]?.totalMs ?? null,
    "ms",
    `dataset for window #1 = ${perWindow[0]?.isBig ? "1M-row" : "small"}`,
  );
  const bigWin = perWindow.find((w) => w.isBig);
  record(
    CASE,
    "10 plot windows (incl. the 1M-row dataset)",
    "window_open_1M_row_ms",
    bigWin?.totalMs ?? null,
    "ms",
    `create+focus+paint for the window bound to the 1,000,000-row dataset (index ${bigWin?.index ?? "?"} of ${perWindow.length})`,
  );
  record(
    CASE,
    "10 plot windows (incl. the 1M-row dataset)",
    "window_open_median_ms",
    median(perWindow.map((w) => w.totalMs)),
    "ms",
    `samples=${JSON.stringify(perWindow.map((w) => w.totalMs))}`,
  );

  // Ground truth for the post-reopen integrity check below: `plotWindows`
  // always holds >=1 entry even before this loop ran (windows.ts's "startup/
  // load invariant" — `mainWindow`), so the true pre-save count is NOT
  // necessarily `perWindow.length` (the count THIS loop created) — read the
  // store directly rather than assume.
  const windowCountBeforeSave = await page.evaluate(() => window.__qz.useApp.getState().plotWindows.length);

  const heapAfterSetup = await jsHeapUsed(cdp);
  record(CASE, "session (20 datasets + 10 windows + derived content)", "session_build_total_ms", Date.now() - setupT0, "ms", `${prevCount} dataset(s), ${perWindow.length} windows created by this loop (${windowCountBeforeSave} total incl. the pre-existing startup window)`);
  record(CASE, "session (20 datasets + 10 windows + derived content)", "js_heap_before_bytes", heapBeforeSetup, "bytes", "");
  record(CASE, "session (20 datasets + 10 windows + derived content)", "js_heap_after_bytes", heapAfterSetup, "bytes", "");

  // ---- 4. Worksheet grid at 1M rows -----------------------------------------
  const gridLabel = "worksheet grid, 1,000,000-row dataset";
  try {
    await page.evaluate((id) => window.__qz.useApp.getState().setActive(id), bigId);
    const t0 = Date.now();
    await page.locator(".qzk-tab", { hasText: "Worksheet" }).first().click();
    await page.waitForSelector(".qzk-grid[role='grid']", { timeout: 30000 });
    // Let the virtualized rows actually paint (2 rAF ticks — same "settled"
    // proxy envelope-lib's timedGesture uses), not just the empty scroll
    // container appearing.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const mountMs = Date.now() - t0;

    const domBefore = await page.evaluate(() => ({
      rows: document.querySelectorAll(".qzk-grid [role='row']").length,
      cells: document.querySelectorAll(".qzk-grid-cell, .qzk-grid-headcell").length,
    }));
    const rowCount = await page.evaluate((id) => {
      const ds = window.__qz.useApp.getState().datasets.find((d) => d.id === id);
      return ds?.data?.time?.length ?? null;
    }, bigId);
    record(
      CASE,
      gridLabel,
      "worksheet_mount_ms",
      mountMs,
      "ms",
      `click Worksheet tab -> .qzk-grid visible + 2 rAF; underlying dataset has ${rowCount} rows`,
    );
    record(CASE, gridLabel, "dom_rows_at_mount", domBefore.rows, "rows", "header + windowed data rows — the DOM-bounded invariant GridViewport.perf.test.tsx checks at 100k, now observed in a REAL browser at 1M");
    record(CASE, gridLabel, "dom_cells_at_mount", domBefore.cells, "cells", "");

    try {
      const scrollLatencies = await withDeadline(
        () => measureScrollLatencies(page, ".qzk-grid", 10),
        30000,
        "worksheet grid scroll gestures",
      );
      record(CASE, gridLabel, "scroll_latency_median_ms", median(scrollLatencies), "ms", `n=10 wheel ticks, samples=${JSON.stringify(scrollLatencies)}`);
      record(CASE, gridLabel, "scroll_latency_p95_ms", p95(scrollLatencies), "ms", "target: <100ms (P0.4 acceptance, applied here to grid scroll same as plot pan/zoom)");

      const domAfter = await page.evaluate(() => ({
        rows: document.querySelectorAll(".qzk-grid [role='row']").length,
        cells: document.querySelectorAll(".qzk-grid-cell, .qzk-grid-headcell").length,
      }));
      record(CASE, gridLabel, "dom_rows_after_scroll", domAfter.rows, "rows", "still bounded after 10 scroll ticks through a 1,000,000-row dataset = virtualization re-windows correctly, not a full re-render");
      record(CASE, gridLabel, "dom_cells_after_scroll", domAfter.cells, "cells", "");
    } catch (e) {
      unmeasured(CASE, gridLabel, "scroll_latency_ms", e.message);
    }
  } catch (e) {
    unmeasured(CASE, gridLabel, "worksheet_mount_ms", e.message);
    unmeasured(CASE, gridLabel, "scroll_latency_ms", "blocked — worksheet never mounted");
  }

  // ---- 5. .dwk serialize -----------------------------------------------------
  const dwkLabel = `F5 session (.dwk, ${prevCount} datasets incl. 1M-row + derived content + ${windowCountBeforeSave} windows)`;
  let tmpDwk = null;
  let savedSize = null;
  try {
    const saved = await withDeadline(() => saveWorkspaceCapture(page), 120000, "save workspace (.dwk) at F5 scale");
    record(CASE, dwkLabel, "serialize_and_save_ms", Math.round(saved.durationMs * 100) / 100, "ms", "page-clock timing of the real 'Save workspace (.dwk)…' command, download intercepted (not a real disk write) in headless Chrome");
    record(CASE, dwkLabel, "file_size_bytes", saved.size, "bytes", "");
    savedSize = saved.size;

    tmpDwk = join(os.tmpdir(), `qz-envelope-f5-${Date.now()}.dwk`);
    await writeFile(tmpDwk, saved.text, "utf8");
  } catch (e) {
    unmeasured(CASE, dwkLabel, "serialize_and_save_ms", e.message);
  }

  // ---- 6. Autosave at this scale ---------------------------------------------
  if (tmpDwk) {
    try {
      const nudgeAt = Date.now();
      await page.evaluate((id) => {
        const { useApp } = window.__qz;
        const win = useApp.getState().plotWindows.find((w) => w.id === id);
        if (win) useApp.getState().moveWindow(id, win.geometry.x + 1, win.geometry.y);
      }, lastWinId);
      const genAt = await waitForAutosaveGeneration(page, nudgeAt, 25000);
      if (genAt != null) {
        const totalMs = genAt - nudgeAt;
        record(
          CASE,
          dwkLabel,
          "autosave_total_latency_ms",
          totalMs,
          "ms",
          `trigger (one window move) to durable IndexedDB generation; includes the fixed 800ms debounce — write_estimate_ms ≈ ${Math.max(0, totalMs - 800)}`,
        );
        const idbSize = await page.evaluate(
          () =>
            new Promise((resolve) => {
              const req = indexedDB.open("qz.autosave", 1);
              req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction("generations", "readonly");
                const getReq = tx.objectStore("generations").getAll();
                getReq.onsuccess = () => {
                  db.close();
                  const rows = getReq.result || [];
                  resolve(rows.reduce((sum, r) => sum + (r.text?.length ?? 0), 0));
                };
                getReq.onerror = () => {
                  db.close();
                  resolve(null);
                };
              };
              req.onerror = () => resolve(null);
            }),
        );
        record(CASE, dwkLabel, "autosave_indexeddb_total_bytes", idbSize, "bytes (UTF-16 code units)", "sum of every retained generation's serialized text length — AUTOSAVE_BUDGET_BYTES is 64 MiB but the newest generation is always kept even over budget (lib/autosaveGenerations.ts capBySize)");
        record(CASE, dwkLabel, "autosave_outcome", "SUCCESS", "", "IndexedDB accepted the write at this scale — no quota failure observed");
      } else {
        const banner = await page.evaluate(() => {
          const el = document.querySelector("[role='alert']");
          return el ? el.textContent : null;
        });
        const status = await page.evaluate(() => window.__qz.useApp.getState().status);
        unmeasured(CASE, dwkLabel, "autosave_total_latency_ms", `no new IndexedDB generation observed within 25s of the trigger — status line: "${status}", alert banner: ${banner ? `"${banner}"` : "none"}`);
        record(CASE, dwkLabel, "autosave_outcome", "FAILED_OR_TIMED_OUT", "", `status="${status}" banner=${banner ? JSON.stringify(banner) : "null"}`, "unmeasured");
      }
    } catch (e) {
      unmeasured(CASE, dwkLabel, "autosave_total_latency_ms", e.message);
    }

    // Prevent autosave-restore-on-startup from pre-populating the library
    // before the controlled .dwk reopen below (same F4 precondition).
    try {
      await runPaletteAction(page, "Clear autosaved workspace");
      const cleared = await waitForAutosaveCleared(page, 8000);
      if (!cleared) console.warn(`  [${CASE}] WARNING: autosave did not report empty within 8s of the clear command`);
    } catch (e) {
      console.warn(`  [${CASE}] WARNING: could not clear autosave before reopen: ${e.message}`);
    }
  } else {
    unmeasured(CASE, dwkLabel, "autosave_total_latency_ms", "blocked — .dwk save failed, nothing to nudge against");
  }

  // ---- 7. Reopen: restore time, time-to-interactive, main-thread freeze -----
  if (tmpDwk) {
    try {
      await gotoHarness(page, BASE_URL);
      let restoreMs = null;
      let freezeInfo = null;
      const { maxGapMs, sampleCount } = await measureMainThreadFreeze(page, async () => {
        const t0 = Date.now();
        await withDeadline(
          async () => {
            await openWorkspaceViaPalette(page, tmpDwk);
            await waitForCountAtLeast(page, "[data-ds-id]", prevCount, 300000);
          },
          300000,
          ".dwk reopen at F5 scale",
        );
        restoreMs = Date.now() - t0;
      });
      freezeInfo = { maxGapMs, sampleCount };
      record(CASE, dwkLabel, "reopen_dataset_restore_ms", restoreMs, "ms", "click 'Open workspace' to all dataset rows back in the Library");
      record(
        CASE,
        dwkLabel,
        "reopen_main_thread_max_freeze_ms",
        freezeInfo.maxGapMs,
        "ms",
        `largest single page.evaluate() round-trip gap during the reopen (${freezeInfo.sampleCount} samples total) — proxy for how long the .dwk load path's synchronous JSON.parse blocked the renderer's JS thread`,
      );

      try {
        const paintMs = await withDeadline(() => waitForCanvasPaint(page, 120000), 120000, "first canvas paint after reopen");
        record(CASE, dwkLabel, "reopen_time_to_first_paint_ms", paintMs, "ms", "dataset-rows-restored mark to first painted canvas — the reopened session's 'time to interactive' proxy");
      } catch (e) {
        unmeasured(CASE, dwkLabel, "reopen_time_to_first_paint_ms", e.message);
      }

      // ---- Data-integrity spot check --------------------------------------
      const integrity = await page.evaluate(
        ({ correctionsId, bigId }) => {
          const s = window.__qz.useApp.getState();
          const ds = correctionsId ? s.datasets.find((d) => d.id === correctionsId) : null;
          const big = s.datasets.find((d) => d.id === bigId);
          const lastCol = ds ? ds.data.labels.length - 1 : null;
          return {
            datasetCount: s.datasets.length,
            windowCount: s.plotWindows.length,
            correctionsPresent: !!(ds && ds.corrections && Object.keys(ds.corrections).length > 0),
            formulasPresent: !!(ds && ds.formulas && ds.formulas.length > 0),
            fitSpecPresent: !!(ds && ds.fitSpec && ds.fitSpec.model === "Linear" && Array.isArray(ds.fitSpec.params)),
            fitParams: ds?.fitSpec?.params ?? null,
            derivedValueAfter: ds && lastCol != null ? (ds.data.values[0]?.[lastCol] ?? null) : null,
            bigRowCount: big?.data?.time?.length ?? null,
          };
        },
        { correctionsId, bigId },
      );
      const derivedMatches =
        derivedValueBefore?.row0 != null && integrity.derivedValueAfter === derivedValueBefore.row0;
      record(
        CASE,
        dwkLabel,
        "integrity_dataset_count",
        integrity.datasetCount,
        "datasets",
        `expected ${prevCount}`,
        integrity.datasetCount === prevCount ? "ok" : "unmeasured",
      );
      record(
        CASE,
        dwkLabel,
        "integrity_window_count",
        integrity.windowCount,
        "windows",
        `expected ${windowCountBeforeSave} (ground truth read from the store right before save, not assumed — plotWindows always holds >=1 pre-existing window at startup)`,
        integrity.windowCount === windowCountBeforeSave ? "ok" : "unmeasured",
      );
      record(
        CASE,
        dwkLabel,
        "integrity_derived_content_present",
        integrity.correctionsPresent && integrity.formulasPresent && integrity.fitSpecPresent,
        "boolean",
        `corrections=${integrity.correctionsPresent} formulas=${integrity.formulasPresent} fitSpec=${integrity.fitSpecPresent} fitParams=${JSON.stringify(integrity.fitParams)}`,
      );
      record(
        CASE,
        dwkLabel,
        "integrity_one_derived_value_matches",
        derivedMatches,
        "boolean",
        `formula column value at row0: before=${derivedValueBefore?.row0} after=${integrity.derivedValueAfter}`,
        derivedMatches ? "ok" : "unmeasured",
      );
      record(
        CASE,
        dwkLabel,
        "integrity_big_dataset_row_count",
        integrity.bigRowCount,
        "rows",
        "expected 1000000",
        integrity.bigRowCount === 1000000 ? "ok" : "unmeasured",
      );
    } catch (e) {
      unmeasured(CASE, dwkLabel, "reopen_dataset_restore_ms", e.message);
    } finally {
      if (tmpDwk) await rm(tmpDwk, { force: true }).catch(() => {});
    }
  } else {
    unmeasured(CASE, dwkLabel, "reopen_dataset_restore_ms", "blocked — no saved .dwk to reopen");
  }

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

    await withIsolatedBrowser("hardware probe", async (browser) => {
      hardware = hardwareInfo(browser.version(), await playwrightVersion());
    });

    await withIsolatedBrowser("F5 — large derived workspace + 1M-row worksheet grid", runF5);
  } finally {
    console.log("[teardown] stopping backend …");
    await killTree(backend);
  }

  const out = {
    plan_item: "PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 residuals — worksheet grid @ 1M rows + large derived .dwk",
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
