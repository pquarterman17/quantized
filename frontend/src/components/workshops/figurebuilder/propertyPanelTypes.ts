// Prop contracts for the canonical-draft property-panel groups. Extracted
// out of PropertyPanels.tsx (F2.3g) to fund the new Channels group: the
// component file was approaching its 400-line ceiling on interface bodies
// alone, and these types have no JSX of their own -- they belong beside the
// other pure-data modules in this directory, re-exported from
// PropertyPanels.tsx so every existing importer stays source-compatible.

import type { ErrorBinding, ErrorSide } from "../../../lib/errorRoles";
import type { AxisFormat, ChannelRole, RefLine, Shape, SeriesStyle } from "../../../lib/types";

/** F2.3b: per-series properties on the canonical draft. Supplied only when a
 *  canonical session has at least one plotted channel (legacy Publication
 *  Preview has no lossless series-level document field to edit — see
 *  useFigureBuilder.ts's field doc) — the Series group renders nothing when
 *  this is absent. */
export interface SeriesPanelProps {
  labels: readonly string[];
  channels: readonly number[];
  styles: Record<number, SeriesStyle>;
  hiddenChannels: readonly number[];
  nameOverrides: Record<number, string>;
  errors: readonly ErrorBinding[];
  onStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
  onHiddenChange: (channel: number, hidden: boolean) => void;
  onMove: (channel: number, direction: -1 | 1) => void;
}

/** F2.3c: per-shape properties on the canonical draft. Supplied only when a
 *  canonical session's draft has at least one drawn shape -- the Shapes
 *  group renders nothing when this is absent (legacy Publication Preview has
 *  no lossless shape document field to edit -- see useFigureBuilder.ts's
 *  field doc, same reasoning as SeriesPanelProps above). */
export interface ShapesPanelProps {
  shapes: readonly Shape[];
  onStyle: (id: string, patch: Partial<Omit<Shape, "id">>) => void;
  onRemove: (id: string) => void;
}

/** F2.3d: reference lines on the canonical draft. Supplied only in a canonical
 *  session -- but UNLIKE Series and Shapes, the group renders even with an
 *  EMPTY list, because this panel can create the first line (axis + value
 *  needs no live canvas). Hiding it when empty would make "add a reference
 *  line" reachable only by leaving the preview for the Stage, which is the
 *  one action that invalidates the session. */
export interface RefLinesPanelProps {
  refLines: readonly RefLine[];
  onValue: (id: string, value: number) => void;
  onAdd: (axis: RefLine["axis"], value: number) => void;
  onRemove: (id: string) => void;
}

/** F2.3e: axis tick formats on the canonical draft. Absent (legacy mode)
 *  hides the controls -- legacy Publication Preview renders from the LIVE
 *  store's xFmt/yFmt, which the Stage's own Inspector card already owns, so a
 *  second editor for the same singleton would be a confusing duplicate. */
export interface TickFormatPanelProps {
  xFmt: AxisFormat;
  yFmt: AxisFormat;
  y2Fmt: AxisFormat | null;
  xIsDate: boolean;
  onXFmt: (next: AxisFormat) => void;
  onYFmt: (next: AxisFormat) => void;
  onY2Fmt: (next: AxisFormat | null) => void;
}

/** F2.3f: error-column bindings on the canonical draft. Supplied only in a
 *  canonical session -- like F2.3d's reference lines (not F2.3b's Series,
 *  which stays read-only display), the group renders even with an EMPTY
 *  list, because Add needs only the dataset's column labels, no live canvas. */
export interface ErrorColumnsPanelProps {
  bindings: readonly ErrorBinding[];
  labels: readonly string[];
  onPatch: (index: number, patch: Partial<Omit<ErrorBinding, "channel">>) => void;
  onAdd: (channel: number, target: number, axis: ErrorBinding["axis"], side: ErrorSide) => void;
  onRemove: (index: number) => void;
  onDetect: () => void;
}

/** F2.3g: channel reassignment (X axis; each other channel's Y/Y2/not-plotted
 *  membership) on the canonical draft. Gated on `canonical` only, like F2.3d/f
 *  -- the X-axis select and per-channel toggles need no live canvas. */
export interface ChannelsPanelProps {
  labels: readonly string[];
  channelRoles?: Record<number, ChannelRole>;
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
  fallbackYKeys: readonly number[];
  onXKey: (xKey: number | null) => void;
  onToggleY: (channel: number) => void;
  onToggleY2: (channel: number) => void;
}
