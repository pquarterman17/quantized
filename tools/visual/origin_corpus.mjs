// Sequential real-browser Origin corpus campaign runner (decode-plan #55).
// Keeps the 127 MB projects out of parallel backends, writes a gitignored
// strict summary, and rebuilds the durable acceptance matrix afterward.
//
// Usage:
//   node origin_corpus.mjs [--projects Moke,PNR] [--port 8793]
//     [--corpus-root <test-data/origin>] [--exports-root <origin/_exports>]

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeCorpusReports } from "./origin_acceptance.mjs";
import { findTestDataRoot, parseArgs } from "./origin_shared.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function runNode(script, args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(HERE, script), ...args], {
      cwd: HERE,
      stdio: "inherit",
    });
    child.on("error", () => done(-1));
    child.on("exit", (code) => done(code ?? -1));
  });
}

async function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusRoot = args["corpus-root"]
    ? resolve(args["corpus-root"])
    : resolve(findTestDataRoot(), "origin");
  const exportsRoot = args["exports-root"]
    ? resolve(args["exports-root"])
    : join(corpusRoot, "_exports");
  const requested = args.projects
    ? new Set(String(args.projects).split(",").map((name) => name.trim()).filter(Boolean))
    : null;
  const entries = (await readdir(corpusRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(opj|opju)$/i.test(entry.name))
    .map((entry) => ({
      file: join(corpusRoot, entry.name),
      project: basename(entry.name, entry.name.toLowerCase().endsWith(".opju") ? ".opju" : ".opj"),
    }))
    .filter(({ project }) => !requested || requested.has(project))
    .sort((a, b) => a.project.localeCompare(b.project));
  if (requested) {
    const found = new Set(entries.map((entry) => entry.project));
    const missing = [...requested].filter((project) => !found.has(project));
    if (missing.length) throw new Error(`Origin project(s) not found: ${missing.join(", ")}`);
  }
  if (!entries.length) throw new Error(`no .opj/.opju projects found under ${corpusRoot}`);

  await mkdir(exportsRoot, { recursive: true });
  const basePort = Number(args.port || 8793);
  const runs = [];
  for (const [index, entry] of entries.entries()) {
    const projectDir = join(exportsRoot, entry.project);
    console.log(`\n=== Origin corpus ${index + 1}/${entries.length}: ${entry.project} ===`);
    const renderExit = await runNode("origin_figures.mjs", [
      "--opj", entry.file,
      "--project", entry.project,
      "--exports-root", projectDir,
      "--port", String(basePort + index),
    ]);
    const galleryExit = existsSync(join(projectDir, "manifest.json"))
      ? await runNode("gallery.mjs", ["--project", entry.project, "--exports-root", projectDir])
      : 0;
    runs.push({
      project: entry.project,
      exitCode: renderExit || galleryExit,
      report: await readJson(join(projectDir, "structural_report.json")),
    });
  }

  const summary = summarizeCorpusReports(runs);
  const summaryPath = join(exportsRoot, "corpus_render_summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  const projectArg = entries.map((entry) => entry.project).join(",");
  const matrixExit = await runNode("acceptance_matrix.mjs", [
    "--projects", projectArg,
    "--exports-root", exportsRoot,
  ]);

  console.log(`\nOrigin corpus: ${summary.totals.graphs} graph(s) across ${summary.totals.projects} project(s)`);
  console.log(`  resolved=${summary.totals.resolved} unresolved=${summary.totals.unresolved}`);
  console.log(`  renderer_failures=${summary.totals.renderer_failures} process_failures=${summary.totals.process_failures}`);
  console.log(`  summary -> ${summaryPath}`);
  if (!summary.strict_pass || matrixExit !== 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
