import type { OriginSavedPreview } from "./types";

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_BASE64_LENGTH = 14_000_000;

/** Safe browser source for a backend-validated saved Origin PNG. */
export function originPreviewDataUrl(preview: OriginSavedPreview | undefined): string | null {
  if (!preview) return null;
  if (preview.format !== "png" || preview.mime !== "image/png") return null;
  if (!Number.isInteger(preview.width) || preview.width < 1 || preview.width > 16_384) return null;
  if (!Number.isInteger(preview.height) || preview.height < 1 || preview.height > 16_384) return null;
  if (!SHA256.test(preview.sha256)) return null;
  if (!preview.data || preview.data.length > MAX_BASE64_LENGTH || !BASE64.test(preview.data)) return null;
  return `data:image/png;base64,${preview.data}`;
}
