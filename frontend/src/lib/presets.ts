// Named presets: the generic backend (plans/PRESET_BAR_CONTRACT.md sections 2
// and 4). A preset is a user-level CONTENT record in `qz.presets` (plain
// localStorage, not a pref slot, never in the `.dwk`).
//
// Fail-closed rules this module owns:
//  - read-modify-write over the RAW record array: a record this build cannot
//    read (another workshop's, a newer schema, malformed) is passed through
//    untouched, so saving one preset never destroys another build's;
//  - a file that is not the version-1 envelope is never written at all;
//  - a newer-schema record is listed locked and is never applied, renamed or
//    rewritten (it can be deleted);
//  - a write is read back before it is called saved.
//
// Lazy: imported only by the preset bar and the workshop adapters.

import type { MigrationStep, PresetAdapter, PresetBackend } from "./presetAdapter";
import { warnStorageRefused } from "./storageWarning";

export const PRESETS_KEY = "qz.presets";
export const MAX_PRESETS_PER_WORKSHOP = 200;
export const MAX_RECORD_CHARS = 32 * 1024;
export const MAX_NAME_CHARS = 64;

export interface PresetRecord {
  id: string;
  workshop: string;
  name: string;
  schema: number;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A record with the shape the file promises (anything else is preserved, never listed). */
function asRecord(raw: unknown): PresetRecord | null {
  if (!isObject(raw)) return null;
  const { id, workshop, name, schema, settings, createdAt, updatedAt } = raw;
  const strings = [id, workshop, name, createdAt, updatedAt].every((s) => typeof s === "string");
  if (!strings || typeof schema !== "number" || !Number.isInteger(schema) || schema < 1 || !isObject(settings)) return null;
  return raw as unknown as PresetRecord;
}

export type Resolved<S> =
  | { state: "ok"; settings: S; dropped: string[] }
  | { state: "locked" | "rejected"; reason: string };

/** Bring `settings` saved at `schema` to the adapter's schema and parse it strictly (P6, P7). */
export function resolveSettings<S extends object>(adapter: PresetAdapter<S>, schema: number, settings: unknown): Resolved<S> {
  if (schema > adapter.schema) return { state: "locked", reason: "needs a newer version of Quantized" };
  let current: unknown = settings;
  const dropped: string[] = [];
  for (let from = schema; from < adapter.schema; from++) {
    const step: MigrationStep | undefined = adapter.migrate?.[from];
    if (!step || !isObject(current)) return { state: "locked", reason: `cannot be upgraded from schema ${from}` };
    const next = { ...current };
    for (const key of step.dropped ?? []) {
      if (key in next) {
        delete next[key];
        dropped.push(key);
      }
    }
    current = step.run ? step.run(next) : next;
  }
  const parsed = adapter.parse(current);
  if (isParseError(parsed)) return { state: "rejected", reason: parsed.error };
  return { state: "ok", settings: parsed, dropped };
}

const isParseError = (v: unknown): v is { error: string } => isObject(v) && typeof v.error === "string" && Object.keys(v).length === 1;

export type PresetEntry<S> =
  | { state: "ok"; id: string; name: string; updatedAt: string; settings: S; dropped: string[] }
  | { state: "locked" | "rejected"; id: string; name: string; updatedAt: string; reason: string };

type FileState = { ok: true; records: unknown[] } | { ok: false; reason: string };

function readFile(): FileState {
  let text: string | null;
  try {
    text = localStorage.getItem(PRESETS_KEY);
  } catch {
    return { ok: false, reason: "browser storage is blocked" };
  }
  if (text === null) return { ok: true, records: [] };
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the stored presets could not be read, so they were left untouched" };
  }
  if (!isObject(file) || file.version !== 1 || !Array.isArray(file.presets)) {
    const newer = isObject(file) && typeof file.version === "number" && file.version > 1;
    return { ok: false, reason: newer ? "presets were saved by a newer version of Quantized" : "the stored presets are not in a known format, so they were left untouched" };
  }
  return { ok: true, records: file.presets };
}

/** Write and read back; false (and the shared warning) when storage refused. */
function writeFile(records: unknown[]): string | null {
  const text = JSON.stringify({ version: 1, presets: records });
  try {
    localStorage.setItem(PRESETS_KEY, text);
    if (localStorage.getItem(PRESETS_KEY) === text) return null;
  } catch {
    /* fall through to the refusal */
  }
  warnStorageRefused("preset");
  return "browser storage refused the write (full or blocked), so the preset was not saved";
}

export interface PresetListing<S> {
  entries: PresetEntry<S>[];
  /** Set when the whole file is unreadable: nothing can be listed or written. */
  unreadable: string | null;
}

export function listPresets<S extends object>(adapter: PresetAdapter<S>): PresetListing<S> {
  const file = readFile();
  if (!file.ok) return { entries: [], unreadable: file.reason };
  const entries: PresetEntry<S>[] = [];
  for (const raw of file.records) {
    const rec = asRecord(raw);
    if (!rec || rec.workshop !== adapter.workshop) continue;
    const r = resolveSettings(adapter, rec.schema, rec.settings);
    const base = { id: rec.id, name: rec.name, updatedAt: rec.updatedAt };
    entries.push(r.state === "ok" ? { ...base, state: "ok", settings: r.settings, dropped: r.dropped } : { ...base, state: r.state, reason: r.reason });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, unreadable: null };
}

export type PresetOutcome = { ok: true; id: string; updated: boolean } | { ok: false; reason: string };

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function newId(taken: Set<string>): string {
  for (;;) {
    const id = `p1:${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

function checkName(name: string): string | null {
  const t = name.trim();
  if (!t) return "give the preset a name";
  return t.length > MAX_NAME_CHARS ? `a preset name is at most ${MAX_NAME_CHARS} characters` : null;
}

/** Save under `name` (an existing name in this workshop is updated, id kept). */
export function savePreset<S extends object>(adapter: PresetAdapter<S>, name: string, settings: S): PresetOutcome {
  const bad = checkName(name);
  if (bad) return { ok: false, reason: bad };
  const parsed = adapter.parse(settings);
  if (isParseError(parsed)) return { ok: false, reason: `these settings cannot be saved: ${parsed.error}` };
  const file = readFile();
  if (!file.ok) return { ok: false, reason: file.reason };
  const records = [...file.records];
  const now = new Date().toISOString();
  const at = records.findIndex((r) => {
    const rec = asRecord(r);
    return rec !== null && rec.workshop === adapter.workshop && sameName(rec.name, name);
  });
  const existing = at >= 0 ? asRecord(records[at]) : null;
  if (existing && existing.schema > adapter.schema) {
    return { ok: false, reason: `a locked preset named '${existing.name}' needs a newer version of Quantized; choose another name` };
  }
  const own = records.filter((r) => asRecord(r)?.workshop === adapter.workshop).length;
  if (!existing && own >= MAX_PRESETS_PER_WORKSHOP) return { ok: false, reason: `at most ${MAX_PRESETS_PER_WORKSHOP} presets per tool; delete one first` };
  const record: PresetRecord = {
    id: existing?.id ?? newId(new Set(records.map((r) => asRecord(r)?.id ?? ""))),
    workshop: adapter.workshop,
    name: name.trim(),
    schema: adapter.schema,
    settings: { ...parsed } as Record<string, unknown>,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (JSON.stringify(record).length > MAX_RECORD_CHARS) return { ok: false, reason: "the settings are too large to save as a preset" };
  if (at >= 0) records[at] = record;
  else records.push(record);
  const failed = writeFile(records);
  return failed ? { ok: false, reason: failed } : { ok: true, id: record.id, updated: at >= 0 };
}

/** Rename keeps the id (so a favourite is never orphaned); a locked preset is not edited. */
export function renamePreset(adapter: Pick<PresetAdapter<object>, "workshop" | "schema">, id: string, name: string): PresetOutcome {
  const bad = checkName(name);
  if (bad) return { ok: false, reason: bad };
  const file = readFile();
  if (!file.ok) return { ok: false, reason: file.reason };
  const records = [...file.records];
  const at = records.findIndex((r) => asRecord(r)?.id === id && asRecord(r)?.workshop === adapter.workshop);
  const rec = at >= 0 ? asRecord(records[at]) : null;
  if (!rec) return { ok: false, reason: "that preset no longer exists" };
  if (rec.schema > adapter.schema) return { ok: false, reason: "a locked preset needs a newer version of Quantized and is not edited" };
  const clash = records.some((r) => {
    const o = asRecord(r);
    return o !== null && o.workshop === adapter.workshop && o.id !== id && sameName(o.name, name);
  });
  if (clash) return { ok: false, reason: `a preset named '${name.trim()}' already exists` };
  records[at] = { ...rec, name: name.trim(), updatedAt: new Date().toISOString() };
  const failed = writeFile(records);
  return failed ? { ok: false, reason: failed } : { ok: true, id, updated: true };
}

/** Remove exactly this record (a locked one too); every other record is untouched. */
export function deletePreset(adapter: Pick<PresetAdapter<object>, "workshop">, id: string): PresetOutcome {
  const file = readFile();
  if (!file.ok) return { ok: false, reason: file.reason };
  const kept = file.records.filter((r) => !(asRecord(r)?.id === id && asRecord(r)?.workshop === adapter.workshop));
  if (kept.length === file.records.length) return { ok: false, reason: "that preset no longer exists" };
  const failed = writeFile(kept);
  return failed ? { ok: false, reason: failed } : { ok: true, id, updated: true };
}

/** The generic backend: named presets in `qz.presets`. */
export function genericBackend<S extends object>(adapter: PresetAdapter<S>): PresetBackend<S> {
  return {
    list: () => listPresets(adapter),
    save: (name, settings) => savePreset(adapter, name, settings),
    rename: (id, name) => renamePreset(adapter, id, name),
    remove: (id) => deletePreset(adapter, id),
  };
}
