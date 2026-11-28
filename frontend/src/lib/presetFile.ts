// Export and import of named presets (plans/PRESET_BAR_CONTRACT.md slice P5).
//
// The file is settings only: per preset the tool, name, settings schema and
// settings (never a dataset id, a row range or a local id: P5), versioned by
// the envelope (`kind` + `version`). Import is fail closed:
//  - a malformed file (bad JSON, wrong kind or version, a malformed entry)
//    imports NOTHING and says why;
//  - every entry is validated through its tool's adapter (P6): an unknown or
//    ill-typed field is skipped with the reason, an unknown tool is skipped and
//    named, a newer schema is kept LOCKED (P7, stored verbatim, never applied);
//  - a name clash is never overwritten: the import is renamed "<name>
//    (imported)", the way a project's templates become "(from project)";
//  - a preset whose settings are IDENTICAL to one already stored for that tool
//    (whatever either is called) is skipped and named as already present, so
//    importing the same file twice adds nothing;
//  - the generic store is written once and read back, so a refused write
//    imports nothing from it.
// Tools whose presets live in a legacy store (Curve Fit's fit templates, Peaks'
// recipes) import through that store's own backend, so a preset lands where the
// tool reads it; those stores cannot hold a locked record, so a newer-schema
// preset for them is skipped (named, with the reason), never dropped silently.
//
// Lazy: used only from the preset manager and the Recipe Library.

import { canonicalJson, type PresetAdapter } from "./presetAdapter";
import {
  asRecord, MAX_NAME_CHARS, MAX_PRESETS_PER_WORKSHOP, MAX_RECORD_CHARS, newPresetId, readPresetsFile, resolveSettings,
  samePresetName, writePresetsFile, type PresetRecord,
} from "./presets";

/** Adapters are looked up by workshop id; settings are validated through `parse`, so the type parameter is erased here. */
export type AnyPresetAdapter = PresetAdapter<object>;

export const PRESET_FILE_KIND = "qz-presets";
export const PRESET_FILE_VERSION = 1;
export const MAX_FILE_CHARS = 8 * 1024 * 1024;
export const MAX_FILE_PRESETS = 5000;

export interface FilePreset {
  workshop: string;
  name: string;
  schema: number;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Skipped {
  workshop: string;
  name: string;
  reason: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- export

export type ExportResult = { ok: true; text: string; exported: number; skipped: Skipped[] } | { ok: false; reason: string };

/** Serialize the presets of `workshop` (every tool when null) for `adapters`. */
export function exportPresets(adapters: ReadonlyMap<string, AnyPresetAdapter>, workshop: string | null): ExportResult {
  const presets: FilePreset[] = [];
  const skipped: Skipped[] = [];
  const wanted = (id: string) => workshop === null || workshop === id;

  const file = readPresetsFile();
  if (!file.ok) return { ok: false, reason: file.reason };
  for (const raw of file.records) {
    const rec = asRecord(raw);
    if (!rec || !wanted(rec.workshop)) continue;
    const adapter = adapters.get(rec.workshop);
    if (!adapter) {
      skipped.push({ workshop: rec.workshop, name: rec.name, reason: "not a tool this version of Quantized knows" });
      continue;
    }
    if (adapter.backend) continue; // that tool's presets live in its own store (below)
    const r = resolveSettings(adapter, rec.schema, rec.settings);
    // A newer-schema (locked) record is exported verbatim so it survives a trip through a file; an unreadable one is not.
    if (r.state === "rejected") skipped.push({ workshop: rec.workshop, name: rec.name, reason: r.reason });
    else presets.push({ workshop: rec.workshop, name: rec.name, schema: rec.schema, settings: rec.settings, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
  }
  for (const [id, adapter] of adapters) {
    if (!adapter.backend || !wanted(id)) continue;
    for (const e of adapter.backend.list().entries) {
      if (e.state === "ok") presets.push({ workshop: id, name: e.name, schema: adapter.schema, settings: { ...e.settings } as Record<string, unknown>, createdAt: e.updatedAt, updatedAt: e.updatedAt });
      else skipped.push({ workshop: id, name: e.name, reason: e.reason });
    }
  }
  if (presets.length === 0) return { ok: false, reason: skipped.length ? "nothing could be exported: " + skipped.map((s) => `'${s.name}' (${s.reason})`).join("; ") : "there are no presets to export" };
  const body = { kind: PRESET_FILE_KIND, version: PRESET_FILE_VERSION, exportedAt: new Date().toISOString(), presets };
  return { ok: true, text: JSON.stringify(body, null, 2), exported: presets.length, skipped };
}

// ---------------------------------------------------------------- import

export type ParsedFile = { ok: true; presets: FilePreset[] } | { ok: false; reason: string };

const isoOr = (v: unknown, fallback: string): string => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : fallback);

/** Read the envelope and the SHAPE of every entry. Anything else wrong with the file refuses the whole file. */
export function parsePresetFile(text: string): ParsedFile {
  if (text.length > MAX_FILE_CHARS) return { ok: false, reason: "the file is too large to be a preset file" };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the file is not valid JSON" };
  }
  if (!isObject(body) || body.kind !== PRESET_FILE_KIND) return { ok: false, reason: "this is not a Quantized preset file" };
  if (body.version !== PRESET_FILE_VERSION) {
    return { ok: false, reason: typeof body.version === "number" && body.version > PRESET_FILE_VERSION ? "the file was saved by a newer version of Quantized" : "the preset file version is not recognised" };
  }
  if (!Array.isArray(body.presets)) return { ok: false, reason: "the file has no presets list" };
  if (body.presets.length > MAX_FILE_PRESETS) return { ok: false, reason: `the file holds more than ${MAX_FILE_PRESETS} presets` };
  const now = new Date().toISOString();
  const presets: FilePreset[] = [];
  for (const [i, e] of body.presets.entries()) {
    if (!isObject(e) || typeof e.workshop !== "string" || typeof e.name !== "string" || typeof e.schema !== "number" || !Number.isInteger(e.schema) || e.schema < 1 || !isObject(e.settings)) {
      return { ok: false, reason: `preset ${i + 1} is malformed (it needs a tool, a name, a schema number and settings)` };
    }
    presets.push({ workshop: e.workshop, name: e.name, schema: e.schema, settings: e.settings, createdAt: isoOr(e.createdAt, now), updatedAt: isoOr(e.updatedAt, now) });
  }
  return { ok: true, presets };
}

export interface Renamed {
  workshop: string;
  from: string;
  to: string;
}

export type ImportResult =
  | { ok: false; reason: string }
  | { ok: true; imported: number; locked: number; skipped: Skipped[]; renamed: Renamed[]; notes: string[] };

const contentKey = (workshop: string, schema: number, settings: unknown): string => `${workshop}|${schema}|${canonicalJson(settings)}`;

/** `name` made unique among `taken` by "(imported)", "(imported 2)", ... within the name limit. */
function uniqueName(name: string, clashes: (candidate: string) => boolean): string {
  if (!clashes(name)) return name;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (imported)" : ` (imported ${n})`;
    const candidate = name.slice(0, MAX_NAME_CHARS - suffix.length) + suffix;
    if (!clashes(candidate)) return candidate;
  }
}

/** Which of the stored presets with this content to name: the one with the file preset's own name, else the first. */
function sameNameFirst(names: readonly string[], name: string, same: (a: string, b: string) => boolean): string | undefined {
  return names.find((n) => same(n, name)) ?? names[0];
}

/** Import already-parsed entries. Validation is by the tool's own adapter; see the header for the rules. */
export function importParsed(presets: readonly FilePreset[], adapters: ReadonlyMap<string, AnyPresetAdapter>): ImportResult {
  const file = readPresetsFile();
  if (!file.ok) return { ok: false, reason: file.reason };
  const records: unknown[] = [...file.records];
  const taken = new Map<string, Set<string>>(); // workshop -> lower-cased names in the generic store
  const counts = new Map<string, number>();
  for (const raw of records) {
    const rec = asRecord(raw);
    if (!rec) continue;
    (taken.get(rec.workshop) ?? taken.set(rec.workshop, new Set()).get(rec.workshop)!).add(rec.name.trim().toLowerCase());
    counts.set(rec.workshop, (counts.get(rec.workshop) ?? 0) + 1);
  }
  const ids = new Set(records.map((r) => asRecord(r)?.id ?? ""));
  // What each tool already holds, by content: a file preset equal to one of these is not added again.
  const held = new Map<string, string[]>(); // workshop|schema|settings -> the stored presets' names
  for (const raw of records) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const key = contentKey(rec.workshop, rec.schema, rec.settings);
    held.set(key, [...(held.get(key) ?? []), rec.name]);
  }
  const skipped: Skipped[] = [];
  const renamed: Renamed[] = [];
  const notes: string[] = [];
  let imported = 0;
  let locked = 0;
  const legacy: { adapter: AnyPresetAdapter; entry: FilePreset; settings: object }[] = [];
  const added: PresetRecord[] = [];

  for (const e of presets) {
    const skip = (reason: string) => skipped.push({ workshop: e.workshop, name: e.name, reason });
    const adapter = adapters.get(e.workshop);
    if (!adapter) {
      skip(`unknown tool '${e.workshop}'`);
      continue;
    }
    const name = e.name.trim();
    if (!name || name.length > MAX_NAME_CHARS) {
      skip(name ? `the name is longer than ${MAX_NAME_CHARS} characters` : "the name is empty");
      continue;
    }
    if (JSON.stringify(e).length > MAX_RECORD_CHARS) {
      skip("the settings are too large to be a preset");
      continue;
    }
    const r = resolveSettings(adapter, e.schema, e.settings);
    if (r.state === "rejected") {
      skip(r.reason);
      continue;
    }
    const ok = r.state === "ok" ? r : null;
    if (adapter.backend) {
      if (ok) {
        legacy.push({ adapter, entry: { ...e, name }, settings: ok.settings });
        for (const d of ok.dropped) notes.push(`'${name}': setting '${d}' is no longer supported and was not applied`);
      } else if (r.state !== "ok") skip(`${r.reason}; ${adapter.label} presets cannot be kept locked, so it was not imported`);
      continue;
    }
    const present = sameNameFirst(held.get(contentKey(e.workshop, e.schema, e.settings)) ?? [], name, samePresetName);
    if (present !== undefined) {
      skip(`already present as '${present}'`);
      continue;
    }
    const own = taken.get(e.workshop) ?? taken.set(e.workshop, new Set()).get(e.workshop)!;
    if ((counts.get(e.workshop) ?? 0) >= MAX_PRESETS_PER_WORKSHOP) {
      skip(`at most ${MAX_PRESETS_PER_WORKSHOP} presets per tool`);
      continue;
    }
    const finalName = uniqueName(name, (c) => own.has(c.toLowerCase()));
    if (finalName !== name) renamed.push({ workshop: e.workshop, from: name, to: finalName });
    own.add(finalName.toLowerCase());
    counts.set(e.workshop, (counts.get(e.workshop) ?? 0) + 1);
    const id = newPresetId(ids);
    ids.add(id);
    // Stored as given (original schema and settings): a record is only rewritten by the user's own save of it.
    added.push({ id, workshop: e.workshop, name: finalName, schema: e.schema, settings: e.settings, createdAt: e.createdAt, updatedAt: e.updatedAt });
    if (!ok) locked++;
    else {
      imported++;
      for (const d of ok.dropped) notes.push(`'${finalName}': setting '${d}' is no longer supported and was not applied`);
    }
  }

  if (added.length) {
    const failed = writePresetsFile([...records, ...added]);
    if (failed) return { ok: false, reason: failed };
  }
  for (const { adapter, entry, settings } of legacy) {
    const backend = adapter.backend!;
    const same = backend.sameName ?? samePresetName;
    const now = backend.list().entries;
    const names = now.map((x) => x.name);
    const twins = now.filter((x) => x.state === "ok" && canonicalJson(x.settings) === canonicalJson(settings)).map((x) => x.name);
    const twin = sameNameFirst(twins, entry.name, same);
    if (twin !== undefined) {
      skipped.push({ workshop: entry.workshop, name: entry.name, reason: `already present as '${twin}'` });
      continue;
    }
    const finalName = uniqueName(entry.name, (c) => names.some((n) => same(n, c)));
    const out = backend.save(finalName, settings);
    if (!out.ok) {
      skipped.push({ workshop: entry.workshop, name: entry.name, reason: out.reason });
      continue;
    }
    if (finalName !== entry.name) renamed.push({ workshop: entry.workshop, from: entry.name, to: finalName });
    imported++;
  }
  return { ok: true, imported, locked, skipped, renamed, notes };
}

/** Read a file's text and import it; `loadAdapters` supplies the adapters of the tools the file names. */
export async function importPresetFile(text: string, loadAdapters: (workshops: string[]) => Promise<Map<string, AnyPresetAdapter>>): Promise<ImportResult> {
  const parsed = parsePresetFile(text);
  if (!parsed.ok) return parsed;
  const adapters = await loadAdapters([...new Set(parsed.presets.map((p) => p.workshop))]);
  return importParsed(parsed.presets, adapters);
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The report line: counts imported, skipped and locked, then each skip with its reason. */
export function describeImport(r: ImportResult): string {
  if (!r.ok) return `Nothing was imported: ${r.reason}`;
  const parts = [`Imported ${plural(r.imported, "preset")}`, `${r.skipped.length} skipped`];
  if (r.locked > 0) parts.splice(1, 0, `${r.locked} locked (needs a newer version of Quantized)`);
  const lines = [parts.join(", ")];
  if (r.renamed.length) lines.push(`Renamed to avoid a clash: ${r.renamed.map((x) => `'${x.from}' to '${x.to}'`).join("; ")}`);
  if (r.skipped.length) lines.push(`Skipped: ${r.skipped.map((s) => `'${s.name}' (${s.workshop}): ${s.reason}`).join("; ")}`);
  lines.push(...r.notes);
  return lines.join(". ");
}
