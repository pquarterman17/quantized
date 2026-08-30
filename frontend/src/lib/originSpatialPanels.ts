// Spatial multi-panel resolution for an Origin graph window: per-layer panel
// resolution, the frame-coincident double-Y overlay merge (decode-plan
// #36/#54), and the placement handed to `originPanels.computePanelLayout`.
//
// LAZY HALF (bundle headroom slice 1, `plans/BUNDLE_HEADROOM.md`): reached
// only when a >=2-layer figure is applied, so `store/useApp.ts` loads it on
// demand through `store/originApplyLibs.ts`. This module owns the ONLY value
// import of `./originPanels` in the app, so a static import from an eagerly-
// reachable file pulls that module back onto first paint too.

import {
  figureChannelSelection,
  originFigureAnnotations,
  originLegendState,
  originRegionShades,
} from "./originFigureSelection";
import type { OriginFigureEntry } from "./originFigures";
import type { SpatialPanel } from "./multipanel";
import { computePanelLayout, framesCoincide, pageNormalizedRect } from "./originPanels";
import { pageValidRects } from "./panelLayout";
import type { Dataset, OriginFigure } from "./types";

/** Per-layer dataset + channel selection + fixed axis state for a spatial
 *  multi-panel apply (decode-plan #36), WITHOUT grid placement — pair the
 *  result with `originPanels.computePanelLayout` over the same family's
 *  `figure.frame` quads to get each entry's `row`/`col`. One entry per
 *  `family` member, in the SAME order. All-or-nothing: returns `null` when
 *  ANY layer fails to resolve (no dataset, or `figureChannelSelection`
 *  finds nothing to plot) — a partial grid would silently drop a panel, so
 *  the caller falls back to the single-layer apply instead. */
export function resolveFigurePanels(
  family: OriginFigureEntry[],
  datasets: Dataset[],
): Omit<SpatialPanel, "row" | "col">[] | null {
  const out: Omit<SpatialPanel, "row" | "col">[] = [];
  for (const entry of family) {
    if (!entry.datasetId) return null;
    const ds = datasets.find((d) => d.id === entry.datasetId);
    if (!ds) return null;
    const sel = figureChannelSelection(entry.figure, ds);
    if (!sel) return null;
    const fig = entry.figure;
    const legend = originLegendState(fig);
    out.push({
      sourceFigureIds: [entry.id],
      datasetId: entry.datasetId,
      xKey: sel.xKey,
      yKeys: sel.yKeys,
      xLim: [fig.x_from, fig.x_to],
      yLim: [fig.y_from, fig.y_to],
      xLog: fig.x_log,
      yLog: fig.y_log,
      // Item B (decode-plan #36 residual, PNR.opj Graph11): distinguish an
      // EXPLICITLY blank decoded x_title ("" — the owner hand-deleted a
      // redundant per-panel label in Origin) from an UNDECODED one
      // (undefined — the field never resolved at all). `null` tells
      // buildOpts to force blank rather than fall back to a synthesized
      // "channel (unit)" label; undefined still auto-derives, unchanged.
      // yAxisLabel is untouched — item B keeps y axes "as-is".
      xAxisLabel: fig.x_title === undefined ? undefined : fig.x_title || null,
      yAxisLabel: fig.y_title || undefined,
      seriesStyles: sel.styles,
      seriesLabels: sel.labels,
      ...(legend.legendTitle ? { legendTitle: legend.legendTitle } : {}),
      ...(legend.legendFrameXY ? { legendFrameXY: legend.legendFrameXY } : {}),
      errKeys: sel.errKeys,
      hiddenChannels: sel.hiddenChannels,
      xStep: fig.x_step ?? null,
      yStep: fig.y_step ?? null,
      // Each panel's OWN layer's marks, in that layer's own data coords —
      // annotation_marks are already recorded per-layer, so no coordinate
      // transform is needed (fix #5: multi-panel figures used to drop them).
      annotations: originFigureAnnotations([fig], entry.id),
      // Same per-layer/data-coordinate contract as annotations. This is
      // rendering plumbing for the already-proven Rect* decode, not a new
      // graphic-object interpretation.
      regionShades: originRegionShades([fig], entry.id),
    });
  }
  return out;
}

/** A relative-tolerance range-equality check (both endpoints) — used to tell
 *  a shared x-axis (double-Y) from a distinct one, and a distinct y-range
 *  from a coincidentally-identical one. Tolerance scales off the range's own
 *  span so it stays meaningful whether the axis reads in nm or in Q (nm⁻¹). */
function rangesEqual(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  const tol = 1e-6 * Math.max(1, Math.abs(aTo - aFrom));
  return Math.abs(aFrom - bFrom) <= tol && Math.abs(aTo - bTo) <= tol;
}

/** True when `candidate` looks like a genuine Origin double-Y overlay of
 *  `host` — the SAME idiom `doubleYPartner` detects for an exactly-2-layer
 *  graph window, occurring instead as one pair INSIDE a ≥2-layer spatial
 *  multi-panel family (decode-plan #36 residual — the PNR/S7/Book33 repro:
 *  a 3-layer graph rendered as a bogus 1x3 ordinal stack because two of its
 *  layers decode BYTE-IDENTICAL frame quads, which `computePanelLayout`'s
 *  own "frames overlap rather than tile the page" guard read as an
 *  untrustworthy geometry decode for the WHOLE figure). All of the
 *  following must hold, so a false positive never merges two genuinely
 *  separate panels that happen to share a page rectangle:
 *   - both layers' decoded `frame` quads occupy the same page rectangle
 *     (`originPanels.framesCoincide` — near-total MUTUAL overlap, distinct
 *     from the partial/one-sided overlap that still means "untrusted
 *     geometry");
 *   - both resolved to the SAME dataset and both carry at least one curve
 *     (`doubleYPartner`'s own checks — a genuine double-Y always shares a
 *     book);
 *   - their Y ranges are genuinely DIFFERENT (an overlay reads a different
 *     scale than its host; two real panels that happen to decode with
 *     identical frames but the SAME y-range are not a double-Y pair); and
 *   - their X ranges MATCH (an overlay shares its host's x axis; two
 *     independent panels do not). */
function isFrameCoincidentY2Overlay(host: OriginFigureEntry, candidate: OriginFigureEntry): boolean {
  const hf = host.figure;
  const cf = candidate.figure;
  if (!hf.frame || !cf.frame) return false;
  if (!framesCoincide(hf.frame, cf.frame)) return false;
  if (!host.datasetId || !candidate.datasetId || host.datasetId !== candidate.datasetId) return false;
  if ((hf.curves ?? []).length === 0 || (cf.curves ?? []).length === 0) return false;
  if (rangesEqual(hf.y_from, hf.y_to, cf.y_from, cf.y_to)) return false; // must DIFFER
  return rangesEqual(hf.x_from, hf.x_to, cf.x_from, cf.x_to); // must MATCH
}

/** One frame-coincident overlay group within a spatial family, as indices
 *  into that same `family` array. `indices[0]` is the HOST — the group's
 *  lowest Origin `layer` number (mirrors `applyOriginFigure`'s 2-layer
 *  doubleY convention: axis state comes from the lower layer); the rest are
 *  partners in family order, so `indices[1]` is the FIRST partner (the one
 *  a native panel actually merges with — the 2-axis renderer has no 3rd
 *  axis to give a 2nd partner); `indices.slice(2)`, if any, are coincident
 *  layers a native panel can't also carry (see `resolveSpatialPanels`'s
 *  `droppedOverlays`). Length 1 = no coincident overlay at all — an
 *  ordinary standalone panel. */
export interface CoincidentOverlayGroup {
  indices: number[];
}

/** Partition a ≥2-layer spatial family into frame-coincident overlay groups
 *  (decode-plan #54 residual — generalizes the old greedy PAIRWISE
 *  `figureFrameY2Pairs`, which silently left a 3rd coincident layer
 *  unpaired and unmerged: exactly the overlap `computePanelLayout` misreads
 *  as untrusted geometry, forcing the WHOLE figure to the ordinal
 *  fallback). Origin's on-disk model is N free-positioned layers —
 *  "double-Y" is just 2 layers that happen to share a frame, and nothing in
 *  the format caps that at 2 (native ≥3-axis RENDERING stays deliberately
 *  deferred; this only fixes the GROUPING so a 3rd coincident layer no
 *  longer pollutes the layout classifier).
 *
 *  Each group forms around a HOST — the earliest unclaimed member, which
 *  (given `figureLayerFamily`'s layer-ascending sort) is also its
 *  lowest-layer member — and every OTHER unclaimed member that is
 *  frame-coincident with THAT HOST (`isFrameCoincidentY2Overlay`,
 *  unchanged: same dataset, both have curves, X ranges match, Y ranges
 *  differ, frames coincide) joins it. Candidates are tested against the
 *  host only — transitive-FROM-HOST, not a full pairwise closure — which
 *  matches the geometry Origin itself produces: every coincident overlay
 *  layer shares the SAME frame quad as its host (decode-plan #36's
 *  byte-identical-frame finding), so host-coincidence is the whole
 *  relation. A defensive re-sort by actual `layer` value keeps "lowest
 *  layer = host" true even if a caller hands in unsorted order. Layers that
 *  don't pair with anyone come back as their own length-1 group (unlike the
 *  old function, which omitted them entirely). */
export function coincidentOverlayGroups(family: OriginFigureEntry[]): CoincidentOverlayGroup[] {
  const used = new Set<number>();
  const groups: CoincidentOverlayGroup[] = [];
  for (let i = 0; i < family.length; i++) {
    if (used.has(i)) continue;
    const members = [i];
    used.add(i);
    for (let j = i + 1; j < family.length; j++) {
      if (used.has(j) || !isFrameCoincidentY2Overlay(family[i], family[j])) continue;
      members.push(j);
      used.add(j);
    }
    members.sort((a, b) => (family[a].figure.layer ?? 1) - (family[b].figure.layer ?? 1));
    groups.push({ indices: members });
  }
  return groups;
}

/** Combine a resolved host panel with its frame-coincident y2 overlay panel
 *  into ONE panel: the host's own selection stays primary; the y2 panel's
 *  channels/range/log/step move to the secondary axis, mirroring
 *  `applyOriginFigure`'s 2-layer double-Y apply (`yKeys` becomes the union
 *  so the y2 channels still render; `y2Keys` tags which of them are
 *  secondary). The y2 side's own annotation marks — built untagged by
 *  `resolveFigurePanels` (a lone panel has no secondary axis to tag onto) —
 *  are re-tagged `axis: 1` here. `y2AxisLabel` prefers the y2 layer's
 *  decoded `y2_title` (Origin's own secondary-axis title text — "decoded
 *  but not yet wired" per `types.ts`; this is that wiring) over its
 *  `y_title` (the field the existing 2-layer apply reads, which is often
 *  blank on a real y2 layer — the PNR/S7/Book33 repro's layer 3 is exactly
 *  this: `y_title: ""`, `y2_title: "Magnetic SLD …"` — so preferring
 *  `y2_title` costs nothing when it's unset). */
function mergePanelWithY2(
  host: Omit<SpatialPanel, "row" | "col">,
  y2: Omit<SpatialPanel, "row" | "col">,
  y2Figure: OriginFigure,
): Omit<SpatialPanel, "row" | "col"> {
  const legendTitle = host.legendTitle ?? y2.legendTitle;
  const legendFrameXY = host.legendFrameXY ?? y2.legendFrameXY;
  return {
    ...host,
    sourceFigureIds: [...(host.sourceFigureIds ?? []), ...(y2.sourceFigureIds ?? [])],
    yKeys: [...host.yKeys, ...y2.yKeys.filter((k) => !host.yKeys.includes(k))],
    seriesStyles: { ...host.seriesStyles, ...y2.seriesStyles },
    seriesLabels: { ...host.seriesLabels, ...y2.seriesLabels },
    ...(legendTitle ? { legendTitle } : {}),
    ...(legendFrameXY ? { legendFrameXY } : {}),
    y2Keys: y2.yKeys,
    y2Lim: y2.yLim,
    y2Log: y2.yLog,
    y2Step: y2.yStep,
    y2AxisLabel: y2Figure.y2_title || y2Figure.y_title || "",
    annotations: [
      ...(host.annotations ?? []),
      ...(y2.annotations ?? []).map((a) => ({ ...a, axis: 1 as const })),
    ],
    regionShades: [
      ...(host.regionShades ?? []),
      ...(y2.regionShades ?? []).map((shade) => ({ ...shade, axis: 1 as const })),
    ],
  };
}

/** Full spatial multi-panel resolution for `applyOriginFigure` (decode-plan
 *  #36, residual fix — PNR/S7/Book33 repro; #54 residual — generalized past
 *  pairs): resolves every family member (`resolveFigurePanels`,
 *  all-or-nothing — unchanged), then collapses each frame-coincident
 *  overlay GROUP (`coincidentOverlayGroups`, arbitrary size — a real Origin
 *  figure is N free-positioned layers, not a hardcoded pair) into ONE
 *  merged panel (`mergePanelWithY2`, host + its first partner — the native
 *  2-axis renderer has no 3rd axis for a 2nd partner) BEFORE handing frames
 *  to `originPanels.computePanelLayout` — so a coincident layer's frame
 *  never reaches the clusterer as its own cell (the bug: layers occupying
 *  the SAME page rectangle tripped `computePanelLayout`'s own "frames
 *  overlap rather than tile the page" bail-out for the WHOLE figure,
 *  collapsing a real spatial layout to a 1xN ordinal stack). A group of
 *  3+ merges host+first-partner and DROPS the rest — counted in
 *  `droppedOverlays` — rather than rendering them wrong or re-polluting the
 *  layout; the dropped members' figure-entry ids still land in the merged
 *  panel's `sourceFigureIds` (provenance only, never branched on) so a
 *  caller can point the user at the figure's saved preview/Graph Builder
 *  fallback for the full picture. `computePanelLayout` remains a strict
 *  tiled-grid classifier; genuine overlap among the remaining frames is
 *  accepted only through independently validated page rectangles. Returns
 *  `null` when `resolveFigurePanels` does. `layout` distinguishes trusted
 *  tiled geometry, trusted full-page overlap/inset geometry, and the ordinal
 *  fail-closed fallback; `spatial` retains the legacy tiled-only signal. */
export function resolveSpatialPanels(
  family: OriginFigureEntry[],
  datasets: Dataset[],
): {
  panels: SpatialPanel[];
  spatial: boolean;
  layout: "tiled" | "page" | "ordinal";
  /** Frame-coincident layers a native 2-axis panel couldn't also carry (a
   *  group of 3+ merges host+first-partner only) — 0 when every coincident
   *  layer fit. Provenance for these still lands in the merged panel's
   *  `sourceFigureIds`. */
  droppedOverlays: number;
} | null {
  const resolved = resolveFigurePanels(family, datasets);
  if (!resolved) return null;
  const groups = coincidentOverlayGroups(family);
  let droppedOverlays = 0;
  const reducedIndices: number[] = [];
  const reducedPanels: Omit<SpatialPanel, "row" | "col">[] = [];
  for (const { indices } of groups) {
    const [hostIndex, y2Index, ...dropped] = indices;
    reducedIndices.push(hostIndex);
    if (y2Index == null) {
      reducedPanels.push(resolved[hostIndex]);
      continue;
    }
    const merged = mergePanelWithY2(resolved[hostIndex], resolved[y2Index], family[y2Index].figure);
    if (dropped.length === 0) {
      reducedPanels.push(merged);
      continue;
    }
    droppedOverlays += dropped.length;
    reducedPanels.push({
      ...merged,
      sourceFigureIds: [...(merged.sourceFigureIds ?? []), ...dropped.map((i) => family[i].id)],
    });
  }
  const page = family[0].figure.page ?? null;
  const layout = computePanelLayout(
    reducedIndices.map((i) => family[i].figure.frame ?? null),
    page,
  );
  // The full-PAGE aspect + per-panel page-normalized rect for the "page" fit
  // (#54 Stage 2) — distinct from `frameRect`/`layoutAspect`, which discard the
  // page's margins by normalizing to the frames' bounding box (PR #47).
  const pageAspect = page && page.width > 0 && page.height > 0 ? page.width / page.height : undefined;
  const panels: SpatialPanel[] = reducedPanels.map((p, pos) => {
    const pageRect = pageNormalizedRect(family[reducedIndices[pos]]?.figure.frame, page);
    return {
      ...p,
      row: layout.placements[pos]?.row ?? pos,
      col: layout.placements[pos]?.col ?? 0,
      frameRect: layout.placements[pos]?.rect,
      layoutAspect: layout.aspectRatio,
      ...(pageRect ? { pageRect } : {}),
      ...(pageAspect != null ? { pageAspect } : {}),
    };
  });
  // Overlap is invalid for the tiled-frame clusterer but valid (and required)
  // for Origin insets/free-positioned layers. If every layer has a trusted
  // full-page rectangle, preserve that composition in page mode instead of
  // mislabelling it as undecoded and flattening it to an ordinal stack.
  const layoutKind = layout.spatial
    ? "tiled"
    : pageAspect != null && pageValidRects(panels) != null
      ? "page"
      : "ordinal";
  return { panels, spatial: layout.spatial, layout: layoutKind, droppedOverlays };
}

/** Info-toast wording for `applyOriginFigure`'s spatial branch (#54
 *  residual) — one line per condition the apply couldn't render exactly as
 *  decoded: the ordinal fallback (page geometry not decoded, unchanged
 *  wording) and/or coincident overlay layers a native 2-axis panel couldn't
 *  also carry (`resolveSpatialPanels`'s `droppedOverlays`) — pointing the
 *  user at the figure's saved preview/Graph Builder fallback for those.
 *  Both can fire together; `[]` means the apply rendered cleanly. Pulled out
 *  of `useApp.applyOriginFigure` so the store's per-condition toast wiring
 *  stays a one-line loop (store-size ratchet). */
export function spatialApplyNotices(
  layout: "tiled" | "page" | "ordinal",
  panelCount: number,
  droppedOverlays: number,
): string[] {
  const out: string[] = [];
  if (layout === "ordinal") {
    out.push(`applied ${panelCount} panels stacked in layer order — page geometry not decoded`);
  }
  if (droppedOverlays > 0) {
    out.push(
      `${droppedOverlays} overlay layer(s) exceed the 2-axis native renderer — open the figure's saved preview for the original`,
    );
  }
  return out;
}
