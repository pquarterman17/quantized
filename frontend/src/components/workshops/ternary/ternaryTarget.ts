// Which route and body a ternary workshop state draws through: scatter and the
// composition maps ride `/api/export/ternary-figure` (ternaryRequest.ts), the
// line and vector plots `/api/export/ternary-paths-figure`
// (ternaryPathsRequest.ts). One seam, so the preview and the export of a given
// state always post the same body to the same route.

import { exportTernaryFigure } from "../../../lib/api/figures";
import { postDownload } from "../../../lib/api/http";
import type { DataStruct } from "../../../lib/types";
import type { TernaryField } from "../../../lib/ternaryProject";
import type { AuxFigureFormat } from "./AuxFigureFrame";
import { buildTernaryPathsRequest, pathsNotice } from "./ternaryPathsRequest";
import { buildTernaryRequest, droppedRowsNotice, type TernaryPicks } from "./ternaryRequest";

export const TERNARY_ROUTE = "/api/export/ternary-figure";
export const TERNARY_PATHS_ROUTE = "/api/export/ternary-paths-figure";

export interface TernaryTarget {
  route: string;
  spec: object | null;
  notice: string | null;
}

export function ternaryTarget(
  data: DataStruct,
  picks: TernaryPicks,
  opts: { title: string; filename: string; field: TernaryField },
): TernaryTarget {
  const kind = opts.field.kind;
  if (kind === "line" || kind === "vector") {
    const b = buildTernaryPathsRequest(data, picks, opts);
    return { route: TERNARY_PATHS_ROUTE, spec: b.spec, notice: pathsNotice(kind, b.dropped, b.total) };
  }
  const b = buildTernaryRequest(data, picks, opts);
  return { route: TERNARY_ROUTE, spec: b.spec, notice: droppedRowsNotice(b.dropped, b.total) };
}

/** Send a built body to its route as a file download. */
export function sendTernary(target: TernaryTarget, fmt: AuxFigureFormat, signal: AbortSignal): Promise<void> {
  const body = { ...(target.spec as object), fmt };
  return target.route === TERNARY_ROUTE
    ? exportTernaryFigure(body as Parameters<typeof exportTernaryFigure>[0], signal)
    : postDownload(target.route, body, `ternary.${fmt}`, signal);
}
