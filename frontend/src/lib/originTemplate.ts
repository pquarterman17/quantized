// Origin .otp/.otpu graph-template import — the frontend half of MAIN_PLAN #5
// (GAP_ECOSYSTEM #5; backend shipped 2026-07-07: io/origin_project/templates.py
// decoded by routes/import_template.py's POST /api/import/template/upload,
// which returns a GraphTemplate-shaped dict: name/style/overrides/seriesStyles).
// A deliberate SMALL standalone client module rather than an api.ts append —
// templates are a separate import surface from the dataset parsers (they're
// style presets, not DataStructs; the backend keeps them out of io/registry.py
// for the same reason). Imported templates land in the SAME saved
// graph-templates store the Figure Builder reads (lib/figuredoc's
// localStorage list), tagged `source: "origin"` and de-duplicated by name so
// an import can never silently overwrite a user-saved template.

import { loadGraphTemplates, saveGraphTemplate, type GraphTemplate } from "./figuredoc";
import type { FigureOverrides } from "./figureOverrides";
import type { ExportSeriesStyle } from "./exportStyles";
import { toast } from "../store/toasts";

/** File-picker filter for the "Import Origin template…" command. */
export const TEMPLATE_ACCEPT = ".otp,.otpu";

/** Upload a template file's bytes to the backend decoder (mirrors
 *  api.ts::uploadFile's FormData shape against the template route). */
export async function uploadOriginTemplate(file: File): Promise<unknown> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/import/template/upload", { method: "POST", body: form });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(detail);
  }
  return (await res.json()) as unknown;
}

/** Validate the decoder's GraphTemplate-shaped response and tag its
 *  provenance. Honestly partial upstream stays honestly partial here:
 *  overrides/seriesStyles pass through as-is (or null), never defaulted.
 *  Returns null for anything that isn't template-shaped. */
export function sanitizeImportedTemplate(v: unknown, fallbackName: string): GraphTemplate | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : fallbackName;
  if (!name) return null;
  const style = typeof o.style === "string" && o.style ? o.style : "default";
  const overrides =
    typeof o.overrides === "object" && o.overrides !== null && !Array.isArray(o.overrides)
      ? (o.overrides as FigureOverrides)
      : null;
  const seriesStyles = Array.isArray(o.seriesStyles)
    ? (o.seriesStyles as (ExportSeriesStyle | null)[])
    : null;
  return { name, style, overrides, seriesStyles, source: "origin" };
}

/** First name in `name`, `name (2)`, `name (3)`, … not already taken —
 *  saveGraphTemplate upserts by name, so an import must never reuse one
 *  (re-importing the same file appends a numbered copy instead of clobbering
 *  the earlier import or a user-saved template). */
export function uniqueTemplateName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Full flow for one file: upload → sanitize → unique-name → persist into the
 *  saved graph-templates store. Throws (with the backend's 422 detail when
 *  available) so the caller can surface per-file failures. */
export async function importOriginTemplateFile(file: File): Promise<GraphTemplate> {
  const raw = await uploadOriginTemplate(file);
  const stem = file.name.replace(/\.[^.]+$/, "");
  const t = sanitizeImportedTemplate(raw, stem);
  if (!t) throw new Error(`"${file.name}" did not decode to a graph template`);
  const named = {
    ...t,
    name: uniqueTemplateName(t.name, new Set(loadGraphTemplates().map((x) => x.name))),
  };
  saveGraphTemplate(named);
  return named;
}

/** The file-picker branch (App.tsx's "Import Origin template…" command):
 *  import each picked file independently — one bad template toasts its error
 *  and never blocks the rest (the same per-file isolation importFiles has).
 *  Returns the successfully imported templates (for tests/status). */
export async function importOriginTemplateFiles(files: File[]): Promise<GraphTemplate[]> {
  const imported: GraphTemplate[] = [];
  for (const file of files) {
    try {
      const t = await importOriginTemplateFile(file);
      imported.push(t);
      toast(`imported graph template "${t.name}"`, "ok");
    } catch (e) {
      toast(`${file.name}: ${e instanceof Error ? e.message : "template import failed"}`, "danger");
    }
  }
  return imported;
}
