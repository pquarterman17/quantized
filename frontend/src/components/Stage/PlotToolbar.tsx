// The floating glass tool-dock over the plot: tool picker (pointer/zoom/pan/
// cursor/measure/stats/select) + region-analysis tools (integrate/FWHM/
// gadget) + the shape-annotation flyout + whole-plot view actions (reset/
// smart-scale/save-PNG/copy-data/snapshot) + alternate render modes (stack/
// inset/polar/stats). Reads the tool + mode flags from the store; the view
// actions close over the live uPlot instance in PlotStage, so they come in
// as props. Extracted from PlotStage to keep that component lean.
//
// GUI_INTERACTION_PLAN #7 (plot-toolbar legibility): every button now carries
// an aria-label (+ aria-pressed for toggle/tool-select buttons) and a rich
// [data-tip]/[data-tip-desc]/[data-tip-key] tooltip (TooltipLayer) instead of
// a bare `title`. Buttons are organized into six named groups (Navigate/
// Inspect/Analyze/Annotate/View/Export, PlotToolbarGroup) with a subtle
// uppercase caption — chosen over turning any group into a flyout because
// every button here is already one click away, and staying that way
// (pointer/zoom/pan/autoscale are the most-used) mattered more than shaving a
// few more px off the dock. The caption's visibility is the one bit of new
// persisted state (store/prefs.ts's loadToolbarPrefs/saveToolbarPrefs — NOT
// store/useApp.ts, which has zero ratchet headroom), toggled from the "…"
// flyout at the end of the dock. Two buttons are disabled-with-reason off
// real state: Reset View when there's nothing to reset (mirrors the "A" key's
// own no-op guard in useGlobalShortcuts.ts), and Copy Image when the browser
// has no Clipboard image API (the exact condition usePlotStageActions'
// snapshot() already falls back on).

import { useRef, useState } from "react";

import { clipboardImageSupported } from "../../lib/clipboard";
import { keyForTool, RESET_VIEW_KEY } from "../../lib/plotToolKeys";
import {
  ANALYZE_TOOLS,
  COPY_DATA,
  COPY_IMAGE,
  INSET_MODE,
  INSPECT_TOOLS,
  NAVIGATE_TOOLS,
  POLAR_MODE,
  RESET_VIEW,
  SAVE_PNG,
  SHAPE_TOOLS,
  SMART_SCALE,
  SNAPSHOT_WINDOW,
  STACK_MODE,
  STAT_MODE,
  type ActionDef,
  type ToolDef,
} from "../../lib/plotToolbarDefs";
import { loadToolbarPrefs, saveToolbarPrefs } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import ContextMenu from "../overlays/ContextMenu";
import PlotToolbarGroup from "./PlotToolbarGroup";

interface Props {
  onReset: () => void;
  onSmartScale: () => void;
  onSavePng: () => void;
  onCopyData: () => void;
  onSnapshot: () => void;
  /** Item 11: freeze the current plot into a static compare window (the ⎘
   *  clipboard snapshot's in-app sibling). */
  onSnapshotWindow: () => void;
}

interface BtnSpec {
  glyph: string;
  name: string;
  desc: string;
  shortcut?: string | null;
  /** undefined = plain action (no aria-pressed); boolean = a toggle/tool-
   *  select button's current state. */
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}

function ToolButton({ glyph, name, desc, shortcut, active, disabled, disabledReason, onClick }: BtnSpec) {
  const tipDesc = disabled && disabledReason ? disabledReason : desc;
  return (
    <button
      className={`qzk-tool-btn${active ? " active" : ""}`}
      aria-label={name}
      aria-pressed={active}
      disabled={disabled}
      data-tip={name}
      data-tip-desc={tipDesc}
      data-tip-key={shortcut ?? undefined}
      onClick={onClick}
    >
      {glyph}
    </button>
  );
}

export default function PlotToolbar({
  onReset,
  onSmartScale,
  onSavePng,
  onCopyData,
  onSnapshot,
  onSnapshotWindow,
}: Props) {
  const tool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const stackMode = useApp((s) => s.stackMode);
  const setStackMode = useApp((s) => s.setStackMode);
  const insetMode = useApp((s) => s.insetMode);
  const setInsetMode = useApp((s) => s.setInsetMode);
  const polarMode = useApp((s) => s.polarMode);
  const setPolarMode = useApp((s) => s.setPolarMode);
  const statMode = useApp((s) => s.statMode);
  const setStatMode = useApp((s) => s.setStatMode);
  const drawShapeKind = useApp((s) => s.drawShapeKind);
  const setDrawShapeKind = useApp((s) => s.setDrawShapeKind);
  const xLim = useApp((s) => s.xLim);
  const yLim = useApp((s) => s.yLim);
  const [shapeFlyout, setShapeFlyout] = useState<{ x: number; y: number } | null>(null);
  const [optsFlyout, setOptsFlyout] = useState<{ x: number; y: number } | null>(null);
  const [showGroupLabels, setShowGroupLabels] = useState(() => loadToolbarPrefs().showGroupLabels);
  const shapeBtnRef = useRef<HTMLButtonElement>(null);
  const optsBtnRef = useRef<HTMLButtonElement>(null);

  const toggleGroupLabels = () => {
    const next = !showGroupLabels;
    setShowGroupLabels(next);
    saveToolbarPrefs({ showGroupLabels: next });
  };

  // Homogeneous "select this as the active tool" buttons (Navigate/Inspect/
  // Analyze) all share the same wiring — active-tool comparison, shortcut
  // lookup, and setPlotTool onClick — so one mapper covers all three groups.
  const toolBtn = (t: ToolDef): BtnSpec => ({
    glyph: t.glyph,
    name: t.name,
    desc: t.desc,
    shortcut: keyForTool(t.id),
    active: tool === t.id,
    onClick: () => setPlotTool(t.id),
  });

  // View/Export buttons each have bespoke active/disabled logic, so this only
  // merges the shared glyph/name/desc with per-instance overrides.
  const actionBtn = (a: ActionDef, extra: Partial<BtnSpec> & { onClick: () => void }): BtnSpec => ({
    glyph: a.glyph,
    name: a.name,
    desc: a.desc,
    ...extra,
  });

  const canResetView = Boolean(xLim || yLim);
  const canCopyImage = clipboardImageSupported();

  return (
    <div className="qzk-glass qzk-float-tools">
      <PlotToolbarGroup label="Navigate" showLabel={showGroupLabels}>
        {NAVIGATE_TOOLS.map((t) => (
          <ToolButton key={t.id} {...toolBtn(t)} />
        ))}
      </PlotToolbarGroup>
      <span className="qzk-tool-sep" />
      <PlotToolbarGroup label="Inspect" showLabel={showGroupLabels}>
        {INSPECT_TOOLS.map((t) => (
          <ToolButton key={t.id} {...toolBtn(t)} />
        ))}
      </PlotToolbarGroup>
      <span className="qzk-tool-sep" />
      <PlotToolbarGroup label="Analyze" showLabel={showGroupLabels}>
        {ANALYZE_TOOLS.map((t) => (
          <ToolButton key={t.id} {...toolBtn(t)} />
        ))}
      </PlotToolbarGroup>
      <span className="qzk-tool-sep" />
      <PlotToolbarGroup label="Annotate" showLabel={showGroupLabels}>
        <button
          ref={shapeBtnRef}
          className={`qzk-tool-btn${drawShapeKind ? " active" : ""}`}
          aria-label="Draw Shape"
          aria-pressed={Boolean(drawShapeKind)}
          data-tip="Draw Shape"
          data-tip-desc="Add an arrow, line, rectangle, ellipse, or text box"
          onClick={() => {
            const r = shapeBtnRef.current?.getBoundingClientRect();
            setShapeFlyout(r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 });
          }}
        >
          ▱
        </button>
      </PlotToolbarGroup>
      {shapeFlyout && (
        <ContextMenu
          x={shapeFlyout.x}
          y={shapeFlyout.y}
          items={SHAPE_TOOLS.map((t) => ({
            label: `${t.glyph}  ${t.label}`,
            checked: drawShapeKind === t.kind,
            run: () => setDrawShapeKind(t.kind),
          }))}
          onClose={() => setShapeFlyout(null)}
        />
      )}
      <span className="qzk-tool-sep" />
      <PlotToolbarGroup label="View" showLabel={showGroupLabels}>
        <ToolButton
          {...actionBtn(RESET_VIEW, {
            shortcut: RESET_VIEW_KEY,
            disabled: !canResetView,
            disabledReason: "Nothing to reset — the view is already at its default extents",
            onClick: onReset,
          })}
        />
        <ToolButton {...actionBtn(SMART_SCALE, { onClick: onSmartScale })} />
        <ToolButton {...actionBtn(STACK_MODE, { active: stackMode, onClick: () => setStackMode(true) })} />
        <ToolButton {...actionBtn(INSET_MODE, { active: insetMode, onClick: () => setInsetMode(!insetMode) })} />
        <ToolButton {...actionBtn(POLAR_MODE, { active: polarMode, onClick: () => setPolarMode(true) })} />
        <ToolButton {...actionBtn(STAT_MODE, { active: statMode, onClick: () => setStatMode(true) })} />
      </PlotToolbarGroup>
      <span className="qzk-tool-sep" />
      <PlotToolbarGroup label="Export" showLabel={showGroupLabels}>
        <ToolButton {...actionBtn(SAVE_PNG, { onClick: onSavePng })} />
        <ToolButton {...actionBtn(COPY_DATA, { onClick: onCopyData })} />
        <ToolButton
          {...actionBtn(COPY_IMAGE, {
            disabled: !canCopyImage,
            disabledReason: "Clipboard image copy isn't supported in this browser",
            onClick: onSnapshot,
          })}
        />
        <ToolButton {...actionBtn(SNAPSHOT_WINDOW, { onClick: onSnapshotWindow })} />
      </PlotToolbarGroup>
      <span className="qzk-tool-sep" />
      <button
        ref={optsBtnRef}
        className="qzk-tool-btn"
        aria-label="Toolbar Options"
        data-tip="Toolbar Options"
        data-tip-desc="Show or hide the group captions"
        onClick={() => {
          const r = optsBtnRef.current?.getBoundingClientRect();
          setOptsFlyout(r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 });
        }}
      >
        ⋯
      </button>
      {optsFlyout && (
        <ContextMenu
          x={optsFlyout.x}
          y={optsFlyout.y}
          items={[{ label: "Group labels", checked: showGroupLabels, run: toggleGroupLabels }]}
          onClose={() => setOptsFlyout(null)}
        />
      )}
    </div>
  );
}
