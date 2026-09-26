// Saved analysis templates / transformation recipes IN THE PROJECT FILE
// (.dwk) — P2.5 box 4, the same bridge PR #432 built for saved fit models
// (lib/fitModelsProject.ts; read its header, this follows it). Reached only
// through the lazy `.dwk` codec, so none of it is eager.
//
// WHAT A SAVE EMBEDS (`analysisTemplates`, top level): every readable template
// in the local library, as its file form (lib/template.ts's `toTemplate`
// shape). The key is written only when there is something to write, so a
// project saved with no templates is byte-identical to one saved before this
// existed, and an older build never reads it (the parser picks fields by name)
// — no schema bump. The crash-recovery autosave embeds none: it is restored
// on this machine, where the library already lives.
//
// WHAT AN OPEN DOES, per incoming template in file order, against the local
// library as it stands — the fit-model rule:
//   1. a local template whose BASE name matches holds the same definition
//      (steps, outputs, description, expected input — NOT the revision, which
//      only counts saves): nothing;
//   2. the name is free locally: added under its own name, revision kept;
//   3. otherwise added as "<base> (from project)", "(from project 2)", …
// One storage write, then one toast. Never overwrites or deletes a local
// template. Adding to the library is not undoable (the library is not
// project state), exactly like saving a template from the Pipeline workshop.
//
// UNREADABLE RECORDS (a newer build's version, a damaged entry) are reported
// as a migration warning and NOT kept. Unlike fit models there is no carry:
// the local template slot itself does not keep unreadable records either
// (`saveTemplate` rewrites it from the readable ones), so a carry would only
// move the loss one save later. Deferred, named in the plan.

import { loadTemplates, parseTemplate, saveTemplates, type AnalysisTemplate } from "./template";
import { toast } from "../store/toasts";

/** The file's `analysisTemplates` field → the templates this build reads.
 *  `undefined` (every project saved before this) is empty. */
export function splitProjectTemplates(raw: unknown, migrationWarnings: string[]): AnalysisTemplate[] {
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: AnalysisTemplate[] = [];
  let bad = 0;
  for (const r of list) {
    try {
      out.push(parseTemplate(JSON.stringify(r)));
    } catch {
      bad++;
    }
  }
  if (bad) {
    migrationWarnings.push(
      `${bad} saved analysis template${bad === 1 ? "" : "s"} / transformation recipe${bad === 1 ? "" : "s"} in this project could not be read by this build and ${bad === 1 ? "was" : "were"} skipped`,
    );
  }
  return out;
}

/** What a save writes: the local library's templates (file form, no ids).
 *  Empty when `library` is false (the crash-recovery autosave). */
export function projectTemplatesForSave(library = true): AnalysisTemplate[] {
  return library ? loadTemplates().map((t) => ({ ...t, steps: t.steps.map((s) => ({ ...s, id: "" })) })) : [];
}

/** A template's DEFINITION (rule 1): everything but its name and revision. */
function definitionKey(t: AnalysisTemplate): string {
  return JSON.stringify([
    t.steps.map((s) => [s.kind, s.label, s.code, s.params, s.enabled]),
    t.outputs,
    t.description ?? "",
    t.expects ?? null,
  ]);
}

const SUFFIX = / \(from project(?: \d+)?\)$/;

function baseName(name: string): string {
  let b = name;
  while (SUFFIX.test(b)) b = b.replace(SUFFIX, "");
  return b || name;
}

function freeName(name: string, taken: ReadonlySet<string>): string {
  const base = baseName(name);
  const at = (k: number): string => (k === 1 ? `${base} (from project)` : `${base} (from project ${k})`);
  let n = 1;
  while (taken.has(at(n))) n++;
  return at(n);
}

export interface TemplateAdoption {
  added: string[];
  renamed: { from: string; to: string }[];
}

/** Merge a project's templates into the local library (the rule above). */
export function mergeProjectTemplates(incoming: readonly AnalysisTemplate[]): TemplateAdoption {
  const result: TemplateAdoption = { added: [], renamed: [] };
  if (!incoming.length) return result;
  const local = loadTemplates();
  const taken = new Set(local.map((t) => t.name));
  const held = new Set(local.map((t) => `${baseName(t.name)}\u0000${definitionKey(t)}`));
  const toWrite: AnalysisTemplate[] = [];
  for (const t of incoming) {
    const key = `${baseName(t.name)}\u0000${definitionKey(t)}`;
    if (held.has(key)) continue; // rule 1
    const name = taken.has(t.name) ? freeName(t.name, taken) : t.name;
    toWrite.push({ ...t, name });
    if (name === t.name) result.added.push(name);
    else result.renamed.push({ from: t.name, to: name });
    taken.add(name);
    held.add(key);
  }
  if (toWrite.length) saveTemplates([...local, ...toWrite]);
  return result;
}

/** The load/append hook (store/workspaceHydration.ts, through the codec):
 *  merge and toast once, or nothing when the project brought nothing new. */
export function adoptProjectTemplates(ws: { projectTemplates?: readonly AnalysisTemplate[] }): void {
  const { added, renamed } = mergeProjectTemplates(ws.projectTemplates ?? []);
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.length === 1 ? "1 saved template" : `${added.length} saved templates`} from the project: ${added.map((n) => `"${n}"`).join(", ")}`);
  if (renamed.length) {
    parts.push(
      `${renamed.length === 1 ? "1 template differs" : `${renamed.length} templates differ`} from yours under the same name; yours kept, the project's added as ${renamed.map((r) => `"${r.to}"`).join(", ")}`,
    );
  }
  if (parts.length) toast(parts.join(". "));
}
