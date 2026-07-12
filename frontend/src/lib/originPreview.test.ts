import { describe, expect, it } from "vitest";

import { originPreviewDataUrl } from "./originPreview";
import type { OriginSavedPreview } from "./types";

const preview: OriginSavedPreview = {
  format: "png",
  mime: "image/png",
  width: 200,
  height: 155,
  sha256: "a".repeat(64),
  data: "iVBORw0KGgo=",
  confidence: "exact_page",
  page_name: "Graph1",
};

describe("originPreviewDataUrl", () => {
  it("wraps a validated PNG without rewriting its base64 bytes", () => {
    expect(originPreviewDataUrl(preview)).toBe(`data:image/png;base64,${preview.data}`);
  });

  it("rejects malformed persisted preview metadata", () => {
    expect(originPreviewDataUrl({ ...preview, sha256: "bad" })).toBeNull();
    expect(originPreviewDataUrl({ ...preview, data: "not base64!" })).toBeNull();
    expect(originPreviewDataUrl({ ...preview, width: 0 })).toBeNull();
  });
});
