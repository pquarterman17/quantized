// E-c1: the default generator set. One idempotent installer (safe under
// HMR and repeated test imports) rather than bare import-time side
// effects, so `registerThumbnailGenerator`'s double-registration throw
// stays a real programming-error signal. E-c2 extends this list with the
// real plot/table/analysis renderers.

import { registerThumbnailGenerator, thumbnailGeneratorFor } from "./thumbnailCache";
import { generateFigureThumbnail } from "./thumbnailArtifacts";
import { generatePageThumbnail } from "./thumbnailPage";
import { generateReportThumbnail } from "./thumbnailReport";

export function registerDefaultThumbnailGenerators(): void {
  if (!thumbnailGeneratorFor("page")) registerThumbnailGenerator("page", generatePageThumbnail);
  if (!thumbnailGeneratorFor("editable-figure")) registerThumbnailGenerator("editable-figure", generateFigureThumbnail);
  if (!thumbnailGeneratorFor("publication-figure")) registerThumbnailGenerator("publication-figure", generateFigureThumbnail);
  if (!thumbnailGeneratorFor("origin-figure")) registerThumbnailGenerator("origin-figure", generateFigureThumbnail);
  if (!thumbnailGeneratorFor("report")) registerThumbnailGenerator("report", generateReportThumbnail);
}
