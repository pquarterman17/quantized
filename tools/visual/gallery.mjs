// HTML gallery generator (Origin plan item #39): pairs the COM-export oracle
// (`_exports/<project>/manifest.json` + PNGs, produced by a parallel COM
// agent) against quantized's own per-figure renders
// (`_exports/<project>/quantized_manifest.json` + `quantized/*.png`, produced
// by origin_figures.mjs) plus the structural_report.json into one static,
// self-contained gallery.html for the owner to eyeball side-by-side.
//
// The gallery + every PNG it references live entirely under the gitignored
// `test-data/origin/_exports/` corpus-export tree and are NEVER committed --
// only this generator (and origin_figures.mjs) are.
//
// Usage: node gallery.mjs --project <name> [--exports-root <dir>]

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { exportsDirFor, parseArgs } from "./origin_shared.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.project) {
  console.error("usage: node gallery.mjs --project <name> [--exports-root <dir>]");
  process.exit(1);
}
const PROJECT = String(args.project);
const EXPORTS_DIR = exportsDirFor(PROJECT, args["exports-root"]);

const CHIPS = [
  { key: "scales", label: "Scales" },
  { key: "ticks", label: "Ticks" },
  { key: "legend", label: "Legend" },
  { key: "colours", label: "Colours" },
  { key: "markers", label: "Markers" },
  { key: "annotations", label: "Annotations" },
  { key: "panels", label: "Panels" },
];

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function chipsHtml(figureKey) {
  return CHIPS.map(
    (c) =>
      `<button class="chip" data-fig="${esc(figureKey)}" data-chip="${c.key}" title="${esc(c.label)}">${esc(c.label)}</button>`,
  ).join("");
}

function structuralBadge(entry) {
  if (!entry) return `<span class="badge badge-none" title="no structural data">n/a</span>`;
  if (entry.resolved === false) return `<span class="badge badge-unresolved" title="figure did not resolve to a dataset">unresolved</span>`;
  if (entry.pass) return `<span class="badge badge-pass" title="all structural checks passed">structural ok</span>`;
  const failed = (entry.checks || []).filter((c) => !c.pass).map((c) => c.name);
  return `<span class="badge badge-fail" title="${esc(failed.join(", "))}">structural: ${failed.length} mismatch${failed.length === 1 ? "" : "es"}</span>`;
}

async function main() {
  const originManifest = await readJson(join(EXPORTS_DIR, "manifest.json"), null);
  if (!originManifest) throw new Error(`no Origin oracle manifest.json at ${EXPORTS_DIR} — export it first`);
  const qzManifest = await readJson(join(EXPORTS_DIR, "quantized_manifest.json"), { figures: {} });
  const structReport = await readJson(join(EXPORTS_DIR, "structural_report.json"), { figures: [] });
  const structByName = new Map(structReport.figures.map((f) => [f.name, f]));

  const originFigs = originManifest.graphs || {};
  const qzFigs = qzManifest.figures || {};

  const originNames = new Set(Object.keys(originFigs));
  const qzNames = new Set(Object.keys(qzFigs));

  const paired = [];
  const originIncomplete = []; // Origin manifest entry exists but never finished (no PNG) -- e.g. Graph18
  const originOnly = []; // Origin has a real PNG, quantized has no match / unresolved
  const quantizedOnly = []; // quantized rendered a window Origin has no PNG for

  for (const name of new Set([...originNames, ...qzNames])) {
    const o = originFigs[name];
    const q = qzFigs[name];
    const oOk = o && o.status === "ok" && o.file;
    const qOk = q && q.resolved && q.file;
    if (oOk && qOk) paired.push(name);
    else if (o && !oOk) originIncomplete.push(name);
    else if (oOk && !qOk) originOnly.push(name);
    else if (!o && q) quantizedOnly.push(name);
    else if (o && q && !oOk && !qOk) originIncomplete.push(name); // both failed -- origin's incompleteness dominates the note
  }
  paired.sort();
  originIncomplete.sort();
  originOnly.sort();
  quantizedOnly.sort();

  const counts = {
    paired: paired.length,
    originIncomplete: originIncomplete.length,
    originOnly: originOnly.length,
    quantizedOnly: quantizedOnly.length,
  };

  const pairedRows = paired
    .map((name) => {
      const o = originFigs[name];
      const q = qzFigs[name];
      const struct = structByName.get(name);
      return `
      <div class="row" data-fig="${esc(name)}">
        <div class="row-head">
          <h3>${esc(name)}</h3>
          <span class="folder">${esc(q.folder || o.folder || "")}</span>
          ${structuralBadge(struct)}
        </div>
        <div class="imgs">
          <figure>
            <figcaption>Origin</figcaption>
            <img loading="lazy" src="${esc(o.file)}" alt="Origin render of ${esc(name)}">
          </figure>
          <figure>
            <figcaption>quantized${q.mode && q.mode !== "single" ? ` (${esc(q.mode)})` : ""}</figcaption>
            <img loading="lazy" src="${esc(q.file)}" alt="quantized render of ${esc(name)}">
          </figure>
        </div>
        <div class="chips">${chipsHtml(name)}</div>
      </div>`;
    })
    .join("\n");

  const unpairedSection = (title, names, note) =>
    names.length
      ? `
    <section class="unpaired">
      <h2>${esc(title)} (${names.length})</h2>
      ${note ? `<p class="note">${note}</p>` : ""}
      <ul class="unpaired-list">
        ${names
          .map((name) => {
            const o = originFigs[name];
            const q = qzFigs[name];
            const img = o?.status === "ok" && o.file ? o.file : q?.resolved && q.file ? `${q.file}` : null;
            return `<li>
              <strong>${esc(name)}</strong>
              <span class="folder">${esc(q?.folder || o?.folder || "")}</span>
              ${o && o.status !== "ok" ? `<span class="tag">origin status: ${esc(o.status)}</span>` : ""}
              ${q && q.resolved === false ? `<span class="tag">quantized: ${esc(q.reason || "unresolved")}</span>` : ""}
              ${img ? `<div class="thumb"><img loading="lazy" src="${esc(img)}" alt="${esc(name)}"></div>` : ""}
            </li>`;
          })
          .join("\n")}
      </ul>
    </section>`
      : "";

  const html = `<title>Origin ↔ quantized figure gallery — ${esc(PROJECT)}</title>
<meta charset="utf-8">
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f7f8; --fg: #1b1e23; --card: #ffffff; --border: #d8dae0;
    --accent: #2f6fed; --ok: #1b8a4c; --bad: #c23b3b; --muted: #6b7280;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #14161a; --fg: #e7e9ee; --card: #1c1f26; --border: #30343d; --muted: #9aa1ad; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 32px 64px; background: var(--bg); color: var(--fg);
         font: 14px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 8px; }
  h3 { font-size: 15px; margin: 0; font-family: "JetBrains Mono", ui-monospace, monospace; }
  .summary { display: flex; gap: 18px; flex-wrap: wrap; margin: 10px 0 28px; }
  .summary .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
                   padding: 8px 14px; }
  .summary .stat b { font-size: 18px; display: block; }
  .toolbar { margin: 8px 0 20px; }
  .toolbar button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border);
                    background: var(--card); color: var(--fg); cursor: pointer; }
  .toolbar button:hover { border-color: var(--accent); }
  .row { background: var(--card); border: 1px solid var(--border); border-radius: 10px;
         padding: 14px 16px; margin-bottom: 16px; }
  .row-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .folder { color: var(--muted); font-size: 12px; font-family: ui-monospace, monospace; }
  .imgs { display: flex; gap: 14px; flex-wrap: wrap; }
  .imgs figure { margin: 0; flex: 1 1 420px; min-width: 260px; }
  .imgs figcaption { font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase;
                      letter-spacing: 0.04em; }
  .imgs img { width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--border); display: block; }
  .chips { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px;
          border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; }
  .chip.ok { background: color-mix(in srgb, var(--ok) 20%, transparent); border-color: var(--ok); }
  .chip.bad { background: color-mix(in srgb, var(--bad) 20%, transparent); border-color: var(--bad); color: var(--bad); }
  .badge { font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); }
  .badge-pass { color: var(--ok); border-color: var(--ok); }
  .badge-fail { color: var(--bad); border-color: var(--bad); }
  .badge-unresolved, .badge-none { color: var(--muted); }
  .unpaired-list { list-style: none; margin: 0; padding: 0; display: grid;
                   grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .unpaired-list li { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
  .unpaired-list .tag { display: inline-block; font-size: 11px; color: var(--muted); margin-left: 6px; }
  .thumb img { width: 100%; border-radius: 6px; margin-top: 6px; border: 1px solid var(--border); }
  .note { color: var(--muted); font-size: 12px; }
  section.unpaired { border-top: 1px dashed var(--border); padding-top: 8px; }
</style>

<h1>Origin ↔ quantized figure gallery</h1>
<div class="note">project: <strong>${esc(PROJECT)}</strong> — generated ${esc(new Date().toISOString())}</div>
<div class="summary">
  <div class="stat"><b>${counts.paired}</b>paired</div>
  <div class="stat"><b>${counts.originOnly}</b>origin-only</div>
  <div class="stat"><b>${counts.quantizedOnly}</b>quantized-only</div>
  <div class="stat"><b>${counts.originIncomplete}</b>origin export incomplete</div>
  <div class="stat"><b>${structReport.totals?.fully_consistent ?? "?"}</b>structurally consistent</div>
  <div class="stat"><b>${structReport.totals?.with_mismatches ?? "?"}</b>structural mismatches</div>
</div>
<div class="toolbar">
  <button id="reset-marks">Clear my eyeball marks for this project</button>
</div>

<section>
  <h2>Paired (${counts.paired})</h2>
  ${pairedRows}
</section>

${unpairedSection("Origin export incomplete", originIncomplete, "The COM export never finished for these windows (no PNG produced) — see the oracle manifest's <code>status</code> field.")}
${unpairedSection("Origin-only (no quantized match)", originOnly, "quantized either didn't decode a graph window with this name, or the figure didn't resolve to an imported dataset.")}
${unpairedSection("Quantized-only (no Origin PNG)", quantizedOnly, "quantized rendered a graph window the Origin oracle export has no PNG for.")}

<script>
(function () {
  var PROJECT = ${JSON.stringify(PROJECT)};
  var STORE_PREFIX = "qz-origin-gallery:" + PROJECT + ":";
  var STATES = ["", "ok", "bad"]; // neutral -> ok -> mismatch -> neutral

  function chipKey(fig, chip) { return STORE_PREFIX + fig + ":" + chip; }

  function applyState(btn, state) {
    btn.classList.remove("ok", "bad");
    if (state) btn.classList.add(state);
  }

  document.querySelectorAll(".chip").forEach(function (btn) {
    var saved = localStorage.getItem(chipKey(btn.dataset.fig, btn.dataset.chip)) || "";
    applyState(btn, saved);
  });

  document.body.addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn) return;
    var key = chipKey(btn.dataset.fig, btn.dataset.chip);
    var current = STATES.indexOf(localStorage.getItem(key) || "");
    var next = STATES[(current + 1) % STATES.length];
    if (next) localStorage.setItem(key, next);
    else localStorage.removeItem(key);
    applyState(btn, next);
  });

  document.getElementById("reset-marks").addEventListener("click", function () {
    if (!confirm("Clear every eyeball mark for " + PROJECT + "?")) return;
    Object.keys(localStorage)
      .filter(function (k) { return k.indexOf(STORE_PREFIX) === 0; })
      .forEach(function (k) { localStorage.removeItem(k); });
    document.querySelectorAll(".chip").forEach(function (btn) { applyState(btn, ""); });
  });
})();
</script>
`;

  const outPath = join(EXPORTS_DIR, "gallery.html");
  await writeFile(outPath, html, "utf8");
  console.log(`gallery written -> ${outPath}`);
  console.log(`  paired=${counts.paired} originOnly=${counts.originOnly} quantizedOnly=${counts.quantizedOnly} originIncomplete=${counts.originIncomplete}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
