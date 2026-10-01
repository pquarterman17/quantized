// The floating glass tool-dock over the plot: tool picker (pointer/zoom/pan/
// cursor/measure/stats/select) + region-analysis tools (integrate/FWHM/
// gadget) + the shape-annotation flyout + whole-plot view actions (reset/
// smart-scale/save-PNG/copy-data/publication-copy) + alternate render modes (stack/
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
// own no-op guard in useGlobalShortcuts.ts), and Copy Figure when the browser
// has no Clipboard image API (the exact condition usePlotStageActions'
// publication-copy command would be unable to write its PNG fallback).
//
// GUI audit P1: when the stage is narrower than the dock (125% scaling, a
// default Graph Window, a narrow window) the trailing groups collapse into the
// "⋯" menu instead of being clipped (plotToolbarOverflow.ts).

import { Fragment, useRef, useState, type ReactNode } from "react";

import { clipboardImageSupported } from "../../lib/clipboard";
import { keyForTool, RESET_VIEW_KEY } from "../../lib/plotToolKeys";
import {
  ANALYZE_TOOLS,
  COPY_DATA,
  COPY_FIGURE,
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
import { stackLayoutOn } from "../../store/plotViewSettings";
import { loadToolbarPrefs, saveToolbarPrefs } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { useToolGroupFit } from "./plotToolbarOverflow";
import PlotToolbarGroup from "./PlotToolbarGroup";

interface Props {
  onReset: () => void;
  onSmartScale: () => void;
  onSavePng: () => void;
  onCopyData: () => void;
  onCopyFigure: () => void;
  /** Item 11: freeze the current plot into a static in-app compare window
   *  (the toolbar's in-app counterpart to the ⎘ Copy Figure clipboard copy). */
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
  onCopyFigure,
  onSnapshotWindow,
}: Props) {
  const tool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
  // S1 (a): ON whenever a multi-panel layout is engaged, not just `stackMode`.
  const stackOn = useApp(stackLayoutOn);
  const toggleStackLayout = useApp((s) => s.toggleStackLayout);
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
  const [lastShapeKind, setLastShapeKind] = useState(SHAPE_TOOLS[0].kind);
  const [optsFlyout, setOptsFlyout] = useState<{ x: number; y: number } | null>(null);
  const [showGroupLabels, setShowGroupLabels] = useState(() => loadToolbarPrefs().showGroupLabels);
  const shapeBtnRef = useRef<HTMLButtonElement>(null);
  const optsBtnRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

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
  const lastShape = SHAPE_TOOLS.find((t) => t.kind === lastShapeKind);

  const annotate = (
    <span style={{ display: "inline-flex" }}>
      <button
        className={`qzk-tool-btn${drawShapeKind ? " active" : ""}`}
        aria-label={`Draw ${lastShape?.label ?? "Shape"}`}
        aria-pressed={Boolean(drawShapeKind)}
        data-tip="Draw Shape"
        data-tip-desc="Use the last drawing tool; choose another with the arrow"
        onClick={() => setDrawShapeKind(lastShapeKind)}
      >
        {lastShape?.glyph ?? "▱"}
      </button>
      <button
        ref={shapeBtnRef}
        className="qzk-tool-btn"
        aria-label="Choose drawing tool"
        data-tip="Choose Drawing Tool"
        data-tip-desc="Pick an arrow, line, rectangle, ellipse, or text box"
        style={{ width: 14, paddingInline: 1 }}
        onClick={() => {
          const r = shapeBtnRef.current?.getBoundingClientRect();
          setShapeFlyout(r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 });
        }}
      >
        ▾
      </button>
    </span>
  );
  const pickShape = (kind: (typeof SHAPE_TOOLS)[number]["kind"]) => {
    setLastShapeKind(kind);
    setDrawShapeKind(kind);
  };
  const shapeItems: ContextMenuItem[] = SHAPE_TOOLS.map((t) => ({
    label: `${t.glyph}  Draw ${t.label}`,
    checked: drawShapeKind === t.kind,
    run: () => pickShape(t.kind),
  }));

  // Order matters: groups collapse into "⋯" from the END, so Navigate (the
  // most-used tools) is the last to go and never actually does.
  const groups: { label: string; buttons?: BtnSpec[]; custom?: ReactNode; items?: ContextMenuItem[] }[] = [
    { label: "Navigate", buttons: NAVIGATE_TOOLS.map(toolBtn) },
    { label: "Inspect", buttons: INSPECT_TOOLS.map(toolBtn) },
    { label: "Analyze", buttons: ANALYZE_TOOLS.map(toolBtn) },
    { label: "Annotate", custom: annotate, items: shapeItems },
    {
      label: "View",
      buttons: [
        actionBtn(RESET_VIEW, {
          shortcut: RESET_VIEW_KEY,
          disabled: !canResetView,
          disabledReason: "Nothing to reset — the view is already at its default extents",
          onClick: onReset,
        }),
        actionBtn(SMART_SCALE, { onClick: onSmartScale }),
        actionBtn(STACK_MODE, {
          active: stackOn,
          desc: stackOn ? "Return to a single overlaid plot" : STACK_MODE.desc,
          onClick: toggleStackLayout,
        }),
        actionBtn(INSET_MODE, { active: insetMode, onClick: () => setInsetMode(!insetMode) }),
        actionBtn(POLAR_MODE, { active: polarMode, onClick: () => setPolarMode(true) }),
        actionBtn(STAT_MODE, { active: statMode, onClick: () => setStatMode(true) }),
      ],
    },
    {
      label: "Export",
      buttons: [
        actionBtn(SAVE_PNG, { onClick: onSavePng }),
        actionBtn(COPY_DATA, { onClick: onCopyData }),
        actionBtn(COPY_FIGURE, {
          disabled: !canCopyImage,
          disabledReason: "Clipboard image copy isn't supported in this browser",
          onClick: onCopyFigure,
        }),
        actionBtn(SNAPSHOT_WINDOW, { onClick: onSnapshotWindow }),
      ],
    },
  ];

  const visible = useToolGroupFit(barRef, groups.length, showGroupLabels);
  const overflowItems: ContextMenuItem[] = groups.slice(visible).flatMap((g) => [
    { header: g.label },
    ...(g.items ??
      (g.buttons ?? []).map((b) => ({
        label: `${b.glyph}  ${b.name}`,
        checked: b.active,
        disabled: b.disabled,
        title: b.disabled ? b.disabledReason : undefined,
        run: b.onClick,
      }))),
  ]);
  const optsItems: ContextMenuItem[] = [
    ...overflowItems,
    ...(overflowItems.length ? [{ separator: true as const }] : []),
    { label: "Group labels", checked: showGroupLabels, run: toggleGroupLabels },
  ];

  return (
    <div ref={barRef} className="qzk-glass qzk-float-tools">
      {groups.map((g, i) => (
        <Fragment key={g.label}>
          <PlotToolbarGroup label={g.label} showLabel={showGroupLabels} collapsed={i >= visible}>
            {g.custom ?? g.buttons?.map((b) => <ToolButton key={b.name} {...b} />)}
          </PlotToolbarGroup>
          {i < visible - 1 && <span className="qzk-tool-sep" />}
        </Fragment>
      ))}
      {shapeFlyout && (
        <ContextMenu
          x={shapeFlyout.x}
          y={shapeFlyout.y}
          items={SHAPE_TOOLS.map((t) => ({
            label: `${t.glyph}  ${t.label}`,
            checked: drawShapeKind === t.kind,
            run: () => pickShape(t.kind),
          }))}
          onClose={() => setShapeFlyout(null)}
        />
      )}
      <span className="qzk-tool-sep" data-tool-sep="opts" />
      <button
        ref={optsBtnRef}
        className="qzk-tool-btn"
        aria-label="Toolbar Options"
        data-tool-opts=""
        data-tip={visible < groups.length ? "More Tools" : "Toolbar Options"}
        data-tip-desc={
          visible < groups.length ? "Tools that don't fit this window, plus group captions" : "Show or hide the group captions"
        }
        onClick={() => {
          const r = optsBtnRef.current?.getBoundingClientRect();
          setOptsFlyout(r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 });
        }}
      >
        ⋯
      </button>
      {optsFlyout && (
        <ContextMenu x={optsFlyout.x} y={optsFlyout.y} items={optsItems} onClose={() => setOptsFlyout(null)} />
      )}
    </div>
  );
}
