// The fit-template preset backend (plans/PRESET_BAR_CONTRACT.md section 3):
// Curve Fit's named presets are the fit templates already in
// `qz.analysisTemplates`, read and written unchanged. A record this build
// cannot read, or that is not a fit template (a Signal Processing recipe, a
// newer build's), passes through every write byte for byte, which the old
// loadTemplates + saveTemplate round trip did not guarantee. Name-keyed: the
// id IS the name, and a rename is a save under the new name, then removal of
// the old one, with the favourites sidecar carried (lib/nameKeyedRecipes.ts).

import { dropEntry, moveEntry } from "../../../lib/recipeIndex";
import type { RecipeRef } from "../../../lib/recipeLibrary";
import { toFitTemplate } from "../../../lib/fitTemplates";
import type { PresetAdapter, PresetBackend } from "../../../lib/presetAdapter";
import type { PresetEntry, PresetOutcome } from "../../../lib/presets";
import { resolveSettings } from "../../../lib/presets";
import { warnStorageRefused } from "../../../lib/storageWarning";
import { parseTemplate, TEMPLATES_CHANGED_EVENT, type AnalysisTemplate } from "../../../lib/template";
import { TEMPLATES_KEY } from "../../../lib/templateKey";
import { toTemplateSettings, type CurveFitSettings } from "./curveFitSettings";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ref = (name: string): RecipeRef => ({ kind: "analysis", scope: "global", id: name });

type Raw = { ok: true; records: unknown[] } | { ok: false; reason: string };

function readRaw(): Raw {
  let text: string | null;
  try {
    text = localStorage.getItem(TEMPLATES_KEY);
  } catch {
    return { ok: false, reason: "browser storage is blocked" };
  }
  if (!text) return { ok: true, records: [] };
  try {
    const v: unknown = JSON.parse(text);
    if (Array.isArray(v)) return { ok: true, records: v };
  } catch {
    /* fall through */
  }
  return { ok: false, reason: "the stored fit templates could not be read, so they were left untouched" };
}

function writeRaw(records: unknown[]): string | null {
  const text = JSON.stringify(records);
  try {
    localStorage.setItem(TEMPLATES_KEY, text);
    if (localStorage.getItem(TEMPLATES_KEY) === text) {
      window.dispatchEvent(new Event(TEMPLATES_CHANGED_EVENT));
      return null;
    }
  } catch {
    /* fall through */
  }
  warnStorageRefused("fit template");
  return "browser storage refused the write (full or blocked), so the fit template was not saved";
}

/** A readable analysis template, plus its fit-template bag when it is one. */
function inspect(raw: unknown): { t: AnalysisTemplate; bag: Record<string, unknown> | null } | null {
  let t: AnalysisTemplate;
  try {
    t = parseTemplate(JSON.stringify(raw));
  } catch {
    return null;
  }
  const bag = t.steps.length === 1 && t.steps[0]!.kind === "fit" ? t.steps[0]!.params.fitTemplate : undefined;
  return { t, bag: isObject(bag) ? bag : null };
}

/** The stored bag in the adapter's flat shape, unknown keys carried so the strict parser names them. */
function candidate(bag: Record<string, unknown>): Record<string, unknown> {
  const { version: _version, manualLabel, scaleErrors, range, ...rest } = bag;
  void _version;
  return { ...rest, manualLabel: manualLabel ?? "", scaleErrors: scaleErrors ?? true, range: range ?? null };
}

const sameName = (a: string, b: string) => a === b;

export function fitTemplateBackend(adapter: PresetAdapter<CurveFitSettings>): PresetBackend<CurveFitSettings> {
  const nameProblem = (name: string): string | null => {
    const n = name.trim();
    return !n ? "give the preset a name" : n.length > 64 ? "a preset name is at most 64 characters" : null;
  };
  /** Index of the record called `name`: by its parsed name, or by its raw name field when this build cannot parse it. */
  const find = (records: unknown[], name: string): number => records.findIndex((r) => {
    const i = inspect(r);
    return i !== null ? sameName(i.t.name, name) : isObject(r) && typeof r.name === "string" && sameName(r.name.trim(), name);
  });
  const lockedBag = (bag: Record<string, unknown> | null) => bag !== null && typeof bag.version === "number" && bag.version > adapter.schema;

  return {
    sameName: (a, b) => sameName(a.trim(), b.trim()),
    list() {
      const file = readRaw();
      if (!file.ok) return { entries: [], unreadable: file.reason };
      const entries: PresetEntry<CurveFitSettings>[] = [];
      for (const raw of file.records) {
        const i = inspect(raw);
        if (!i?.bag) continue;
        const base = { id: i.t.name, name: i.t.name, updatedAt: "" };
        const v = i.bag.version;
        if (lockedBag(i.bag)) {
          entries.push({ ...base, state: "locked", reason: "needs a newer version of Quantized" });
          continue;
        }
        const r = v === adapter.schema ? resolveSettings(adapter, adapter.schema, candidate(i.bag)) : ({ state: "rejected", reason: "setting 'version' is not a fit template version this build knows" } as const);
        entries.push(r.state === "ok" ? { ...base, state: "ok", settings: r.settings, dropped: r.dropped } : { ...base, state: r.state, reason: r.reason });
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return { entries, unreadable: null };
    },

    save(name, settings): PresetOutcome {
      const bad = nameProblem(name);
      if (bad) return { ok: false, reason: bad };
      const parsed = adapter.parse(settings);
      if ("error" in parsed) return { ok: false, reason: `these settings cannot be saved: ${parsed.error}` };
      const file = readRaw();
      if (!file.ok) return { ok: false, reason: file.reason };
      const wanted = name.trim();
      let record: AnalysisTemplate;
      try {
        record = toFitTemplate(wanted, toTemplateSettings(parsed));
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "these fit settings cannot be saved" };
      }
      const records = [...file.records];
      const at = find(records, wanted);
      if (at >= 0) {
        const old = inspect(records[at]);
        if (!old?.bag) return { ok: false, reason: `a template named '${wanted}' already exists and is not a fit template; choose another name` };
        if (lockedBag(old.bag)) return { ok: false, reason: `a locked preset named '${wanted}' needs a newer version of Quantized; choose another name` };
        records[at] = record;
      } else {
        records.push(record);
      }
      const failed = writeRaw(records);
      return failed ? { ok: false, reason: failed } : { ok: true, id: wanted, updated: at >= 0 };
    },

    rename(id, name): PresetOutcome {
      const bad = nameProblem(name);
      if (bad) return { ok: false, reason: bad };
      const wanted = name.trim();
      const file = readRaw();
      if (!file.ok) return { ok: false, reason: file.reason };
      const records = [...file.records];
      const at = find(records, id);
      const old = at >= 0 ? inspect(records[at]) : null;
      if (!old?.bag) return { ok: false, reason: "that preset no longer exists" };
      if (lockedBag(old.bag)) return { ok: false, reason: "a locked preset needs a newer version of Quantized and is not edited" };
      if (wanted === id) return { ok: true, id, updated: false };
      if (find(records, wanted) >= 0) return { ok: false, reason: `a preset named '${wanted}' already exists` };
      records[at] = { ...(records[at] as Record<string, unknown>), name: wanted };
      const failed = writeRaw(records);
      if (failed) return { ok: false, reason: failed };
      moveEntry(ref(id), ref(wanted));
      return { ok: true, id: wanted, updated: true };
    },

    remove(id): PresetOutcome {
      const file = readRaw();
      if (!file.ok) return { ok: false, reason: file.reason };
      const at = find(file.records, id);
      if (at < 0 || !inspect(file.records[at])?.bag) return { ok: false, reason: "that preset no longer exists" };
      const failed = writeRaw(file.records.filter((_, i) => i !== at));
      if (failed) return { ok: false, reason: failed };
      dropEntry(ref(id));
      return { ok: true, id, updated: true };
    },
  };
}
