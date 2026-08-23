// Publication property panels. All controls patch the one FigureOverrides
// object supplied by the builder; canonical sessions persist that object on
// their transient FigureDocument draft.

import { useEffect, useRef, useState } from "react";

import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../../lib/focusGuard";
import { LEGEND_LOCS, type FigureOverrides } from "../../../lib/figureOverrides";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { Select } from "../../primitives";
import AnnotationEditor from "./AnnotationEditor";
import ChannelsPanel from "./ChannelsPanel";
import ErrorColumnsPanel from "./ErrorColumnsPanel";
import GroupingPanel from "./GroupingPanel";
import Num from "./PropertyNumberField";
import SeriesPropertiesPanel from "./SeriesPropertiesPanel";
import RefLinePropertiesPanel from "./RefLinePropertiesPanel";
import RegionShadePropertiesPanel from "./RegionShadePropertiesPanel";
import type { ChannelsPanelProps, ErrorColumnsPanelProps, RefLinesPanelProps, RegionShadesPanelProps, SeriesPanelProps, ShapesPanelProps, TickFormatPanelProps } from "./propertyPanelTypes";
import TickFormatPanel from "./TickFormatPanel";
import ShapePropertiesPanel from "./ShapePropertiesPanel";

// The panel-group prop contracts live in propertyPanelTypes.ts (extracted to
// fund F2.3g -- see its module doc); re-exported so every existing importer
// of these names (PropertyPanels.test.tsx included) stays source-compatible.
export type {
  ChannelsPanelProps,
  ErrorColumnsPanelProps,
  GroupingPanelProps,
  RefLinesPanelProps,
  RegionShadesPanelProps,
  SeriesPanelProps,
  ShapesPanelProps,
  TickFormatPanelProps,
} from "./propertyPanelTypes";
import type { GroupingPanelProps } from "./propertyPanelTypes";

function Group({
  title,
  children,
  forceOpen,
  openNonce,
}: {
  title: string;
  children: React.ReactNode;
  forceOpen?: boolean;
  /** A monotonic counter (useFigureBuilder's focusNonce): bumping it
   *  re-triggers the effect below even when `forceOpen` stays true, so
   *  re-selecting the same element reopens a manually-collapsed panel
   *  instead of being a no-op against an unchanged boolean dependency. */
  openNonce?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    // optional-chained: jsdom has no scrollIntoView
    rootRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [forceOpen, openNonce]);
  return (
    <div className="qzk-report-section" ref={rootRef}>
      <button className="qzk-group-head" onClick={() => setOpen((current) => !current)}>
        <span className="qzk-group-caret">{open ? "▾" : "▸"}</span>
        <span className="qzk-group-name">{title}</span>
      </button>
      {open && <div style={{ padding: "4px 0 2px 14px", display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>}
    </div>
  );
}

export default function PropertyPanels({
  overrides,
  setOverrides,
  hasY2,
  xBreaks,
  setXBreaks,
  channels,
  series,
  shapes,
  refLines,
  regionShades,
  tickFormats,
  errorColumns,
  grouping,
  openGroup = null,
  openNonce,
}: {
  overrides: FigureOverrides;
  setOverrides: (overrides: FigureOverrides) => void;
  /** Item 2: whether a secondary (right) Y axis has any channel plotted on
   *  it -- without one the y2 min/max fields are placebo (the backend gate
   *  drops y2_lim), so they render only when this is true. */
  hasY2: boolean;
  /** Item 3: the canonical home for x-axis breaks (document.plot.axisBreaks.x,
   *  merged with a legacy-imported document's publication delta -- see
   *  canonicalOverrides.ts's effectiveXBreaks). When supplied, the breaks UI
   *  reads/writes ONLY this pair instead of `overrides.x_breaks`, so a
   *  canonical session's panel edits and its rendered figure can never
   *  diverge again. Absent (legacy mode) keeps the old overrides.x_breaks
   *  behavior unchanged. */
  xBreaks?: [number, number][];
  setXBreaks?: (next: [number, number][]) => void;
  /** F2.3g: canonical channel reassignment. Absent (legacy mode) hides the
   *  group -- see ChannelsPanelProps' doc. */
  channels?: ChannelsPanelProps;
  /** F2.3b: canonical per-series properties. Absent (legacy mode, or a
   *  canonical draft with nothing plotted) hides the Series group entirely —
   *  there is no lossless legacy equivalent to fall back to. */
  series?: SeriesPanelProps;
  /** F2.3c: canonical drawn shapes. Absent (legacy mode, or a canonical
   *  draft with no shapes) hides the Shapes group entirely -- see
   *  ShapesPanelProps' doc. */
  shapes?: ShapesPanelProps;
  /** F2.3d: canonical reference lines. Absent (legacy mode) hides the group;
   *  present-but-empty still renders it -- see RefLinesPanelProps' doc. */
  refLines?: RefLinesPanelProps;
  /** F2.3j: canonical region shades. Absent (legacy mode) hides the group;
   *  present-but-empty still renders it -- see RegionShadesPanelProps' doc. */
  regionShades?: RegionShadesPanelProps;
  /** F2.3e: canonical axis tick formats -- see TickFormatPanelProps' doc. */
  tickFormats?: TickFormatPanelProps;
  /** F2.3f: canonical error-column bindings. Absent (legacy mode) hides the
   *  group; present-but-empty still renders it -- see ErrorColumnsPanelProps'
   *  doc. */
  errorColumns?: ErrorColumnsPanelProps;
  /** F2.3h: canonical group-by binding -- rendered even unset ("None"), like F2.3d/f. */
  grouping?: GroupingPanelProps;
  /** Preview click-to-select can force its matching panel open. */
  openGroup?: string | null;
  /** Bumped on every selection (even reselecting the same group) so a
   *  manually-collapsed panel reopens. */
  openNonce?: number;
}) {
  const patch = (change: Partial<FigureOverrides>) => setOverrides({ ...overrides, ...change });
  // Post-removal focus anchor for the break rows' Remove buttons — the same
  // lib/focusGuard class fix the decor cards/panels carry: the clicked button
  // unmounts with its row, focus would fall to <body>, and a follow-up
  // Delete/Backspace would reach useGlobalShortcuts' dataset removal.
  const breaksRef = useRef<HTMLDivElement>(null);
  const breaksControlled = xBreaks !== undefined;
  const currentBreaks = breaksControlled ? xBreaks : (overrides.x_breaks ?? []);
  const commitBreaks = (next: [number, number][]) =>
    breaksControlled ? setXBreaks?.(next) : patch({ x_breaks: next });
  const [breakFrom, setBreakFrom] = useState("");
  const [breakTo, setBreakTo] = useState("");
  const from = Number(breakFrom);
  const to = Number(breakTo);
  const overlapsBreak = currentBreaks.some(([lo, hi]) => from < hi && to > lo);
  const breakReason: string | null =
    breakFrom.trim() === "" || breakTo.trim() === ""
      ? "enter both bounds"
      : !Number.isFinite(from) || !Number.isFinite(to)
        ? "bounds must be numbers"
        : !(from < to)
          ? "'from' must be less than 'to'"
          : overlapsBreak
            ? "overlaps an existing break"
            : null;
  const canAddBreak = breakReason === null;

  return (
    <div>
      <Group title="Text & fonts" forceOpen={openGroup === "Text & fonts"} openNonce={openNonce}>
        <Num label="font size" value={overrides.font_size} min={1} onValue={(font_size) => patch({ font_size })} />
        <Num label="title size" value={overrides.title_size} min={1} onValue={(title_size) => patch({ title_size })} />
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">font name</label>
          <NumberField
            aria-label="font name"
            numeric={false}
            width={110}
            value={overrides.font_name ?? ""}
            placeholder="(preset)"
            onChange={(font_name) => patch({ font_name: font_name.trim() || undefined })}
          />
        </span>
      </Group>

      <Group title="Axes & ticks" forceOpen={openGroup === "Axes & ticks"} openNonce={openNonce}>
        <Num label="x min" value={overrides.x_lim?.[0] ?? undefined} onValue={(value) => patch({ x_lim: [value ?? null, overrides.x_lim?.[1] ?? null] })} />
        <Num label="x max" value={overrides.x_lim?.[1] ?? undefined} onValue={(value) => patch({ x_lim: [overrides.x_lim?.[0] ?? null, value ?? null] })} />
        <Num label="y min" value={overrides.y_lim?.[0] ?? undefined} onValue={(value) => patch({ y_lim: [value ?? null, overrides.y_lim?.[1] ?? null] })} />
        <Num label="y max" value={overrides.y_lim?.[1] ?? undefined} onValue={(value) => patch({ y_lim: [overrides.y_lim?.[0] ?? null, value ?? null] })} />
        {hasY2 && (
          <>
            <Num label="y2 min" value={overrides.y2_lim?.[0] ?? undefined} onValue={(value) => patch({ y2_lim: [value ?? null, overrides.y2_lim?.[1] ?? null] })} />
            <Num label="y2 max" value={overrides.y2_lim?.[1] ?? undefined} onValue={(value) => patch({ y2_lim: [overrides.y2_lim?.[0] ?? null, value ?? null] })} />
          </>
        )}
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">tick direction</label>
          <Select
            aria-label="tick direction"
            options={[{ value: "", label: "(preset)" }, { value: "in", label: "in" }, { value: "out", label: "out" }]}
            value={overrides.ticks?.dir ?? ""}
            onChange={(event) => patch({ ticks: { ...overrides.ticks, dir: (event.target.value || undefined) as "in" | "out" | undefined } })}
          />
        </span>
        <Num label="tick length" value={overrides.ticks?.len} min={0} onValue={(len) => patch({ ticks: { ...overrides.ticks, len } })} />
        <Checkbox checked={overrides.ticks?.minor ?? false} onChange={(minor) => patch({ ticks: { ...overrides.ticks, minor: minor || undefined } })}>minor ticks</Checkbox>
        <Checkbox checked={overrides.spines?.top ?? true} onChange={(top) => patch({ spines: { ...overrides.spines, top } })}>top spine</Checkbox>
        <Checkbox checked={overrides.spines?.right ?? true} onChange={(right) => patch({ spines: { ...overrides.spines, right } })}>right spine</Checkbox>
        <Checkbox checked={overrides.grid ?? false} onChange={(grid) => patch({ grid: grid || undefined })}>grid</Checkbox>
        <div
          ref={breaksRef}
          tabIndex={-1}
          onKeyDown={absorbStrayDeleteOnContainer}
          style={{ display: "flex", flexWrap: "wrap", gap: 6, width: "100%", alignItems: "end" }}
        >
          <span className="qzk-field-lbl" style={{ width: "100%" }}>x-axis breaks</span>
          {currentBreaks.map(([lo, hi], index) => (
            <div key={`${lo}:${hi}:${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span className="qzk-ds-meta">{lo} to {hi}</span>
              <button
                className="qz-btn qz-ghost qz-sm"
                aria-label={`Remove x-axis break ${index + 1}`}
                title="Remove this omitted x-axis range"
                onClick={() =>
                  removeRowSafely(breaksRef.current, () =>
                    commitBreaks(currentBreaks.filter((_, current) => current !== index)),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
            <label className="qzk-field-lbl">break from</label>
            <NumberField aria-label="break from" value={breakFrom} width={64} onChange={setBreakFrom} />
          </span>
          <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
            <label className="qzk-field-lbl">break to</label>
            <NumberField aria-label="break to" value={breakTo} width={64} onChange={setBreakTo} />
          </span>
          {breakFrom.trim() !== "" && breakTo.trim() !== "" && breakReason && (
            <div className="qzk-ds-meta" style={{ color: "var(--text-dim)", width: "100%" }}>{breakReason}</div>
          )}
          <span title={breakReason ?? "Omit a finite, non-overlapping x-range in the export"}>
            <button
              className="qz-btn qz-sm"
              disabled={!canAddBreak}
              onClick={() => {
                if (!canAddBreak) return;
                const nextBreaks: [number, number][] = [...currentBreaks, [from, to]];
                commitBreaks(nextBreaks.sort(([left], [right]) => left - right));
                setBreakFrom("");
                setBreakTo("");
              }}
            >
              Add break
            </button>
          </span>
        </div>
        {tickFormats && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", marginTop: 4 }}>
            <span className="qzk-field-lbl" style={{ width: "100%" }}>tick format</span>
            <TickFormatPanel
              xFmt={tickFormats.xFmt}
              yFmt={tickFormats.yFmt}
              y2Fmt={tickFormats.y2Fmt}
              hasY2={hasY2}
              xIsDate={tickFormats.xIsDate}
              onXFmt={tickFormats.onXFmt}
              onYFmt={tickFormats.onYFmt}
              onY2Fmt={tickFormats.onY2Fmt}
            />
          </div>
        )}
      </Group>

      <Group title="Legend" forceOpen={openGroup === "Legend"} openNonce={openNonce}>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">position</label>
          <Select
            aria-label="legend position"
            options={[{ value: "", label: "(preset: best)" }, ...LEGEND_LOCS.map((value) => ({ value, label: value }))]}
            value={overrides.legend?.loc ?? ""}
            onChange={(event) => patch({ legend: { ...overrides.legend, loc: event.target.value || undefined } })}
          />
        </span>
        <Checkbox checked={overrides.legend?.show ?? true} onChange={(show) => patch({ legend: { ...overrides.legend, show } })}>show</Checkbox>
        <Checkbox checked={overrides.legend?.frame ?? false} onChange={(frame) => patch({ legend: { ...overrides.legend, frame } })}>frame</Checkbox>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">title</label>
          <NumberField
            aria-label="legend title"
            numeric={false}
            width={160}
            value={overrides.legend?.title ?? ""}
            placeholder="(none)"
            onChange={(title) => patch({ legend: { ...overrides.legend, title: title || undefined } })}
          />
        </span>
      </Group>

      {channels && (
        <Group title="Channels" forceOpen={openGroup === "Channels"} openNonce={openNonce}>
          <ChannelsPanel
            labels={channels.labels}
            channelRoles={channels.channelRoles}
            xKey={channels.xKey}
            yKeys={channels.yKeys}
            y2Keys={channels.y2Keys}
            fallbackYKeys={channels.fallbackYKeys}
            onXKey={channels.onXKey}
            onToggleY={channels.onToggleY}
            onToggleY2={channels.onToggleY2}
          />
        </Group>
      )}

      {series && series.channels.length > 0 && (
        <Group title="Series" forceOpen={openGroup === "Series"} openNonce={openNonce}>
          <SeriesPropertiesPanel
            labels={series.labels}
            channels={series.channels}
            styles={series.styles}
            hiddenChannels={series.hiddenChannels}
            seriesLabels={series.nameOverrides}
            errors={series.errors}
            onStyle={series.onStyle}
            onHiddenChange={series.onHiddenChange}
            onMove={series.onMove}
          />
        </Group>
      )}

      {grouping && (
        <Group title="Grouping" forceOpen={openGroup === "Grouping"} openNonce={openNonce}>
          <GroupingPanel groupKey={grouping.groupKey} labels={grouping.labels} onGroupKey={grouping.onGroupKey} />
        </Group>
      )}

      {shapes && shapes.shapes.length > 0 && (
        <Group title="Shapes" forceOpen={openGroup === "Shapes"} openNonce={openNonce}>
          <ShapePropertiesPanel shapes={shapes.shapes} onStyle={shapes.onStyle} onRemove={shapes.onRemove} />
        </Group>
      )}

      {refLines && (
        <Group title="Reference lines" forceOpen={openGroup === "Reference lines"} openNonce={openNonce}>
          <RefLinePropertiesPanel
            refLines={refLines.refLines}
            onValue={refLines.onValue}
            onAdd={refLines.onAdd}
            onRemove={refLines.onRemove}
          />
        </Group>
      )}

      {regionShades && (
        <Group title="Region shades" forceOpen={openGroup === "Region shades"} openNonce={openNonce}>
          <RegionShadePropertiesPanel
            regionShades={regionShades.regionShades}
            onPatch={regionShades.onPatch}
            onAdd={regionShades.onAdd}
            onRemove={regionShades.onRemove}
          />
        </Group>
      )}

      {errorColumns && (
        <Group title="Error columns" forceOpen={openGroup === "Error columns"} openNonce={openNonce}>
          <ErrorColumnsPanel
            bindings={errorColumns.bindings}
            labels={errorColumns.labels}
            onPatch={errorColumns.onPatch}
            onAdd={errorColumns.onAdd}
            onRemove={errorColumns.onRemove}
            onDetect={errorColumns.onDetect}
          />
        </Group>
      )}

      <Group title="Canvas (margins, fig fraction)">
        <Num label="left" value={overrides.margins?.left} onValue={(left) => patch({ margins: { ...overrides.margins, left } })} />
        <Num label="right" value={overrides.margins?.right} onValue={(right) => patch({ margins: { ...overrides.margins, right } })} />
        <Num label="top" value={overrides.margins?.top} onValue={(top) => patch({ margins: { ...overrides.margins, top } })} />
        <Num label="bottom" value={overrides.margins?.bottom} onValue={(bottom) => patch({ margins: { ...overrides.margins, bottom } })} />
      </Group>

      <Group title="Annotations" forceOpen={openGroup === "Annotations"} openNonce={openNonce}>
        <AnnotationEditor
          annotations={overrides.annotations ?? []}
          onChange={(annotations) => patch({ annotations })}
        />
      </Group>
    </div>
  );
}
