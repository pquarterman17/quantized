// Visual-verification harness for the Boson Plotter uPlot canvas.
//
// jsdom (the frontend unit-test env) cannot render a real canvas, so the
// on-screen plot is the one crown-jewel surface with no automated check. This
// script closes that gap: it serves the BUILT SPA, drives it in the installed
// Chrome via puppeteer-core, injects a dataset + plot state through the
// `?harness` store seam (see frontend/src/main.tsx), waits for the real uPlot
// canvas to draw, and screenshots it to PNG.
//
// Usage:
//   node shoot.mjs [spec.json] [outDir]
//   spec.json default: ./spec.json   outDir default: ./out
//
// spec.json shape:
//   { "web": "<path to built SPA>",            // default ../../src/quantized/web
//     "shots": [ { "name": "sine",
//                  "dataset": { id, name, data:{time,values,labels,units,metadata} },
//                  "stageTab": "plot",          // plot | map | worksheet
//                  "state": { "yKeys":[0,1], "y2Keys":[1], ... } } ] }
//
// MDI (multi-window) shots (MULTI_PLOT_PLAN item 16) — instead of the single
// top-level `dataset`, a shot may describe a whole window layout:
//   { "name": "mdi_tile",
//     "datasets": [ <dataset>, ... ],           // same shape as `dataset` above
//     "windows": [ { "dataset": 0,              // index into `datasets`
//                    "view": { "yKeys":[0], "plotTitle":"…" },  // partial view
//                    "geometry": { "x":6,"y":6,"w":540,"h":300 },
//                    "winState": "normal" | "minimized" | "maximized",
//                    "title": "…" } , ... ],
//     "focusedIndex": 0,                        // default: last visible window
//     "state": { "leftCollapsed": true } }      // optional post-apply overrides
// Windows are built through the REAL store actions (createWindow/moveWindow/
// resizeWindow/focusWindow/minimizeWindow) via the main.tsx seam helper, and
// the harness waits for EVERY visible window's canvas before screenshotting.
//
// No browser download: puppeteer-core points at the system Chrome.

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
// Default to the local (corpus-derived, gitignored) spec.json if present, else
// the committed corpus-free spec.example.json.
let specPath = resolve(HERE, process.argv[2] || "spec.json");
if (!existsSync(specPath)) specPath = resolve(HERE, "spec.example.json");
const outDir = resolve(HERE, process.argv[3] || "out");
const spec = JSON.parse(await readFile(specPath, "utf8"));
const WEB = resolve(HERE, spec.web || "../../src/quantized/web");
const PORT = 8791;

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
];
const CHROME = process.env.QZ_CHROME || CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) throw new Error("No Chrome found; set QZ_CHROME=<path to chrome>");
if (!existsSync(join(WEB, "index.html")))
  throw new Error(`Built SPA not found at ${WEB}. Run: cd frontend && npm run build`);

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

// Static server with SPA fallback (unknown route -> index.html).
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  let file = join(WEB, p);
  if (!existsSync(file) || !extname(file)) file = join(WEB, "index.html");
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("404");
  }
});
await new Promise((r) => server.listen(PORT, r));

await mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=2", "--hide-scrollbars"],
  defaultViewport: { width: 1200, height: 780 },
});

const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.stack || e.message}`));

await page.goto(`http://localhost:${PORT}/?harness=1`, { waitUntil: "networkidle2", timeout: 20000 });
await page.waitForFunction("window.__qz && window.__qz.useApp", { timeout: 10000 });
{
  const diag = await page.evaluate(() => {
    const root = document.getElementById("root");
    return {
      rootKids: root ? root.childElementCount : -1,
      bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 240),
      hasStage: !!document.querySelector(".qzk-stage, .qzk-stage-cell"),
      stateKeys: Object.keys(window.__qz.useApp.getState()).length,
    };
  });
  logs.push(`[diag pre-inject] ${JSON.stringify(diag)}`);
  console.log("pre-inject:", JSON.stringify(diag));
}

const results = [];
for (const shot of spec.shots) {
  // Inject via the app's REAL addDataset action (it consistently resets the
  // channel-keyed view state: seriesStyles/errKeys/seriesOrder/hiddenChannels/…
  // — raw setState leaves those inconsistent and a useMemo crashes). Clear the
  // library first so shots don't bleed, then apply this shot's plot-state
  // overrides (yKeys/y2Keys/plotTitle/…) AFTER addDataset resets them.
  await page.evaluate((s) => {
    const { useApp } = window.__qz;
    useApp.setState({
      datasets: [],
      folders: [],
      expandedFolders: [],
      activeId: null,
      selectedIds: [],
      originFigures: [],
    });
    // Reset the window canvas too (one maximized unbound window — the store's
    // startup shape) so a previous shot's MDI layout never leaks into this one.
    window.__qz.harnessResetWindows();
    const api = useApp.getState();
    if (s.windows) {
      // MDI layout (MULTI_PLOT_PLAN item 16): datasets + windows built through
      // the REAL store actions via the main.tsx seam helper — addDataset per
      // dataset, createWindow with geometry + view, focus the right one.
      window.__qz.harnessApplyWindows(s.datasets || [], s.windows, s.focusedIndex);
      if (s.stageTab) useApp.getState().setStageTab(s.stageTab);
      if (s.state) useApp.setState(s.state);
    } else if (s.tree) {
      // Build a folder tree: addDataset for each (inits view state), then set the
      // folders + per-dataset folderId + expansion directly (rendering reads them).
      for (const d of s.tree.datasets) api.addDataset(d);
      useApp.setState((st) => ({
        folders: s.tree.folders || [],
        expandedFolders: s.tree.expanded || [],
        datasets: st.datasets.map((d) =>
          s.tree.membership && s.tree.membership[d.id]
            ? { ...d, folderId: s.tree.membership[d.id] }
            : d,
        ),
      }));
    } else if (s.figure) {
      // Replay the real import→apply flow: add every book, register the decoded
      // figures, then applyOriginFigure one entry — the definitive "click a
      // figure to recreate its Origin plot" path (styles + log + curve select).
      for (const d of s.figure.datasets) api.addDataset(d);
      useApp.getState().addOriginFigures(s.figure.stem, s.figure.figures, s.figure.ids);
      if (s.stageTab) useApp.getState().setStageTab(s.stageTab);
      const entryId = `fig-${s.figure.ids[0]}-${s.figure.figureIndex ?? 0}`;
      useApp.getState().applyOriginFigure(entryId);
      if (s.state) useApp.setState(s.state);
    } else {
      api.addDataset(s.dataset);
      if (s.stageTab) useApp.getState().setStageTab(s.stageTab);
      if (s.state) useApp.setState(s.state);
    }
  }, shot);

  // Screenshot target: the plot canvas by default (the whole window canvas
  // for MDI shots), or an explicit selector (e.g. ".qzk-library").
  const isMdi = Array.isArray(shot.windows);
  const target = shot.target || (isMdi ? ".qzk-wincanvas" : ".qzk-stage");
  const isPlot = target === ".qzk-stage";
  await page.waitForSelector(target, { timeout: 6000 }).catch(() => {});
  // MDI shots: wait until EVERY visible window's uPlot canvas exists with real
  // pixels — the focused PlotStage plus each background PlotViewport — before
  // screenshotting (one canvas per non-minimized window).
  const expectedCanvases = isMdi
    ? shot.windows.filter((w) => w.winState !== "minimized").length
    : 0;
  if (isMdi) {
    await page
      .waitForFunction(
        (n) => {
          const cs = [...document.querySelectorAll(".qzk-stage-cell canvas")];
          return cs.length >= n && cs.every((c) => c.width > 0 && c.height > 0);
        },
        { timeout: 8000 },
        expectedCanvases,
      )
      .catch(() => {});
  }
  await new Promise((r) => setTimeout(r, isPlot || isMdi ? 500 : 250));

  const el = (await page.$(target)) || (await page.$(".qzk-stage-cell"));
  const outPath = join(outDir, `${shot.name}.png`);
  if (el) await el.screenshot({ path: outPath });
  else await page.screenshot({ path: outPath }); // fallback: full page

  // For plot shots, confirm a canvas with real dimensions rendered. For MDI
  // shots, confirm ALL expected canvases drew, plus the chrome (frames /
  // focused highlight / minimized-window strip) the layout implies.
  const canvasInfo = isPlot
    ? await page.evaluate(() => {
        const c = document.querySelector(".qzk-stage canvas");
        return c ? { canvas: true, w: c.width, h: c.height } : { canvas: false };
      })
    : isMdi
      ? await page.evaluate((n) => {
          const cs = [...document.querySelectorAll(".qzk-stage-cell canvas")];
          return {
            canvas: cs.length >= n && cs.every((c) => c.width > 0 && c.height > 0),
            canvases: cs.length,
            frames: document.querySelectorAll(".qzk-plotwin").length,
            focusedFrames: document.querySelectorAll(".qzk-plotwin.focused").length,
            stripItems: document.querySelectorAll(".qzk-winstrip-item").length,
          };
        }, expectedCanvases)
      : { canvas: "n/a" };
  results.push({ name: shot.name, out: outPath, ...canvasInfo });
  const mdiNote = isMdi
    ? ` canvases=${canvasInfo.canvases}/${expectedCanvases} frames=${canvasInfo.frames} focused=${canvasInfo.focusedFrames} strip=${canvasInfo.stripItems}`
    : "";
  console.log(
    `shot ${shot.name}: target=${target} canvas=${canvasInfo.canvas} ${canvasInfo.w || ""}${mdiNote} -> ${outPath}`,
  );
}

await writeFile(join(outDir, "console.log"), logs.join("\n"), "utf8");
await browser.close();
server.close();
console.log(`\ndone: ${results.length} shot(s) in ${outDir} (console.log has ${logs.length} browser messages)`);
if (results.some((r) => !r.canvas)) {
  console.error("WARNING: some shots produced no <canvas> — see console.log");
  process.exitCode = 2;
}
