// PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 FINAL residual wave — combines the
// per-harness JSON outputs (map_envelope.mjs, export_envelope.mjs,
// workspace_envelope.mjs x N runs, plus the backend-only
// tools/baselines/measure_map_regrid.py supplement) into the single
// committed deliverable `docs/envelope/2026-07-27-final-residuals.json`.
//
// Kept separate from each measurement script (which stay independently
// runnable/reusable, same as frontend_envelope.mjs / workspace_envelope.mjs
// always have) — this is pure assembly, no measurement of its own.
//
// Usage:
//   node assemble_final_residuals.mjs \
//     --map <map.json> --export <export.json> \
//     --workspace <run1.json> --workspace <run2.json> --workspace <run3.json> \
//     --map-regrid <map_regrid.json> \
//     --out ../../docs/envelope/2026-07-27-final-residuals.json

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

import { parseArgs, REPO_ROOT } from "../visual/origin_shared.mjs";

// parseArgs (origin_shared.mjs) only keeps the LAST occurrence of a repeated
// flag, so --workspace can't collect N runs through it — parse that one
// flag manually instead.
function collectRepeated(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length) out.push(argv[++i]);
  }
  return out;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const workspacePaths = collectRepeated(argv, "--workspace");
  const outPath = args.out ? args.out : join(REPO_ROOT, "docs", "envelope", "2026-07-27-final-residuals.json");

  const mapDoc = args.map ? await readJson(args.map) : null;
  const exportDoc = args.export ? await readJson(args.export) : null;
  const mapRegridDoc = args["map-regrid"] ? await readJson(args["map-regrid"]) : null;
  const workspaceRuns = [];
  for (const p of workspacePaths) {
    workspaceRuns.push(await readJson(p));
  }

  const hardware = mapDoc?.hardware ?? exportDoc?.hardware ?? workspaceRuns[0]?.hardware ?? null;

  const out = {
    plan_item:
      "PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 FINAL residual measurement wave — the last locally-measurable envelope residuals: browser-side 2-D maps (M1), 1M-row copy/export from the UI (M2), merged-tree workspace re-run with a focus-pin determinism fix (M3)",
    generated: new Date().toISOString(),
    hardware,
    measurements: {
      M1_browser_maps: mapDoc ? { generated: mapDoc.generated, results: mapDoc.results } : null,
      M1_supplementary_backend_isolated_regrid: mapRegridDoc,
      M2_export_copy_1M: exportDoc ? { generated: exportDoc.generated, results: exportDoc.results } : null,
      M3_workspace_runs: workspaceRuns.map((d, i) => ({ run: i + 1, generated: d.generated, results: d.results })),
    },
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(out, null, 2), "utf8");
  const totalRows =
    (mapDoc?.results?.length ?? 0) +
    (exportDoc?.results?.length ?? 0) +
    workspaceRuns.reduce((n, d) => n + (d.results?.length ?? 0), 0);
  console.log(`wrote ${outPath} (${totalRows} measurement rows across ${1 + 1 + workspaceRuns.length} harness runs)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
