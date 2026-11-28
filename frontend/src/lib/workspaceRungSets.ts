// Which gated field belongs to which rung of the `.dwk` version ladder (see the ladder rule in
// `workspaceForwardCompat.ts`, which classifies the fields and reads these sets). Split out of that module
// to keep it under the size ceiling. THE LADDER RULE applies here: a released rung's set is FROZEN
// (`workspaceForwardCompat.test.ts` pins it); a field gated now goes in NEW_SINCE_V045, the top rung.

import { RECIPE_GATED_FEATURES } from "./workspaceRecipeCompat";
import { GATED_METADATA_KEYS, metadataFeature } from "./workspaceMetadataGate";

/** Every gated metadata feature name (`Dataset.metadata.<key>`), the metadata-key gate's entries in NEW_SINCE_V045. */
export const GATED_METADATA_FEATURES: readonly string[] = GATED_METADATA_KEYS.map(metadataFeature);

/** Gated fields added AFTER v0.38.0. v0.35-v0.38 accept a version-6 file, so
 *  v6 alone does not protect these: each one's 0.38 sanitizer drops it on
 *  open + save (`git show v0.38.0:` axisFormat.sanitizeAxisExtras has no
 *  `divideMark`, plotviewSanitize.sanitizeStatPicks no `barPercent` /
 *  `valueRange`, errorRoles' binding no `origin`). A file holding one is
 *  written as v7 (`WORKSPACE_VERSION_POST_038`), which 0.34-0.38 all refuse.
 *  EXTENDING: a field gated after this release goes here too (the test pins
 *  every other gated field as one v0.38.0 already read). */
export const NEW_SINCE_V038: ReadonlySet<string> = new Set([
  "AxisFormat.divideMark", "ErrorBinding.origin", "StatPicks.barPercent", "StatPicks.valueRange",
  "StatPicks.histCols", "ExportSeriesStyle.stack", "ExportSeriesStyle.float", "Dataset.cellRules",
  "StatMarks.comparisons", "StatMarks.compareMethod", "StatMarks.compareControl", "StatMarks.compareExact",
  "PlotView.overlays", "PlotView.pointLabels",
]);

/** Gated fields added AFTER v0.38.0 that v0.45.0 STILL READS (so they are not
 *  new since v0.45.0). v0.39-v0.41 accept a version-7 file and read the
 *  top-level keys one by one, so v7 alone does not protect these. A file
 *  holding one is written as v8 (`WORKSPACE_VERSION_POST_041`), which
 *  0.34-0.41 all refuse (owner decision D10, WORKSPACE_LAYOUT_PLAN). FROZEN:
 *  v0.45.0 is released and reads v8, so a field gated since goes in
 *  NEW_SINCE_V045, never here (a test pins this set's exact contents). */
export const NEW_SINCE_V041: ReadonlySet<string> = new Set([
  "Workspace.windowLayout", "Dataset.rowStyle",
]) // rowStyle: G24, gated conservatively (not measured against v0.41.0);

/** Gated fields added AFTER v0.45.0. v0.42-v0.45 accept a version-8 file, so v8
 *  alone does not protect these (measured: v0.45.0's own parseWorkspace +
 *  serializeWorkspace dropped each one from a v8 file on open + save). A file
 *  holding one is written as v9 (`WORKSPACE_VERSION_POST_045`), which 0.34-0.45
 *  all refuse. This is the CURRENT top rung. EXTENDING: a field gated now goes
 *  here. THE RULE: once a release that reads the top rung ships, a new gated
 *  field needs a NEW rung: freeze this set, add `WORKSPACE_VERSION_POST_0NN`,
 *  `NEW_SINCE_V0NN` and `featuresV0NNWouldDrop`, and extend the backend's
 *  `WORKSPACE_VERSIONS`. (v8 was forgotten for four releases: fields gated
 *  after v0.45.0 were filed under v8, which v0.45.0 opens and drops from.) */
export const NEW_SINCE_V045: ReadonlySet<string> = new Set([
  "Workspace.ternaryFigures", "Workspace.namedRanges", "StatPicks.cdfY", "StatPicks.cdfBand", "StatPicks.rug",
  "StatPicks.marginal", "StatPicks.ridgeOverlap", "StatPicks.ridgeBw",
  "StatPicks.violinSide", "StatPicks.pairedCi", "StatPicks.lollipopStat", "StatPicks.lollipopSort", "StatPicks.histStack",
  "StatPicks.violinMarks", "StatPicks.pairedDirection", "StatPicks.lollipopHoriz", "StatPicks.histSplit",
  "StatPicks.violinMean", "StatPicks.violinRain", "StatPicks.pairedTol", "StatPicks.histPercent", "StatPicks.lollipopWhisker",
  "ExportSeriesStyle.rug", "ExportSeriesStyle.rug_length", "ExportSeriesStyle.rug_opacity",
  "ExportSeriesStyle.symbol_gap", "ExportSeriesStyle.line_front", "ExportSeriesStyle.double_line",
  "ExportSeriesStyle.marker_text", "ExportSeriesStyle.marker_text_size", "ExportSeriesStyle.marker_text_from", "ExportSeriesStyle.error_box", "ExportSeriesStyle.stack_total",
  "AxisFormat.equal", "AxisFormat.anchor", "MapViewState.cellLabels", "MapViewState.scaleBar", "PointLabels.avoid", "PointLabels.text", "Shape.kind=measure", "OverrideShape.kind=measure",
  // A 3-D view v0.45.0 reads but narrows: it keeps no `ext` and an unknown kind (bars3d, vectors3d) makes it
  // drop the whole 3-D view (MEASURED against v0.45.0's `sanitizeMap3d`: unknown kind -> undefined, fields listed one by one).
  "Map3dView.ext", "Map3dView.kind=bars_vectors",
  // Item 24: v0.45.0 reads `PlotView.overlays` but its sanitizer keeps only line / smoother / ellipse{level}
  // (MEASURED by reading v0.45.0's `sanitizePlotOverlays`): centroid, hull and ellipse.kind="mean" are dropped,
  // and a hull-only set becomes "no overlays" (a "mean" ellipse would silently reopen as the data ellipse).
  "PlotOverlays.groupShapes",
  // Item 23: supplied-p-value significance marks; v0.45.0's sanitizeStatMarks keeps only its listed keys.
  "StatMarks.sig",
  // ROW_RANGE_CONTRACT 9.1 (R2): v0.45.0's view sanitizer keeps known keys only, so it would draw every row.
  "PlotView.rowRange",
  // OG20: a saved snapshot result's recorded row range (lib/inputRowRange.ts); measured in workspaceValueGates.
  "AnalysisResult.parameters.rowRange",
  // Nested recipe fields (item 7, workspaceRecipeCompat.ts): psdScaling, off-default Distribution CI settings.
  ...RECIPE_GATED_FEATURES,
  // A saved ROI of kind "polygon": v0.34.0 and v0.45.0 skip an unknown kind on open (measured in workspaceValueGates).
  "RoiDef.kind=polygon",
  // Private dataset metadata sidecars (ROW_RANGE_CONTRACT 9.1): see GATED_METADATA_KEYS.
  ...GATED_METADATA_FEATURES,
])
