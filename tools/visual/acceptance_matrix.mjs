// Aggregate gitignored per-project Origin comparison artifacts into a durable
// corpus-wide JSON + CSV matrix. Private projects and images remain external.
//
// Usage:
//   node acceptance_matrix.mjs [--projects Moke,PNR] [--exports-root <_exports>]

import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  acceptanceCsv,
  buildAcceptanceRows,
  summarizeAcceptanceRows,
} from "./origin_acceptance.mjs";
import { findTestDataRoot, parseArgs } from "./origin_shared.mjs";

async function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

async function projectRows(root, project) {
  const dir = join(root, project);
  const review = await readJson(join(dir, "review.json"),
    await readJson(join(dir, `${project}-review.json`), null));
  return buildAcceptanceRows(
    project,
    await readJson(join(dir, "manifest.json")),
    await readJson(join(dir, "quantized_manifest.json")),
    await readJson(join(dir, "structural_report.json")),
    review,
  );
}

function hasProjectArtifacts(root, project) {
  const dir = join(root, project);
  return ["manifest.json", "quantized_manifest.json", "structural_report.json"]
    .some((name) => existsSync(join(dir, name)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args["exports-root"]
    ? resolve(args["exports-root"])
    : resolve(findTestDataRoot(), "origin", "_exports");
  const requested = args.projects
    ? String(args.projects).split(",").map((name) => name.trim()).filter(Boolean)
    : null;
  if (requested) {
    const missing = requested.filter((project) => !hasProjectArtifacts(root, project));
    if (missing.length) throw new Error(`no comparison artifacts for requested project(s): ${missing.join(", ")}`);
  }
  const projects = requested || (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && hasProjectArtifacts(root, entry.name))
    .map((entry) => entry.name)
    .sort();
  const rows = (await Promise.all(projects.map((project) => projectRows(root, project)))).flat();
  const totals = summarizeAcceptanceRows(rows, projects.length);
  const jsonPath = join(root, "acceptance_matrix.json");
  const csvPath = join(root, "acceptance_matrix.csv");
  await writeFile(jsonPath, JSON.stringify({ version: 1, generated: new Date().toISOString(), totals, rows }, null, 2), "utf8");
  await writeFile(csvPath, acceptanceCsv(rows), "utf8");
  console.log(`Origin acceptance matrix: ${rows.length} graph(s) across ${projects.length} project(s)`);
  console.log(`  JSON -> ${jsonPath}`);
  console.log(`  CSV  -> ${csvPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
