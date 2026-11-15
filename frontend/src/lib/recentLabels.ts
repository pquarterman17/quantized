// The Recent list's display labels (parent folder, "2m ago").
// Bundle diet (origin gap audit 3 #15's funding): moved verbatim out of
// lib/recentFiles.ts, whose other exports run at startup; only lazy modules
// call this half, so it no longer ships in the startup chunk. Imported by
// path; lib/recentFiles.ts does not re-export it.

/** Compact parent-folder disambiguator for the Recent surfaces. */
export function recentParentLabel(path: string | undefined): string {
  return path?.replace(/\\/g, "/").split("/").at(-2) ?? "";
}

/** Coarse "2m ago" / "yesterday" label for an ISO time, given `nowMs`. Pure so
 *  the bucketing is testable without a clock. */
export function relativeTime(at: string, nowMs: number): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}
