// /api/convert/* — the Quick Convert window's client (src/quantized/routes/
// convert_quick.py). Request/response types come from the generated schema; the
// job result is typed here (the job queue's result is untyped in OpenAPI).
//
// The three job calls are restated here instead of imported from lib/jobs.ts for
// the reason lib/api/peakBatch.ts gives: a second lazy importer of lib/jobs.ts
// would split it into a shared chunk the EAGER entry lists in its preload map.

import { getJSON, postForm, postJSON } from "./http";
import type { components } from "./schema";

export type ConvertConfig = components["schemas"]["ConvertConfig"];
export type FormatInfo = components["schemas"]["ConvertFormatInfo"];
export type FilePreview = components["schemas"]["ConvertFilePreview"];
export type PreviewRequest = components["schemas"]["ConvertPreviewRequest"];
export type PreviewResponse = components["schemas"]["ConvertPreviewResponse"];
export type RunRequest = components["schemas"]["ConvertRunRequest"];
export type BrowseResponse = components["schemas"]["ConvertBrowseResponse"];
export type BrowseEntry = components["schemas"]["ConvertBrowseEntry"];

/** What the output folder is: "same" (none chosen), or what the chosen path is. */
export type OutDirStatus = "same" | "exists" | "will_be_created" | "not_a_folder";

export interface ConvertBook {
  book: string;
  status: string;
  output: string | null;
  problems: string[];
  notes: string[];
}

/** One input's result (io/convert_run.convert_one -> classify_outcome). */
export interface ConvertEntry {
  source: string;
  format?: string;
  status: "ok" | "partial" | "failed";
  outcome: "done" | "partial" | "skipped-exists" | "failed";
  reason: string | null;
  error: string | null;
  outputs: string[];
  notes: string[];
  omissions: string[];
  books: ConvertBook[];
}

export interface ConvertResult {
  report: { summary: { ok: number; partial: number; failed: number }; files: ConvertEntry[] };
  report_path: string | null;
  report_error: string | null;
  cancelled: boolean;
}

export type JobState = { status: "pending" | "running" | "done" | "error" | "cancelled"; progress: number; message: string; error?: string };

export const convertConfig = (): Promise<ConvertConfig> => getJSON("/api/convert/config");

export const convertPreview = (body: PreviewRequest, signal?: AbortSignal): Promise<PreviewResponse> =>
  postJSON("/api/convert/preview", body, signal);

export async function startConvert(body: RunRequest): Promise<string> {
  return (await postJSON<{ job_id: string }>("/api/convert/run", body)).job_id;
}

export const convertJob = (id: string): Promise<JobState> => getJSON(`/api/jobs/${id}`);

export async function convertJobResult(id: string): Promise<ConvertResult> {
  return (await getJSON<{ result: ConvertResult }>(`/api/jobs/${id}/result`)).result;
}

export const cancelConvert = (id: string): Promise<JobState> => postJSON(`/api/jobs/${id}/cancel`, {});

/** Stage a dropped / picked File (no path in a browser) on the server. */
export function stageConvertFile(file: File): Promise<{ path: string; name: string }> {
  const form = new FormData();
  form.append("file", file, file.name);
  return postForm("/api/convert/stage", form);
}

export const browseFolder = (path: string): Promise<BrowseResponse> =>
  getJSON(`/api/convert/browse?path=${encodeURIComponent(path)}`);
