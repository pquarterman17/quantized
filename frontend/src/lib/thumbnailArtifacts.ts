import type { ThumbnailRequest, ThumbnailResult } from "./thumbnailCache";
import { plotSvgBody, svgResult } from "./thumbnailSvg";
import type { DataStruct, Dataset } from "./types";

function datasetFrom(request: ThumbnailRequest): Dataset | undefined {
  return request.deps.find((dep): dep is Dataset => !!dep && "data" in dep && "id" in dep);
}

function dataFor(request: ThumbnailRequest): DataStruct | undefined {
  const { node } = request;
  if (node.kind === "editable-figure") {
    return node.entity.data.mode === "frozen" ? node.entity.data.snapshot : datasetFrom(request)?.data;
  }
  if (node.kind === "publication-figure") {
    return !node.entity.live ? node.entity.dataSnapshot : datasetFrom(request)?.data;
  }
  return datasetFrom(request)?.data;
}

function selections(request: ThumbnailRequest): { x: number | null; y: number[] | null } {
  const { node } = request;
  if (node.kind === "editable-figure") return { x: node.entity.bindings.xKey, y: node.entity.bindings.yKeys };
  if (node.kind === "publication-figure") return { x: node.entity.config.xKey, y: node.entity.config.yKeys };
  return { x: null, y: null };
}

export async function generateFigureThumbnail(request: ThumbnailRequest, signal: AbortSignal): Promise<ThumbnailResult> {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const { x, y } = selections(request);
  return svgResult(plotSvgBody(dataFor(request), x, y), request.node.name);
}
