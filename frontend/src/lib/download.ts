// DOM save-to-disk helpers (no fetching — the export routes' fetch +
// error handling live in lib/api's postDownload, on its single ensureOk
// error-extraction path).

/** Extract the filename from a Content-Disposition header, or fall back. */
export function filenameFromDisposition(cd: string | null, fallback: string): string {
  if (!cd) return fallback;
  const m = /filename\*?=(?:UTF-8'')?"?([^";\r\n]+)"?/i.exec(cd);
  return m?.[1]?.trim() || fallback;
}

/** Save a Blob to disk via a synthetic anchor click. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
