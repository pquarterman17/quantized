// Step 2 of the preview-oracle visual check (README "Origin preview oracle"):
// render OUR figure for every graph page that origin_preview_extract.py found
// an Origin-saved preview for.
//
// One `qz` backend serves every project (it is restarted only if it dies).
// Each project gets a fresh incognito browser context, is imported through the
// REAL upload path (`importFiles`), and every previewed graph-window family is
// applied exactly like a Library click (`applyOriginFigure`) -- both through
// origin_store_api.mjs, the contract-tested store surface -- then the
// `.qzk-stage` is screenshotted. The light theme is selected so the plot page
// is white like Origin's.
//
// Usage:
//   node origin_preview_shots.mjs --out <scratch>/visual [--port 8931]
//        [--projects p0001,p0042] [--resume] [--project-timeout 240] [--full]
//
// Reads <out>/pages.json, writes <out>/ours/<pid>/<page>.png and
// <out>/ours/<pid>/shots.json (per page: plotted series, visible samples,
// uPlot plot-area rects relative to the screenshot, browser errors).
// --full also saves a whole-window screenshot beside each stage shot.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

import { REPO_ROOT, findChrome, killTree, parseArgs, waitForServer } from "./origin_shared.mjs";
import { applyFigure, collapsePanels, importProjectViaUi, readFigureEntries } from "./origin_store_api.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error("usage: node origin_preview_shots.mjs --out <dir> [--port 8931] [--projects ids] [--resume]");
  process.exit(1);
}
const OUT = resolve(String(args.out));
const PORT = Number(args.port || 8931);
const PROJECT_TIMEOUT_MS = Number(args["project-timeout"] || 240) * 1000;
const ONLY = args.projects ? new Set(String(args.projects).split(",")) : null;
process.env.QZ_API_TOKEN ??= randomBytes(32).toString("base64url");
const API_TOKEN = process.env.QZ_API_TOKEN;
const BASE = `http://127.0.0.1:${PORT}`;

/** Same rule as origin_preview_extract.safe_name, so files pair by key. */
const safeName = (name) => String(name).replace(/[^A-Za-z0-9._-]+/g, "_") || "_";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms: ${label}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

let backend = null;
async function ensureBackend() {
  if (backend && backend.exitCode === null && (await waitForServer(`${BASE}/`, 2000))) return;
  if (backend) await killTree(backend);
  backend = spawn("uv", ["run", "--no-sync", "qz", "--no-browser", "--port", String(PORT)], {
    cwd: REPO_ROOT,
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  if (!(await waitForServer(`${BASE}/`, 60000))) throw new Error(`backend did not come up on ${BASE}`);
}

/** Store + DOM facts about the applied figure (read after the canvas settles). */
function readApplied() {
  const s = window.__qz.useApp.getState();
  const active = s.datasets.find((d) => d.id === s.activeId);
  const hidden = new Set(s.hiddenChannels || []);
  const selected = (s.yKeys ?? active?.data.labels.map((_, i) => i) ?? []).filter((k) => !hidden.has(k));
  let visible = 0;
  if (active) {
    for (let row = 0; row < active.data.time.length; row += 1) {
      const x = s.xKey == null ? active.data.time[row] : active.data.values[row]?.[s.xKey];
      if (!Number.isFinite(x)) continue;
      for (const k of selected) if (Number.isFinite(active.data.values[row]?.[k])) visible += 1;
    }
  }
  const stage = document.querySelector(".qzk-stage");
  const sb = stage?.getBoundingClientRect();
  const overs = sb
    ? Array.from(stage.querySelectorAll(".u-over")).map((el) => {
        const b = el.getBoundingClientRect();
        return { x: b.left - sb.left, y: b.top - sb.top, w: b.width, h: b.height };
      })
    : [];
  return {
    series: selected.length,
    y2: (s.y2Keys || []).length,
    visible_samples: visible,
    dataset: active?.name ?? null,
    canvases: stage ? stage.querySelectorAll("canvas").length : 0,
    overs,
    stage: sb ? { w: sb.width, h: sb.height } : null,
  };
}

async function shootProject(browser, row) {
  const dir = join(OUT, "ours", row.pid);
  await mkdir(dir, { recursive: true });
  const wanted = new Map(row.pages.filter((p) => !p.unrecovered).map((p) => [p.page, p]));
  const result = { pid: row.pid, project: row.project, pages: {}, error: null };
  const ctx = await browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    let errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 300)));
    await page.goto(`${BASE}/?harness=1&token=${API_TOKEN}`, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForFunction("window.__qz && window.__qz.useApp", { timeout: 15000 });
    await page.evaluate(() => window.__qz.useApp.getState().setTheme?.("light"));
    await importProjectViaUi(page, row.project);
    await sleep(1000);
    // Import re-opens the side panels; collapse them so the stage is wide.
    await collapsePanels(page);
    const { entries } = await readFigureEntries(page);
    const families = new Map();
    for (const e of entries) {
      const name = e.figure?.name;
      if (!wanted.has(name)) continue;
      if (!families.has(name)) families.set(name, []);
      families.get(name).push(e);
    }
    for (const [name, fam] of families) {
      fam.sort((a, b) => (a.figure.layer ?? 1) - (b.figure.layer ?? 1));
      const rep = fam.find((e) => e.datasetId != null) ?? fam[0];
      if (rep.datasetId == null) {
        result.pages[name] = { unresolved: true };
        continue;
      }
      errors = [];
      await applyFigure(page, rep.id);
      await page.waitForSelector(".qzk-stage", { timeout: 6000 }).catch(() => {});
      await sleep(600);
      const file = `ours/${row.pid}/${safeName(name)}.png`;
      const el = await page.$(".qzk-stage");
      if (el) await el.screenshot({ path: join(OUT, file) });
      if (args.full) await page.screenshot({ path: join(OUT, `${file}.full.png`) });
      const facts = await page.evaluate(readApplied);
      result.pages[name] = { file: el ? file : null, ...facts, errors: [...new Set(errors)] };
    }
    for (const name of wanted.keys()) result.pages[name] ??= { missing_entry: true };
  } finally {
    await ctx.close().catch(() => {});
  }
  return result;
}

async function main() {
  const rows = JSON.parse(readFileSync(join(OUT, "pages.json"), "utf8"));
  const todo = rows.filter(
    (r) => r.pages?.some((p) => !p.unrecovered) && (!ONLY || ONLY.has(r.pid)),
  );
  const chrome = findChrome();
  if (!chrome) throw new Error("No Chrome found; set QZ_CHROME=<path to chrome>");
  let browser = null;
  const launch = () =>
    puppeteer.launch({
      executablePath: chrome,
      headless: "new",
      args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1", "--hide-scrollbars"],
    });
  try {
    let n = 0;
    for (const row of todo) {
      n += 1;
      const outFile = join(OUT, "ours", row.pid, "shots.json");
      if (args.resume && existsSync(outFile)) continue;
      await ensureBackend();
      if (!browser || !browser.connected) browser = await launch();
      const t0 = Date.now();
      let res;
      try {
        res = await withTimeout(shootProject(browser, row), PROJECT_TIMEOUT_MS, row.pid);
      } catch (e) {
        res = { pid: row.pid, project: row.project, pages: {}, error: String(e.message || e).slice(0, 400) };
        await browser.close().catch(() => {});
        browser = null;
      }
      await mkdir(join(OUT, "ours", row.pid), { recursive: true });
      await writeFile(outFile, JSON.stringify(res, null, 1), "utf8");
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`(${n}/${todo.length}) ${row.pid} ${Object.keys(res.pages).length} page(s) ${secs}s${res.error ? ` ERROR ${res.error}` : ""}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (backend) await killTree(backend);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
