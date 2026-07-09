// Per-figure screenshot + structural-report generator (Origin plan item #39:
// "Side-by-side Origin<->quantized figure comparison campaign").
//
// Imports an Origin project through the REAL running backend exactly once
// (POST /api/parsers/upload, the OneDrive-placeholder-immune path), then
// replays the Library's real "click a figure" flow --
// `addOriginFigures` + `applyOriginFigure` via the `?harness` store seam
// (frontend/src/main.tsx) -- for every decoded graph window, screenshotting
// the resulting `.qzk-stage` (works for both the single-panel PlotStage and
// MultiPanelStage, which share that outer class). Multi-layer graph windows
// (double-Y pairs, spatial multi-panel figures) apply ONCE per graph window
// family, matching what a real user sees clicking any one of that window's
// rows in the Library.
//
// Output pairs 1:1 with the parallel COM-export oracle's manifest.json (same
// short_name keys), so gallery.mjs can build a side-by-side comparison.
//
// Usage:
//   node origin_figures.mjs --opj <path/to/Project.opj> --project <name> \
//        [--exports-root <dir>] [--port 8793]
//
// Writes, under <test-data>/origin/_exports/<project>/ (gitignored corpus
// export tree, NEVER committed -- only this generator is):
//   quantized/<ShortName>.png     one screenshot per graph-window family
//   quantized_manifest.json       pairing metadata (mirrors the oracle shape)
//   structural_report.json        decoded-figure vs applied-store-state checks

import { spawn } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

import {
  REPO_ROOT,
  exportsDirFor,
  findChrome,
  killTree,
  parseArgs,
  sanitizeName,
  waitForServer,
} from "./origin_shared.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.opj || !args.project) {
  console.error(
    "usage: node origin_figures.mjs --opj <path> --project <name> [--exports-root <dir>] [--port 8793]",
  );
  process.exit(1);
}
const OPJ_PATH = resolve(args.opj);
const PROJECT = String(args.project);
const PORT = Number(args.port || 8793);
const EXPORTS_DIR = exportsDirFor(PROJECT, args["exports-root"]);
const QZ_DIR = join(EXPORTS_DIR, "quantized");

if (!existsSync(OPJ_PATH)) throw new Error(`project file not found: ${OPJ_PATH}`);

const CHROME = findChrome();
if (!CHROME) throw new Error("No Chrome found; set QZ_CHROME=<path to chrome>");

// ---- numeric/structural comparison helpers ---------------------------------

function approxEq(a, b, eps = 1e-6) {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b) || a === b;
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= eps * scale;
  }
  return a === b;
}
const check = (name, pass, detail) => ({ name, pass: !!pass, detail: detail ?? (pass ? "ok" : "mismatch") });

/** Compare a graph window family's decoded figure record(s) against the store
 *  state `applyOriginFigure` produced. Mode is inferred from the OBSERABLE
 *  post-apply state (stackMode+spatialPanels => multi-panel; family of 2 with
 *  y2Keys populated => double-Y combine; else single-layer) -- the harness
 *  seam doesn't expose the pure classifier functions
 *  (lib/originFigures.figureLayerFamily/doubleYPartner/resolveFigurePanels),
 *  so this mirrors their OUTCOME rather than calling them directly. "First
 *  cut" per the plan: catches apply-routing regressions (wrong axis, dropped
 *  panel, stale cross-figure state), not deep rendering fidelity. */
function compareFigureToState(family, representative, applied) {
  const checks = [];
  const isMultiPanel = applied.stackMode && Array.isArray(applied.spatialPanels) && applied.spatialPanels.length >= 2;
  if (isMultiPanel) {
    const panels = applied.spatialPanels;
    checks.push(check("panel_count", panels.length === family.length, `expected ${family.length}, got ${panels.length}`));
    family.forEach((entry, i) => {
      const p = panels[i];
      const fig = entry.figure;
      if (!p) {
        checks.push(check(`panel_${i}_present`, false, "panel missing at this index"));
        return;
      }
      checks.push(check(`panel_${i}_xrange`, approxEq(p.xLim?.[0], fig.x_from) && approxEq(p.xLim?.[1], fig.x_to)));
      checks.push(check(`panel_${i}_yrange`, approxEq(p.yLim?.[0], fig.y_from) && approxEq(p.yLim?.[1], fig.y_to)));
      checks.push(check(`panel_${i}_xlog`, p.xLog === fig.x_log));
      checks.push(check(`panel_${i}_ylog`, p.yLog === fig.y_log));
      checks.push(check(`panel_${i}_xstep`, approxEq(p.xStep ?? null, fig.x_step ?? null)));
      checks.push(check(`panel_${i}_ystep`, approxEq(p.yStep ?? null, fig.y_step ?? null)));
    });
    checks.push(
      check("canvas_count", applied.canvasCount === family.length, `expected ${family.length}, saw ${applied.canvasCount}`),
    );
    return { mode: "multiPanel", checks };
  }
  const isDoubleY = family.length === 2 && Array.isArray(applied.y2Keys) && applied.y2Keys.length > 0;
  if (isDoubleY) {
    const sorted = [...family].sort((a, b) => (a.figure.layer ?? 1) - (b.figure.layer ?? 1));
    const [lower, upper] = [sorted[0].figure, sorted[1].figure];
    checks.push(check("x_range", approxEq(applied.xLim?.[0], lower.x_from) && approxEq(applied.xLim?.[1], lower.x_to)));
    checks.push(check("y_range", approxEq(applied.yLim?.[0], lower.y_from) && approxEq(applied.yLim?.[1], lower.y_to)));
    checks.push(check("x_log", applied.xLog === lower.x_log));
    checks.push(check("y_log", applied.yLog === lower.y_log));
    checks.push(check("x_step", approxEq(applied.xStep ?? null, lower.x_step ?? null)));
    checks.push(check("y_step", approxEq(applied.yStep ?? null, lower.y_step ?? null)));
    checks.push(check("y2_range", approxEq(applied.y2Lim?.[0], upper.y_from) && approxEq(applied.y2Lim?.[1], upper.y_to)));
    checks.push(check("y2_log", applied.y2Log === upper.y_log));
    checks.push(check("y2_step", approxEq(applied.y2Step ?? null, upper.y_step ?? null)));
    return { mode: "doubleY", checks };
  }
  const fig = representative.figure; // single-layer, or a family that degraded to single
  checks.push(check("x_range", approxEq(applied.xLim?.[0], fig.x_from) && approxEq(applied.xLim?.[1], fig.x_to)));
  checks.push(check("y_range", approxEq(applied.yLim?.[0], fig.y_from) && approxEq(applied.yLim?.[1], fig.y_to)));
  checks.push(check("x_log", applied.xLog === fig.x_log));
  checks.push(check("y_log", applied.yLog === fig.y_log));
  checks.push(check("x_step", approxEq(applied.xStep ?? null, fig.x_step ?? null)));
  checks.push(check("y_step", approxEq(applied.yStep ?? null, fig.y_step ?? null)));
  return { mode: "single", checks };
}

/** `metadata.origin_folder_path` is a root-exclusive array of folder-name
 *  segments (see `io/origin_project/__init__.py._with_folder_path`) — format
 *  it to look like the COM oracle's own folder strings ("/PNR/S3 - YIG
 *  Py(20)/PNR/": leading slash, PROJECT name first, trailing slash) so the
 *  gallery shows a directly comparable path, not a bare array dump. */
function formatFolder(stem, rawFolder) {
  if (rawFolder == null) return null;
  const segments = Array.isArray(rawFolder) ? rawFolder.filter(Boolean) : [];
  return `/${[stem, ...segments].join("/")}/`;
}

function groupFamilies(entries) {
  const byName = new Map();
  for (const e of entries) {
    const key = e.figure?.name || `(unnamed-${e.id})`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(e);
  }
  for (const arr of byName.values()) arr.sort((a, b) => (a.figure.layer ?? 1) - (b.figure.layer ?? 1));
  return byName;
}

// ---- main -------------------------------------------------------------------

async function main() {
  await mkdir(QZ_DIR, { recursive: true });

  console.log(`[1/5] starting backend on :${PORT} …`);
  const backend = spawn("uv", ["run", "qz", "--no-browser", "--port", String(PORT)], {
    cwd: REPO_ROOT,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const backendLogs = [];
  backend.stdout.on("data", (d) => backendLogs.push(d.toString()));
  backend.stderr.on("data", (d) => backendLogs.push(d.toString()));

  const baseUrl = `http://127.0.0.1:${PORT}`;
  let browser;
  try {
    const up = await waitForServer(`${baseUrl}/`, 30000);
    if (!up) throw new Error(`backend did not come up on ${baseUrl} within 30s:\n${backendLogs.join("")}`);

    const bytes = await readFile(OPJ_PATH);
    console.log(`[2/5] uploading ${basename(OPJ_PATH)} (${bytes.length} bytes) …`);
    const form = new FormData();
    form.append("file", new Blob([bytes]), basename(OPJ_PATH));
    const t0 = Date.now();
    const uploadRes = await fetch(`${baseUrl}/api/parsers/upload`, { method: "POST", body: form });
    if (!uploadRes.ok) {
      throw new Error(`upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
    }
    const payload = await uploadRes.json();
    console.log(`      parsed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const stem = basename(OPJ_PATH).replace(/\.[^.]+$/, "");
    const figures = payload.figures || [];
    let datasets;
    if (Array.isArray(payload.books) && payload.books.length > 1) {
      datasets = payload.books.map((book, i) => {
        const meta = book.metadata || {};
        const short = String(meta.origin_book ?? `Book${i + 1}`);
        const long = String(meta.origin_book_long ?? "");
        const label = long && long !== short ? `${short} — ${long}` : short;
        return { id: `qzimport-${i}`, name: `${stem}:${label}`, data: book };
      });
    } else {
      const data = { ...payload };
      delete data.books;
      delete data.figures;
      datasets = [{ id: "qzimport-0", name: basename(OPJ_PATH), data }];
    }
    console.log(`      ${datasets.length} dataset(s), ${figures.length} figure entries (pre-family-grouping)`);

    console.log(`[3/5] launching headless Chrome …`);
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1", "--hide-scrollbars"],
      defaultViewport: { width: 1200, height: 820 },
    });
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error(`[pageerror] ${e.stack || e.message}`));

    await page.goto(`${baseUrl}/?harness=1`, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForFunction("window.__qz && window.__qz.useApp", { timeout: 15000 });

    const { entries, datasetInfo } = await page.evaluate(
      ({ stem, datasets, figures, ids }) => {
        const { useApp } = window.__qz;
        useApp.setState({
          datasets: [],
          folders: [],
          expandedFolders: [],
          activeId: null,
          selectedIds: [],
          originFigures: [],
        });
        const api = useApp.getState();
        for (const d of datasets) api.addDataset(d);
        if (figures.length) api.addOriginFigures(stem, figures, ids);
        const state = useApp.getState();
        return {
          entries: state.originFigures,
          datasetInfo: Object.fromEntries(
            state.datasets.map((d) => [
              d.id,
              { name: d.name, folder: (d.data.metadata || {}).origin_folder_path ?? null },
            ]),
          ),
        };
      },
      { stem, datasets, figures, ids: datasets.map((d) => d.id) },
    );
    console.log(`      ${entries.length} figure entries resolved against ${Object.keys(datasetInfo).length} dataset(s)`);

    const families = groupFamilies(entries);
    console.log(`[4/5] applying + screenshotting ${families.size} graph window(s) …`);

    const manifestFigures = {};
    const reportFigures = [];
    let shot = 0;
    for (const [name, family] of families) {
      shot += 1;
      const representative = family.find((e) => e.datasetId != null) ?? family[0];
      const shortName = name;
      const fileBase = sanitizeName(name);
      if (!representative.datasetId) {
        manifestFigures[shortName] = {
          short_name: shortName,
          folder: null,
          file: null,
          resolved: false,
          layers: family.length,
          reason: representative.figure?.source_hint
            ? `unresolved source hint "${representative.figure.source_hint}"`
            : "no family member resolved a dataset",
        };
        reportFigures.push({ name: shortName, resolved: false, pass: false, mode: null, checks: [] });
        console.log(`  (${shot}/${families.size}) ${name}: UNRESOLVED — skipped`);
        continue;
      }

      // Reset transient cross-figure state before every apply so one shot's
      // multi-panel/double-Y leftovers can never bleed into the next (real UI
      // gap: applyOriginFigure's single/double-Y branches don't clear
      // stackMode/spatialPanels/y2*, since a normal click sequence rarely
      // crosses figure "kinds" back-to-back the way this batch does).
      await page.evaluate((id) => {
        const { useApp } = window.__qz;
        useApp.setState({
          stackMode: false,
          spatialPanels: null,
          facetPanels: null,
          breakPanels: null,
          y2Keys: null,
          y2Lim: null,
          y2Log: null,
          y2Step: null,
        });
        useApp.getState().applyOriginFigure(id);
      }, representative.id);

      await page.waitForSelector(".qzk-stage", { timeout: 6000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 650));

      const outPath = join(QZ_DIR, `${fileBase}.png`);
      const el = await page.$(".qzk-stage");
      if (el) await el.screenshot({ path: outPath });
      else console.warn(`      WARNING: no .qzk-stage found for ${name}`);

      const applied = await page.evaluate(() => {
        const s = window.__qz.useApp.getState();
        return {
          xLim: s.xLim,
          yLim: s.yLim,
          xLog: s.xLog,
          yLog: s.yLog,
          xStep: s.xStep,
          yStep: s.yStep,
          y2Lim: s.y2Lim,
          y2Log: s.y2Log,
          y2Step: s.y2Step,
          y2Keys: s.y2Keys,
          stackMode: s.stackMode,
          spatialPanels: s.spatialPanels,
          canvasCount: document.querySelectorAll(".qzk-stage canvas").length,
        };
      });

      const { mode, checks } = compareFigureToState(family, representative, applied);
      const pass = checks.every((c) => c.pass);
      const dsInfo = datasetInfo[representative.datasetId] || {};
      manifestFigures[shortName] = {
        short_name: shortName,
        folder: formatFolder(stem, dsInfo.folder),
        file: `quantized/${fileBase}.png`,
        resolved: true,
        layers: family.length,
        mode,
        dataset: dsInfo.name ?? null,
        structural_pass: pass,
      };
      reportFigures.push({ name: shortName, resolved: true, mode, pass, checks });
      console.log(`  (${shot}/${families.size}) ${name}: mode=${mode} structural=${pass ? "PASS" : "FAIL"}`);
    }

    console.log(`[5/5] writing manifests …`);
    await writeFile(
      join(EXPORTS_DIR, "quantized_manifest.json"),
      JSON.stringify(
        {
          project: OPJ_PATH,
          stem,
          generated: new Date().toISOString(),
          figure_count: families.size,
          figures: manifestFigures,
        },
        null,
        1,
      ),
      "utf8",
    );
    const totals = {
      figures: reportFigures.length,
      resolved: reportFigures.filter((f) => f.resolved).length,
      unresolved: reportFigures.filter((f) => !f.resolved).length,
      fully_consistent: reportFigures.filter((f) => f.resolved && f.pass).length,
      with_mismatches: reportFigures.filter((f) => f.resolved && !f.pass).length,
    };
    await writeFile(
      join(EXPORTS_DIR, "structural_report.json"),
      JSON.stringify(
        { project: OPJ_PATH, stem, generated: new Date().toISOString(), totals, figures: reportFigures },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`done: ${JSON.stringify(totals)}`);
    console.log(`  screenshots -> ${QZ_DIR}`);
    console.log(`  manifests   -> ${EXPORTS_DIR}`);
  } finally {
    if (browser) await browser.close();
    await killTree(backend);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
