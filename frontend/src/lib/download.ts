// Trigger a browser download from a POST endpoint that returns a file body
// (Content-Disposition attachment). Used for the export routes (CSV / HDF5).

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

/** POST JSON, then download the response body as a file. Throws on !ok with the
 *  backend's error detail (so callers can surface it in the status bar). */
export async function postDownload(
  path: string,
  body: unknown,
  fallbackName: string,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  const blob = await res.blob();
  saveBlob(blob, filenameFromDisposition(res.headers.get("Content-Disposition"), fallbackName));
}
