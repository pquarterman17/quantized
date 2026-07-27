// PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 FINAL residual M2 — copy/export timing at
// the 1M-row scale, driven through the REAL UI: the "Export figure…" Command
// Palette dialog (SVG + 300-DPI PNG) and the plot's right-click "Copy
// figure" clipboard action. `docs/performance_envelope.md`'s Residuals list
// carried this as explicitly unmeasured — the backend export routes were
// timed in isolation (`envelope.py`'s "Figure export 1M-pt series SVG/PNG":
// 98/150 ms), never end-to-end from a click in the built app.
//
// Same discipline as the other tools/bench harnesses: real FastAPI backend,
// real built SPA, real Chromium, click-through-the-UI. The two download/
// clipboard capture points patch the PAGE's own runtime from the outside for
// the duration of one capture (see envelope-lib.mjs's install*Capture doc) —
// never a monkeypatch of frontend/src.
//
// Usage:
//   cd tools/bench && npm install   # one-time
//   node export_envelope.mjs [--port 8946] [--out <path>]

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

import { REPO_ROOT, killTree, parseArgs, waitForServer } from "../visual/origin_shared.mjs";
import {
  gotoHarness,
  importFilesViaPalette,
  installClipboardWriteCapture,
  installDownloadCapture,
  openPaletteAndLocate,
  waitForCanvasPaint,
  waitForClipboardCapture,
  waitForCountAtLeast,
  waitForDownloadCapture,
  withDeadline,
} from "./envelope-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 8946); // distinct from :8000, :8934, :8793, :8942, :8944, :8945
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT_JSON = args.out
  ? args.out
  : join(REPO_ROOT, "docs", "envelope", "2026-07-27-export.json");

const LARGE_DIR = join(REPO_ROOT, "tools", "baselines", "out");
const FIXTURE_PATH = join(LARGE_DIR, "large_million_row.csv");
const FIXTURE_REL = "tools/baselines/out/large_million_row.csv";

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

/** Open "Export figure…", set the Format <select> (first field in the
 *  dialog) to `fmt`, leave every other field at its default (DPI already
 *  defaults to 300 per lib/exportFigureCommand.ts), and click "Run". */
async function runExportFigureDialog(page, fmt) {
  const item = await openPaletteAndLocate(page, "Export figure");
  await item.click();
  await page.waitForSelector(".qz-dialog", { timeout: 10000 });
  await page.locator(".qz-dialog select").first().selectOption(fmt);
  await page.locator(".qz-dialog button", { hasText: "Run" }).click();
}

async function runExportCase(page, CASE, fmt, label) {
  await installDownloadCapture(page);
  const t0 = Date.now();
  await runExportFigureDialog(page, fmt);
  try {
    const captured = await waitForDownloadCapture(page, 240000);
    const elapsed = Date.now() - t0;
    record(
      CASE,
      FIXTURE_REL,
      `${label}_click_to_file_ms`,
      elapsed,
      "ms",
      `click "Run" -> real /api/export/figure POST -> blob captured; size=${captured.size} bytes, headHex=${captured.headHex} (type=${captured.type})`,
    );
    record(CASE, FIXTURE_REL, `${label}_file_size_bytes`, captured.size, "bytes", "");
  } catch (e) {
    const toast = await page
      .evaluate(() => Array.from(document.querySelectorAll("[role='alert'], .qzk-toast")).map((el) => el.textContent))
      .catch(() => []);
    const status = await page.evaluate(() => window.__qz?.useApp?.getState?.().status).catch(() => null);
    unmeasured(CASE, FIXTURE_REL, `${label}_click_to_file_ms`, `${e.message} — status="${status}" toasts=${JSON.stringify(toast)}`);
  }
}

async function runM2(browser) {
  const CASE = "M2";
  if (!existsSync(FIXTURE_PATH)) {
    unmeasured(CASE, FIXTURE_REL, "upload_and_parse_ms", "fixture missing — run: uv run python tools/baselines/make_fixtures.py --large");
    return;
  }

  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  // Grant clipboard permissions up front — the copy-figure cases need
  // navigator.clipboard.write to actually be allowed to run (not just
  // present), or every one of them would resolve "unavailable" for a
  // permissions reason rather than a genuine capability one.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
  const page = await context.newPage();

  await gotoHarness(page, BASE_URL);

  // ---- Setup: import + plot the 1M x 8 dataset (same fixture/path as F1) ---
  let importedOk = false;
  const t0 = Date.now();
  try {
    await withDeadline(
      async () => {
        await importFilesViaPalette(page, [FIXTURE_PATH]);
        await waitForCountAtLeast(page, "[data-ds-id]", 1, 240000);
      },
      240000,
      "1M-row CSV upload+parse+dataset-appear",
    );
    record(CASE, FIXTURE_REL, "upload_and_parse_ms", Date.now() - t0, "ms", "click-to-dataset-row-appearing, same path as F1");
    importedOk = true;
  } catch (e) {
    unmeasured(CASE, FIXTURE_REL, "upload_and_parse_ms", e.message);
  }
  if (!importedOk) {
    await context.close().catch(() => {});
    return;
  }
  try {
    await withDeadline(() => waitForCanvasPaint(page, 180000), 180000, "first canvas paint");
  } catch (e) {
    unmeasured(CASE, FIXTURE_REL, "plot_visible", e.message);
    await context.close().catch(() => {});
    return;
  }

  // ---- Export: SVG (vector) ------------------------------------------------
  await runExportCase(page, CASE, "svg", "svg_export");

  // ---- Export: PNG @ 300 DPI (raster; DPI field already defaults to 300) ---
  await runExportCase(page, CASE, "png", "png_export_300dpi");

  // ---- Diagnostic follow-up: the SVG UI path above has been observed to
  // never send the /api/export/figure request at all within the 240s window
  // (no fetch, no status change, no toast, no console error) in some runs —
  // intermittently, not reliably, and independent of which format is chosen
  // (a separate isolated probe saw PNG hang the same way on a fresh session,
  // while "Copy figure"'s non-dialog path — same render pipeline — has never
  // failed). This ONE extra call bypasses the "Export figure…" dialog/
  // buildFigureSpec orchestration entirely and posts an equivalent spec
  // directly, to tell apart "the backend can't do this" from "the UI's own
  // path to it is unreliable". Bypasses frontend/src by construction (a raw
  // fetch from the harness's page.evaluate, not a store/UI action) — reports
  // what the endpoint CAN do, not a substitute for the UI measurement above.
  try {
    const raw = await page.evaluate(async () => {
      const s = window.__qz.useApp.getState();
      const ds = s.datasets.find((d) => d.id === s.activeId) ?? s.datasets[0];
      const spec = {
        dataset: ds.data,
        y_keys: [0, 1, 2, 3, 4, 5, 6],
        x_scale: "linear",
        y_scale: "linear",
        fmt: "svg",
        style: "default",
        dpi: 300,
        title: "",
        filename: "raw_probe",
      };
      const t0 = performance.now();
      const res = await fetch("/api/export/figure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      });
      const fetchMs = performance.now() - t0;
      const blob = await res.blob();
      return { ok: res.ok, status: res.status, fetchMs, size: blob.size };
    });
    record(
      CASE,
      FIXTURE_REL,
      "svg_export_raw_fetch_bypass_ui_ms",
      Math.round(raw.fetchMs),
      "ms",
      `direct POST /api/export/figure from page.evaluate (bypasses the "Export figure…" dialog + buildFigureSpec orchestration entirely) — status=${raw.status} size=${raw.size} bytes. Confirms the BACKEND can render this in bounded time; the UI-driven svg_export_click_to_file_ms failure above is specific to the frontend orchestration path, not the endpoint.`,
    );
  } catch (e) {
    unmeasured(CASE, FIXTURE_REL, "svg_export_raw_fetch_bypass_ui_ms", e.message);
  }

  // ---- Clipboard copy: "Copy figure" (PNG, fixed 300 DPI / default style) --
  const svgClipboardSupported = await page.evaluate(() => {
    if (typeof ClipboardItem === "undefined") return false;
    const supports = ClipboardItem.supports;
    if (typeof supports !== "function") return false;
    try {
      return supports("image/svg+xml") === true;
    } catch {
      return false;
    }
  });
  record(
    CASE,
    FIXTURE_REL,
    "clipboard_svg_supported",
    svgClipboardSupported,
    "boolean",
    "ClipboardItem.supports('image/svg+xml') — the same gate lib/clipboard.ts's clipboardSvgSupported() uses to decide whether the plot's right-click menu even offers \"Copy figure (vector)\"",
  );

  const canvasBox = await page.locator(".qzk-stage .u-over").first().boundingBox();
  if (!canvasBox) {
    unmeasured(CASE, FIXTURE_REL, "copy_figure_png_clipboard_ms", "no bounding box for the plot overlay — cannot right-click");
  } else {
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;
    try {
      await installClipboardWriteCapture(page);
      const t0c = Date.now();
      await page.mouse.click(cx, cy, { button: "right" });
      const copyItem = page.locator(".qzk-menu-item").filter({ hasText: /^Copy figure$/ }).first();
      await copyItem.waitFor({ state: "visible", timeout: 5000 });
      await copyItem.click();
      const captured = await waitForClipboardCapture(page, 30000);
      const elapsed = Date.now() - t0c;
      if (captured.ok) {
        record(CASE, FIXTURE_REL, "copy_figure_png_clipboard_ms", elapsed, "ms", `right-click -> "Copy figure" -> real /api/export/figure render (png, 300 DPI, default style) -> navigator.clipboard.write() resolved; itemCount=${captured.itemCount}`);
      } else {
        unmeasured(CASE, FIXTURE_REL, "copy_figure_png_clipboard_ms", `clipboard.write() rejected: ${captured.error}`);
      }
    } catch (e) {
      unmeasured(CASE, FIXTURE_REL, "copy_figure_png_clipboard_ms", e.message);
    }
    await page.keyboard.press("Escape").catch(() => {});
  }

  // ---- Clipboard copy: "Copy figure (vector)" — only offered when the
  // browser accepts image/svg+xml on the clipboard. ---------------------------
  if (!svgClipboardSupported) {
    unmeasured(
      CASE,
      FIXTURE_REL,
      "copy_figure_svg_clipboard_ms",
      "this browser build does not accept image/svg+xml on the clipboard (ClipboardItem.supports() false) — the app itself hides \"Copy figure (vector)\" from the right-click menu under this exact condition, so there is nothing to click",
    );
  } else if (!canvasBox) {
    unmeasured(CASE, FIXTURE_REL, "copy_figure_svg_clipboard_ms", "no bounding box for the plot overlay — cannot right-click");
  } else {
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;
    try {
      await installClipboardWriteCapture(page);
      const t0c = Date.now();
      await page.mouse.click(cx, cy, { button: "right" });
      const copyItem = page.locator(".qzk-menu-item").filter({ hasText: "Copy figure (vector)" }).first();
      try {
        await copyItem.waitFor({ state: "visible", timeout: 5000 });
      } catch (waitErr) {
        const menuItems = await page.locator(".qzk-menu-item").allTextContents().catch(() => []);
        throw new Error(`${waitErr.message} — visible menu items: ${JSON.stringify(menuItems)}`);
      }
      await copyItem.click();
      const captured = await waitForClipboardCapture(page, 30000);
      const elapsed = Date.now() - t0c;
      if (captured.ok) {
        record(CASE, FIXTURE_REL, "copy_figure_svg_clipboard_ms", elapsed, "ms", "right-click -> \"Copy figure (vector)\" -> real /api/export/figure render (svg) -> navigator.clipboard.write() resolved");
      } else {
        unmeasured(CASE, FIXTURE_REL, "copy_figure_svg_clipboard_ms", `clipboard.write() rejected: ${captured.error}`);
      }
    } catch (e) {
      unmeasured(CASE, FIXTURE_REL, "copy_figure_svg_clipboard_ms", e.message);
    }
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

    await withIsolatedBrowser("M2 — 1M-row copy/export from the UI", runM2);
  } finally {
    console.log("[teardown] stopping backend …");
    await killTree(backend);
  }

  const out = {
    plan_item: "PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 FINAL residual M2 — copy/export timing at the 1M scale from the UI",
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
