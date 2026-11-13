// Figure-export font list + render warnings (publication-figures audit #7).
//
// `GET /api/export/fonts` lists the families the matplotlib export can really
// render on this host, and how each common proprietary family resolves there
// (Arial -> Liberation Sans, ...). The Publication preview's font picker offers
// those instead of a free-text field that silently fell back to DejaVu.
//
// A figure export reports what it could not honour (a missing font, an
// off-scale reference line, a page too small for its labels) in the
// `X-Figure-Warnings` response header (JSON list); the preview carries the same
// list as `warnings` on its hit-map. `figureWarningsFromHeaders` reads it.

import { toast } from "../../store/toasts";
import type { FigureSpec } from "./figures";
import { getJSON, postDownloadHeaders } from "./http";

export interface FontResolution {
  family: string;
  status: "installed" | "substituted" | "fallback";
}

export interface FigureFonts {
  families: string[];
  aliases: Record<string, FontResolution>;
}

let cached: Promise<FigureFonts> | null = null;

/** The export's installed font families (fetched once per session; a failed
 *  fetch is retried on the next call). */
export function fetchFigureFonts(): Promise<FigureFonts> {
  cached ??= getJSON<FigureFonts>("/api/export/fonts").catch((err: unknown) => {
    cached = null;
    throw err;
  });
  return cached;
}

/** Test seam: forget the cached list. */
export function resetFigureFontsCache(): void {
  cached = null;
}

/** The render warnings an export response carried (empty when none, or when
 *  the header is malformed — a warning channel must never fail the export). */
export function figureWarningsFromHeaders(headers: Headers): string[] {
  const raw = headers.get("X-Figure-Warnings");
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];
  }
}

/** "Export figure": download the rendered file and toast each render warning
 *  it carried (a missing font, an off-scale reference line, a page too small
 *  for its labels), so it is said rather than discovered in the PDF. `signal`
 *  — P3.4 safe-cancel-for-export (lib/exportActive.ts): aborts the in-flight
 *  render/download; postDownloadHeaders' own race guard means a cancel can
 *  never still trigger the browser download once the response lands. */
export async function exportFigure(body: FigureSpec, signal?: AbortSignal): Promise<void> {
  const headers = await postDownloadHeaders("/api/export/figure", body, `figure.${body.fmt ?? "pdf"}`, signal);
  for (const w of figureWarningsFromHeaders(headers)) toast(w, "info");
}
